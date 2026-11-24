-- 수신 지원 함수(20261124000100_ingest_support.sql): 메모 원자 갱신, 원천ID 정규화, 페이지 조회, 커밋 후보 비교.
-- 사용자 A·B, external_id 'test-only-sup-…', 가짜 값만.
-- 1부: 한 트랜잭션(begin … rollback). 2부: dblink 로 연 다른 연결과의 잠금 대기(커밋한 행은 파일 끝에서 지운다).
\set ON_ERROR_STOP on

-- ───────── 1부 ─────────
begin;

insert into public.dashboard_items(user_id,kind,external_id,title,metadata) values
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-m1','합성가맹점A','{"source_system":"samsungcard","keep":1}'),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-arr','합성가맹점A','[1]'),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-num','합성가맹점A','3'),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-jnull','합성가맹점A','null'),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-empty','합성가맹점A','{"keep":1}'),
 ('00000000-0000-4000-8000-0000000000a1','task','test-only-sup-task','친구A 할 일','{"keep":1}'),
 ('00000000-0000-4000-8000-0000000000b1','transaction','test-only-sup-b1','합성가맹점B','{"keep":1}');

-- ①~⑤ 메모: authenticated + jwt sub A
set local role authenticated;
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 res jsonb; m jsonb; v_id uuid; c record;
begin
 perform set_config('request.jwt.claim.sub', a::text, true);

 -- ① 다른 키는 그대로, memo 추가
 select id into v_id from public.dashboard_items where user_id=a and external_id='test-only-sup-m1';
 res := public.dashboard_item_set_memo(v_id, '친구A 메모');
 if res is null or res->>'id' <> v_id::text then raise exception '① result %', res; end if;
 if res->'metadata' <> '{"source_system":"samsungcard","keep":1,"memo":"친구A 메모"}'::jsonb then raise exception '① returned metadata %', res->'metadata'; end if;
 select metadata into m from public.dashboard_items where id=v_id;
 if m <> '{"source_system":"samsungcard","keep":1,"memo":"친구A 메모"}'::jsonb then raise exception '① stored metadata %', m; end if;

 -- ② 객체가 아닌 metadata → {"memo":…}
 for c in select * from (values ('test-only-sup-arr'),('test-only-sup-num'),('test-only-sup-jnull')) v(ext) loop
  select id into v_id from public.dashboard_items where user_id=a and external_id=c.ext;
  res := public.dashboard_item_set_memo(v_id, '친구A 메모 2');
  if res is null or res->'metadata' <> '{"memo":"친구A 메모 2"}'::jsonb then raise exception '② % returned %', c.ext, res; end if;
  select metadata into m from public.dashboard_items where id=v_id;
  if m <> '{"memo":"친구A 메모 2"}'::jsonb then raise exception '② % stored %', c.ext, m; end if;
 end loop;

 -- ③ 빈 문자열 메모
 select id into v_id from public.dashboard_items where user_id=a and external_id='test-only-sup-empty';
 res := public.dashboard_item_set_memo(v_id, '');
 if res is null or res->'metadata' <> '{"keep":1,"memo":""}'::jsonb then raise exception '③ %', res; end if;

 -- ④ SQL NULL 인자 → NULL, 변화 없음
 select id into v_id from public.dashboard_items where user_id=a and external_id='test-only-sup-m1';
 res := public.dashboard_item_set_memo(v_id, null);
 if res is not null then raise exception '④ p_memo null returned %', res; end if;
 res := public.dashboard_item_set_memo(null, '친구A 메모 X');
 if res is not null then raise exception '④ p_id null returned %', res; end if;
 select metadata into m from public.dashboard_items where id=v_id;
 if m <> '{"source_system":"samsungcard","keep":1,"memo":"친구A 메모"}'::jsonb then raise exception '④ changed %', m; end if;
 if exists (select 1 from public.dashboard_items where user_id=a and metadata->>'memo'='친구A 메모 X') then raise exception '④ null id wrote'; end if;

 -- ⑤ A 의 할 일 → NULL
 select id into v_id from public.dashboard_items where user_id=a and external_id='test-only-sup-task';
 res := public.dashboard_item_set_memo(v_id, '친구A 메모');
 if res is not null then raise exception '⑤ task returned %', res; end if;
