# Rotación manual de credenciales — procedimiento mínimo

**Verificado en local:** `bash tools/ensayo-rotacion.sh` (PostgreSQL con SCRAM): para `nexa_app` y `nexa_sys` la clave nueva entra, la anterior deja de entrar, una sesión abierta con la anterior termina su trabajo, los privilegios no cambian, y la deshabilitación de emergencia (`nologin` + sin clave) rechaza todo. `tests/secreto_sistema_test.ts`: rotación de `FEL_SYS_SECRETO` **sin interrupción** con `FEL_SYS_SECRETO_ANTERIOR` (≥24 caracteres).

| Credencial | Pasos | Interrupción |
|---|---|---|
| Clave de `nexa_sys` / `nexa_app` | 1) generar clave nueva ≥ 32 caracteres; 2) `alter role … password` (SCRAM); 3) actualizar el secreto de la función; 4) verificar `tick`/consulta; 5) borrar la clave anterior del almacén | segundos entre 2 y 3 (aceptable; hacerlo en ventana) |
| `FEL_SYS_SECRETO` (`/tick`) | 1) poner el actual en `FEL_SYS_SECRETO_ANTERIOR`; 2) poner el nuevo en `FEL_SYS_SECRETO`; 3) cambiar el programador al nuevo; 4) vaciar `…_ANTERIOR` | ninguna |
| Clave de un agente | revocar y vincular de nuevo (código de un solo uso) | solo ese agente |
| Llaves de Supabase (JWT) | procedimiento de la plataforma; la aplicación consume JWKS, sin llave privada | según plataforma (W0) |
| Sospecha de fuga | deshabilitar de emergencia el rol (`alter role … nologin password null`), rotar, revisar auditoría | hasta rehabilitar |

Nunca escribir secretos en archivos, commits, tickets ni chat; viven solo en los secretos de la función y en el entorno protegido del titular. Registrar fecha y responsable de cada rotación (sin el valor). Cadencia mínima: cada 90 días y ante cualquier salida de personal con acceso.
**Pendiente hospedado:** formato real del usuario del pooler, `SET ROLE`/`alter role` desde el administrador de Supabase, propagación de secretos de funciones (**1E / W5**).
