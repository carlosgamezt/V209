# Seguridad del token de renovación en `sessionStorage`

## Qué se guarda y qué no
| Dato | Dónde | Notas |
|---|---|---|
| Token de acceso (JWT, ~1 h) | **Solo memoria** | Nunca se escribe en el navegador |
| Token de renovación | `sessionStorage` (`fel.rt`) | Se borra al cerrar la pestaña; rota en cada renovación |
| Marcas de tiempo (`fel.t0`, `fel.ua`) | `sessionStorage` | **No secretas**: inicio de la autenticación y última actividad |
| Contraseña, código TOTP, clave TOTP | **Nunca** | La contraseña se borra del campo tras cada intento |
| `localStorage`, cookies | **Nada** | Una prueba falla si el código usa `localStorage` |

## Evaluación
- **Amenaza principal: XSS.** Un script malicioso en la página puede leer `sessionStorage`, pero también podría llamar a la API con el token en memoria: **guardarlo en memoria no evita el abuso durante la sesión**; la diferencia es la **persistencia** (un token robado sirve más tiempo). Por eso la defensa real es impedir el XSS.
- **Defensas presentes:** CSP restrictiva (`script-src 'self'`, sin inline, sin `eval`), todo texto de usuario con `textContent`, cero dependencias de terceros en la interfaz, prueba automática que prohíbe `innerHTML`, `eval`, `document.write` y JWT incrustados.
- **Por qué no `localStorage`:** persistiría tras cerrar el navegador. `sessionStorage` limita la ventana al tiempo de la pestaña.
- **Por qué no solo memoria:** obligaría a iniciar sesión (y dar el código TOTP) en cada recarga. Es una opción válida si se prefiere más rigor; el cambio es pequeño (`almacen` en `remoto.js`).
- **Alternativa más fuerte:** cookie `HttpOnly` mediante un servidor propio delante (BFF). No existe en esta arquitectura (Supabase directo); queda como mejora futura.

## Mitigaciones implementadas en esta fase
1. **Duración máxima** (por defecto 8 h desde la autenticación, no desde cada renovación) e **inactividad** (30 min). Se aplican al recargar y mientras se usa. Al vencer se revoca la sesión en el servidor y se borra todo.
2. **Recuperación al recargar condicionada:** sin marcas de tiempo válidas, o con el nivel aal1 en una cuenta con TOTP, no se recupera (`cuentas.cjs`, `auth.cjs`).
3. Una única renovación aunque haya varias peticiones a la vez (el token rota).
4. **Cierre de sesión** revoca en el servidor (`logout?scope=local`) y borra el almacenamiento.
5. Acceso revocado en el servidor (cuenta bloqueada o sin perfil): se cierra la sesión local y se borra todo.

## Pasos intermedios (Fase 1.3)
Las acciones sensibles exigen un código TOTP de **menos de 15 minutos**. Si el último es más antiguo, la API responde `mfa_reciente` y la interfaz abre «Confirma tu código»: verifica con la sesión actual, obtiene tokens con un evento `totp` nuevo y reintenta **una sola vez**. Un token robado con aal2 antiguo no sirve para esas acciones.

## Qué NO hace el cierre de sesión (hallazgo con Auth/PostgREST reales)
Cerrar sesión revoca la sesión en Auth (el token viejo recibe 403 en `/auth/v1/user` y 401 en `fel-api`), pero **PostgREST no consulta la sesión**: con ese mismo token las lecturas directas siguen funcionando hasta `jwt_expiry` (observado). Mitigación: `jwt_expiry` de 900–1800 s. Un **bloqueo de cuenta** o una **recuperación de MFA** sí cortan al instante (RLS y API).

## Límites que son del cliente (no confiar solo en ellos)
La duración máxima y la inactividad **del lado del navegador** las puede saltar quien robe el token. El límite real debe fijarse en Supabase **[REAL]**: refresh-token rotation activa y reutilización detectada (`refresh_token_reuse_interval` bajo), `jwt_expiry` de 900–1800 s, y —en planes que lo permiten— `sessions.timebox` e `inactivity_timeout`. Ninguno se pudo validar aquí.
