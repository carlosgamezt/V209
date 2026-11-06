-- Nexa v479 · Registro de visitas del supervisor a cada sucursal (solo administrador).
create table if not exists public.supervision_visitas (
  id uuid primary key default gen_random_uuid(),
  sucursal_codigo text not null,
  fecha date not null,
  nota text,
  registrado_por text,
  creado_en timestamptz not null default now()
);
create index if not exists supervision_visitas_idx on public.supervision_visitas (sucursal_codigo, fecha desc);
alter table public.supervision_visitas enable row level security;
drop policy if exists supervision_visitas_admin_sel on public.supervision_visitas;
create policy supervision_visitas_admin_sel on public.supervision_visitas for select to authenticated
  using (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));
drop policy if exists supervision_visitas_admin_ins on public.supervision_visitas;
create policy supervision_visitas_admin_ins on public.supervision_visitas for insert to authenticated
  with check (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));
drop policy if exists supervision_visitas_admin_del on public.supervision_visitas;
create policy supervision_visitas_admin_del on public.supervision_visitas for delete to authenticated
  using (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));
grant select, insert, delete on public.supervision_visitas to authenticated;
