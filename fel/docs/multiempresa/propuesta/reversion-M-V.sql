-- Reversión de M-V y M-V1 (junto: los servicios dependen de M-V1): retira las funciones y los privilegios de nexa_sys sobre las tablas de servicio.
\set ON_ERROR_STOP on
begin;
drop function if exists api.documento_ref(uuid), api.cliente_ref(uuid, text), api.referencia(text, uuid), api.empresa_contexto(), api.documento_cobertura(uuid);
drop function if exists public.fel_sys_doc_fel(uuid, uuid), public.fel_sys_doc_cliente(uuid, uuid), public.fel_sys_doc_correo(uuid, uuid), public.fel_sys_op_certificada(uuid, uuid), public.fel_sys_auditoria_ultima(uuid, text, text, text),
  public.fel_sys_auditoria_contar(uuid, text, text, text), public.fel_sys_artefactos_op(uuid, uuid, uuid);
drop function if exists public.fel_ses_sys_doc_fel(text, uuid), public.fel_ses_sys_doc_cliente(text, uuid), public.fel_ses_sys_doc_correo(text, uuid), public.fel_ses_sys_op_certificada(text, uuid), public.fel_ses_sys_auditoria_ultima(text, text, text, text), public.fel_ses_sys_auditoria_contar(text, text, text, text), public.fel_ses_sys_artefactos_op(text, uuid, uuid);
do $$ declare v_t text; begin
  if not exists (select 1 from pg_roles where rolname = 'nexa_sys') then return; end if;
  foreach v_t in array array['digifact_operaciones', 'digifact_artefactos', 'envios_correo', 'demo_limites'] loop
    if to_regclass('public.' || v_t) is not null then execute format('revoke all on public.%I from nexa_sys', v_t); end if;
  end loop;
end $$;
commit;
