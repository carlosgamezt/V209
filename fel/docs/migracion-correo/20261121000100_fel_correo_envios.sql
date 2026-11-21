-- NEXA FEL · envío de facturas por correo (nuestro propio servicio de correo; Digifact queda SOLO como certificador).
-- ESTADO: PROPUESTA. Vive FUERA de supabase/migrations a propósito (igual que la migración 29): el conjunto ejecutable sigue siendo exactamente el de las 28 aprobadas
-- y ninguna etapa de publicación la aplica. Las pruebas la aplican sobre una copia de las 28 (PGlite y PostgreSQL real de CI). Aplicarla en un Supabase real exige autorización expresa.
-- Aditiva: no modifica ninguna tabla ni función existente. Solo agrega permisos, la tabla del historial y sus protecciones.
-- Qué guarda: QUIÉN pidió el envío, A QUIÉN (el correo del destinatario: lo necesita el historial), CUÁNDO y el RESULTADO que informó el proveedor de correo.
-- Qué NO guarda: ni el contenido del correo, ni los adjuntos (se leen de artefactos_documento al enviar y no se copian), ni claves del proveedor.

-- ============================================================ permisos nuevos
insert into public.permisos_catalogo (codigo, descripcion) values
  ('correos.ver',      'Ver el historial de envíos de facturas por correo'),
  ('correos.enviar',   'Enviar por correo una factura certificada'),
  ('correos.reenviar', 'Reenviar por correo una factura certificada que ya se envió');
insert into public.rol_permisos (rol, permiso)
select r.rol, p.codigo from (values ('propietario'), ('administrador')) r(rol), public.permisos_catalogo p
 where p.codigo in ('correos.ver', 'correos.enviar', 'correos.reenviar');
insert into public.rol_permisos (rol, permiso) values ('emisor', 'correos.ver'), ('emisor', 'correos.enviar'), ('lector', 'correos.ver');

-- ============================================================ historial de envíos
create table public.envios_correo (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null,
  documento_id         uuid not null,
  operacion_id         uuid not null,   -- la certificación de la que salen el XML y el PDF adjuntos
  destinatario         text not null check (length(destinatario) between 5 and 254 and destinatario ~ '^[^[:space:]@<>,;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'),
  origen               text not null check (origen in ('manual', 'reenvio', 'automatico')),
  -- solicitado: registrado ANTES de hablar con el proveedor · aceptado: el proveedor devolvió un identificador (NO prueba entrega) · entregado: solo si un webhook lo confirma (no implementado)
  -- rechazado: el proveedor rechazó la solicitud (p. ej. dirección no válida) · fallido: corte, tiempo agotado o error del proveedor (resultado incierto: se reintenta con la MISMA clave, que el proveedor deduplica)
  estado               text not null default 'solicitado' check (estado in ('solicitado', 'aceptado', 'entregado', 'rechazado', 'fallido')),
  proveedor            text not null check (proveedor in ('resend', 'simulado')),
  proveedor_mensaje_id text check (proveedor_mensaje_id is null or length(proveedor_mensaje_id) between 1 and 120),
  error_codigo         text check (error_codigo is null or length(error_codigo) between 1 and 60),
  clave_idempotencia   text not null check (length(clave_idempotencia) between 8 and 200),
  solicitado_por       uuid,            -- nulo en el envío automático
  creado_en            timestamptz not null default now(),
  resuelto_en          timestamptz,
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id),
  foreign key (operacion_id, empresa_id) references public.operaciones_fiscales (id, empresa_id),
  unique (empresa_id, clave_idempotencia),                                   -- repetir la MISMA solicitud (doble clic, reintento del navegador) no crea otro envío
  check ((estado = 'solicitado') = (resuelto_en is null))
);
-- Un mismo documento no se envía dos veces al mismo destinatario sin pasar por el REENVÍO (que exige permiso y confirmación): lo garantiza la base, no solo la aplicación.
create unique index envios_correo_uno_por_destinatario on public.envios_correo (empresa_id, documento_id, lower(destinatario))
  where origen <> 'reenvio' and estado in ('solicitado', 'aceptado', 'entregado');
create index envios_correo_documento_idx on public.envios_correo (empresa_id, documento_id, creado_en desc);

-- Solo cambian el estado y el resultado; nada se borra; el estado solo avanza por caminos válidos.
create or replace function public.fel_envios_correo_guardia() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: envios_correo no admite borrados'; end if;
  if (new.id, new.empresa_id, new.documento_id, new.operacion_id, new.destinatario, new.origen, new.proveedor, new.clave_idempotencia, new.solicitado_por, new.creado_en)
     is distinct from (old.id, old.empresa_id, old.documento_id, old.operacion_id, old.destinatario, old.origen, old.proveedor, old.clave_idempotencia, old.solicitado_por, old.creado_en) then
    raise exception 'FEL_APPEND_ONLY: de un envío solo cambian el estado y el resultado';
  end if;
  if not ((old.estado = 'solicitado' and new.estado in ('aceptado', 'rechazado', 'fallido'))
       or (old.estado = 'fallido'    and new.estado = 'solicitado')          -- reintento con la misma clave
       or (old.estado = 'aceptado'   and new.estado = 'entregado')) then
    raise exception 'FEL_ESTADO_INVALIDO: un envío % no puede pasar a %', old.estado, new.estado;
  end if;
  return new;
end $$;
revoke all on function public.fel_envios_correo_guardia() from public, anon, authenticated, service_role;   -- igual que fel_solo_insertar: una función de disparador no la ejecuta ningún rol de la API
create trigger envios_correo_guardia before update or delete on public.envios_correo for each row execute function public.fel_envios_correo_guardia();

-- ============================================================ RLS: la app solo LEE lo de su empresa; escribe el servidor (fel-api)
alter table public.envios_correo enable row level security;
grant select on public.envios_correo to authenticated;
create policy envios_correo_leer on public.envios_correo for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'correos.ver'));
revoke delete, truncate on public.envios_correo from service_role;
