-- 수신 지원 함수(계획 ③ Step 1). 계약: docs/INGEST_V2.md.
-- (a) 메모 원자 갱신, (a2) 원천ID 정규화, (b)(c) 키셋 페이지 조회(jsonb 하나 반환), (d) 커밋 함수의 후보 비교를 (a2) 규칙으로.
-- RLS 정책은 바꾸지 않는다.

-- (a) 거래 메모: 읽고 다시 쓰지 않고 한 UPDATE 로 metadata.memo 만 바꾼다(다른 키는 그대로).
-- 호출자 권한(RLS)으로 실행. 행이 없거나 남의 행·거래가 아니거나 인자가 NULL 이면 NULL.
create or replace function public.dashboard_item_set_memo(p_id uuid, p_memo text)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 update public.dashboard_items
    set metadata = jsonb_set(case when jsonb_typeof(metadata)='object' then metadata else '{}'::jsonb end,
                             '{memo}', to_jsonb(p_memo), true)
  where p_id is not null and p_memo is not null
    and id = p_id and user_id = auth.uid() and kind = 'transaction'
 returning to_jsonb(dashboard_items.*)
$$;
revoke all on function public.dashboard_item_set_memo(uuid,text) from public,anon;
grant execute on function public.dashboard_item_set_memo(uuid,text) to authenticated, service_role;

-- (a2) 원천 거래ID 정규화: JS String.prototype.trim 이 지우는 문자 집합을 양끝에서 지운다(TS normalizeSourceId 와 같은 규칙).
-- 공백 U+0020, U+0009~U+000D, U+00A0, U+1680, U+2000~U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. NULL 이면 NULL.
create or replace function public.dashboard_norm_id(t text)
returns text language sql immutable strict parallel safe as $$
 select pg_catalog.regexp_replace(t,
  '^[ \u0009-\u000d   -     　﻿]+|[ \u0009-\u000d   -     　﻿]+$',
  '', 'g')
$$;
grant execute on function public.dashboard_norm_id(text) to public;

