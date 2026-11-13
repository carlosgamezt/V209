-- ARQUEO DE CAJA Y FONDO FIJO · tablas, reglas de acceso y protecciones.
-- Solo AGREGA objetos nuevos (no toca pa_docs ni ninguna tabla existente). Se puede correr más de una vez.
-- La app NO escribe en estas tablas: toda escritura pasa por la función "arqueos" (clave de servicio), que pone
-- la hora del servidor, valida permisos y estados, y calcula los totales. La app solo LEE, con las reglas de abajo.

-- 1) Encargado de fondo fijo por sucursal (con historial de asignaciones)
create table if not exists public.pa_ff_asignaciones (
  id                 bigint generated always as identity primary key,
  branch_user_id     text        not null,            -- id de la sucursal (usuario "sucursal" en pa_docs)
  encargado_user_id  text        not null,            -- id del usuario encargado del fondo fijo
  monto              numeric(14,2) not null default 0, -- monto del fondo fijo de la sucursal
  desde              timestamptz not null default now(),
  hasta              timestamptz,                     -- null = asignación vigente
  creado_por         text
);
alter table public.pa_ff_asignaciones add column if not exists monto numeric(14,2) not null default 0;
-- El encargado de fondo fijo NO tiene cuenta propia: se usa la cuenta de la sucursal (encargado_user_id = id de la sucursal) y se guarda el NOMBRE de la persona.
alter table public.pa_ff_asignaciones add column if not exists encargado_nombre text;
create unique index if not exists pa_ff_vigente_uq on public.pa_ff_asignaciones (branch_user_id) where hasta is null;

-- 2) Arqueos: una fila por VERSIÓN (una corrección crea una versión nueva y conserva la anterior)
create table if not exists public.pa_arqueos (
  folio              text        not null,
  version            int         not null default 1,
  estado             text        not null default 'borrador'
                     check (estado in ('borrador','pend_supervisor','pend_encargado','completo')),
  corrige_de         int,                             -- versión que corrige (si es corrección)
  motivo_correccion  text,
  branch_user_id     text        not null,
  region             text,
  branch             text        not null,
  fecha              date        not null,
  fondo              numeric(14,2) not null default 0,
  supervisor_user_id text        not null,
  supervisor_name    text,
  ff_user_id         text        not null,            -- encargado de fondo fijo vigente a la fecha del arqueo
  ff_name            text,
  data               jsonb       not null,            -- denominaciones, documentos, caja chica, facturas, recibo, observaciones
  totales            jsonb       not null default '{}'::jsonb,
  resultado          numeric(14,2) not null default 0, -- efectivo + doctos. - (ventas + fondo)
  tipo_resultado     text        not null default 'cuadrado' check (tipo_resultado in ('cuadrado','faltante','sobrante')),
  modo_firma         text        not null default 'digital' check (modo_firma in ('digital','papel')), -- digital en pantalla, o firma y sello en papel después de imprimir
  hash               text,                            -- huella del contenido al pasar a firmas
  bloqueado_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (folio, version)
);
alter table public.pa_arqueos add column if not exists modo_firma text not null default 'digital';
create index if not exists pa_arqueos_fecha_idx on public.pa_arqueos (fecha desc);

-- 3) Firmas (solo se agregan; ligadas a la versión exacta y a la cuenta autenticada de la persona)
create table if not exists public.pa_arqueo_firmas (
  id          bigint generated always as identity primary key,
  folio       text not null,
  version     int  not null,
  rol         text not null check (rol in ('supervisor','encargado')),
  user_id     text not null,
  user_name   text,
  auth_id     uuid,
  firma       text not null,                          -- imagen PNG de la firma (data URL)
  doc_hash    text,
  firmado_at  timestamptz not null default now(),
  unique (folio, version, rol),
  foreign key (folio, version) references public.pa_arqueos (folio, version)
);

-- 4) Datos del depósito del sobrante (se agregan después de firmar; solo se agregan)
create table if not exists public.pa_arqueo_deposito (
  id                 bigint generated always as identity primary key,
  folio              text not null,
  version            int  not null,
  numero_confirmacion text,                           -- solo dígitos, sin límite
  comprobante        text,                            -- nombre del archivo en OneDrive
  agregado_por       text,
  agregado_nombre    text,
  agregado_at        timestamptz not null default now(),
  check (numero_confirmacion is null or numero_confirmacion ~ '^[0-9]+$'),
  foreign key (folio, version) references public.pa_arqueos (folio, version)
);

-- 5) Historial de auditoría (solo se agrega)
create table if not exists public.pa_arqueo_audit (
  id          bigint generated always as identity primary key,
  folio       text,
  version     int,
  branch_user_id text,
  accion      text not null,
  user_id     text,
  user_name   text,
  detalle     jsonb,
  at          timestamptz not null default now()
);
create index if not exists pa_arqueo_audit_folio_idx on public.pa_arqueo_audit (folio, version, at);

-- 6) Folios consecutivos por año
create table if not exists public.pa_arqueo_folios (anio int primary key, n int not null default 0);
create or replace function public.pa_arqueo_next_folio() returns text
language plpgsql security definer set search_path to 'public' as $$
declare y int := extract(year from (now() at time zone 'America/Guatemala'))::int; k int;
begin
  insert into pa_arqueo_folios (anio, n) values (y, 1)
  on conflict (anio) do update set n = pa_arqueo_folios.n + 1 returning n into k;
  return 'AR-' || y || '-' || lpad(k::text, 4, '0');
