-- D2-4 · Conciliación del bolsón: extractos del proveedor, partidas de diferencia, aprobación por DOS personas y ajustes auditables.
-- Mundo A (lo que informa el proveedor) contra mundo B (lo que midió NEXA). Todo solo para la plataforma; las empresas no ven nada de esto.
-- Reglas: un extracto no se modifica ni se importa dos veces; una diferencia nunca se corrige "en silencio": se resuelve UNA vez, con motivo, y deja un movimiento en el libro.

-- ============================================================ conciliaciones (una por extracto)
create table public.bolson_conciliaciones (
  id            uuid primary key default gen_random_uuid(),
  cuenta_id     uuid not null references public.bolson_cuentas (id),
  extracto_id   uuid not null unique,
  estado        text not null default 'propuesta' check (estado in ('propuesta','aprobada','rechazada')),
  propuesta_por uuid not null references auth.users (id),
  propuesta_en  timestamptz not null default clock_timestamp(),
  decidida_por  uuid references auth.users (id),
  decidida_en   timestamptz,
  nota          text check (nota is null or length(btrim(nota)) between 5 and 300),
  resumen       jsonb not null,
  foreign key (extracto_id, cuenta_id) references public.bolson_extractos (id, cuenta_id),
  unique (id, cuenta_id),
  check ((estado = 'propuesta') = (decidida_en is null)),
  check (decidida_por is null or decidida_por <> propuesta_por)                      -- la aprueba OTRA persona
);
create table public.bolson_conciliacion_partidas (
  id                 uuid primary key default gen_random_uuid(),
  conciliacion_id    uuid not null,
  cuenta_id          uuid not null,
  clasificacion      text not null check (clasificacion in ('coincide','faltante_en_nexa','sobrante_en_nexa','diferencia_unidades')),
  extracto_linea_id  uuid references public.bolson_extracto_lineas (id),
  consumo_id         uuid,
  empresa_id         uuid references public.empresas (id),
  referencia         text,
  unidades_extracto  numeric(20,6) not null default 0 check (unidades_extracto >= 0),
  unidades_nexa      numeric(20,6) not null default 0 check (unidades_nexa >= 0),
  diferencia         numeric(20,6) generated always as (unidades_extracto - unidades_nexa) stored,
  foreign key (conciliacion_id, cuenta_id) references public.bolson_conciliaciones (id, cuenta_id),
  foreign key (consumo_id, cuenta_id) references public.consumos (id, cuenta_id),
  unique (id, cuenta_id),
  check ((clasificacion = 'coincide') = (unidades_extracto - unidades_nexa = 0)),
  check (clasificacion <> 'faltante_en_nexa' or (consumo_id is null and unidades_nexa = 0)),
  check (clasificacion <> 'sobrante_en_nexa' or (extracto_linea_id is null and unidades_extracto = 0 and consumo_id is not null))
);
create table public.bolson_partida_resoluciones (
  id           uuid primary key default gen_random_uuid(),
  partida_id   uuid not null unique,
  cuenta_id    uuid not null,
  accion       text not null check (accion in ('ajustar_saldo','atribuir_empresa','justificar')),
  unidades     numeric(20,6) not null default 0 check (unidades >= 0),
  empresa_id   uuid references public.empresas (id),
  movimiento_id bigint references public.bolson_movimientos (id),
  motivo       text not null check (length(btrim(motivo)) between 10 and 300),
  resuelta_por uuid not null references auth.users (id),
  resuelta_en  timestamptz not null default clock_timestamp(),
  foreign key (partida_id, cuenta_id) references public.bolson_conciliacion_partidas (id, cuenta_id),
  check ((accion = 'atribuir_empresa') = (empresa_id is not null)),
  check ((accion = 'justificar') = (movimiento_id is null))
);
-- Un movimiento del libro puede nacer de una partida de conciliación (la columna existía desde D2-2).
alter table public.bolson_movimientos add constraint bolson_mov_partida_fk foreign key (conciliacion_partida_id) references public.bolson_conciliacion_partidas (id);

