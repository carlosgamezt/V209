-- NEXA FEL · MIGRACIÓN 30: TIPOS DE DOCUMENTO (DTE) — catálogo, habilitación por empresa, notas con referencia y recibos.
-- Es la migración 30 del proyecto (20261115000100): se aplica DESPUÉS de la 29 (28 → 29 → 30) y su versión queda REGISTRADA en el historial de migraciones. En una base hospedada solo se aplica con la etapa 4 de
-- «solo migraciones» (entorno protegido, confirmación literal, respaldo previo); una vez aplicada, este archivo es inmutable (su huella está en supabase/tests/inmutables_migraciones_29_30.sha256).
-- ADITIVA: crea 2 tablas, 5 columnas en `documentos`, 10 funciones, 5 disparadores y 2 políticas (cifras medidas: el esquema pasa de 69 a 71 tablas, de 49 a 51 políticas, de 185 a 195 funciones y de 61 a 66 disparadores).
-- No modifica ninguna función, política ni dato de las migraciones 1–29, y NO toca la migración 29.
-- Verificación posterior: docs/migracion-tipos-documento/verificacion-tipos.sql · reversión segura: docs/migracion-tipos-documento/reversion-tipos.sql.
-- NO habilita ningún tipo nuevo para certificar: solo FACT tiene certificacion_habilitada = true. NCRE, NDEB y RECI se pueden elegir (borrador, revisión, vista previa), pero la base IMPIDE crear una operación fiscal
-- para cualquier tipo no habilitado. Habilitar la certificación de un tipo es una migración futura explícita (tras verificar sus reglas SAT), nunca una configuración de empresa.
--
-- Reglas que impone la BASE (además de la API y el formulario):
--  · tipo_dte, documento_origen_id, referencia_origen, motivo_ajuste y tipo_recibo solo cambian en un borrador sin estado fiscal; un documento revisado o certificado es inmutable también en esto.
--  · NCRE/NDEB: obligatoriamente referencian un documento CERTIFICADO de la misma empresa, del tipo permitido (hoy solo FACT), con serie/número/autorización, al MISMO receptor. La referencia fiscal
--    (autorización, serie, número, fecha, total, receptor) la COPIA la base del documento de origen: nunca se acepta lo que escriba el usuario. El documento de origen no se modifica.
--  · NCRE (regla de PROYECTO, no de la SAT): lo acreditado por notas activas sobre un mismo origen no puede superar el total de ese origen; una nota idéntica (mismo origen, tipo, total y motivo) no se duplica.
--  · RECI: la empresa debe haberlo habilitado con la base escrita; no se admite una factura activa del mismo receptor, total y fecha (un recibo no sustituye a una factura).
--  · Habilitación por empresa: FACT siempre; los demás solo si la empresa los habilitó (fel_op_tipos_empresa_guardar). Los tipos «pendiente» no se pueden habilitar.

do $$ begin
  if to_regclass('public.documentos') is null or not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel_documento_guard')
     or not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel__exigir_permiso')
     or not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fel_auditar') then
    raise exception 'PRECONDICIÓN TIPOS: faltan objetos de las migraciones anteriores (documentos, fel_documento_guard, fel__exigir_permiso, fel_auditar)' using errcode = 'P0001'; end if;
  if to_regclass('public.fel_tipos_dte') is not null or to_regclass('public.empresa_tipos_documento') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name = 'tipo_dte') then
    raise exception 'PRECONDICIÓN TIPOS: ya existen objetos de esta migración; no se vuelve a aplicar' using errcode = 'P0001'; end if;
end $$;