end $$;
revoke all on function public.pa_arqueo_next_folio() from public, anon, authenticated;

-- 7) PROTECCIONES en la base de datos (valen aunque alguien use la clave de servicio por error)
create or replace function public.pa_arqueo_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Un arqueo firmado o en firmas no se puede borrar'; end if;
    return old;
  end if;
  if old.estado = 'completo' then raise exception 'Una versión completa no se puede modificar: crea una corrección'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pa_arqueo_guard_t on public.pa_arqueos;
create trigger pa_arqueo_guard_t before update or delete on public.pa_arqueos
for each row execute function public.pa_arqueo_guard();

create or replace function public.pa_append_only() returns trigger
language plpgsql as $$
begin raise exception 'Este registro no se puede modificar ni borrar'; end $$;
drop trigger if exists pa_firmas_ao on public.pa_arqueo_firmas;
create trigger pa_firmas_ao before update or delete on public.pa_arqueo_firmas for each row execute function public.pa_append_only();
drop trigger if exists pa_deposito_ao on public.pa_arqueo_deposito;
create trigger pa_deposito_ao before update or delete on public.pa_arqueo_deposito for each row execute function public.pa_append_only();
drop trigger if exists pa_audit_ao on public.pa_arqueo_audit;
create trigger pa_audit_ao before update or delete on public.pa_arqueo_audit for each row execute function public.pa_append_only();

-- 8) REGLAS DE ACCESO (RLS): la app solo lee
alter table public.pa_ff_asignaciones enable row level security;
alter table public.pa_arqueos         enable row level security;
alter table public.pa_arqueo_firmas   enable row level security;
alter table public.pa_arqueo_deposito enable row level security;
alter table public.pa_arqueo_audit    enable row level security;
alter table public.pa_arqueo_folios   enable row level security;

drop policy if exists pa_arq_sel on public.pa_arqueos;
create policy pa_arq_sel on public.pa_arqueos for select to authenticated using (
  pa_role() = 'admin'
  or (pa_role() = 'supervisor' and (region = pa_region() or pa_xmode(region) is not null))
  or ff_user_id = pa_uid()
  or supervisor_user_id = pa_uid()
);

drop policy if exists pa_arqf_sel on public.pa_arqueo_firmas;
create policy pa_arqf_sel on public.pa_arqueo_firmas for select to authenticated using (
  exists (select 1 from public.pa_arqueos a where a.folio = pa_arqueo_firmas.folio and a.version = pa_arqueo_firmas.version)
);
drop policy if exists pa_arqd_sel on public.pa_arqueo_deposito;
create policy pa_arqd_sel on public.pa_arqueo_deposito for select to authenticated using (
  exists (select 1 from public.pa_arqueos a where a.folio = pa_arqueo_deposito.folio and a.version = pa_arqueo_deposito.version)
);
drop policy if exists pa_arqa_sel on public.pa_arqueo_audit;
create policy pa_arqa_sel on public.pa_arqueo_audit for select to authenticated using (
  (folio is not null and exists (select 1 from public.pa_arqueos a where a.folio = pa_arqueo_audit.folio and a.version = pa_arqueo_audit.version))
  or (folio is null and pa_role() = 'admin')
);

drop policy if exists pa_ff_sel on public.pa_ff_asignaciones;
create policy pa_ff_sel on public.pa_ff_asignaciones for select to authenticated using (
  encargado_user_id = pa_uid()
  or exists (select 1 from public.pa_docs d
             where d.col = 'users' and d.id = pa_ff_asignaciones.branch_user_id
               and (pa_role() = 'admin'
                    or (pa_role() = 'supervisor' and ((d.data->>'region') = pa_region() or pa_xmode(d.data->>'region') is not null))))
);
-- (sin políticas de INSERT, UPDATE ni DELETE: solo la función "arqueos" escribe)

-- 9) ELIMINAR ARQUEOS (solo administrador, desde la función "arqueos"): baja lógica con registro permanente.
-- El arqueo y sus firmas NO se borran de la base (siguen las protecciones de arriba); el folio queda en esta tabla
-- y la app y la función dejan de mostrarlo y de aceptarle cambios. Solo se agrega (no se edita ni se borra).
create table if not exists public.pa_arqueo_eliminados (
  folio            text primary key,
  eliminado_por    text not null,
  eliminado_nombre text,
  motivo           text,
  estado_previo    text,
  eliminado_at     timestamptz not null default now()
);
alter table public.pa_arqueo_eliminados enable row level security;
drop trigger if exists pa_elim_ao on public.pa_arqueo_eliminados;
create trigger pa_elim_ao before update or delete on public.pa_arqueo_eliminados for each row execute function public.pa_append_only();
drop policy if exists pa_arqe_sel on public.pa_arqueo_eliminados;
create policy pa_arqe_sel on public.pa_arqueo_eliminados for select to authenticated using (
  exists (select 1 from public.pa_arqueos a where a.folio = pa_arqueo_eliminados.folio)
);
-- (sin políticas de INSERT, UPDATE ni DELETE: solo la función "arqueos" escribe)
