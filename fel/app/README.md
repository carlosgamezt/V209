# NEXA FEL · Interfaz (Fase 1.1)

Pantallas de **Clientes**, **Conceptos** y **Borradores**. JavaScript modular, sin dependencias ni paso de compilación.
Vive en `fel/app/` (ningún flujo de despliegue lo toca). Moverla a `nexa/fel/` o publicarla requiere autorización.

- **Modo demostración (por defecto):** datos de ejemplo en memoria, sin red ni credenciales. Selector de rol para ver qué cambia
  según permisos (propietario, emisor, lector).
- **Modo remoto** (cuando exista el proyecto Supabase de FEL): editar `config.js` con `supabaseUrl` y la clave `anon` (pública).
  Lecturas directas con RLS; escrituras por la Edge Function `fel-api`.
  - **Inicio de sesión:** correo y contraseña (Supabase Auth). Si la cuenta tiene TOTP verificado, la contraseña **no basta**: hasta
    escribir el código de 6 dígitos no se pide ningún dato ni se guarda sesión. Tras 5 códigos incorrectos se vuelve al inicio.
  - **Recuperación de sesión:** lo único que se guarda en el navegador es el token de renovación, en `sessionStorage` (se borra al
    cerrar la pestaña). Al recargar se renueva; si la cuenta exige TOTP y la sesión no es aal2, no se recupera. El token de acceso
    vive solo en memoria y se renueva antes de vencer (una sola renovación aunque haya varias peticiones a la vez).
  - **MFA TOTP:** pantalla *Seguridad* para activar la verificación (QR + clave manual + código de confirmación).
  - **Cierre de sesión:** revoca la sesión en el servidor y borra todo lo local.
  - **Recuperar contraseña** y enlace de **invitación de cuenta**: el token del enlace se lee una vez y se borra de la barra de direcciones;
    esa sesión solo sirve para fijar la contraseña (con TOTP, primero se pide el código). Ver `../docs/recuperacion-acceso.md`.
  - **Perdí mi dispositivo:** crea una solicitud; nada del MFA cambia hasta que otra persona verifica la identidad y la aprueba.
  - **Duración máxima (8 h) e inactividad (30 min)** configurables en `config.js` (`duracionMaximaMs`, `inactividadMs`). Ver `../docs/seguridad-sesion.md`.
  - Los permisos se revalidan al cambiar de pantalla y al volver a la pestaña: una revocación o un cambio de rol se nota de inmediato.
  - Nunca se escribe directo en las tablas: toda escritura va por `fel-api`.
- **Usuarios** (con `usuarios.ver`): personas de la empresa activa, invitaciones **a la empresa** (distintas del correo de cuenta de Supabase,
  ver `../docs/invitaciones.md`), matriz de roles y permisos, y recuperación de acceso. Gestionar exige verificación en dos pasos (aal2).
- **Un borrador no es una factura.** La vista previa se marca "NO certificada"; impuestos y total quedan "pendientes" y serie,
  número y autorización de SAT permanecen vacíos. El cálculo es decimal exacto y sin redondeo (`js/calculo.js`, idéntico al del
  servidor; una prueba lo verifica). El servidor siempre recalcula.
- **Seguridad de interfaz:** todo texto de usuario entra con `textContent` (nunca `innerHTML`); CSP restrictiva en `index.html`.
- **Pruebas** (Playwright): `node fel/app/tests/ui.cjs [capturas]` (demostración) y `node fel/app/tests/auth.cjs [capturas]` (login, TOTP, sesión,
  permisos y navegación) y `node fel/app/tests/cuentas.cjs [capturas]` (contraseña, MFA perdido, inactividad, revocación, usuarios y empresas), ambas contra
  un Supabase **falso** interceptado: sin red ni credenciales. Capturas de revisión en `capturas/`.