create or replace function public.fel_bolson_conciliacion_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FEL_APPEND_ONLY: las conciliaciones no se borran'; end if;
  if old.estado <> 'propuesta' then raise exception 'FEL_APPEND_ONLY: una conciliación decidida no se modifica'; end if;
  if (new.id, new.cuenta_id, new.extracto_id, new.propuesta_por, new.propuesta_en) is distinct from (old.id, old.cuenta_id, old.extracto_id, old.propuesta_por, old.propuesta_en) then
    raise exception 'FEL_APPEND_ONLY: solo se puede decidir una conciliación propuesta';
  end if;
  if new.resumen is distinct from old.resumen and old.resumen <> '{}'::jsonb then raise exception 'FEL_APPEND_ONLY: el resumen de una conciliación se fija una sola vez'; end if;
  if new.resumen = '{}'::jsonb and new.estado <> 'propuesta' then raise exception 'FEL_REGLA: no se decide una conciliación sin resumen'; end if;
  if new.estado = 'propuesta' and new.resumen = old.resumen then raise exception 'FEL_REGLA: la decisión debe ser aprobar o rechazar'; end if;
  return new;
end $$;
create trigger bolson_conciliaciones_guard before update or delete on public.bolson_conciliaciones for each row execute function public.fel_bolson_conciliacion_guard();
create trigger bolson_partidas_solo_insertar before update or delete on public.bolson_conciliacion_partidas for each row execute function public.fel_solo_insertar();
create trigger bolson_resoluciones_solo_insertar before update or delete on public.bolson_partida_resoluciones for each row execute function public.fel_solo_insertar();

-- ============================================================ importar un extracto (idempotente por contenido; las líneas ya importadas no se duplican)
create or replace function public.fel_admin_bolson_extracto_importar(
  p_actor uuid, p_cuenta uuid, p_desde date, p_hasta date, p_fuente text, p_saldo_inicial numeric, p_saldo_final numeric, p_lineas jsonb) returns public.bolson_extractos
language plpgsql security definer set search_path = '' as $$
declare v_x public.bolson_extractos; v_hash text; v_l jsonb; v_i integer := 0;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if not exists (select 1 from public.bolson_cuentas where id = p_cuenta) then raise exception 'FEL_NO_ENCONTRADO: cuenta del bolsón no encontrada'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'FEL_REGLA: periodo no válido'; end if;
  if p_fuente not in ('api','archivo','manual') then raise exception 'FEL_REGLA: fuente no válida'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) > 5000 then raise exception 'FEL_REGLA: las líneas deben ser una lista de hasta 5000'; end if;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_l) <> 'object' or coalesce(length(btrim(v_l->>'referencia')), 0) not between 1 and 200 or coalesce(length(btrim(v_l->>'evento')), 0) not between 1 and 80
       or (v_l->>'unidades') !~ '^\d{1,14}(\.\d{1,6})?$' or (v_l->>'ocurrido_en') is null then
      raise exception 'FEL_REGLA: línea % del extracto no válida', v_i + 1;
    end if;
    v_i := v_i + 1;
  end loop;
  v_hash := encode(sha256(convert_to(p_cuenta::text || '|' || p_desde::text || '|' || p_hasta::text || '|' || p_lineas::text, 'UTF8')), 'hex');
  select * into v_x from public.bolson_extractos where cuenta_id = p_cuenta and hash_contenido = v_hash;
  if found then return v_x; end if;
  insert into public.bolson_extractos (cuenta_id, periodo_desde, periodo_hasta, fuente, hash_contenido, saldo_inicial, saldo_final, importado_por)
  values (p_cuenta, p_desde, p_hasta, p_fuente, v_hash, p_saldo_inicial, p_saldo_final, p_actor) returning * into v_x;
  insert into public.bolson_extracto_lineas (extracto_id, cuenta_id, numero_linea, referencia_externa, evento_externo, unidades, ocurrido_en, nit_declarado, hash_linea)
  select v_x.id, p_cuenta, t.n, btrim(t.l->>'referencia'), btrim(t.l->>'evento'), (t.l->>'unidades')::numeric, (t.l->>'ocurrido_en')::timestamptz, nullif(btrim(t.l->>'nit'), ''),
         encode(sha256(convert_to(p_cuenta::text || '|' || btrim(t.l->>'referencia') || '|' || btrim(t.l->>'evento') || '|' || ((t.l->>'unidades')::numeric)::text || '|' || ((t.l->>'ocurrido_en')::timestamptz)::text, 'UTF8')), 'hex')
    from jsonb_array_elements(p_lineas) with ordinality as t(l, n)
  on conflict (cuenta_id, hash_linea) do nothing;                                      -- extractos solapados: la línea ya existe y no se cuenta dos veces
  perform public.fel_auditar(null, p_actor, 'bolson.extracto_importado', 'bolson_extracto', v_x.id::text, jsonb_build_object('cuenta', p_cuenta, 'lineas', jsonb_array_length(p_lineas), 'desde', p_desde, 'hasta', p_hasta));
  return v_x;
end $$;

