# Etapa 1 — Solo comprobar contra el formulario real (procedimiento para revisar JUNTOS)

> **ESTADO: la Etapa 1 está autorizada, pero este procedimiento se revisa antes de ejecutar nada. NO ejecutes ningún comando de la sección 4 hasta que lo hayamos revisado.**
> Esta autorización **no permite llenar formularios** (Etapa 2 bloqueada), ni Vista Previa, guardar, certificar o emitir. `main` no se toca y no se despliega nada.

## 1. Qué hace exactamente `--solo-comprobar`
Resuelve cada localizador del mapeo en el formulario real (¿existe?, ¿es único?, ¿está visible/habilitado/editable?, ¿existe la opción pedida en la lista?) y **no hace nada más**.
| No hace | Cómo se garantiza |
|---|---|
| Escribir en campos, elegir opciones, marcar casillas, **salir de campos (blur)**, hacer clic | Cada acción que modifica algo (`fill`, `selectOption`, `setChecked`, `blur`, `click`) está precedida por su salida de solo-comprobar; una prueba estática lo exige y el ensayo contra la simulación verifica que el modelo de AngularJS, los campos y la tabla quedan **idénticos** (0 campos `ng-dirty`). Ni siquiera existe en el motor otra acción de interacción (teclas, arrastrar, hover…). |
| Enviar peticiones propias | El motor no tiene ningún paso que las envíe. Playwright solo **lee** el estado de la página. |
| Pedir o guardar contraseñas, cookies, tokens o datos fiscales | No hay ningún paso de credenciales; el registro no guarda valores, cookies ni cabeceras. |
| Dejar progreso o libro de emisiones | En este modo no se escriben (probado). |
Contra el portal real el programa **se niega a correr** salvo con `FEL_AUTORIZACION_SAT=si` y `FEL_ETAPA_AUTORIZADA=etapa1` (la etapa 2 exige otro valor; una no autoriza a la otra).

## 2. Cómo funciona la conexión con Chrome (y sus efectos reales)
1. **Tú** abres un **segundo Chrome** (perfil de prueba separado en `%USERPROFILE%\fel-poc\perfiles\empresa-a`) con un puerto de depuración **solo local** (`127.0.0.1:9222`; el programa rechaza cualquier otra dirección). **Tú** inicias sesión **a mano** y abres el formulario. Tu Chrome habitual no se toca ni se cierra.
2. El programa se **conecta** a ese puerto (`connectOverCDP`), elige **la única pestaña** cuya página sea del menú de SAT (si hay varias, te pide `--pestana=N` y solo muestra host y ruta), busca el **iframe** del formulario (host + ruta, y el host del iframe debe estar en la lista de dominios permitidos) y comprueba los localizadores. Al terminar **suelta** la conexión; no cierra tu Chrome.
3. Efectos que debes conocer (honestos):
   - **Es otra sesión SAT** (otro perfil, otro inicio de sesión). **No sabemos** si SAT cierra la sesión que tengas abierta en tu Chrome habitual. Termina antes lo que tengas pendiente allí.
   - Mientras Playwright está conectado, **todas las peticiones de ese perfil pasan por el filtro de la guardia de red** y Playwright **desactiva el caché del navegador**. Termina al desconectar (segundos).
   - El puerto de depuración está abierto en tu equipo mientras ese Chrome siga abierto: **ciérralo al terminar** (sección 4, paso 7).
   - Playwright ejecuta lecturas dentro de la página (no escribe). Si el portal detecta herramientas de automatización o se comporta distinto, **no lo sabemos**; por eso la sesión es de un perfil de prueba.
   - El perfil de Chrome guarda **localmente** la sesión que inicies: al terminar, **bórralo** (paso 8).

## 3. Qué se registra (y qué no)
Se escribe en `registros\empresa-a\<fecha>.jsonl` y `<fecha>.resumen.json` (solo en tu equipo; no se envía a ninguna parte):
- por paso: **id, tipo, modo (auto/manual), milisegundos, resultado y un texto fijo** (p. ej. «comprobado sin escribir (receptor.nit)» — la *clave* del dato, nunca su valor);
- **navegaciones** (host + ruta saneada: sin `?parámetros`, sin `;jsessionid`, números largos y tokens como `:id`), estado de la sesión (códigos), **lecturas XHR permitidas** (método + host + ruta saneada) y **solicitudes bloqueadas** (ídem);
- tiempos por fase y el resultado final.
**Nunca:** valores de campos, contraseñas, cookies, tokens, cabeceras, cuerpos de peticiones, ni el texto de la página.

