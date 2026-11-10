# Fase 2 — Análisis de la observación 1 del formulario FEL real (solo datos del archivo)

> **Aviso (tras sat-2a):** el fragmento 2 (`observar-consola-2.js`) captura el texto de las opciones de las listas, y una de ellas contenía datos personales. **No lo vuelvas a usar**; las observaciones siguientes usan el fragmento 3. Ver `docs/fase-2-informe-sat-2a.md`.

> **Qué es esto:** análisis de `observacion-fel.json` (obtenido con el fragmento de solo lectura `consola/observar-consola.js`, SHA-256 `368a6a5dc32760fe1b85be87cdcc9c051c7c28966f4c32e3c61971eacea483a1`). **Se trabajó únicamente con los datos del archivo**; no se tocó SAT, no se llenó nada, no se pulsó nada, no se guardó ni se emitió, no se modificó `main`.
> **Corrección de premisa:** la página real usa **AngularJS y jQuery** (`frameworks: angular, jquery`). **No** se detectó JSF/PrimeFaces en los controles: 0 componentes `ui-*`, 0 `<form>`, sin `ViewState`. La extensión `.jsf` de la URL (`/fel-web/privado/vistas/fel.jsf`) solo indica la tecnología del servidor. Las heurísticas de PrimeFaces del observador quedan inofensivas aquí (conteos en 0), y la guía de la fase 2 debe leerse con esta corrección.
> Detalle completo de los **211 controles** (uno por fila, con sección, visibilidad, función, estabilidad, localizador y acción): `fel/poc-sat/analisis/obs1/clasificacion.md` (y `.json`). Mapeo preliminar: `fel/poc-sat/config/mapeo.sat-preliminar.json`. Datos ficticios con líneas: `config/datos-ficticios-lineas.json`.

## 1. Panorama
Host observado: `felav.c.sat.gob.gt` · ruta `/fel-web/privado/vistas/fel.jsf` · 1 marco (principal) · sin CAPTCHA, sin shadow DOM · 3 textos redactados (marcadores con números).
**211 controles: 31 visibles, 180 ocultos** (el formulario se observó en el estado inicial; casi todo lo demás aparece al activar opciones). De los 18 `role=tab` solo «Datos Generales» está visible.

| Estabilidad del identificador | Controles |
|---|---|
| sin_identificador | 113 |
| ayuda_sin_localizador_propio | 51 |
| estable_rol_texto | 24 |
| estable_nombre_indexado | 18 |
| estable_etiqueta (name numérico descartado) | 3 |
| ambiguo_nombre_repetido | 2 |

| Sección | Controles |
|---|---|
| Datos Generales | 68 |
| Exportaciones | 20 |
| Traslado de Mercancías | 18 |
| Referencias de Constancias | 16 |
| Referencias de Notas de crédito y débito | 14 |
| Boletos Aéreos | 13 |
| Medios de Pago | 11 |
| Exportación provisional | 10 |
| Organizaciones Políticas | 10 |
| Espectáculos Públicos | 9 |
| Factura Especifica › Referencia boleta despacho IDP | 6 |
| Abonos de Factura Cambiaria | 5 |
| Cobro por cuenta ajena | 3 |
| Factura Especifica › Almacenamiento y Galonaje | 3 |
| Factura Especifica › Información Gas Licuado de Petróleo GLP | 2 |
| Factura Especial | 1 |
| Factura Especifica | 1 |
| Factura Especifica › Detalle de productos | 1 |

| Acción permitida (hoy) | Controles |
|---|---|
| dinámico: aparece tras una acción manual | 86 |
| ayuda: no se pulsa | 51 |
| clic_seguro (solo navegación, con verificación) | 18 |
| llenar/seleccionar/marcar (tras confirmar localizador) | 16 |
| solo lectura / deshabilitado | 14 |
| BLOQUEADA (calendario: requiere diseño aparte) | 7 |
| BLOQUEADA (ambigua/sin texto: requiere aprobación humana) | 7 |
| BLOQUEADA (desplegable personalizado: requiere diseño aparte) | 7 |
| BLOQUEADA (prohibida) | 3 |
| solo lectura (valor calculado) | 2 |