-- ============================================================ proponer la conciliación (compara el extracto con los consumos confirmados de NEXA)
create or replace function public.fel_admin_bolson_conciliar_proponer(p_actor uuid, p_extracto uuid) returns public.bolson_conciliaciones
language plpgsql security definer set search_path = '' as $$
declare v_x public.bolson_extractos; v_c public.bolson_conciliaciones; v_res jsonb; v_dif integer; v_s public.bolson_saldos;
begin
  perform public.fel__exigir_plataforma(p_actor);
  select * into v_x from public.bolson_extractos where id = p_extracto;
  if not found then raise exception 'FEL_NO_ENCONTRADO: extracto no encontrado'; end if;
  select * into v_c from public.bolson_conciliaciones where extracto_id = p_extracto;
  if found then return v_c; end if;
  perform 1 from public.bolson_saldos where cuenta_id = v_x.cuenta_id for update;       -- fotografía estable de los saldos mientras se compara
  insert into public.bolson_conciliaciones (cuenta_id, extracto_id, propuesta_por, resumen) values (v_x.cuenta_id, p_extracto, p_actor, '{}'::jsonb) returning * into v_c;
  -- 1. cada línea del extracto: ¿qué consumo confirmado de NEXA la explica?
  insert into public.bolson_conciliacion_partidas (conciliacion_id, cuenta_id, clasificacion, extracto_linea_id, consumo_id, empresa_id, referencia, unidades_extracto, unidades_nexa)
  select v_c.id, v_x.cuenta_id,
         case when c.id is null then (case when l.unidades = 0 then 'coincide' else 'faltante_en_nexa' end)
              when c.unidades_consumidas = l.unidades then 'coincide' else 'diferencia_unidades' end,
         l.id, c.id, c.empresa_id, l.referencia_externa, l.unidades, coalesce(c.unidades_consumidas, 0)
    from public.bolson_extracto_lineas l
    left join lateral (select x.* from public.consumos x where x.cuenta_id = l.cuenta_id and x.estado = 'confirmado' and x.referencia_externa = l.referencia_externa
                          and not exists (select 1 from public.bolson_conciliacion_partidas pp join public.bolson_conciliaciones cc on cc.id = pp.conciliacion_id
                                           where pp.consumo_id = x.id and cc.estado <> 'rechazada' and cc.id <> v_c.id) order by x.resuelto_en limit 1) c on true
   where l.extracto_id = p_extracto;
  -- 2. consumos confirmados de NEXA en el periodo que el proveedor NO informa
  insert into public.bolson_conciliacion_partidas (conciliacion_id, cuenta_id, clasificacion, consumo_id, empresa_id, referencia, unidades_extracto, unidades_nexa)
  select v_c.id, v_x.cuenta_id, 'sobrante_en_nexa', c.id, c.empresa_id, c.referencia_externa, 0, c.unidades_consumidas
    from public.consumos c
   where c.cuenta_id = v_x.cuenta_id and c.estado = 'confirmado' and c.unidades_consumidas > 0
     and c.resuelto_en >= v_x.periodo_desde::timestamptz and c.resuelto_en < (v_x.periodo_hasta + 1)::timestamptz
     and not exists (select 1 from public.bolson_conciliacion_partidas pp join public.bolson_conciliaciones cc on cc.id = pp.conciliacion_id where pp.consumo_id = c.id and cc.estado <> 'rechazada');
  select count(*) into v_dif from public.bolson_conciliacion_partidas where conciliacion_id = v_c.id and clasificacion <> 'coincide';
  select * into v_s from public.bolson_saldos where cuenta_id = v_x.cuenta_id;
  select jsonb_build_object('lineas', count(*) filter (where extracto_linea_id is not null), 'coinciden', count(*) filter (where clasificacion = 'coincide'), 'faltantes_en_nexa', count(*) filter (where clasificacion = 'faltante_en_nexa'),
         'sobrantes_en_nexa', count(*) filter (where clasificacion = 'sobrante_en_nexa'), 'diferencias_unidades', count(*) filter (where clasificacion = 'diferencia_unidades'),
         'unidades_extracto', coalesce(sum(unidades_extracto), 0), 'unidades_nexa', coalesce(sum(unidades_nexa), 0), 'diferencia_neta', coalesce(sum(unidades_extracto - unidades_nexa), 0),
         'saldo_final_extracto', v_x.saldo_final, 'saldo_nexa', v_s.comprado + v_s.ajustado - v_s.consumido - v_s.reservado) into v_res
    from public.bolson_conciliacion_partidas where conciliacion_id = v_c.id;
  update public.bolson_conciliaciones set resumen = v_res where id = v_c.id;       -- el resumen se fija UNA vez (la guarda lo impide después)
  select * into v_c from public.bolson_conciliaciones where id = v_c.id;
  if v_dif > 0 then perform public.fel__bolson_alertar(v_x.cuenta_id, null, null, 'diferencia_conciliacion', jsonb_build_object('conciliacion', v_c.id, 'diferencias', v_dif)); end if;
  perform public.fel_auditar(null, p_actor, 'bolson.conciliacion_propuesta', 'bolson_conciliacion', v_c.id::text, jsonb_build_object('extracto', p_extracto, 'diferencias', v_dif));
  return v_c;
