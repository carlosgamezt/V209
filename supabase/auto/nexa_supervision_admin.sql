-- Nexa v473 · Supervisión mensual · permisos de escritura para el administrador (ejecutar completo en el SQL Editor)
drop policy if exists supervision_mensual_admin_ins on public.supervision_mensual;
create policy supervision_mensual_admin_ins on public.supervision_mensual
  for insert to authenticated
  with check (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));

drop policy if exists supervision_mensual_admin_upd on public.supervision_mensual;
create policy supervision_mensual_admin_upd on public.supervision_mensual
  for update to authenticated
  using      (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));

drop policy if exists supervision_mensual_admin_del on public.supervision_mensual;
create policy supervision_mensual_admin_del on public.supervision_mensual
  for delete to authenticated
  using (exists (select 1 from public.pa_profiles p where p.auth_id = auth.uid() and p.role = 'admin'));

-- GRANT (cambio de Supabase del 30 de octubre de 2026)
grant insert, update, delete on public.supervision_mensual to authenticated;