## 2. Hallazgos que cambian el diseño
1. **Casi no hay etiquetas asociadas** (`<label for>`): solo 3 controles (los radios NIT/CUI/ID EXTRANJERO) tienen etiqueta. Los localizadores por etiqueta, que era la estrategia preferida, **no sirven** para casi todo el formulario.
2. **Los botones `( ? )` de ayuda nombran el campo que los precede.** Su atributo `title` («NIT del Receptor», «Dirección del Receptor», «Fecha Emisión»…) sigue en el DOM al control al que se refiere. Sirve para **identificar** campos, no para localizarlos de forma robusta (es adyacencia, no vínculo). Confianza: media, hay que comprobarlo.
3. **Dos tipos de identificadores sí son estables:** (a) el atributo `name` con sufijo de línea en la tabla de artículos (`Cantidad0`, `PrecioUnitario0`…) y (b) `role=tab` + texto de las pestañas. Cuidado: el `name` de los radios es **numérico (`14`, `15`, `16`)**, un id interno de Angular que cambia entre cargas: **no se usa**; para los radios vale la etiqueta.
4. **113 controles no tienen ningún identificador** (sin `id`, `name`, etiqueta ni marcador). La observación 1 no capturó los atributos `ng-model`/`ng-*` de AngularJS, que normalmente son el identificador más estable; **la observación 2 los captura.**
5. **No existe ningún botón de emitir, certificar ni guardar en el DOM observado.** El último control es **«Vista Previa»** (c210). Muy probablemente la emisión está detrás de la vista previa (un diálogo que aún no existe en el DOM). Hipótesis, no confirmada. Por eso **«Vista Previa» queda prohibido** (palabra `previa` añadida a la guardia).
6. **El campo «Descripción» tiene dos modos:** `<input name="Descripcion0">` (visible, texto libre) y `<select name="Descripcion0">` (oculto, modo catálogo con `CodigoProducto0`). Mismo `name` en dos etiquetas HTML: **el localizador exige `tag`** (se añadió a la estrategia `nombre`).
7. **«Total» es calculado** (`Total0`, deshabilitado): solo se lee, nunca se escribe.
8. **«Fecha de emisión» es de solo lectura con calendario** (c1 input readonly + c2 botón calendario): no se puede `fill`; requiere un diseño propio. Hay otros 6 calendarios en pestañas ocultas.
9. **No hay `<form>` ni envío nativo:** es una aplicación Angular que habla por XHR. Consecuencia para la guardia de red: **cualquier POST (consulta de NIT, cálculo, catálogos…) se bloquea**. Si escribir un NIT dispara un POST de consulta, el llenado del receptor puede romperse: hay que medirlo (sección 6, punto 2E).
10. **Los impuestos no aparecen como campos:** solo existe el botón «Editar impuestos» (`title`, sin texto, c53), que abre algo no observado.

## 3. Estructura de «Datos Generales» (c1–c67, hipótesis por patrones del DOM)
| Subsección | Controles | Qué hay |
|---|---|---|
| Encabezado | c1–c17 | Fecha de emisión (c1–c3), 5 listas (c4–c8; c6: 6 opciones, c8: 28 opciones, las demás ocultas), casilla «Emisión en ubicación temporal» (c9) con 4 listas ocultas requeridas (c11–c14), casilla «Exportación» (c15) y lista oculta (c17) |
| Receptor | c18–c38 | Radios NIT/CUI/ID EXTRANJERO (c18–c20), **NIT** (c21, requerido), campos ocultos CUI/nombre/ID extranjero (c23–c29), **Dirección** (c30), campos ocultos de transportista (c32–c38) |
| Artículos | c39–c55 | Tabla: línea 0 con 12 controles (c40–c54) y botón «Agregar item» (c55) |
| Frases y escenarios | c56–c67 | Casillas y 7 desplegables personalizados «--- Seleccione Frase … ---» |
Las demás pestañas (Abonos de Factura Cambiaria, Referencias de Notas de crédito y débito, Exportación provisional, Exportaciones, Factura Especial, Cobro por cuenta ajena, Espectáculos Públicos, Referencias de Constancias, Boletos Aéreos, Medios de Pago, Organizaciones Políticas, Traslado de Mercancías, Factura Específica y sus 4 subpestañas) están **ocultas** y se muestran según el tipo de documento y las casillas.

