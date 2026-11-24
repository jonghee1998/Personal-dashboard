-- 수신 커밋 함수의 동시성(두 세션 이상). dblink 로 다른 연결 c2·c3 를 열어 진행 중인 트랜잭션과 경쟁시킨다.
-- 사용자 A, external_id 'test-only-conc-…', source_system 'test-only-conc', run_id 00000000-0000-4000-8000-0000000007cx, 가짜 값만.
-- 다른 연결이 커밋한 행은 파일 끝에서 c2 로 지우고, 남지 않았음을 단언한다. 시드 행은 건드리지 않는다.
\set ON_ERROR_STOP on

create extension if not exists dblink;

-- 연결: 소켓(신뢰 인증) → 실패하면 CI 서비스 전용 비밀번호로 TCP
do $$
declare cn text;
begin
 foreach cn in array array['c2','c3'] loop
  begin
   perform dblink_connect(cn, 'dbname='||current_database()||' user=postgres');
  exception when others then
   perform dblink_connect(cn, 'host=127.0.0.1 dbname='||current_database()||' user=postgres password=postgres');
  end;
 end loop;
end $$;

-- 준비: c2 로 커밋된 행
select dblink_exec('c2', $q$insert into public.dashboard_items(user_id,kind,external_id,title,metadata)
 values ('00000000-0000-4000-8000-0000000000a1','task','test-only-conc-1','합성가맹점C0','{"environment":"development","is_synthetic":true}')$q$) is not null as prepared \gset

-- ⓐ 다른 경로의 진행 중 쓰기를 함수가 기다린다 → lock_timeout 55P03
select dblink_exec('c2', 'begin') is not null as c2_begin \gset
select dblink_exec('c2', $q$update public.dashboard_items set title='합성가맹점C'
 where user_id='00000000-0000-4000-8000-0000000000a1' and external_id='test-only-conc-1'$q$) is not null as c2_update \gset
set lock_timeout = '1s';
do $$
declare caught boolean := false;
begin
 begin
  perform public.dashboard_ingest_commit('00000000-0000-4000-8000-0000000000a1',
   '[{"kind":"task","external_id":"test-only-conc-a","title":"친구A 할 일 a"}]'::jsonb,
   '[{"kind":"task","external_id":"test-only-conc-a","updated_at":null}]'::jsonb, null, null, null);
 exception when sqlstate '55P03' then caught := true;
 end;
 if not caught then raise exception 'ⓐ function did not wait for the in-progress write'; end if;
end $$;
reset lock_timeout;
select dblink_exec('c2', 'rollback') is not null as c2_rollback \gset

-- ⓑ 함수가 잡은 표 잠금을 다른 경로의 쓰기가 기다린다
begin;
set local role service_role;
do $$
declare res jsonb;
begin
 res := public.dashboard_ingest_commit('00000000-0000-4000-8000-0000000000a1',
  '[{"kind":"task","external_id":"test-only-conc-b","title":"친구A 할 일 b"}]'::jsonb,
  '[{"kind":"task","external_id":"test-only-conc-b","updated_at":null}]'::jsonb, null, null, null);
 if res->'ok' <> 'true'::jsonb then raise exception 'ⓑ setup call failed %', res; end if;
end $$;
reset role;
do $$
declare st text; msg text;
begin
 perform dblink_exec('c2', $q$set lock_timeout = '1s'$q$);
 st := dblink_exec('c2', $q$update public.dashboard_items set title='합성가맹점C'
  where user_id='00000000-0000-4000-8000-0000000000a1' and external_id='test-only-conc-1'$q$, false);
 msg := dblink_error_message('c2');
 perform dblink_exec('c2', 'reset lock_timeout');
 if st <> 'ERROR' then raise exception 'ⓑ other writer was not blocked (%)', st; end if;
 if msg not like '%lock timeout%' then raise exception 'ⓑ unexpected error: %', msg; end if;
end $$;
rollback;

