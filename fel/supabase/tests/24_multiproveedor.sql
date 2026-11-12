-- D3-3 · multiproveedor: el segundo certificador simulado solo existe en «simulado»; nada real se abre.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns void language plpgsql as $$
declare v_ok boolean := false;
begin begin execute p_sql; exception when others then v_ok := (sqlerrm ~ p_patron) or (sqlstate ~ p_patron); end;
  if not v_ok then raise exception 'ESPERABA ERROR /%/ pero no ocurrió, en: %', p_patron, p_sql; end if; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','m1@fel.test'); insert into public.perfiles (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into public.plataforma_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
do $$ declare m uuid := '00000000-0000-0000-0000-0000000000a1'; c public.bolson_cuentas; begin
  assert (select ambientes from public.proveedores_emision where id = 'certificador_b') = '{simulado}' and (select habilitado from public.proveedores_emision where id = 'certificador_b');
  c := public.fel_admin_bolson_cuenta_crear(m, 'certificador_b', 'simulado', 'SIM-B'); assert c.ambiente = 'simulado' and public.fel_sys_bolson_cuenta_simulada('certificador_b') = c.id and public.fel_sys_bolson_cuenta_simulada('digifact') is null;
  perform pg_temp.espera_error($q$update public.proveedores_emision set ambientes = '{simulado,pruebas}' where id = 'certificador_b'$q$, 'proveedores_certificador_b_solo_simulado_chk|check');
  perform pg_temp.espera_error($q$update public.proveedores_emision set ambientes = '{produccion}' where id = 'certificador_b'$q$, 'check');
  perform pg_temp.espera_error($q$insert into public.proveedores_emision (id, nombre, ambientes) values ('otro_certificador','X','{simulado}')$q$, 'check');   -- un certificador nuevo exige su propia migración
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','certificador_b','produccion','PROD-B')$q$, 'FEL_REGLA|check');
  perform pg_temp.espera_error($q$select public.fel_admin_bolson_cuenta_crear('00000000-0000-0000-0000-0000000000a1','mock','simulado','X')$q$, 'certificadores simulados');
  perform pg_temp.espera_error($q$insert into public.bolson_cuentas (proveedor_id, ambiente, referencia_externa) values ('portal_playwright','simulado','X')$q$, 'check');
end $$;
rollback;
\echo OK 24_multiproveedor
