-- RLS: 사용자 A 는 자기 행만 읽고 수정한다. B 의 행은 0건으로 보이고 수정도 0건.
-- 데이터 변경은 begin … rollback 안에서만 한다(60_seed_rerun 이 원래 시드 값을 단언).
\set ON_ERROR_STOP on

begin;

-- 전제: 시드가 A·B 대상 행을 만들어 두었다 (슈퍼유저로 확인)
do $$
begin
 if not exists (select 1 from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000a1') then raise exception 'precondition: no rows for user A'; end if;
 if not exists (select 1 from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000b1') then raise exception 'precondition: no rows for user B'; end if;
end $$;

set local role authenticated;

do $$
declare n integer; a uuid:='00000000-0000-4000-8000-0000000000a1'; b uuid:='00000000-0000-4000-8000-0000000000b1';
begin
 perform set_config('request.jwt.claim.sub', a::text, true);
 if auth.uid() is distinct from a then raise exception 'auth.uid() is not A'; end if;

 -- 읽기
 select count(*) into n from public.dashboard_items where user_id=a;
 if n=0 then raise exception 'A cannot read own rows'; end if;
 select count(*) into n from public.dashboard_items where user_id=b;
 if n<>0 then raise exception 'A can read % rows of B', n; end if;
 select count(*) into n from public.dashboard_items where user_id<>a;
 if n<>0 then raise exception 'A can read % foreign rows', n; end if;

 -- 수정
 update public.dashboard_items set title='친구A 수정됨' where user_id=a and external_id='seed-a-task-1';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'A could not update own row (% rows)', n; end if;
 update public.dashboard_items set title='침범' where user_id=b;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'A updated % rows of B', n; end if;

 -- 자기 행을 B 소유로 바꾸는 것도 with check 로 거부된다
 begin
  update public.dashboard_items set user_id=b where user_id=a and external_id='seed-a-task-1';
  raise exception 'A moved own row to B';
 exception when insufficient_privilege then null;
 end;
end $$;

reset role;

-- 슈퍼유저로 확인: B 의 행은 바뀌지 않았다
do $$
begin
 if exists (select 1 from public.dashboard_items where user_id='00000000-0000-4000-8000-0000000000b1' and title='침범') then raise exception 'B rows changed'; end if;
end $$;

rollback;
reset role;
