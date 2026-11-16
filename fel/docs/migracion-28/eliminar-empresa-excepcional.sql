-- PROCEDIMIENTO EXCEPCIONAL (NO es una migración): eliminar una empresa CREADA POR ERROR y SIN NINGÚN HISTORIAL.
-- La migración 28 impide borrar empresas. Lo normal es SUSPENDERLAS (fel_admin_empresa_estado). Esto es solo para una fila vacía (p. ej. insertada por equivocación).
-- Garantías: una sola transacción (todo o nada); exige empresa NO habilitada, confirmación literal, motivo y quien autoriza; se niega si CUALQUIER tabla tiene filas de esa empresa
-- (todas las claves foráneas a «empresas» son NO ACTION: nada se borra en cascada); el disparador queda activo al terminar (se comprueba) y se deja constancia en la auditoría (sin empresa, porque deja de existir).
-- Requiere ser dueño de la tabla (el rol «postgres» del proyecto). Se ejecuta solo con autorización escrita de la persona responsable de la plataforma.
-- Uso:  psql "<conexión>" -v empresa='<uuid>' -v autoriza='<uuid de la persona de la plataforma que autoriza>' -v motivo='<al menos 10 caracteres>' -v confirmacion='ELIMINAR-EMPRESA-<uuid>' -f eliminar-empresa-excepcional.sql
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
select set_config('nexa.empresa', :'empresa', true), set_config('nexa.autoriza', :'autoriza', true), set_config('nexa.motivo', :'motivo', true), set_config('nexa.confirmacion', :'confirmacion', true) \gset
do $$
declare
  v_emp uuid := current_setting('nexa.empresa')::uuid; v_aut uuid := current_setting('nexa.autoriza')::uuid;
  v_motivo text := current_setting('nexa.motivo'); v_estado text; r record; n bigint; v_hijos text[] := '{}';
begin
  if current_setting('nexa.confirmacion') <> 'ELIMINAR-EMPRESA-' || v_emp then raise exception 'FEL_REGLA: falta la confirmación literal ELIMINAR-EMPRESA-<uuid>'; end if;
  if length(btrim(v_motivo)) < 10 then raise exception 'FEL_REGLA: el motivo debe tener al menos 10 caracteres'; end if;
  if not exists (select 1 from public.plataforma_admins where user_id = v_aut) then raise exception 'FEL_NO_AUTORIZADO: quien autoriza no es administrador de la plataforma'; end if;
  select estado into v_estado from public.empresas where id = v_emp;
  if not found then raise exception 'FEL_NO_ENCONTRADO: la empresa no existe'; end if;
  if v_estado = 'habilitada' then raise exception 'FEL_REGLA: una empresa habilitada no se elimina; suspéndela primero'; end if;
  -- ninguna tabla puede tener filas de esta empresa (se revisan TODAS las claves foráneas hacia empresas, tengan o no columna llamada empresa_id)
  for r in select c.conrelid::regclass as tabla, c.conkey from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.empresas'::regclass loop
    execute format('select count(*) from %s where %I = $1', r.tabla, (select a.attname from pg_attribute a where a.attrelid = r.tabla::regclass and a.attnum = r.conkey[1])) into n using v_emp;
    if n > 0 then v_hijos := v_hijos || format('%s (%s)', r.tabla, n); end if;
  end loop;
  if cardinality(v_hijos) > 0 then raise exception 'FEL_REGLA: la empresa tiene historial y NO se elimina: %', array_to_string(v_hijos, ', '); end if;
  alter table public.empresas disable trigger empresas_no_borrar;
  delete from public.empresas where id = v_emp;
  alter table public.empresas enable trigger empresas_no_borrar;
  if (select tgenabled from pg_trigger where tgrelid = 'public.empresas'::regclass and tgname = 'empresas_no_borrar') <> 'O' then raise exception 'FEL_REGLA: el disparador no quedó activo'; end if;
  perform public.fel_auditar(null, v_aut, 'empresa.eliminacion_excepcional', 'empresa', v_emp::text, jsonb_build_object('motivo', v_motivo, 'estado_previo', v_estado));
end $$;
commit;
