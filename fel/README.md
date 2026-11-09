# NEXA FEL

Módulo de facturación electrónica de Guatemala. **Independiente** de NEXA, del POS y de inventarios.
Proyecto Supabase propio (multiempresa). Estado: **Fase 1.0 en desarrollo, rama `fel-fase-1-0`. Nada de esto está publicado.**

## Contenido
- `supabase/migrations/` — esquema, protecciones, RLS y datos iniciales. **No se ejecutan solas**: se aplican con `supabase db push` al proyecto FEL cuando se autorice.
- `supabase/functions/fel-api/` — Edge Function (Deno/TypeScript). Única vía de escritura de la app.
- `supabase/tests/` — pruebas SQL (estructura, aislamiento RLS, escritura atómica).
- `tools/test-local.sh` — corre migraciones y pruebas SQL en un PostgreSQL temporal, sin Docker ni proyectos reales.
- `docs/matriz-estados.md` — matriz de transiciones (propuesta).
- La interfaz irá en `nexa/fel/` (aún no creada, para que ningún "publica" de NEXA la saque por accidente).

## Principios
1. La app solo **lee** (rol `authenticated`, con RLS). Toda escritura pasa por `fel-api` con `service_role`.
2. Aun con `service_role`, **cada operación valida el permiso** en la API y otra vez dentro de la función SQL.
3. Las operaciones administrativas y de negocio escriben el dato y la auditoría **en la misma transacción**.
4. El administrador maestro administra empresas y regímenes; **no ve datos de negocio** de las empresas (clientes, conceptos, documentos).
5. Las reglas fiscales no tienen valores por defecto. Nacen `sin_verificar`, se versionan y una versión verificada es inmutable.
6. `serie`, `numero_fiscal` y `autorizacion_sat` permanecen vacíos salvo confirmación verificable de un certificador autorizado.
7. No se guardan credenciales de la Agencia Virtual ni de la firma FEL. No hay automatización del portal del SAT.

## Autenticación (opción A)
Supabase Auth del proyecto FEL, sin registro abierto. Invitaciones con `inviteUserByEmail` (nativo) y MFA TOTP (nativo).
La API exige `aal2` para operaciones de administrador maestro y de gestión de usuarios.

## Pruebas
```bash
bash fel/tools/test-local.sh                       # SQL (migraciones + RLS) en PostgreSQL temporal
cd fel/supabase/functions/fel-api && deno task test && deno task check
```
En GitHub Actions: workflow manual `NEXA FEL · pruebas` (Supabase local efímero, sin conexión a producción).
