# CLAUDE.md — NEXA (repositorio V209)
Léelo completo al empezar. Este archivo manda sobre cualquier costumbre por omisión. Idioma: **español**, informes **breves** (qué se hizo, resultados reales vs simulados, qué falta de mi parte), sin repetir lo ya verificado.

## 1. Qué hay aquí
- `nexa/` app NEXA principal (planes de acción, arqueos, supervisión; un solo `index.html`). Se publica en Cloudflare Pages (proyecto `nexacorp`) desde `main`.
- `supabase/` `auto/` (SQL que se aplica solo al llegar a `main`), `functions/` (Edge Functions: `super-api`, `recordatorios-de-nexa`, `arqueos`, `supervision-sucursal`), `consultas/` (SQL de solo lectura), `propuestas/` (migraciones preparadas, NO activas, p. ej. E2).
- `pruebas/egress/` banco de pruebas (SQL local, RLS, funciones con Deno, navegador con Playwright) y `suite_integral.sh`.
- `docs/egress/` estado y guías: **`ESTADO-PRODUCCION.md`** (qué está aplicado y qué no), `ESTANDAR-DESARROLLO-NEXA.md` (estándar obligatorio), `ACTIVACION-Y-RETIRO.md`, `COMPROBACIONES-Y-ACTIVACION.md`, `AUDITORIA-SUPER-API.md`.
- `docs/plantillas/` plantillas inertes para productos nuevos (ver §6). `docs/TEXTO-DE-ARRANQUE.md` texto para iniciar un chat nuevo.
- Ramas `fel-*` y carpeta `fel-pub2-wt/` pertenecen a **NEXA FEL**: no se tocan ni se versiona `*-wt/`.

## 2. Reglas permanentes (no negociables sin orden expresa del usuario)
1. **No publicar en producción sin autorización expresa y específica** (merge/push a `main`, secretos, activar funciones). Todo se desarrolla y prueba en la rama de la sesión; lo que llega a `main` se despliega solo (§5).
2. **No afectar NEXA FEL, nexa-demo ni otros proyectos.** No generar costos (no contratar servicios, no cambiar de plan, no crear proyectos de pago).
3. **Seguridad:** no exponer ni escribir credenciales, claves, tokens o enlaces permanentes (ni en chat, repositorio, capturas o registros); no debilitar RLS ni ampliar permisos; no modificar políticas RLS existentes sin autorización; las funciones nuevas son `SECURITY INVOKER` salvo justificación.
4. **Datos:** no eliminar información histórica; fotos, firmas y documentos no se pierden; migraciones aditivas, idempotentes, con respaldo previo y reversión probada (que conserva las modificaciones legítimas posteriores al respaldo).
5. **No cambiar la identidad visual ni las funcionalidades aprobadas** sin que se pida.
6. **Todo ahorro o mejora se mide con datos** y se distingue lo REAL (producción) de lo SIMULADO (banco local). Egress de Supabase = lo contabilizado por Supabase; tráfico interno PostgreSQL→función es otra cosa.
7. Mantener estables lo ya publicado (E0, E1a, E1, E3, v516) y E2 **sin aplicar** hasta confirmar: sin clientes antiguos activos y sin dependencia de miniaturas embebidas.

## 3. Estándar de arquitectura (resumen; detalle en `docs/egress/ESTANDAR-DESARROLLO-NEXA.md`)
- Pedir solo lo necesario; sincronización incremental (`updated_at`); contadores y agregados en PostgreSQL; sin `select *`; sin Base64 dentro de registros listados.
- **El backend autoriza, el almacenamiento transfiere (§7 del estándar):** archivos pesados van entre el dispositivo y OneDrive/almacén con credenciales temporales de una sola ruta; alternativa segura por el camino anterior; piloto solo administrador; interruptor de apagado.
- Seguridad en el servidor (RLS + `security_invoker`); autorización por recurso real, no solo «sesión iniciada».
- **Estándar obligatorio para NEXA CORE, FEL, Hotel, POS y Colegios: `docs/egress/ESTANDAR-DESARROLLO-NEXA.md` §8** (autorización por recurso, activación por fases con registro, secretos, pruebas y publicación idénticas al candidato, no optimizar sin beneficio medido). Cierre técnico de la optimización: `docs/egress/CIERRE-TECNICO-OPTIMIZACION.md`.
- Un proyecto de Supabase **por producto** (FEL, POS, Colegios, Hotel…); tablas/funciones con prefijo del producto (`pos_`, `col_`, `hot_`); `empresa_id` y membresías desde el inicio; sin tablas compartidas entre productos; sin compartir claves entre proyectos.

