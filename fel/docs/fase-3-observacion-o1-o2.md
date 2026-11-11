# Observación pasiva O-1 y O-2 (antes de decidir la prueba real 2A)

Base: `d060938` + estos cambios, rama `fel-fase-1-0`. **Etapa 2 real NO habilitada. Playwright y el ejecutor NO intervienen en O-1 ni en O-2.** O-1 y O-2 los hace una persona en su propio Chrome; yo solo preparé y probé las herramientas en una simulación local. No se entró a SAT ni se usaron cookies, tokens o credenciales.

## 1. Qué se entrega

| Pieza | Archivo | Para qué |
|---|---|---|
| Fragmento 4 de consola (O-1) | `fel/poc-sat/consola/observar-consola-4.js` | Lista manejadores de eventos y nombres de funciones del formulario (solo lectura) |
| Analizador O-1 | `bin/analizar-o1.mjs` (+ `src/o1o2.mjs`) | Convierte la salida del fragmento en un veredicto VERDE/AMARILLO/ROJO/INCOMPLETO |
| Analizador O-2 | `bin/analizar-o2.mjs` | Convierte el registro de red en reposo en un veredicto |
| Plantillas | `config/o2-registro.ejemplo.csv`, `config/o1-aprobadas.ejemplo.json` | Formato del registro O-2 y lista de funciones aprobadas |

**SHA-256 del fragmento 4 (10 134 bytes, saltos de línea LF):**
`e737dae654d1bdbc541f1d0df18880b670b3e64b50378219327a9d31e2c95c88`
Se publica también en `VERSION.txt` del ZIP y `npm run huellas` lo compara. **No abras ni guardes el archivo con el Bloc de notas antes de comprobar la huella** (puede cambiar los saltos de línea y el SHA).

## 2. Qué lee y qué no lee el fragmento 4

Lee: atributos `ng-*` y `on*` del DOM (solo los **nombres de las funciones** que llaman), `getEventListeners()` (la API de la consola de DevTools: tipos de evento y nombres de las funciones que invocan los manejadores), `jQuery._data(el,"events")` (tipos, espacio de nombres, selector delegado, funciones), y la estructura de scopes y watchers de AngularJS (nombres de funciones del scope, expresión simple de cada watcher y funciones que llama su código).

**No** hace: clics, escritura, enfoque, eventos artificiales, peticiones de red; no usa cookies, almacenamiento local, tokens, cabeceras ni `$http`; no ejecuta funciones de la página; no escribe en el portapapeles ni crea variables globales; no modifica el DOM. **No lee** valores de campos, casillas marcadas, textos de opciones, contenido de celdas ni los valores de los watchers. Los literales de texto dentro de expresiones salen como «…» y los números largos o correos como `[REDACTADO]`.

### Resultado de las pruebas en simulación local (AngularJS 1.5.8 + jQuery 3.7.1 reales, sin SAT)

| Prueba | Resultado |
|---|---|
| Identifica `ng-blur`/`ng-focus`/`ng-change` y los nombres de función sin sus literales | OK |
| Ve manejadores nativos (`getEventListeners`), de jQuery (propios y delegados en `document`), `ajaxSend`, funciones del scope (`guardarBorrador`, `emitir`…) y un watcher que llama a `$http.post` | OK |
| Detecta, por el código de un manejador, llamadas a `fetch` y `navigator.sendBeacon` que nunca se ejecutan | OK |
| La salida no contiene valores de campos, textos de opciones, literales sensibles ni números largos | OK |
| **Pasivo:** DOM, modelos AngularJS, foco, scroll y cookies idénticos antes/después; **0 eventos** (20 tipos vigilados en captura); **0 peticiones**; 0 POST; ningún manejador de la página se ejecutó; sin variables globales | OK |
| Control negativo: un fragmento malo (que enfoca, dispara un evento y hace un `fetch`) **sí** hace saltar esos detectores | OK |
| Fuera de DevTools (sin `getEventListeners`) y sin jQuery: degrada sin error y avisa | OK |
| Dentro de un iframe, como el portal: describe el marco del formulario y no toca el menú | OK |
| Análisis estático del código (sin comentarios): ningún `click/focus/blur/dispatchEvent/fetch/XMLHttpRequest/sendBeacon/$http/cookie/almacenamiento/setAttribute/.value/…` | OK |
| Analizador sobre la salida simulada: ROJO, nombra las funciones y no filtra datos sensibles | OK |

Baterías completas tras estos cambios: unitarias 38/38 (6 nuevas: analizadores y análisis estático del fragmento) · navegador 32/32 · simulación 47/47 (7 nuevas de O-1).

## 3. O-1 paso a paso (Windows + Chrome)