## 4. Campos que pediste, con su localizador
Estado: **confirmado en la observación 1** = existe, es único en el DOM observado y su identificador parece estable; **requiere comprobación** = hace falta la observación 2 o una prueba en vivo. *Ninguno está aún comprobado en funcionamiento* (`verificado:false`).
| Tema | Campo (control) | Localizador Playwright propuesto | Estado |
|---|---|---|---|
| Receptor | Tipo de identificación NIT / CUI / ID EXTRANJERO (c18–c20) | `getByLabel('NIT', {exact:true})` (idem CUI, ID EXTRANJERO) | Confirmado en obs. 1 (único por etiqueta; el `name` numérico se descarta) |
| Receptor | NIT del receptor (c21, visible, requerido, `autocomplete=off`) | **ninguno**: sin id/name/etiqueta. Candidato: `[ng-model]` (obs. 2) | Requiere comprobación |
| Receptor | Dirección del receptor (c30, visible) | **ninguno**; candidato `[ng-model]` (obs. 2) | Requiere comprobación |
| Receptor | Nombre / CUI / ID extranjero (c23–c29, ocultos; c26 y c29 tienen `name="nombre"` repetido) | **ninguno** | Requiere comprobación (observar tras elegir el tipo de identificación a mano) |
| Artículos | Tipo de línea Bien/Servicio (c40, 3 opciones) | `locator('select[name="BienOServicio0"]')` → estrategia `nombre` + `tag:select` | Confirmado en obs. 1 |
| Artículos | Código de producto (c42, oculto) | `select[name="CodigoProducto0"]` | Confirmado, **oculto** (modo catálogo) |
| Cantidades | Cantidad (c41) | `locator('input[name="Cantidad0"]')` | Confirmado en obs. 1 |
| Descripciones | Descripción (c43 input visible / c44 select oculto) | `locator('input[name="Descripcion0"]')` y `locator('select[name="Descripcion0"]')` (tag obligatorio) | Confirmado en obs. 1; **comprobar cuál modo se muestra** |
| Precios | Precio unitario (c45) | `locator('input[name="PrecioUnitario0"]')` | Confirmado en obs. 1 |
| Descuentos | Descuento (c47) y Otros descuentos (c48) | `input[name="Descuento0"]`, `input[name="OtrosDescuento0"]` | Confirmado en obs. 1 |
| Totales | Total de la línea (c50, deshabilitado) | `input[name="Total0"]` (**solo lectura**) | Confirmado en obs. 1 |
| Artículos | Observaciones (c46), Código FEL (c51), Descripción CI (c52) — ocultos | `input[name="Observaciones0"]`, `CodigoFEL0`, `DescripcionCI0` | Confirmados, **ocultos** |
| Impuestos | **no hay campos** (solo c53 «Editar impuestos») | — | Pendiente: observación 2C |
| Encabezado | Fecha de emisión (c1 readonly + c2 calendario) | **ninguno** | Requiere diseño (calendario) y `ng-model` |
| Navegación | Pestaña «Datos Generales» (c0) | `getByRole('tab', {name:'Datos Generales', exact:true})` | Confirmado; candidato a **indicador de sesión activa** (por comprobar) |

