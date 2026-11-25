-- Continuación de supabase/tests/30_tipos_documento.sql (líneas 1-223: fixture con FACT t_r3 revisada, NCRE t_n1 revisada, NDEB t_d1 revisada, RECI t_r2 revisado), ya con la 31 aplicada.
-- El arnés (tools/test-migracion-31.sh) concatena ambas partes. Pruebas de la propuesta 31.
do $$ begin
  assert (select array_agg(codigo order by codigo) from public.fel_tipos_dte where certificacion_test) = array['FACT','NCRE'], 'TEST: FACT y NCRE';
  assert (select array_agg(codigo order by codigo) from public.fel_tipos_dte where certificacion_habilitada) = array['FACT'], 'real: solo FACT';
  assert public.fel_tipos_certificacion_test() = array['FACT','NCRE'], 'lista de TEST';
end $$;
-- la vía «real» (operaciones_fiscales) sigue cerrada a NCRE
select pg_temp.espera_error($$insert into public.operaciones_fiscales (empresa_id, documento_id, tipo, clave_idempotencia, hash_contenido, proveedor, iniciada_por)
  values ('10000000-0000-0000-0000-00000000000a', (select id from t_n1), 'certificacion', repeat('c', 20), repeat('d', 64), 'mock', '00000000-0000-0000-0000-0000000000c1')$$, 'aún no está habilitada');
-- el almacén de Digifact (TEST): NCRE revisada SÍ; NDEB y RECI NO; FACT igual que antes
create or replace function pg_temp.op31(p_doc uuid, p_n int) returns void language plpgsql as $$
begin
  insert into public.digifact_operaciones (id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento)
  values (gen_random_uuid(), '10000000-0000-0000-0000-00000000000a', p_doc, gen_random_uuid(), repeat('a', 16), '0123456789abcdef', '2026-11-16', 1, '40', 'preparada', 2000 + p_n, 2000 + p_n, '00000000-0000-0000-0000-0000000000c1', 0);
end $$;
select pg_temp.op31((select id from t_n1), 1);
select pg_temp.op31((select id from t_r3), 2);
do $$ begin
  begin perform pg_temp.op31((select id from t_d1), 3); raise exception 'NO DEBIÓ'; exception when others then assert sqlerrm like '%aún no está habilitada%', 'NDEB: ' || sqlerrm; end;
  begin perform pg_temp.op31((select id from t_r2), 4); raise exception 'NO DEBIÓ'; exception when others then assert sqlerrm like '%aún no está habilitada%', 'RECI: ' || sqlerrm; end;
  assert (select count(*) from public.digifact_operaciones where documento_id in (select id from t_n1 union all select id from t_r3)) = 2;
  assert (select count(*) from public.digifact_operaciones where documento_id in (select id from t_d1 union all select id from t_r2)) = 0;
end $$;
-- el catálogo sigue inmutable para la aplicación (y para cualquier sesión que no apague la protección)
select pg_temp.espera_error($$update public.fel_tipos_dte set certificacion_test = true where codigo = 'NDEB'$$, 'solo se cambia con una migración');
select pg_temp.espera_error($$update public.fel_tipos_dte set certificacion_test = true where codigo = 'FCAM'$$, 'solo se cambia con una migración|23514|check');
-- coherencia: un pendiente jamás certifica en TEST; «real» implica TEST
alter table public.fel_tipos_dte disable trigger fel_tipos_dte_no_cambiar;
select pg_temp.espera_error($$update public.fel_tipos_dte set certificacion_test = true where codigo = 'FCAM'$$, '23514|check');
select pg_temp.espera_error($$update public.fel_tipos_dte set certificacion_test = false where codigo = 'FACT'$$, '23514|check');
alter table public.fel_tipos_dte enable trigger fel_tipos_dte_no_cambiar;
-- permisos
do $$ begin
  assert not has_function_privilege('anon', 'public.fel_tipos_certificacion_test()', 'execute') and not has_function_privilege('authenticated', 'public.fel_tipos_certificacion_test()', 'execute');
  assert has_function_privilege('service_role', 'public.fel_tipos_certificacion_test()', 'execute');
  assert not has_function_privilege('authenticated', 'public.fel_digifact_tipo_guard()', 'execute');
end $$;
rollback;
select 'PRUEBAS 31 OK' as resultado;
