# O-1 mínimo (fragmento 5): solo tipos de evento y posibles mecanismos de autoguardado

Base: `95b3b3a` + estos cambios, rama `fel-fase-1-0`. **No se entró a SAT. Etapa 2 real y llenado automatizado NO habilitados. El fragmento 5 no se ha ejecutado contra el portal; solo contra simulaciones locales.**

## 1. Contexto

- O-2 (hecho a mano por vosotros): cinco minutos con DevTools abierto y **ninguna solicitud**, ni en Fetch/XHR ni en All. Eso indica que, **en reposo y durante esos cinco minutos**, el portal no sondea ni guarda por su cuenta. **No** demuestra nada sobre lo que ocurre al **editar** un campo, al **salir** de la página, ni tras más de cinco minutos; y solo vale si la grabación ya estaba activa cuando el formulario terminó de cargar (lo que cargó antes no se ve).
- El fragmento 4 (revisado) registra nombres de funciones. Esta versión mínima **no registra ningún nombre**: solo contadores y etiquetas fijas.

## 2. Qué es el fragmento 5

Archivo `consola/observar-consola-5.js` — **SHA-256 `23370b6be63f73efda47c9811700d84570b98c20f0fb57a0f793e9772b9364f1`** (12 015 bytes, saltos de línea LF; se publica también en `VERSION.txt` y lo comprueba `npm run huellas`).

**Registra únicamente:**
1. Tipos de evento (`change`, `blur`, `focus`, `keyup`, `click`, `beforeunload`, `visibilitychange`, `ajaxSend`…) con manejadores, contados por origen (nativo, jQuery, atributos `ng-*`) y por **clase** de control (texto, lista, radio/casilla, botón, formulario, otro) y por ventana/documento/cuerpo.
2. Para cada evento, qué **categorías de posible mecanismo** aparecen en el código de sus manejadores (leyendo su texto, sin ejecutarlo, y siguiendo hasta 3 niveles las funciones de los scopes de AngularJS que invocan): `http`, `envio_beacon`, `almacenamiento`, `temporizador`, `metodo_escritura`, `palabra_guardado`, `navegacion`.
3. A nivel de página: número de watchers de AngularJS (y cuántos son profundos, y cuántos contienen cada categoría), cuántas funciones de scope tienen un nombre con palabra de guardado/envío (solo el **número**), formularios (total, con método POST, con `ng-submit`), `meta refresh`, y si un service worker controla la página.
4. **Para los 8 campos de la lista cerrada** de la Etapa 2, lo mismo por campo, bajo **etiquetas fijas definidas en el propio fragmento** (`nit_receptor`, `direccion_receptor`, `tipo_linea0`, `cantidad0`, `descripcion0`, `precio0`, `descuento0`, `otros_descuentos0`). Decisión de diseño que conviene confirmar: el fragmento compara atributos del portal con esa lista interna para saber a qué campo pertenece cada manejador, pero **no copia ningún nombre del portal**. Sin esto no se podría distinguir si el riesgo está en un campo que la 2A escribe o en otro.

**No registra:** nombres de funciones, de campos, de variables ni de scopes; ids; selectores; `ng-model`; títulos; textos; valores; NIT; datos personales o fiscales; cookies; tokens; cabeceras; URL, host o rutas. Lo único textual que sale es «O-1 mínimo» y los números de versión de AngularJS y jQuery.

**No hace:** no ejecuta funciones del formulario (usa `Function.prototype.toString` y descriptores de propiedades, sin invocar getters); no modifica el DOM; no dispara ni crea eventos; no enfoca; no hace solicitudes; no instala interceptores ni observadores; no usa temporizadores ni deja procesos; no crea variables globales; no usa el portapapeles. Las únicas funciones que invoca son las de las propias herramientas: `getEventListeners` (DevTools), `jQuery._data` y `angular.element(…).scope()`, que solo leen.

## 3. Pruebas (solo simulación local, AngularJS 1.5.8 + jQuery 3.7.1 reales)