## 4. Comandos exactos (PowerShell) — NO EJECUTAR hasta revisar juntos
**Paso 0 — código validado y verificación local (sin SAT).** Con el ZIP de la rama `fel-fase-1-0` que te entregaré (comprueba su SHA-256), sobre la carpeta existente (conserva `node_modules`):
```powershell
Get-FileHash "$env:USERPROFILE\Downloads\NEXA-FEL-PoC-fel-fase-1-0-XXXXXXX.zip" -Algorithm SHA256     # debe coincidir con el que te doy en el chat
Expand-Archive -Path "$env:USERPROFILE\Downloads\NEXA-FEL-PoC-fel-fase-1-0-XXXXXXX.zip" -DestinationPath C:\fel-poc -Force
cd C:\fel-poc\NEXA-FEL-PoC\fel\poc-sat
npm.cmd install
npm.cmd run huellas              # todas «OK» (la nº 2 está retirada)
npm.cmd run verificar:chrome     # debe terminar con: pass 28 · 32/32 · 25/25 · «las 3 baterías pasaron»
```
**Paso 1 — abrir el Chrome de prueba (perfil separado, puerto local).**
```powershell
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome                                                    # debe mostrar la ruta de chrome.exe
$perfil = "$env:USERPROFILE\fel-poc\perfiles\empresa-a"
Start-Process $chrome -ArgumentList "--remote-debugging-port=9222","--user-data-dir=`"$perfil`"","--no-first-run","--no-default-browser-check"
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/version).StatusCode      # debe mostrar 200 (no pegues el contenido)
```
**Paso 2 — a mano, en ESA ventana:** inicia sesión en la Agencia Virtual, abre el formulario de Factura Electrónica en la pestaña **«Datos Generales»** y **no toques nada más** (no escribas, no pulses nada).
**Paso 3 — configuración de la empresa (alias y puerto).**
```powershell
Copy-Item config\empresa.ejemplo.json config\empresa.local.json
Get-Content config\empresa.local.json                      # debe decir: "alias": "empresa-a", "modo": "cdp", "cdp": "http://127.0.0.1:9222"
```
**Paso 4 — autorización de la Etapa 1 (solo en esta ventana de PowerShell) y ejecución.**
```powershell
$env:FEL_AUTORIZACION_SAT = "si"; $env:FEL_ETAPA_AUTORIZADA = "etapa1"
node bin\ejecutar.mjs --empresa=config\empresa.local.json --mapeo=config\mapeo.sat-preliminar.json --datos=config\datos-ficticios-lineas.json --solo-comprobar
```
El programa te hará **dos preguntas** y nada más: (1) «¿La sesión abierta en Chrome corresponde a la empresa «empresa-a»? (si/no)» → `si` + Enter solo si es tu sesión de prueba; (2) «Abre tú mismo el formulario… y pulsa Enter» → Enter cuando el formulario esté abierto. Si dice que hay varias pestañas candidatas, repite con `--pestana=N`.
**Paso 5 — leer el resultado.** Copia **toda** la salida de la consola. Los archivos están en `registros\empresa-a\`.
**Paso 6 — retirar la autorización de esta ventana.**
```powershell
Remove-Item Env:FEL_AUTORIZACION_SAT, Env:FEL_ETAPA_AUTORIZADA
```
**Paso 7 — cerrar el Chrome de prueba** (cierra su ventana; así se cierra el puerto de depuración).
**Paso 8 — borrar el perfil de prueba** (guarda localmente la sesión que iniciaste):
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\fel-poc\perfiles\empresa-a"
```
**Para detenerlo en cualquier momento:** `Ctrl+C` en PowerShell (no se escribió ni se pulsó nada en el portal) y cierra el Chrome de prueba.

## 5. Cuándo SE DETIENE (fail-closed) y qué significa
El programa para en el **primer** problema; no sigue con el resto.
| Señal | Qué ocurre | Qué hacer |
|---|---|---|
| **Falta un localizador** (`no encontró ningún elemento`) | Error en ese paso; se detiene | Enviarme la salida; el portal cambió o el mapeo estaba mal |
| **Control ambiguo** (`es ambiguo: coincide con N`) | Error; se detiene | Idem |
| **Sesión perdida o sin iniciar** | Estado `sesion_perdida`; **no espera ni reanuda** | Volver a empezar desde el paso 2 |
| **Cualquier solicitud bloqueada por la guardia** (escritura, o lectura a un dominio no permitido, p. ej. `felav02`, o con ruta de emisión/guardado) | Estado `detenido_por_alerta`; muestra método + host + ruta saneada | Es el resultado buscado: lo revisamos antes de nada; **no se permite nada automáticamente** |
| **Diálogo del portal** (aviso/confirmación) | Se descarta (nunca se acepta) y se detiene | Contarme qué texto genérico mostraba |
| **Iframe ausente o de otro host**, dominio no permitido | Se detiene sin tocar nada | Enviarme la salida |
| **Sin autorización por entorno** (variables ausentes o de otra etapa) | «Se niega a correr»; no se conecta | Revisar el paso 4 |
Resultado **bueno**: 15 pasos, 0 errores, `estado final: detenido`, `solicitudes de red bloqueadas: 0`, `emitió: NO`; el paso del nombre del receptor aparece como «no comprobable en frío» (es normal: ese campo solo aparece tras escribir CF).
**Posible falso positivo:** el propio portal podría enviar una petición en segundo plano que la guardia bloquee (p. ej. un aviso periódico a otro dominio). Aun así se detiene y lo registra, y eso es información útil: no se «arregla» permitiéndolo sin revisión.

## 6. Qué me envías
La salida completa de la consola y el archivo `…resumen.json` (sin valores; revísalo antes). **No envíes** el perfil de Chrome ni capturas de pantalla del formulario.

## 7. Límites y lo que NO está probado
Todo esto se ensayó solo contra la **simulación** (incluido un ensayo del comando exacto con un Chrome local y el mapeo real tal cual). **Contra el portal real no se ha ejecutado nada.** Quedan sin comprobar: el comportamiento del portal ante una sesión de Chrome conectada por depuración, si abrir esta sesión cierra la otra, y que los localizadores coincidan en vivo (justamente lo que la Etapa 1 averigua). La Etapa 2 sigue bloqueada.