-- ============================================================ catálogo (espejo de fel/proveedores/src/catalogo_dte.ts; una prueba compara ambos)
create table public.fel_tipos_dte (
  codigo                    text primary key check (codigo ~ '^[A-Z]{4}$'),
  nombre                    text not null,
  familia                   text not null check (familia in ('factura','nota','recibo','constancia','especial')),
  disponibilidad            text not null check (disponibilidad in ('implementado','en_pruebas','pendiente')),
  certificacion_habilitada  boolean not null default false,
  habilitacion_explicita    boolean not null default true,
  requiere_origen           boolean not null default false,
  origenes_permitidos       text[] not null default '{}',
  -- Solo un tipo IMPLEMENTADO puede certificar; un tipo «en pruebas» o «pendiente» jamás.
  constraint fel_tipos_cert_chk check (not certificacion_habilitada or disponibilidad = 'implementado'),
  constraint fel_tipos_origen_chk check (requiere_origen or origenes_permitidos = '{}')
);
insert into public.fel_tipos_dte (codigo, nombre, familia, disponibilidad, certificacion_habilitada, habilitacion_explicita, requiere_origen, origenes_permitidos) values
  ('FACT', 'Factura', 'factura', 'implementado', true, false, false, '{}'::text[]),
  ('NCRE', 'Nota de crédito', 'nota', 'en_pruebas', false, true, true, array['FACT']::text[]),
  ('NDEB', 'Nota de débito', 'nota', 'en_pruebas', false, true, true, array['FACT']::text[]),
  ('RECI', 'Recibo', 'recibo', 'en_pruebas', false, true, false, '{}'::text[]),
  ('FCAM', 'Factura cambiaria', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FPEQ', 'Factura pequeño contribuyente', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FCAP', 'Factura cambiaria pequeño contribuyente', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FESP', 'Factura especial', 'especial', 'pendiente', false, true, false, '{}'::text[]),
  ('NABN', 'Nota de abono', 'nota', 'pendiente', false, true, true, '{}'::text[]),
  ('RDON', 'Recibo por donación', 'recibo', 'pendiente', false, true, false, '{}'::text[]),
  ('FEPE', 'Factura específica', 'especial', 'pendiente', false, true, false, '{}'::text[]),
  ('FARP', 'Factura contribuyente régimen primario', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FCRP', 'Factura cambiaria contribuyente régimen primario', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FPEC', 'Factura contribuyente régimen pecuario', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('FCPC', 'Factura cambiaria contribuyente régimen pecuario', 'factura', 'pendiente', false, true, false, '{}'::text[]),
  ('CIVA', 'Constancia de exención de IVA', 'constancia', 'pendiente', false, true, false, '{}'::text[]),
  ('CAIS', 'Constancia de adquisición de insumos y servicios', 'constancia', 'pendiente', false, true, false, '{}'::text[]);

-- El catálogo es de solo lectura para toda la aplicación: se cambia únicamente con una migración.
create function public.fel_tipos_dte_inmutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'FEL_REGLA: el catálogo de tipos de documento solo se cambia con una migración'; end $$;
create trigger fel_tipos_dte_no_cambiar before update or delete or truncate on public.fel_tipos_dte for each statement execute function public.fel_tipos_dte_inmutable();
create trigger fel_tipos_dte_no_insertar before insert on public.fel_tipos_dte for each statement execute function public.fel_tipos_dte_inmutable();

-- ============================================================ habilitación y tipo predeterminado por empresa
create table public.empresa_tipos_documento (
  empresa_id         uuid not null references public.empresas (id),
  tipo_dte           text not null references public.fel_tipos_dte (codigo),
  habilitado         boolean not null default true,
  base_habilitacion  text check (base_habilitacion is null or length(btrim(base_habilitacion)) between 3 and 300),
  predeterminado     boolean not null default false,
  actualizado_por    uuid references auth.users (id),
  actualizado_en     timestamptz not null default now(),
  primary key (empresa_id, tipo_dte),
  constraint empresa_tipos_pred_chk check (not predeterminado or habilitado)
);
create unique index empresa_tipos_un_predeterminado_uq on public.empresa_tipos_documento (empresa_id) where predeterminado;

-- ============================================================ columnas del documento
alter table public.documentos
  add column tipo_dte            text not null default 'FACT' references public.fel_tipos_dte (codigo),
  add column documento_origen_id uuid,
  add column referencia_origen   jsonb,
  add column motivo_ajuste       text,
  add column tipo_recibo         text;
alter table public.documentos add constraint documentos_origen_fk foreign key (documento_origen_id, empresa_id) references public.documentos (id, empresa_id);
alter table public.documentos add constraint documentos_tipo_chk check (
      ((tipo_dte in ('NCRE','NDEB')) = (documento_origen_id is not null))
  and ((tipo_dte in ('NCRE','NDEB')) = (referencia_origen is not null))
  and (documento_origen_id is null or documento_origen_id <> id)
  and (tipo_dte in ('NCRE','NDEB') or motivo_ajuste is null)
  and (tipo_dte = 'RECI' or tipo_recibo is null)
  and (tipo_recibo is null or tipo_recibo in ('Universidad','Colegio','Inmobiliaria'))
  and (motivo_ajuste is null or length(btrim(motivo_ajuste)) between 3 and 50));
create index documentos_origen_idx on public.documentos (empresa_id, documento_origen_id) where documento_origen_id is not null;
create index documentos_tipo_idx on public.documentos (empresa_id, tipo_dte, estado_fiscal);

-- ============================================================ RLS y privilegios (las tablas no se escriben desde el cliente; todo pasa por las funciones fel_op_*)
alter table public.fel_tipos_dte enable row level security; alter table public.empresa_tipos_documento enable row level security;
create policy fel_tipos_dte_leer on public.fel_tipos_dte for select to authenticated using ((select auth.uid()) is not null);   -- catálogo no secreto, solo con sesión (sin política abierta «true»)
create policy empresa_tipos_leer on public.empresa_tipos_documento for select to authenticated using (public.fel_tiene_permiso(empresa_id, 'empresa.ver'));
revoke all on public.fel_tipos_dte, public.empresa_tipos_documento from public, anon, authenticated;
grant select on public.fel_tipos_dte, public.empresa_tipos_documento to authenticated;

-- ============================================================ utilidades
-- ¿Puede la empresa usar este tipo? (catálogo + habilitación + base legal del recibo). Devuelve null si sí; el motivo si no.
create function public.fel__tipo_no_habilitado(p_empresa uuid, p_tipo text) returns text language plpgsql stable set search_path = '' as $$
declare t public.fel_tipos_dte; h public.empresa_tipos_documento;
begin
  select * into t from public.fel_tipos_dte where codigo = p_tipo;
  if not found then return 'tipo de documento desconocido'; end if;
  if t.disponibilidad = 'pendiente' then return t.nombre || ' aún no está disponible'; end if;
  if not t.habilitacion_explicita then return null; end if;
  select * into h from public.empresa_tipos_documento where empresa_id = p_empresa and tipo_dte = p_tipo;
  if not found or not h.habilitado then return t.nombre || ' no está habilitado para esta empresa'; end if;
  if t.familia = 'recibo' and coalesce(btrim(h.base_habilitacion), '') = '' then return 'el recibo exige registrar la base que habilita a la empresa para emitirlo'; end if;
  return null;
end $$;

-- Identificación del receptor de un documento en la forma del NUC (CF o NIT/CUI sin guiones).
create function public.fel__receptor_id(p_empresa uuid, p_cliente uuid) returns text language sql stable set search_path = '' as $$
  select case when c.tipo_identificacion = 'CF' then 'CF' else upper(replace(c.numero_identificacion, '-', '')) end
    from public.clientes c where c.id = p_cliente and c.empresa_id = p_empresa $$;

-- ============================================================ guardián del tipo (se suma al de documentos: no lo reemplaza)
create function public.fel_documento_tipo_guard() returns trigger language plpgsql set search_path = '' as $$
declare t public.fel_tipos_dte; o public.documentos; v_motivo text; v_total numeric; v_acreditado numeric; v_origen_total numeric; v_cambia boolean; v_revision boolean;
begin
  select * into t from public.fel_tipos_dte where codigo = new.tipo_dte;
  v_cambia := tg_op = 'INSERT' or new.tipo_dte is distinct from old.tipo_dte or new.documento_origen_id is distinct from old.documento_origen_id
              or new.referencia_origen is distinct from old.referencia_origen or new.motivo_ajuste is distinct from old.motivo_ajuste or new.tipo_recibo is distinct from old.tipo_recibo;
  v_revision := new.estado_preparacion = 'revisado' and (tg_op = 'INSERT' or old.estado_preparacion <> 'revisado');
  if tg_op = 'UPDATE' and v_cambia and not (old.estado_preparacion = 'borrador' and old.estado_fiscal = 'ninguno') then
    raise exception 'FEL_REGLA: el tipo de documento, su referencia y su motivo solo se cambian en un borrador sin estado fiscal';
  end if;
  -- ¿la empresa puede usar el tipo? (al crear, al cambiarlo y al revisar: si la habilitación se retiró, un borrador no se puede revisar)
  if v_cambia or v_revision then
    v_motivo := public.fel__tipo_no_habilitado(new.empresa_id, new.tipo_dte);
    if v_motivo is not null then raise exception 'FEL_REGLA: %', v_motivo; end if;
  end if;
  if t.requiere_origen then
    if new.documento_origen_id is null then raise exception 'FEL_REGLA: % exige el documento certificado al que hace referencia', t.nombre; end if;
    if v_cambia or v_revision then
      perform pg_advisory_xact_lock(hashtextextended('fel_origen:' || new.documento_origen_id::text, 0));
      select * into o from public.documentos where id = new.documento_origen_id and empresa_id = new.empresa_id;
      if not found then raise exception 'FEL_REGLA: el documento de origen no existe en esta empresa'; end if;
      if o.tipo_dte <> all (t.origenes_permitidos) then raise exception 'FEL_REGLA: % solo puede hacer referencia a un documento de tipo %', t.nombre, array_to_string(t.origenes_permitidos, ' o '); end if;
      if o.estado_fiscal <> 'certificado' then raise exception 'FEL_REGLA: el documento de origen debe estar certificado (estado actual: %)', o.estado_fiscal; end if;
      if o.serie is null or o.numero_fiscal is null or o.autorizacion_sat is null then raise exception 'FEL_REGLA: el documento de origen no tiene serie, número y autorización'; end if;
      if new.cliente_id is distinct from o.cliente_id then raise exception 'FEL_REGLA: la nota debe dirigirse al mismo receptor del documento de origen'; end if;
      -- La referencia fiscal se COPIA del documento certificado: lo que venga de fuera se descarta.
      new.referencia_origen := jsonb_build_object('documento_id', o.id, 'tipo', o.tipo_dte, 'autorizacion', o.autorizacion_sat, 'serie', o.serie, 'numero', o.numero_fiscal,
        'fecha_emision', to_char(o.certificacion_verificada_en at time zone 'America/Guatemala', 'YYYY-MM-DD'), 'total', coalesce(o.total, o.base_imponible)::text,
        'receptor_id', coalesce(public.fel__receptor_id(o.empresa_id, o.cliente_id), 'CF'));
    end if;
    if v_revision then
      if new.motivo_ajuste is null or length(btrim(new.motivo_ajuste)) not between 3 and 50 then raise exception 'FEL_REGLA: indica el motivo del ajuste (3 a 50 caracteres)'; end if;
      select * into o from public.documentos where id = new.documento_origen_id and empresa_id = new.empresa_id;
      v_total := coalesce(new.total, new.base_imponible);
      if v_total is null or v_total <= 0 then raise exception 'FEL_REGLA: la nota debe tener un importe mayor que cero'; end if;
      -- duplicado: otra nota ACTIVA idéntica (mismo origen, tipo, importe y motivo)
      if exists (select 1 from public.documentos d where d.empresa_id = new.empresa_id and d.documento_origen_id = new.documento_origen_id and d.tipo_dte = new.tipo_dte and d.id <> new.id
                   and d.estado_preparacion = 'revisado' and d.estado_fiscal not in ('rechazado','anulado') and coalesce(d.total, d.base_imponible) = v_total and lower(btrim(d.motivo_ajuste)) = lower(btrim(new.motivo_ajuste))) then
        raise exception 'FEL_REGLA: ya existe una % activa idéntica sobre ese documento (mismo importe y motivo): posible duplicado', t.nombre;
      end if;
      if new.tipo_dte = 'NCRE' then
        v_origen_total := coalesce(o.total, o.base_imponible);
        select coalesce(sum(coalesce(d.total, d.base_imponible)), 0) into v_acreditado from public.documentos d
         where d.empresa_id = new.empresa_id and d.documento_origen_id = new.documento_origen_id and d.tipo_dte = 'NCRE' and d.id <> new.id
           and d.estado_preparacion = 'revisado' and d.estado_fiscal not in ('rechazado','anulado');
        if v_origen_total is not null and v_acreditado + v_total > v_origen_total then
          raise exception 'FEL_REGLA: las notas de crédito sobre el documento de origen (% ya acreditados + %) superarían su total (%)', v_acreditado, v_total, v_origen_total;
        end if;
      end if;
    end if;
  else
    if new.documento_origen_id is not null or new.referencia_origen is not null or new.motivo_ajuste is not null then raise exception 'FEL_REGLA: % no hace referencia a otro documento', t.nombre; end if;
  end if;
  if t.codigo = 'RECI' then
    if v_revision then
      if new.tipo_recibo is null then raise exception 'FEL_REGLA: el recibo exige su tipo (Universidad, Colegio o Inmobiliaria)'; end if;
      -- un recibo no sustituye a una factura: no se admite si ya hay una factura activa al mismo receptor por el mismo total y fecha
      if exists (select 1 from public.documentos d where d.empresa_id = new.empresa_id and d.tipo_dte = 'FACT' and d.cliente_id is not distinct from new.cliente_id and d.id <> new.id
                   and coalesce(d.total, d.base_imponible) is not distinct from coalesce(new.total, new.base_imponible) and d.fecha_emision_prevista is not distinct from new.fecha_emision_prevista
                   and d.estado_preparacion = 'revisado' and d.estado_fiscal not in ('rechazado','anulado')) then
        raise exception 'FEL_REGLA: ya existe una factura activa a este receptor por el mismo importe y fecha: un recibo no sustituye a una factura';
      end if;
    end if;
  elsif new.tipo_recibo is not null then raise exception 'FEL_REGLA: solo el recibo lleva tipo de recibo';
  end if;
  return new;
end $$;
create trigger fel_documento_tipo_guard_t before insert or update on public.documentos for each row execute function public.fel_documento_tipo_guard();

-- ============================================================ las operaciones fiscales exigen un tipo con certificación habilitada
create function public.fel_operacion_tipo_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_tipo text; v_ok boolean;
begin
  select d.tipo_dte, t.certificacion_habilitada into v_tipo, v_ok from public.documentos d join public.fel_tipos_dte t on t.codigo = d.tipo_dte where d.id = new.documento_id and d.empresa_id = new.empresa_id;
  if not found then return new; end if;   -- documento inexistente o de otra empresa: lo rechazan las claves foráneas compuestas, con su propio mensaje
  if v_ok is distinct from true then
    raise exception 'FEL_REGLA: la certificación del tipo de documento «%» aún no está habilitada (solo validación y vista previa)', coalesce(v_tipo, '?');
  end if;
  return new;
end $$;
create trigger fel_operacion_tipo_guard_t before insert on public.operaciones_fiscales for each row execute function public.fel_operacion_tipo_guard();

-- Guardián equivalente para las operaciones de Digifact de la migración 29 (otra tabla). No se instala aquí porque la 29 puede aplicarse después; el procedimiento de la 29 ejecuta
-- «select public.fel_tipos_instalar_guardian_digifact();» al terminar (idempotente: no hace nada si la tabla no existe o el guardián ya está).
create function public.fel_tipos_instalar_guardian_digifact() returns text language plpgsql set search_path = '' as $$
begin
  if to_regclass('public.digifact_operaciones') is null then return 'sin tabla digifact_operaciones: nada que instalar'; end if;
  if exists (select 1 from pg_trigger where tgname = 'fel_digifact_tipo_guard_t' and tgrelid = 'public.digifact_operaciones'::regclass) then return 'ya instalado'; end if;
  execute 'create trigger fel_digifact_tipo_guard_t before insert on public.digifact_operaciones for each row execute function public.fel_operacion_tipo_guard()';
  return 'instalado';
end $$;
select public.fel_tipos_instalar_guardian_digifact();

-- ============================================================ funciones de la aplicación
-- Configuración de la empresa (lectura): qué tipos habilitó y cuál es el predeterminado. Los datos de catálogo ricos (campos, complementos, pendientes) viven en el código.
create function public.fel_tipos_empresa(p_actor uuid, p_empresa uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'empresa.ver');
  return jsonb_build_object(
    'tipos', (select coalesce(jsonb_agg(jsonb_build_object('codigo', t.codigo, 'nombre', t.nombre, 'disponibilidad', t.disponibilidad, 'certificacion_habilitada', t.certificacion_habilitada,
              'requiere_origen', t.requiere_origen, 'habilitado', public.fel__tipo_no_habilitado(p_empresa, t.codigo) is null, 'motivo', public.fel__tipo_no_habilitado(p_empresa, t.codigo),
              'base_habilitacion', h.base_habilitacion, 'predeterminado', coalesce(h.predeterminado, false)) order by t.codigo = 'FACT' desc, t.disponibilidad, t.codigo), '[]'::jsonb)
                from public.fel_tipos_dte t left join public.empresa_tipos_documento h on h.empresa_id = p_empresa and h.tipo_dte = t.codigo),
    'predeterminado', coalesce((select h.tipo_dte from public.empresa_tipos_documento h where h.empresa_id = p_empresa and h.predeterminado and public.fel__tipo_no_habilitado(p_empresa, h.tipo_dte) is null), 'FACT'));
end $$;

-- Habilitar / deshabilitar un tipo para la empresa y fijar el predeterminado. Solo quien puede editar la empresa. Los tipos pendientes no se pueden habilitar.
create function public.fel_op_tipos_empresa_guardar(p_actor uuid, p_empresa uuid, p_tipo text, p_habilitado boolean, p_base text, p_predeterminado boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.fel_tipos_dte; v_base text := nullif(btrim(coalesce(p_base, '')), '');
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'empresa.editar');
  select * into t from public.fel_tipos_dte where codigo = p_tipo;
  if not found then raise exception 'FEL_REGLA: tipo de documento desconocido'; end if;
  if t.disponibilidad = 'pendiente' and (p_habilitado or p_predeterminado) then raise exception 'FEL_REGLA: % aún no está disponible y no se puede habilitar', t.nombre; end if;
  if p_predeterminado and not p_habilitado then raise exception 'FEL_REGLA: el tipo predeterminado debe estar habilitado'; end if;
  if p_habilitado and t.familia = 'recibo' and v_base is null then raise exception 'FEL_REGLA: para habilitar el recibo registra la base que habilita a la empresa para emitirlo'; end if;
  if p_predeterminado then update public.empresa_tipos_documento set predeterminado = false, actualizado_por = p_actor, actualizado_en = now() where empresa_id = p_empresa and predeterminado and tipo_dte <> p_tipo; end if;
  insert into public.empresa_tipos_documento (empresa_id, tipo_dte, habilitado, base_habilitacion, predeterminado, actualizado_por) values (p_empresa, p_tipo, p_habilitado, v_base, p_predeterminado, p_actor)
    on conflict (empresa_id, tipo_dte) do update set habilitado = excluded.habilitado, base_habilitacion = excluded.base_habilitacion, predeterminado = excluded.predeterminado, actualizado_por = p_actor, actualizado_en = now();
  perform public.fel_auditar(p_empresa, p_actor, 'empresa.tipo_documento', 'empresa', p_empresa::text, jsonb_build_object('tipo', p_tipo, 'habilitado', p_habilitado, 'predeterminado', p_predeterminado, 'con_base', v_base is not null));
  return public.fel_tipos_empresa(p_actor, p_empresa);
end $$;

-- Candidatos de origen para una nota: documentos CERTIFICADOS de la empresa de un tipo permitido (con lo ya acreditado por otras notas). Solo lectura.
create function public.fel_op_documento_origenes(p_actor uuid, p_empresa uuid, p_tipo text, p_cliente uuid default null, p_buscar text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.fel_tipos_dte; v_q text := nullif(btrim(coalesce(p_buscar, '')), '');
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.ver');
  select * into t from public.fel_tipos_dte where codigo = p_tipo;
  if not found or not t.requiere_origen then raise exception 'FEL_REGLA: este tipo no hace referencia a otro documento'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', d.id, 'numero_borrador', d.numero_borrador, 'tipo_dte', d.tipo_dte, 'serie', d.serie, 'numero_fiscal', d.numero_fiscal, 'cliente_id', d.cliente_id,
             'cliente_nombre', c.nombre, 'receptor_id', public.fel__receptor_id(d.empresa_id, d.cliente_id), 'fecha_emision', to_char(d.certificacion_verificada_en at time zone 'America/Guatemala', 'YYYY-MM-DD'),
             'total', coalesce(d.total, d.base_imponible)::text,
             'acreditado', (select coalesce(sum(coalesce(n.total, n.base_imponible)), 0)::text from public.documentos n where n.empresa_id = d.empresa_id and n.documento_origen_id = d.id and n.tipo_dte = 'NCRE'
                              and n.estado_preparacion = 'revisado' and n.estado_fiscal not in ('rechazado','anulado'))) as x
      from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
     where d.empresa_id = p_empresa and d.tipo_dte = any (t.origenes_permitidos) and d.estado_fiscal = 'certificado' and d.serie is not null and d.numero_fiscal is not null and d.autorizacion_sat is not null
       and (p_cliente is null or d.cliente_id = p_cliente)
       and (v_q is null or d.numero_fiscal ilike '%' || v_q || '%' or d.serie ilike '%' || v_q || '%' or coalesce(c.nombre, '') ilike '%' || v_q || '%')
     order by d.certificacion_verificada_en desc nulls last limit 50) q), '[]'::jsonb);
