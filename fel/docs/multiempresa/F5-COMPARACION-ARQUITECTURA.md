# F5 · Comparación de arquitecturas de identidad (Supabase Auth) — NO implementada

**Objetivo.** Eliminar R1 (que la aplicación pueda fabricar sesiones) y cerrar R2 de raíz: una conexión comprometida **no debe poder inventar la identidad** con la que PostgreSQL decide. La regla de evaluación: *no basta validar el JWT en el backend si después `nexa_app` puede afirmar quién es el usuario.*

## 1. Hechos de la documentación oficial de Supabase (consultada hoy)
- **Llaves de firma:** el proyecto puede firmar con llaves asimétricas (ES256 preferida, RS256 alternativa; HS256 «no recomendada para producción»). Las claves públicas se publican en `/auth/v1/.well-known/jwks.json`; la privada la guarda Supabase Auth, no la aplicación. La rotación la resuelve `getClaims()`; quien verifica a mano debe asegurar que todas sus cachés tengan la clave nueva antes de rotar. [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) · [Blog](https://supabase.com/blog/jwt-signing-keys)
- **`getClaims()`:** con llaves asimétricas verifica la firma contra el JWKS (con caché local); con secreto simétrico hace una llamada al servidor, como `getUser()`. [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims)
- **Claims:** todo token trae `sub`, `role`, `aal`, `session_id`, `exp`, y opcionalmente `amr`. `aal2` = contraseña + al menos un factor MFA. [JWT Claims](https://supabase.com/docs/guides/auth/jwt-fields)
- **Revocación:** cerrar sesión revoca los *refresh tokens*, pero **el access token de una sesión revocada sigue siendo válido hasta su `exp`**; los claims no se actualizan hasta renovar el token. [Sign out](https://supabase.com/docs/guides/auth/signout) · [MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- **MFA y RLS:** el patrón oficial es una política restrictiva que exige `auth.jwt()->>'aal' = 'aal2'`. [MFA vía RLS](https://supabase.com/blog/mfa-auth-via-rls)
- **Data API (PostgREST):** valida el JWT, cambia al rol `authenticated` y expone los claims a la base (`auth.uid()`, `auth.jwt()`). Una función `SECURITY DEFINER` en un esquema expuesto es invocable por la API con los privilegios de su creador: Supabase aconseja no crearlas en esquemas expuestos; los ayudantes de RLS van en un esquema privado con `search_path` fijo. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)
- **Funciones Edge:** la plataforma puede verificar el JWT antes de ejecutar (`verify_jwt`); el JWT del usuario va en `Authorization` y la llave del proyecto en `apikey`. [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- **`pgjwt`** está **deprecada** en Postgres 17; solo ofrece HMAC (HS256). No hay una extensión vigente documentada para verificar ES256/RS256 dentro de la base. [pgjwt](https://supabase.com/docs/guides/database/extensions/pgjwt)
- **Plan Free:** MFA TOTP gratuita en todos los planes; los tiempos máximos de sesión (*timebox*, inactividad) **no** están en Free; los *Auth Hooks* de «Custom Access Token» están en Free y Pro (las fuentes difieren en el detalle: confirmar). El pooler Free admite 200 conexiones; 2 proyectos activos. [Precios](https://supabase.com/pricing) · [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks) · [Conexiones](https://supabase.com/docs/guides/database/connecting-to-postgres)
- **No confirmado por mis búsquedas** (hay que verificarlo en `nexa-fel-test`): disponibilidad de las llaves de firma asimétricas en el plan Free y el mínimo configurable de vida del access token.

## 2. Las tres alternativas

### A · Verificar el JWT criptográficamente DENTRO de PostgreSQL (con el pooler)
`p_sesion` pasa a ser el JWT; `fel__sesion_empresa` verifica la firma.
- ✔ Cierra R1 y R2 de verdad: `nexa_app` no puede fabricar un JWT sin la llave privada, que no tiene.
- ✔ Reutiliza todo F1–F3 sin cambios (solo se reimplementa una función).
- ✘ **Verificar ES256/RS256 en SQL no es viable con lo oficial**: `pgjwt` es solo HS256 y está deprecada. Quedan (i) HS256 con el secreto «legacy» guardado en la base —contrario a la dirección de Supabase, exige exponer el secreto a la base y rotarlo a mano— o (ii) escribir ECDSA P-256 en PL/pgSQL: criptografía propia, lenta y de alto riesgo.
- ✘ El JWT viaja en cada llamada y su verificación se repite en cada consulta.
- **Veredicto: descartada como solución final** (solo sería un puente con HS256).

### B · Validar el JWT en el backend (`getClaims`) y mantener el pooler
La función Edge verifica el JWT y luego le dice a la base quién es.
- ✔ Quita contraseñas y sesiones propias; MFA, recuperación y revocación pasan a Supabase Auth.
- ✘ **No cierra R1/R2**: la base tiene que *creer* lo que le diga `nexa_app`. Quien controle la función o la credencial puede afirmar cualquier identidad. Es exactamente el caso que la regla de evaluación excluye.
- **Veredicto: insuficiente por sí sola.** Sirve como etapa intermedia, no como destino.

### C · Supabase Auth + Data API (RPC/RLS nativos) para las operaciones de personas, y conexiones separadas de mínimo privilegio para procesos internos
La función Edge reenvía el **JWT del usuario** a la Data API; PostgREST lo valida con sus propias llaves y la base ve `auth.uid()`. Los procesos sin persona usan `nexa_sys` (F4) por el pooler.
- ✔ **Cierra R1 y R2 de verdad**: la identidad la afirma Supabase Auth (llave privada fuera de nuestro alcance); la función Edge solo retransmite tokens que recibe, no puede acuñarlos. Si se compromete, solo actúa con los JWT en vuelo.
- ✔ **Revocación y MFA decididos por la base**: cada función `api.*` comprueba que `session_id` siga existiendo en `auth.sessions` (cierre de sesión o baja = efecto inmediato, sin esperar el `exp`) y que `aal = aal2` para operaciones sensibles. Empresa, membresía y permisos efectivos salen de las tablas, no del token.
- ✔ Reutiliza F1–F3: `fel_ses_*` / `fel_pla_*` se convierten en funciones `api.*` que sustituyen `p_sesion` por `auth.uid()`; `fel__sesion_empresa` es el único punto que cambia.
- ✔ **Reutilizable** por NEXA POS, inventarios y Hotel: cada módulo publica sus funciones `api.<módulo>_*` con la misma identidad; las apps móviles y terminales inician sesión con `supabase-js` sin sesiones propias; la sincronización y los agentes usan `nexa_sys`.
- ✘ Obliga a mover todo acceso a datos de personas a RPC o RLS: hoy hay unas **135 consultas SQL directas, 68 llamadas `rpc` y 23 `ejecutar`** (16 archivos). Las lecturas actuales corren con `nexa_app` y políticas `using (true)` (el aislamiento entre empresas es de la aplicación, riesgo R3).
- ✘ Una vuelta HTTP más por llamada (Edge → PostgREST) frente al SQL por el pooler; hay que **medirla** y conservar las optimizaciones de #55 con *una RPC por pantalla* (devuelve JSON agregado).
- ✘ Esquema expuesto con funciones `SECURITY DEFINER`: exige esquema `api` dedicado, `search_path` vacío, `revoke` a `anon` y comprobación explícita de `auth.uid()` en cada función.
- ✘ Para que la función Edge de cara al usuario **no tenga credencial de base de datos**, los procesos internos deben estar en otra función (`nexa-sys`) y lo que hoy se hace dentro de la petición con `fel_sys_*` (máquina de estados de certificación) debe pasar a RPC acotadas por empresa y estado.

## 3. Comparación
| Criterio | A · verificar en PG | B · backend + pooler | **C · Auth + Data API (híbrido)** |
|---|---|---|---|
| Elimina la fabricación de identidad (R1/R2) | Sí, solo con HS256 | **No** | **Sí** |
| Depende de algo oficial vigente | No (`pgjwt` deprecada; sin ES256/RS256) | Sí | Sí |
| Revocación de sesión | Posible (consulta a `auth.sessions`) | La decide el backend | **Inmediata en la base** (`session_id`) |
| MFA en operaciones sensibles | Sí (`aal`) | Lo asegura el backend | **Sí, en la base** (`aal2` + `auth.sessions`) |
| Empresa y permisos desde la base | Sí | Sí | **Sí** |
| Esfuerzo sobre F1–F3 | Bajo | Bajo | Medio (los envoltorios pasan a `api.*`; se reescribe el acceso a datos) |
| Rendimiento | Verificación por llamada | Igual al actual | Una vuelta HTTP más; mitigable con una RPC por pantalla (medir) |
| Plan Free | Sí | Sí | Sí: MFA TOTP gratuita; *timebox* de sesión **no** (se sustituye por comprobación en la base); llaves asimétricas **por confirmar** |
| Reutilización POS/inventarios/Hotel | Media | Media | **Alta** (misma identidad y mismo patrón para apps y terminales) |

## 4. Recomendación: **C como destino, con un camino por etapas (modelo híbrido)**
1. **F5-0 · Verificación en `nexa-fel-test`** (sin código nuevo en producción): confirmar llaves asimétricas y *Custom Access Token* en el plan Free, el mínimo de vida del access token, la latencia p50/p95 de una RPC por Data API frente al SQL por el pooler (con y sin lote por pantalla) y que `auth.sessions` sea legible desde una función `SECURITY DEFINER`.
2. **F5-1 · Identidad**: Supabase Auth con contraseña + TOTP; `fel__sesion_empresa`/`fel__sesion_maestro` pasan a `auth.uid()` + `session_id` vivo + `aal2` para plataforma y operaciones sensibles. Las cuentas actuales se migran por invitación (sin copiar contraseñas).
3. **F5-2 · Escrituras por la Data API**: los `fel_ses_*` y `fel_pla_*` se publican como `api.*` y el servidor los llama con el JWT del usuario. Desde aquí `nexa_app` ya **no puede escribir como ninguna persona** (R1/R2 de escritura cerrados).
4. **F5-3 · Lecturas**: de consultas SQL a RPC de lectura o RLS con `auth.uid()` (cierra R3). Mientras no se haga, un `nexa_app` comprometido **puede leer** datos de empresas; **es un impedimento para clientes reales**, no para el piloto TEST con datos simulados.
5. **F5-4 · Separación `nexa-sys`** (F4, obligatoria antes de clientes reales): función Edge de cara al usuario sin credencial de base; función interna con `nexa_sys`.
6. **Retiro**: `demo_sesiones`, `demo_credenciales` y el inicio de sesión propio; `nexa_app` pierde la escritura en tablas de sesión.

**Modelo híbrido mínimo si la latencia de C resulta inaceptable:** personas por Data API **solo para operaciones sensibles** (escrituras, permisos, plataforma, certificación) y lecturas masivas por `nexa_app` hasta que RLS las cubra, con la limitación de R3 documentada; los procesos internos, siempre por `nexa_sys`.

## 5. Decisiones que necesito
1. ¿Se adopta **C** como arquitectura objetivo de F5?
2. ¿Se autoriza **F5-0** (medición y verificación en `nexa-fel-test`) cuando exista el proyecto?
3. ¿Se acepta que, **hasta F5-3**, las lecturas por `nexa_app` (R3) bloquean clientes reales aunque las escrituras ya estén protegidas?
