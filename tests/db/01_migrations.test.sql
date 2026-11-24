-- 일회용 테스트 DB 전용. tests/db/auth-stub.sql → supabase/migrations/*.sql(이름순) 적용 뒤 실행된다.
-- 마이그레이션들이 만든 테이블·트리거·정책·함수·권한이 있는지 확인한다. 없으면 raise.
\set ON_ERROR_STOP on

do $$
declare t text; p record;
begin
 -- 테이블 3개 + RLS 켜짐
 foreach t in array array['dashboard_items','dashboard_sync_runs','dashboard_backfill_batches'] loop
  if to_regclass('public.'||t) is null then raise exception 'missing table public.%', t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t)) then raise exception 'RLS disabled on public.%', t; end if;
 end loop;

 -- 수정 시각 트리거
 if not exists (
  select 1 from pg_trigger
  where tgrelid='public.dashboard_items'::regclass and tgname='dashboard_items_updated_at' and not tgisinternal
    and tgfoid='public.set_updated_at()'::regprocedure
 ) then raise exception 'missing trigger dashboard_items_updated_at'; end if;

 -- 정책
 for p in select * from (values
   ('dashboard_items','read own items','r'),
   ('dashboard_items','update own items','w'),
   ('dashboard_sync_runs','read own sync runs','r')
 ) as v(tbl,pol,cmd) loop
  if not exists (
   select 1 from pg_policy where polrelid=('public.'||p.tbl)::regclass and polname=p.pol and polcmd::text=p.cmd
     and polroles @> array[(select oid from pg_roles where rolname='authenticated')]
  ) then raise exception 'missing policy "%" on public.%', p.pol, p.tbl; end if;
 end loop;

 -- 백필 함수 3개
 if to_regprocedure('public.dashboard_backfill_inventory(uuid)') is null
  or to_regprocedure('public.dashboard_backfill_apply(uuid,uuid,text,integer)') is null
  or to_regprocedure('public.dashboard_backfill_rollback(uuid,uuid,text)') is null
 then raise exception 'missing backfill function'; end if;

 -- 수신 커밋 함수 + 실행 기록 commit_source 열
 if to_regprocedure('public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)') is null then raise exception 'missing ingest commit function'; end if;
 if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='dashboard_sync_runs' and column_name='commit_source' and is_nullable='NO' and column_default like '''report''%'
 ) then raise exception 'missing dashboard_sync_runs.commit_source'; end if;
 if has_function_privilege('authenticated','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute')
  or has_function_privilege('anon','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute')
 then raise exception 'client can run ingest commit'; end if;
 if not has_function_privilege('service_role','public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)','execute') then raise exception 'service_role cannot run ingest commit'; end if;

 -- 수신 지원 함수(메모 원자 갱신·페이지 조회·원천ID 정규화)
 if to_regprocedure('public.dashboard_item_set_memo(uuid,text)') is null then raise exception 'missing set memo function'; end if;
 if to_regprocedure('public.dashboard_ingest_existing(uuid,text[],uuid,integer)') is null then raise exception 'missing ingest existing function'; end if;
 if to_regprocedure('public.dashboard_ingest_candidates(uuid,text[],uuid,integer)') is null then raise exception 'missing ingest candidates function'; end if;
 if to_regprocedure('public.dashboard_norm_id(text)') is null then raise exception 'missing norm id function'; end if;
 if has_function_privilege('anon','public.dashboard_item_set_memo(uuid,text)','execute') then raise exception 'anon can set memo'; end if;
 if has_function_privilege('authenticated','public.dashboard_ingest_existing(uuid,text[],uuid,integer)','execute')
  or has_function_privilege('authenticated','public.dashboard_ingest_candidates(uuid,text[],uuid,integer)','execute')
 then raise exception 'client can run ingest lookup'; end if;

 -- auth-stub 의 기본 권한 뒤에도 마이그레이션 안의 revoke 가 효과를 낸다
 if not has_table_privilege('authenticated','public.dashboard_items','select') then raise exception 'default privilege not applied'; end if;
 if not has_table_privilege('authenticated','public.dashboard_sync_runs','select') then raise exception 'sync runs not readable'; end if;
 if has_table_privilege('authenticated','public.dashboard_sync_runs','insert')
  or has_table_privilege('anon','public.dashboard_sync_runs','update')
 then raise exception 'client can write sync runs'; end if;
 if has_table_privilege('authenticated','public.dashboard_backfill_batches','select')
  or has_table_privilege('anon','public.dashboard_backfill_batches','select')
 then raise exception 'client can read backfill batches'; end if;
 if not has_table_privilege('service_role','public.dashboard_backfill_batches','insert') then raise exception 'service_role cannot stage backfill'; end if;
 if has_function_privilege('authenticated','public.dashboard_backfill_apply(uuid,uuid,text,integer)','execute')
  or has_function_privilege('anon','public.dashboard_backfill_rollback(uuid,uuid,text)','execute')
 then raise exception 'client can run backfill'; end if;
 if not has_function_privilege('service_role','public.dashboard_backfill_apply(uuid,uuid,text,integer)','execute') then raise exception 'service_role cannot apply'; end if;

 -- auth.uid() 흉내: 설정 없으면 null, sub 가 있으면 그 uuid
 if auth.uid() is not null then raise exception 'auth.uid() should be null without claim'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
 if auth.uid() is distinct from '00000000-0000-4000-8000-0000000000a1'::uuid then raise exception 'auth.uid() ignores claim'; end if;
 perform set_config('request.jwt.claim.sub','',true);
end $$;