end $$;

-- Asigna el tipo (y, en una nota, el origen y el motivo; en un recibo, su tipo) a un BORRADOR. Optimista: exige la versión. El guardián valida todo y copia la referencia del origen.
create function public.fel_op_documento_tipo(p_actor uuid, p_empresa uuid, p_doc uuid, p_tipo text, p_origen uuid, p_motivo text, p_tipo_recibo text, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos; t public.fel_tipos_dte;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'borradores.editar');
  select * into t from public.fel_tipos_dte where codigo = p_tipo;
  if not found then raise exception 'FEL_REGLA: tipo de documento desconocido'; end if;
  select * into v from public.documentos where id = p_doc and empresa_id = p_empresa for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: documento no encontrado'; end if;
  if p_version is null or p_version <> v.version then raise exception 'FEL_CONFLICTO: el documento cambió; recarga e intenta de nuevo'; end if;
  if v.estado_preparacion <> 'borrador' or v.estado_fiscal <> 'ninguno' then raise exception 'FEL_REGLA: el tipo solo se cambia en un borrador sin estado fiscal'; end if;
  if v.tipo_dte = p_tipo and v.documento_origen_id is not distinct from p_origen and v.motivo_ajuste is not distinct from nullif(btrim(coalesce(p_motivo, '')), '') and v.tipo_recibo is not distinct from p_tipo_recibo then return; end if;
  -- una nota toma el receptor del documento de origen (el formulario lo bloquea; aquí se impone)
  update public.documentos set tipo_dte = p_tipo, documento_origen_id = case when t.requiere_origen then p_origen end, referencia_origen = null,
         motivo_ajuste = case when t.requiere_origen then nullif(btrim(coalesce(p_motivo, '')), '') end, tipo_recibo = case when p_tipo = 'RECI' then p_tipo_recibo end,
         cliente_id = case when t.requiere_origen and p_origen is not null then (select o.cliente_id from public.documentos o where o.id = p_origen and o.empresa_id = p_empresa) else cliente_id end,
         actualizado_por = p_actor, version = version + 1
   where id = p_doc and empresa_id = p_empresa;
  perform public.fel_auditar(p_empresa, p_actor, 'documento.tipo', 'documento', p_doc::text, jsonb_build_object('de', v.tipo_dte, 'a', p_tipo, 'origen', p_origen));
