# Procedimiento: crear al primer administrador maestro (con MFA)

> Para un FUTURO proyecto Supabase de **desarrollo** de NEXA FEL. No se ejecuta nada de esto en el proyecto actual de NEXA
> ni en producción. Requiere autorización expresa antes de aplicarse.

## Principios
- El registro abierto está desactivado (`enable_signup = false`): la cuenta se crea **por invitación** desde el panel de Supabase.
- El maestro **debe tener TOTP verificado antes** de recibir el rol. La función de la base lo comprueba y se niega si no es así.
- Solo el **propietario de la base de datos** (consola SQL del panel) puede crear un maestro: `fel_bootstrap_primer_maestro` no la puede
  ejecutar `service_role`, `authenticated` ni `anon` (hay pruebas que lo verifican). La Edge Function jamás puede crear maestros.
- Las lecturas del maestro por RLS exigen sesión **aal2**; con solo contraseña no ve nada. Las acciones de la API exigen aal2.
- La emisión real sigue bloqueada (`plataforma_config.emision_real_disponible = false`); este procedimiento no la toca.
- No se guardan contraseñas ni secretos TOTP en el repositorio, en tablas propias ni en el navegador.

## Pasos
1. **Preparar el proyecto de desarrollo** (una sola vez, ya autorizado): proyecto Supabase nuevo e independiente; aplicar las migraciones
   con `supabase db push` y revisar que `select valor from plataforma_config` devuelva `false`.
2. **Crear el usuario por invitación**: panel de Supabase → Authentication → Users → *Invite user* con el correo del administrador.
   Usa un correo propio y un gestor de contraseñas; la contraseña mínima es de 12 caracteres (`config.toml`).
3. **Aceptar la invitación** desde el correo y fijar la contraseña. El correo queda confirmado.
4. **Iniciar sesión en la interfaz de FEL y activar el TOTP**: pantalla *Seguridad* → *Activar verificación en dos pasos*.
   Escanea el QR con una app autenticadora (o copia la clave manual), escribe el código de 6 dígitos y confirma. Guarda los códigos
   de recuperación que defina tu proceso (Supabase no los genera para TOTP: conserva un segundo dispositivo o respaldo de la clave).
5. **Dar el rol de maestro** desde la consola SQL del panel (rol `postgres`):
   ```sql
   select public.fel_bootstrap_primer_maestro('correo-del-administrador@ejemplo.com');
   ```
   La función se niega si: el usuario no existe, el correo no está confirmado, no hay un factor TOTP **verificado**, la cuenta está
   desactivada, o ya existe un maestro (para un segundo maestro: `select public.fel_bootstrap_primer_maestro('otro@ejemplo.com', true);`).
   Crea el perfil activo y la fila en `plataforma_admins`, y deja un registro en la auditoría (`plataforma.maestro_creado`).
6. **Verificar**:
   ```sql
   select user_id from plataforma_admins;                                        -- debe listar solo al administrador
   select accion, ocurrido_en from auditoria where accion = 'plataforma.maestro_creado' order by id desc limit 1;
   select valor from plataforma_config where clave = 'emision_real_disponible';  -- debe seguir en false
   ```
   Cierra sesión, vuelve a entrar (contraseña + código TOTP) y comprueba que la interfaz muestra `plataforma: true` y nivel de sesión aal2.
7. **Probar los negativos**: entra con contraseña y **sin** completar el código: no debe ver empresas ni poder ejecutar acciones de
   administrador (la API responde 403 `mfa_requerido`).

## Revertir o dar de baja a un maestro
```sql
update perfiles set activo = false where user_id = '<uuid>';      -- bloquea la cuenta al instante (API y RLS)
-- opcional, además: delete from plataforma_admins where user_id = '<uuid>';   (siempre debe quedar al menos un maestro de respaldo)
```
Bloquea además al usuario en Supabase Auth (opción *Ban user*) para cortar sus sesiones activas.

## Qué NO hacer
- No crear al maestro insertando filas a mano sin pasar por la función (se salta la comprobación de TOTP).
- No compartir la cuenta del maestro ni usarla para operar datos de negocio: el maestro no ve clientes, conceptos ni documentos.
- No habilitar la emisión real como parte de este procedimiento.
