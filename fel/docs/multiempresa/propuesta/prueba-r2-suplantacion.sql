-- Sonda del riesgo R2 (SUPLANTACIÓN por funciones `fel_op_*` con actor y empresa como PARÁMETROS), conectada COMO nexa_app. No deja cambios (todo dentro de una transacción que se deshace).
-- Uso: psql -U nexa_app -v esperado=abierto -f prueba-r2-suplantacion.sql   (hoy debe darse «abierto»; tras la corrección de R2, `-v esperado=cerrado`). Datos: fixture-sesion.sql.
\set ON_ERROR_STOP on
begin;
create temp table r (sonda text, suplanta boolean);
-- sonda 1 (lectura): ¿puede nexa_app listar a las personas de la empresa A diciendo que es la propietaria de A, SIN ninguna sesión?
do $$ declare n int; begin
  begin select count(*) into n from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a'); insert into r values ('lectura de personas de otra empresa con un actor inventado', n > 0);
  exception when others then insert into r values ('lectura de personas de otra empresa con un actor inventado', false); end;
  -- sonda 2 (escritura, se deshace): ¿crear un establecimiento en la empresa A como su propietaria?
  begin perform public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '999', 'Sonda R2', 'x', 'activo'); insert into r values ('escritura en otra empresa con un actor inventado', true);
  exception when others then insert into r values ('escritura en otra empresa con un actor inventado', false); end;
  -- sonda 3: la propietaria de B actuando en A (cruce de empresas con una persona real de otra empresa)
  begin perform public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', null, '998', 'Sonda R2 cruce', 'x', 'activo'); insert into r values ('persona de la empresa B actuando en la empresa A', true);
  exception when others then insert into r values ('persona de la empresa B actuando en la empresa A', false); end;
end $$;
select sonda, case when suplanta then 'POSIBLE' else 'rechazada' end as resultado from r order by sonda;
select case when bool_or(suplanta) then 'abierto' else 'cerrado' end as estado_r2 from r \gset
\echo R2 ESTADO: :estado_r2 (esperado: :esperado)
select (:'estado_r2' = :'esperado') as coincide \gset
\if :coincide
  \echo SONDA R2 OK
\else
  \echo SONDA R2 FALLO: el estado real no es el esperado
  \quit 3
\endif
rollback;
