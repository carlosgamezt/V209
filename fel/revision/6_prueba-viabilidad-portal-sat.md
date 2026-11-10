# Prueba de viabilidad: Playwright + portal FEL gratuito de SAT Guatemala

> **Estado:** mecanismo construido y probado **solo contra una página de ejemplo local** (`fel/poc-sat/tests/fixture`, que NO es el portal de la SAT). **No se ha abierto el portal real**, no se conoce su estructura y no hay ni un selector del portal en el código. Todo lo que dependa del portal real está en la sección 6 y requiere Chrome en una computadora.
> Pausados por instrucción: Fase 1.5 (Supabase alojado) y certificadores privados. Esta prueba **no usa Supabase**, no despliega, no toca `main` y **no emite documentos fiscales**.

## 1. Qué se quiere saber
¿Se puede preparar el llenado del formulario FEL gratuito desde Chrome con Playwright, con una sesión iniciada **a mano**, datos **ficticios**, deteniéndose **siempre** antes de emitir, y con un resultado medible (pasos automáticos vs. manuales, errores, tiempos)? ¿Y se puede repetir para varias empresas **sin compartir sesiones ni credenciales**?

## 2. Qué se construyó (`fel/poc-sat/`)
```
fel/poc-sat/
  bin/observar.mjs     Solo lectura. Inventario de controles de la pestaña abierta → observaciones/ + borrador de mapeo
  bin/ejecutar.mjs     Llena con datos ficticios y SE DETIENE. Registra pasos, tiempos, errores y bloqueos
  src/guardia.mjs      Reglas puras: palabras prohibidas, validación del plan y de los datos, política de red, aislamiento
  src/ejecutor.mjs     Intérprete del plan (falla cerrado) · src/observar.mjs · src/localizar.mjs · src/conexion.mjs · src/registro.mjs
  config/              empresa.ejemplo.json · mapeo.plantilla.json (SIN selectores) · datos-ficticios.json
  tests/               guardia.test.mjs (20) · autoprueba.mjs (26, Chrome real contra la página de ejemplo)
  src/sesion.mjs · src/progreso.mjs · src/libro.mjs   Gestión de sesión SAT, progreso y anti-duplicados → ver docs/gestion-sesion-sat.md
  bin/medir-sesion.mjs Mide pasivamente cuánto tarda el portal en pedir iniciar sesión (hipótesis 20–30 min, NO confirmada)
```
**Flujo:** (1) la persona abre Chrome e inicia sesión a mano → (2) `observar` lista lo que existe en la página → (3) la persona completa y **confirma** el mapeo → (4) `ejecutar` llena y se detiene → (5) la persona revisa y cierra **sin emitir**.

### Cómo se garantiza la parada (varias capas independientes)
| # | Capa | Qué impide |
|---|---|---|
| 1 | El vocabulario de pasos **no contiene** emitir/enviar/certificar/pulsar Enter (`manual, esperar_visible, llenar, seleccionar, marcar, clic_seguro, leer, detener`) | Un plan no puede pedirlo |
| 2 | Validador del plan: exactamente un paso `detener`, al final; rechaza clics con palabras de emisión; exige `verificado:true`, dominios reales y datos ficticios | Planes peligrosos o sin confirmar no corren |
| 3 | Guardia del clic: antes de cada clic lee el **control real** (texto, tipo, href, ¿dentro de un formulario?) y lo rechaza si dice emitir/enviar/guardar/certificar… o si puede enviar un formulario | Un clic «disfrazado» se detecta |
| 4 | **Red de solo lectura**: todo POST/PUT/PATCH/DELETE hacia cualquier host se aborta y se registra (salvo permiso explícito que no parezca de emisión) | Aunque algo se pulse, no sale el envío |
| 5 | Lista de dominios permitidos, comprobada en cada paso | No actúa en otra pestaña o sitio |
| 6 | Los diálogos (`confirm`) se descartan = cancelar | Nunca se «acepta» nada |
| 7 | Datos ficticios obligatorios (`ficticio:true`, «PRUEBA» en nombres/descripciones, NIT solo `CF` o declarado) | No se usan datos de terceros |
| 8 | Confirmación manual de que la sesión corresponde a la empresa | No se llena en la cuenta equivocada |

**Probado con Chrome real (control negativo incluido):** sin la guardia el botón «Emitir» del formulario de ejemplo sí envía; con ella llegan **0** POST al servidor, tanto por clic como por `fetch` como por `requestSubmit()`.
**Límites honestos:** la detección por palabras es una heurística (un botón solo con ícono, o en otro idioma, no se reconoce → por eso existe la capa 4 y por eso el borrador de mapeo omite todo lo que no sea campo). No hay forma de impedir que **una persona** emita a mano. WebSockets y *service workers* no están cubiertos por la capa 4 (verificar, sección 6).

