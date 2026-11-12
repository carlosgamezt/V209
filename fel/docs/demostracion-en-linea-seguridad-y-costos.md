# Demostración privada en línea · seguridad y costos (para tu autorización)

**Estado: NADA está publicado.** Todo lo de abajo está construido y probado, pero no se despliega nada ni se crea ninguna cuenta o servicio de pago hasta que lo autorices. Sigue siendo SIMULADA y SIN VALOR FISCAL.

## 1. Qué se publicaría
Una sola aplicación (contenedor) con la demostración: PC y teléfono por navegador, con el mismo diseño. Datos y sesiones **en memoria** (se reinician al redesplegar o reiniciar; sin base de datos externa, sin copias de seguridad). Sin conexión con SAT ni con ningún certificador real; sin pagos reales.

## 2. Configuración de seguridad (ya implementada y probada)
- **Solo por HTTPS** con HSTS; el servicio rechaza HTTP y cualquier nombre de dominio que no sea el configurado.
- **Cuentas propias, sin contraseñas públicas:** el servicio **no arranca** si faltan credenciales, son débiles (<14 caracteres), repetidas o es `demo1234`. Solo existen las cuentas que tú configures; las demás no pueden entrar.
- **Verificación en dos pasos (TOTP) obligatoria** para las dos cuentas de plataforma; bloqueo tras 5 intentos fallidos de contraseña o de código.
- **Secretos solo en el almacén de secretos de la plataforma** (variables de entorno del servicio): nunca en la imagen, el repositorio ni el registro del servicio (hay pruebas que lo verifican). Un generador (`src/generar_secretos.ts`) crea contraseñas y semillas aleatorias y las muestra **una vez** en tu terminal.
- **Límites de intentos por IP** (10 inicios de sesión/min, 400 solicitudes/min), cookies `HttpOnly` + `Secure` + `SameSite=Strict`, cabeceras estrictas (CSP, `nosniff`, `X-Frame-Options`, sin indexación en buscadores, sin permisos de cámara/micrófono/ubicación), sin CORS abierto.
- **Aislamiento entre empresas** probado con identificadores reales de otra empresa (lecturas y escrituras rechazadas), permisos por rol, sesiones que mueren en el servidor al cerrarse.
- **Superficie reducida:** el plano de control del agente local no existe en línea; el programa corre con permisos mínimos (sin escribir en disco, sin ejecutar procesos); `/salud` no expone datos.
- **Candados fiscales y de pagos cerrados:** solo certificadores simulados (restricción de base de datos), pagos solo «simulado», sin credenciales de producción.
- **Pruebas sobre lo que se publicaría:** en cada cambio, CI construye la imagen, la arranca en modo publicado y ejecuta contra ella comprobaciones de seguridad y el E2E completo en navegador (PC y teléfono emulado, con MFA).

## 3. Opciones de alojamiento y costos estimados (aproximados; confirmar precios vigentes antes de contratar)
| Opción | Qué es | Costo mensual estimado | Notas |
|---|---|---|---|
| **A · Fly.io (recomendada)** | 1 máquina compartida, 1 GB, siempre encendida, HTTPS y subdominio `*.fly.dev` incluidos | **≈ US$5–8** | configuración lista (`despliegue/fly.toml`); región cercana a Guatemala |
| B · Google Cloud Run | 1 instancia mínima siempre activa (1 vCPU / 1 GiB) | ≈ US$12–25 | más piezas (cuenta de facturación, Artifact Registry); escala a cero pierde datos y sesiones, por eso se fija 1 mínima |
| C · Render (plan de pago básico) | 1 servicio web de 512 MB–1 GB | ≈ US$7–15 | el plan gratuito se «duerme» y perdería datos y sesiones |
| Extra opcional · dominio propio | p. ej. `demo.tuempresa.com` | ≈ US$10–15 **al año** | no necesario: el subdominio del proveedor basta |
| Extra opcional · Cloudflare Access (puerta previa por correo) | segunda barrera antes de ver la aplicación | US$0 hasta 50 usuarios | requiere dominio propio |
GitHub (CI y contenedor de prueba): sin costo adicional. **Total esperado: ≈ US$5–8 al mes con la opción A, sin dominio.** Cancelar el servicio detiene el cobro; no hay compromisos de plazo.

## 4. Riesgos y límites que debes aceptar
- **No es producción:** datos en memoria, una sola instancia, sin respaldo; cualquier reinicio borra lo creado y cierra sesiones.
- **Acceso:** cualquiera que conozca la dirección verá la pantalla de inicio de sesión (no el contenido). La protección son las contraseñas largas, el MFA y los límites de intentos; para ocultarla aún más, usar el extra de Cloudflare Access.
- **La IP del cliente** para los límites se toma de las cabeceras del proxy del proveedor (válido detrás de Fly/Cloud Run/Render; no usar el modo publicado sin proxy).
- **Sigue siendo simulación:** nada de lo que se muestre tiene valor fiscal.

## 5. Qué necesito de ti para publicar
1. **Autorización explícita** para desplegar y para el gasto (opción y tope mensual).
2. **Una cuenta del proveedor elegido** creada por ti (con tu método de pago); yo no manejo tu tarjeta ni tus claves.
3. **Los secretos:** ejecutas `deno run demo-facturacion/src/generar_secretos.ts`, guardas las contraseñas y registras el MFA en tu teléfono; pegas los secretos en la plataforma (el comando aparece impreso). Yo no necesito verlos.
4. **El nombre público** (p. ej. `nexa-fel-demo-xxxx.fly.dev`).
Con eso: despliegue, prueba de humo remota con tus cuentas y entrega de la dirección.
