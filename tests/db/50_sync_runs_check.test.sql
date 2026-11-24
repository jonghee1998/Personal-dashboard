-- dashboard_sync_runs 체크 제약: 위반 insert 는 SQLSTATE 23514 로 거부된다. 다른 오류는 실패.
\set ON_ERROR_STOP on

begin;

do $$
declare
 a uuid:='00000000-0000-4000-8000-0000000000a1';
 c record;
begin
 for c in select * from (values
   ('bad dataset',          'not-a-dataset', 'success', 0, 0, 0, null::timestamptz, null::timestamptz),
   ('bad status',           'tasks',         'unknown', 0, 0, 0, null, null),
   ('negative count',       'tasks',         'success', -1, 0, 0, null, null),
   ('accepted+rejected>recv','tasks',        'success', 1, 1, 1, null, null),
   ('as_of after collected','tasks',         'success', 0, 0, 0, '2026-11-10T01:00:00Z', '2026-11-10T00:00:00Z')
 ) as v(label,dataset,status,received,accepted,rejected,as_of,collected) loop
  begin
   insert into public.dashboard_sync_runs(user_id,run_id,dataset,source_system,status,received_count,accepted_count,rejected_count,source_as_of,collected_at)
   values (a,gen_random_uuid(),c.dataset,'test-only-check',c.status,c.received,c.accepted,c.rejected,c.as_of,c.collected);
   raise exception 'check constraint not enforced: %', c.label;
  exception when sqlstate '23514' then null;
  end;
 end loop;
end $$;

rollback;
reset role;