| Prueba | Resultado |
|---|---|
| **Esquema cerrado de la salida:** toda clave y todo texto de la salida pertenece a una lista fija; ningún nombre, valor, selector ni dato de la página aparece (se comprueban además cadenas concretas) | OK |
| Página limpia con la estructura de la lista cerrada (con y sin jQuery) → **VERDE** | OK |
| Variantes detectadas **sin ejecutarlas**: `$http.post` en el cambio de un campo, `sendBeacon`, handler de `beforeunload`, watcher con `$http.put`, función de guardado resuelta por nombre dentro del scope, temporizador, `meta refresh`, formulario POST, handler de `visibilitychange`, consulta en el `blur` del NIT (AMARILLO en 2A, ROJO en 2B) | OK (12/12 con el veredicto esperado) |
| **No ejecuta ni modifica ni instala:** DOM, modelos, foco, scroll y cookies idénticos; 0 eventos; 0 peticiones; **0 temporizadores, 0 observadores, 0 listeners nuevos, 0 `dispatchEvent`**; `fetch`, `XMLHttpRequest.open/send` y `sendBeacon` siguen siendo los nativos; ninguna variable global nueva; ninguna función de la página se ejecutó | OK |
| Control negativo: un fragmento malo (con temporizador, listener, observador, dispatch y reemplazo de `fetch`) **sí** hace saltar esos espías | OK |
| Sin `getEventListeners` (fuera de DevTools) → INCOMPLETO, nunca VERDE | OK |
| Analizador por línea de comandos (`bin/analizar-o1m.mjs`) sobre la variante con beacon: código 1 e informe sin nombres | OK |
| Análisis estático del código del fragmento (sin el bloque de patrones, que solo puede contener expresiones regulares): sin `click/focus/blur/dispatchEvent/fetch/XMLHttpRequest/sendBeacon/$http/almacenamiento/setTimeout/setInterval/observadores/addEventListener/setAttribute/.value/…` | OK |

Baterías completas: unitarias **40/40** · navegador **32/32** · simulación **53/53**.

**Error encontrado y corregido durante la prueba:** la primera versión daba falsos ROJO en una página limpia, porque el patrón de «palabra de guardado» (`sync`, `emit`, `submit`) coincidía con el código **propio de AngularJS** (`$evalAsync`, `$emit`, `$submitted`) en los manejadores de `blur` de `ng-model`. Se afinó el patrón (`\bsync\b`, `emitir|emisi`, `\bsubmit(?!ted)`…) y se mantiene la detección de todas las variantes peligrosas. Lección: los patrones por texto pueden dar falsos positivos con el propio framework del portal; en el portal real esperad algún AMARILLO/ROJO que habrá que explicar a mano.

## 4. Veredictos del analizador

`node bin/analizar-o1m.mjs --entrada=registros\o1m\o1m.txt --tramo=2A` (o `2B`). Códigos de salida: 0 VERDE, 3 AMARILLO, 1 ROJO o INCOMPLETO, 2 error de uso.

- **ROJO:** en los campos de la lista cerrada (el NIT solo cuenta en 2B), o en manejadores globales de edición (`input/change/blur/focus/key…`), o en manejadores de salida de la página (`beforeunload`, `unload`, `pagehide`, `visibilitychange`), o en watchers de AngularJS, aparece `http`, `envio_beacon`, `almacenamiento`, `metodo_escritura`, `palabra_guardado` o `navegacion`. (El de salida cuenta como ROJO porque **cerrar la pestaña después de la prueba podría guardar los datos ficticios**.)
- **AMARILLO:** temporizadores en manejadores o watchers; manejadores de salida sin esas categorías; eventos `ajax*` globales de jQuery; formularios POST; `meta refresh`; service worker; categorías peligrosas en controles fuera de la lista cerrada o en el NIT durante 2A (el fragmento no puede distinguirlos de otros campos de texto).
- **INCOMPLETO:** sin `getEventListeners`, AngularJS sin información de depuración, jQuery sin `_data`, lectura truncada, contexto que no es un marco de `sat.gob.gt`, o algún campo de la lista cerrada que no aparece exactamente una vez.
- **VERDE:** no se vio ningún mecanismo en lo que el fragmento puede leer. **No es una garantía de ausencia de autoguardado.**

## 5. Limitaciones

1. Solo ve manejadores presentes en el momento de la lectura: los que se añadan después (p. ej. al primer foco) o el código cargado de forma perezosa no aparecen.
2. Los temporizadores solo se detectan si su código está visible en un manejador o watcher; no se pueden enumerar los temporizadores activos.
3. Clasifica por **texto del código**: el código minificado u ofuscado (`t.p(…)` en vez de `$http.post(…)`) puede ocultar un mecanismo, y las palabras de guardado dan falsos positivos (AMARILLO/ROJO que habrá que explicar).
4. Sin nombres no se puede saber **qué** función causa un hallazgo; para investigarlo hace falta el fragmento 4 (con nombres de funciones) o revisión manual en Sources, con una decisión explícita aparte.
5. No ve efectos que dependan de valores o respuestas del servidor, ni los de funciones fuera de los scopes de AngularJS.
6. Solo lee un marco: hay que elegir en la consola el del formulario (`felav…`); el analizador marca INCOMPLETO si no es de `sat.gob.gt`.
7. `getEventListeners` solo existe en la consola de DevTools.

## 6. Riesgos