## 5. Varias líneas de artículos (campos con sufijo numérico)
Datos observados: 11 raíces con sufijo `0` en la tabla de artículos (`BienOServicio0, CodigoProducto0, Descripcion0 (×2), PrecioUnitario0, Observaciones0, Descuento0, OtrosDescuento0, Total0, CodigoFEL0, DescripcionCI0, Cantidad0`) y 6 en Espectáculos Públicos (`numeroAutorizacion0, nombreEvento0, nombreLocalidad0, precioAdmision0, cantidadBoletos0, totalBoleto0`). **Solo existe el índice 0**: la observación 1 no permite saber cómo crece el sufijo.
Lo más probable (hipótesis): una fila por `tr.ng-scope` generada por `ng-repeat`, con sufijo = `$index`. **Por confirmar:** si es 0,1,2… consecutivo; qué pasa al eliminar una línea (¿reindexa?); si «Agregar item» agrega siempre al final; si el índice coincide con la fila.
**Diseño propuesto (no implementado):**
1. Contar líneas existentes de forma pasiva: `input[name^="Cantidad"]`.
2. Para la línea `i`: si `i` ya existe, solo llenarla; si no, **un único clic** (con aprobación humana) en «Agregar item» y esperar a que el conteo suba en 1; si no sube, **detener, nunca reintentar el clic**.
3. Localizadores con plantilla `input[name="Cantidad{i}"]`, `…PrecioUnitario{i}`, etc., y verificación de cada valor.
4. Tras un cierre de sesión, reconciliar **por conteo y por valores**: jamás volver a pulsar «Agregar item» si el conteo ya basta (evita líneas duplicadas). Esto encaja con la regla existente de la PoC (los clics no se repiten).
El análisis y la plantilla están en `mapeo.sat-preliminar.json` → `plantilla_lineas`. La observación 2B (agregar un ítem **a mano**) confirmará el patrón.

## 6. Acciones sensibles (se mantienen bloqueadas)
| Control | Motivo | Estado |
|---|---|---|
| c210 «Vista Previa» | Probable paso previo a emitir; no se usa | **PROHIBIDO** (nueva palabra en la guardia) |
| c54 «Eliminar item» y c128 «Eliminar item espectáculo» (en `title`) | Destruyen datos | **PROHIBIDO** |
| c53 «Editar impuestos» (`title`, sin texto) | Abre un diálogo no observado | **BLOQUEADO** hasta la obs. 2C |
| c55, c72, c120, c129, c201, c204 «Agregar …» | Clic no repetible | **BLOQUEADOS** (aprobación humana + conteo) |
| c2, c85, c113, c144, c155, c166, c209 (calendarios) | Componente que requiere diseño propio | **BLOQUEADOS** |
| c61–c67 «--- Seleccione Frase … ---» | Desplegables personalizados | **BLOQUEADOS** |
| 51 botones `( ? )` | Ayuda | No se pulsan |
La guardia ahora también marca como ambiguas las palabras «editar», «item» e «impuestos». Se mantienen: red de solo lectura, dominios permitidos, paso `detener` obligatorio, datos ficticios y sin credenciales.

