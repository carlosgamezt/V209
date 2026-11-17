# NEXA FEL · Preparación de la demostración en la nube (estado a 16/11/2026; NADA ejecutado)

## 1. Lo que NO puedo verificar desde aquí (y por eso no publico ninguna URL como funcional)
Mi entorno no llega a Supabase ni a Cloudflare, y no puedo listar los secretos de GitHub. Por tanto **no sé** si existen `DEMO_PAGES_PROYECTO`, `DEMO_CLOUDFLARE_*`, `DEMO_SUPABASE_*` ni `DEMO_CLAVES`, y **no hay URL de demostración verificada**. La URL prevista es `https://<DEMO_PAGES_PROYECTO>.pages.dev` (la fija `tools/publicar-nube.sh`).

## 2. Estado de Supabase (`nexa-demo`, verificado por las ejecuciones de solo lectura #3, #5 y #7)
Vacía: 0 migraciones y 0 filas; la verificación inicial dio 0 REVISAR (la función `rls_auto_enable` de la plataforma está reconocida por huella). Etapa 1 (migraciones 1–27) y etapa 2 (28) **sin aplicar**. `verificar-api-vault` (#8) **sigue esperando tu aprobación** en `demo-privada`.

## 3. Pipeline (qué lo activa)
- `publicar-nube.yml`: solo manual (`workflow_dispatch`), rama `fel-proveedores-diseno`, entorno `demo-privada` con aprobación; modo `verificar` (no toca nada) o `publicar` (exige escribir `PUBLICAR`).
- `migraciones-nube.yml`: solo manual; `verificar-inicial`, `diagnostico-inicial`, `verificar-api-vault`, `verificar-etapa`, `migraciones-etapa` (exige `APLICAR-MIGRACIONES`).
- **Riesgo importante:** `publicar` ejecuta `supabase db push` con **todas** las migraciones de una vez, lo que anularía el plan por etapas con verificación intermedia. **Orden correcto:** primero `migraciones-etapa 1` → V1 → `migraciones-etapa 2` → V2 (cada una con tu autorización) y solo después `publicar` (el `db push` ya no tendría nada que aplicar).

## 4. Secretos que necesita `publicar` (11, todos con prefijo `DEMO_` en GitHub)
`DEMO_SUPABASE_PROYECTO_REF`, `DEMO_SUPABASE_ACCESS_TOKEN`, `DEMO_SUPABASE_DB_PASSWORD`, `DEMO_BD_URL`, `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY`, `DEMO_CLAVES`, `DEMO_MFA_SEMILLAS`, `DEMO_PROXY_SECRETO`, `DEMO_CLOUDFLARE_API_TOKEN`, `DEMO_CLOUDFLARE_ACCOUNT_ID`, `DEMO_PAGES_PROYECTO` (12 con el nombre de la página). Para el verificador de la API de `vault`: `DEMO_SUPABASE_ANON_KEY` (clave pública, nunca `service_role`). **Ninguno se pega en el chat ni en el repositorio.**

## 5. Digifact TEST en la nube: estado del código (17/11/2026) y qué falta
**Hecho y probado (local, PostgreSQL real; nada aplicado en la nube):**
1. **Migración 29 (propuesta, `docs/migracion-29/`)**: operaciones de Digifact (una sola que bloquea por documento, autorización única por empresa, identidad inmutable), **artefactos reales XML/PDF** (solo inserción, sin privilegios para nadie salvo el propietario) y la función `fel_sys_digifact_aplicar` que **aplica la certificación al documento** (estado fiscal, serie, número y autorización del certificador; atómica, idempotente, misma ruta de estados que las demás certificaciones; rechaza autorizaciones `SIM-`).
2. **Servicio**: tras certificar, aplica al documento y guarda XML/PDF **validados contra la autorización**; si algo falla queda «pendiente» y se repara sin reenviar; un resultado no registrable (p. ej. autorización repetida) queda «desconocida» y bloquea otro envío; `descargar` sirve solo a su empresa y pide a Digifact (solo lectura) lo que no se guardó.
3. **API/UI**: `GET /api/documentos/:id/digifact/(xml|pdf)` (sesión + permiso + empresa; `attachment`, `nosniff`, sin caché, CSP sandbox); botones de descarga; etiqueta **TEST** (nunca «simulado» ni «real»).
4. **Transmisión de `FEL_DIGIFACT_*`**: interruptor `digifact` (apagado por defecto) y `digifact_referencia` por ejecución en `publicar-nube.yml`; los secretos solo se cargan si lo eliges; el script los aparta y solo los recibe el paso de la función; todo o nada; sin imprimir valores; Cloudflare y el navegador nunca los ven. Secretos NUEVOS que habría que crear en `demo-privada` (no se crearon): `DEMO_DIGIFACT_TEST_EMPRESA`, `DEMO_DIGIFACT_TEST_EMISOR`, `DEMO_DIGIFACT_TEST_HUELLA` (los de usuario, contraseña y NIT ya existen para `digifact-test.yml`).
**Sigue pendiente (requiere tu autorización):** aplicar migraciones 1–28 (etapas 1 y 2) y la 29 (etapa 3: hay que actualizar `supabase-hospedado.sh` y los contadores, ver `REVISION-CONSOLIDADA-Y-PROCEDIMIENTO-DEMO.md` §2), crear esos 3 secretos, y desplegar. **No verificado con el Digifact real:** el formato exacto del XML/PDF reales (la validación solo exige que el XML sea UTF-8, sin DOCTYPE y contenga la autorización, y que el PDF sea completo); la primera prueba real puede obligar a ajustarla.

## 6. Operaciones concretas que requieren tu autorización (en orden)
1. Aprobar `verificar-api-vault` (#8) en `demo-privada` (y crear `DEMO_SUPABASE_ANON_KEY` si falta).
2. Subir los commits locales a `fel-proveedores-diseno` (`05ed9ae`, `05ed7c3` y el de hoy).
3. `migraciones-etapa 1` → revisar V1 → `migraciones-etapa 2` → revisar V2.
4. Decidir la migración 29 (etapa 3) y el cambio de `publicar-nube.sh` para los secretos de Digifact.
5. `publicar` modo `verificar` y luego `publicar` (`PUBLICAR`); solo entonces habrá una URL que verificar con la prueba de humo (`nube/prueba_humo.ts`).
