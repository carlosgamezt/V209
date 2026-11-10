# Integración con Supabase local real

Ejecuta `ejecutar.mjs` contra una pila Supabase **local y efímera** (GoTrue, PostgREST y PostgreSQL con las migraciones) y la función `fel-api` corriendo con Deno. Es el job de CI «Integración con Supabase local real». No usa proyectos ni credenciales reales.

```bash
supabase --workdir fel start
supabase --workdir fel status -o env | grep -E '^[A-Z_]+=' > /tmp/sb.env && set -a && . /tmp/sb.env && set +a
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$SECRET_KEY}" FEL_APP_URL=http://127.0.0.1:3000/fel/ \
  deno run -A fel/supabase/functions/fel-api/index.ts &
node fel/tools/integracion-local/ejecutar.mjs      # necesita psql en el PATH
supabase --workdir fel stop --no-backup
```
Resultados: tabla en consola y `integracion-local-resultados.json` (variable `RESULTADOS`). **OK** y **FALLO** son afirmaciones; **OBSERVADO** registra un comportamiento de Supabase para el informe.
Contra un proyecto de desarrollo real: ver `docs/matriz-integracion-supabase-real.md` (requiere autorización expresa).
