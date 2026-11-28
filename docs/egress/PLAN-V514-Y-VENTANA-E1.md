# Plan de publicación de v514 y evaluación de la ventana previa a E1 (NADA de esto se ejecuta sin tu autorización)

## 1. Contenido de v514 (rama `ccr-9b56cef8-3yibwu`; NO está en `main`)
| Cambio | Estado al publicar | Riesgo | Reversión |
|---|---|---|---|
| **Descarga directa de fotos originales desde OneDrive** al bajar un plan (antes: cada foto pasaba en base64 por la función `super-api`, es decir, por Supabase). Con retroceso automático a la función si el navegador no puede leerlas (CORS/red) y memoria de 24 h para no reintentar | ACTIVO | bajo: si OneDrive no permite la lectura, todo sigue como en v513 | volver a v513 |
| **Arqueos incremental**: solo se vuelve a pedir la tabla cuya firma cambió y, de arqueos, las versiones modificadas | ACTIVO | bajo (probado idéntico a una recarga completa) | volver a v513 |
| **Baliza de versión** en la cabecera `X-Client-Info` (ya permitida por CORS) para medir qué equipos ya actualizaron | ACTIVO | muy bajo | — |
| **Caché persistente** de planes/avisos/usuarios (login solo con lo modificado) | **INACTIVA** (se activa con `PA_CONFIG.cache`) | decisión de seguridad tuya (datos en el equipo) | quitar la bandera |
| Lectura ligera + miniaturas bajo demanda (de v513) | inactiva hasta aplicar E1 | ver `PREPARACION-E1.md` | `nx_nolite` / `E1_reversion.sql` |
### 1.1 Antes de publicar: comprobar OneDrive (1 minuto, sin riesgo)
Con una cuenta de administrador en la app **v513 actual**, abre la consola del navegador (F12) y pega:
```js
(async()=>{const p=db.plans.find(x=>x.acts.some(a=>a.ev&&a.ev.o));if(!p)return'no hay un plan con foto original';const a=p.acts.find(a=>a.ev&&a.ev.o);const n=origName(a.ev.k,a.ev.x||'jpg');const u=await PhotoCloud.url(n);if(!u)return'la función no entregó enlace';const host=new URL(u).host;try{const r=await fetch(u,{credentials:'omit'});return 'LEE BIEN desde '+host+': HTTP '+r.status+', '+(await r.blob()).size+' bytes'}catch(e){return 'BLOQUEADO (CORS/red) desde '+host+': '+e}})()
```
**Importante: el dominio que imprime (`host`) dice si el enlace apunta a OneDrive/Microsoft (no cuenta como Egress de Supabase) o a `*.supabase.co` (la función hace de intermediaria: cada foto que se ve en grande también contaría como Egress).** `LEE BIEN` desde OneDrive ⇒ v514 ahorra todo el tráfico de fotos originales; `BLOQUEADO` ⇒ v514 se comporta como v513 en las descargas (sin pérdida) y habría que cambiar `super-api` para entregar el archivo con CORS (necesito su código). Pásame el resultado.
## 2. Orden de publicación
1. Tú: la comprobación de §1.1 y `medicion_egress.sql`.
2. Yo: pruebas finales de v514 (hechas) → presentarte el informe → **tu autorización** → mezclar a `main` (publica `nexa/`; no hay cambios en funciones ni SQL automático).
3. Verificar con la lista de 10 minutos (como en v513) + comprobar `X-Client-Info` en los registros.
4. Medir en Supabase (`PROCEDIMIENTO-MEDICION-REAL.md`).
## 3. ¿Se puede acortar la espera de 7 días para E1? Sí, con verificaciones objetivas
E1 solo afecta a quien siga en **v512** (verían las miniaturas en blanco sin perder datos; v513 y v514 ya soportan E1). Condiciones propuestas (todas deben cumplirse; sustituyen al plazo fijo):
| # | Verificación | Cómo se comprueba | Estado |
|---|---|---|---|
| 1 | **Ningún equipo activo en v512** durante 24 h consecutivas | Supabase → Logs → API Edge Logs: contar GET a `/rest/v1/pa_docs` con `select=col,id,updated_at` **sin** `updated_at=gt.` (firma del listado cada 20 s de v512: ≥ 180 por hora por equipo; v513/v514 hacen ≤ 2). Debe ser 0. Con v514 además: `X-Client-Info` contiene `nexa/v514` en ≥ 99 % de las solicitudes (consulta abajo) | por medir |
| 2 | **Compatibilidad de escritura con versiones anteriores** | probado: v512 sobre servidor con E1 no pierde ni sobrescribe evidencias (22 comprobaciones SQL + prueba de navegador) | ✔ local; repetir con cuentas reales tras E1 |
| 3 | **Ausencia de pérdida de evidencias** | E0 (respaldo exacto con huella) + `E2_reversion`/ida y vuelta byte a byte (probado) + recuento `pa_thumbs` = miniaturas de `pa_docs` tras E1 | ✔ local; en producción tras E0 |
| 4 | **Políticas RLS reales** | salida de `medicion_egress.sql` (`pa_docs_politicas`, `pa_docs_disparadores`) revisada por mí; prueba con una cuenta de cada rol tras E1 | pendiente de tu resultado |
| 5 | **Respaldo comprobado** | `E0_respaldo.sql` («E0 OK» con huella) + `pg_dump` en tu equipo | pendiente |
| 6 | **Reversión probada** | `E1_reversion.sql` y `E2_reversion.sql` probadas en PostgreSQL real (idempotentes, sin pérdida) | ✔ local |
**Ventana mínima razonable:** 2 días hábiles completos tras publicar la versión (los equipos se actualizan solos al abrir la app) **y** verificación 1 cumplida 24 h; no antes. Si algún equipo sigue en v512, se le avisa o se espera.
Consulta de adopción (Logs Explorer; ajustar si cambia el esquema de los registros):
```sql
select regexp_extract(h.x_client_info, r'nexa/(v[0-9]+)') as version, count(*) as solicitudes
from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r cross join unnest(r.headers) as h
where r.path like '/rest/v1/%' group by 1 order by 2 desc
```

## 4. Nota sobre la política de seguridad de contenido (CSP)
`nexa/_headers` publica hoy `Content-Security-Policy-Report-Only` (solo informa, no bloquea). La descarga directa y las fotos en grande usan enlaces de OneDrive, que esa política no lista en `connect-src`/`img-src`. **Si algún día se pasa a una CSP que bloquea**, hay que añadir el dominio de OneDrive/SharePoint indicado por la comprobación de §1.1; de lo contrario la descarga directa se bloquearía (retrocedería a la función, sin pérdida, pero sin ahorro).