## 3. Sesión SAT iniciada a mano, sin guardar credenciales
Nunca se teclea ni se lee usuario/contraseña/clave ni 2FA; el código ni siquiera tiene un paso para campos de contraseña (el borrador los omite). Dos modos:
- **`cdp` (recomendado):** abres **tú** Chrome con un perfil propio de la empresa y un puerto de depuración local; inicias sesión; el script solo se conecta (127.0.0.1; cualquier otra dirección se rechaza) y al terminar **suelta** la conexión sin cerrar tu Chrome.
  ```
  # Windows (PowerShell). El perfil va FUERA del repositorio. Chrome reciente puede exigir un --user-data-dir distinto del predeterminado para activar el puerto (verificar).
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\fel-poc\perfiles\empresa-a"
  ```
- **`perfil`:** Playwright abre Chrome con `perfil_dir` (fuera del repo, se rechaza si está dentro). Inicias sesión a mano en esa ventana. Las cookies de sesión viven en ese perfil **en tu equipo** (es el comportamiento normal de Chrome; no son credenciales, pero sí una sesión: protege la carpeta y ciérrala al terminar).
En ambos modos: observaciones, registros y perfiles están en `.gitignore`; los registros **no contienen valores de campos, cookies ni cabeceras**.

## 4. Plan de prueba ejecutable
Cada fase termina con un criterio de paso/parada. No se avanza si falla.

**Fase 0 — Autoprueba sin SAT (se puede hacer ya)**
```
cd fel/poc-sat && npm install && npm test        # esperado: 20 tests + 26/26 casos con Chrome
```
Criterio: todo OK. (Se ejecuta también en la CI.)

**Fase 1 — Preparación en tu computadora:** Node 20+, Chrome actualizado, `npm install`, carpeta de perfil fuera del repo, `config/empresa.ejemplo.json` → `config/empresa.local.json`. Abre Chrome (modo `cdp`) e **inicia sesión tú** en el portal. No abras el formulario de emisión todavía.
Criterio: Chrome abierto con sesión, puerto 9222 activo (`http://127.0.0.1:9222/json/version` responde en tu equipo).

**Fase 2 — Observación (solo lectura)** — guía detallada para Windows con dos vías (consola de Chrome o Playwright con perfil separado): `docs/fase-2-observacion-portal-real.md`
1. En esa sesión abre a mano el formulario de factura **sin emitir**.
2. `node bin/observar.mjs --empresa=config/empresa.local.json`
3. Revisa la salida: nº de controles, *sin localizador único*, *CAPTCHA*, *shadow DOM*, *marcos*, y la lista «NUNCA se tocarán».
4. Revisa `observaciones/*.json` antes de compartir nada (pueden aparecer etiquetas con el nombre de tu empresa).
Criterio de parada: los campos que necesitamos no aparecen (shadow DOM cerrado, canvas, iframes inaccesibles) o hay CAPTCHA en el formulario → la vía es inviable o requiere otro enfoque; se documenta y se detiene.

**Fase 3 — Construcción del mapeo (manual, asistida)**
1. Copia `observaciones/*.mapeo-borrador.json` → `mapeo.local.json` (ignorado por git).
2. Rellena `dato` con rutas de `config/datos-ficticios.json`; completa `dominios_permitidos` con los dominios **reales** observados.
3. Para cada paso confirma el localizador contra el portal y pon `verificado: true`. Añade pasos `clic_seguro` solo para abrir pestañas/secciones (con `motivo`). Los controles ambiguos exigen `ambiguo_aprobado: true` **después** de comprobar que no envían nada.
Criterio: `node bin/ejecutar.mjs …` no se niega a correr (la validación pasa).

**Fase 4 — Ejecución en seco (datos ficticios, parada obligatoria)**
`node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=mapeo.local.json --datos=config/datos-ficticios.json`
Responde `si` a la confirmación de identidad, sigue las instrucciones manuales. Al final verás «DETENIDO». **Revisa visualmente el formulario, no pulses Emitir, descarta el borrador y cierra.**
Criterio de éxito: campos llenados y verificados, `emitió: NO`, sin errores. Anota las **solicitudes bloqueadas** que imprime: si el portal necesitaba un POST legítimo (p. ej. consulta de NIT) para llenar, aparecerá ahí; se decide caso por caso si permitirlo en `permitir_post` (nunca rutas de emisión).

**Fase 5 — Sesión y estabilidad** (detalle en `docs/gestion-sesion-sat.md`): (a) `node bin/medir-sesion.mjs …` sin tocar la ventana, varias veces, para medir el cierre por inactividad (hipótesis 20–30 min, no confirmada) y ver **cómo se manifiesta** (alimenta el bloque `sesion` del mapeo); (b) provocar un cierre a mitad de una ejecución, iniciar sesión tú en el portal oficial y comprobar pausa → verificación → reconciliación → reanudación; (c) repetir 3 veces y observar si cambian ids/etiquetas. Medir con el resumen (`registros/<alias>/*.resumen.json`: fases autenticación/llenado/espera).

