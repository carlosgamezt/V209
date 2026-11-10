# Integración con Supabase local real

Ejecuta `ejecutar.mjs` contra una pila Supabase **local y efímera** (GoTrue, PostgREST y PostgreSQL con las migraciones) y la función `fel-api` corriendo con Deno. Es el job de CI «Integración con Supabase local real». No usa proyectos ni credenciales reales.

```bash
supabase --workdir fel start
supabase --workdir fel status -o env | grep -E '^[A-Z_]+=' > /tmp/sb.env && set -a && . /tmp/sb.env && set +a
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$SECRET_KEY}" FEL_APP_URL=http://127.0.0.1:3000/fel/ \
  deno run -A fel/supabase/functions/fel-api/index.ts &
node fel/tools/integracion-local/ejecutar.mjs --etapa=verificar                              # solo lectura
node fel/tools/integracion-local/ejecutar.mjs --etapa=ejecutar --manifiesto="$RUNNER_TEMP/m.json"  # necesita psql
node fel/tools/integracion-local/ejecutar.mjs --etapa=limpiar  --manifiesto="$RUNNER_TEMP/m.json"  # solo lo del manifiesto
supabase --workdir fel stop --no-backup
```
Resultados: tabla en consola y `integracion-local-resultados.json` (variable `RESULTADOS`). **OK** y **FALLO** son afirmaciones; **OBSERVADO** registra un comportamiento de Supabase para el informe.
Contra un proyecto de desarrollo real: ver `docs/matriz-integracion-supabase-real.md` (requiere autorización expresa).

## Etapas, manifiesto y guardia
- **`verificar`**: solo lectura (Auth, `fel_verificar_dependencias_auth()`, RLS, privilegios, emisión apagada).
- **`ejecutar`**: crea datos con identificadores aleatorios por ejecución y **anota cada UUID en el manifiesto** en cuanto lo crea.
- **`limpiar`**: borra exclusivamente lo del manifiesto; nunca por correo, NIT ni patrón. Las empresas se suspenden (la auditoría es de solo-anexar). Se niega si el manifiesto es de otro destino.
- **`guardia.mjs`** (función pura, `node --test guardia.test.mjs`, 96 casos): decide si el script puede correr. Local ⇒ permitido; proyecto alojado ⇒ solo con `FEL_AUTORIZACION_PRUEBAS_REALES=si`, `FEL_ETAPA_AUTORIZADA=<etapa>`, `FEL_PROYECTOS_DEV_PERMITIDOS`, `FEL_CONFIRMAR_REF` y URL/BD/función/claves del mismo proyecto. Ante duda, se niega.
Guía completa: `docs/guia-proyecto-supabase-desarrollo.md`.
