-- Metadata-only backfill. Deploy separately; no production rows changed by this migration.
create table if not exists public.dashboard_backfill_batches (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
 inventory_digest text not null check (inventory_digest ~ '^[0-9a-f]{64}$'),
 inventory_snapshot jsonb not null check (jsonb_typeof(inventory_snapshot)='array'),
 plan_entries jsonb not null check (jsonb_typeof(plan_entries)='array'),
 candidates jsonb not null check (jsonb_typeof(candidates)='array'),
 after_rows jsonb,
 summary jsonb not null,
 status text not null default 'staged' check(status in ('staged','applied','rolled_back')),
 created_at timestamptz not null default now(),
 applied_at timestamptz,
 rolled_back_at timestamptz,
 unique(user_id,plan_digest)
);
alter table public.dashboard_backfill_batches enable row level security;
revoke all on public.dashboard_backfill_batches from public,anon,authenticated;
grant select,insert,update on public.dashboard_backfill_batches to service_role;

-- Read exactly the same typed JSON in preview/stage/apply. Includes hidden/archived
-- transaction rows as concurrency guards, but only visible candidates are patched.
create or replace function public.dashboard_backfill_inventory(p_user uuid)
returns jsonb language sql volatile security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb)
 from public.dashboard_items d where d.user_id=p_user and d.kind='transaction';
$$;
revoke all on function public.dashboard_backfill_inventory(uuid) from public,anon,authenticated;
grant execute on function public.dashboard_backfill_inventory(uuid) to service_role;

