# Auditoría: de dónde salen los claims (`sub`, `role`, `aal`) que usan RLS y la API

> Estado: revisión de la Fase 1.2. Lo marcado **[REAL]** solo se puede validar con un Supabase real (la CI usa Supabase local y una base simulada).

## Cadena de confianza
| Capa | Qué lee | De dónde sale | Quién lo verifica |
|---|---|---|---|
| **RLS / funciones SQL** | `auth.uid()` (claim `sub`) y `aal` (solo en `fel_es_admin_plataforma`) | Parámetro de transacción `request.jwt.claims` | PostgREST verifica la **firma** del JWT antes de fijarlo (comportamiento documentado de Supabase) **[REAL]** |
| **Edge Function `fel-api`** | usuario, correo, `aal` | JWT del encabezado `Authorization` | 1) la pasarela con `verify_jwt = true` verifica la firma **[REAL]**; 2) `auth.getUser(token)` valida firma **y que la sesión siga viva** (revocada = rechazada); 3) `lib/deps.ts` exige que el claim `sub` del token sea el usuario que Auth devolvió y que `role` sea `authenticated`; 4) solo se acepta `aal1`/`aal2` exactos |
| **Interfaz** | `aal` (solo para mostrar avisos) | Decodificación del JWT en el navegador, **sin verificar** | Nadie: es una pista. El servidor decide siempre |

## Hallazgos y correcciones
1. **La API leía `aal` del JWT sin comprobar su coherencia con el usuario validado.** Auth validaba el token, pero el código no exigía que el `sub` leído coincidiera ni que fuera un token de usuario (no la clave `anon`). **Corregido** en `lib/deps.ts` (`getUser` devuelve `null` si `sub` ≠ usuario o `role` ≠ `authenticated`). Pruebas: `seguridad_test.ts` (tokens con `sub` ajeno, `role: anon`, sin `role`, no-JWT, firma rechazada por Auth).
2. **`aal` se comparaba con `=== "aal2"`, pero se aceptaba cualquier valor en otras ramas.** Ahora solo `aal1`/`aal2` exactos; `AAL2`, ` aal2`, números, listas o `null` no cuentan. Pruebas en API y en SQL (`10_claims.sql`).
3. **Inventario de lecturas de claims en la base.** Solo `fel_es_admin_plataforma` lee el claim `aal`; ninguna política RLS lee claims por su cuenta. Una prueba (`10_claims.sql`) falla si aparece otra función o política que lea `request.jwt`.
4. **Datos controlados por el usuario no influyen:** `perfiles.nombre`, `user_metadata` y `app_metadata` con un `aal` falso no otorgan nada (prueba).
5. **El claim `aal` es una fotografía.** *(Resuelto en la Fase 1.3 con la marca de revocación y `aal2Reciente`; ver `auditoria-cadena-autenticacion.md`. Se conserva el texto original:)* Un JWT aal2 ya emitido sigue diciendo aal2 hasta que vence (`jwt_expiry`, hoy 3600 s) aunque después se elimine el factor TOTP (por ejemplo, en una recuperación de acceso). `getUser` comprueba que la **sesión** exista, no que el nivel siga vigente. **Riesgo residual** → recomendado: `jwt_expiry` más corto (900–1800 s) y cerrar las sesiones de la persona al aprobar una recuperación **[REAL]**.
6. Las funciones SQL de la API (`fel_op_*`, `fel_admin_*`) no leen claims: reciben el actor ya validado por la API y vuelven a comprobar cuenta, empresa y permisos. Ninguna se puede ejecutar con `anon`/`authenticated` (`08_privilegios.sql`, catálogo completo).

## Qué NO se pudo validar aquí **[REAL]**
- Que PostgREST fije `request.jwt.claims` solo tras verificar la firma, y que rechace tokens con `alg: none` o firma ajena.
- Que `verify_jwt = true` esté efectivo en la función desplegada y que `auth.getUser` rechace tokens de sesiones cerradas.
- La rotación de claves de firma (JWKS) y el efecto de `jwt_expiry` sobre el riesgo del punto 5.
