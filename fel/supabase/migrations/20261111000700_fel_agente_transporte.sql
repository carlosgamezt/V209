-- NEXA FEL · Fase 4 · 8a · transporte remoto seguro del agente (fel/docs/agente-transporte-remoto.md).
-- · política de versiones (mínima y recomendada) y de sondeo adaptativo, configurables sin desplegar código;
-- · métricas de uso por agente y hora (peticiones, errores, reconexiones) para estimar los costos reales.
insert into public.plataforma_parametros (clave, valor, descripcion) values
  ('agente_version_minima',      0,     'Versión mínima del agente (codificada mayor·1 000 000 + menor·1 000 + parche; 0 = sin mínimo). Por debajo, el agente no recibe órdenes nuevas'),
  ('agente_version_recomendada', 0,     'Versión recomendada del agente (misma codificación; 0 = ninguna). Solo avisa'),
  ('agente_sondeo_activo_ms',    3000,  'Milisegundos hasta la siguiente consulta del agente cuando la empresa tiene órdenes en curso o recientes'),
  ('agente_sondeo_reposo_ms',    30000, 'Milisegundos hasta la siguiente consulta del agente cuando la empresa está en reposo'),
  ('agente_actividad_reciente_seg', 300, 'Segundos tras la última orden durante los cuales la empresa se considera activa');

-- Política que NEXA comunica al agente en cada consulta (el servidor decide; el agente la acata dentro de límites seguros). Sin agente (p. ej. al vincular): solo versiones.
create or replace function public.fel_sys_agente_politica(p_agente uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.agentes_locales; v_activa boolean := false;
begin
  if p_agente is not null then
    select * into a from public.agentes_locales where id = p_agente;
    if not found then raise exception 'FEL_REVOCADO: el agente no existe'; end if;
    v_activa := exists (select 1 from public.ordenes_emision o where o.empresa_id = a.empresa_id and (o.estado in ('pendiente','reclamada','llenada')
                   or o.creada_en > clock_timestamp() - make_interval(secs => public.fel__parametro('agente_actividad_reciente_seg')::integer)));
  end if;
  return jsonb_build_object('version_minima', public.fel__parametro('agente_version_minima'), 'version_recomendada', public.fel__parametro('agente_version_recomendada'),
    'siguiente_ms', case when v_activa then public.fel__parametro('agente_sondeo_activo_ms') else public.fel__parametro('agente_sondeo_reposo_ms') end, 'actividad', v_activa);
end $$;

-- Métricas por agente y hora (solo contadores; nunca contenido, claves ni datos de facturas).
create table public.agente_metricas (
  hora       timestamptz not null,
  agente_id  uuid not null,
  empresa_id uuid not null,
  clave      text not null check (clave ~ '^[a-z_]+(:[A-Za-z0-9_.-]{1,40}){0,2}$' and length(clave) <= 80),
  n          bigint not null check (n >= 0),
  primary key (hora, agente_id, clave),
  foreign key (agente_id, empresa_id) references public.agentes_locales (id, empresa_id)
);
create index agente_metricas_empresa on public.agente_metricas (empresa_id, hora);
alter table public.agente_metricas enable row level security;
revoke all on public.agente_metricas from public, anon, authenticated;
revoke delete, truncate on public.agente_metricas from service_role;

-- El plano de control vacía sus contadores en memoria aquí (una escritura por lote, no por petición). Entradas inválidas o de agentes desconocidos se ignoran.
create or replace function public.fel_sys_agente_metricas_guardar(p_datos jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare e jsonb; a public.agentes_locales; v_n integer := 0; v_hora timestamptz; v_cnt bigint;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'array' or jsonb_array_length(p_datos) > 2000 then raise exception 'FEL_DATOS_INVALIDOS: lote de métricas no válido'; end if;
  for e in select * from jsonb_array_elements(p_datos) loop
    begin
      select * into a from public.agentes_locales where id = (e ->> 'agente')::uuid;
      v_hora := date_trunc('hour', (e ->> 'hora')::timestamptz); v_cnt := (e ->> 'n')::bigint;
      continue when not found or v_cnt < 0 or v_cnt > 100000000;
      insert into public.agente_metricas (hora, agente_id, empresa_id, clave, n) values (v_hora, a.id, a.empresa_id, e ->> 'clave', v_cnt)
        on conflict (hora, agente_id, clave) do update set n = public.agente_metricas.n + excluded.n;
      v_n := v_n + 1;
    exception when others then continue;   -- una entrada mal formada no tumba el lote
    end;
  end loop;
  return v_n;
end $$;

-- Lectura para la persona con permiso (solo SU empresa): totales y serie por hora, y una proyección del costo de invocaciones.
create or replace function public.fel_op_agente_metricas(p_actor uuid, p_empresa uuid, p_horas integer default 24) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_desde timestamptz; v_tot jsonb; v_serie jsonb; v_pet bigint;
begin
  perform public.fel__exigir_permiso(p_actor, p_empresa, 'canales.ver');
  if p_horas is null or p_horas < 1 or p_horas > 720 then raise exception 'FEL_DATOS_INVALIDOS: horas no válidas'; end if;
  v_desde := date_trunc('hour', clock_timestamp()) - make_interval(hours => p_horas - 1);
  select coalesce(jsonb_object_agg(clave, n), '{}'::jsonb) into v_tot from (select clave, sum(n)::bigint as n from public.agente_metricas where empresa_id = p_empresa and hora >= v_desde group by clave) t;
  select coalesce(jsonb_agg(jsonb_build_object('hora', hora, 'peticiones', n) order by hora), '[]'::jsonb) into v_serie
    from (select hora, sum(n)::bigint as n from public.agente_metricas where empresa_id = p_empresa and hora >= v_desde and clave like 'peticion:%' group by hora) s;
  select coalesce(sum(n), 0) into v_pet from public.agente_metricas where empresa_id = p_empresa and hora >= v_desde and clave like 'peticion:%';
  return jsonb_build_object('horas', p_horas, 'totales', v_tot, 'serie', v_serie, 'peticiones', v_pet,
    'agentes', (select count(distinct agente_id) from public.agente_metricas where empresa_id = p_empresa and hora >= v_desde),
    'proyeccion_30_dias', round(v_pet::numeric / p_horas * 720));
end $$;

revoke all on function public.fel_sys_agente_politica(uuid), public.fel_sys_agente_metricas_guardar(jsonb), public.fel_op_agente_metricas(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.fel_sys_agente_politica(uuid), public.fel_sys_agente_metricas_guardar(jsonb), public.fel_op_agente_metricas(uuid, uuid, integer) to service_role;
