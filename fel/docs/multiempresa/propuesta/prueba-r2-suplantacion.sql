-- Sonda del riesgo R2 (SUPLANTACIÓN por funciones con actor y empresa como PARÁMETROS), conectada COMO nexa_app y SIN ninguna sesión. No deja cambios (todo dentro de una transacción que se deshace).
-- Por clases (ver docs/multiempresa/ESTRATEGIA-R2-IDENTIDAD.md): C1 funciones de empresa (cerrada en F1, M-I), C2 funciones de la plataforma (F2, M-J), C3 previas a la sesión (acotadas por la base), C5 auditoría (F3, M-J),
-- C4 funciones del sistema `fel_sys_*` (F4, pendiente) y R1 fabricación de sesiones (F5, pendiente). R2 NO está cerrado mientras alguna clase siga abierta.
-- Uso: psql -U nexa_app -v esperado=abierto -f prueba-r2-suplantacion.sql   (esperado: estado global; C1, C2, C3 y C5 DEBEN estar cerradas siempre). Datos: fixture-sesion.sql.
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
  -- C3 (previas a la sesión): ¿aceptar una invitación como un usuario inventado, o con el correo de otra persona? (la base exige usuario confirmado, correo idéntico e invitación vigente)
  begin perform public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-00000000f0f0', 'quien@ejemplo.test'); insert into r values ('C3', 'invitación aceptada por un usuario inexistente', true);
  exception when others then insert into r values ('C3', 'invitación aceptada por un usuario inexistente', false); end;
  begin perform public.fel_op_invitacion_aceptar('00000000-0000-0000-0000-0000000000c3', 'otra.persona@ejemplo.test'); insert into r values ('C3', 'invitación aceptada con el correo de otra persona', true);
  exception when others then insert into r values ('C3', 'invitación aceptada con el correo de otra persona', false); end;
  begin perform public.fel_op_mfa_recuperacion_solicitar('00000000-0000-0000-0000-00000000f0f0', 'motivo de prueba suficientemente largo'); insert into r values ('C3', 'solicitud de recuperación de MFA para una cuenta inexistente o sin MFA', true);
  exception when others then insert into r values ('C3', 'solicitud de recuperación de MFA para una cuenta inexistente o sin MFA', false); end;
  -- C4 (sistema, F4 pendiente): ¿ejecutar funciones del sistema sin sesión? (lista las operaciones pendientes de TODAS las empresas)
  begin perform count(*) from public.fel_sys_operaciones_pendientes(); insert into r values ('C4', 'función del sistema ejecutable sin sesión (operaciones de todas las empresas)', true);
  exception when others then insert into r values ('C4', 'función del sistema ejecutable sin sesión (operaciones de todas las empresas)', false); end;
  -- R1 (F5 pendiente): ¿fabricar una sesión válida?
  begin insert into public.demo_sesiones (token_hash, usuario) values (encode(sha256(convert_to('sonda-r1-' || clock_timestamp()::text, 'UTF8')), 'hex'), 'propa'); insert into r values ('R1', 'sesión fabricada con escritura directa en demo_sesiones', true);
  exception when others then insert into r values ('R1', 'sesión fabricada con escritura directa en demo_sesiones', false); end;
end $$;
select clase, sonda, case when suplanta then 'POSIBLE' else 'rechazada' end as resultado from r order by clase, sonda;
select clase, case when bool_or(suplanta) then 'abierta' else 'cerrada' end as estado from r group by clase order by clase;
select case when bool_or(suplanta) then 'abierto' else 'cerrado' end as estado_r2 from r \gset
select case when bool_or(suplanta) filter (where clase in ('C1', 'C2', 'C3', 'C5')) then 'abierta' else 'cerrada' end as estado_c1 from r \gset
\echo R2 ESTADO: :estado_r2 (esperado: :esperado) · C1+C2+C3+C5: :estado_c1
select (:'estado_r2' = :'esperado' and :'estado_c1' = 'cerrada') as coincide \gset
\if :coincide
  \echo SONDA R2 OK
\else
  \echo SONDA R2 FALLO: el estado real no es el esperado (C1, C2, C3 y C5 deben estar cerradas y el global igual a lo esperado)
  \quit 3
\endif
rollback;
