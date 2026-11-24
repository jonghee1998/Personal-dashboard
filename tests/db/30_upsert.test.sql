-- (user_id, kind, external_id) 충돌 시 갱신되고 새 행이 생기지 않는다. 시드와 겹치지 않는 test-only 행만 쓰고 rollback.
\set ON_ERROR_STOP on

begin;

do $$
declare n integer; t text; amt numeric; a uuid:='00000000-0000-4000-8000-0000000000a1';
begin
 insert into public.dashboard_items(user_id,kind,external_id,title,amount,metadata)
 values (a,'transaction','test-only-upsert-1','합성가맹점A',1000,'{"environment":"development","is_synthetic":true}');

 insert into public.dashboard_items(user_id,kind,external_id,title,amount,metadata)
 values (a,'transaction','test-only-upsert-1','합성가맹점A 수정',2000,'{"environment":"development","is_synthetic":true}')
 on conflict (user_id,kind,external_id) do update set title=excluded.title, amount=excluded.amount;

 select count(*), max(title), max(amount) into n, t, amt from public.dashboard_items
  where user_id=a and kind='transaction' and external_id='test-only-upsert-1';
 if n<>1 then raise exception 'upsert created % rows', n; end if;
 if t<>'합성가맹점A 수정' or amt<>2000 then raise exception 'upsert did not update (title %, amount %)', t, amt; end if;

 -- 같은 external_id 라도 kind 가 다르면 별개 행
 insert into public.dashboard_items(user_id,kind,external_id,title,metadata)
 values (a,'task','test-only-upsert-1','친구A 할 일','{"environment":"development","is_synthetic":true}')
 on conflict (user_id,kind,external_id) do nothing;
 select count(*) into n from public.dashboard_items where user_id=a and external_id='test-only-upsert-1';
 if n<>2 then raise exception 'expected 2 rows across kinds, got %', n; end if;
end $$;

rollback;
reset role;
