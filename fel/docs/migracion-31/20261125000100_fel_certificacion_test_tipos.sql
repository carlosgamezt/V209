-- NEXA FEL · PROPUESTA de migración 31 (NO aplicada, NO está en supabase/migrations): permite certificar NOTAS DE CRÉDITO (NCRE) en Digifact TEST. Solo TEST, solo el almacén de Digifact.
-- Qué cambia: (1) fel_tipos_dte gana la columna certificacion_test (por omisión false); (2) NCRE = true (NDEB y RECI siguen false hasta leer sus ejemplos oficiales); (3) el guardián de
-- digifact_operaciones acepta certificacion_habilitada O certificacion_test; (4) una función de lectura para el servidor. NO toca certificacion_habilitada, ni el guardián de operaciones_fiscales
-- (la vía «real»), ni documentos, ni datos de empresas. Aditiva y reversible (docs/migracion-31/reversion-31.sql). Se ejecuta en UNA transacción como «postgres».
-- Requiere: migración 30 aplicada y tabla digifact_operaciones (migración 29).

do $c$ begin
  if to_regclass('public.fel_tipos_dte') is null then raise exception 'MIGRACIÓN 31 RECHAZADA: falta la migración 30 (fel_tipos_dte)'; end if;
  if to_regclass('public.digifact_operaciones') is null then raise exception 'MIGRACIÓN 31 RECHAZADA: falta la migración 29 (digifact_operaciones)'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fel_tipos_dte' and column_name = 'certificacion_test') then raise exception 'MIGRACIÓN 31 RECHAZADA: ya está aplicada'; end if;
end $c$;

alter table public.fel_tipos_dte add column certificacion_test boolean not null default false;
-- (La restricción se agrega DESPUÉS de cargar los datos.) Coherencia: quien certifica «de verdad» también puede en TEST; un tipo pendiente jamás certifica ni en TEST.

-- El catálogo es inmutable para la aplicación; la migración (rol postgres) apaga su protección solo dentro de esta transacción.
alter table public.fel_tipos_dte disable trigger fel_tipos_dte_no_cambiar;
update public.fel_tipos_dte set certificacion_test = true where codigo in ('FACT', 'NCRE');
alter table public.fel_tipos_dte enable trigger fel_tipos_dte_no_cambiar;
alter table public.fel_tipos_dte add constraint fel_tipos_cert_test_chk check ((not certificacion_habilitada or certificacion_test) and (not certificacion_test or disponibilidad in ('implementado', 'en_pruebas')));

-- Guardián del almacén de Digifact: certificar exige certificacion_habilitada O certificacion_test. (operaciones_fiscales conserva el guardián de la 30: solo FACT.)
create function public.fel_digifact_tipo_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_tipo text; v_ok boolean;
begin
  select d.tipo_dte, (t.certificacion_habilitada or t.certificacion_test) into v_tipo, v_ok from public.documentos d join public.fel_tipos_dte t on t.codigo = d.tipo_dte where d.id = new.documento_id and d.empresa_id = new.empresa_id;
  if not found then return new; end if;
  if v_ok is distinct from true then
    raise exception 'FEL_REGLA: la certificación del tipo de documento «%» aún no está habilitada (solo validación y vista previa)', coalesce(v_tipo, '?');
  end if;
  return new;
end $$;
drop trigger fel_digifact_tipo_guard_t on public.digifact_operaciones;
create trigger fel_digifact_tipo_guard_t before insert on public.digifact_operaciones for each row execute function public.fel_digifact_tipo_guard();

-- Lectura para el servidor: códigos que pueden certificar en TEST (el servidor la consulta para decidir; la base sigue siendo la última barrera).
create function public.fel_tipos_certificacion_test() returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(codigo order by codigo), '{}') from public.fel_tipos_dte where certificacion_habilitada or certificacion_test
$$;

revoke all on function public.fel_digifact_tipo_guard() from public, anon, authenticated, service_role;
revoke all on function public.fel_tipos_certificacion_test() from public, anon, authenticated;
grant execute on function public.fel_tipos_certificacion_test() to service_role;
