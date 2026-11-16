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

## 5. Digifact TEST en la nube: qué falta (más allá de desplegar)
1. **Migración 29** (almacén persistente de operaciones): **propuesta** en `docs/migracion-29/` (no está en `supabase/migrations`, así que el conjunto aprobado 1–28 no cambia). Probada contra PostgreSQL real: exclusión mutua, 25 envíos simultáneos → exactamente uno, un timeout deja la operación «desconocida» que **bloquea un segundo envío**, resultado certificado inmutable, aislamiento por empresa, sin privilegios para `anon`/`authenticated`/`service_role`. Como es la 29, requeriría una **etapa 3** (autorización propia) y actualizar `verificar-etapa`.
2. **Secretos del servidor de la demostración para Digifact:** `FEL_DIGIFACT_TEST=habilitado`, `FEL_DIGIFACT_TEST_EMPRESA`, `DIGIFACT_TEST_USERNAME/PASSWORD/NIT`, `FEL_DIGIFACT_TEST_EMISOR`, `FEL_DIGIFACT_TEST_HUELLA` y, por cada prueba, `FEL_DIGIFACT_AUTORIZA_REFERENCIA` (autorización expresa de UNA referencia). `publicar-nube.sh` **hoy no los transmite a la función**: habría que añadirlos (cambio pequeño de código, sin ejecutar).
3. **Pendiente de código (no hecho):** que el resultado real de Digifact actualice el estado del documento en NEXA (hoy el panel muestra la operación, pero el documento sigue «simulado») y guardar/descargar el **XML y PDF reales** certificados. Sin esto, «serie, número y UUID certificados» se ven en el panel de la operación, pero **no** hay PDF/XML reales descargables.

## 6. Operaciones concretas que requieren tu autorización (en orden)
1. Aprobar `verificar-api-vault` (#8) en `demo-privada` (y crear `DEMO_SUPABASE_ANON_KEY` si falta).
2. Subir los commits locales a `fel-proveedores-diseno` (`05ed9ae`, `05ed7c3` y el de hoy).
3. `migraciones-etapa 1` → revisar V1 → `migraciones-etapa 2` → revisar V2.
4. Decidir la migración 29 (etapa 3) y el cambio de `publicar-nube.sh` para los secretos de Digifact.
5. `publicar` modo `verificar` y luego `publicar` (`PUBLICAR`); solo entonces habrá una URL que verificar con la prueba de humo (`nube/prueba_humo.ts`).
