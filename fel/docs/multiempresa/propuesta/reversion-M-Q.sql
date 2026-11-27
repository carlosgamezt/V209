-- Reversión de M-Q: restituye la vinculación con límite global de 20 fallos (4 parámetros) y la autenticación sin límite por agente; retira los parámetros nuevos.
\set ON_ERROR_STOP on
begin;
create temp table _q_priv as select coalesce(bool_or(has_function_privilege('nexa_app', p.oid, 'execute')), false) as app from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fel_sys_agente_vincular' and exists (select 1 from pg_roles where rolname = 'nexa_app');
drop function if exists public.fel_sys_agente_vincular(text, text, text, text, text);
create or replace function public.fel_sys_agente_vincular(p_codigo text, p_clave_publica text, p_nombre text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.codigos_vinculacion; v_norm text; a public.agentes_locales; v_fallos integer; v_emp text;
begin
  delete from public.vinculacion_fallos where creado_en < clock_timestamp() - interval '10 minutes';
  select count(*) into v_fallos from public.vinculacion_fallos;
  if v_fallos >= 20 then raise exception 'FEL_LIMITE: demasiados intentos de vinculación; espera unos minutos'; end if;
  v_norm := upper(replace(btrim(coalesce(p_codigo, '')), '-', ''));
  select * into c from public.codigos_vinculacion where codigo_hash = encode(sha256(convert_to(v_norm, 'UTF8')), 'hex') for update;
  if not found or c.usado_en is not null or c.expira_en < clock_timestamp() then insert into public.vinculacion_fallos default values; return jsonb_build_object('error', 'FEL_CODIGO'); end if;
  if p_clave_publica is null or p_clave_publica !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'FEL_DATOS_INVALIDOS: clave pública no válida'; end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 1 and 80 then raise exception 'FEL_DATOS_INVALIDOS: nombre del agente no válido'; end if;
  begin
    insert into public.agentes_locales (empresa_id, nombre, clave_publica, version, creado_por, visto_en) values (c.empresa_id, btrim(p_nombre), p_clave_publica, left(p_version, 40), c.creado_por, clock_timestamp()) returning * into a;
  exception when unique_violation then raise exception 'FEL_DATOS_INVALIDOS: esa clave pública ya está registrada';
  end;
  update public.codigos_vinculacion set usado_en = clock_timestamp(), agente_id = a.id where id = c.id;
  perform public.fel_auditar(c.empresa_id, c.creado_por, 'agente.vinculado', 'agente', a.id::text, jsonb_build_object('nombre', a.nombre, 'version', a.version), 'agente');
  select nombre_comercial into v_emp from public.empresas where id = c.empresa_id;
  return jsonb_build_object('agente_id', a.id, 'empresa_id', a.empresa_id, 'empresa', v_emp);
end $$;
revoke all on function public.fel_sys_agente_vincular(text, text, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'nexa_sys') then grant execute on function public.fel_sys_agente_vincular(text, text, text, text) to nexa_sys; end if;
  if (select app from _q_priv) then grant execute on function public.fel_sys_agente_vincular(text, text, text, text) to nexa_app; end if;
end $$;
drop table _q_priv;
create or replace function public.fel_sys_agente_autenticar(p_agente uuid, p_ts timestamptz, p_nonce text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locales; v_max integer := public.fel__parametro('agente_reloj_max_seg')::integer;
begin
  select * into a from public.agentes_locales where id = p_agente for update;
  if not found then raise exception 'FEL_NO_AUTORIZADO: agente desconocido'; end if;
  if a.estado <> 'activo' then raise exception 'FEL_REVOCADO: el agente fue revocado'; end if;
  if p_ts is null or abs(extract(epoch from (clock_timestamp() - p_ts))) > v_max then update public.agentes_locales set error_codigo = 'RELOJ', error_en = clock_timestamp() where id = p_agente; return jsonb_build_object('ok', false, 'error', 'FEL_RELOJ', 'max_seg', v_max); end if;
  if p_nonce is null or length(p_nonce) not between 16 and 64 then raise exception 'FEL_DATOS_INVALIDOS: nonce no válido'; end if;
  delete from public.agente_nonces where creado_en < clock_timestamp() - interval '10 minutes';
  begin insert into public.agente_nonces (agente_id, nonce) values (p_agente, p_nonce);
  exception when unique_violation then raise exception 'FEL_REPETICION: petición repetida (nonce ya usado)'; end;
  return jsonb_build_object('ok', true, 'empresa_id', a.empresa_id);
end $$;
delete from public.plataforma_parametros where clave in ('agente_vinculacion_max_origen', 'agente_vinculacion_max_global', 'agente_max_peticiones_min');
drop index if exists public.vinculacion_fallos_origen_idx;
drop index if exists public.agente_nonces_recientes_idx;
alter table public.vinculacion_fallos drop column if exists origen;
commit;
