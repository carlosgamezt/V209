# Clasificación de controles

Total: **211** controles · visibles: **31** · ocultos: **180**

**Por estabilidad del identificador**

| Valor | Controles |
|---|---|
| estable_ng_model | 111 |
| ayuda_sin_localizador_propio | 51 |
| estable_rol_texto | 24 |
| sin_identificador | 11 |
| ng_model_repetido | 8 |
| estable_etiqueta (ng-model compartido por el grupo) | 3 |
| estable_ng_model_en_fila (acotar por fila o usar name con índice) | 2 |
| estable_ng_model_solo_visible (usar :visible) | 1 |

**Por sección**

| Valor | Controles |
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

**Por acción permitida**

| Valor | Controles |
|---|---|
| dinámico: aparece tras una acción manual | 84 |
| ayuda: no se pulsa | 51 |
| clic_seguro (solo navegación, con verificación) | 18 |
| llenar/seleccionar/marcar (tras confirmar localizador) | 16 |
| solo lectura / deshabilitado | 13 |
| BLOQUEADA (calendario: requiere diseño aparte) | 7 |
| BLOQUEADA (ambigua/sin texto: requiere aprobación humana) | 7 |
| BLOQUEADA (desplegable personalizado: requiere diseño aparte) | 7 |
| solo lectura (la PoC no escribe aquí) | 5 |
| BLOQUEADA (prohibida) | 3 |

## Los 211 controles