Prerrequisitos: el ZIP descomprimido; Node instalado; Chrome **sin extensiones activas** (usa un perfil limpio o una ventana de invitado con el inicio de sesión hecho por ti). La sesión la inicias **tú, a mano**. **No escribas ni pulses nada en el formulario** durante todo el procedimiento.

1. En PowerShell, dentro de `fel\poc-sat`, comprueba la huella:
   ```powershell
   (Get-FileHash consola\observar-consola-4.js -Algorithm SHA256).Hash.ToLower()
   ```
   Debe ser exactamente `e737dae654d1bdbc541f1d0df18880b670b3e64b50378219327a9d31e2c95c88`. Si no coincide, **no lo uses**.
2. Inicia sesión en SAT por tu cuenta y abre el formulario FEL. Espera a que termine de cargar y **no lo toques**.
3. Pulsa F12 y ve a la pestaña **Console**.
4. En el selector de contexto de la consola (arriba a la izquierda, dice `top`) elige el marco del formulario: el que contiene `felav.c.sat.gob.gt` (no el menú `farm3…`).
5. Chrome bloquea pegar en la consola la primera vez: escribe `allow pasting`, pulsa Enter, y ahora sí.
6. Abre `consola\observar-consola-4.js` con un visor **sin guardar** (p. ej. `Get-Content consola\observar-consola-4.js | Set-Clipboard` en PowerShell), pega el contenido en la consola y pulsa Enter.
7. Debe aparecer `NEXA-O1: listo (N controles; getEventListeners disponible…)` y una línea larga `NEXA-O1 {…}`. Si dice «NO disponible» o hay un error rojo, **detente** y avisa.
8. Clic derecho sobre la línea `NEXA-O1 {…}` → **Copy string contents**. Pégalo en un archivo nuevo `registros\o1\o1.txt` (carpeta ignorada por git). Abre el archivo y comprueba a ojo que solo hay nombres (controles, funciones, tipos de evento).
9. Cierra DevTools sin tocar la página y cierra la sesión de SAT por ti mismo.
10. Analiza (esto solo lee el archivo, no usa navegador ni red):
    ```powershell
    node bin\analizar-o1.mjs --entrada=registros\o1\o1.txt --tramo=2A
    ```
    Código de salida: 0 VERDE, 3 AMARILLO, 1 ROJO o INCOMPLETO, 2 error de uso. Para el tramo 2B usa `--tramo=2B` (incluye el NIT).
11. Para cada función «desconocida» (AMARILLO) una persona revisa **qué hace** (puede mirar su código en la pestaña Sources, solo leyendo) y, si es puramente local (cálculos, limpiar campos locales), la anota en un archivo `aprobadas.json` (modelo: `config/o1-aprobadas.ejemplo.json`) con la nota de por qué. Repite el análisis con `--aprobadas=aprobadas.json`. **Nunca se aprueba una función que guarde, envíe, consulte por red o emita.**

## 4. O-2 paso a paso: cinco minutos de red sin interactuar

Misma sesión y mismo Chrome sin extensiones. Evita que Windows apague la pantalla y deja la **pestaña visible y en primer plano** (Chrome ralentiza los temporizadores de las pestañas ocultas).

1. Abre el formulario, F12 → pestaña **Network**. Marca **Preserve log**, activa el filtro **All** y, en el encabezado de la tabla, clic derecho → activa las columnas **Method** y **Domain**.
2. Espera hasta que la página cargue por completo y la lista deje de crecer. Pulsa el icono de **limpiar** (⊘). Anota la hora: ese es el **segundo 0**.
3. **No toques nada durante 300 segundos**: sin mover el ratón sobre el formulario, sin desplazarte, sin escribir, sin cambiar de pestaña.
4. Pasados los 300 s, **sin abrir ninguna fila**, transcribe cada fila en `registros\o2\o2.csv` con el formato de `config/o2-registro.ejemplo.csv`: `segundo,metodo,host,ruta,tipo`. El **segundo** lo lees de la columna **Time** o, si no, estimas con la barra de tiempo; el **tipo** es el de la columna Type (`xhr`, `fetch`, `document`, `script`, `websocket`…). La **ruta se copia sin `?consulta`**.
5. Si no apareció ninguna fila, el archivo debe decir `# sin solicitudes en 300 s`.
6. Cierra DevTools y la sesión de SAT.
7. Analiza:
   ```powershell
   node bin\analizar-o2.mjs --entrada=registros\o2\o2.csv --duracion=300
   ```

## 5. Qué se puede registrar y qué no (O-1 y O-2)

