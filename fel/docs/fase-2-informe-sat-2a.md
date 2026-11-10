# Fase 2 — Informe de la observación sat-2a (portal real, solo lectura)

> Se trabajó únicamente con los datos de `sat-2a.json` y de la observación 1. No se ejecutó ninguna acción en SAT; `main` no se tocó; no hay despliegue; **Vista Previa, guardado y emisión siguen bloqueados**.
> AngularJS **1.5.8** + jQuery. Estructura idéntica a la observación 1 (211 controles, mismo orden); 30 visibles (antes 31: solo cambió el botón de ayuda «Precio Unitario» del encabezado de la tabla).

## 0. Aviso de privacidad (acción tuya)
El archivo `sat-2a.json` contiene **una opción de la lista del establecimiento (c5) con el nombre completo del contribuyente**. Mi redacción automática solo detecta números largos y correos, no nombres. Qué se hizo y qué debes hacer:
- **En el repositorio no se guardó** ese texto (búsqueda del nombre en todo el repo: 0 coincidencias); la clasificación guarda solo `opciones_n`, nunca el texto, y hay una prueba que lo exige.
- El archivo ya está en el almacén de adjuntos de esta conversación; no puedo borrarlo desde aquí. Si te importa, bórralo de tu lado y **no reenvíes ese archivo**.
- **Causa y corrección:** el fragmento 2 capturaba el texto de las opciones de las listas pequeñas. Se creó el **fragmento 3** (`consola/observar-consola-3.js`): **no captura el texto de ninguna opción** salvo las de una lista expresamente permitida (vacía por defecto) y no recorta el `ng-model`. **No vuelvas a usar el fragmento 2.**
- Para la observación sat-2d usa solo el fragmento 3 (SHA-256 `723934b081e3c16d5f6d80c303a1213303162650fd5b0c06977c913f240032e2`).

## 1. Resultado frente a la observación 1
| Medida | Resultado |
|---|---|
| Controles sin identificador en la obs. 1 | 113 |
| Ahora localizables de forma estable (por `ng-model` único) | **95** |
| Siguen sin localizador estable | **18** (9 botones de acción que deben seguir sin tocarse + 9 campos ocultos con `ng-model` repetido o recortado) |
Los 18: **botones** c53 (Editar impuestos), c54 (Eliminar item), c55 (Agregar item), c72, c120, c128, c201, c204 y los desplegables de frases c65–c67: son acciones bloqueadas, **no necesitan localizador**. **Campos ocultos:** c23 (comparte `resultadoNIT.nombre` con c26 y c29), y 8 de complementos (c77, c79, c134, c136, c138, c141 y 2 más) cuyos modelos colisionan porque el fragmento 2 los recortó a 80 caracteres (el fragmento 3 lo corrige; solo importa si se usan esas pestañas).
Por estabilidad (211): `estable_ng_model` 111 · ayudas 51 (no se pulsan) · rol+texto (pestañas) 24 · `sin_identificador` 11 (los botones de arriba) · `ng_model_repetido` 9 · radios por etiqueta 3 · `ng_model` en fila 2 (`det.Total`).
Detalle completo: `poc-sat/analisis/obs2a/clasificacion.md` y `comparacion-obs1.md`.

## 2. Lo que enseña el `ng-model` y el `ng-click`
- **Prácticamente todos los campos tienen `ng-model`**, un identificador del código de la página (`datosGenerales.nitReceptor`, `datosGenerales.direccionReceptor`, `datosGenerales.tipoDte`, `datosGenerales.moneda`, `det.Cantidad`…) mucho más estable que el DOM.
- **La «ayuda adyacente» de la obs. 2 se equivocó en varios controles** (p. ej. atribuyó «Editar impuestos» a las columnas de la tabla): ya no se usa; manda `ng-model`.
- **Acciones reales por `ng-click`:** «Vista Previa» = `validarInformacion()`; «Editar impuestos» = `mostrarModalImpuestos($index)`; «Eliminar item» = `eliminarItem($index,1)…`; «Agregar item» = `agregarItem()`. La guardia trata `validar…` y `eliminar…` como **prohibidos**.
- **Líneas:** `ng-repeat="det in detalleFactura"`. Los modelos `det.*` se repiten por línea: con una sola línea son únicos, con varias hay que acotar por fila o usar el `name` con índice (`Cantidad0`, `Cantidad1`…).
- **Consulta del NIT:** `resultadoNIT.nombre` aparece en 3 controles (uno deshabilitado y dos ocultos): al escribir un NIT la página trae el nombre → **probable petición de red** (nuestra guardia bloquea los POST).
- **Impuestos:** hay una casilla oculta `det.afecto` y el diálogo de «Editar impuestos»; no hay campos de impuestos en el DOM.
- **Selectores CSS comprobados (29):** los 10 `name` de la línea 0 dan total=1 (visibles los esperados: `select[name=Descripcion0]`, `CodigoProducto0`, `Observaciones0` ocultos), `input[name^="Cantidad"]` = 1 (hay una sola línea), 3 radios, 18 pestañas (1 visible), 125 `ng-model` (19 visibles), 34 `ng-repeat`, 11 `ng-click`, 0 `legend`.

