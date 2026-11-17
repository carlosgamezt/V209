# NEXA FEL · Fase A preparada: `verificar-api-vault` (#8) y validación inicial de Supabase
Estado: 17/11/2026. **Nada de esto se ha ejecutado por mi parte desde que lo pediste; todo es de solo lectura y cada paso lo apruebas tú en `demo-privada`.** Meta: llegar cuanto antes a una URL de demostración funcional para Android y PC sin saltarse ningún control.

## 1. Qué secretos usa esta fase (solo nombres; los valores nunca se ven ni se pegan)
| Paso | Secretos del entorno `demo-privada` | ¿Ya existen? |
|---|---|---|
| `verificar-inicial` (A2) | `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL` | **Sí**: la ejecución #7 los usó y dio 0 REVISAR |
| `verificar-api-vault` (A1 · #8) | `DEMO_SUPABASE_PROYECTO_REF`, **`DEMO_SUPABASE_ANON_KEY`** | La referencia sí. **La clave pública: no lo sé** (no puedo listar secretos) |
Cómo comprobarlo: GitHub → repositorio → *Settings → Environments → demo-privada → Environment secrets*: muestra solo los nombres. Si falta `DEMO_SUPABASE_ANON_KEY`, la ejecución #8 se detiene sola antes de enviar nada, con «Falta FEL_DEMO_ANON_KEY…».

## 2. Si falta `DEMO_SUPABASE_ANON_KEY` (lo creas tú)
1. Supabase → proyecto `nexa-demo` → *Project Settings → API (API Keys)* → copia la clave **pública**: la `anon` (JWT que empieza por `eyJ…`) **o** la «publishable» (`sb_publishable_…`).
2. GitHub → *Settings → Environments → demo-privada → Add environment secret* → nombre exacto `DEMO_SUPABASE_ANON_KEY` → pega la clave.
3. **Nunca** `service_role`, `sb_secret_…` ni la de otro proyecto: el verificador las rechaza antes de hacer ninguna petición.

## 3. Orden exacto de la Fase A (de uno en uno)
| # | Qué | Cómo | Resultado posible | Yo después |
|---|---|---|---|---|
| A1 | `verificar-api-vault` | Aprobar en `demo-privada` la ejecución **#8** (ya está en espera): https://github.com/carlosgamezt/V209/actions/runs/43955049367 | **OK** (la API no expone `vault`) · **REVISAR** (lo expone) · **NO VERIFICADO** (no se pudo comprobar; nunca se toma por seguro) | Leo el registro (sin claves) y te presento el resultado exacto, distinguiendo acceso por API de privilegios de PostgreSQL |
| A2 | `verificar-inicial` (justo antes de migrar) | **Solo después** de que #8 termine: lanzo `migraciones-nube` con `accion=verificar-inicial` y tú la apruebas | 0 REVISAR · o diferencias que se presentan sin ajustar nada | Te presento las filas; si hay cualquier REVISAR, me detengo |
**Importante (concurrencia):** los dos flujos comparten el grupo `publicar-nube`; GitHub guarda solo la ejecución pendiente más reciente. Lanzar A2 mientras #8 espera **cancelaría #8**. Por eso A2 se lanza únicamente cuando #8 haya terminado.

## 4. Qué decide cada resultado de A1
- **OK:** se sigue con A2 y luego la Fase B.
- **REVISAR (vault expuesto):** me detengo y te propongo cómo cerrarlo en los ajustes de la API del proyecto (sin tocar esquemas ni permisos por mi cuenta); no se migra hasta resolverlo.
- **NO VERIFICADO:** se explica la causa (clave inválida, red, 401…) y se repite tras corregirla; no se continúa como si fuera seguro.
Nota: el privilegio directo de PostgreSQL de `service_role` sobre `vault` ya está verificado (diagnóstico #5) y no depende de A1; por eso las credenciales de Digifact **no** irán a Vault.

## 5. Después de la Fase A (camino más corto hacia la URL, sin atajos de seguridad)
B1 etapa 1 → V1 → B2 etapa 2 → V2 → C1 `publicar-nube` en modo `verificar` → C2 `publicar` (Digifact apagado) → C3 URL verificada con la prueba de humo. Detalle y criterios de parada: `OPERACIONES-HABILITAR-DEMO-NUBE.md`. Son 6 aprobaciones tuyas (A1, A2, B1, B2, C1, C2) en `demo-privada` y, antes de C1, comprobar que existen los 12 secretos `DEMO_*` de publicación (lista en `PREPARACION-DEMO-NUBE.md` §4).

## 6. Corrección de la sonda tras la ejecución #9 (local, sin subir ni ejecutar)
#9 dio NO VERIFICADO: la sonda de control (GET a la raíz «/rest/v1/», que devuelve el listado OpenAPI) recibió **HTTP 401**. Supabase retiró ese listado a las claves públicas (aviso «Breaking Change: Removing access to OpenAPI spec via the anon key»), así que el 401 de la raíz no prueba que la clave sea mala. Ahora ambas sondas piden una **tabla inexistente** (`fel_sonda_inexistente?limit=0`; no se lee ningún dato): control = 404 `PGRST205`/`42P01` (clave válida y `public` expuesto); vault = 406 `PGRST106` sin `vault` en la lista → OK; 404/200 con el perfil `vault` o `vault` en la lista → REVISAR; 401, 403, 500, red o cualquier otra cosa → NO VERIFICADO (nunca seguro). Pendiente: tu autorización de push y de una ejecución nueva (#10).

## 7. A1 CERRADA: ejecución #12 (commit `b849c05`) = OK
Control `public`: HTTP 404 `PGRST205` (clave publicable válida). Sonda `vault`: HTTP 406 `PGRST106`; esquemas expuestos por la API: `public, graphql_public` → **`vault` NO está expuesto por la API de datos**. Solo lectura; nada se modificó. (Lo que sigue pendiente de seguridad en `vault` son los privilegios directos de PostgreSQL de `service_role`, ya conocidos: por eso Digifact no usa Vault.)

## 8. A2 preparada (`verificar-inicial`), NO ejecutada
- **Cómo:** `migraciones-nube.yml` · `accion=verificar-inicial` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`. Sin confirmaciones de escritura: no existe ruta a `db push`.
- **Secretos que usa:** `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL` (ya usados por #7 con 0 REVISAR). No necesita `DEMO_SUPABASE_ANON_KEY`.
- **Qué hace:** una conexión por el Session Pooler, sesión y transacción de solo lectura, SQL solo SELECT (`docs/migracion-28/verificacion-inicial-nexa-demo.sql`); confirma «sesión de solo lectura | on | on | OK».
- **Se detiene si:** cualquier `REVISAR`, huella de `rls_auto_enable` distinta, o la sesión no queda confirmada como de solo lectura.
- **Condición previa:** que no haya otra ejecución pendiente en el grupo `publicar-nube` (ya no la hay; #12 terminó).
- **Después:** B1 etapa 1 (`APLICAR-MIGRACIONES`), con autorización específica.

## 9. A2 CERRADA: ejecución #13 (commit `f39149d`) = 0 REVISAR
19 comprobaciones OK, 12 informativas (INFO), **0 REVISAR**; sesión confirmada de solo lectura. Base vacía: 0 tablas en `public`, sin historial de migraciones (las 28 aprobadas están pendientes: 27 de la etapa 1 + la 28), 0 funciones propias no reconocidas, `public.rls_auto_enable()` reconocida por huella, PostgreSQL 17.11, dependencias de Auth completas. Informativo conocido: `service_role` tiene USAGE sobre `vault` (ya registrado; Digifact no usa Vault).

## 10. B1 preparada, NO ejecutada (primera operación que MODIFICA nexa-demo)
- **Cómo:** `migraciones-nube.yml` · `accion=migraciones-etapa` · `etapa=1` · `confirmar=APLICAR-MIGRACIONES` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`.
- **Secretos:** `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL`, `DEMO_SUPABASE_ACCESS_TOKEN`, `DEMO_SUPABASE_DB_PASSWORD` (los dos últimos solo los usa este paso). Confirmar que existen antes: si faltan, el flujo falla sin aplicar nada.
- **Qué aplica:** migraciones 1–27 (exige base vacía y sin historial, como confirma A2). V1 automática al terminar (solo lectura): 27 registradas, 67 tablas con RLS, dependencias de Auth sin faltantes, 0 filas.
- **Se detiene si:** V1 da cualquier cifra distinta; entonces NO se lanza la etapa 2 y la recuperación es un proyecto Supabase nuevo (`PROPUESTA-FINAL-APLICACION-SEGURA.md` §1).
- **Después:** B2 (etapa 2, migración 28) solo con otra autorización, sin cargar datos entre ambas.

## 11. B1 EJECUTADA: ejecución #14 (commit `c8bd7d6`) = OK
Etapa 1 aplicada en `nexa-demo`: las 27 migraciones, una por una, sin errores. V1 de la propia ejecución: 27 registradas, RLS activo en las **67** tablas, dependencias de Auth sin faltantes; `service_role` con USAGE sobre `vault` (conocido), `anon`/`authenticated` sin él. La etapa 2 NO se ha aplicado.
**Limitación detectada:** V1 (código de la ejecución #14) NO comprobaba políticas, privilegios efectivos ni filas, aunque los documentos lo decían. Se refuerza (ver §12).

## 12. V1 reforzada (local, probada en PostgreSQL con las 27 migraciones; pendiente de subir)
`docs/migracion-28/verificacion-posterior-27.sql` (solo lectura, mismo mecanismo que el de la 28) comprueba tras la etapa 1: RLS en toda tabla; `anon` sin ningún privilegio y `authenticated` solo SELECT; políticas solo de lectura y con condición de empresa; sin vistas; SECURITY DEFINER con `search_path` y sin acceso de `anon`; CASCADE solo en la lista conocida; **67 tablas, 49 políticas, 182 funciones, 57 disparadores**; `anon` sin funciones ejecutables y `authenticated` solo `fel_es_admin_plataforma`, `fel_es_miembro`, `fel_tiene_permiso`; `anon`/`authenticated` sin USAGE en `vault`; **0 filas de negocio** (solo las 9 tablas de semillas con su número exacto, `empresas`=0); semillas «falla cerrado» (`emision_real_disponible=false`, proveedores solo `simulado`, regímenes `sin_verificar`). `supabase-hospedado.sh verificar-etapa 1` y `migraciones-etapa 1` lo ejecutan. Probado: pasa sobre las 27 migraciones y detecta 5 alteraciones provocadas (GRANT a `anon`, escritura a `authenticated`, ejecución de función por `anon`, fila ajena a las semillas…).
**Para ejecutarla en la nube:** autorizar el push de este commit y lanzar `verificar-etapa` · `etapa=1` (solo lectura; aprobación en `demo-privada`).

## 13. B2 preparada, NO ejecutada
- **Antes:** `verificar-etapa 1` con la V1 reforzada en verde (§12).
- **Cómo:** `migraciones-nube` · `migraciones-etapa` · `etapa=2` · `confirmar=APLICAR-MIGRACIONES`. Exige EXACTAMENTE las 27 registradas; sin cargar datos entre etapas.
- **Qué aplica:** migración 28 (empresas no se borran ni se vacían, `service_role` pierde DELETE/TRUNCATE, disparadores sin EXECUTE, FK compuesta en `ordenes_confirmaciones`). V2 automática: 28 registradas y `verificacion-posterior-28.sql` (catálogo completo).
- **Después (sin atajos):** C1 `publicar-nube` modo `verificar` (comprueba los 12 secretos `DEMO_*` y la conectividad sin tocar nada) → C2 `publicar` con `digifact=apagado` y `PUBLICAR` → C3 URL entregada solo tras la prueba de humo; luego recorrido en Android y PC con `GUIA-PRIMERA-SESION.md`.

## 14. V1 reforzada EJECUTADA en la nube: ejecución #15 (commit `1a3f947`, `verificar-etapa` etapa 1) = OK
27 registradas; RLS en las 67 tablas; Auth sin faltantes; `vault`: `anon`/`authenticated` sin USAGE (`service_role` sí, conocido); `verificacion-posterior-27.sql` en verde: 67 tablas, 49 políticas, 182 funciones, 57 disparadores, `anon` sin privilegios ni funciones, `authenticated` solo SELECT y solo 3 funciones, 0 filas de negocio (solo las 9 tablas de semillas con su número exacto), `emision_real_disponible=false`, proveedores solo `simulado`, regímenes `sin_verificar`. **B2 lista para autorizar** (§13).

## 15. B2 EJECUTADA: ejecución #16 (commit `aa61841`) = OK (V2 automática)
Migración 28 aplicada en `nexa-demo` (1 sola, precondición «exactamente las 27» cumplida). V2: **28 registradas**; RLS en las 67 tablas; Auth sin faltantes; `vault` sin USAGE para `anon`/`authenticated`; `verificacion-posterior-28.sql` en verde (empresas no se borran ni vacían, `service_role` sin DELETE/TRUNCATE sobre tablas fiscales/libros/auditoría, disparadores sin EXECUTE para roles de la API, FK compuesta de `ordenes_confirmaciones`, SECURITY DEFINER con `search_path`, CASCADE solo en la lista conocida). `nexa-demo` queda con el esquema completo aprobado (28 migraciones); la 29 sigue fuera.

## 16. C1 preparada, NO ejecutada (`publicar-nube` · `modo=verificar`)
- **Cómo:** `publicar-nube.yml` · `modo=verificar` · `digifact=apagado` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`. No toca nada: ejecuta `publicar-nube.sh --simular` (comprueba variables y herramientas y muestra el plan).
- **Requisitos (los verifica C1; yo no puedo ver los secretos):** los 12 secretos de `demo-privada`: `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_SUPABASE_ACCESS_TOKEN`, `DEMO_SUPABASE_DB_PASSWORD`, `DEMO_BD_URL`, `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY`, `DEMO_CLAVES`, `DEMO_MFA_SEMILLAS`, `DEMO_PROXY_SECRETO`, `DEMO_CLOUDFLARE_API_TOKEN`, `DEMO_CLOUDFLARE_ACCOUNT_ID`, `DEMO_PAGES_PROYECTO` (debe ser exactamente `nexa-fel-demo`; el script lo exige). Herramientas del ejecutor: deno, node, npx, supabase, jq, curl.
- **Destinos fijos:** el script solo puede tocar `nexa-demo` y la página `nexa-fel-demo`; cualquier otra referencia → PROHIBIDO.
- **Si faltan secretos:** C1 los lista por nombre y se detiene (sin valores). Los creas tú en GitHub (*Settings → Environments → demo-privada*), nunca en el chat. `DEMO_CLAVES` y `DEMO_MFA_SEMILLAS` salen de `deno run src/generar_secretos.ts` (guárdalas tú; son las contraseñas de la demostración).
- **Después:** C2 `publicar` con `digifact=apagado` y `confirmar=PUBLICAR` (la migración ya aplicada hace que `db push` no tenga nada pendiente), y C3 la URL tras la prueba de humo.

## 17. C1 EJECUTADA: `publicar-nube` #13 (commit `188ff4e`, `modo=verificar`, `digifact=apagado`) = OK
Las 12 variables llegaron con valor (todas enmascaradas; el script no reportó faltantes), la referencia y el proyecto de Pages coinciden con los fijados (`nexa-demo`, `nexa-fel-demo`), `DEMO_BD_URL` corresponde al pooler de `nexa-demo`, CLI de Supabase 3.2.0 con todas las opciones requeridas, y `db push --dry-run`: **«Remote database is up to date», 0 pendientes** (28 de 28). Digifact: todas sus variables vacías (apagado). Nada se modificó ni se imprimió ninguna credencial.

## 18. C2 preparada, NO ejecutada (primera operación que PUBLICA y escribe datos en `nexa-demo`)
- **Cómo:** `publicar-nube.yml` · `modo=publicar` · `confirmar=PUBLICAR` · `digifact=apagado` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`.
- **Qué hace, en orden (`publicar-nube.sh`):** (1) protecciones de destino; (2) Cloudflare Pages: crea `nexa-fel-demo` con Wrangler si no existe; (3) `db push`: sin pendientes (no-op); (4) **aprovisionar**: siembra el mundo simulado SOLO si la base está vacía (se niega ante empresas ajenas) y registra las contraseñas de `DEMO_CLAVES` como hash PBKDF2 — **es la primera escritura de datos en `nexa-demo`**; (5) construye página y función; (6) secretos y despliegue de la función `nexa-demo` (sin JWT, con `FEL_PROXY_SECRETO`; sin Digifact); (7) secretos y despliegue de Pages; (8) **prueba de humo** contra la URL real (inicio de sesión, MFA, factura, certificación simulada, PDF, persistencia).
- **Garantías:** todo `simulado`; `emision_real_disponible=false`; sin credenciales fiscales; Cloudflare y el navegador nunca ven secretos de Supabase ni de Digifact.
- **Si la prueba de humo falla:** NO se entrega la URL; se diagnostica y se corrige antes de repetir. El aprovisionamiento es idempotente (no resiembra si la base ya tiene la demo).
- **Después (C3):** te entrego la URL solo tras la prueba de humo en verde; pruebas en PC y Android con `GUIA-PRIMERA-SESION.md`; las contraseñas son las de tu `DEMO_CLAVES` (nunca en el chat).

## 19. C2 intento #14 (commit `6812a8b`): FALLÓ en el paso 4/8 (aprovisionar), antes de sembrar y de desplegar
Pasos 1–3 OK (destino fijo, Pages `nexa-fel-demo` ya existía y se reutilizó, `db push`: «Remote database is up to date»). Paso 4: **Supabase Auth rechazó el alta de un usuario (HTTP 400)**. Estado resultante: **no se sembró nada en las tablas de NEXA** (los usuarios de Auth se crean primero y son idempotentes), **no se desplegó la función ni la página**, no hay URL. Pudo quedar creado algún usuario de Auth (confirmado, sin contraseña); repetir es seguro.
**Causa probable (NO verificada):** el correo sintético `<nombre>@demo.example` usa un dominio reservado que el validador de correo de Supabase Auth puede rechazar (`email_address_invalid`). El registro solo mostraba el estado 400 (por diseño no se vuelca el cuerpo).
**Cambio local (commit pendiente de subir):** el error ahora incluye únicamente el `error_code` de Auth (`estado 400, código <código>`), nunca el cuerpo ni claves (prueba añadida). Así el siguiente intento da la causa exacta.

## 20. C2 intento #15 (commit `8303396`): mismo punto, causa identificada
Paso 4 otra vez: **HTTP 400, código `validation_failed`** (no `email_address_invalid`: la hipótesis del dominio `demo.example` queda descartada como causa principal). Nada sembrado, nada desplegado, sin URL.
**Causa concreta (inferida de los datos, no del cuerpo):** de las 3 personas, `Mario` y `Nora` tienen correo ASCII y `Sofía` genera `sofía@demo.example`, con una **tilde en la parte local**; GoTrue valida el formato y devuelve 400 `validation_failed` para correos no ASCII. Es el único correo del conjunto que difiere en formato.
**Corrección (local):** `correoDemo()` en `usuarios_auth.ts` genera la parte local solo en ASCII (quita tildes y símbolos): `sofia@demo.example`; se usa en `aprovisionar.ts`, `mundo_demo.ts` y `mundo_practico.ts`. El **dominio no cambia** y el correo no se usa para iniciar sesión (la demo tiene su acceso propio): solo identifica al usuario en Auth. Idempotente: `mario@` y `nora@` ya creados se reconocen por id+correo idénticos; `sofia@` es nuevo. Pruebas: suite de la demostración 21 OK; con PostgreSQL real 27 OK.

## 21. C2 intento #16 (commit `56bf80a`): aprovisionamiento y despliegue OK; la prueba de humo falló en UNA comprobación
Pasos 1–7 OK: destino fijo, Pages reutilizado, `db push` sin pendientes, **aprovisionamiento correcto** (el 400 era el correo con tilde), función y página desplegadas. Paso 8 (prueba de humo, 14 OK, 1 FALLO): OK API sin sesión, sin contraseña pública, HSTS, sin CORS abierto, sin sesión no hay datos, robots.txt, inicio de sesión de ana, cookie HttpOnly+SameSite=Strict+Secure, datos de la empresa visibles, el administrador exige MFA, rechaza un código erróneo, entra con su código y ve la plataforma. **FALLO: «factura con varios ítems creada»** (`POST /api/documentos` no devolvió 200); las comprobaciones siguientes (certificación simulada, PDF, persistencia) no llegaron a ejecutarse. La causa no se ve en el registro (la API devuelve «interno» sin más).
**Diagnóstico añadido (local):** la respuesta 500 incluye `detalle` = solo el código de la causa (p. ej. `SQL_42501` o el nombre de la clase de error; nunca mensaje ni datos) y la prueba de humo imprime HTTP, código y detalle de ese paso. La URL **no** se entrega como verificada hasta que pase el recorrido completo.

## 22. C2 intento #17 (commit `d870383`): el fallo NO es un 500, es un **401 `no_sesion`** en `POST /api/documentos`
Mismo punto que #16 (14 OK + 1 FALLO), ahora con el diagnóstico: **HTTP 401, código `no_sesion`**, sin `detalle` (no es un error interno). Es decir: la sesión de `ana` valía para `GET /api/estado` (datos de la empresa visibles) y **no** para el `POST` siguiente (50 ms después). Aprovisionamiento y despliegue siguen OK; la URL **no** está verificada.
**Lo que se descartó leyendo el código:** el intermediario de Cloudflare reenvía todas las cabeceras (incluida `cookie`) en GET y POST; la API solo emite cookie al entrar/salir/cambiar clave; las sesiones están en la base (`demo_sesiones`), no en memoria; en local la cadena completa (PostgreSQL real + página + intermediario + función) pasa el recorrido entero (`NUBE LOCAL E2E OK`). Es un fallo **solo de la nube** y su causa no se puede deducir sin más datos.
**Preparado (local, sin subir):** (1) la prueba de humo, si el POST falla, imprime —solo estados, códigos y NOMBRES de cookies— el estado del `GET /api/estado` posterior y de un segundo `POST` (distingue «sesión muerta» de «fallo propio del POST» y de «cookie sustituida»); (2) nuevo modo `publicar-nube` · `modo=probar`: ejecuta SOLO la prueba de humo contra la página YA publicada (no migra, no aprovisiona, no despliega, no pide `PUBLICAR`), para diagnosticar sin otro ciclo de publicación.

## 23. Causa del 401 `no_sesion` IDENTIFICADA (ejecución #18, `modo=probar`, commit `f483f24`): defecto de la PRUEBA de humo, no de la aplicación
Diagnóstico impreso: `POST /api/documentos` HTTP 401 `no_sesion`; **cookies en la respuesta: `__cf_bm`**; `GET /api/estado` posterior: 401; segundo `POST`: 401. `__cf_bm` es la cookie de Cloudflare (gestión de bots) que se añade a algunas respuestas en `pages.dev`. El cliente de la prueba de humo guardaba **solo la última cookie recibida** (`this.cookie = sc.split(";")[0]`), así que la cookie de Cloudflare **pisó la de sesión** (`fel_sid`) tras el `GET /api/estado` y las peticiones siguientes llegaron sin sesión. El administrador no lo sufría porque su última petición era un GET. Un navegador real guarda todas las cookies: **los usuarios no se ven afectados**. En local no ocurre porque no hay Cloudflare.
**Corrección (local):** `nube/jarra_cookies.ts` (jarra con todas las cookies; `Max-Age=0` o valor vacío borra; devuelve solo NOMBRES), usada por la prueba de humo; la comprobación de atributos de cookie ahora mira específicamente `fel_sid`. Prueba nueva `tests/jarra_cookies_test.ts` (la cookie ajena no pisa la de sesión; salir borra solo la de sesión). Verificado: suite de la demostración 22 OK; `NUBE LOCAL E2E OK`; verificador de publicación OK. No cambia ninguna lógica de la aplicación ni de seguridad.

## 24. Rediseño móvil de la factura: CI en verde y publicación PREPARADA (no ejecutada)
CI sobre `5a6e756`: **fel-tests #145 ✓** (incluye `e2e_movil` a 320/360/390/430 px, `e2e`, `e2e_acceso`, `e2e_practico`, API real e aislamiento por empresa, migraciones y RLS, integración con Supabase local, agente en Windows), **fel-navegadores #26 ✓** (Firefox y WebKit), **fel-paquete #36 ✓**.
**Cómo publicarlo cuando lo autorices:** `publicar-nube.yml` · `modo=publicar` · `confirmar=PUBLICAR` · `digifact=apagado` (aprobación en `demo-privada`). Solo cambian la página de Pages y la función (el PDF por formato): 28 migraciones sin cambios (`db push` no aplica nada), aprovisionamiento idempotente (conserva datos y usuarios), sin Digifact ni emisión real. Después, `modo=probar` verifica el recorrido contra la URL real; la prueba de humo automática NO ve la interfaz nueva, así que la comprobación visual en Android y PC la haces tú con la guía `GUIA-DEMO-NUBE.md`.
