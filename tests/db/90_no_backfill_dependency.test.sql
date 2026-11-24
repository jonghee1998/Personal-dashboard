-- 백필 비의존 확인: 20261112000200_atomic_backfill.sql 을 빼고 나머지 마이그레이션만 새 DB 에 적용해도
-- 뒤 마이그레이션(4·5번)이 적용되고 수신 커밋·메모 갱신이 동작하는지 확인한다. 가짜 값만.
--
-- 안전 규칙
--  (가) 실행 대상 제한: GITHUB_ACTIONS 가 'true' 가 아니면(로컬 실행) 아무것도 만들지 않고 건너뛴다.
--      'true' 인데 현재 DB 가 'app_test'(CI db 잡의 일회용 postgres 서비스 컨테이너, .github/workflows/ci.yml)
--      가 아니면 실패시켜 CI 에서 검사가 조용히 건너뛰어지지 않게 한다.
--      이 서비스 컨테이너는 잡이 끝나면 통째로 버려지므로, 중간 실패로 파일 끝의 DROP 에 못 가도
--      남는 DB 는 그 컨테이너와 함께 사라진다.
--  (나) 고유 이름: 'nobackfill_' || 시각(마이크로초) || '_' || 백엔드 PID. 같은 이름이 이미 있으면 실패(DROP IF EXISTS 안 씀).
--  (다) 정리: 원래 DB 로 돌아간 뒤 이 실행이 만든 그 이름의 DB 만 drop 한다.
--
-- 적용 목록(백필 파일 제외, 이름순). 새 마이그레이션을 추가하면 이 목록도 갱신한다.
\set ON_ERROR_STOP on

-- (가) 실행 대상 제한. \getenv 는 환경 변수가 없으면 변수를 바꾸지 않으므로 먼저 빈 값으로 둔다.
\set gha ''
\getenv gha GITHUB_ACTIONS
select (:'gha' = 'true') as nobackfill_is_ci \gset
\if :nobackfill_is_ci
\else
\echo '일회용 CI 에서만 실행 — 건너뜀'
\quit
\endif

do $$
begin
 if current_database() <> 'app_test' then
  raise exception '90: CI 에서는 일회용 DB app_test 에서만 실행한다 (current_database=%)', current_database();
 end if;
end $$;

\set ORIG :DBNAME

-- (나) 고유 이름
select 'nobackfill_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS') || '_' || pg_backend_pid() as nobackfill_db \gset
select exists (select 1 from pg_database where datname = :'nobackfill_db') as nobackfill_db_exists \gset
\if :nobackfill_db_exists
do $$ begin raise exception '90: test database name already exists'; end $$;
\endif

create database :"nobackfill_db";
\c :nobackfill_db
\set ON_ERROR_STOP on

\i tests/db/auth-stub.sql
\i supabase/migrations/20261112000000_baseline.sql
\i supabase/migrations/20261112000100_sync_runs.sql
\i supabase/migrations/20261124000000_ingest_commit.sql
\i supabase/migrations/20261124000100_ingest_support.sql

-- 단언 1: 백필 표 없음, 수신 함수 5개 있음
do $$
declare f text;
begin
 if to_regclass('public.dashboard_backfill_batches') is not null then raise exception '90: backfill table exists'; end if;
 foreach f in array array['public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)',
                          'public.dashboard_ingest_existing(uuid,text[],uuid,integer)',
                          'public.dashboard_ingest_candidates(uuid,text[],uuid,integer)',
                          'public.dashboard_item_set_memo(uuid,text)',
                          'public.dashboard_norm_id(text)'] loop
  if to_regprocedure(f) is null then raise exception '90: missing function %', f; end if;
 end loop;
end $$;

-- 단언 2·3 은 한 트랜잭션(begin … rollback) 안에서. 새 DB 는 끝에서 통째로 지운다.
begin;

-- 단언 2: 가짜 사용자 A, service_role 로 새 행 1개 + 실행 기록
insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000a1');

set local role service_role;
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 run1 uuid := '00000000-0000-4000-8000-000000000901';
 res jsonb; n integer;
begin
 res := public.dashboard_ingest_commit(a,
  '[{"kind":"transaction","external_id":"test-only-nobf-1","title":"합성가맹점A","metadata":{"environment":"development","is_synthetic":true}}]'::jsonb,
  '[{"kind":"transaction","external_id":"test-only-nobf-1","updated_at":null}]'::jsonb,
  null, null,
  jsonb_build_object('run_id', run1, 'dataset', 'transactions', 'source_system', 'test-only-nobf',
   'status', 'success', 'error_code', null, 'item_count', 1, 'payload_digest', repeat('a',64)));
 if res->'ok' <> 'true'::jsonb or (res->>'upserted')::int <> 1 then raise exception '90: ingest commit %', res; end if;
 select count(*) into n from public.dashboard_sync_runs where user_id=a and run_id=run1;
 if n <> 1 then raise exception '90: expected 1 run row, got %', n; end if;
 select count(*) into n from public.dashboard_items where user_id=a and kind='transaction' and external_id='test-only-nobf-1';
 if n <> 1 then raise exception '90: expected 1 item, got %', n; end if;
end $$;
reset role;

-- 단언 3: authenticated + jwt sub A 로 그 행에 메모
set local role authenticated;
do $$
declare
 a uuid := '00000000-0000-4000-8000-0000000000a1';
 v_id uuid; res jsonb; m jsonb;
begin
 perform set_config('request.jwt.claim.sub', a::text, true);
 select id into v_id from public.dashboard_items where user_id=a and external_id='test-only-nobf-1';
 if v_id is null then raise exception '90: row not visible to A'; end if;
 res := public.dashboard_item_set_memo(v_id, '친구A 메모');
 if res is null then raise exception '90: set memo returned null'; end if;
 select metadata into m from public.dashboard_items where id=v_id;
 if m->>'memo' is distinct from '친구A 메모' then raise exception '90: memo not stored %', m; end if;
end $$;
reset role;

rollback;

-- (다) 정리: 원래 DB 로 돌아가 이 실행이 만든 DB 만 지운다
\c :ORIG
\set ON_ERROR_STOP on
drop database :"nobackfill_db";
do $$ begin raise notice '90_no_backfill_dependency: ok'; end $$;
reset role;
