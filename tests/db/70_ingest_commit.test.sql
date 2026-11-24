-- 수신 커밋 함수 dashboard_ingest_commit (한 세션). 데이터 변경은 begin … rollback 안에서만.
-- 사용자 A, external_id 'test-only-ingest-…', run_id 00000000-0000-4000-8000-0000000007xx, 가짜 값만.
\set ON_ERROR_STOP on

begin;
set local role service_role;

do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 b uuid := '00000000-0000-4000-8000-0000000000b1';
 dg text := repeat('a',64);
 dg2 text := repeat('b',64);
 meta jsonb := '{"environment":"development","is_synthetic":true}';
 run1 uuid := '00000000-0000-4000-8000-000000000701';
 run2 uuid := '00000000-0000-4000-8000-000000000702';
 run3 uuid := '00000000-0000-4000-8000-000000000703';
 run4 uuid := '00000000-0000-4000-8000-000000000704';
 run5 uuid := '00000000-0000-4000-8000-000000000705';
 run6 uuid := '00000000-0000-4000-8000-000000000706';
 run7 uuid := '00000000-0000-4000-8000-000000000707';
 run8 uuid := '00000000-0000-4000-8000-000000000708';
 run_base jsonb;
 v_rows jsonb; v_exp jsonb; res jsonb;
 n integer; n_items integer; n_runs integer;
 caught boolean;
 sr public.dashboard_sync_runs%rowtype;
 it public.dashboard_items%rowtype;
 ux timestamptz; uy timestamptz; s_id uuid; s_up timestamptz;
 c record;
