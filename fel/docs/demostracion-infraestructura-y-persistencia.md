# Demostración en línea con persistencia · infraestructura, costos y pasos de autorización

Estado: **técnicamente preparada, NO publicada.** No se contrató nada, no se desplegó nada, no hay gasto. Los precios y límites de plataformas son aproximados y deben confirmarse en su página oficial antes de contratar.

## 1. Qué cambió en el código (persistencia real)
| Dato | Dónde vive ahora (modo `FEL_DEMO_BD_URL`) |
|---|---|
| Empresas, establecimientos, usuarios, roles, permisos, clientes, productos, documentos, líneas, certificaciones simuladas, certificadores y canales por empresa, planes, monederos, bolsón, consumos, movimientos, auditoría | **El esquema existente de NEXA FEL** (`supabase/migrations/*`), sin duplicar modelo |
| Cuentas de acceso (hash PBKDF2 con sal), sesiones (solo SHA-256 del identificador), intentos fallidos | `demo_credenciales`, `demo_sesiones`, `demo_intentos` (migración 0800; RLS activo, sin políticas, sin privilegios para `anon`/`authenticated`) |
| Estado del «servidor» de cada certificador simulado (para anular, conciliar y consultar tras un reinicio) | `demo_simulador_estado` (migración 0900; mismo cierre); cada petición que escribe corre en exclusión mutua con bloqueo consultivo |
Garantías probadas (suite contra PostgreSQL real + E2E en navegador): reinicio sin perder nada ni resembrar; sesión y contraseña cambiada sobrevivientes; anulación y consulta de un documento certificado antes del reinicio; auditoría de autenticación; negativa a sembrar sobre una base ajena o sin migraciones; todas las migraciones aditivas (nada destructivo).
Sin `FEL_DEMO_BD_URL` todo sigue funcionando en memoria (pruebas y uso local).

## 2. Comparativa de infraestructura
Requisito de partida: el servidor es **Deno** (HTTP + HTML estático + API), usa PBKDF2 (≈ decenas de ms de CPU por inicio de sesión) y conecta por TCP a PostgreSQL. Ya es *sin estado* (todo en la base), así que puede correr en una o varias instancias.

| Opción | Compatibilidad con el código | Cambios reales necesarios | Costo | Veredicto |
|---|---|---|---|---|
| **A · Contenedor (Fly.io) + Supabase Postgres** | Total: imagen y `fly.toml` listos, probados en CI | Ninguno | Fly ≈ US$5–8/mes; Supabase Free US$0 | **Lista hoy.** Mínimo mantenimiento. Único gasto |
| **B · Deno Deploy + Supabase Postgres** | Es Deno nativo; `servidor.ts` ya lee `PORT`, no escribe a disco y no carga PGlite en este modo | Verificar en una prueba real: lectura de archivos estáticos desplegados, conexiones TCP salientes y temporizadores (supervisor) | Plan gratuito (confirmar límites) | **Mejor opción de costo cero** con el menor trabajo adicional; requiere una prueba que yo no puedo hacer sin tu cuenta |
| **C · Cloudflare Pages (estático) + Pages Function (intermediario) + Supabase Edge Function (Deno) + Postgres de Supabase** | **Implementada y probada localmente** de punta a punta (construcción, aprovisionamiento, intermediario, función, base real, E2E en PC y teléfono). La función corre Deno; el inicio de sesión (PBKDF2) tarda ≈ 12 ms de CPU frente a un límite de ~2 s | Ninguno pendiente en el código; falta solo la prueba en los servicios reales (requiere tus cuentas) | **US$0** | **Recomendada**: usa tus cuentas de Cloudflare y Supabase, sin servidor propio que mantener |
| D · Cloudflare Workers solo | **No**: Workers no es Deno, el plan gratuito da ~10 ms de CPU (PBKDF2 no cabe) y habría que reescribir el servidor | Reescritura | US$0–5 | Descartada |
| E · Google Cloud Run / Render de pago | Compatible con la imagen | Ninguno | US$7–25/mes | Sin ventaja frente a A |
Base de datos en todas: **un proyecto Supabase exclusivo de la demostración** (Free: 500 MB; el plan Free **pausa** el proyecto tras ~1 semana sin actividad —se reactiva a mano— y no incluye copias de seguridad). Conexión por el agrupador (pooler) en modo transacción (`prepare:false` ya configurado).

**Recomendación:** **C** (Cloudflare Pages + función de Supabase + Postgres de Supabase), porque aprovecha tus cuentas, cuesta US$0 y no depende de ningún equipo encendido. Respaldo: **A** (contenedor en Fly.io, ≈ US$5–8/mes), que ya existe y se prueba en CI, si la prueba real de C diera problemas con los límites de Supabase. **B** queda como alternativa de costo cero sin Cloudflare.

