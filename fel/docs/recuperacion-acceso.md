# Recuperación de contraseña y pérdida del dispositivo TOTP

> Principio: **ningún camino omite el MFA sin una verificación administrativa** (otra persona, con aal2, que verifica la identidad por un canal distinto de la aplicación y deja constancia). Lo marcado **[REAL]** depende de Supabase real.

## 1. Olvidé mi contraseña
1. La persona escribe su correo → `POST /auth/v1/recover`. **La respuesta de la interfaz es siempre la misma** exista o no la cuenta (no se revela quién tiene cuenta). El límite de correos lo impone Supabase y la interfaz muestra el aviso de espera.
2. El enlace del correo vuelve a la aplicación con el token en el `#fragmento`. La interfaz lo lee **una vez y lo borra de la barra de direcciones** de inmediato.
3. Esa sesión **no entra a la aplicación**: solo sirve para fijar la contraseña. Al terminar se cierra y hay que iniciar sesión.
4. Si la cuenta tiene TOTP, **primero se pide el código** y recién entonces se ofrece la contraseña nueva (Supabase exige aal2 para cambiar la contraseña con MFA activo **[REAL]**). **Recuperar la contraseña nunca quita el MFA.**
5. Política: 12+ caracteres con mayúsculas, minúsculas y números (igual que `config.toml`).
La misma pantalla atiende el enlace de **invitación de cuenta** ("Crea tu contraseña").

## 2. Perdí mi dispositivo TOTP
```
persona (contraseña OK, sin código)  ──►  "Perdí mi dispositivo": solicitud (motivo ≥ 10 caracteres)
                                         · NO cambia nada del MFA · 1 abierta a la vez · máx. 3 por 24 h · vence a las 72 h
administrador resuelve (aal2, otra persona) ──►  verifica identidad POR OTRO CANAL (videollamada, en persona…)
                                         · evidencia escrita ≥ 20 caracteres + confirmación expresa
                                         · aprueba → se eliminan los factores TOTP (API de administración de Auth)
persona ──► inicia sesión con su contraseña (aal1) ──► activa un dispositivo nuevo en Seguridad
```
**Quién puede resolver** (lo decide la base de datos, `fel__puede_resolver_mfa`):
- Una persona común: un **administrador maestro**, o un **propietario** de una empresa en la que ambos son miembros activos.
- Un propietario: otro propietario de su empresa o un maestro. Un **maestro**: solo **otro maestro**.
- **Nunca la propia solicitud.** Cuentas bloqueadas, lectores, emisores y administradores no resuelven.
- La aprobación y el cierre quedan en la auditoría con la evidencia. La aprobación es repetible si falla el borrado en Auth (la solicitud queda `aprobada`).

**Emergencia (único maestro que perdió el dispositivo):** actúa el propietario de la base de datos en el panel de Supabase (Authentication → Users → eliminar el factor) y deja constancia con `select public.fel_registrar_recuperacion_manual('correo', 'descripción de la verificación realizada…');` (solo registra en la auditoría; no cambia ninguna cuenta). Debe haber verificación presencial o equivalente documentada.

## Riesgos que quedan
- Quien tenga **contraseña + correo** puede solicitar la recuperación; el control es la verificación humana. Mantener el límite de 3 solicitudes/24 h y revisar la auditoría.
- Tras eliminar el factor, **una sesión aal2 vieja** (de un dispositivo robado) sigue siendo aal2 hasta que vence el JWT. Mitigación: `jwt_expiry` corto y cerrar sesiones de la persona (panel de Supabase) al aprobar **[REAL]**.
- La persona recuperada queda en aal1 hasta activar un TOTP nuevo (las acciones administrativas siguen exigiendo aal2).

## Depende de un Supabase real **[REAL]**
- Que `PUT /auth/v1/user` rechace el cambio de contraseña sin aal2 cuando hay TOTP verificado, y el código de error exacto.
- Que `auth.admin.mfa.deleteFactor` elimine el factor y que las sesiones existentes se comporten como se supone.
- Plantillas de correo, `site_url`/`additional_redirect_urls` (el retorno debe estar en la lista permitida), límites de envío y el flujo (implícito con `#fragmento`; con PKCE habría que adaptarlo).
