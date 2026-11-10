# Fase 2 — Prueba controlada de llenado contra una página AngularJS simulada

> **No se conectó al portal de SAT, no hay datos fiscales reales, no se emitió nada, no se tocó `main`, no hay despliegue.** La página (`tests/fixture/sat-angular-simulado.html`) usa **AngularJS 1.5.8 real** (la versión observada) y reproduce los atributos observados: `ng-model` (`datosGenerales.tipoDte`, `moneda`, `tipoIdentificacion`, `nitReceptor`, `resultadoNIT.nombre`, `det.*`), `ng-repeat="det in detalleFactura"`, `name` con índice (`Cantidad{{$index}}`…), `ng-pattern`/`ng-required`, debounce en cantidad, total calculado y deshabilitado, y los botones con `ng-click` (`validarInformacion()`, `guardarBorrador()`, `eliminarItem()`, `agregarItem()`, `mostrarModalImpuestos()`). **Es una reconstrucción mía a partir de atributos, no el portal**: sus tiempos, mensajes y reglas son inventados.
> Se ejecuta con `node tests/simulacion-angular.mjs` (también en la CI): **10/10 casos**. El **mapeo preliminar real** (`config/mapeo.sat-preliminar.json`) se ejecuta sin cambiar ni un localizador (una prueba lo exige).

## Resultados verificables
| # | Qué se pidió | Resultado | Cómo se comprueba |
|---|---|---|---|
| 1 | Tipo de documento y moneda | ✅ `seleccionar` por `ng-model` (`select[ng-model="datosGenerales.tipoDte"]`, `…moneda`) con opciones de `ng-options` | el modelo de AngularJS contiene «Factura de prueba A» / «GTQ-Quetzal» |
| 2 | Campos del receptor | ✅ radio NIT por etiqueta, NIT por `ng-model` (solo el visible), dirección; el nombre devuelto (`resultadoNIT.nombre`, mismo modelo en 3 controles) se lee solo del visible | modelos `tipoIdentificacion=NIT`, `nitReceptor=CF`, `direccionReceptor`, `resultadoNIT.nombre` |
| 3 | Cantidad, descripción, precio, descuentos | ✅ por `name`+etiqueta HTML (`Cantidad0`, `Descripcion0` input —no el select oculto—, `PrecioUnitario0`, `Descuento0`) | valores en DOM y en `det` del scope |
| 4 | Actualización de los modelos AngularJS | ✅ `fill`/`selectOption`/`setChecked` disparan los eventos que AngularJS escucha; el modelo se actualiza (incluido el debounce de 150 ms de la cantidad) | `scope.detalleFactura[0]` = `{Cantidad:"2", PrecioUnitario:"125.50", Descuento:"10", Total:"241.00"…}` y clase `ng-dirty` |
| 5 | Lectura del total calculado | ✅ `leer` sobre `Total0` (deshabilitado) con **reintento de la lectura** hasta que el modelo asíncrono se actualiza; con `espera_ms:0` falla (prueba de que el reintento hace falta) | total 241.00 = 2×125.50−10 |
| 6 | Errores de validación | ✅ `verificar_ausente` (clase `ng-invalid` visible) falla con «N elemento(s) visible(s) de error de validación»; `esperar_visible` puede exigir un mensaje; cantidad «abc» y descuento > subtotal se detectan | mensaje «Cantidad no válida» visible, `ng-invalid` en el campo, ejecución detenida (estado `interrumpido`) |
| 7 | Bloqueo absoluto de Vista Previa, guardado y emisión | ✅ ver abajo | 0 POST en el servidor |
**Bloqueo (punto 7):** (a) clic a «Vista Previa», «Guardar borrador», «Eliminar item» y «Emitir» **rechazado** aunque el plan lleve `ambiguo_aprobado` y `permitir_envia_formulario` (la guardia lee el control real: texto, `title`, `ng-click` → `validarInformacion`, `guardarBorrador`, `eliminarItem`); (b) un plan con esos textos como localizador **ni siquiera pasa la validación**; (c) «Editar impuestos» y «Agregar item» exigen aprobación humana (con ella «Agregar item» solo suma una línea: conteo 1→2); (d) aunque algo pulsara desde fuera del ejecutor, **la red de solo lectura aborta el POST** y la vista previa no se abre, y el botón «Emitir» (que solo existe tras la vista previa) queda inalcanzable; (e) **control negativo**: sin la guardia, el mismo clic sí envía `POST /api/vista-previa` y abre la vista previa.

## Lo que la prueba encontró y corrigió en la PoC
- **Error mío en `verificar_ausente`:** pasaba una función a `evaluateAll`, la excepción se tragaba y el paso daba siempre «sin errores» (el caso feliz pasaba por la razón equivocada). Lo destapó la prueba negativa; ahora no se traga errores.
- **Pasos nuevos:** `salir_del_campo` (evento blur: la página puede consultar al salir del campo), `verificar_ausente`, estrategia `clase`, `leer` con reintento.
- **Matiz del blur:** al llenar el campo siguiente, el NIT pierde el foco solo y la consulta ocurre; `salir_del_campo` sirve para provocarla *antes* de leer el nombre.
- La guardia ahora incluye `ng-click` en la clasificación de un clic.

## Limitaciones que quedan para una prueba real (no se pueden verificar con la simulación)
1. **La simulación no es el portal:** mensajes, clases y momentos de validación, debounce, textos de las listas y reglas (`esAccionConsulta`, `inhabilitaDCIVA`…) son inventados o desconocidos. Hay que repetir esta batería contra el portal real, con aprobación, en seco.
2. **La consulta del NIT:** aquí es local (`$timeout`). En el portal es probablemente una petición de red; **nuestra guardia bloquea los POST** y puede impedir que aparezca el nombre del receptor. Se mide con sat-2d (método y ruta, sin cuerpos) antes de decidir nada.
3. **Validaciones que solo ocurren al pulsar «Vista Previa»** (`validarInformacion()`): **nunca las veremos**, porque ese botón está prohibido. Solo se detectan errores que la página muestra mientras se llena. Esto es un límite de diseño, no un fallo.
4. **No sabemos cómo marca el portal los errores** (¿`ng-invalid`, mensajes propios, ventanas?): `ng-invalid` es genérico de AngularJS; hay que observar un error real (a mano) para localizarlo.
5. **Leer modelos de AngularJS:** la prueba usa `angular.element(...).scope()`, que solo existe si la página no desactivó la información de depuración (habitual en producción). En el portal real solo se verifican valores del DOM y el total calculado, no el modelo.
6. **Entrada de datos:** `fill` escribe de golpe y dispara `input`; si el portal usa máscaras, formato de moneda o manejadores de teclas, el valor podría no quedar como se espera (la PoC lo detecta al releer el campo, pero no lo resuelve; escribir tecla a tecla no está permitido todavía).
7. **Fecha de emisión** (campo de solo lectura con calendario), **tipo de documento** (decisión tuya; cambia las secciones) y **opciones de las listas** (en la simulación son inventadas; en el portal una contiene datos personales y no se capturan).
8. **Varias líneas:** solo se probó «Agregar item» simulado (conteo 1→2). El patrón del portal (sufijo, reindexado al eliminar) sigue sin comprobarse.
9. **Impuestos:** sin campos observados; el diálogo no se simuló.
10. **Sesión real, conexión con Chrome real, tiempos y términos de uso de SAT:** sin cambios respecto a lo ya documentado; nada de esto se prueba con una página local.