## 4. Cómo se prueba (en este orden; reutilizar lo ya válido, no repetir auditorías)
1. **Local/simulado (siempre, antes de proponer nada):** PostgreSQL local efímero con la réplica de políticas RLS (`pruebas/egress/rls_real/`, `test_*.sh`), funciones con Deno contra un PostgREST/almacén simulado (`super_api_test.ts`, `recordatorios_fn_test.ts`), interfaz con Playwright y un Supabase falso (`fake_supabase.js`, `funcional.cjs`…). Nunca se toca producción desde el banco.
2. **Pruebas específicas** durante el desarrollo; **una sola suite integral** sobre el candidato final: `pruebas/egress/suite_integral.sh` (no declarar aprobada sin ejecución completa en verde sobre el commit exacto que se publicará).
3. **Vista previa con enlace de pruebas** (como NEXA FEL): despliegue de Cloudflare Pages de una rama que NO es producción, con confirmación manual y verificación de destino (`docs/plantillas/preview-producto.yml`). Sin Supabase de producción ni datos reales.
4. **Verificación en producción** solo con los flujos de solo lectura («Consultar Supabase») y migraciones que se comprueban con los perfiles reales dentro de una transacción que se deshace si algo difiere.

## 5. Cómo se despliega (flujos de GitHub; el repositorio es público: nunca imprimir secretos, solo conteos/huellas)
- `Publicar Supabase`: al llegar a `main`, ejecuta SOLO los `supabase/auto/*.sql` cambiados y despliega SOLO las funciones cambiadas (`verify_jwt` en `supabase/config.toml`).
- `Publicar Nexa`: al cambiar `nexa/**` en `main`. `Consultar Supabase (solo lectura)`: ejecuta un `.sql` de `supabase/consultas/` (solo SELECT; sin palabras de escritura ni siquiera en comentarios).
- Rama de trabajo de la sesión → pruebas → informe → **autorización del usuario** → publicar solo lo autorizado a `main`, en pasos (primero Supabase y verificación, luego el cliente). Nunca publicar flujos que den acceso nuevo a producción.
- Cada activación es progresiva y reversible: modo registro → obligar; piloto administrador → lista → todos; con interruptor de apagado.

## 6. Productos nuevos (POS, Colegios, Hotel, FEL…) — un producto a la vez
Usar `docs/plantillas/README.md` (estructura, proyecto de Supabase propio, banco de pruebas, vista previa con enlace, lista de verificación). Hasta que el usuario cree el proyecto de Supabase del producto, **todo se desarrolla contra la réplica local**; las claves nunca se pegan en chat.

## 7. Cómo trabajar (ahorro de créditos)
Leer primero este archivo y `docs/egress/ESTADO-PRODUCCION.md`; buscar con precisión en el código; cambios mínimos y localizados; paralelizar lo independiente; no releer lo ya verificado; commit por cambio funcional; **al terminar una tarea importante actualizar `ESTADO-PRODUCCION.md`** (qué se hizo, archivos, decisiones, pendientes, siguiente paso exacto). Si algo se bloquea, continuar con lo independiente y **agrupar** las solicitudes que necesiten al usuario, con instrucciones exactas (pasos y código completo para pegar, no solo rutas). El entorno de la sesión no tiene acceso directo a producción ni a OneDrive; el sistema de permisos puede bloquear acciones sensibles: no se eluden, se explican.
