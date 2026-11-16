-- PROPUESTA (migración 29, NO aplicada a ninguna base hospedada y fuera de supabase/migrations a propósito: el conjunto aprobado sigue siendo 1–28).
-- Almacén persistente de las operaciones de certificación con Digifact (TEST): una operación = un intento de certificar UN documento, con su referencia determinista.
-- Garantías en la propia base (no solo en el código): una sola operación que bloquea por documento (enviando/certificada/desconocida), la misma referencia no se prepara dos veces,
-- una autorización de Digifact no se repite dentro de la empresa, los datos de identidad de la operación no se pueden cambiar y solo existen las transiciones de estado válidas.
-- Solo la usa el servidor (rol propietario): RLS activo y sin privilegios para anon/authenticated/service_role. No guarda credenciales, tokens ni el XML/PDF (eso es una fase posterior).

create table public.digifact_operaciones (
  id                    uuid primary key,
  empresa_id            uuid not null references public.empresas (id),
  documento_id          uuid not null,
  referencia            uuid not null,
  hash                  text not null check (length(hash) between 8 and 128),
  huella_emisor         text not null check (huella_emisor ~ '^[0-9a-f]{16}$'),
  fecha_emision         text not null check (fecha_emision ~ '^\d{4}-\d{2}-\d{2}'),
  establecimiento       integer not null check (establecimiento >= 1),
  total                 text not null check (total ~ '^\d+(\.\d{1,6})?$'),
  estado                text not null check (estado in ('preparada','enviando','certificada','rechazada','desconocida','no_enviada')),
  creada_ms             bigint not null check (creada_ms > 0),
  actualizada_ms        bigint not null check (actualizada_ms >= creada_ms),
  actor_id              uuid not null,
  intento_del_documento integer not null check (intento_del_documento >= 1),
  intentos_conciliacion integer not null default 0 check (intentos_conciliacion >= 0),
  resultado             jsonb check (resultado is null or jsonb_typeof(resultado) = 'object'),
  foreign key (documento_id, empresa_id) references public.documentos (id, empresa_id)     -- una operación jamás apunta al documento de otra empresa
);
create unique index digifact_op_una_que_bloquea_uq on public.digifact_operaciones (empresa_id, documento_id) where estado in ('enviando','certificada','desconocida');
create unique index digifact_op_preparada_uq        on public.digifact_operaciones (empresa_id, documento_id, referencia) where estado = 'preparada';
create unique index digifact_op_autorizacion_uq     on public.digifact_operaciones (empresa_id, (resultado ->> 'autorizacion')) where resultado ->> 'autorizacion' is not null;
create index digifact_op_documento_idx on public.digifact_operaciones (empresa_id, documento_id, creada_ms);

create function public.fel_digifact_op_guarda() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_DIGIFACT: las operaciones de certificación no se borran' using errcode = 'P0001'; end if;
  if new.id is distinct from old.id or new.empresa_id is distinct from old.empresa_id or new.documento_id is distinct from old.documento_id or new.referencia is distinct from old.referencia
     or new.hash is distinct from old.hash or new.huella_emisor is distinct from old.huella_emisor or new.fecha_emision is distinct from old.fecha_emision
     or new.establecimiento is distinct from old.establecimiento or new.total is distinct from old.total or new.actor_id is distinct from old.actor_id
     or new.creada_ms is distinct from old.creada_ms or new.intento_del_documento is distinct from old.intento_del_documento then
    raise exception 'FEL_DIGIFACT: los datos de identidad de la operación no se modifican' using errcode = 'P0001';
  end if;
  if new.estado is distinct from old.estado then
    if not ((old.estado = 'preparada' and new.estado = 'enviando')
         or (old.estado = 'enviando' and new.estado in ('no_enviada','desconocida','certificada','rechazada'))
         or (old.estado = 'desconocida' and new.estado = 'certificada')) then
      raise exception 'FEL_DIGIFACT: transición de estado no permitida (% → %)', old.estado, new.estado using errcode = 'P0001';
    end if;
  elsif old.estado <> 'desconocida' then
    raise exception 'FEL_DIGIFACT: la operación en estado % ya no cambia', old.estado using errcode = 'P0001';
  end if;
  if old.estado = 'certificada' and new.resultado is distinct from old.resultado then raise exception 'FEL_DIGIFACT: el resultado certificado no se modifica' using errcode = 'P0001'; end if;
  if new.actualizada_ms < old.actualizada_ms then raise exception 'FEL_DIGIFACT: la fecha de actualización no retrocede' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger digifact_op_guarda before update or delete on public.digifact_operaciones for each row execute function public.fel_digifact_op_guarda();
revoke all on function public.fel_digifact_op_guarda() from public, anon, authenticated, service_role;

alter table public.digifact_operaciones enable row level security;
revoke all on public.digifact_operaciones from public, anon, authenticated, service_role;
