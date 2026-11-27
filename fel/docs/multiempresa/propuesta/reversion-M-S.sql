-- Reversión de M-S: retira las RPC, el grant por columnas y restituye las políticas por fila de las migraciones originales.
\set ON_ERROR_STOP on
begin;
drop function if exists api.documento_detalle(uuid), api.documentos_listar(jsonb), api.panel_resumen(), api.reporte_documentos(), api.artefacto_descargar(uuid);
drop policy if exists artefactos_meta_leer on public.artefactos_documento;
revoke select (id, empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, creado_en) on public.artefactos_documento from authenticated;
drop policy if exists documentos_leer on public.documentos; create policy documentos_leer on public.documentos for select to authenticated using (fel_tiene_permiso(empresa_id, 'borradores.ver'));
drop policy if exists documentos_alcance_leer on public.documentos; create policy documentos_alcance_leer on public.documentos as restrictive for select to authenticated using ((not fel__establecimiento_por_usuario()) or fel_en_alcance(empresa_id, auth.uid(), establecimiento_id));
drop policy if exists doc_lineas_leer on public.documento_lineas; create policy doc_lineas_leer on public.documento_lineas for select to authenticated using (fel_tiene_permiso(empresa_id, 'borradores.ver'));
drop policy if exists operaciones_leer on public.operaciones_fiscales; create policy operaciones_leer on public.operaciones_fiscales for select to authenticated using (fel_tiene_permiso(empresa_id, 'historial.ver'));
drop policy if exists eventos_leer on public.eventos_proveedor; create policy eventos_leer on public.eventos_proveedor for select to authenticated using (fel_tiene_permiso(empresa_id, 'fiscal.ver'));
drop policy if exists conciliaciones_leer on public.conciliaciones; create policy conciliaciones_leer on public.conciliaciones for select to authenticated using (fel_tiene_permiso(empresa_id, 'fiscal.ver'));
drop policy if exists alertas_leer on public.alertas_fiscales; create policy alertas_leer on public.alertas_fiscales for select to authenticated using (fel_tiene_permiso(empresa_id, 'fiscal.ver'));
drop function if exists public.fel__establecimientos_en_alcance(); drop function if exists public.fel__empresas_alcance_total();
commit;
