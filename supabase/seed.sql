-- 개발·테스트 DB 전용 가짜 시드. 운영 DB 에 적용하지 않는다. (DEV/TEST ONLY — never apply to production.)
-- 모든 값은 누가 봐도 가짜다(친구A·합성가맹점A 등). metadata.environment='development', is_synthetic=true.
-- 빈 DB 와 재실행 모두 성공한다: 모든 insert 는 충돌 시 do nothing.
-- 사용자 A = 00000000-0000-4000-8000-0000000000a1, 사용자 B = 00000000-0000-4000-8000-0000000000b1
\set ON_ERROR_STOP on

begin;

insert into auth.users(id) values
 ('00000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000b1')
on conflict do nothing;

insert into public.dashboard_items(user_id,kind,external_id,title,description,amount,status,category,source,event_date,due_date,metadata)
select v.user_id::uuid, v.kind, v.external_id, v.title, v.description, v.amount, v.status, v.category, 'seed',
       v.event_date::date, v.due_date::date,
       '{"environment":"development","is_synthetic":true,"source_system":"seed"}'::jsonb
from (values
 -- 사용자 A
 ('00000000-0000-4000-8000-0000000000a1','transaction','seed-a-transaction-1','합성가맹점A','가짜 결제 1',4500.00,'done','식비','2026-11-01',null),
 ('00000000-0000-4000-8000-0000000000a1','transaction','seed-a-transaction-2','합성가맹점B','가짜 결제 2',8900.00,'done','생활','2026-11-02',null),
 ('00000000-0000-4000-8000-0000000000a1','settlement','seed-a-settlement-1','친구A 정산','가짜 정산',3000.00,'pending','정산','2026-11-03',null),
 ('00000000-0000-4000-8000-0000000000a1','news','seed-a-news-1','합성뉴스A','가짜 뉴스',null,'active','뉴스','2026-11-04',null),
 ('00000000-0000-4000-8000-0000000000a1','benefit','seed-a-benefit-1','합성혜택A','가짜 혜택',null,'active','혜택',null,'2026-12-31'),
 ('00000000-0000-4000-8000-0000000000a1','task','seed-a-task-1','친구A에게 연락하기','가짜 할 일',null,'pending','할 일',null,'2026-11-30'),
 ('00000000-0000-4000-8000-0000000000a1','event','seed-a-event-1','친구A 약속','가짜 일정',null,'active','일정','2026-11-20',null),
 ('00000000-0000-4000-8000-0000000000a1','journal','seed-a-journal-1','합성일기A','가짜 기록',null,'active','기록','2026-11-05',null),
 -- 사용자 B
 ('00000000-0000-4000-8000-0000000000b1','transaction','seed-b-transaction-1','합성가맹점C','가짜 결제 3',2500.00,'done','식비','2026-11-01',null),
 ('00000000-0000-4000-8000-0000000000b1','settlement','seed-b-settlement-1','친구B 정산','가짜 정산',1500.00,'pending','정산','2026-11-03',null),
 ('00000000-0000-4000-8000-0000000000b1','news','seed-b-news-1','합성뉴스B','가짜 뉴스',null,'active','뉴스','2026-11-04',null),
 ('00000000-0000-4000-8000-0000000000b1','benefit','seed-b-benefit-1','합성혜택B','가짜 혜택',null,'active','혜택',null,'2026-12-31'),
 ('00000000-0000-4000-8000-0000000000b1','task','seed-b-task-1','친구B에게 연락하기','가짜 할 일',null,'pending','할 일',null,'2026-11-30'),
 ('00000000-0000-4000-8000-0000000000b1','event','seed-b-event-1','친구B 약속','가짜 일정',null,'active','일정','2026-11-21',null),
 ('00000000-0000-4000-8000-0000000000b1','journal','seed-b-journal-1','합성일기B','가짜 기록',null,'active','기록','2026-11-06',null)
) as v(user_id,kind,external_id,title,description,amount,status,category,event_date,due_date)
on conflict (user_id,kind,external_id) do nothing;

insert into public.dashboard_sync_runs(user_id,run_id,dataset,source_system,source_as_of,collected_at,received_at,validated_at,status,verification_level,expected_count,received_count,accepted_count,rejected_count)
values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000c001','transactions','seed',
        '2026-11-10T00:00:00Z','2026-11-10T00:05:00Z','2026-11-10T00:06:00Z','2026-11-10T00:07:00Z',
        'success','unverified',2,2,2,0)
on conflict (user_id,run_id,dataset,source_system) do nothing;

commit;