begin
 run_base := jsonb_build_object('run_id', run1, 'dataset', 'tasks', 'source_system', 'test-only-ingest',
  'status', 'success', 'error_code', null, 'item_count', 2, 'payload_digest', dg,
  'source_as_of', '2026-11-10T00:00:00Z', 'collected_at', '2026-11-10T00:05:00Z');

 -- ① 새 행 2개 + 실행 기록 success
 v_rows := jsonb_build_array(
  jsonb_build_object('kind','task','external_id','test-only-ingest-1','title','친구A 할 일 1','metadata',meta),
  jsonb_build_object('kind','task','external_id','test-only-ingest-2','title','친구A 할 일 2','metadata',meta));
 v_exp := jsonb_build_array(
  jsonb_build_object('kind','task','external_id','test-only-ingest-1','updated_at',null),
  jsonb_build_object('kind','task','external_id','test-only-ingest-2','updated_at',null));
 res := public.dashboard_ingest_commit(a, v_rows, v_exp, null, null, run_base);
 if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'false'::jsonb or (res->>'upserted')::int <> 2
    or jsonb_array_length(res->'items') <> 2 then raise exception '① unexpected result %', res; end if;
 if res->'run'->>'status' <> 'success' or (res->'run'->>'accepted_count')::int <> 2 then raise exception '① run summary %', res->'run'; end if;
 select count(*) into n from public.dashboard_items where user_id=a and kind='task' and external_id in ('test-only-ingest-1','test-only-ingest-2');
 if n <> 2 then raise exception '① expected 2 items, got %', n; end if;
 select count(*) into n from public.dashboard_sync_runs where user_id=a and run_id=run1;
 if n <> 1 then raise exception '① expected 1 run row, got %', n; end if;
 select * into sr from public.dashboard_sync_runs where user_id=a and run_id=run1 and dataset='tasks' and source_system='test-only-ingest';
 if sr.received_count <> 2 or sr.accepted_count <> 2 or sr.expected_count <> 2 or sr.rejected_count <> 0
    or sr.verification_level <> 'structural_provenance_only' or sr.commit_source <> 'ingest_v2'
    or sr.payload_digest <> dg or sr.status <> 'success' or sr.validated_at is null
 then raise exception '① run row wrong'; end if;

 -- ② 같은 실행·같은 digest 재호출 → idempotent, 쓰기 없음
 select count(*) into n_items from public.dashboard_items;
 res := public.dashboard_ingest_commit(a, v_rows, v_exp, null, null, run_base);
 if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'true'::jsonb or res->'items' <> '[]'::jsonb or (res->>'upserted')::int <> 0
 then raise exception '② unexpected result %', res; end if;
 if (res->'run'->>'accepted_count')::int <> 2 or res->'run'->>'run_id' <> run1::text then raise exception '② run summary %', res->'run'; end if;
 if (select count(*) from public.dashboard_items) <> n_items then raise exception '② items changed'; end if;
 if (select count(*) from public.dashboard_sync_runs where user_id=a and run_id=run1) <> 1 then raise exception '② run rows changed'; end if;

 -- ③ 같은 키에 digest 만 다름 / error_code 만 다름 → RUN_ID_CONFLICT
 res := public.dashboard_ingest_commit(a, v_rows, v_exp, null, null, run_base || jsonb_build_object('payload_digest', dg2));
 if res <> '{"ok":false,"code":"RUN_ID_CONFLICT"}'::jsonb then raise exception '③ digest: %', res; end if;
 res := public.dashboard_ingest_commit(a, v_rows, v_exp, null, null, run_base || jsonb_build_object('error_code', 'TEST_ONLY_CODE'));
 if res <> '{"ok":false,"code":"RUN_ID_CONFLICT"}'::jsonb then raise exception '③ error_code: %', res; end if;
 if (select count(*) from public.dashboard_items) <> n_items then raise exception '③ items changed'; end if;

 -- ④ 같은 run_id 에 dataset 다름 → 별개 실행
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','event','external_id','test-only-ingest-3','title','친구A 약속','metadata',meta)),
  jsonb_build_array(jsonb_build_object('kind','event','external_id','test-only-ingest-3','updated_at',null)),
  null, null, run_base || jsonb_build_object('dataset','events','item_count',1));
 if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'false'::jsonb or (res->>'upserted')::int <> 1 then raise exception '④ %', res; end if;
 if (select count(*) from public.dashboard_sync_runs where user_id=a and run_id=run1) <> 2 then raise exception '④ expected 2 run rows'; end if;

 -- ⑤ failed + 0행 → 실행 기록만
 select count(*) into n_items from public.dashboard_items;
 res := public.dashboard_ingest_commit(a, '[]'::jsonb, '[]'::jsonb, null, null,
  run_base || jsonb_build_object('run_id', run2, 'status','failed', 'error_code','TEST_ONLY_FAIL', 'item_count',0));
 if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'false'::jsonb or (res->>'upserted')::int <> 0 or res->'items' <> '[]'::jsonb then raise exception '⑤ %', res; end if;
 select * into sr from public.dashboard_sync_runs where user_id=a and run_id=run2 and dataset='tasks' and source_system='test-only-ingest';
 if not found then raise exception '⑤ run row missing'; end if;
 if sr.accepted_count <> 0 or sr.received_count <> 0 or sr.expected_count <> 0 or sr.verification_level <> 'unverified'
    or sr.commit_source <> 'ingest_v2' or sr.status <> 'failed' or sr.error_code <> 'TEST_ONLY_FAIL'
 then raise exception '⑤ run row wrong'; end if;
 if (select count(*) from public.dashboard_items) <> n_items then raise exception '⑤ items changed'; end if;

 -- ⑤-2 같은 키에 /api/sync-runs('report') 기록이 있으면 digest 가 같아도 RUN_ID_CONFLICT
 insert into public.dashboard_sync_runs(user_id,run_id,dataset,source_system,status,expected_count,received_count,accepted_count,payload_digest)
 values (a, run3, 'tasks', 'test-only-ingest', 'success', 1, 1, 1, dg);
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-4','title','친구A 할 일 4')),
  jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-4','updated_at',null)),
  null, null, run_base || jsonb_build_object('run_id', run3, 'item_count', 1));
 if res <> '{"ok":false,"code":"RUN_ID_CONFLICT"}'::jsonb then raise exception '⑤-2 %', res; end if;
 if exists (select 1 from public.dashboard_items where external_id='test-only-ingest-4') then raise exception '⑤-2 item written'; end if;
 if (select count(*) from public.dashboard_items) <> n_items then raise exception '⑤-2 items changed'; end if;

 -- ⑤-3 덮어쓰기 방지: v2 가 바꾼 뒤 옛 updated_at 으로 온 v1(p_run NULL) 은 CONCURRENT_CHANGE
 insert into public.dashboard_items(user_id,kind,external_id,title,amount,metadata,updated_at)
 values (a,'transaction','test-only-ingest-x','합성가맹점X',500,meta,now() - interval '1 day');
 select updated_at into ux from public.dashboard_items where user_id=a and kind='transaction' and external_id='test-only-ingest-x';
 if ux <> now() - interval '1 day' then raise exception '⑤-3 setup updated_at not kept'; end if;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-x','title','합성가맹점V2')),
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-x','updated_at',ux)),
  null, null, run_base || jsonb_build_object('run_id', run4, 'dataset','transactions', 'item_count', 1));
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 then raise exception '⑤-3 v2 %', res; end if;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-x','title','합성가맹점V1')),
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-x','updated_at',ux)),
  null, null, null);
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception '⑤-3 v1 %', res; end if;
 select * into it from public.dashboard_items where user_id=a and kind='transaction' and external_id='test-only-ingest-x';
 if it.title <> '합성가맹점V2' or it.amount <> 500 then raise exception '⑤-3 row overwritten (title %)', it.title; end if;

 -- ⑥ 실행 기록 insert 제약 위반(source_as_of > collected_at) → 23514, 같은 호출의 항목도 없음
 select count(*) into n_items from public.dashboard_items;
 select count(*) into n_runs from public.dashboard_sync_runs;
 caught := false;
 begin
  perform public.dashboard_ingest_commit(a,
   jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-6','title','친구A 할 일 6')),
   jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-6','updated_at',null)),
   null, null, run_base || jsonb_build_object('run_id', run5, 'item_count', 1,
     'source_as_of','2026-11-10T01:00:00Z', 'collected_at','2026-11-10T00:00:00Z'));
 exception when sqlstate '23514' then caught := true;
 end;
 if not caught then raise exception '⑥ run constraint not raised'; end if;
 if exists (select 1 from public.dashboard_items where external_id='test-only-ingest-6') then raise exception '⑥ item left'; end if;
 if exists (select 1 from public.dashboard_sync_runs where user_id=a and run_id=run5) then raise exception '⑥ run left'; end if;
 if (select count(*) from public.dashboard_items) <> n_items or (select count(*) from public.dashboard_sync_runs) <> n_runs then raise exception '⑥ counts changed'; end if;

 -- ⑦ 기존 행 갱신: 보낸 키만 바뀌고, 명시적 null 은 null
 insert into public.dashboard_items(user_id,kind,external_id,title,description,amount,metadata)
 values (a,'settlement','test-only-ingest-y','친구A 정산','친구A 메모',1000,meta);
 select updated_at into uy from public.dashboard_items where user_id=a and kind='settlement' and external_id='test-only-ingest-y';
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','title','친구A 정산 수정','amount',2000)),
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','updated_at',uy)),
  null, null, null);
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 or res->'run' <> 'null'::jsonb then raise exception '⑦ %', res; end if;
 select * into it from public.dashboard_items where user_id=a and kind='settlement' and external_id='test-only-ingest-y';
 if it.title <> '친구A 정산 수정' or it.amount <> 2000 or it.description is distinct from '친구A 메모' or it.metadata <> meta
 then raise exception '⑦ partial update wrong'; end if;
 if res->'items'->0->>'id' <> it.id::text or res->'items'->0->>'external_id' <> 'test-only-ingest-y' then raise exception '⑦ items %', res->'items'; end if;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','title','친구A 정산 수정','description',null)),
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','updated_at',it.updated_at)),
  null, null, null);
 if res->'ok' <> 'true'::jsonb then raise exception '⑦ null %', res; end if;
 select * into it from public.dashboard_items where user_id=a and kind='settlement' and external_id='test-only-ingest-y';
 if it.description is not null or it.amount <> 2000 then raise exception '⑦ explicit null not written'; end if;

 -- ⑧ 기대 updated_at 다름 → CONCURRENT_CHANGE, 같은 호출의 새 행·실행 기록 없음
 select count(*) into n_items from public.dashboard_items;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(
   jsonb_build_object('kind','task','external_id','test-only-ingest-8','title','친구A 할 일 8'),
   jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','title','친구A 정산 8')),
  jsonb_build_array(
   jsonb_build_object('kind','task','external_id','test-only-ingest-8','updated_at',null),
   jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','updated_at',now() - interval '1 hour')),
  null, null, run_base || jsonb_build_object('run_id', run6));
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception '⑧ stale %', res; end if;
 if exists (select 1 from public.dashboard_items where external_id='test-only-ingest-8') then raise exception '⑧ new row written'; end if;
 if exists (select 1 from public.dashboard_sync_runs where user_id=a and run_id=run6) then raise exception '⑧ run written'; end if;
 if (select title from public.dashboard_items where user_id=a and kind='settlement' and external_id='test-only-ingest-y') <> '친구A 정산 수정' then raise exception '⑧ row changed'; end if;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','title','친구A 정산 8')),
  jsonb_build_array(jsonb_build_object('kind','settlement','external_id','test-only-ingest-y','updated_at',null)),
  null, null, null);
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception '⑧ expected-null %', res; end if;
 if (select count(*) from public.dashboard_items) <> n_items then raise exception '⑧ items changed'; end if;

 -- ⑨ 원천 거래ID 후보: 보이는 후보는 p_known 에 있어야 하고, archived 행은 후보가 아니다
 insert into public.dashboard_items(user_id,kind,external_id,title,metadata)
 values (a,'transaction','test-only-ingest-s','합성가맹점S', meta || '{"source_record_id":"test-only-src-1"}')
 returning id, updated_at into s_id, s_up;
 insert into public.dashboard_items(user_id,kind,external_id,title,status,metadata)
 values (a,'transaction','test-only-ingest-s-archived','합성가맹점S 보관','archived', meta || '{"source_record_id":"test-only-src-1"}');
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9','title','합성가맹점9')),
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9','updated_at',null)),
  array['test-only-src-1'], jsonb_build_array(jsonb_build_object('id',s_id,'updated_at',s_up)), null);
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 then raise exception '⑨ known %', res; end if;
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9b','title','합성가맹점9b')),
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9b','updated_at',null)),
  array['test-only-src-1'], '[]'::jsonb, null);
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception '⑨ missing known %', res; end if;
 if exists (select 1 from public.dashboard_items where external_id='test-only-ingest-9b') then raise exception '⑨ row written'; end if;
 -- 원천ID 가 없으면 p_known NULL 허용
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9c','title','합성가맹점9c')),
  jsonb_build_array(jsonb_build_object('kind','transaction','external_id','test-only-ingest-9c','updated_at',null)),
  array[]::text[], null, null);
 if res->'ok' <> 'true'::jsonb then raise exception '⑨ empty source ids %', res; end if;

 -- ⑩ 행 JSON 의 user_id 는 무시하고 p_user 가 주인
 res := public.dashboard_ingest_commit(a,
  jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-10','title','친구A 할 일 10','user_id',b)),
  jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-10','updated_at',null)),
  null, null, null);
 if res->'ok' <> 'true'::jsonb then raise exception '⑩ %', res; end if;
 if (select count(*) from public.dashboard_items where external_id='test-only-ingest-10' and user_id=a) <> 1
    or exists (select 1 from public.dashboard_items where external_id='test-only-ingest-10' and user_id=b)
 then raise exception '⑩ owner not forced to p_user'; end if;

 -- ⑪ 두 번째 항목의 제약 위반(status 'bogus') → 23514, 첫 항목과 (f0) 실행 기록도 취소
 select count(*) into n_items from public.dashboard_items;
 select count(*) into n_runs from public.dashboard_sync_runs;
 caught := false;
 begin
  perform public.dashboard_ingest_commit(a,
   jsonb_build_array(
    jsonb_build_object('kind','task','external_id','test-only-ingest-11a','title','친구A 할 일 11a'),
    jsonb_build_object('kind','task','external_id','test-only-ingest-11b','title','친구A 할 일 11b','status','bogus')),
   jsonb_build_array(
    jsonb_build_object('kind','task','external_id','test-only-ingest-11a','updated_at',null),
    jsonb_build_object('kind','task','external_id','test-only-ingest-11b','updated_at',null)),
   null, null, run_base || jsonb_build_object('run_id', run7));
 exception when sqlstate '23514' then caught := true;
 end;
 if not caught then raise exception '⑪ item constraint not raised'; end if;
 if exists (select 1 from public.dashboard_items where external_id in ('test-only-ingest-11a','test-only-ingest-11b')) then raise exception '⑪ items left'; end if;
 if exists (select 1 from public.dashboard_sync_runs where user_id=a and run_id=run7) then raise exception '⑪ run left'; end if;
 if (select count(*) from public.dashboard_items) <> n_items or (select count(*) from public.dashboard_sync_runs) <> n_runs then raise exception '⑪ counts changed'; end if;

 -- ⑫ 입력 오류 → 22023, 쓰기 없음
 v_rows := jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12','title','친구A 할 일 12'));
 v_exp := jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12','updated_at',null));
 for c in select * from (values
   ('p_user null', null::uuid, v_rows, v_exp, null::text[], null::jsonb, null::jsonb),
   ('p_rows null', a, null::jsonb, '[]'::jsonb, null, null, null),
   ('p_rows object', a, '{}'::jsonb, '[]'::jsonb, null, null, null),
   ('empty success', a, '[]'::jsonb, '[]'::jsonb, null, null, run_base || jsonb_build_object('run_id', run8, 'item_count', 0)),
   ('501 rows', a,
     (select jsonb_agg(jsonb_build_object('kind','task','external_id','test-only-ingest-many-'||g,'title','친구A 할 일')) from generate_series(1,501) g),
     (select jsonb_agg(jsonb_build_object('kind','task','external_id','test-only-ingest-many-'||g,'updated_at',null)) from generate_series(1,501) g),
     null, null, null),
   ('title missing', a, jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12')), v_exp, null, null, null),
   ('duplicate row key', a, v_rows || v_rows, v_exp || v_exp, null, null, null),
   ('expected missing key', a,
     v_rows || jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12b','title','친구A 할 일 12b')),
     v_exp, null, null, null),
   ('expected without updated_at', a, v_rows,jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12')), null, null, null),
   ('updated_at not a time', a, v_rows,jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-ingest-12','updated_at','not-a-time')), null, null, null),
   ('known id duplicate', a, v_rows, v_exp,array['test-only-src-z'],
     jsonb_build_array(jsonb_build_object('id',s_id,'updated_at',s_up), jsonb_build_object('id',s_id,'updated_at',s_up)), null),
   ('known id x', a, v_rows, v_exp,array['test-only-src-z'], jsonb_build_array(jsonb_build_object('id','x','updated_at',s_up)), null),
   ('run_id x', a, v_rows, v_exp, null, null, run_base || jsonb_build_object('run_id','x','item_count',1)),
   ('failed with a row', a, v_rows, v_exp,null, null,
     run_base || jsonb_build_object('run_id', run8, 'status','failed', 'error_code','TEST_ONLY_FAIL', 'item_count',1)),
   ('item_count mismatch', a, v_rows, v_exp, null, null, run_base || jsonb_build_object('run_id', run8, 'item_count', 2)),
   ('payload_digest XYZ', a, v_rows, v_exp, null, null, run_base || jsonb_build_object('run_id', run8, 'item_count', 1, 'payload_digest','XYZ'))
 ) as v(label, p_user, p_rows, p_expected, p_source_ids, p_known, p_run) loop
  select count(*) into n_items from public.dashboard_items;
  select count(*) into n_runs from public.dashboard_sync_runs;
  caught := false;
  begin
   perform public.dashboard_ingest_commit(c.p_user, c.p_rows, c.p_expected, c.p_source_ids, c.p_known, c.p_run);
  exception when sqlstate '22023' then caught := true;
  end;
  if not caught then raise exception '⑫ % not rejected with 22023', c.label; end if;
  if (select count(*) from public.dashboard_items) <> n_items or (select count(*) from public.dashboard_sync_runs) <> n_runs
  then raise exception '⑫ % changed rows', c.label; end if;
 end loop;
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-ingest-12%' or external_id like 'test-only-ingest-many-%') then raise exception '⑫ rows left'; end if;
 if exists (select 1 from public.dashboard_sync_runs where user_id=a and run_id=run8) then raise exception '⑫ run left'; end if;
end $$;

rollback;

-- ⑬ 권한: 클라이언트 역할은 실행 불가, service_role 만 실행
do $$
begin
 if has_function_privilege('anon','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute') then raise exception '⑬ anon can execute'; end if;
 if has_function_privilege('authenticated','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute') then raise exception '⑬ authenticated can execute'; end if;
 if not has_function_privilege('service_role','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute') then raise exception '⑬ service_role cannot execute'; end if;
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-ingest-%') then raise exception 'test-only ingest rows leaked'; end if;
end $$;

reset role;