**Fase 6 — Varias empresas:** dos perfiles/puertos distintos (`empresa-a` 9222, `empresa-b` 9223), cada uno con **su** sesión iniciada a mano; ejecutar la misma prueba en cada uno, por separado. Verificar que ninguna ejecución toca la sesión de la otra.

### Criterios de viabilidad (decisión al final)
| Métrica | Viable si… |
|---|---|
| Campos llenados y verificados sin intervención | ≥ 90 % de los campos del documento tipo |
| Tiempo por documento (auto + manual) | claramente menor que llenarlo a mano (se mide en el resumen) |
| Errores de localizador entre 3 ejecuciones | 0 sin tocar el mapeo |
| Sesión | dura lo suficiente para un lote razonable, o se reanuda a mano sin perder lo hecho |
| CAPTCHA / verificación humana en el formulario | ausente, o solo al iniciar sesión |
| POST legítimos necesarios para llenar | ninguno, o pocos, de lectura y claramente no de emisión |

## 5. ¿Mismo mecanismo con varias empresas? (evaluación preliminar)
**Diseño:** una empresa = un alias + un Chrome con **su propio perfil** + **su propio puerto** + su carpeta de registros; sesión iniciada a mano por quien tenga acceso a esa empresa. `validarAislamiento` rechaza dos empresas con el mismo alias, puerto, perfil o carpeta de registros; un candado por perfil impide dos ejecuciones simultáneas; la confirmación manual de identidad evita llenar en la cuenta equivocada. **Comprobado:** dos perfiles de Chrome no comparten cookies (autoprueba).
**Lo que NO se hará:** guardar contraseñas, reutilizar una sesión para otra empresa, cambiar de empresa «por debajo» en la misma sesión sin confirmación humana, ni almacenar sesiones en el repositorio o en Supabase.
**Incógnitas (requieren el portal y a ti):** (a) cómo accede una misma persona a varias empresas en el portal (¿una cuenta con varias, o cuentas distintas?), (b) si el portal muestra el contribuyente activo de forma legible para leerlo y compararlo automáticamente con el alias (hoy solo hay confirmación manual), (c) límites de sesiones simultáneas, (d) si los términos de uso de SAT permiten esta automatización y quién debe autorizarla en cada empresa — **no lo hemos revisado y debe verificarlo una persona responsable antes de usarlo con empresas de terceros**.
**Conclusión provisional:** técnicamente es viable aislar las empresas con este diseño; la viabilidad real depende de (a)–(d) y de la Fase 2.

## 6. Verificaciones que requieren Chrome en una computadora (no se pudieron hacer aquí)
- [ ] **Chrome real en tu equipo:** versión y que `--remote-debugging-port` funcione con un `--user-data-dir` propio; que `observar` se conecte (la autoprueba usó Chromium de Playwright, no tu Chrome).
- [ ] **Modo `perfil`** con `channel: "chrome"` en ventana visible: que abra, que puedas iniciar sesión y que el portal no se comporte distinto por el navegador controlado.
- [ ] **Inicio de sesión manual** en el portal (incluye cualquier CAPTCHA/verificación): flujo, duración de la sesión y qué la cierra.
- [ ] **Estructura real del formulario:** etiquetas accesibles, ids estables, selects nativos vs. componentes personalizados, autocompletado de NIT, iframes, shadow DOM cerrado, canvas, pestañas/pasos (resultado de `observar`).
- [ ] **POST legítimos de lectura** que el formulario necesite (consulta de NIT, catálogos): ver «solicitudes bloqueadas».
- [ ] **Service workers y WebSockets** del portal (la red de solo lectura no los intercepta).
- [ ] **Ventanas emergentes / nuevas pestañas**, descargas, diálogos del portal.
- [ ] **Qué ocurre al pulsar «Guardar borrador»** (no lo pulsa la prueba; solo saber si existe y si genera algo en SAT).
- [ ] **Expiración de sesión** y reanudación; **recarga** a mitad del llenado; ver la lista completa en `docs/gestion-sesion-sat.md` §9 (tiempo real, manifestación del cierre, ¿conserva SAT el borrador?, volver al formulario tras el login).
- [ ] **Estabilidad** de etiquetas/ids entre días y tras cambios del portal.
- [ ] **Varias empresas:** acceso, perfil/puerto por empresa, y lectura del contribuyente activo.
- [ ] **Términos de uso de SAT / autorización** para automatizar (persona responsable).
- [ ] **Windows:** rutas con espacios, antivirus/políticas que bloqueen el puerto de depuración, PowerShell vs. CMD.

## 7. Plantilla para anotar resultados (por ejecución)
| Fecha | Empresa (alias) | Fase | Pasos auto / manuales | Tiempo auto / manual | Errores | Solicitudes bloqueadas | ¿Emitió? | Observaciones |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | NO | |

## 8. Reglas que no se rompen
No se emite, certifica ni envía nada · datos ficticios · sin credenciales en código, chat ni repositorio · sin Supabase alojado · sin certificadores privados · sin tocar `main` ni desplegar · `fel/app/` queda aislado.