| # | Sección / subsección | Vis. | Control | Función | Conf. función | Estabilidad | Mejor localizador | Acción |
|---|---|---|---|---|---|---|---|---|
| 0 | Datos Generales | sí | div[tab] | pestaña «Datos Generales» | alta (texto) | estable_rol_texto | rol: Datos Generales | clic_seguro (solo navegación, con verificación) |
| 1 | Datos Generales › Encabezado del documento | sí | input[textbox] | fecha de emisión (solo lectura + calendario) | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.fechaEmision | solo lectura / deshabilitado |
| 2 | Datos Generales › Encabezado del documento | sí | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: datosGenerales.fechaEmision | BLOQUEADA (calendario: requiere diseño aparte) |
| 3 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Fecha Emisión» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 4 | Datos Generales › Encabezado del documento | no | select[combobox] | clasificación del emisor (lista, oculta) | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.clasificacionEmisor | dinámico: aparece tras una acción manual |
| 5 | Datos Generales › Encabezado del documento | no | select[combobox] | establecimiento del emisor (lista, oculta; sus opciones contienen datos personales: no se registran) | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.establecimiento | dinámico: aparece tras una acción manual |
| 6 | Datos Generales › Encabezado del documento | sí | select[combobox] | tipo de documento (lista) | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.tipoDte | llenar/seleccionar/marcar (tras confirmar localizador) |
| 7 | Datos Generales › Encabezado del documento | no | select[combobox] * | modelo datosGenerales.idp.origenDespacho | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.idp.origenDespacho | dinámico: aparece tras una acción manual |
| 8 | Datos Generales › Encabezado del documento | sí | select[combobox] | moneda (lista) | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.moneda | llenar/seleccionar/marcar (tras confirmar localizador) |
| 9 | Datos Generales › Encabezado del documento | sí | input[checkbox] | casilla: emisión en ubicación temporal | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.esUbicacionTemporal | llenar/seleccionar/marcar (tras confirmar localizador) |
| 10 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Emisión en ubicación temporal» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 11 | Datos Generales › Encabezado del documento | no | select[combobox] * | modelo datosGenerales.idp.litoral | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.idp.litoral | dinámico: aparece tras una acción manual |
| 12 | Datos Generales › Encabezado del documento | no | select[combobox] * | modelo datosGenerales.idp.destinoDespacho | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.idp.destinoDespacho | dinámico: aparece tras una acción manual |
| 13 | Datos Generales › Encabezado del documento | no | select[combobox] * | modelo datosGenerales.idp.terminal | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.idp.terminal | dinámico: aparece tras una acción manual |
| 14 | Datos Generales › Encabezado del documento | no | select[combobox] * | modelo datosGenerales.idp.procedenciaIdp | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.idp.procedenciaIdp | dinámico: aparece tras una acción manual |
| 15 | Datos Generales › Encabezado del documento | sí | input[checkbox] | casilla: exportación | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.esExportacion | llenar/seleccionar/marcar (tras confirmar localizador) |
| 16 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Exportación» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 17 | Datos Generales › Encabezado del documento | no | select[combobox] | destino de la venta (lista, oculta) | alta (ng-model) | estable_ng_model | ng_model[select]: datosGenerales.destinoVenta | dinámico: aparece tras una acción manual |
| 18 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: NIT | alta (etiqueta) | estable_etiqueta (ng-model compartido por el grupo) | etiqueta: NIT | llenar/seleccionar/marcar (tras confirmar localizador) |
| 19 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: CUI | alta (etiqueta) | estable_etiqueta (ng-model compartido por el grupo) | etiqueta: CUI | llenar/seleccionar/marcar (tras confirmar localizador) |
| 20 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: ID EXTRANJERO | alta (etiqueta) | estable_etiqueta (ng-model compartido por el grupo) | etiqueta: ID EXTRANJERO | llenar/seleccionar/marcar (tras confirmar localizador) |
| 21 | Datos Generales › Receptor | sí | input[text] * | NIT del receptor | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.nitReceptor | llenar/seleccionar/marcar (tras confirmar localizador) |
| 22 | Datos Generales › Receptor | sí | button[button] | ayuda de «NIT del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 23 | Datos Generales › Receptor | sí | input[text] | nombre del receptor devuelto por la consulta (GET + preflight observado con CF); visible y editable solo cuando el NIT es CF — mismo modelo en 3 controles | alta (ng-model) | estable_ng_model_solo_visible (usar :visible) | ng_model[input]: resultadoNIT.nombre (:visible) | solo lectura (la PoC no escribe aquí) |
| 24 | Datos Generales › Receptor | no | input[text] | CUI del receptor (oculto) | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.cuiReceptor | dinámico: aparece tras una acción manual |
| 25 | Datos Generales › Receptor | no | button[button] | ayuda de «CUI del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 26 | Datos Generales › Receptor | no | input[text] | nombre del receptor devuelto por la consulta (GET + preflight observado con CF); visible y editable solo cuando el NIT es CF — mismo modelo en 3 controles | alta (ng-model) | ng_model_repetido |  | solo lectura (la PoC no escribe aquí) |
| 27 | Datos Generales › Receptor | no | input[text] | ID extranjero / pasaporte del receptor (oculto) | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.pasaporte | dinámico: aparece tras una acción manual |
| 28 | Datos Generales › Receptor | no | button[button] | ayuda de «CUI del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 29 | Datos Generales › Receptor | no | input[text] | nombre del receptor devuelto por la consulta (GET + preflight observado con CF); visible y editable solo cuando el NIT es CF — mismo modelo en 3 controles | alta (ng-model) | ng_model_repetido |  | solo lectura (la PoC no escribe aquí) |
| 30 | Datos Generales › Receptor | sí | input[text] | dirección del receptor | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.direccionReceptor | llenar/seleccionar/marcar (tras confirmar localizador) |
| 31 | Datos Generales › Receptor | sí | button[button] | ayuda de «Dirección del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 32 | Datos Generales › Receptor | no | input[text] * | modelo datosGenerales.idp.transportista.ID | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.idp.transportista.ID | dinámico: aparece tras una acción manual |
| 33 | Datos Generales › Receptor | no | button[button] | ayuda de «ID del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 34 | Datos Generales › Receptor | no | input[text] * | modelo datosGenerales.idp.transportista.Nombre | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.idp.transportista.Nombre | solo lectura / deshabilitado |
| 35 | Datos Generales › Receptor | no | button[button] | ayuda de «Nombre del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 36 | Datos Generales › Receptor | no | input[text] * | modelo datosGenerales.idp.placa | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.idp.placa | dinámico: aparece tras una acción manual |
| 37 | Datos Generales › Receptor | no | input[text] * | modelo datosGenerales.idp.numeroViaje | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.idp.numeroViaje | dinámico: aparece tras una acción manual |
| 38 | Datos Generales › Receptor | no | input[text] * | modelo datosGenerales.idp.direccionEntrega | alta (ng-model) | estable_ng_model | ng_model[input]: datosGenerales.idp.direccionEntrega | dinámico: aparece tras una acción manual |
| 39 | Datos Generales › Artículos (tabla) | no | button[button] | ayuda de «Precio Unitario» | alta (title) | ayuda_sin_localizador_propio | rol: (?) | ayuda: no se pulsa |
| 40 | Datos Generales › Artículos (tabla) | sí | select[combobox] | tipo de línea (bien/servicio) | alta (name) | estable_ng_model | nombre[select]: BienOServicio0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 41 | Datos Generales › Artículos (tabla) | sí | input[text] | cantidad | alta (name) | estable_ng_model | nombre[input]: Cantidad0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 42 | Datos Generales › Artículos (tabla) | no | select[combobox] | código de producto (catálogo) | alta (name) | estable_ng_model | nombre[select]: CodigoProducto0 | dinámico: aparece tras una acción manual |
| 43 | Datos Generales › Artículos (tabla) | sí | input[text] | descripción | alta (name) | estable_ng_model | nombre[input]: Descripcion0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 44 | Datos Generales › Artículos (tabla) | no | select[combobox] | descripción | alta (name) | estable_ng_model | nombre[select]: Descripcion0 | dinámico: aparece tras una acción manual |
| 45 | Datos Generales › Artículos (tabla) | sí | input[text] | precio unitario | alta (name) | estable_ng_model | nombre[input]: PrecioUnitario0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 46 | Datos Generales › Artículos (tabla) | no | input[text] | observaciones de la línea | alta (name) | estable_ng_model | nombre[input]: Observaciones0 | dinámico: aparece tras una acción manual |
| 47 | Datos Generales › Artículos (tabla) | sí | input[text] | descuento | alta (name) | estable_ng_model | nombre[input]: Descuento0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 48 | Datos Generales › Artículos (tabla) | sí | input[text] | otros descuentos | alta (name) | estable_ng_model | nombre[input]: OtrosDescuento0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 49 | Datos Generales › Artículos (tabla) | no | input[checkbox] | modelo det.afecto | alta (ng-model) | estable_ng_model | ng_model[input]: det.afecto | dinámico: aparece tras una acción manual |
| 50 | Datos Generales › Artículos (tabla) | sí | input[text] | total de la línea (calculado) | alta (name) | estable_ng_model_en_fila (acotar por fila o usar name con índice) | nombre[input]: Total0 | solo lectura (la PoC no escribe aquí) |
| 51 | Datos Generales › Artículos (tabla) | no | input[text] | código FEL | alta (name) | estable_ng_model | nombre[input]: CodigoFEL0 | dinámico: aparece tras una acción manual |
| 52 | Datos Generales › Artículos (tabla) | no | input[text] | descripción CI | alta (name) | estable_ng_model | nombre[input]: DescripcionCI0 | dinámico: aparece tras una acción manual |
| 53 | Datos Generales › Artículos (tabla) | sí | button[button] | Editar impuestos → mostrarModalImpuestos() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 54 | Datos Generales › Artículos (tabla) | sí | button[button] | Eliminar item → eliminarItem() | alta (ng-click) | sin_identificador |  | BLOQUEADA (prohibida) |
| 55 | Datos Generales › Artículos (tabla) | sí | button[button] | Agregar item → agregarItem() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 56 | Datos Generales › Frases y escenarios | no | input[checkbox] | modelo marcaCuentaAjena | alta (ng-model) | estable_ng_model | ng_model[input]: marcaCuentaAjena | dinámico: aparece tras una acción manual |
| 57 | Datos Generales › Frases y escenarios | no | input[checkbox] | modelo marcaEspectaculoPublico | alta (ng-model) | estable_ng_model | ng_model[input]: marcaEspectaculoPublico | dinámico: aparece tras una acción manual |
| 58 | Datos Generales › Frases y escenarios | sí | input[checkbox] | modelo marcaMediosPago | alta (ng-model) | estable_ng_model | ng_model[input]: marcaMediosPago | llenar/seleccionar/marcar (tras confirmar localizador) |
| 59 | Datos Generales › Frases y escenarios | no | input[checkbox] | modelo marcaBebida | alta (ng-model) | estable_ng_model | ng_model[input]: marcaBebida | dinámico: aparece tras una acción manual |
| 60 | Datos Generales › Frases y escenarios | no | input[checkbox] | modelo complementoRBD.mostrarComplemento | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRBD.mostrarComplemento | dinámico: aparece tras una acción manual |
| 61 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frases de Apoyo Social --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frases de Apoyo Social --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 62 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Base Legal--- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase Base Legal--- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 63 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Factura Especial --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase Factura Especial --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 64 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase ISR --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase ISR --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 65 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 66 | Datos Generales › Frases y escenarios | sí | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 67 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 68 | Abonos de Factura Cambiaria | no | div[tab] | pestaña «Abonos de Factura Cambiaria» | alta (texto) | estable_rol_texto | rol: Abonos de Factura Cambiaria ( ? ) | clic_seguro (solo navegación, con verificación) |
| 69 | Abonos de Factura Cambiaria | no | button[button] | ayuda de «Abonos de Factura cambiaria» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 70 | Abonos de Factura Cambiaria | no | input[number] | modelo abonoFactura.cantidadAbonos | alta (ng-model) | estable_ng_model | ng_model[input]: abonoFactura.cantidadAbonos | dinámico: aparece tras una acción manual |
| 71 | Abonos de Factura Cambiaria | no | input[number] | modelo abonoFactura.diasVencimiento | alta (ng-model) | estable_ng_model | ng_model[input]: abonoFactura.diasVencimiento | dinámico: aparece tras una acción manual |
| 72 | Abonos de Factura Cambiaria | no | button[button] | Agregar → agregarCantidadPagos() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 73 | Referencias de Notas de crédito y débito | no | div[tab] | pestaña «Referencias de Notas de crédito y débito» | alta (texto) | estable_rol_texto | rol: Referencias de Notas de crédito y débito ( ? ) | clic_seguro (solo navegación, con verificación) |
| 74 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Referencias de Notas de crédito y débito» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 75 | Referencias de Notas de crédito y débito | no | select[combobox] | modelo complementoNotasDC.RegimenAntiguo | alta (ng-model) | estable_ng_model | ng_model[select]: complementoNotasDC.RegimenAntiguo | dinámico: aparece tras una acción manual |
| 76 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Régimen del Documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 77 | Referencias de Notas de crédito y débito | no | input[text] | modelo complementoNotasDC.NumeroAutorizacionDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 78 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 79 | Referencias de Notas de crédito y débito | no | input[text] | modelo complementoNotasDC.NumeroAutorizacionDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 80 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 81 | Referencias de Notas de crédito y débito | no | input[text] | modelo complementoNotasDC.SerieDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoNotasDC.SerieDocumentoOrigen | dinámico: aparece tras una acción manual |
| 82 | Referencias de Notas de crédito y débito | no | input[text] | modelo complementoNotasDC.NumeroDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoNotasDC.NumeroDocumentoOrigen | dinámico: aparece tras una acción manual |
| 83 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 84 | Referencias de Notas de crédito y débito | no | input[textbox] | modelo complementoNotasDC.FechaEmisionDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoNotasDC.FechaEmisionDocumentoOrigen | solo lectura / deshabilitado |
| 85 | Referencias de Notas de crédito y débito | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: complementoNotasDC.FechaEmisionDocumentoOrigen | BLOQUEADA (calendario: requiere diseño aparte) |
| 86 | Referencias de Notas de crédito y débito | no | textarea[textbox] | modelo complementoNotasDC.MotivoAjuste | alta (ng-model) | estable_ng_model | ng_model[textarea]: complementoNotasDC.MotivoAjuste | dinámico: aparece tras una acción manual |
| 87 | Exportación provisional | no | div[tab] | pestaña «Exportación provisional» | alta (texto) | estable_rol_texto | rol: Exportación provisional ( ? ) | clic_seguro (solo navegación, con verificación) |
| 88 | Exportación provisional | no | button[button] | ayuda de «Exportación Provisional» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 89 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.LugarExpedicion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.LugarExpedicion | dinámico: aparece tras una acción manual |
| 90 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.NombreConsignatarioODestinatario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.NombreConsignatarioODestinatario | dinámico: aparece tras una acción manual |
| 91 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.DireccionConsignatarioODestinatario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.DireccionConsignatarioODestinatario | dinámico: aparece tras una acción manual |
| 92 | Exportación provisional | no | select[combobox] * | modelo complementoExportacionesProvisional.PaisConsignatario | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportacionesProvisional.PaisConsignatario | dinámico: aparece tras una acción manual |
| 93 | Exportación provisional | no | select[combobox] * | modelo complementoExportacionesProvisional.incoterm | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportacionesProvisional.incoterm | dinámico: aparece tras una acción manual |
| 94 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.OtraReferencia | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.OtraReferencia | dinámico: aparece tras una acción manual |
| 95 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.NombreExportador | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.NombreExportador | dinámico: aparece tras una acción manual |
| 96 | Exportación provisional | no | input[text] * | modelo complementoExportacionesProvisional.CodigoExportador | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportacionesProvisional.CodigoExportador | dinámico: aparece tras una acción manual |
| 97 | Exportaciones | no | div[tab] | pestaña «Exportaciones» | alta (texto) | estable_rol_texto | rol: Exportaciones ( ? ) | clic_seguro (solo navegación, con verificación) |
| 98 | Exportaciones | no | button[button] | ayuda de «Exportaciones» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 99 | Exportaciones | no | input[text] * | modelo complementoExportaciones.LugarExpedicion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.LugarExpedicion | dinámico: aparece tras una acción manual |
| 100 | Exportaciones | no | input[text] * | modelo complementoExportaciones.NombreConsignatarioODestinatario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.NombreConsignatarioODestinatario | dinámico: aparece tras una acción manual |
| 101 | Exportaciones | no | input[text] * | modelo complementoExportaciones.DireccionConsignatarioODestinatario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.DireccionConsignatarioODestinatario | dinámico: aparece tras una acción manual |
| 102 | Exportaciones | no | select[combobox] * | modelo complementoExportaciones.PaisConsignatario | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportaciones.PaisConsignatario | dinámico: aparece tras una acción manual |
| 103 | Exportaciones | no | select[combobox] | modelo complementoExportaciones.incoterm | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportaciones.incoterm | dinámico: aparece tras una acción manual |
| 104 | Exportaciones | no | input[text] | modelo complementoExportaciones.OtraReferencia | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.OtraReferencia | dinámico: aparece tras una acción manual |
| 105 | Exportaciones | no | input[text] | modelo complementoExportaciones.NombreExportador | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.NombreExportador | dinámico: aparece tras una acción manual |
| 106 | Exportaciones | no | input[text] | modelo complementoExportaciones.CodigoExportador | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.CodigoExportador | dinámico: aparece tras una acción manual |
| 107 | Exportaciones | no | input[text] | modelo complementoExportaciones.NumeroAutorizacionProvisional | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.NumeroAutorizacionProvisional | dinámico: aparece tras una acción manual |
| 108 | Exportaciones | no | button[button] | ayuda de «Número de Autorización Provisional» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 109 | Exportaciones | no | input[text] | modelo complementoExportaciones.SerieDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.SerieDocumentoOrigen | solo lectura / deshabilitado |
| 110 | Exportaciones | no | input[text] | modelo complementoExportaciones.NumeroDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.NumeroDocumentoOrigen | solo lectura / deshabilitado |
| 111 | Exportaciones | no | input[text] | modelo complementoExportaciones.NumeroDeclaracionMercancias | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.NumeroDeclaracionMercancias | dinámico: aparece tras una acción manual |
| 112 | Exportaciones | no | input[textbox] | modelo complementoExportaciones.fechaExportacion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.fechaExportacion | solo lectura / deshabilitado |
| 113 | Exportaciones | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: complementoExportaciones.fechaExportacion | BLOQUEADA (calendario: requiere diseño aparte) |
| 114 | Exportaciones | no | select[combobox] | modelo complementoExportaciones.viaTransporte | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportaciones.viaTransporte | dinámico: aparece tras una acción manual |
| 115 | Exportaciones | no | select[combobox] | modelo complementoExportaciones.aduanaSalidaCombo | alta (ng-model) | estable_ng_model | ng_model[select]: complementoExportaciones.aduanaSalidaCombo | dinámico: aparece tras una acción manual |
| 116 | Exportaciones | no | input[text] | modelo complementoExportaciones.aduanaSalida | alta (ng-model) | estable_ng_model | ng_model[input]: complementoExportaciones.aduanaSalida | dinámico: aparece tras una acción manual |
| 117 | Factura Especial | no | div[tab] | pestaña «Factura Especial» | alta (texto) | estable_rol_texto | rol: Factura Especial | clic_seguro (solo navegación, con verificación) |
| 118 | Cobro por cuenta ajena | no | div[tab] | pestaña «Cobro por cuenta ajena» | alta (texto) | estable_rol_texto | rol: Cobro por cuenta ajena | clic_seguro (solo navegación, con verificación) |
| 119 | Cobro por cuenta ajena | no | input[number] | modelo cobroCuentaAjena.cantidadCobros | alta (ng-model) | estable_ng_model | ng_model[input]: cobroCuentaAjena.cantidadCobros | dinámico: aparece tras una acción manual |
| 120 | Cobro por cuenta ajena | no | button[button] | Agregar → agregarCantidadCobros() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 121 | Espectáculos Públicos | no | div[tab] | pestaña «Espectáculos Públicos» | alta (texto) | estable_rol_texto | rol: Espectáculos Públicos | clic_seguro (solo navegación, con verificación) |
| 122 | Espectáculos Públicos | no | input[text] | número de autorización | alta (name) | estable_ng_model | nombre[input]: numeroAutorizacion0 | dinámico: aparece tras una acción manual |
| 123 | Espectáculos Públicos | no | input[text] | nombre del evento | alta (name) | estable_ng_model | nombre[input]: nombreEvento0 | dinámico: aparece tras una acción manual |
| 124 | Espectáculos Públicos | no | input[text] | nombre de la localidad | alta (name) | estable_ng_model | nombre[input]: nombreLocalidad0 | dinámico: aparece tras una acción manual |
| 125 | Espectáculos Públicos | no | input[text] | precio de admisión | alta (name) | estable_ng_model | nombre[input]: precioAdmision0 | dinámico: aparece tras una acción manual |
| 126 | Espectáculos Públicos | no | input[text] | cantidad de boletos | alta (name) | estable_ng_model | nombre[input]: cantidadBoletos0 | dinámico: aparece tras una acción manual |
| 127 | Espectáculos Públicos | no | input[text] | total del boleto (calculado) | alta (name) | estable_ng_model_en_fila (acotar por fila o usar name con índice) | nombre[input]: totalBoleto0 | solo lectura (la PoC no escribe aquí) |
| 128 | Espectáculos Públicos | no | button[button] | Eliminar item espectáculo → eliminarItemEspectaculo() | alta (ng-click) | sin_identificador |  | BLOQUEADA (prohibida) |
| 129 | Espectáculos Públicos | no | button[button] | Agregar ítem → nuevoItemEspectaculosPublicos() | alta (ng-click) | estable_rol_texto | rol: Agregar ítem | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 130 | Referencias de Constancias | no | div[tab] | pestaña «Referencias de Constancias» | alta (texto) | estable_rol_texto | rol: Referencias de Constancias ( ? ) | clic_seguro (solo navegación, con verificación) |
| 131 | Referencias de Constancias | no | button[button] | ayuda de «Refencias de Constancias» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 132 | Referencias de Constancias | no | select[combobox] | modelo complementoRefConstancia.RegimenAntiguo | alta (ng-model) | estable_ng_model | ng_model[select]: complementoRefConstancia.RegimenAntiguo | dinámico: aparece tras una acción manual |
| 133 | Referencias de Constancias | no | button[button] | ayuda de «Régimen del Documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 134 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.NumeroAutorizacionDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 135 | Referencias de Constancias | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 136 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.NumeroAutorizacionDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 137 | Referencias de Constancias | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 138 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.NumeroDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 139 | Referencias de Constancias | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 140 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.SerieDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRefConstancia.SerieDocumentoOrigen | dinámico: aparece tras una acción manual |
| 141 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.NumeroDocumentoOrigen | alta (ng-model) | ng_model_repetido |  | dinámico: aparece tras una acción manual |
| 142 | Referencias de Constancias | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 143 | Referencias de Constancias | no | input[textbox] | modelo complementoRefConstancia.FechaEmisionDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRefConstancia.FechaEmisionDocumentoOrigen | solo lectura / deshabilitado |
| 144 | Referencias de Constancias | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: complementoRefConstancia.FechaEmisionDocumentoOrigen | BLOQUEADA (calendario: requiere diseño aparte) |
| 145 | Referencias de Constancias | no | input[text] | modelo complementoRefConstancia.MontoIVAExento | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRefConstancia.MontoIVAExento | solo lectura / deshabilitado |
| 146 | Boletos Aéreos | no | div[tab] | pestaña «Boletos Aéreos» | alta (texto) | estable_rol_texto | rol: Boletos Aéreos ( ? ) | clic_seguro (solo navegación, con verificación) |
| 147 | Boletos Aéreos | no | button[button] | ayuda de «Boletos Aéreos» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 148 | Boletos Aéreos | no | input[text] | modelo complementoTurismoPasaje.NitReclutadora | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTurismoPasaje.NitReclutadora | dinámico: aparece tras una acción manual |
| 149 | Boletos Aéreos | no | button[button] | ayuda de «NIT de la reclutadora» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 150 | Boletos Aéreos | no | input[text] | modelo complementoTurismoPasaje.CuiBeneficiario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTurismoPasaje.CuiBeneficiario | dinámico: aparece tras una acción manual |
| 151 | Boletos Aéreos | no | button[button] | ayuda de «CUI del beneficiario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 152 | Boletos Aéreos | no | input[text] | modelo complementoTurismoPasaje.NombreBeneficiario | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTurismoPasaje.NombreBeneficiario | dinámico: aparece tras una acción manual |
| 153 | Boletos Aéreos | no | button[button] | ayuda de «Nombre del beneficiario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 154 | Boletos Aéreos | no | input[textbox] | modelo fechaViajeTurismoPasaje.FechaViaje | alta (ng-model) | estable_ng_model | ng_model[input]: fechaViajeTurismoPasaje.FechaViaje | solo lectura / deshabilitado |
| 155 | Boletos Aéreos | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: fechaViajeTurismoPasaje.FechaViaje | BLOQUEADA (calendario: requiere diseño aparte) |
| 156 | Boletos Aéreos | no | button[button] | ayuda de «Fecha de viaje» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 157 | Boletos Aéreos | no | input[text] | modelo complementoTurismoPasaje.PaisDestino | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTurismoPasaje.PaisDestino | dinámico: aparece tras una acción manual |
| 158 | Boletos Aéreos | no | button[button] | ayuda de «Pais de destino» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 159 | Medios de Pago | no | div[tab] | pestaña «Medios de Pago» | alta (texto) | estable_rol_texto | rol: Medios de Pago ( ? ) | clic_seguro (solo navegación, con verificación) |
| 160 | Medios de Pago | no | button[button] | ayuda de «Medios Pago» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 161 | Medios de Pago | no | select[combobox] | modelo complementoMediosPago.TipoFormaPago | alta (ng-model) | estable_ng_model | ng_model[select]: complementoMediosPago.TipoFormaPago | dinámico: aparece tras una acción manual |
| 162 | Medios de Pago | no | button[button] | ayuda de «Tipo forma de pago» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 163 | Medios de Pago | no | input[text] | modelo complementoMediosPago.NumeroTransaccion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoMediosPago.NumeroTransaccion | dinámico: aparece tras una acción manual |
| 164 | Medios de Pago | no | button[button] | ayuda de «Número de transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 165 | Medios de Pago | no | input[textbox] | modelo complementoMediosPago.FechaTransaccion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoMediosPago.FechaTransaccion | solo lectura / deshabilitado |
| 166 | Medios de Pago | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: complementoMediosPago.FechaTransaccion | BLOQUEADA (calendario: requiere diseño aparte) |
| 167 | Medios de Pago | no | button[button] | ayuda de «Fecha de transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 168 | Medios de Pago | no | input[text] | modelo complementoMediosPago.MontoTransaccion | alta (ng-model) | estable_ng_model | ng_model[input]: complementoMediosPago.MontoTransaccion | dinámico: aparece tras una acción manual |
| 169 | Medios de Pago | no | button[button] | ayuda de «Monto Transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 170 | Organizaciones Políticas | no | div[tab] | pestaña «Organizaciones Políticas» | alta (texto) | estable_rol_texto | rol: Organizaciones Políticas ( ? ) | clic_seguro (solo navegación, con verificación) |
| 171 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 172 | Organizaciones Políticas | no | select[combobox] | modelo complementoPartidoPolitico.CalidadAportante | alta (ng-model) | estable_ng_model | ng_model[select]: complementoPartidoPolitico.CalidadAportante | dinámico: aparece tras una acción manual |
| 173 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 174 | Organizaciones Políticas | no | select[combobox] | modelo complementoPartidoPolitico.TipoAporte | alta (ng-model) | estable_ng_model | ng_model[select]: complementoPartidoPolitico.TipoAporte | dinámico: aparece tras una acción manual |
| 175 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 176 | Organizaciones Políticas | no | input[text] | modelo complementoPartidoPolitico.DeclaracionProcedencia | alta (ng-model) | estable_ng_model | ng_model[input]: complementoPartidoPolitico.DeclaracionProcedencia | dinámico: aparece tras una acción manual |
| 177 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 178 | Organizaciones Políticas | no | input[text] | modelo complementoPartidoPolitico.Aporte | alta (ng-model) | estable_ng_model | ng_model[input]: complementoPartidoPolitico.Aporte | solo lectura / deshabilitado |
| 179 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 180 | Traslado de Mercancías | no | div[tab] | pestaña «Traslado de Mercancías» | alta (texto) | estable_rol_texto | rol: Traslado de Mercancías ( ? ) | clic_seguro (solo navegación, con verificación) |
| 181 | Traslado de Mercancías | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 182 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.transportista.ID | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.transportista.ID | dinámico: aparece tras una acción manual |
| 183 | Traslado de Mercancías | no | button[button] | ayuda de «ID del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 184 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.transportista.Nombre | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.transportista.Nombre | dinámico: aparece tras una acción manual |
| 185 | Traslado de Mercancías | no | button[button] | ayuda de «Nombre del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 186 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.Placa | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.Placa | dinámico: aparece tras una acción manual |
| 187 | Traslado de Mercancías | no | button[button] | ayuda de «Placa» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 188 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.DireccionProcedencia | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.DireccionProcedencia | dinámico: aparece tras una acción manual |
| 189 | Traslado de Mercancías | no | button[button] | ayuda de «Dirección de procedencia» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 190 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.consignatario.ID | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.consignatario.ID | dinámico: aparece tras una acción manual |
| 191 | Traslado de Mercancías | no | button[button] | ayuda de «ID del consignatario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 192 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.consignatario.Nombre | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.consignatario.Nombre | solo lectura / deshabilitado |
| 193 | Traslado de Mercancías | no | button[button] | ayuda de «Nombre del consignatario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 194 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.DireccionDestino | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.DireccionDestino | dinámico: aparece tras una acción manual |
| 195 | Traslado de Mercancías | no | button[button] | ayuda de «Dirección de destino» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 196 | Traslado de Mercancías | no | input[text] * | modelo complementoTrasladoMercancia.Motivo | alta (ng-model) | estable_ng_model | ng_model[input]: complementoTrasladoMercancia.Motivo | dinámico: aparece tras una acción manual |
| 197 | Traslado de Mercancías | no | button[button] | ayuda de «Motivo» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 198 | Factura Especifica | no | div[tab] | pestaña «Factura Especifica» | alta (texto) | estable_rol_texto | rol: Factura Especifica | clic_seguro (solo navegación, con verificación) |
| 199 | Factura Especifica › Detalle de productos | no | div[tab] | pestaña «Detalle de productos» | alta (texto) | estable_rol_texto | rol: Detalle de productos | clic_seguro (solo navegación, con verificación) |
| 200 | Factura Especifica › Almacenamiento y Galonaje | no | div[tab] | pestaña «Almacenamiento y Galonaje» | alta (texto) | estable_rol_texto | rol: Almacenamiento y Galonaje | clic_seguro (solo navegación, con verificación) |
| 201 | Factura Especifica › Almacenamiento y Galonaje | no | button[button] | Agregar item → complementoAyG.agregarItemLista() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 202 | Factura Especifica › Almacenamiento y Galonaje | no | input[text] * | modelo complementoAyG.marchamos | alta (ng-model) | estable_ng_model | ng_model[input]: complementoAyG.marchamos | dinámico: aparece tras una acción manual |
| 203 | Factura Especifica › Información Gas Licuado de Petróleo GLP | no | div[tab] | pestaña «Información Gas Licuado de Petróleo GLP» | alta (texto) | estable_rol_texto | rol: Información Gas Licuado de Petróleo GLP | clic_seguro (solo navegación, con verificación) |
| 204 | Factura Especifica › Información Gas Licuado de Petróleo GLP | no | button[button] | Agregar item → complementoGLP.agregarItemLista() | alta (ng-click) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 205 | Factura Especifica › Referencia boleta despacho IDP | no | div[tab] | pestaña «Referencia boleta despacho IDP» | alta (texto) | estable_rol_texto | rol: Referencia boleta despacho IDP | clic_seguro (solo navegación, con verificación) |
| 206 | Factura Especifica › Referencia boleta despacho IDP | no | input[text] | modelo complementoRBD.numeroAutorizacionDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRBD.numeroAutorizacionDocumentoOrigen | dinámico: aparece tras una acción manual |
| 207 | Factura Especifica › Referencia boleta despacho IDP | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 208 | Factura Especifica › Referencia boleta despacho IDP | no | input[textbox] | modelo complementoRBD.fechaEmisionDocumentoOrigen | alta (ng-model) | estable_ng_model | ng_model[input]: complementoRBD.fechaEmisionDocumentoOrigen | solo lectura / deshabilitado |
| 209 | Factura Especifica › Referencia boleta despacho IDP | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | estable_ng_model | ng_model[button]: complementoRBD.fechaEmisionDocumentoOrigen | BLOQUEADA (calendario: requiere diseño aparte) |
| 210 | Factura Especifica › Referencia boleta despacho IDP | sí | button[button] | Vista Previa → validarInformacion() | alta (ng-click) | estable_rol_texto | rol: Vista Previa | BLOQUEADA (prohibida) |