## 3. Seguridad (resumen; detalle en `demostracion-en-linea-seguridad-y-costos.md`)
Contraseñas largas aleatorias y MFA TOTP para los administradores de la plataforma (de variables de entorno, nunca del repositorio ni de la imagen); cookies `HttpOnly; Secure; SameSite=Strict`; bloqueo tras 5 intentos; límites por IP; solo HTTPS; lista de nombres permitidos; cabeceras estrictas; sin plano del agente; sin credenciales de demostración públicas; aislamiento entre empresas por RLS y funciones con actor; auditoría; la base solo la toca el servidor (las tablas de la demostración están cerradas a `anon`/`authenticated`). **La clave de conexión a la base (rol privilegiado) vive solo en el secreto de la plataforma de alojamiento; nada de Supabase llega al navegador.**
Brecha conocida: la demostración tiene su propio inicio de sesión; la **producción** debe usar Supabase Auth + `fel-api` (diseño en `produccion-preparacion.md`).

## 4. Costos mensuales estimados
| Concepto | Gratis | De pago |
|---|---|---|
| GitHub (repositorio, CI, imagen de prueba) | ✔ | — |
| Supabase Postgres (proyecto exclusivo) | ✔ Free (se pausa por inactividad; sin respaldos) | Pro ≈ US$25 si quieres sin pausa y con respaldos |
| Cloudflare Pages + Pages Function (opción C) | ✔ (confirmar límites del plan Free) | — |
| Supabase Edge Functions (opción C) | ✔ (confirmar cuota mensual de invocaciones del plan Free) | — |
| Alojamiento B (Deno Deploy) | ✔ (confirmar límites) | — |
| Alojamiento A (Fly.io) | — | ≈ US$5–8 |
| Dominio propio (opcional) | — | ≈ US$10–15 **al año** |
| Cloudflare Access como puerta previa (opcional, requiere dominio) | ✔ hasta 50 usuarios | — |
**Total esperado:** **US$0 con C (Cloudflare + Supabase Free)**; US$0 con B + Supabase Free; ≈ US$5–8 con A + Supabase Free; ≈ US$30–33 con A + Supabase Pro.

## 5. Pasos para habilitar el acceso privado
Ver la guía paso a paso **`guia-publicar-demostracion.md`** (qué haces tú, comandos exactos y prueba de humo). Resumen: autorizar → proyecto Supabase nuevo → migraciones → contraseñas y MFA → aprovisionar → función → página en Cloudflare → prueba desde el teléfono.

## 6. Riesgos y limitaciones pendientes
- **Servicios reales sin probar:** Cloudflare Pages y las Edge Functions de Supabase no se ejecutaron desde aquí (sin cuentas ni gasto). Se probó la cadena completa en local y contra PostgreSQL real, con el código que se despliega. Puede haber diferencias del empaquetado en el despliegue real (se resuelven en la prueba de humo; el respaldo es la opción A).
- **Usuarios en Supabase hospedado:** se crean con la API de administración de Supabase Auth (no insertando en `auth.users`); la prueba lo verifica con una base que **prohíbe** escribir directamente en `auth.users`. Supuesto no verificable sin tu proyecto: que la API respete el `id` indicado (si no, el aprovisionamiento se detiene con un mensaje claro y sin dejar nada sembrado).
- **Límite de intentos de inicio de sesión por IP:** compartido entre instancias en PostgreSQL (probado con dos instancias); el límite general de la API es por instancia, y el bloqueo por usuario (5 intentos) es persistente. Cloudflare puede añadir su propia limitación gratuita.
- **Cambiar la contraseña de un usuario por aprovisionamiento** la sobrescribe (útil para rotar); las que cada persona cambia en la aplicación se conservan hasta entonces.
- **Supabase Free:** pausa por inactividad y sin respaldos; no guardes nada que no puedas recrear. Los datos son simulados.
- **Estado de simuladores en una fila de texto por certificador:** adecuado para demostración; se serializan las escrituras (una a la vez). No es el diseño de producción (un certificador real guarda su propio estado).
- **Autenticación propia de la demostración**, no Supabase Auth.
- **Navegadores:** probado en Chromium (escritorio y móvil emulado); Firefox y WebKit se prueban en CI, no localmente.
- **PWA:** se mantiene; la instalación no es obligatoria.
- Todo sigue **simulado**: sin certificación ni pagos reales, sin credenciales fiscales; Digifact y Certificador B son simuladores sin contrato HTTP inventado.
