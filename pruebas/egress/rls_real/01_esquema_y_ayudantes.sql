-- Réplica local de pa_docs con las POLÍTICAS REALES de producción (02_*.sql, texto exacto del resultado de medicion_egress.sql).
-- LAS FUNCIONES AUXILIARES SON SUSTITUTOS (stand-ins): sus definiciones reales llegarán con politicas_rls.sql. Las pruebas comprueban propiedades que no dependen de su código (E1 no cambia lectura ni escritura).
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.pa_profiles (auth_id uuid primary key, user_id text unique not null, role text, region text, branch text, assigned jsonb, must_change boolean default false);
create table public.pa_docs (col text not null, id text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (col, id));
alter table public.pa_docs enable row level security;
grant select, insert, update, delete on public.pa_docs to authenticated;
create function public.pa_uid() returns text language sql stable security definer set search_path = public as $$ select user_id from public.pa_profiles where auth_id = auth.uid() $$;
create function public.pa_role() returns text language sql stable security definer set search_path = public as $$ select role from public.pa_profiles where auth_id = auth.uid() $$;
create function public.pa_region() returns text language sql stable security definer set search_path = public as $$ select region from public.pa_profiles where auth_id = auth.uid() $$;
create function public.pa_branch() returns text language sql stable security definer set search_path = public as $$ select branch from public.pa_profiles where auth_id = auth.uid() $$;
-- supervisor en OTRA región: modo 'ver' o 'editar' según meta/cfg.access[usuario] (sustituto)
create function public.pa_xmode(r text) returns text language sql stable security definer set search_path = public as $$
  select case when pa_role() = 'supervisor' and r is distinct from pa_region()
    then coalesce((select d.data -> 'access' -> pa_uid() -> 'reg' ->> r from public.pa_docs d where d.col = 'meta' and d.id = 'cfg'), (select d.data -> 'access' -> pa_uid() ->> 'all' from public.pa_docs d where d.col = 'meta' and d.id = 'cfg')) end $$;
create function public.pa_inv_all() returns boolean language sql stable security definer set search_path = public as $$ select (select assigned from public.pa_profiles where auth_id = auth.uid()) is null $$;
create function public.pa_inv_can(r text, b text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select d.data -> 'invRegs' -> pa_uid() ? r from public.pa_docs d where d.col = 'meta' and d.id = 'cfg'), false) or exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.assigned ? (r || '|' || b)) $$;
create function public.pa_inv_rev() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select (d.data ->> 'invReview')::boolean from public.pa_docs d where d.col = 'meta' and d.id = 'cfg'), false) $$;
create function public.pa_can_del() returns boolean language sql stable security definer set search_path = public as $$ select true $$;