end $$;
reset role;

-- ⑤ B 의 행: 호출은 A 로, 확인은 RLS 밖에서
do $$
declare b_id uuid; t_id uuid; res jsonb;
begin
 select id into b_id from public.dashboard_items where external_id='test-only-sup-b1';
 select id into t_id from public.dashboard_items where external_id='test-only-sup-task';
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
 res := public.dashboard_item_set_memo(b_id, '친구A 메모');
 execute 'reset role';
 if res is not null then raise exception '⑤ other user row returned %', res; end if;
 if (select metadata from public.dashboard_items where id=b_id) <> '{"keep":1}'::jsonb then raise exception '⑤ other user row changed'; end if;
 if (select metadata from public.dashboard_items where id=t_id) <> '{"keep":1}'::jsonb then raise exception '⑤ task row changed'; end if;
 perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ⑥ 권한
do $$
declare f text;
begin
 if has_function_privilege('anon','public.dashboard_item_set_memo(uuid,text)','execute') then raise exception '⑥ anon can set memo'; end if;
 if not has_function_privilege('authenticated','public.dashboard_item_set_memo(uuid,text)','execute') then raise exception '⑥ authenticated cannot set memo'; end if;
 if not has_function_privilege('service_role','public.dashboard_item_set_memo(uuid,text)','execute') then raise exception '⑥ service_role cannot set memo'; end if;
 foreach f in array array['public.dashboard_ingest_existing(uuid,text[],uuid,integer)',
                          'public.dashboard_ingest_candidates(uuid,text[],uuid,integer)',
                          'public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)'] loop
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '⑥ client can run %', f; end if;
  if not has_function_privilege('service_role', f, 'execute') then raise exception '⑥ service_role cannot run %', f; end if;
 end loop;
 if not has_function_privilege('anon','public.dashboard_norm_id(text)','execute') then raise exception '⑥ norm_id not public'; end if;
end $$;

-- ⑦ existing: 1200행 키셋 페이지
insert into public.dashboard_items(user_id,kind,external_id,title,metadata)
 select '00000000-0000-4000-8000-0000000000a1','task','test-only-sup-e-'||i,'친구A 할 일 '||i,'{}' from generate_series(1,1200) i;
insert into public.dashboard_items(user_id,kind,external_id,title,metadata) values
 ('00000000-0000-4000-8000-0000000000b1','task','test-only-sup-e-1','친구B 할 일','{}');

set local role service_role;
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 ids text[]; res jsonb; v_after uuid := null; sizes integer[] := '{}'; seen uuid[] := '{}'; r jsonb; i integer := 0;
begin
 select array_agg('test-only-sup-e-'||g) into ids from generate_series(1,1200) g;
 loop
  i := i + 1;
  if i > 10 then raise exception '⑦ too many pages'; end if;
  res := public.dashboard_ingest_existing(a, ids, v_after, 500);
  sizes := sizes || jsonb_array_length(res->'rows');
  for r in select x from jsonb_array_elements(res->'rows') x loop
   if (r->>'user_id')::uuid <> a then raise exception '⑦ other user row'; end if;
   seen := seen || (r->>'id')::uuid;
  end loop;
  if res->'next_after' = 'null'::jsonb then exit; end if;
  v_after := (res->>'next_after')::uuid;
  if v_after <> seen[cardinality(seen)] then raise exception '⑦ next_after is not the last row id'; end if;
 end loop;
 if sizes <> array[500,500,200] then raise exception '⑦ page sizes %', sizes; end if;
 if cardinality(seen) <> 1200 or (select count(distinct s) from unnest(seen) s) <> 1200 then raise exception '⑦ not each row once'; end if;
 if exists (select 1 from public.dashboard_items d where d.user_id=a and d.external_id = any(ids) and not d.id = any(seen)) then raise exception '⑦ row missing'; end if;

 res := public.dashboard_ingest_existing(a, ids, null, 5000);
 if jsonb_array_length(res->'rows') <> 500 or res->'next_after' = 'null'::jsonb then raise exception '⑦ p_limit 5000 not capped'; end if;
end $$;
reset role;

