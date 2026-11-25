-- 클라이언트(authenticated)는 dashboard_sync_runs 에 쓸 수 없다.
\set ON_ERROR_STOP on

-- 권한 회수가 실제로 효과를 냈는지 먼저 확인
do $$
begin
 if has_table_privilege('authenticated','public.dashboard_sync_runs','INSERT') then raise exception 'authenticated still has INSERT on dashboard_sync_runs'; end if;
end $$;

begin;
set local role authenticated;

do $$
begin
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
 begin
  insert into public.dashboard_sync_runs(user_id,run_id,dataset,source_system,status)
  values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000d001','tasks','test-only-client','success');
  raise exception 'authenticated insert into dashboard_sync_runs succeeded';
 exception when sqlstate '42501' then null; -- 다른 오류는 그대로 올라가 실패한다
 end;
end $$;

rollback;
reset role;