-- (b) 기존 행 조회(키셋 페이지). PostgREST 반환 행 상한을 피하려고 jsonb 하나 {rows:[…], next_after: uuid|null} 를 돌려준다.
-- 한 페이지 n = 1~500. n+1 개를 읽어 앞 n 개를 rows 로, n+1 번째가 있으면 next_after = n 번째 id.
create or replace function public.dashboard_ingest_existing(p_user uuid, p_external_ids text[], p_after uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 n integer := least(greatest(coalesce(p_limit,500),1),500);
 v_rows jsonb; v_cnt integer; v_last uuid;
begin
 select coalesce(jsonb_agg(q.j order by q.id) filter (where q.rn <= n), '[]'::jsonb),
        count(*),
        (max(q.id::text) filter (where q.rn = n))::uuid
   into v_rows, v_cnt, v_last
   from (select d.id, to_jsonb(d.*) as j, row_number() over (order by d.id) as rn
           from public.dashboard_items d
          where d.user_id = p_user and d.external_id = any(p_external_ids)
            and (p_after is null or d.id > p_after)
          order by d.id
          limit n + 1) q;
 return jsonb_build_object('rows', v_rows, 'next_after', case when v_cnt > n then to_jsonb(v_last) else 'null'::jsonb end);
end $$;
revoke all on function public.dashboard_ingest_existing(uuid,text[],uuid,integer) from public,anon,authenticated;
grant execute on function public.dashboard_ingest_existing(uuid,text[],uuid,integer) to service_role;

-- (c) 원천 거래ID 후보 조회((b)와 같은 페이지 모양). 비교는 양쪽 다 dashboard_norm_id.
create or replace function public.dashboard_ingest_candidates(p_user uuid, p_source_ids text[], p_after uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 n integer := least(greatest(coalesce(p_limit,500),1),500);
 v_rows jsonb; v_cnt integer; v_last uuid;
begin
 select coalesce(jsonb_agg(q.j order by q.id) filter (where q.rn <= n), '[]'::jsonb),
        count(*),
        (max(q.id::text) filter (where q.rn = n))::uuid
   into v_rows, v_cnt, v_last
   from (select d.id, to_jsonb(d.*) as j, row_number() over (order by d.id) as rn
           from public.dashboard_items d
          where d.user_id = p_user and d.kind = 'transaction' and d.status <> 'archived'
            and public.dashboard_norm_id(d.metadata->>'source_record_id') = any(select public.dashboard_norm_id(x) from unnest(p_source_ids) x)
            and (p_after is null or d.id > p_after)
          order by d.id
          limit n + 1) q;
 return jsonb_build_object('rows', v_rows, 'next_after', case when v_cnt > n then to_jsonb(v_last) else 'null'::jsonb end);
end $$;
revoke all on function public.dashboard_ingest_candidates(uuid,text[],uuid,integer) from public,anon,authenticated;
grant execute on function public.dashboard_ingest_candidates(uuid,text[],uuid,integer) to service_role;

-- (d) 커밋 함수 재정의. 20261124000000_ingest_commit.sql 과 다른 점은 (e) 후보 비교가 dashboard_norm_id 규칙인 것 하나뿐.
create or replace function public.dashboard_ingest_commit(
 p_user uuid, p_rows jsonb, p_expected jsonb, p_source_ids text[], p_known jsonb, p_run jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_n integer;
 v_src text[] := coalesce(p_source_ids,'{}'::text[]);
 v_known jsonb := p_known;
 e jsonb;
 v_has_run boolean := p_run is not null;
 v_run_id uuid; v_dataset text; v_source text; v_status text; v_error text;
 v_item_count integer; v_digest text; v_as_of timestamptz; v_collected timestamptz;
 r public.dashboard_sync_runs%rowtype;
 v_id uuid; v_kind text; v_ext text;
 v_items jsonb := '[]'::jsonb;
 v_count integer := 0;
 v_inserted integer;
begin
 -- (a) 입력 검사. 이 블록의 모든 예외는 22023 DASHBOARD_INGEST_INVALID 로 바꾼다(값은 메시지에 넣지 않음).
 begin
  if p_user is null then raise exception 'p_user'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows'; end if;
  v_n := jsonb_array_length(p_rows);
  if exists (
   select 1 from jsonb_array_elements(p_rows) x(v)
   where jsonb_typeof(x.v) is distinct from 'object'
      or jsonb_typeof(x.v->'kind') is distinct from 'string' or x.v->>'kind' = ''
      or jsonb_typeof(x.v->'external_id') is distinct from 'string' or x.v->>'external_id' = ''
      or jsonb_typeof(x.v->'title') is distinct from 'string' or x.v->>'title' = ''
  ) then raise exception 'row shape'; end if;
  if (select count(distinct (x.v->>'kind', x.v->>'external_id')) from jsonb_array_elements(p_rows) x(v)) <> v_n then
   raise exception 'row dup';
  end if;

  -- p_expected: p_rows 의 키마다 정확히 하나, updated_at 키 필수(null = 행 없음 기대)
  if jsonb_typeof(p_expected) is distinct from 'array' then raise exception 'p_expected'; end if;
  if jsonb_array_length(p_expected) <> v_n then raise exception 'expected count'; end if;
  if exists (
   select 1 from jsonb_array_elements(p_expected) x(v)
   where jsonb_typeof(x.v) is distinct from 'object'
      or jsonb_typeof(x.v->'kind') is distinct from 'string'
      or jsonb_typeof(x.v->'external_id') is distinct from 'string'
      or not (x.v ? 'updated_at')
      or jsonb_typeof(x.v->'updated_at') not in ('null','string')
  ) then raise exception 'expected shape'; end if;
  perform (x.v->>'updated_at')::timestamptz from jsonb_array_elements(p_expected) x(v);
  if (select count(distinct (x.v->>'kind', x.v->>'external_id')) from jsonb_array_elements(p_expected) x(v)) <> v_n then
   raise exception 'expected dup';
  end if;
  if exists (
   select 1 from jsonb_array_elements(p_expected) x(v)
   where not exists (select 1 from jsonb_array_elements(p_rows) y(v)
                     where y.v->>'kind' = x.v->>'kind' and y.v->>'external_id' = x.v->>'external_id')
  ) then raise exception 'expected key'; end if;

  -- p_known: 원천 거래ID 후보로 TS 가 본 (id, updated_at) 집합
  if v_known is null then
   if cardinality(v_src) > 0 then raise exception 'p_known'; end if;
   v_known := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_known) is distinct from 'array' then raise exception 'p_known type'; end if;
  if exists (
   select 1 from jsonb_array_elements(v_known) x(v)
   where jsonb_typeof(x.v) is distinct from 'object'
      or jsonb_typeof(x.v->'id') is distinct from 'string'
      or jsonb_typeof(x.v->'updated_at') is distinct from 'string'
  ) then raise exception 'known shape'; end if;
  perform (x.v->>'id')::uuid, (x.v->>'updated_at')::timestamptz from jsonb_array_elements(v_known) x(v);
  if (select count(distinct (x.v->>'id')::uuid) from jsonb_array_elements(v_known) x(v)) <> jsonb_array_length(v_known) then
   raise exception 'known dup';
  end if;

  -- p_run: NULL(항목만) 또는 실행 기록 객체
  if v_has_run then
   if jsonb_typeof(p_run) is distinct from 'object' then raise exception 'p_run'; end if;
   if jsonb_typeof(p_run->'run_id') is distinct from 'string' then raise exception 'run_id'; end if;
   v_run_id := (p_run->>'run_id')::uuid;
   v_dataset := p_run->>'dataset';
   if jsonb_typeof(p_run->'dataset') is distinct from 'string'
      or v_dataset not in ('transactions','settlements','news','points','applications','subscriptions','tasks','events','journal')
   then raise exception 'dataset'; end if;
   v_source := p_run->>'source_system';
   if jsonb_typeof(p_run->'source_system') is distinct from 'string' or v_source = '' then raise exception 'source_system'; end if;
   v_status := p_run->>'status';
   if jsonb_typeof(p_run->'status') is distinct from 'string' or v_status not in ('success','failed') then raise exception 'status'; end if;
   if coalesce(jsonb_typeof(p_run->'error_code'),'null') not in ('null','string') then raise exception 'error_code'; end if;
   v_error := p_run->>'error_code';
   if v_status = 'failed' and coalesce(v_error,'') = '' then raise exception 'error_code required'; end if;
   if jsonb_typeof(p_run->'item_count') is distinct from 'number'
      or (p_run->>'item_count')::numeric <> trunc((p_run->>'item_count')::numeric)
   then raise exception 'item_count'; end if;
   v_item_count := (p_run->>'item_count')::integer;
   if v_item_count <> v_n then raise exception 'item_count mismatch'; end if;
   v_digest := p_run->>'payload_digest';
   if jsonb_typeof(p_run->'payload_digest') is distinct from 'string' or v_digest !~ '^[0-9a-f]{64}$' then raise exception 'payload_digest'; end if;
   if coalesce(jsonb_typeof(p_run->'source_as_of'),'null') not in ('null','string')
      or coalesce(jsonb_typeof(p_run->'collected_at'),'null') not in ('null','string')
   then raise exception 'times'; end if;
   v_as_of := (p_run->>'source_as_of')::timestamptz;
   v_collected := (p_run->>'collected_at')::timestamptz;
  end if;

  if v_has_run and v_status = 'failed' then
   if v_n <> 0 then raise exception 'failed with rows'; end if;
  elsif v_n < 1 or v_n > 500 then
   raise exception 'row count';
  end if;
 exception when others then
  raise exception using errcode = '22023', message = 'DASHBOARD_INGEST_INVALID';
 end;

 -- (b) 표 잠금: 자기 자신·ROW EXCLUSIVE 와 충돌하므로 다른 경로의 INSERT/UPDATE/DELETE 와 커밋 순서가 정해진다.
 lock table public.dashboard_items in share row exclusive mode;
 if v_has_run then
  -- 같은 사용자의 실행 제출 직렬화
  perform pg_advisory_xact_lock(hashtextextended('dashboard_ingest_run:'||p_user::text, 0));

  -- (c) 재전송 판정: 항목 상태 확인보다 먼저
  select * into r from public.dashboard_sync_runs
   where user_id = p_user and run_id = v_run_id and dataset = v_dataset and source_system = v_source;
  if found then
   if r.commit_source = 'ingest_v2' and r.status = v_status and r.error_code is not distinct from v_error
      and r.expected_count is not distinct from v_item_count and r.payload_digest is not distinct from v_digest then
    return jsonb_build_object('ok', true, 'idempotent', true, 'items', '[]'::jsonb, 'upserted', 0,
     'run', jsonb_build_object('run_id', r.run_id, 'dataset', r.dataset, 'source_system', r.source_system,
                               'status', r.status, 'accepted_count', r.accepted_count));
   end if;
   return jsonb_build_object('ok', false, 'code', 'RUN_ID_CONFLICT');
  end if;
 end if;

 -- (d) 기대 상태 확인: 검사할 때 본 updated_at 이 그대로인지(null = 행 없음)
 if exists (
  select 1 from jsonb_array_elements(p_expected) x(v)
  left join public.dashboard_items d
   on d.user_id = p_user and d.kind = x.v->>'kind' and d.external_id = x.v->>'external_id'
  where d.updated_at is distinct from (x.v->>'updated_at')::timestamptz
 ) then
  return jsonb_build_object('ok', false, 'code', 'CONCURRENT_CHANGE');
 end if;

 -- (e) 원천 거래ID 후보 집합이 TS 가 본 것과 같은지. 비교는 dashboard_norm_id 규칙(양끝 공백류 제거).
 if cardinality(v_src) > 0 then
  if exists (
   (select d.id, d.updated_at from public.dashboard_items d
     where d.user_id = p_user and d.kind = 'transaction' and d.status <> 'archived'
       and public.dashboard_norm_id(d.metadata->>'source_record_id') = any(select public.dashboard_norm_id(x) from unnest(v_src) x)
    except
    select (x.v->>'id')::uuid, (x.v->>'updated_at')::timestamptz from jsonb_array_elements(v_known) x(v))
   union all
   (select (x.v->>'id')::uuid, (x.v->>'updated_at')::timestamptz from jsonb_array_elements(v_known) x(v)
    except
    select d.id, d.updated_at from public.dashboard_items d
     where d.user_id = p_user and d.kind = 'transaction' and d.status <> 'archived'
       and public.dashboard_norm_id(d.metadata->>'source_record_id') = any(select public.dashboard_norm_id(x) from unnest(v_src) x))
  ) then
   return jsonb_build_object('ok', false, 'code', 'CONCURRENT_CHANGE');
  end if;
 end if;

 -- (f0) 실행 기록 먼저. 다른 경로가 그사이 같은 키를 커밋했으면 (c) 규칙으로 판정하고 항목은 쓰지 않는다.
 if v_has_run then
  insert into public.dashboard_sync_runs(user_id, run_id, dataset, source_system, source_as_of, collected_at,
   received_at, validated_at, status, verification_level, expected_count, received_count, accepted_count,
   rejected_count, error_code, payload_digest, commit_source)
  values (p_user, v_run_id, v_dataset, v_source, v_as_of, v_collected,
   now(), now(), v_status, 'unverified', v_item_count, v_n, 0,
   0, v_error, v_digest, 'ingest_v2')
  on conflict (user_id, run_id, dataset, source_system) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
   select * into r from public.dashboard_sync_runs
    where user_id = p_user and run_id = v_run_id and dataset = v_dataset and source_system = v_source;
   if found and r.commit_source = 'ingest_v2' and r.status = v_status and r.error_code is not distinct from v_error
      and r.expected_count is not distinct from v_item_count and r.payload_digest is not distinct from v_digest then
    return jsonb_build_object('ok', true, 'idempotent', true, 'items', '[]'::jsonb, 'upserted', 0,
     'run', jsonb_build_object('run_id', r.run_id, 'dataset', r.dataset, 'source_system', r.source_system,
                               'status', r.status, 'accepted_count', r.accepted_count));
   end if;
   return jsonb_build_object('ok', false, 'code', 'RUN_ID_CONFLICT');
  end if;
 end if;

 -- (f) upsert: 행 JSON 에 있는 키만 갱신, 새 행에서 없는 키는 열 기본값. user_id 는 p_user 로 강제.
 for e in select x.v from jsonb_array_elements(p_rows) with ordinality x(v, ord) order by x.ord loop
  insert into public.dashboard_items as d (user_id, kind, external_id, title, description, amount, currency, status,
   category, source, event_date, due_date, url, metadata)
  values (p_user, e->>'kind', e->>'external_id', e->>'title', e->>'description', (e->>'amount')::numeric,
   case when e ? 'currency' then e->>'currency' else 'KRW' end,
   case when e ? 'status' then e->>'status' else 'active' end,
   e->>'category', e->>'source', (e->>'event_date')::date, (e->>'due_date')::date, e->>'url',
   case when not (e ? 'metadata') then '{}'::jsonb when jsonb_typeof(e->'metadata') = 'null' then null else e->'metadata' end)
  on conflict (user_id, kind, external_id) do update set
   title = excluded.title,
   description = case when e ? 'description' then excluded.description else d.description end,
   amount = case when e ? 'amount' then excluded.amount else d.amount end,
   currency = case when e ? 'currency' then excluded.currency else d.currency end,
   status = case when e ? 'status' then excluded.status else d.status end,
   category = case when e ? 'category' then excluded.category else d.category end,
   source = case when e ? 'source' then excluded.source else d.source end,
   event_date = case when e ? 'event_date' then excluded.event_date else d.event_date end,
   due_date = case when e ? 'due_date' then excluded.due_date else d.due_date end,
   url = case when e ? 'url' then excluded.url else d.url end,
   metadata = case when e ? 'metadata' then excluded.metadata else d.metadata end
  returning d.id, d.kind, d.external_id into v_id, v_kind, v_ext;
  v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_id, 'kind', v_kind, 'external_id', v_ext));
  v_count := v_count + 1;
 end loop;

 -- (g) 실행 기록 확정
 if v_has_run then
  update public.dashboard_sync_runs
     set accepted_count = v_count,
         verification_level = case when v_count > 0 then 'structural_provenance_only' else 'unverified' end
   where user_id = p_user and run_id = v_run_id and dataset = v_dataset and source_system = v_source;
 end if;

 -- (h)
 return jsonb_build_object('ok', true, 'idempotent', false, 'items', v_items, 'upserted', v_count,
  'run', case when v_has_run then jsonb_build_object('run_id', v_run_id, 'dataset', v_dataset,
           'source_system', v_source, 'status', v_status, 'accepted_count', v_count) end);
end $$;
revoke all on function public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb) to service_role;