-- ⑧ dashboard_norm_id + candidates
insert into public.dashboard_items(user_id,kind,external_id,title,status,metadata) values
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-c1','합성가맹점A','active',jsonb_build_object('source_record_id','apv-1')),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-c2','합성가맹점A','active',jsonb_build_object('source_record_id',' apv-1 ')),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-c3','합성가맹점A','active',jsonb_build_object('source_record_id',E'\tapv-1\n')),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-c4','합성가맹점A','archived',jsonb_build_object('source_record_id','apv-1')),
 ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-c5','합성가맹점A','active',jsonb_build_object('source_record_id','apv-12')),
 ('00000000-0000-4000-8000-0000000000b1','transaction','test-only-sup-c6','합성가맹점B','active',jsonb_build_object('source_record_id','apv-1'));

set local role service_role;
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 res jsonb; got text[]; v_known jsonb; v_known2 jsonb;
begin
 if public.dashboard_norm_id(E'\tapv-1\n') <> 'apv-1' then raise exception '⑧ tab/newline'; end if;
 if public.dashboard_norm_id(E' apv-1　') <> 'apv-1' then raise exception '⑧ nbsp/ideographic'; end if;
 if public.dashboard_norm_id(' apv-1 ') <> 'apv-1' then raise exception '⑧ space'; end if;
 if public.dashboard_norm_id(E'﻿   apv-1  \r\u000b\u000c') <> 'apv-1' then raise exception '⑧ other set members'; end if;
 if public.dashboard_norm_id(' apv 1 ') <> 'apv 1' then raise exception '⑧ inner space removed'; end if;
 if public.dashboard_norm_id(E'apv 1') <> E'apv 1' then raise exception '⑧ inner nbsp removed'; end if;
 if public.dashboard_norm_id(E'​apv-1') <> E'​apv-1' then raise exception '⑧ U+200B is not in the set'; end if;
 if public.dashboard_norm_id(null) is not null then raise exception '⑧ null'; end if;

 res := public.dashboard_ingest_candidates(a, array[E'apv-1\r'], null, 500);
 select array_agg(x->>'external_id' order by x->>'external_id') into got from jsonb_array_elements(res->'rows') x;
 if got is distinct from array['test-only-sup-c1','test-only-sup-c2','test-only-sup-c3'] then raise exception '⑧ candidates %', got; end if;
 if res->'next_after' <> 'null'::jsonb then raise exception '⑧ next_after %', res->'next_after'; end if;
 res := public.dashboard_ingest_candidates(a, array['apv-1'], null, 2);
 if jsonb_array_length(res->'rows') <> 2 or res->'next_after' = 'null'::jsonb then raise exception '⑧ candidates paging %', res; end if;
 res := public.dashboard_ingest_candidates(a, array['apv-1'], (res->>'next_after')::uuid, 2);
 if jsonb_array_length(res->'rows') <> 1 or res->'next_after' <> 'null'::jsonb then raise exception '⑧ candidates page 2 %', res; end if;

 -- ⑨ commit 후보 확인도 같은 규칙
 select jsonb_agg(jsonb_build_object('id', d.id, 'updated_at', d.updated_at)) into v_known
  from public.dashboard_items d where d.user_id=a and d.external_id in ('test-only-sup-c1','test-only-sup-c2','test-only-sup-c3');
 select jsonb_agg(jsonb_build_object('id', d.id, 'updated_at', d.updated_at)) into v_known2
  from public.dashboard_items d where d.user_id=a and d.external_id in ('test-only-sup-c1','test-only-sup-c2');
 res := public.dashboard_ingest_commit(a,
  '[{"kind":"task","external_id":"test-only-sup-k2","title":"친구A 할 일 k2"}]'::jsonb,
  '[{"kind":"task","external_id":"test-only-sup-k2","updated_at":null}]'::jsonb,
  array[' apv-1'], v_known2, null);
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception '⑨ missing known passed: %', res; end if;
 if exists (select 1 from public.dashboard_items where external_id='test-only-sup-k2') then raise exception '⑨ written on conflict'; end if;
 res := public.dashboard_ingest_commit(a,
  '[{"kind":"task","external_id":"test-only-sup-k1","title":"친구A 할 일 k1"}]'::jsonb,
  '[{"kind":"task","external_id":"test-only-sup-k1","updated_at":null}]'::jsonb,
  array[' apv-1'], v_known, null);
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 then raise exception '⑨ full known failed: %', res; end if;
end $$;
reset role;

