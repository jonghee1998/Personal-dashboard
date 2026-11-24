-- Phase 1: append-only sync audit, separate from dashboard business records.
-- Apply in Supabase SQL editor before enabling the sync-report integration.
create table if not exists public.dashboard_sync_runs (
 user_id uuid not null references auth.users(id) on delete cascade,
 run_id uuid not null,
 dataset text not null check (dataset in ('transactions','settlements','news','points','applications','subscriptions','tasks','events','journal')),
 source_system text not null,
 source_as_of timestamptz,
 collected_at timestamptz,
 received_at timestamptz not null default now(),
 validated_at timestamptz,
 status text not null check (status in ('success','partial','failed','quarantined')),
 verification_level text not null default 'unverified' check (verification_level in ('unverified','structural_provenance_only','independent_verified')),
 expected_count integer check (expected_count >= 0),
 received_count integer not null default 0 check (received_count >= 0),
 accepted_count integer not null default 0 check (accepted_count >= 0),
 rejected_count integer not null default 0 check (rejected_count >= 0),
 error_code text,
 payload_digest text,
 primary key (user_id,run_id,dataset,source_system),
 check (accepted_count + rejected_count <= received_count),
 check (source_as_of is null or collected_at is null or source_as_of <= collected_at)
);
create index if not exists dashboard_sync_runs_latest on public.dashboard_sync_runs(user_id,dataset,received_at desc);
alter table public.dashboard_sync_runs enable row level security;
drop policy if exists "read own sync runs" on public.dashboard_sync_runs;
create policy "read own sync runs" on public.dashboard_sync_runs for select to authenticated using (auth.uid()=user_id);
-- No authenticated client write policy. Only trusted server endpoints can write.
revoke insert,update,delete on public.dashboard_sync_runs from anon,authenticated;
