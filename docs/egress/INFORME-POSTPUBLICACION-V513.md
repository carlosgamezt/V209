# Informe posterior a la publicación de NEXA v513 (P0 del cliente + función recordatorios-de-nexa)

Publicado el 28-nov-2026 00:54 UTC (27-nov 18:54 Guatemala): `main` = **7d87921** (padre: d06e3c1 = v512). **E1 y E2 NO se aplicaron.** No se tocó NEXA FEL, `nexa-demo`, otros proyectos ni la interfaz; no se eliminó ningún registro, foto ni evidencia; sin costos.

## 1. Verificaciones previas a mezclar (todas satisfactorias)
| Verificación | Resultado |
|---|---|
| Diff completo contra la referencia v512 | 28 archivos: `nexa/` (3: `index.html`, `sw.js`, `manifest.webmanifest`), `supabase/functions/recordatorios-de-nexa/index.ts` (1: lectura por la vista ligera con retroceso a la tabla), y archivos que **no se publican** (docs, pruebas, propuestas SQL, consultas). Sin cambios en `nexa/config.js`, `_headers`, íconos ni otras funciones |
| Flujos automáticos | «Publicar Nexa» se dispara con `nexa/**` y sube solo la carpeta `nexa/`; «Publicar Supabase» se dispara con `supabase/auto/**` y `supabase/functions/**`, ejecuta SQL **solo de archivos cambiados en `supabase/auto/`** (ninguno cambió) y despliega **solo las funciones cambiadas** (solo `recordatorios-de-nexa`) |
| E1/E2 no corren solos | están en `supabase/propuestas/egress/` (fuera de `supabase/auto` y de los patrones del flujo); en la ejecución real el paso «Ejecutar SQL cambiado» salió **omitido** |
| Lo publicado es lo probado | `diff -r` entre `nexa/` probado y `git archive origin/main nexa`: idéntico; `APP_VER='v513'` |
| Conservar versión anterior y reversión | v512 = commit `d06e3c1` (padre directo): `git revert 7d87921` en `main` o publicar ese commit; no hay cambios de datos que deshacer. (La etiqueta `nexa-v512-referencia-egress` existe solo en el clon de trabajo: el proxy no permitió publicar etiquetas) |
| Continuidad con versiones anteriores abiertas | La base no cambió: v512 y v513 usan el mismo protocolo y las mismas tablas; una v512 abierta sigue trabajando y guardando igual. v513 solo pide menos datos. La app compara su versión cada pocos segundos y se actualiza sola al quedar inactiva (sin perder lo escrito: el guardado y los borradores no cambiaron) |
## 2. Publicación
| Flujo | Ejecución | Resultado |
|---|---|---|
| Publicar Nexa en Cloudflare Pages | 46090375799 | éxito |
| Publicar Supabase (SQL y funciones) | 46090375784 | éxito; SQL omitido; función `recordatorios-de-nexa` desplegada |
## 3. Verificación posterior
**Hecho (sobre el artefacto exacto publicado, Supabase simulado):** `funcional.cjs` con 5 roles × todas sus vistas — mismos planes visibles, avisos, contadores de no leídos, estados y avances, fotos y textos (se normaliza solo la etiqueta de versión v512→v513 y la hora de sincronización de la semilla); `recuperacion.cjs` 6/6 (cambio de otra persona al instante con Realtime; con Realtime caído el sondeo de respaldo trae lo nuevo ≤ 60 s; el borrado ajeno se detecta al recuperar; recreación del canal a los 45 s; 0 consultas en segundo plano); escritura de evidencia por una sucursal (el plan se guarda y la foto se ve). Resultados en `pruebas/egress/resultados/funcional_publicada_pc.json`.
**No verificable por mí (necesita cuentas reales y acceso a producción, que no tengo y no debo pedirte por chat):** inicio de sesión real, aprobaciones y correcciones, notificaciones/contadores, firmas y PDF de arqueos, dashboard y permisos reales por sucursal/región/administrador, y el comportamiento en tu teléfono. El dominio de producción no es accesible desde este entorno (el proxy lo bloquea). **Lista de comprobación para ti (≈10 min, con una cuenta de administrador y una de sucursal, en computadora y en teléfono):**
1. Entrar; confirmar que el encabezado dice «Nexa v513» (recargar si dice v512).
2. Planes: lista, abrir un plan, ver sus evidencias antes/después.
3. Con la cuenta de sucursal: subir una evidencia de prueba en un plan de prueba y verla; con la de administrador (otro equipo/pestaña) ver que aparece sola, sin recargar.
4. Aprobar y corregir una actividad de prueba; ver notificaciones y contadores.
5. Arqueos: abrir uno, ver firmas, descargar/imprimir el PDF.
6. Dashboard y Presentación (filtros, pantalla completa).
7. Dejar la app 5 min con la pestaña en segundo plano y volver: debe seguir al día.
8. Comprobar que la sucursal solo ve lo de su sucursal y el supervisor lo de su región.
Cualquier diferencia → reversión inmediata (§1) y avísame.
## 4. Hallazgos que debes conocer
1. **Incompatibilidad futura con E1 (medida):** tras E1 (planes escritos después) o E2, una v512 abierta mostraría las miniaturas en blanco hasta actualizarse; sus datos, estados y avances se ven igual y **no se pierde ninguna evidencia**. Por eso E1 solo después de ≥ 7 días con v513 (ver `PREPARACION-E1.md`).
2. **NEXA FEL — CI hospedado:** el paso «Paginación de clientes y conceptos…» de «NEXA FEL · pruebas» falló en el commit del candidato 53857a9 y en bac4f24 (los demás pasos pasaron). En local pasó (20/20 navegador). No lo toqué (FEL fuera de alcance); lo señalo porque el candidato estable se aprobó con esos resultados locales.
3. No pude revisar `super-api` (su código no está en el repositorio).
## 5. Siguientes pasos
1. Tú: la lista de §3 y `medicion_egress.sql` (instrucciones en `PREPARACION-E1.md`).
2. Medir P0 en Supabase (`PROCEDIMIENTO-MEDICION-REAL.md`): mínimo 3 días completos antes de cualquier cifra de ahorro.
3. Con el resultado y los 7 días de adopción: revisar y pedirte autorización para E0 + E1.
