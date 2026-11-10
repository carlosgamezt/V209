# Auditoría de la cadena de autenticación: navegador → Supabase Auth → Edge Function → PostgreSQL

> Fase 1.3. Cada hallazgo indica **cómo se verificó**: `local-real` = pila Supabase local efímera (GoTrue + PostgREST + PostgreSQL con las migraciones, `fel-api` corriendo con Deno; job de CI «Integración con Supabase local real»); `unit` = pruebas con clientes falsos; `SQL` = pruebas psql. Lo que **solo** existe en un proyecto alojado figura en `matriz-integracion-supabase-real.md` y **no se ha ejecutado**.

## 1. Los cuatro saltos
| # | Salto | Qué viaja | Quién verifica | Dónde se prueba |
|---|---|---|---|---|
| 1 | Navegador → Auth | Contraseña, código TOTP; el enlace del correo vuelve con el token en el `#fragmento` | GoTrue (contraseña, TOTP, límites de intentos) | `auth.cjs`, `cuentas.cjs` (Supabase falso); `A01/A02/M01/R01` local-real |
| 2 | Navegador → PostgREST | JWT en `Authorization` | PostgREST **solo** firma y vencimiento; **no consulta la sesión** | `D01`, `P01`, `X01k`, `L01a` local-real |
| 3 | Navegador → `fel-api` | JWT en `Authorization` | Pasarela (`verify_jwt`) **[REAL]**; `auth.getUser` (firma + sesión viva); coherencia `sub`/`role`/`exp`; revocación; aal2 reciente | `seguridad_test.ts` (matriz), `J01/I01/X01` local-real |
| 4 | `fel-api` → PostgreSQL | `service_role`; el actor ya validado va como parámetro | Cada función SQL revalida cuenta, empresa y permisos | `08_privilegios.sql`, `07`, `11–13` |

## 2. Reglas que se aplican en cada salto
- **Toda petición a `fel-api`** pasa, en este orden: límite por origen → `auth.getUser` → `sub`/`role`/`exp` coherentes → **marca de revocación** → estado de la cuenta (activa / sin perfil / bloqueada) → validación de campos → límite por usuario → permisos de la empresa pedida → **aal2 (y aal2 reciente en acciones sensibles)** → límite por empresa → ejecución.
- **Toda lectura directa** (PostgREST) pasa por RLS: `fel_tiene_permiso` / `fel_es_miembro` / `fel_es_admin_plataforma` exigen cuenta con perfil activo, membresía activa, empresa habilitada, **sesión no revocada** y, para el maestro, `aal = aal2`.

## 3. Hallazgos de esta fase
| Id | Hallazgo | Gravedad | Resolución | Verificación |
|---|---|---|---|---|
| H1 | **`config.toml` desactivaba el proveedor de correo** (`[auth.email] enable_signup = false` es el interruptor del proveedor, no del registro): el login por contraseña devolvía 422 en una pila real | Alta (bloqueaba el acceso; habría pasado inadvertido sin integración real) | `enabled = true`; el registro abierto sigue impedido por `[auth] enable_signup = false` | local-real `A01` |
| H2 | **PostgREST no consulta la sesión**: tras cerrar sesión o borrar las sesiones en Auth, el token de acceso viejo sigue leyendo datos por RLS hasta que vence (observado: Auth `/user` 403, `fel-api` 401, PostgREST **200 con filas**) | Alta | Marca de revocación aplicada **también en la RLS** (`fel__sesion_vigente`); para el cierre de sesión normal sigue siendo una limitación: ver riesgos | local-real `L01a`, `X01k` |
| H3 | **Un token renovado desde una sesión robada hereda el nivel**: renovar conserva `aal` y los eventos `amr` (verificado) | Alta | La revocación se decide por los **eventos de autenticación** (`amr[].timestamp`) del token, no por su fecha de emisión: renovar no crea eventos nuevos | local-real `M01c`, `X01m–n`; `unit`; `SQL 13` |
| H4 | **Colisión en el mismo segundo**: con `>=`, una sesión aal2 anterior a la revocación, ocurrida en el mismo segundo, seguía valiendo (los `timestamp` son segundos enteros) | Media (ventana de 1 s) | Comparación **estricta**; un inicio de sesión legítimo ocurre después del segundo de la marca | local-real `X01k` (falló antes de corregir); `SQL 13`; `unit` |
| H5 | **aal2 antiguo**: un token aal2 válido por horas permitía acciones sensibles aunque el código TOTP se hubiera dado mucho antes | Media | `aal2Reciente`: el último evento `totp` debe tener ≤ 15 min (y no estar en el futuro) en: invitar, cambiar rol/permisos, autorizar/revocar maestros, aprobar/rechazar recuperaciones. Paso intermedio en la interfaz: confirma el código y reintenta una vez | `unit` (matriz); `cuentas.cjs` §9 |
| H6 | `fel-api` aceptaba un token caducado si Auth lo daba por bueno | Baja (defensa en profundidad) | Se exige `exp` presente y futuro | `unit` |

## 4. Supuestos del diseño confirmados en la pila local real
- Los JWT de usuario traen `sub`, `role=authenticated`, `aal`, `exp` y `amr=[{method, timestamp}]`; el login con TOTP añade un evento `totp` reciente.
- **Renovar un token conserva `aal` y `amr` sin cambios** (base de la revocación por eventos).
- `fel_bootstrap_primer_maestro` funciona con las tablas reales de Auth; con solo contraseña, el maestro no ve nada por RLS (aal1) y con aal2 sí.
- Una cuenta de Auth sin invitación vigente no entra; tras aceptar la invitación, sí; el aislamiento entre empresas se cumple en lecturas (RLS) y escrituras (API), también para una persona con dos empresas.

## 5. Riesgos residuales
1. **Cierre de sesión normal no corta las lecturas directas**: el token de acceso sigue sirviendo a PostgREST hasta `jwt_expiry` (hoy 3600 s). Mitigación: `jwt_expiry` de 900–1800 s. (Una recuperación de MFA, un bloqueo de cuenta o una revocación sí cortan al instante.)
2. La revocación por marca **solo se activa en la recuperación de MFA**. Un robo de sesión sin recuperación no se detecta hasta que alguien bloquee la cuenta o apruebe una recuperación (el bloqueo de la cuenta sí corta al instante API y RLS).
3. Las pruebas de integración usan la **pila local**: no cubren el gateway de Edge Functions alojado (`verify_jwt`), claves JWKS, SMTP real ni límites de Auth del proyecto real.
4. `fel__borrar_sesiones_auth` borra filas de `auth.sessions` (esquema interno de Supabase); es de **mejor esfuerzo**: si un cambio de Supabase lo impidiera, la marca de revocación sigue protegiendo a la API y a la RLS.
