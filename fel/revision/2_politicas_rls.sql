-- Políticas RLS (extraídas de la migración 0300)
create policy permisos_catalogo_leer on public.permisos_catalogo for select to authenticated using (true);

create policy rol_permisos_leer      on public.rol_permisos      for select to authenticated using (true);

create policy plataforma_admins_leer on public.plataforma_admins for select to authenticated
  using (public.fel_es_admin_plataforma());

create policy perfiles_leer on public.perfiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.fel_es_admin_plataforma()
    or exists (
      select 1 from public.miembros mi
      where mi.user_id = perfiles.user_id and public.fel_tiene_permiso(mi.empresa_id, 'usuarios.ver'))
  );

create policy regimenes_leer on public.regimenes_fiscales for select to authenticated
  using (
    estado = 'verificado'
    or public.fel_es_admin_plataforma()
    or exists (select 1 from public.empresas e where e.regimen_id = regimenes_fiscales.id and public.fel_es_miembro(e.id))
  );

create policy empresas_leer on public.empresas for select to authenticated
  using (public.fel_es_admin_plataforma() or public.fel_es_miembro(id));

create policy miembros_leer on public.miembros for select to authenticated
  using (
    user_id = auth.uid()
    or public.fel_es_admin_plataforma()
    or public.fel_tiene_permiso(empresa_id, 'usuarios.ver')
  );

create policy invitaciones_leer on public.invitaciones for select to authenticated
  using (public.fel_es_admin_plataforma() or public.fel_tiene_permiso(empresa_id, 'usuarios.gestionar'));

create policy clientes_leer  on public.clientes  for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'clientes.ver'));

create policy conceptos_leer on public.conceptos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'conceptos.ver'));

create policy documentos_leer on public.documentos for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'borradores.ver'));

create policy doc_lineas_leer on public.documento_lineas for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'borradores.ver'));

create policy doc_estados_leer on public.documento_estados for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'historial.ver'));

create policy identificaciones_leer on public.identificaciones_tipos for select to authenticated using (true);

create policy reglas_normativas_leer on public.reglas_normativas for select to authenticated
  using (estado = 'verificado' or public.fel_es_admin_plataforma());

create policy operaciones_leer on public.operaciones_fiscales for select to authenticated
  using (public.fel_tiene_permiso(empresa_id, 'historial.ver'));

create policy auditoria_leer on public.auditoria for select to authenticated
  using (
    (empresa_id is not null and public.fel_tiene_permiso(empresa_id, 'auditoria.ver'))
    or (public.fel_es_admin_plataforma()
        and entidad in ('empresa', 'regimen', 'miembro', 'invitacion', 'plataforma'))
  );

