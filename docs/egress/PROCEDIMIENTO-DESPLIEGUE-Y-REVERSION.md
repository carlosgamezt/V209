# Procedimiento de despliegue y reversión (NO ejecutado; requiere tu autorización en cada paso)

Referencia estable: etiqueta `nexa-v512-referencia-egress`. Despliegue de la app: flujo «Publicar Nexa en Cloudflare Pages» (push a `main` en `nexa/**`). Despliegue de funciones/SQL automático: flujo «Publicar Supabase» (push a `main` en `supabase/auto/**` o `supabase/functions/**`). Las propuestas SQL están en `supabase/propuestas/egress/` y NO corren solas.
Costos: ninguno (todo está en plan gratuito).

## Paso 0 · Medición real (solo lectura)
Ejecutar `supabase/consultas/medicion_egress.sql` (flujo «Consulta Supabase» o editor SQL) y compartir el JSON. Con él: validar políticas/disparadores de `pa_docs` y calibrar las pruebas (`escenarios.cjs --data`).

## Paso 1 · Cliente v513 + función (sin tocar la base)
1. Mezclar la rama a `main` (la rama de trabajo es `ccr-9b56cef8-3yibwu`). Se publican `nexa/` (v513) y la función `recordatorios-de-nexa` (usa la vista ligera si existe; si no, la tabla de siempre).
2. El service worker (`pa-shell-nexacorp-v513`) y el aviso «Nueva versión disponible» actualizan los equipos solos.
3. Verificar en producción con una cuenta de administrador y una de sucursal: iniciar sesión, ver planes/evidencias/arqueos, que llegue un cambio hecho desde otro equipo, y en Supabase → Usage → Egress comprobar la baja a las 24 h.
**Reversión:** volver `main` al commit anterior (v512) y publicar; o publicar el contenido de la etiqueta. No hay cambios de datos.

## Paso 2 · E1 (base de datos; idempotente; no cambia datos)
1. Respaldo previo (Supabase → Database → Backups o `pg_dump` de `pa_docs`); anotar el número de filas y `select md5(string_agg(data::text,'' order by col,id)) from pa_docs where col='plans'`.
2. En un horario de poco uso, ejecutar `E1_miniaturas_y_listados.sql` en el editor SQL.
3. Verificar (con la cuenta de cada rol): el mismo conteo y huella de `pa_docs`; `select count(*) from pa_thumbs` = número de miniaturas; `select count(*) from pa_docs_lite where col='plans'` = planes visibles para esa cuenta (igual que `pa_docs`); sucursal no ve miniaturas de otras sucursales (`select count(*) from pa_thumbs` ≤ las de sus planes).
4. Abrir la app con una cuenta nueva: debe iniciar con ≈0.2 MB, mostrar las miniaturas al desplazarse y abrir un arqueo.
**Reversión:** `E1_reversion.sql` (quita disparador, vista y RPC; conserva `pa_thumbs` y los datos). Los equipos conectados en modo ligero deben recargar. Interruptor por equipo sin tocar la base: `localStorage.setItem('nx_nolite','1')` y recargar.

## Paso 3 · E2 (opcional, después de ≥ 1 semana estable)
`E2_compactar_miniaturas.sql` hace respaldo en `pa_docs_respaldo_e2`, comprueba que cada miniatura esté copiada con contenido idéntico y recién entonces quita las embebidas (sin tocar `updated_at`). **Reversión:** `E2_reversion.sql` (reincrusta desde `pa_thumbs`, conserva los cambios posteriores). `pa_docs_respaldo_e2` se borra solo con tu autorización.

## Criterios para detenerse
Cualquier diferencia de planes visibles entre `pa_docs` y `pa_docs_lite` para una cuenta, miniaturas de otra sucursal, error al guardar un plan, o foto que no se vea tras recargar → revertir el paso y avisar.

## Estado de la ejecución (28-nov-2026)
Paso 0 pendiente (necesita tu ejecución en el SQL Editor). **Paso 1 ejecutado:** `main` = 7d87921; flujos «Publicar Nexa en Cloudflare Pages» y «Publicar Supabase (SQL y funciones)» en verde; el paso «Ejecutar SQL cambiado» se omitió (ningún archivo de `supabase/auto` cambió) y solo se desplegó `recordatorios-de-nexa`. Pasos 2 y 3 (E1/E2): NO aplicados. Ver `INFORME-POSTPUBLICACION-V513.md` y `PREPARACION-E1.md`.
Nota: la etiqueta `nexa-v512-referencia-egress` solo existe en el clon de trabajo (el proxy no deja publicar etiquetas); la referencia remota es el commit `d06e3c1` (v512), padre directo de v513 en `main`: para volver, `git revert 7d87921` en `main` o publicar ese commit.
