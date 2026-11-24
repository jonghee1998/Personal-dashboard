create extension if not exists pgcrypto;
create table if not exists public.dashboard_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('transaction','settlement','news','benefit','task','event','journal')),
 external_id text not null, title text not null, description text, amount numeric(16,2),
 currency text not null default 'KRW', status text not null default 'active' check(status in ('pending','done','active','archived')),
 category text,source text,event_date date,due_date date,url text,metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,kind,external_id)
);
create index if not exists dashboard_items_user_kind_date on public.dashboard_items(user_id,kind,event_date desc);
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end; $$;
drop trigger if exists dashboard_items_updated_at on public.dashboard_items;
create trigger dashboard_items_updated_at before update on public.dashboard_items for each row execute function public.set_updated_at();
alter table public.dashboard_items enable row level security;
drop policy if exists "read own items" on public.dashboard_items;
drop policy if exists "update own items" on public.dashboard_items;
create policy "read own items" on public.dashboard_items for select to authenticated using(auth.uid()=user_id);
create policy "update own items" on public.dashboard_items for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