rollback;

do $$
begin
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-sup-%') then raise exception '1부 rows left'; end if;
end $$;

-- ───────── 2부: 다른 연결의 커밋 함수가 표를 잠근 동안 메모 갱신은 기다리고, 끝나면 그 결과 위에 memo 만 더한다 ─────────
create extension if not exists dblink;

-- 연결: 75_ingest_concurrency 와 같은 방법(소켓 → CI 서비스 전용 비밀번호로 TCP)
do $$
begin
 begin
  perform dblink_connect('c2', 'dbname='||current_database()||' user=postgres');
 exception when others then
  perform dblink_connect('c2', 'host=127.0.0.1 dbname='||current_database()||' user=postgres password=postgres');
 end;
end $$;

select dblink_exec('c2', $q$insert into public.dashboard_items(user_id,kind,external_id,title,metadata)
 values ('00000000-0000-4000-8000-0000000000a1','transaction','test-only-sup-lock','합성가맹점L','{"keep":1}')$q$) is not null as prepared \gset

-- c2: 커밋 함수로 ingest_key 를 더하고 커밋하지 않는다
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 u timestamptz; v_sql text; res jsonb;
begin
 select updated_at into u from public.dashboard_items where user_id=a and kind='transaction' and external_id='test-only-sup-lock';
 if u is null then raise exception '2부 prepared row not visible'; end if;
 perform dblink_exec('c2', 'begin');
 perform dblink_exec('c2', 'set local role service_role');
 v_sql := format('select public.dashboard_ingest_commit(%L::uuid, %L::jsonb, %L::jsonb, null::text[], null::jsonb, null::jsonb)',
  a,
  '[{"kind":"transaction","external_id":"test-only-sup-lock","title":"합성가맹점L","metadata":{"keep":1,"ingest_key":"test-only-key"}}]',
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-sup-lock','updated_at',u)));
 select t.r into res from dblink('c2', v_sql) as t(r jsonb);
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 then raise exception '2부 c2 commit call %', res; end if;
end $$;

-- 메인: 메모 갱신이 표 잠금을 기다린다 → lock_timeout 55P03
begin;
set local role authenticated;
set local lock_timeout = '1s';
do $$
declare caught boolean := false; v_id uuid;
begin
 perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
 select id into v_id from public.dashboard_items where external_id='test-only-sup-lock';
 if v_id is null then raise exception '2부 row not visible to A'; end if;
 begin
  perform public.dashboard_item_set_memo(v_id, '친구A 메모');
 exception when sqlstate '55P03' then caught := true;
 end;
 if not caught then raise exception '2부 set_memo did not wait for the table lock'; end if;
end $$;
rollback;

select dblink_exec('c2', 'commit') is not null as c2_commit \gset

-- 메인: 커밋된 ingest_key 위에 memo 만 더한다
begin;
set local role authenticated;
do $$
declare v_id uuid; res jsonb;
begin
 perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
 select id into v_id from public.dashboard_items where external_id='test-only-sup-lock';
 res := public.dashboard_item_set_memo(v_id, '친구A 메모');
 if res is null or res->'metadata' <> '{"keep":1,"ingest_key":"test-only-key","memo":"친구A 메모"}'::jsonb then raise exception '2부 metadata %', res->'metadata'; end if;
end $$;
rollback;

-- 정리
select dblink_exec('c2', $q$delete from public.dashboard_items
 where user_id='00000000-0000-4000-8000-0000000000a1' and external_id like 'test-only-sup-%'$q$) is not null as cleaned \gset
select dblink_disconnect('c2') is not null as c2_closed \gset

do $$
begin
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-%') then raise exception 'test-only rows left after support test'; end if;
 if (select count(*) from public.dashboard_items
     where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1')) <> 15
 then raise exception 'seed rows changed'; end if;
 if dblink_get_connections() is not null then raise exception 'dblink connections left open'; end if;
end $$;

reset role;