| Sí | No |
|---|---|
| Nombres de funciones | Valores de campos, NIT, DPI, nombres, direcciones, teléfonos, correos |
| Tipos de evento (`blur`, `change`, `ng-change`…) | Textos de opciones de listas, mensajes de la página |
| Métodos HTTP | Cookies, tokens, cabeceras (`Authorization`, `Cookie`…) |
| Host y ruta **sin** `?consulta` ni `#` ni identificadores largos | Cuerpos de solicitud o respuesta (pestañas Payload/Response/Preview) |
| Veces y segundos | Archivos HAR (llevan cookies y cabeceras), capturas de pantalla con datos, copias de la consola con datos |

El analizador vuelve a sanear las rutas (quita consulta y segmentos con aspecto de token o identificador). Si por error copias algo sensible, **borra el archivo** y repite.

## 6. Criterios para aceptar los resultados

**O-1 aceptable** solo si se cumplen todos:
- Veredicto **no es INCOMPLETO** (se ejecutó en el marco correcto, con `getEventListeners`, AngularJS con información de depuración, y cada campo de la lista cerrada aparece exactamente una vez).
- **Ningún ROJO**: ningún manejador de los campos de la lista cerrada, ningún manejador global de `input/change/focus/blur/keyup…` o `ajax*`, y ningún watcher llama a algo con nombre de guardar, enviar, emitir, certificar, firmar, anular, `$http`, `fetch`, XHR, `sendBeacon`, WebSocket o almacenamiento.
- Todo AMARILLO está **revisado por una persona** y clasificado como puramente local, y queda en `aprobadas.json`.
- Las funciones del scope con nombre de guardado/emisión pueden existir, pero **ningún manejador de los campos las invoca**.
- Si los nombres vienen ofuscados (código minificado) y no se puede explicar qué hace cada manejador, **no es aceptable**: se exige O-3.

**O-2 aceptable** solo si:
- Veredicto **no es INCOMPLETO** y **ningún ROJO**: ningún POST/PUT/PATCH/DELETE, ningún host distinto de `felav.c.sat.gob.gt`/`farm3.sat.gob.gt` (un host nuevo, p. ej. `felav02`, se decide aparte, no se aprueba aquí), ninguna ruta con guardar/emitir/certificar/enviar/anular.
- Cada AMARILLO (solicitud dinámica con la página en reposo, periódica o canal persistente) está identificado como lectura (GET) a un host listado y una persona decidió que es aceptable (p. ej. mantenimiento de sesión propio del portal). Una solicitud periódica **sigue siendo un hallazgo** aunque se apruebe la ruta.

**Decisión conjunta:** la 2A solo puede pasar a autorización si B1 (condiciones de uso) está cerrado **y** O-1 es aceptable **y** O-2 es aceptable, y se recomienda O-3 (2A manual asistida) antes del robot. Un ROJO o un INCOMPLETO en cualquiera **detiene** la autorización.

## 7. Riesgos de estas herramientas

| ID | Riesgo | Mitigación |
|---|---|---|
| R1 | Manejadores añadidos **después** de la carga o de forma perezosa (p. ej. al primer foco) no aparecen | O-3 (observar al ir campo a campo) y repetir O-1 tras interactuar solo si una persona decide hacerlo |
| R2 | Código minificado: funciones anónimas o con nombres cortos que no dicen nada | `llama_a` lee el código del manejador; si sigue sin explicar, se exige revisión manual en Sources u O-3 |
| R3 | `getEventListeners` solo existe en la consola de DevTools y solo ve el marco seleccionado | El analizador marca INCOMPLETO si falta o si el marco no es `felav…` |
| R4 | No se pueden enumerar temporizadores (`setTimeout/setInterval`) | O-2 cubre cinco minutos; los temporizadores más largos escapan (mismo límite que la ventana final de la 2A) |
| R5 | Errores al transcribir O-2 a mano | El analizador valida el formato; una segunda persona puede revisar |
| R6 | Extensiones de Chrome añaden manejadores o tráfico | Perfil limpio o invitado sin extensiones |
| R7 | La sesión puede caducar o el portal puede sondear mientras está en reposo | Es información valiosa: se registra, no es un fallo |
| R8 | Pegar código en la consola de una sesión iniciada | Comprobar el SHA-256 antes de pegar; el fragmento es de solo lectura y está verificado por pruebas y análisis estático; cualquier cambio invalida la huella |
| R9 | Los analizadores solo clasifican por nombre: un efecto con nombre inocente no se vería | Por eso AMARILLO exige revisión humana y O-3 sigue siendo recomendada |
| R10 | Cansancio o prisa al revisar AMARILLOS | Revisar de a uno y anotar el motivo |

## 8. Lo que sigue (no ocurre sin vuestra decisión)

Ejecutar O-1 y O-2 por vuestra cuenta, pasarme **solo** los veredictos y los nombres de funciones/rutas (nada más), y revisarlos juntos con los criterios del §6. Nada se ejecuta contra SAT por mi parte y la Etapa 2 real sigue sin habilitar.