## 3. Campos confirmados (existen en el portal real, único, identificador estable)
*Confirmado en la observación ≠ comprobado en una ejecución*: todos siguen con `verificado:false` hasta una prueba en seco aprobada.
| Campo | Localizador (Playwright / estrategia) | Evidencia |
|---|---|---|
| Radio NIT / CUI / ID EXTRANJERO | `getByLabel('NIT',{exact:true})` (idem los otros); comparten `ng-model datosGenerales.tipoIdentificacion`; el `name` numérico se descarta | etiqueta única; 3 radios |
| **NIT del receptor** | `input[ng-model="datosGenerales.nitReceptor"]:visible` → `{ng_model, tag:input, visible:true}` | `ng-model` único; requerido |
| **Dirección del receptor** | `input[ng-model="datosGenerales.direccionReceptor"]:visible` | `ng-model` único |
| Tipo de línea (Bien/Servicio) | `select[name="BienOServicio0"]` | CSS total=1, visible |
| Cantidad | `input[name="Cantidad0"]` | CSS total=1, visible |
| Descripción (texto libre) | `input[name="Descripcion0"]` (existe también un `select` oculto con el mismo name: el tag es obligatorio) | CSS 1 y 1 |
| Precio unitario | `input[name="PrecioUnitario0"]` | CSS total=1 |
| Descuento / Otros descuentos | `input[name="Descuento0"]` / `input[name="OtrosDescuento0"]` | CSS total=1 |
| Total de línea (solo lectura) | `input[name="Total0"]` (deshabilitado) | CSS total=1 |
| Código de producto / Observaciones (ocultos) | `select[name="CodigoProducto0"]`, `input[name="Observaciones0"]` | CSS total=1, ocultos |
| Tipo de documento / Moneda (listas visibles) | `select[ng-model="datosGenerales.tipoDte"]`, `…moneda` | `ng-model` único; opciones por decidir |
| Pestañas | `getByRole('tab',{name:'Datos Generales',exact:true})` | único; candidato a **indicador de sesión activa** |
Además hay `ng-model` único para ~95 controles de las pestañas ocultas (complementos, exportación, traslado, medios de pago, boletos aéreos, etc.): localizables cuando esas pestañas se necesiten.

## 4. Pendientes
1. **Consulta del NIT** (red): ¿escribir el NIT dispara un POST y de qué ruta? Bloquea el llenado del receptor. → sat-2d + medición de red.
2. **Fecha de emisión:** campo de solo lectura con calendario → dejar la fecha por defecto de la página (recomendado) o diseñar el calendario.
3. **Tipo de documento:** decisión de negocio (cambia las secciones visibles); la lista de la cuenta es corta (7 entradas con «Seleccione»).
4. **Impuestos:** no hay campos; probablemente automáticos según el tipo de documento; solo habría que observar el diálogo si se necesita editarlos.
5. **Varias líneas:** diseño por conteo (ver doc de la obs. 1 §5), pendiente de comprobar al implementarlo.
6. Indicador de **sesión activa** (pestaña «Datos Generales») y cómo se ve el cierre de sesión.
7. Seguimos sin revisar los **términos de uso de SAT** (persona responsable).

## 5. ¿Hace falta sat-2b, sat-2c o sat-2d?
| Observación | ¿Ahora? | Motivo |
|---|---|---|
| **sat-2b** (agregar un ítem a mano) | **No** | Para una factura de **una línea** el mapeo ya está completo con CSS comprobados. Para varias líneas se implementará con conteo antes/después y se verificará en la prueba controlada. Solo si se decide implementar varias líneas ya. |
| **sat-2c** («Editar impuestos» abierto) | **No por ahora** | No hay campos de impuestos que localizar y es probable que el impuesto sea automático. Solo si necesitas editar impuestos. |
| **sat-2d** (elegir NIT y escribir un NIT de prueba o CF) | **Sí, es la única que desbloquea el receptor** | Revela qué cambia al identificar al receptor y, junto a la **medición de red** (método y ruta en DevTools → Network → Fetch/XHR, sin cabeceras ni cuerpos), si hace falta permitir una petición de lectura. Usa el **fragmento 3** y la misma revisión previa del JSON (sin nombres). |

## 6. Cambios en la PoC (todo probado: 22 tests + 30 casos con Chrome + CI)
- `config/mapeo.sat-preliminar.json` v2 (receptor + línea 0 con evidencia; `lectura_solo`; `confirmados_en_observacion`; `pendientes`; `bloqueados`; `comprobaciones_obs2a`; `decision_sat2b`). Sigue **no ejecutable** (`verificado:false`). `comprobar_css` no cambia.
- Estrategia `ng_model` y opción `visible:true` (`:visible`) en los localizadores; `nombre` + `tag`.
- Guardia: `validar…`, `eliminar…`, «previa» prohibidos; `ng-click` se clasifica junto al texto.
- `bin/comparar-analisis.mjs` (comparación entre observaciones) y análisis con `ng-model`/`ng-repeat`/`ng-click`.
- Fragmento 3 (opciones solo bajo lista permitida; `ng-model` hasta 200 caracteres). Fragmento 2 intacto pero **retirado de uso**.
