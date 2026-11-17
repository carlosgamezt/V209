# NEXA FEL · Demostración en la nube (HTTPS) · guía de acceso para Android y PC
Todo es **SIMULADO · SIN VALOR FISCAL**. Digifact y la emisión real están apagados. Estado: verificado el 17/11/2026 (ejecución `publicar-nube` #19, commit `148e45b`).

## URL
**https://nexa-fel-demo.pages.dev** — (el nombre del proyecto de Pages está fijado en `nexa-fel-demo`; los registros lo muestran enmascarado `https://***.pages.dev`, sin sufijo; puedes confirmarlo en Cloudflare → Workers y Pages → `nexa-fel-demo`).

## Entrar (PC y Android)
1. Abre la URL en Chrome (PC o Android). Es HTTPS: no hace falta Wi-Fi especial.
2. Usuarios: `ana` (propietaria, empresa de demostración), otros de empresa y los administradores `maestro` y `maestro2` (Mario Maestro y Nora Maestra).
3. **Contraseñas:** las de tu secreto `DEMO_CLAVES` (las generaste con `generar_secretos.ts`). No se comparten por el chat. Cinco fallos bloquean 1 minuto.
4. **Administradores:** además piden un código **TOTP de 6 dígitos**: añade la semilla de tu secreto `DEMO_MFA_SEMILLAS` a una app de autenticación (Google Authenticator, Authy…) y usa el código vigente.
5. Cierra con **Salir** al terminar.

## Qué probar (verificado por la prueba de humo en la nube)
Inicio de sesión · datos de la empresa · **factura con varios ítems** · **certificación SIMULADA** (proveedor simulado: éxito/rechazo/etc.) · **PDF de demostración** (marcado NO FISCAL) · cerrar sesión y volver a entrar: **la factura certificada sigue ahí** (persistencia) · consumo y monedero simulados · administrador con MFA y vista de la plataforma. Para el resto del recorrido (clientes, conceptos, vista previa, navegación móvil, reportar problema) usa la tabla D de `GUIA-PRIMERA-SESION.md`.

## Limitaciones conocidas
- **Todo simulado:** serie, número y autorización de las certificaciones son simulados (prefijo `SIM-`); impuestos definitivos y régimen sin verificar; sin SAT ni Digifact (TEST o real; llegará después, con migración 29 y autorización propias).
- **No probado en dispositivos reales por mí:** la prueba de humo es automática (cliente HTTP); el recorrido visual en Android y PC lo harás tú. Reporta lo que veas (botón «Reportar un problema»).
- **Datos de demostración persistentes** en `nexa-demo`: lo que crees queda guardado; no uses datos reales de personas.
- La prueba automática creó facturas simuladas de «Prueba de humo» en la empresa de demostración.
- Cloudflare añade su propia cookie `__cf_bm` (ya contemplada; no afecta a navegadores).
