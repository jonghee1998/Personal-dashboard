-- set_updated_at 트리거: update 하면 updated_at 이 갱신된다.
-- 같은 트랜잭션 안에서 now() 는 고정이므로, updated_at 을 과거 시각으로 넣고 update 뒤 그보다 커졌는지 본다.
\set ON_ERROR_STOP on

begin;

do $$
declare past timestamptz:=now()-interval '1 day'; after_ts timestamptz; a uuid:='00000000-0000-4000-8000-0000000000a1';
begin
 insert into public.dashboard_items(user_id,kind,external_id,title,metadata,updated_at)
 values (a,'task','test-only-trigger-1','친구A 트리거','{"environment":"development","is_synthetic":true}',past);

 select updated_at into after_ts from public.dashboard_items where user_id=a and kind='task' and external_id='test-only-trigger-1';
 if after_ts<>past then raise exception 'insert did not keep explicit updated_at'; end if;

 update public.dashboard_items set title='친구A 트리거 수정' where user_id=a and kind='task' and external_id='test-only-trigger-1';

 select updated_at into after_ts from public.dashboard_items where user_id=a and kind='task' and external_id='test-only-trigger-1';
 if not (after_ts>past) then raise exception 'updated_at not advanced (% <= %)', after_ts, past; end if;
end $$;

rollback;
reset role;
