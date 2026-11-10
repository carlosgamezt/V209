# Dos clases de "invitación": no son lo mismo

| | **Invitación de cuenta (Supabase Auth)** | **Invitación a la empresa (NEXA FEL)** |
|---|---|---|
| Qué es | Un usuario en `auth.users` y un correo para crear su contraseña (`inviteUserByEmail`) | Una fila en `invitaciones` con **empresa, rol y permisos** |
| Quién la crea | La API, justo después de registrar la invitación a la empresa | La API (`miembro_invitar`: `usuarios.gestionar` + aal2) |
| Qué permite | **Solo iniciar sesión.** Una cuenta sin perfil no tiene acceso a nada (`fel_estado_cuenta` = `sin_perfil`) | Entrar a **esa** empresa, con ese rol, cuando la persona acepta |
| Cómo se acepta | Abriendo el enlace del correo y fijando la contraseña (la interfaz lo trata como el flujo `type=invite`) | Al iniciar sesión con el **mismo correo, ya confirmado**: `fel_op_invitacion_aceptar` crea el perfil y la membresía |
| Cuánto dura | Lo define Supabase (enlace de un solo uso) | 7 días (`expira_en`) |
| Qué pasa al revocar | No se borra la cuenta de Auth | La invitación queda `revocada` y deja de poder aceptarse |
| Quién puede verla | Solo Auth | Quien tiene `usuarios.gestionar` **en esa empresa** (RLS); otras empresas, nunca |

## Reglas que lo garantizan (con pruebas)
- Una cuenta de Auth sin invitación vigente **no entra** (`07_perfil_invitacion.sql`, `cuentas.cjs`: "Sin acceso").
- La aceptación toma la identidad de **Auth**, nunca del cliente; solo `service_role` puede invocarla (`08_privilegios.sql`).
- La invitación de una persona no la puede usar otra (suplantación probada con id/correo cruzados, mayúsculas y espacios).
- Si falla el envío del correo de cuenta, la invitación a la empresa recién creada se revoca (no queda huérfana).
- Si la persona **ya tenía cuenta**, no se le envía correo de cuenta (Supabase lo rechaza) y la interfaz lo informa: verá la invitación al iniciar sesión.

## En la interfaz
La pestaña **Invitaciones** explica ambas cosas en una tarjeta fija y el formulario dice qué se creará. La confirmación indica si se envió el correo de cuenta.