end $$;

-- ============================================================ decidir: la aprueba o rechaza OTRA persona
create or replace function public.fel_admin_bolson_conciliar_decidir(p_actor uuid, p_conciliacion uuid, p_aprobar boolean, p_nota text) returns public.bolson_conciliaciones
language plpgsql security definer set search_path = '' as $$
declare v_c public.bolson_conciliaciones;
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_nota is null or length(btrim(p_nota)) < 5 then raise exception 'FEL_REGLA: la nota es obligatoria (mínimo 5 caracteres)'; end if;
  select * into v_c from public.bolson_conciliaciones where id = p_conciliacion for update;
  if not found then raise exception 'FEL_NO_ENCONTRADO: conciliación no encontrada'; end if;
  if v_c.estado <> 'propuesta' then raise exception 'FEL_ESTADO: la conciliación ya fue decidida (%)', v_c.estado; end if;
  if v_c.propuesta_por = p_actor then raise exception 'FEL_NO_AUTORIZADO: la conciliación la debe decidir otra persona distinta de quien la propuso'; end if;
  update public.bolson_conciliaciones set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, decidida_por = p_actor, decidida_en = clock_timestamp(), nota = btrim(p_nota) where id = p_conciliacion returning * into v_c;
  perform public.fel_auditar(null, p_actor, 'bolson.conciliacion_' || v_c.estado, 'bolson_conciliacion', v_c.id::text, jsonb_build_object('nota', btrim(p_nota)));
  return v_c;
end $$;

-- ============================================================ resolver una partida (UNA vez, con motivo; deja un movimiento en el libro si cambia el saldo o atribuye consumo)
create or replace function public.fel_admin_bolson_partida_resolver(p_actor uuid, p_partida uuid, p_accion text, p_empresa uuid, p_motivo text) returns public.bolson_partida_resoluciones
language plpgsql security definer set search_path = '' as $$
declare v_p public.bolson_conciliacion_partidas; v_c public.bolson_conciliaciones; v_r public.bolson_partida_resoluciones; v_mov bigint; v_u numeric(20,6);
begin
  perform public.fel__exigir_plataforma(p_actor);
  if p_accion not in ('ajustar_saldo','atribuir_empresa','justificar') then raise exception 'FEL_REGLA: acción no válida'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then raise exception 'FEL_REGLA: el motivo es obligatorio (mínimo 10 caracteres)'; end if;
  select * into v_p from public.bolson_conciliacion_partidas where id = p_partida;
  if not found then raise exception 'FEL_NO_ENCONTRADO: partida no encontrada'; end if;
  select * into v_c from public.bolson_conciliaciones where id = v_p.conciliacion_id for update;
  perform 1 from public.bolson_saldos where cuenta_id = v_p.cuenta_id for update;
  select * into v_r from public.bolson_partida_resoluciones where partida_id = p_partida;
  if found then
    if v_r.accion = p_accion and v_r.empresa_id is not distinct from p_empresa then return v_r; end if;
    raise exception 'FEL_CONFLICTO: la partida ya fue resuelta de otra manera';
  end if;
  if v_c.estado <> 'aprobada' then raise exception 'FEL_ESTADO: solo se resuelven partidas de una conciliación aprobada'; end if;
  if v_p.clasificacion = 'coincide' then raise exception 'FEL_REGLA: una partida que coincide no requiere resolución'; end if;
  v_u := abs(v_p.diferencia);
  if p_accion = 'justificar' then
    insert into public.bolson_partida_resoluciones (partida_id, cuenta_id, accion, unidades, motivo, resuelta_por) values (p_partida, v_p.cuenta_id, p_accion, 0, btrim(p_motivo), p_actor) returning * into v_r;
  elsif p_accion = 'ajustar_saldo' then
    if p_empresa is not null then raise exception 'FEL_REGLA: un ajuste de saldo no se atribuye a una empresa'; end if;
    insert into public.bolson_movimientos (cuenta_id, tipo, unidades, sentido, conciliacion_partida_id, motivo, creado_por)
    values (v_p.cuenta_id, 'ajuste', v_u, case when v_p.diferencia > 0 then -1 else 1 end, p_partida, 'conciliación: ' || btrim(p_motivo), p_actor) returning id into v_mov;
    insert into public.bolson_partida_resoluciones (partida_id, cuenta_id, accion, unidades, movimiento_id, motivo, resuelta_por) values (p_partida, v_p.cuenta_id, p_accion, v_u, v_mov, btrim(p_motivo), p_actor) returning * into v_r;
  else   -- atribuir_empresa: consumo extraordinario que el proveedor registró y NEXA no midió
    if v_p.diferencia <= 0 then raise exception 'FEL_REGLA: solo se atribuye a una empresa un consumo del proveedor que NEXA no midió'; end if;
    if p_empresa is null or not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'FEL_NO_ENCONTRADO: indica la empresa a la que se atribuye'; end if;
    insert into public.bolson_movimientos (cuenta_id, empresa_id, tipo, unidades, sentido, conciliacion_partida_id, motivo, creado_por)
    values (v_p.cuenta_id, p_empresa, 'ajuste', v_u, -1, p_partida, 'consumo extraordinario atribuido: ' || btrim(p_motivo), p_actor) returning id into v_mov;
    insert into public.bolson_partida_resoluciones (partida_id, cuenta_id, accion, unidades, empresa_id, movimiento_id, motivo, resuelta_por) values (p_partida, v_p.cuenta_id, p_accion, v_u, p_empresa, v_mov, btrim(p_motivo), p_actor) returning * into v_r;
  end if;
  perform public.fel_auditar(p_empresa, p_actor, 'bolson.partida_resuelta', 'bolson_partida', p_partida::text, jsonb_build_object('accion', p_accion, 'unidades', v_u, 'movimiento', v_mov));
  return v_r;
