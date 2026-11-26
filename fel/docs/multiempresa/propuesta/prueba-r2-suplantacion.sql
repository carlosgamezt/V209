-- Sonda del riesgo R2 (SUPLANTACIÓN por funciones con actor y empresa como PARÁMETROS), conectada COMO nexa_app y SIN ninguna sesión. No deja cambios (todo dentro de una transacción que se deshace).
-- Por clases (ver docs/multiempresa/ESTRATEGIA-R2-IDENTIDAD.md): C1 funciones de empresa (cerrada desde F1, M-I), C2 funciones de la plataforma, C5 auditoría. R2 solo está cerrado cuando TODAS las clases lo están.
-- Uso: psql -U nexa_app -v esperado=abierto -f prueba-r2-suplantacion.sql   (esperado: estado global; C1 DEBE estar cerrada siempre). Datos: fixture-sesion.sql.
\set ON_ERROR_STOP on
begin;
create temp table r (clase text, sonda text, suplanta boolean);
do $$ declare n int; begin
  -- C1 (lectura): ¿listar a las personas de la empresa A diciendo que se es su propietaria?
  begin select count(*) into n from public.fel_op_miembros_listar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a'); insert into r values ('C1', 'lectura de personas de otra empresa con un actor inventado', n > 0);
  exception when others then insert into r values ('C1', 'lectura de personas de otra empresa con un actor inventado', false); end;
  -- C1 (escritura, se deshace): ¿crear un establecimiento en la empresa A como su propietaria?
  begin perform public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', null, '999', 'Sonda R2', 'x', 'activo'); insert into r values ('C1', 'escritura en otra empresa con un actor inventado', true);
  exception when others then insert into r values ('C1', 'escritura en otra empresa con un actor inventado', false); end;
  -- C1: la propietaria de B actuando en A
  begin perform public.fel_op_establecimiento_guardar('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', null, '998', 'Sonda R2 cruce', 'x', 'activo'); insert into r values ('C1', 'persona de la empresa B actuando en la empresa A', true);
  exception when others then insert into r values ('C1', 'persona de la empresa B actuando en la empresa A', false); end;
  -- C2 (plataforma): ¿listar las solicitudes de recuperación de MFA como un administrador de la plataforma inventado?
  begin perform count(*) from public.fel_op_mfa_recuperacion_listar('00000000-0000-0000-0000-0000000000a1'); insert into r values ('C2', 'operación de la plataforma con un actor de plataforma inventado', true);
  exception when others then insert into r values ('C2', 'operación de la plataforma con un actor de plataforma inventado', false); end;
  -- C5 (auditoría): ¿escribir una entrada de auditoría a nombre de otra persona?
  begin perform public.fel_auditar('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'sonda.r2', 'sonda', null, '{}'::jsonb); insert into r values ('C5', 'entrada de auditoría falsificada a nombre de otra persona', true);
  exception when others then insert into r values ('C5', 'entrada de auditoría falsificada a nombre de otra persona', false); end;
end $$;
select clase, sonda, case when suplanta then 'POSIBLE' else 'rechazada' end as resultado from r order by clase, sonda;
select clase, case when bool_or(suplanta) then 'abierta' else 'cerrada' end as estado from r group by clase order by clase;
select case when bool_or(suplanta) then 'abierto' else 'cerrado' end as estado_r2 from r \gset
select case when bool_or(suplanta) filter (where clase = 'C1') then 'abierta' else 'cerrada' end as estado_c1 from r \gset
\echo R2 ESTADO: :estado_r2 (esperado: :esperado) · C1: :estado_c1
select (:'estado_r2' = :'esperado' and :'estado_c1' = 'cerrada') as coincide \gset
\if :coincide
  \echo SONDA R2 OK
\else
  \echo SONDA R2 FALLO: el estado real no es el esperado (C1 debe estar cerrada y el global igual a lo esperado)
  \quit 3
\endif
rollback;