| ID | Riesgo | Mitigación |
|---|---|---|
| R1 | Falso VERDE por código ofuscado o manejadores perezosos | VERDE no autoriza nada por sí solo; se combina con O-2 y con una 2A manual asistida (O-3) |
| R2 | Falsos ROJO/AMARILLO (palabras de guardado en código del framework) | Revisión humana de cada hallazgo; el fragmento 4 identifica funciones si hace falta |
| R3 | Pegar código en la consola de una sesión iniciada | Comprobar el SHA-256 antes; solo lectura demostrada por pruebas y análisis estático; no hay interceptores ni procesos |
| R4 | Contexto equivocado (menú en vez del marco) | El analizador lo detecta (INCOMPLETO) |
| R5 | Cerrar la pestaña después puede disparar un autoguardado de salida | Se marca ROJO si hay manejadores de salida con mecanismos; no escribir nada en el formulario antes |
| R6 | Extensiones de Chrome que añadan manejadores | Perfil limpio o invitado sin extensiones |
| R7 | Los datos de la salida podrían revelar estructura del formulario | Solo contadores y etiquetas fijas; el esquema cerrado está comprobado por prueba |
| R8 | Interpretar O-2 (cinco minutos sin solicitudes) como prueba de que no hay autoguardado al editar | No lo es: solo cubre reposo y esa ventana |

## 7. Procedimiento de prueba real controlada — **NO EJECUTADO; requiere autorización nueva y explícita de «O-1 mínimo» (independiente de la Etapa 2)**

**Precondiciones**
1. Autorización escrita para ejecutar O-1 mínimo en el portal (quién, cuándo, qué commit del ZIP). No autoriza la Etapa 2.
2. ZIP descomprimido; comprobar la huella:
   ```powershell
   (Get-FileHash consola\observar-consola-5.js -Algorithm SHA256).Hash.ToLower()
   ```
   Debe ser `23370b6be63f73efda47c9811700d84570b98c20f0fb57a0f793e9772b9364f1`. Si no coincide, **no usar**.
3. Chrome con perfil limpio o invitado, **sin extensiones**. Inicio de sesión **manual**, sin credenciales en ningún archivo ni en el chat.
4. Un formulario FEL **recién abierto y sin tocar**: no escribir, no pulsar, no seleccionar nada antes, durante ni después.

**Pasos**
1. Abrir el formulario FEL y esperar a que cargue por completo. No interactuar con él.
2. F12 → **Console**. En el selector de contexto (`top`), elegir el marco que contiene `felav.c.sat.gob.gt`.
3. Si Chrome lo pide, escribir `allow pasting` + Enter.
4. Copiar el contenido de `consola\observar-consola-5.js` (sin guardarlo con otro programa: `Get-Content consola\observar-consola-5.js | Set-Clipboard`), pegar en la consola y Enter. **Una sola vez.**
5. Debe aparecer `NEXA-O1M: listo (N elementos; getEventListeners disponible…)` y una línea `NEXA-O1M {…}`. Si dice «NO disponible» o aparece un error rojo → **parar** (no reintentar a ciegas).
6. Clic derecho en la línea `NEXA-O1M {…}` → **Copy string contents** → pegar en `registros\o1m\o1m.txt`. Abrirlo y comprobar a ojo que solo hay claves, contadores y etiquetas fijas (si ves cualquier texto que parezca un nombre o un dato, **borra el archivo y avisa**).
7. Cerrar DevTools **sin tocar la página**. Cerrar la sesión de SAT como se hace normalmente (sin haber escrito nada en el formulario).
8. Analizar (solo lee el archivo, sin red):
   ```powershell
   node bin\analizar-o1m.mjs --entrada=registros\o1m\o1m.txt --tramo=2A
   ```

**Criterios de parada inmediata (en cualquier punto):** error rojo en la consola; «NO disponible»; contexto equivocado; cualquier solicitud, aviso o cambio visible en la página; cualquier duda.

**Qué compartir:** el veredicto y la salida del analizador (no contienen nombres ni datos). Si queréis compartir la línea JSON, hacedlo solo tras la revisión del paso 6.

**Interpretación y decisión**
- INCOMPLETO → repetir con el contexto/herramientas correctos; no se decide nada.
- ROJO → **la 2A no se autoriza**; se investiga con revisión manual o con el fragmento 4 (decisión explícita aparte).
- AMARILLO → revisión humana de cada punto; se aprueba solo lo que sea claramente local o ajeno a los campos de la 2A.
- VERDE → **no basta por sí solo**: se exige además O-2 limpio (hecho), condiciones de uso cerradas (B1) y, recomendado, una 2A manual asistida (O-3) con DevTools abierto antes del robot.

La Etapa 2 real sigue requiriendo su propia autorización (plantilla D.6 del documento de diseño).
