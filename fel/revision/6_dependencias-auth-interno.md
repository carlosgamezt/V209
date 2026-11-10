# Dependencia del esquema interno de Auth (`auth.users`, `auth.mfa_factors`, `auth.sessions`)

FEL toca tablas del esquema `auth`, que **no es una API pública de Supabase**. Este documento lista exactamente qué se usa, con qué privilegios, cómo se detecta una incompatibilidad y qué pasa si algo falla a medias.

## 1. Qué se usa
| Tabla | Columnas | Operación | Funciones de FEL |
|---|---|---|---|
| `auth.users` | `id`, `email`, `email_confirmed_at` | **Lectura** | `fel_auditar` (correo del actor), `fel_op_invitacion_aceptar` (identidad y correo confirmado), `fel_op_miembros_listar`, `fel_op_mfa_recuperacion_*` (correo), `fel__validar_candidato_maestro`, `fel_registrar_recuperacion_manual` |
| `auth.mfa_factors` | `id`, `user_id`, `factor_type`, `status` | **Lectura** (comparando como texto con `'totp'` y `'verified'`) | `fel__validar_candidato_maestro`, `fel_op_mfa_recuperacion_solicitar/aprobar/cerrar` |
| `auth.sessions` | `id`, `user_id` | **Borrado** (`delete … where user_id = …`) | `fel__borrar_sesiones_auth`, solo desde `fel_op_mfa_recuperacion_aprobar` |
Los factores se **eliminan con la API de administración de Auth** (`auth.admin.mfa.deleteFactor`), no con SQL.
Todas son `SECURITY DEFINER`: los privilegios que cuentan son los del **propietario de las funciones** (`postgres`), no los de quien llama.

## 2. Comprobación de compatibilidad (`fel_verificar_dependencias_auth()`)
Solo lectura (el borrado se prueba con `delete … where false`). Verifica columnas, privilegios efectivos de lectura y borrado, que `factor_type`/`status` se comparen como texto y que, si `factor_status` es un enumerado, incluya `verified`. **Se ejecuta:** justo después de aplicar las migraciones, antes de cada tanda de pruebas (etapa `verificar` del script) y en CI (`14_dependencias_auth.sql`, 14+ comprobaciones). Si falla una fila, **no se continúa** con ninguna etapa posterior.

## 3. Qué pasa cuando algo falla (todo probado en `14_dependencias_auth.sql` y `13_revocacion_sesiones.sql`)
| Falla | Efecto | Por qué es seguro |
|---|---|---|
| Falta una columna o no se puede **leer** `mfa_factors` al aprobar | La aprobación **falla entera** (error 500): la solicitud sigue `pendiente`, sin marca de revocación, sin sesiones borradas | Es una transacción: no queda nada a medias |
| No se pueden **borrar** sesiones (`auth.sessions`: privilegios, esquema, bloqueo) | La aprobación **sigue**; `sesiones_auth_borradas = -1` queda en la auditoría y la API devuelve una **advertencia** visible | La marca de revocación (propia) ya protege a la API y a la RLS; se recomienda cerrar las sesiones desde el panel |
| Falla el borrado de un **factor** (API de administración) | La solicitud queda `aprobada` (502 `recuperacion_parcial`); reintentar solo recibe los factores que **faltan**; no se duplica nada | Las sesiones viejas ya no valen desde la aprobación |
| Un factor ya fue borrado por otra ejecución (404) | No es error; no se cuenta dos veces | Aprobación simultánea o reintento |
| Cambia el tipo/valores de `status` o `factor_type` | `fel_verificar_dependencias_auth()` lo marca; si se ignora, la validación de maestros y las solicitudes fallan **cerradas** (no se concede nada) | Falla hacia la negación |

## 4. Compatibilidad y permisos en un proyecto alojado **[pendiente de verificar]**
- En la pila local, `postgres` puede leer `auth.users`/`auth.mfa_factors` y borrar de `auth.sessions` (verificado en CI). En un proyecto alojado los permisos pueden diferir: la etapa `verificar` lo informa **antes** de cualquier otra etapa.
- El esquema `auth` cambia con las versiones de GoTrue. Re-ejecutar la comprobación tras cada actualización de Supabase.
- Si el borrado de `auth.sessions` no estuviera permitido en el proyecto alojado, FEL sigue funcionando (la marca de revocación es la garantía principal); documentar y cerrar sesiones desde el panel.
