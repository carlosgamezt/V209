# NEXA FEL · Interfaz (Fase 1.1)

Pantallas de **Clientes**, **Conceptos** y **Borradores**. JavaScript modular, sin dependencias ni paso de compilación.
Vive en `fel/app/` (ningún flujo de despliegue lo toca). Moverla a `nexa/fel/` o publicarla requiere autorización.

- **Modo demostración (por defecto):** datos de ejemplo en memoria, sin red ni credenciales. Selector de rol para ver qué cambia
  según permisos (propietario, emisor, lector).
- **Modo remoto** (cuando exista el proyecto Supabase de FEL): editar `config.js` con `supabaseUrl` y la clave `anon` (pública).
  Lecturas directas con RLS; escrituras por la Edge Function `fel-api`. La sesión vive solo en memoria. No incluye aún MFA.
- **Un borrador no es una factura.** La vista previa se marca "NO certificada"; impuestos y total quedan "pendientes" y serie,
  número y autorización de SAT permanecen vacíos. El cálculo es decimal exacto y sin redondeo (`js/calculo.js`, idéntico al del
  servidor; una prueba lo verifica). El servidor siempre recalcula.
- **Seguridad de interfaz:** todo texto de usuario entra con `textContent` (nunca `innerHTML`); CSP restrictiva en `index.html`.
- **Pruebas:** `node fel/app/tests/ui.cjs [carpeta-capturas]` (Playwright). Las capturas de revisión están en `capturas/`.