## 7. Segunda observación (para confirmar lo que no tiene identificador único)
**Qué añade** `consola/observar-consola-2.js` (140 líneas, SHA-256 `3f953dc0597b08da9b47a829483f204251b5f912da5e78c256b1cd29195c998e`; el fragmento 1 no cambia): por control, los atributos **`ng-model`, `ng-show/hide/if/disabled/click/change/required` y `ng-repeat`** (son nombres de variables y acciones del código de la página, no datos de personas; `ng-click` revela además qué hace cada botón), la **ayuda adyacente**, la **leyenda del `fieldset`**, la **fila de la tabla**, las **opciones de las listas pequeñas** (≤30; texto con números largos o correos sale `[REDACTADO]`) y los **encabezados** (`legend`, `h1–h5`, `th`). Además **cuenta cuántos elementos coinciden con una lista cerrada de 29 selectores CSS** (`CSS_A_COMPROBAR`, al inicio del archivo: `input[name="Cantidad0"]`, `button[title="NIT del Receptor"]`, `[ng-model]`, etc.): así se *comprueban* los localizadores de la sección 4. Sigue siendo solo lectura: sin red, sin escribir, sin clics, sin valores, cookies ni tokens (hay pruebas automáticas que lo exigen).
**Antes de pegarlo**: `git pull` y verifica la huella; léelo (la lista de selectores está al principio):
```powershell
Get-FileHash consola\observar-consola-2.js -Algorithm SHA256    # 3f953dc0597b08da9b47a829483f204251b5f912da5e78c256b1cd29195c998e
```
**Estados a observar (todos con tus manos, sin guardar ni emitir; para cada uno: `F12` → Console → pegar el archivo 2 → guardar el JSON → `node bin\importar-observacion.mjs --entrada=X.json --alias=sat-2a`):**
| Alias | Estado de la página | Para qué |
|---|---|---|
| `sat-2a` | **Igual que la observación 1** (nada tocado) | `ng-model` de los 113 controles sin identificador; comprobación de los 29 selectores; opciones de c4–c8 |
| `sat-2b` | Pulsa **tú** «Agregar item» **una vez** (aparece la línea 2) | cómo crece el sufijo (`Cantidad1`…), `tr`, `ng-repeat` |
| `sat-2c` | Abre **tú** «Editar impuestos» de la línea 1 (el diálogo abierto, sin aceptar ni guardar) | campos de impuestos |
| `sat-2d` | Marca **tú** el radio NIT y escribe un **NIT de prueba/CF** (sin pulsar nada más) | si aparecen campos de nombre/dirección y si cambia la estructura |
| `sat-2e` | (opcional) Elige a mano un tipo de documento distinto | qué pestañas aparecen |
Compara pares: `node bin\comparar.mjs observaciones\<antes>.json observaciones\<despues>.json`.
**Medición de red (manual, sin código nuestro):** en DevTools → pestaña **Network**, filtro **Fetch/XHR**, mientras haces `sat-2d` (escribir el NIT) y `sat-2b` (agregar ítem), anota **solo el método y la ruta** de cada petición (no copies cabeceras, cookies ni cuerpos). Importa saber si hay **POST**: nuestra guardia los bloquea.
Antes de compartir cualquier JSON, revísalo (nombres de personas o de tu empresa no se detectan por patrón).

## 8. Puntos pendientes antes de continuar
1. Ejecutar la observación 2 (`sat-2a` mínimo) y devolver el JSON revisado.
2. **Identificar los 113 controles sin identificador** con `ng-model` (NIT, dirección, listas de encabezado, casillas).
3. **Confirmar el patrón de líneas** (`sat-2b`) y su comportamiento al eliminar (se evaluará sin pulsar «Eliminar»: solo si el usuario lo hace a mano y lo reporta).
4. **Impuestos:** localizar sus campos (`sat-2c`) o decidir si se dejan fuera de la PoC.
5. **Red:** ¿escribir un NIT o agregar una línea dispara un POST? (si sí, decidir si se permite una ruta concreta de lectura en `permitir_post`, jamás una de emisión).
6. **Calendario de fecha de emisión** (readonly): diseño aparte, o dejar el valor por defecto de la página.
7. **Listas c4–c8:** nombres y opciones (¿tipo de documento? ¿moneda?).
8. **Cómo se ve el cierre de sesión** (`campo_clave_visible`, 401, redirección) y confirmar `Datos Generales` como indicador de sesión activa.
9. **Estructura tras «Vista Previa»** (no se pulsa): se conocerá solo si la persona lo hace a mano en una fase posterior y con autorización expresa; hasta entonces **nada** pulsa ese botón.
10. Seguir pendiente lo de siempre: términos de uso de SAT y autorización para automatizar (persona responsable).
