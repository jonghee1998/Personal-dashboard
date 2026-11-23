-- Disposable PostgreSQL only, never production. Synthetic records.
\set ON_ERROR_STOP on
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
\ir ../supabase/schema.sql
\ir ../supabase/migrations/20261112_atomic_backfill.sql
insert into auth.users values ('00000000-0000-4000-8000-000000000001');
insert into public.dashboard_items(id,user_id,kind,external_id,title,amount,currency,event_date,metadata)
values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','transaction','test-one','Synthetic A',1000,'KRW','2026-11-01','{"memo":"keep me"}'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','transaction','test-two','Synthetic B',2000,'KRW','2026-11-02','{}');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000001'; b uuid; snap jsonb; candidates jsonb; patch jsonb; v jsonb; before1 jsonb; before2 jsonb; digest text:=repeat('a',64);
begin
 if has_function_privilege('authenticated','public.dashboard_backfill_apply(uuid,uuid,text,integer)','execute') then raise exception 'client can apply'; end if;
 if has_function_privilege('anon','public.dashboard_backfill_rollback(uuid,uuid,text)','execute') then raise exception 'anon can rollback'; end if;
 snap:=public.dashboard_backfill_inventory(u);
 before1:=snap->0; before2:=snap->1;
 patch:='{"source_system":"samsungcard","account_key":"opaque-test","billing_month":"2026-11","amount_basis":"purchase_approval","source_record_id_type":"provider","source_record_id":"synthetic-a"}';
 candidates:=jsonb_build_array(jsonb_build_object('id',before1->>'id','external_id',before1->>'external_id','expected_updated_at',before1->>'updated_at','patch',patch));
 insert into public.dashboard_backfill_batches(user_id,plan_digest,inventory_digest,inventory_snapshot,plan_entries,candidates,summary)
 values(u,digest,repeat('b',64),snap,'[]',candidates,'{}') returning id into b;
 -- Wrong count must leave every row untouched.
 begin
  perform public.dashboard_backfill_apply(u,b,digest,2);
  raise exception 'unexpected success';
 exception when sqlstate 'P0001' then
  if sqlerrm<>'BACKFILL_COUNT_MISMATCH' then raise; end if;
 end;
 if public.dashboard_backfill_inventory(u)<>snap then raise exception 'failed apply changed data'; end if;
 v:=public.dashboard_backfill_apply(u,b,digest,1);
 if v->>'applied_count'<>'1' then raise exception 'count'; end if;
 if (public.dashboard_backfill_inventory(u)->0-'metadata'-'updated_at')<>(before1-'metadata'-'updated_at') then raise exception 'business fields changed'; end if;
 if public.dashboard_backfill_inventory(u)->0->'metadata'->>'memo'<>'keep me' then raise exception 'memo lost'; end if;
 if public.dashboard_backfill_inventory(u)->1<>before2 then raise exception 'unresolved changed'; end if;
 v:=public.dashboard_backfill_rollback(u,b,digest);
 if v->>'restored_count'<>'1' or public.dashboard_backfill_inventory(u)->0->'metadata'<>before1->'metadata' then raise exception 'rollback failed'; end if;
end $$;
do $$
declare u uuid:='00000000-0000-4000-8000-000000000001'; b uuid; snap jsonb; candidates jsonb; p jsonb; digest text:=repeat('c',64);
begin
 snap:=public.dashboard_backfill_inventory(u);
 p:='{"source_system":"samsungcard","account_key":"opaque-test","billing_month":"2026-11","amount_basis":"purchase_approval","source_record_id_type":"provider","source_record_id":"same-id"}';
 candidates:=jsonb_build_array(
 jsonb_build_object('id',snap->0->>'id','external_id',snap->0->>'external_id','expected_updated_at',snap->0->>'updated_at','patch',p),
 jsonb_build_object('id',snap->1->>'id','external_id',snap->1->>'external_id','expected_updated_at',snap->1->>'updated_at','patch',p));
 insert into public.dashboard_backfill_batches(user_id,plan_digest,inventory_digest,inventory_snapshot,plan_entries,candidates,summary)
 values(u,digest,repeat('d',64),snap,'[]',candidates,'{}') returning id into b;
 begin
  perform public.dashboard_backfill_apply(u,b,digest,2);
  raise exception 'unexpected success';
 exception when sqlstate 'P0001' then
  if sqlerrm<>'BACKFILL_IDENTITY_COLLISION' then raise; end if;
 end;
 if public.dashboard_backfill_inventory(u)<>snap then raise exception 'partial apply leaked'; end if;
 -- Snapshot drift after staging must abort the entire operation.
 update public.dashboard_items set metadata=metadata||'{"memo":"new edit"}' where id=(snap->0->>'id')::uuid;
 begin
  perform public.dashboard_backfill_apply(u,b,digest,2);
  raise exception 'unexpected success';
 exception when sqlstate 'P0001' then
  if sqlerrm<>'BACKFILL_SNAPSHOT_CHANGED' then raise; end if;
 end;
 if public.dashboard_backfill_inventory(u)->0->'metadata'->>'memo'<>'new edit' then raise exception 'new edit lost'; end if;
end $$;
