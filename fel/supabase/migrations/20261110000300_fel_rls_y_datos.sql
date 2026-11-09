-- NEXA FEL · Fase 1.0 · RLS, permisos de la base y datos iniciales.
-- Principio: la app (rol authenticated) SOLO LEE, y solo lo que le corresponde. Toda escritura pasa por la Edge Function "fel-api".
-- Las tablas de negocio no se exponen al administrador maestro: él administra empresas y regímenes, no los datos fiscales de los clientes.

-- ============================================================ RLS en TODAS las tablas
alter table public.permisos_catalogo   enable row level security;
alter table public.rol_permisos        enable row level security;
alter table public.plataforma_admins   enable row level security;
alter table public.perfiles            enable row level security;
alter table public.regimenes_fiscales  enable row level security;
alter table public.empresas            enable row level security;
alter table public.miembros            enable row level security;
alter table public.invitaciones        enable row level security;
alter table public.clientes            enable row level security;
alter table public.conceptos           enable row level security;
alter table public.documentos          enable row level security;
alter table public.documento_lineas    enable row level security;
alter table public.documento_estados   enable row level security;
alter table public.contadores_borrador enable row level security;
alter table public.auditoria           enable row level security;

-- ============================================================ permisos de tabla: nada para anon; lectura puntual para authenticated
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.permisos_catalogo, public.rol_permisos, public.plataforma_admins, public.perfiles,
                public.regimenes_fiscales, public.empresas, public.miembros, public.invitaciones,
                public.clientes, public.conceptos, public.documentos, public.documento_lineas,
                public.documento_estados, public.auditoria
  to authenticated;
-- contadores_borrador: sin acceso para authenticated (solo la función de servicio).

-- Objetos nuevos que se creen después NO quedan abiertos por defecto.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Las políticas de RLS llaman a estas funciones con los permisos de quien consulta.
grant execute on function public.fel_es_admin_plataforma() to authenticated;
grant execute on function public.fel_es_miembro(uuid)      to authenticated;
grant execute on function public.fel_tiene_permiso(uuid, text) to authenticated;

-- Funciones de escritura y de servicio: solo service_role.
grant execute on all functions in schema public to service_role;
revoke execute on function public.fel_es_admin_plataforma(), public.fel_es_miembro(uuid), public.fel_tiene_permiso(uuid, text) from anon;

-- La auditoría no se puede modificar ni borrar ni con la clave de servicio.
revoke update, delete, truncate on public.auditoria from service_role;
revoke update, delete, truncate on public.documento_estados from service_role;

-- ============================================================ políticas (solo SELECT; sin políticas de escritura)
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

-- Régimen: lo verificado lo ve cualquier usuario; lo no verificado, el maestro y los miembros de la empresa que lo usa.
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

-- Auditoría: la empresa ve la suya con 'auditoria.ver'; el maestro ve solo eventos administrativos, no datos de negocio.
create policy auditoria_leer on public.auditoria for select to authenticated
  using (
    (empresa_id is not null and public.fel_tiene_permiso(empresa_id, 'auditoria.ver'))
    or (public.fel_es_admin_plataforma()
        and entidad in ('empresa', 'regimen', 'miembro', 'invitacion', 'plataforma'))
  );

-- ============================================================ datos iniciales
insert into public.permisos_catalogo (codigo, descripcion) values
  ('empresa.ver',          'Ver los datos de la empresa'),
  ('usuarios.ver',         'Ver los usuarios de la empresa'),
  ('usuarios.gestionar',   'Invitar, cambiar rol o permisos y desactivar usuarios'),
  ('clientes.ver',         'Ver clientes'),
  ('clientes.escribir',    'Crear y editar clientes'),
  ('conceptos.ver',        'Ver conceptos'),
  ('conceptos.escribir',   'Crear y editar conceptos'),
  ('borradores.ver',       'Ver borradores'),
  ('borradores.crear',     'Crear borradores'),
  ('borradores.editar',    'Editar borradores'),
  ('borradores.revisar',   'Marcar borradores como revisados'),
  ('borradores.archivar',  'Archivar borradores'),
  ('historial.ver',        'Ver el historial de estados de un documento'),
  ('auditoria.ver',        'Ver la auditoría de la empresa'),
  ('fiscal.ver',           'Ver la configuración fiscal de la empresa');

insert into public.rol_permisos (rol, permiso)
select 'propietario', codigo from public.permisos_catalogo;

insert into public.rol_permisos (rol, permiso)
select 'administrador', codigo from public.permisos_catalogo;

insert into public.rol_permisos (rol, permiso) values
  ('emisor', 'empresa.ver'), ('emisor', 'clientes.ver'), ('emisor', 'clientes.escribir'),
  ('emisor', 'conceptos.ver'), ('emisor', 'conceptos.escribir'),
  ('emisor', 'borradores.ver'), ('emisor', 'borradores.crear'), ('emisor', 'borradores.editar'),
  ('emisor', 'historial.ver'), ('emisor', 'fiscal.ver'),
  ('lector', 'empresa.ver'), ('lector', 'clientes.ver'), ('lector', 'conceptos.ver'),
  ('lector', 'borradores.ver'), ('lector', 'historial.ver'), ('lector', 'fiscal.ver');

-- Regímenes: SOLO la estructura. Sin tasas ni reglas hasta que las valide tu contador.
insert into public.regimenes_fiscales (codigo, version, nombre, estado, reglas, fuente) values
  ('general', 1, 'Régimen General', 'sin_verificar',
   '{"esquema":1,"pendiente_de_validacion":true,"nota":"Sin tasas ni reglas. Completar y verificar antes de usar."}'::jsonb, null),
  ('pequeno_contribuyente', 1, 'Pequeño Contribuyente', 'sin_verificar',
   '{"esquema":1,"pendiente_de_validacion":true,"nota":"Sin tasas ni reglas. Completar y verificar antes de usar."}'::jsonb, null);