end $$;

-- ============================================================ la cobertura guarda la REFERENCIA del proveedor (la autorización) para poder conciliar contra su extracto
create or replace function public.fel_sys_cobertura_cerrar(p_empresa uuid, p_op uuid) returns public.consumos
language plpgsql security definer set search_path = '' as $$
declare v_op public.operaciones_fiscales; v_c public.consumos; v_aut text; v_ref text;
begin
  select * into v_op from public.operaciones_fiscales where id = p_op and empresa_id = p_empresa;
  if not found then raise exception 'FEL_NO_ENCONTRADO: operación no encontrada en la empresa'; end if;
  select * into v_c from public.consumos where empresa_id = p_empresa and operacion_id = p_op and evento_tipo in ('certificacion','anulacion') order by reservado_en desc limit 1;
  if not found then return null; end if;
  if v_c.estado = 'reservado' and v_op.estado in ('confirmada_exitosa','confirmada_fallida') then
    select autorizacion_sat into v_aut from public.documentos where id = v_op.documento_id and empresa_id = p_empresa;
    v_ref := case when v_op.estado <> 'confirmada_exitosa' or v_aut is null then null when v_op.tipo = 'anulacion' then v_aut || ':ANULACION' else v_aut end;
    return public.fel_sys_cobertura_confirmar(p_empresa, v_c.id, null, v_ref, jsonb_build_object('origen', 'orquestacion', 'operacion_estado', v_op.estado));
  end if;
  return v_c;
end $$;

-- ============================================================ RLS y privilegios (solo la plataforma lee; nadie escribe fuera de las funciones)
alter table public.bolson_conciliaciones enable row level security;
alter table public.bolson_conciliacion_partidas enable row level security;
alter table public.bolson_partida_resoluciones enable row level security;
revoke all on public.bolson_conciliaciones, public.bolson_conciliacion_partidas, public.bolson_partida_resoluciones from public, anon, authenticated, service_role;
grant select on public.bolson_conciliaciones, public.bolson_conciliacion_partidas, public.bolson_partida_resoluciones to authenticated;
create policy bolson_conciliaciones_leer on public.bolson_conciliaciones for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_partidas_leer on public.bolson_conciliacion_partidas for select to authenticated using (public.fel_es_admin_plataforma());
create policy bolson_resoluciones_leer on public.bolson_partida_resoluciones for select to authenticated using (public.fel_es_admin_plataforma());

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fel_admin_bolson_extracto_importar','fel_admin_bolson_conciliar_proponer','fel_admin_bolson_conciliar_decidir','fel_admin_bolson_partida_resolver','fel_sys_cobertura_cerrar') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  revoke all on function public.fel_bolson_conciliacion_guard() from public, anon, authenticated, service_role;
end $$;