do $$
begin
 if exists (select 1 from public.dashboard_items where external_id in ('test-only-conc-a','test-only-conc-b')) then raise exception 'ⓐⓑ rows left'; end if;
 if (select title from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000a1' and external_id='test-only-conc-1') <> '합성가맹점C0'
 then raise exception 'ⓐⓑ blocked write applied'; end if;
end $$;

-- ⓒ 검사 뒤 다른 경로가 커밋 → CONCURRENT_CHANGE, 행은 c2 가 쓴 값
do $$
declare u timestamptz; res jsonb; t text;
begin
 select updated_at into u from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000a1' and kind='task' and external_id='test-only-conc-1';
 perform dblink_exec('c2', $q$update public.dashboard_items set title='합성가맹점C2'
  where user_id='00000000-0000-4000-8000-0000000000a1' and external_id='test-only-conc-1'$q$);
 res := public.dashboard_ingest_commit('00000000-0000-4000-8000-0000000000a1',
  '[{"kind":"task","external_id":"test-only-conc-1","title":"합성가맹점M"}]'::jsonb,
  jsonb_build_array(jsonb_build_object('kind','task','external_id','test-only-conc-1','updated_at',u)), null, null, null);
 if res <> '{"ok":false,"code":"CONCURRENT_CHANGE"}'::jsonb then raise exception 'ⓒ %', res; end if;
 select title into t from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000a1' and kind='task' and external_id='test-only-conc-1';
 if t <> '합성가맹점C2' then raise exception 'ⓒ row overwritten (%)', t; end if;
end $$;

-- ⓓ 같은 run 실제 동시 제출: c2 가 커밋하기 전에 c3 가 같은 run 을 보낸다
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 meta jsonb := '{"environment":"development","is_synthetic":true}';
 pid2 integer; pid3 integer;
 c record; res jsonb; v_sql text; c2_now timestamptz; v_rows jsonb; v_exp jsonb; blocked boolean; n integer;
 it public.dashboard_items%rowtype; sr public.dashboard_sync_runs%rowtype;
begin
 select t.p into pid2 from dblink('c2', 'select pg_backend_pid()') as t(p integer);
 select t.p into pid3 from dblink('c3', 'select pg_backend_pid()') as t(p integer);
 for c in select * from (values
   ('same digest', '00000000-0000-4000-8000-0000000007c1'::uuid, 'test-only-conc-r1',   repeat('d',64), true),
   ('other digest','00000000-0000-4000-8000-0000000007c2'::uuid, 'test-only-conc-r1-2', repeat('e',64), false)
 ) as v(label, run_id, ext, digest3, is_same) loop
  v_rows := jsonb_build_array(jsonb_build_object('kind','task','external_id',c.ext,'title','친구A 할 일 동시','metadata',meta));
  v_exp := jsonb_build_array(jsonb_build_object('kind','task','external_id',c.ext,'updated_at',null));

  perform dblink_exec('c2', 'begin');
  v_sql := format('select public.dashboard_ingest_commit(%L::uuid, %L::jsonb, %L::jsonb, null::text[], null::jsonb, %L::jsonb)',
   a, v_rows, v_exp, jsonb_build_object('run_id',c.run_id,'dataset','tasks','source_system','test-only-conc','status','success',
    'error_code',null,'item_count',1,'payload_digest',repeat('d',64),'source_as_of',null,'collected_at',null));
  select t.r into res from dblink('c2', v_sql) as t(r jsonb);
  if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'false'::jsonb or (res->>'upserted')::int <> 1 then raise exception 'ⓓ % c2 %', c.label, res; end if;
  select t.x into c2_now from dblink('c2', 'select now()') as t(x timestamptz);

  v_sql := format('select public.dashboard_ingest_commit(%L::uuid, %L::jsonb, %L::jsonb, null::text[], null::jsonb, %L::jsonb)',
   a, v_rows, v_exp, jsonb_build_object('run_id',c.run_id,'dataset','tasks','source_system','test-only-conc','status','success',
    'error_code',null,'item_count',1,'payload_digest',c.digest3,'source_as_of',null,'collected_at',null));
  if dblink_send_query('c3', v_sql) <> 1 then raise exception 'ⓓ % send to c3 failed', c.label; end if;

  blocked := false;
  for i in 1..50 loop
   if pid2 = any(pg_blocking_pids(pid3)) then blocked := true; exit; end if;
   perform pg_sleep(0.1);
  end loop;
  if not blocked then raise exception 'ⓓ % c3 was not blocked by c2', c.label; end if;

  perform dblink_exec('c2', 'commit');
  select t.r into res from dblink_get_result('c3') as t(r jsonb);
  perform * from dblink_get_result('c3') as t(r jsonb);

  if c.is_same then
   if res->'ok' <> 'true'::jsonb or res->'idempotent' <> 'true'::jsonb or res->'items' <> '[]'::jsonb or (res->>'upserted')::int <> 0
   then raise exception 'ⓓ % c3 not idempotent: %', c.label, res; end if;
  else
   if res <> '{"ok":false,"code":"RUN_ID_CONFLICT"}'::jsonb then raise exception 'ⓓ % c3 not conflict: %', c.label, res; end if;
  end if;

  select count(*) into n from public.dashboard_sync_runs where user_id=a and run_id=c.run_id;
  if n <> 1 then raise exception 'ⓓ % expected 1 run row, got %', c.label, n; end if;
  select * into sr from public.dashboard_sync_runs where user_id=a and run_id=c.run_id;
  if sr.commit_source <> 'ingest_v2' or sr.payload_digest <> repeat('d',64) or sr.accepted_count <> 1 then raise exception 'ⓓ % run row wrong', c.label; end if;
  select count(*) into n from public.dashboard_items where user_id=a and external_id=c.ext;
  if n <> 1 then raise exception 'ⓓ % expected 1 item, got %', c.label, n; end if;
  select * into it from public.dashboard_items where user_id=a and external_id=c.ext;
  if it.updated_at <> c2_now or it.created_at <> c2_now then raise exception 'ⓓ % item written twice', c.label; end if;
 end loop;
end $$;

-- ⓔ /api/sync-runs 경로(commit_source 'report')와의 경쟁 → 23505 가 아니라 RUN_ID_CONFLICT
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 r3 uuid := '00000000-0000-4000-8000-0000000007c3';
 pid2 integer; pid3 integer; res jsonb; v_sql text; blocked boolean; n integer;
begin
 select t.p into pid2 from dblink('c2', 'select pg_backend_pid()') as t(p integer);
 select t.p into pid3 from dblink('c3', 'select pg_backend_pid()') as t(p integer);
 perform dblink_exec('c2', 'begin');
 perform dblink_exec('c2', format($q$insert into public.dashboard_sync_runs(user_id,run_id,dataset,source_system,status,expected_count,received_count,accepted_count,payload_digest)
  values (%L,%L,'tasks','test-only-conc','success',1,1,1,%L)$q$, a, r3, repeat('f',64)));

 v_sql := format('select public.dashboard_ingest_commit(%L::uuid, %L::jsonb, %L::jsonb, null::text[], null::jsonb, %L::jsonb)',
  a, '[{"kind":"task","external_id":"test-only-conc-e1","title":"친구A 할 일 e"}]',
  '[{"kind":"task","external_id":"test-only-conc-e1","updated_at":null}]',
  jsonb_build_object('run_id',r3,'dataset','tasks','source_system','test-only-conc','status','success',
   'error_code',null,'item_count',1,'payload_digest',repeat('f',64),'source_as_of',null,'collected_at',null));
 if dblink_send_query('c3', v_sql) <> 1 then raise exception 'ⓔ send to c3 failed'; end if;

 blocked := false;
 for i in 1..50 loop
  if pid2 = any(pg_blocking_pids(pid3)) then blocked := true; exit; end if;
  perform pg_sleep(0.1);
 end loop;
 if not blocked then raise exception 'ⓔ c3 was not blocked by c2'; end if;

 perform dblink_exec('c2', 'commit');
 select t.r into res from dblink_get_result('c3') as t(r jsonb);
 perform * from dblink_get_result('c3') as t(r jsonb);
 if res <> '{"ok":false,"code":"RUN_ID_CONFLICT"}'::jsonb then raise exception 'ⓔ c3 %', res; end if;

 if exists (select 1 from public.dashboard_items where external_id='test-only-conc-e1') then raise exception 'ⓔ item written'; end if;
 select count(*) into n from public.dashboard_sync_runs where user_id=a and run_id=r3;
 if n <> 1 then raise exception 'ⓔ expected 1 run row, got %', n; end if;
 if (select commit_source from public.dashboard_sync_runs where user_id=a and run_id=r3) <> 'report' then raise exception 'ⓔ run row replaced'; end if;
end $$;

-- 정리: 이 파일이 다른 연결로 커밋한 test-only 행·실행 기록을 지우고 연결을 닫는다
select dblink_exec('c2', $q$delete from public.dashboard_items
 where user_id='00000000-0000-4000-8000-0000000000a1' and external_id like 'test-only-conc-%'$q$) is not null as cleaned_items \gset
select dblink_exec('c2', $q$delete from public.dashboard_sync_runs
 where user_id='00000000-0000-4000-8000-0000000000a1' and source_system='test-only-conc'$q$) is not null as cleaned_runs \gset
select dblink_disconnect('c2') is not null as c2_closed \gset
select dblink_disconnect('c3') is not null as c3_closed \gset

do $$
begin
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-%') then raise exception 'test-only rows left after concurrency test'; end if;
 if exists (select 1 from public.dashboard_sync_runs where source_system like 'test-only-%' or run_id::text like '00000000-0000-4000-8000-0000000007%')
 then raise exception 'test-only sync runs left after concurrency test'; end if;
 if (select count(*) from public.dashboard_items
     where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1')) <> 15
 then raise exception 'seed rows changed'; end if;
 if dblink_get_connections() is not null then raise exception 'dblink connections left open'; end if;
end $$;

reset role;
