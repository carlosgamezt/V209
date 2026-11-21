-- REVERSIÓN SEGURA de 20261114000100_fel_digifact_operaciones.sql (solo para emergencias; NO es una migración del proyecto).
-- SE NIEGA a borrar nada si existe cualquier rastro de certificaciones: filas en digifact_operaciones o digifact_artefactos, o eventos de auditoría de Digifact (envío iniciado o aplicada al documento).
-- Motivo: esas tablas son la evidencia (UUID, serie, número, XML y PDF) de certificaciones que YA existen en Digifact y en el documento (inmutable). Borrarlas no deshace nada fiscal y sí perdería la prueba.
-- Con datos NO se revierte: se corrige hacia adelante, o se restaura un respaldo Y SE CONCILIA con Digifact (ver docs/migracion-29/RECUPERACION-Y-CONCILIACION.md) antes de volver a certificar.
-- Idempotente: si las tablas ya no existen, no hace nada. No toca ninguna tabla de las migraciones 1–28. Tras revertir hay que marcar la migración como revertida en el historial de la CLI (supabase migration repair --status reverted 20261114000100).
begin;
do $$ declare a bigint := 0; b bigint := 0; c bigint := 0; begin
  if to_regclass('public.digifact_operaciones') is null and to_regclass('public.digifact_artefactos') is null then
    raise notice 'REVERSIÓN 29: las tablas ya no existen; no se hace nada'; return;
  end if;
  if to_regclass('public.digifact_operaciones') is not null and to_regclass('public.digifact_artefactos') is not null then execute 'lock table public.digifact_operaciones, public.digifact_artefactos in access exclusive mode'; end if;   -- nadie puede insertar mientras se decide
  if to_regclass('public.digifact_operaciones') is not null then select count(*) into a from public.digifact_operaciones; end if;
  if to_regclass('public.digifact_artefactos') is not null then select count(*) into b from public.digifact_artefactos; end if;
  select count(*) into c from public.auditoria where accion in ('digifact_test.envio_iniciado', 'digifact_test.aplicada_al_documento', 'digifact_test.certificada');
  if a + b + c > 0 then
    raise exception 'REVERSIÓN 29 RECHAZADA: hay rastro de certificaciones (operaciones: %, artefactos: %, eventos de auditoría: %). No se borra nada.', a, b, c using errcode = 'P0001';
  end if;
end $$;
drop table if exists public.digifact_artefactos;
drop table if exists public.digifact_operaciones;
drop function if exists public.fel_sys_digifact_aplicar(uuid, uuid);
drop function if exists public.fel_digifact_art_guarda();
drop function if exists public.fel_digifact_op_guarda();
commit;
select 'REVERSION 29 OK' as resultado;