end $$;

-- Disparadores y el instalador del guardián: ningún rol de la API los ejecuta (como el resto de disparadores de «public»; lo comprueban las pruebas 08 y 28).
revoke all on function public.fel_tipos_dte_inmutable(), public.fel_documento_tipo_guard(), public.fel_operacion_tipo_guard(), public.fel_tipos_instalar_guardian_digifact() from public, anon, authenticated, service_role;
-- Utilidades de solo lectura: las usa el servidor (service_role), nunca el navegador.
revoke all on function public.fel__tipo_no_habilitado(uuid, text), public.fel__receptor_id(uuid, uuid) from public, anon, authenticated;
-- Funciones de la aplicación: solo el servidor (service_role), nunca el navegador.
revoke all on function public.fel_tipos_empresa(uuid, uuid), public.fel_op_tipos_empresa_guardar(uuid, uuid, text, boolean, text, boolean),
  public.fel_op_documento_origenes(uuid, uuid, text, uuid, text), public.fel_op_documento_tipo(uuid, uuid, uuid, text, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.fel_tipos_empresa(uuid, uuid), public.fel_op_tipos_empresa_guardar(uuid, uuid, text, boolean, text, boolean),
  public.fel_op_documento_origenes(uuid, uuid, text, uuid, text), public.fel_op_documento_tipo(uuid, uuid, uuid, text, uuid, text, text, integer) to service_role;