create or replace function public.dashboard_backfill_apply(p_user uuid,p_batch uuid,p_digest text,p_expected_count integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 b public.dashboard_backfill_batches%rowtype;
 d public.dashboard_items%rowtype;
 c jsonb; patch jsonb; old_row jsonb; new_row jsonb;
 v_after_rows jsonb:='[]'::jsonb; n integer:=0;
begin
 -- Serialize with ordinary dashboard writes, including inserts, until commit.
 lock table public.dashboard_items in share row exclusive mode;
 select * into b from public.dashboard_backfill_batches where id=p_batch and user_id=p_user for update;
 if not found or b.status<>'staged' or b.plan_digest<>p_digest then raise exception 'BACKFILL_BATCH_NOT_STAGED' using errcode='P0001'; end if;
 if b.created_at<now()-interval '24 hours' then raise exception 'BACKFILL_PLAN_EXPIRED' using errcode='P0001'; end if;
 if p_expected_count<=0 or p_expected_count<>jsonb_array_length(b.candidates) then raise exception 'BACKFILL_COUNT_MISMATCH' using errcode='P0001'; end if;
 if public.dashboard_backfill_inventory(p_user) is distinct from b.inventory_snapshot then raise exception 'BACKFILL_SNAPSHOT_CHANGED' using errcode='P0001'; end if;
 for c in select value from jsonb_array_elements(b.candidates) loop
   patch:=c->'patch';
   if jsonb_typeof(patch) is distinct from 'object' or
      (patch - array['source_system','account_key','billing_month','amount_basis','source_record_id_type','source_record_id','fingerprint_version']::text[]) <> '{}'::jsonb or
      not (patch ?& array['source_system','account_key','billing_month','amount_basis','source_record_id_type','source_record_id']) or
      patch->>'source_system' is distinct from 'samsungcard' or
      coalesce(patch->>'account_key','') !~ '^[A-Za-z0-9_-]{1,100}$' or
      coalesce(patch->>'billing_month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or
      coalesce(patch->>'amount_basis','') not in ('statement_billed','purchase_approval') or
      coalesce(patch->>'source_record_id_type','') not in ('provider','fingerprint') or
      coalesce(patch->>'source_record_id','')='' or
      (patch->>'source_record_id_type'='fingerprint' and (patch->>'amount_basis'<>'statement_billed' or coalesce(patch->>'fingerprint_version','')<>'v1' or coalesce(patch->>'source_record_id','') !~ '^[0-9a-f]{64}$')) or
      (patch->>'source_record_id_type'='provider' and (patch->>'amount_basis'<>'purchase_approval' or patch ? 'fingerprint_version'))
   then raise exception 'BACKFILL_INVALID_PATCH' using errcode='P0001'; end if;
   select * into d from public.dashboard_items where id=(c->>'id')::uuid and user_id=p_user and kind='transaction' and external_id=c->>'external_id' and status<>'archived';
   if not found or d.metadata->'dashboard_deleted'='true'::jsonb then raise exception 'BACKFILL_TARGET_CHANGED' using errcode='P0001'; end if;
   if d.updated_at is distinct from (c->>'expected_updated_at')::timestamptz then raise exception 'BACKFILL_TARGET_STALE' using errcode='P0001'; end if;
   if exists(select 1 from jsonb_each(patch) p where d.metadata ? p.key and d.metadata->p.key not in ('null'::jsonb,'""'::jsonb,p.value)) then raise exception 'BACKFILL_METADATA_CONFLICT' using errcode='P0001'; end if;
   if exists(select 1 from public.dashboard_items x where x.user_id=p_user and x.kind='transaction' and x.id<>d.id and x.status<>'archived' and x.metadata->'dashboard_deleted' is distinct from 'true'::jsonb
      and x.currency=d.currency and x.metadata->>'source_system'=patch->>'source_system' and x.metadata->>'account_key'=patch->>'account_key' and x.metadata->>'billing_month'=patch->>'billing_month'
      and x.metadata->>'amount_basis'=patch->>'amount_basis' and x.metadata->>'source_record_id_type'=patch->>'source_record_id_type' and x.metadata->>'source_record_id'=patch->>'source_record_id') then raise exception 'BACKFILL_IDENTITY_COLLISION' using errcode='P0001'; end if;
   old_row:=to_jsonb(d);
   update public.dashboard_items set metadata=d.metadata||patch where id=d.id and user_id=p_user returning * into d;
   new_row:=to_jsonb(d);
   if (old_row-'metadata'-'updated_at') is distinct from (new_row-'metadata'-'updated_at') then raise exception 'BACKFILL_BUSINESS_FIELD_CHANGED' using errcode='P0001'; end if;
   v_after_rows:=v_after_rows||jsonb_build_array(jsonb_build_object('id',d.id,'before',old_row,'after',new_row));
   n:=n+1;
 end loop;
 if n<>p_expected_count then raise exception 'BACKFILL_COUNT_MISMATCH' using errcode='P0001'; end if;
 update public.dashboard_backfill_batches set status='applied',after_rows=v_after_rows,applied_at=now() where id=b.id;
 return jsonb_build_object('status','applied','batch_id',b.id,'applied_count',n,'plan_digest',b.plan_digest);
end $$;
revoke all on function public.dashboard_backfill_apply(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.dashboard_backfill_apply(uuid,uuid,text,integer) to service_role;

create or replace function public.dashboard_backfill_rollback(p_user uuid,p_batch uuid,p_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.dashboard_backfill_batches%rowtype; d public.dashboard_items%rowtype; r jsonb; n integer:=0;
begin
 lock table public.dashboard_items in share row exclusive mode;
 select * into b from public.dashboard_backfill_batches where id=p_batch and user_id=p_user for update;
 if not found or b.status<>'applied' or b.plan_digest<>p_digest then raise exception 'BACKFILL_BATCH_NOT_APPLIED' using errcode='P0001'; end if;
 -- Preflight every changed row. New unrelated transactions do not block rollback,
 -- but any newer edit to a changed row does, preserving subsequent user data.
 for r in select value from jsonb_array_elements(b.after_rows) loop
   select * into d from public.dashboard_items where id=(r->>'id')::uuid and user_id=p_user;
   if not found or to_jsonb(d) is distinct from r->'after' then raise exception 'BACKFILL_ROLLBACK_STALE' using errcode='P0001'; end if;
 end loop;
 for r in select value from jsonb_array_elements(b.after_rows) loop
   update public.dashboard_items set metadata=r->'before'->'metadata' where id=(r->>'id')::uuid and user_id=p_user;
   n:=n+1;
 end loop;
 update public.dashboard_backfill_batches set status='rolled_back',rolled_back_at=now() where id=b.id;
 return jsonb_build_object('status','rolled_back','batch_id',b.id,'restored_count',n,'plan_digest',b.plan_digest);
end $$;
revoke all on function public.dashboard_backfill_rollback(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dashboard_backfill_rollback(uuid,uuid,text) to service_role;