## Campos repetidos con sufijo numérico

| Raíz del name | Ocurrencias | Sufijos vistos | Etiquetas HTML | Visibles | Sección |
|---|---|---|---|---|---|
| BienOServicio | 1 | 0 | select | 1 | Datos Generales |
| Cantidad | 1 | 0 | input | 1 | Datos Generales |
| CodigoProducto | 1 | 0 | select | 0 | Datos Generales |
| Descripcion | 2 | 0 | input+select | 1 | Datos Generales |
| PrecioUnitario | 1 | 0 | input | 1 | Datos Generales |
| Observaciones | 1 | 0 | input | 0 | Datos Generales |
| Descuento | 1 | 0 | input | 1 | Datos Generales |
| OtrosDescuento | 1 | 0 | input | 1 | Datos Generales |
| Total | 1 | 0 | input | 1 | Datos Generales |
| CodigoFEL | 1 | 0 | input | 0 | Datos Generales |
| DescripcionCI | 1 | 0 | input | 0 | Datos Generales |
| numeroAutorizacion | 1 | 0 | input | 0 | Espectáculos Públicos |
| nombreEvento | 1 | 0 | input | 0 | Espectáculos Públicos |
| nombreLocalidad | 1 | 0 | input | 0 | Espectáculos Públicos |
| precioAdmision | 1 | 0 | input | 0 | Espectáculos Públicos |
| cantidadBoletos | 1 | 0 | input | 0 | Espectáculos Públicos |
| totalBoleto | 1 | 0 | input | 0 | Espectáculos Públicos |
