-- 테스트 전용 — Supabase 에 적용 금지. (TEST ONLY — never apply to Supabase or any production DB.)
-- CI 의 일회용 PostgreSQL 에서 supabase/migrations 보다 먼저 실행해 Supabase 의 auth 스키마·역할·기본 권한을 흉내 낸다.
-- 역할은 클러스터 전체에서 공유되므로 '없으면 생성' 으로 만든다.
\set ON_ERROR_STOP on

create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
-- PostgREST 가 넣는 JWT sub 클레임을 흉내 낸다. 테스트에서는 set_config('request.jwt.claim.sub', '<uuid>', true) 로 지정.
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase 기본과 같은 기본 권한. 마이그레이션이 만드는 객체에 적용되고,
-- 마이그레이션 안의 revoke 가 그대로 효과를 내도록 마이그레이션 뒤에 grant 로 덮어쓰지 않는다.
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
