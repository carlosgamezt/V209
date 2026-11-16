# NEXA FEL · Acceso anticipado: instalación y primera sesión de pruebas (DEMO)
Todo es **SIMULADO · SIN VALOR FISCAL**. No se conecta a SAT, a Digifact ni a Supabase. Los datos viven **solo en la memoria** y se pierden al cerrar. No hay nada que instalar (ni Deno ni PostgreSQL).

## A. Obtener el paquete
1. GitHub → repositorio `carlosgamezt/V209` → **Actions** → «NEXA FEL · paquete de la demostración» → la ejecución más reciente en verde de la rama `fel-proveedores-diseno` → **Artifacts → `nexa-fel-demo`** (requiere iniciar sesión en GitHub).
2. Descomprime `nexa-fel-demo.zip`: contiene tres ZIP. Usa **`nexa-fel-demo-x86_64-pc-windows-msvc.zip`** y descomprímelo en una carpeta propia (por ejemplo `C:\NEXA-FEL`). No lo ejecutes desde dentro del ZIP.
3. Windows puede avisar «Windows protegió su PC» porque el programa no está firmado: **Más información → Ejecutar de todos modos**. Solo si lo descargaste tú de tu GitHub.

## B. Iniciar en la computadora y el teléfono (misma Wi-Fi)
1. Haz doble clic en **`INICIAR-TELEFONO.cmd`**. Si el Firewall pregunta, marca **«Redes privadas»** (no «Redes públicas»).
2. La ventana negra muestra: la **IP de la computadora** (línea «IPv4») y una **contraseña aleatoria por usuario**, **solo para esta sesión** (cambian cada vez). **No cierres la ventana mientras pruebas.** No copies esas contraseñas al chat, a correos ni a archivos.
3. En la computadora, el navegador se abre solo en `http://127.0.0.1:8787/`. Entra con `ana` y su contraseña de la ventana.
4. En el teléfono (Wi-Fi **privada** de tu casa u oficina; no una red pública o de invitados), abre en Chrome/Safari `http://IP-DE-LA-COMPUTADORA:8787/` y entra con el mismo usuario y contraseña.
5. **Cerrar bien:** en la app pulsa **Salir**; luego cierra la ventana negra (o `Ctrl+C`). Al cerrar se borra todo y se invalidan las contraseñas.
Si solo vas a usar la computadora, `INICIAR.cmd` basta (solo escucha en tu equipo; usuario `ana`, contraseña `demo1234`, pública y solo válida ahí).

## C. Qué garantías verifiqué (modo `--lan`, probado el 16/11/2026 con el mismo código del paquete)
- Contraseñas **aleatorias y temporales** por sesión; `demo1234` es **rechazada** (401). Solo se muestran en la ventana local.
- La API **exige sesión** (401 sin ella); un `Host` con nombre de dominio se rechaza (403): solo se acepta acceso por IP; el código fuente (`servidor.ts`) no se sirve; respuestas sin caché y con política de seguridad estricta.
- Los administradores de plataforma (`maestro`, `maestro2`) además usan **verificación TOTP**; sus claves TOTP también salen **solo en esa ventana**. Para las pruebas de hoy usa `ana`, `marta`, `luis` o `pedro`.
- **Limitación honesta:** en red local la conexión es **HTTP (sin cifrar)**; por eso solo en Wi-Fi privada y de confianza. HTTPS (instalar como app) requiere un túnel y se decide aparte. Windows y el paquete no están firmados digitalmente.

## D. Primera sesión de pruebas (15–20 minutos)
| # | Qué revisar | Cómo | Esperado |
|---|---|---|---|
| 1 | **Inicio de sesión** | Entra en PC y teléfono; prueba una contraseña mala | Entra con la correcta; la mala se rechaza; 5 fallos bloquean 1 min |
| 2 | **Dashboard (Panel)** | Menú → Panel | Indicadores y facturas recientes; franja «SIMULADO» y «DEMO · datos NO persistentes» |
| 3 | **Clientes y conceptos** | Crea un cliente y un concepto; edítalos; márcalos frecuentes/desactívalos | Validaciones claras; los inactivos no se ofrecen al facturar |
| 4 | **Factura simulada** | Nueva factura → receptor, establecimiento → ítems (varios, con descuento) | Totales exactos; cantidad 0 o negativa y precios negativos **se rechazan**; **precio Q0.00 se acepta solo en DEMO, con aviso visible** (no vale para certificar) |
| 5 | **Vista previa** | Paso 3 | Marcada «NO certificada», sin serie, número ni autorización; impuestos «pendientes» |
| 6 | **Navegación móvil** | En el teléfono: 4 accesos + «Más» (Conceptos, Usuarios, Plan, Configuración, Reportar) | Sin desborde horizontal; botones táctiles; barra de acciones en una fila |
| 7 | **Reportar un problema** | Pie de página (PC) o «Más → Reportar un problema» (móvil); pega el texto en el chat con lo que esperabas | Copia versión, pantalla, rol, tamaño de ventana y errores recientes, **sin datos de facturas ni clientes** |
Opcional: guardar el borrador, «Marcar como revisado» y «enviar» al proveedor simulado (éxito, rechazo, tiempo agotado, caídas). **No hay certificación real; nada se persiste.**

## E. Qué NO hace todavía
Persistencia (borradores que sobreviven al cierre), Supabase/Cloudflare, Digifact (TEST o real), SAT, impuestos fiscales definitivos. Cada uno requiere tu autorización específica. Los hallazgos se anotan en `HALLAZGOS.md`.
