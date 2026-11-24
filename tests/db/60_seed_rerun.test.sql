-- 시드 재적용: supabase/seed.sql 을 한 번 더 적용해도 성공하고, 고정 키별 행이 1개이며 값이 시드 값 그대로다.
-- 앞의 테스트들은 데이터를 rollback 으로 되돌리므로 여기서 원래 시드 값을 단언할 수 있다.
-- CI 는 저장소 루트에서 psql 을 실행하므로 \i 경로는 루트 기준이다.
\set ON_ERROR_STOP on
\i supabase/seed.sql

do $$
declare e record; n integer; r public.dashboard_items%rowtype;
begin
 if (select count(*) from auth.users where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1'))<>2 then
  raise exception 'seed users missing or duplicated';
 end if;

 for e in select v.user_id::uuid as user_id, v.kind, v.external_id, v.title, v.amount::numeric as amount, v.status from (values
   ('00000000-0000-4000-8000-0000000000a1','transaction','seed-a-transaction-1','합성가맹점A',4500.00,'done'),
   ('00000000-0000-4000-8000-0000000000a1','transaction','seed-a-transaction-2','합성가맹점B',8900.00,'done'),
   ('00000000-0000-4000-8000-0000000000a1','settlement','seed-a-settlement-1','친구A 정산',3000.00,'pending'),
   ('00000000-0000-4000-8000-0000000000a1','news','seed-a-news-1','합성뉴스A',null,'active'),
   ('00000000-0000-4000-8000-0000000000a1','benefit','seed-a-benefit-1','합성혜택A',null,'active'),
   ('00000000-0000-4000-8000-0000000000a1','task','seed-a-task-1','친구A에게 연락하기',null,'pending'),
   ('00000000-0000-4000-8000-0000000000a1','event','seed-a-event-1','친구A 약속',null,'active'),
   ('00000000-0000-4000-8000-0000000000a1','journal','seed-a-journal-1','합성일기A',null,'active'),
   ('00000000-0000-4000-8000-0000000000b1','transaction','seed-b-transaction-1','합성가맹점C',2500.00,'done'),
   ('00000000-0000-4000-8000-0000000000b1','settlement','seed-b-settlement-1','친구B 정산',1500.00,'pending'),
   ('00000000-0000-4000-8000-0000000000b1','news','seed-b-news-1','합성뉴스B',null,'active'),
   ('00000000-0000-4000-8000-0000000000b1','benefit','seed-b-benefit-1','합성혜택B',null,'active'),
   ('00000000-0000-4000-8000-0000000000b1','task','seed-b-task-1','친구B에게 연락하기',null,'pending'),
   ('00000000-0000-4000-8000-0000000000b1','event','seed-b-event-1','친구B 약속',null,'active'),
   ('00000000-0000-4000-8000-0000000000b1','journal','seed-b-journal-1','합성일기B',null,'active')
 ) as v(user_id,kind,external_id,title,amount,status) loop
  select count(*) into n from public.dashboard_items where user_id=e.user_id and kind=e.kind and external_id=e.external_id;
  if n<>1 then raise exception 'seed key %/% has % rows', e.kind, e.external_id, n; end if;
  select * into r from public.dashboard_items where user_id=e.user_id and kind=e.kind and external_id=e.external_id;
  if r.title<>e.title or r.amount is distinct from e.amount or r.status<>e.status then
   raise exception 'seed row % changed (title %, amount %, status %)', e.external_id, r.title, r.amount, r.status;
  end if;
  if r.metadata->>'environment' is distinct from 'development' or r.metadata->'is_synthetic' is distinct from 'true'::jsonb then
   raise exception 'seed row % is not marked synthetic development', e.external_id;
  end if;
 end loop;

 -- 시드 외 행이 남아 있지 않다(앞 테스트의 test-only 행 누수 없음)
 select count(*) into n from public.dashboard_items
  where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');
 if n<>15 then raise exception 'expected 15 seed rows, got %', n; end if;
 if exists (select 1 from public.dashboard_items where external_id like 'test-only-%') then raise exception 'test-only rows leaked'; end if;

 select count(*) into n from public.dashboard_sync_runs
  where user_id='00000000-0000-4000-8000-0000000000a1' and run_id='00000000-0000-4000-8000-00000000c001'
    and dataset='transactions' and source_system='seed';
 if n<>1 then raise exception 'seed sync run has % rows', n; end if;
 if exists (select 1 from public.dashboard_sync_runs where source_system like 'test-only-%') then raise exception 'test-only sync runs leaked'; end if;
end $$;

reset role;
