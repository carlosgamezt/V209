# Clasificación de controles

Total: **211** controles · visibles: **31** · ocultos: **180**

**Por estabilidad del identificador**

| Valor | Controles |
|---|---|
| sin_identificador | 113 |
| ayuda_sin_localizador_propio | 51 |
| estable_rol_texto | 24 |
| estable_nombre_indexado | 18 |
| estable_etiqueta (name numérico descartado) | 3 |
| ambiguo_nombre_repetido | 2 |

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

## Los 211 controles

| # | Sección / subsección | Vis. | Control | Función | Conf. función | Estabilidad | Mejor localizador | Acción |
|---|---|---|---|---|---|---|---|---|
| 0 | Datos Generales | sí | div[tab] | pestaña «Datos Generales» | alta (texto) | estable_rol_texto | rol: Datos Generales | clic_seguro (solo navegación, con verificación) |
| 1 | Datos Generales › Encabezado del documento | sí | input[textbox] | «Fecha Emisión» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 2 | Datos Generales › Encabezado del documento | sí | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 3 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Fecha Emisión» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 4 | Datos Generales › Encabezado del documento | no | select[combobox] | desconocida (sigue a la ayuda «Fecha Emisión») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 5 | Datos Generales › Encabezado del documento | no | select[combobox] | desconocida (sigue a la ayuda «Fecha Emisión») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 6 | Datos Generales › Encabezado del documento | sí | select[combobox] | desconocida (sigue a la ayuda «Fecha Emisión») | baja | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 7 | Datos Generales › Encabezado del documento | no | select[combobox] * | desconocida (sigue a la ayuda «Fecha Emisión») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 8 | Datos Generales › Encabezado del documento | sí | select[combobox] | desconocida (sigue a la ayuda «Fecha Emisión») | baja | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 9 | Datos Generales › Encabezado del documento | sí | input[checkbox] | «Emisión en ubicación temporal» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 10 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Emisión en ubicación temporal» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 11 | Datos Generales › Encabezado del documento | no | select[combobox] * | desconocida (sigue a la ayuda «Emisión en ubicación temporal») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 12 | Datos Generales › Encabezado del documento | no | select[combobox] * | desconocida (sigue a la ayuda «Emisión en ubicación temporal») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 13 | Datos Generales › Encabezado del documento | no | select[combobox] * | desconocida (sigue a la ayuda «Emisión en ubicación temporal») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 14 | Datos Generales › Encabezado del documento | no | select[combobox] * | desconocida (sigue a la ayuda «Emisión en ubicación temporal») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 15 | Datos Generales › Encabezado del documento | sí | input[checkbox] | «Exportación» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 16 | Datos Generales › Encabezado del documento | sí | button[button] | ayuda de «Exportación» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 17 | Datos Generales › Encabezado del documento | no | select[combobox] | desconocida (sigue a la ayuda «Exportación») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 18 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: NIT | alta (etiqueta) | estable_etiqueta (name numérico descartado) | etiqueta: NIT | llenar/seleccionar/marcar (tras confirmar localizador) |
| 19 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: CUI | alta (etiqueta) | estable_etiqueta (name numérico descartado) | etiqueta: CUI | llenar/seleccionar/marcar (tras confirmar localizador) |
| 20 | Datos Generales › Receptor | sí | input[radio] | tipo de identificación del receptor: ID EXTRANJERO | alta (etiqueta) | estable_etiqueta (name numérico descartado) | etiqueta: ID EXTRANJERO | llenar/seleccionar/marcar (tras confirmar localizador) |
| 21 | Datos Generales › Receptor | sí | input[text] * | «NIT del Receptor» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 22 | Datos Generales › Receptor | sí | button[button] | ayuda de «NIT del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 23 | Datos Generales › Receptor | no | input[text] | desconocida (sigue a la ayuda «NIT del Receptor») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 24 | Datos Generales › Receptor | no | input[text] | «CUI del Receptor» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 25 | Datos Generales › Receptor | no | button[button] | ayuda de «CUI del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 26 | Datos Generales › Receptor | no | input[text] | desconocida (sigue a la ayuda «CUI del Receptor») | baja | ambiguo_nombre_repetido |  | dinámico: aparece tras una acción manual |
| 27 | Datos Generales › Receptor | no | input[text] | «CUI del Receptor» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 28 | Datos Generales › Receptor | no | button[button] | ayuda de «CUI del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 29 | Datos Generales › Receptor | no | input[text] | desconocida (sigue a la ayuda «CUI del Receptor») | baja | ambiguo_nombre_repetido |  | dinámico: aparece tras una acción manual |
| 30 | Datos Generales › Receptor | sí | input[text] | «Dirección del Receptor» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 31 | Datos Generales › Receptor | sí | button[button] | ayuda de «Dirección del Receptor» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 32 | Datos Generales › Receptor | no | input[text] * | «ID del transportista» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 33 | Datos Generales › Receptor | no | button[button] | ayuda de «ID del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 34 | Datos Generales › Receptor | no | input[text] * | «Nombre del transportista» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 35 | Datos Generales › Receptor | no | button[button] | ayuda de «Nombre del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 36 | Datos Generales › Receptor | no | input[text] * | desconocida (sigue a la ayuda «Nombre del transportista») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 37 | Datos Generales › Receptor | no | input[text] * | desconocida (sigue a la ayuda «Nombre del transportista») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 38 | Datos Generales › Receptor | no | input[text] * | desconocida (sigue a la ayuda «Nombre del transportista») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 39 | Datos Generales › Artículos (tabla) | sí | button[button] | ayuda de «Precio Unitario» | alta (title) | ayuda_sin_localizador_propio | rol: (?) | ayuda: no se pulsa |
| 40 | Datos Generales › Artículos (tabla) | sí | select[combobox] | tipo de línea (bien/servicio) | alta (name) | estable_nombre_indexado | nombre[select]: BienOServicio0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 41 | Datos Generales › Artículos (tabla) | sí | input[text] | cantidad | alta (name) | estable_nombre_indexado | nombre[input]: Cantidad0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 42 | Datos Generales › Artículos (tabla) | no | select[combobox] | código de producto (catálogo) | alta (name) | estable_nombre_indexado | nombre[select]: CodigoProducto0 | dinámico: aparece tras una acción manual |
| 43 | Datos Generales › Artículos (tabla) | sí | input[text] | descripción | alta (name) | estable_nombre_indexado | nombre[input]: Descripcion0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 44 | Datos Generales › Artículos (tabla) | no | select[combobox] | descripción | alta (name) | estable_nombre_indexado | nombre[select]: Descripcion0 | dinámico: aparece tras una acción manual |
| 45 | Datos Generales › Artículos (tabla) | sí | input[text] | precio unitario | alta (name) | estable_nombre_indexado | nombre[input]: PrecioUnitario0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 46 | Datos Generales › Artículos (tabla) | no | input[text] | observaciones de la línea | alta (name) | estable_nombre_indexado | nombre[input]: Observaciones0 | dinámico: aparece tras una acción manual |
| 47 | Datos Generales › Artículos (tabla) | sí | input[text] | descuento | alta (name) | estable_nombre_indexado | nombre[input]: Descuento0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 48 | Datos Generales › Artículos (tabla) | sí | input[text] | otros descuentos | alta (name) | estable_nombre_indexado | nombre[input]: OtrosDescuento0 | llenar/seleccionar/marcar (tras confirmar localizador) |
| 49 | Datos Generales › Artículos (tabla) | no | input[checkbox] | desconocida (sigue a la ayuda «Precio Unitario») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 50 | Datos Generales › Artículos (tabla) | sí | input[text] | total de la línea (calculado) | alta (name) | estable_nombre_indexado | nombre[input]: Total0 | solo lectura (valor calculado) |
| 51 | Datos Generales › Artículos (tabla) | no | input[text] | código FEL | alta (name) | estable_nombre_indexado | nombre[input]: CodigoFEL0 | dinámico: aparece tras una acción manual |
| 52 | Datos Generales › Artículos (tabla) | no | input[text] | descripción CI | alta (name) | estable_nombre_indexado | nombre[input]: DescripcionCI0 | dinámico: aparece tras una acción manual |
| 53 | Datos Generales › Artículos (tabla) | sí | button[button] | Editar impuestos | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 54 | Datos Generales › Artículos (tabla) | sí | button[button] | Eliminar item | alta (texto/title) | sin_identificador |  | BLOQUEADA (prohibida) |
| 55 | Datos Generales › Artículos (tabla) | sí | button[button] | Agregar item | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 56 | Datos Generales › Frases y escenarios | no | input[checkbox] | desconocida | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 57 | Datos Generales › Frases y escenarios | no | input[checkbox] | desconocida | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 58 | Datos Generales › Frases y escenarios | sí | input[checkbox] | desconocida | baja | sin_identificador |  | llenar/seleccionar/marcar (tras confirmar localizador) |
| 59 | Datos Generales › Frases y escenarios | no | input[checkbox] | desconocida | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 60 | Datos Generales › Frases y escenarios | no | input[checkbox] | desconocida | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 61 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frases de Apoyo Social --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frases de Apoyo Social --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 62 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Base Legal--- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase Base Legal--- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 63 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Factura Especial --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase Factura Especial --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 64 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase ISR --- | alta (texto) | estable_rol_texto | rol: --- Seleccione Frase ISR --- | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 65 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 66 | Datos Generales › Frases y escenarios | sí | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 67 | Datos Generales › Frases y escenarios | no | button[button] | desplegable personalizado: --- Seleccione Frase Especial --- | alta (texto) | sin_identificador |  | BLOQUEADA (desplegable personalizado: requiere diseño aparte) |
| 68 | Abonos de Factura Cambiaria | no | div[tab] | pestaña «Abonos de Factura Cambiaria» | alta (texto) | estable_rol_texto | rol: Abonos de Factura Cambiaria ( ? ) | clic_seguro (solo navegación, con verificación) |
| 69 | Abonos de Factura Cambiaria | no | button[button] | ayuda de «Abonos de Factura cambiaria» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 70 | Abonos de Factura Cambiaria | no | input[number] | desconocida (sigue a la ayuda «Abonos de Factura cambiaria») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 71 | Abonos de Factura Cambiaria | no | input[number] | desconocida (sigue a la ayuda «Abonos de Factura cambiaria») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 72 | Abonos de Factura Cambiaria | no | button[button] | Agregar | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 73 | Referencias de Notas de crédito y débito | no | div[tab] | pestaña «Referencias de Notas de crédito y débito» | alta (texto) | estable_rol_texto | rol: Referencias de Notas de crédito y débito ( ? ) | clic_seguro (solo navegación, con verificación) |
| 74 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Referencias de Notas de crédito y débito» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 75 | Referencias de Notas de crédito y débito | no | select[combobox] | «Régimen del Documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 76 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Régimen del Documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 77 | Referencias de Notas de crédito y débito | no | input[text] | «Número de autorización del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 78 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 79 | Referencias de Notas de crédito y débito | no | input[text] | «Número de autorización del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 80 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 81 | Referencias de Notas de crédito y débito | no | input[text] | desconocida (sigue a la ayuda «Número de autorización del documento origen») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 82 | Referencias de Notas de crédito y débito | no | input[text] | «Número del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 83 | Referencias de Notas de crédito y débito | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 84 | Referencias de Notas de crédito y débito | no | input[textbox] | desconocida (sigue a la ayuda «Número del documento origen») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 85 | Referencias de Notas de crédito y débito | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 86 | Referencias de Notas de crédito y débito | no | textarea[textbox] | desconocida (sigue a la ayuda «Número del documento origen») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 87 | Exportación provisional | no | div[tab] | pestaña «Exportación provisional» | alta (texto) | estable_rol_texto | rol: Exportación provisional ( ? ) | clic_seguro (solo navegación, con verificación) |
| 88 | Exportación provisional | no | button[button] | ayuda de «Exportación Provisional» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 89 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 90 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 91 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 92 | Exportación provisional | no | select[combobox] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 93 | Exportación provisional | no | select[combobox] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 94 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 95 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 96 | Exportación provisional | no | input[text] * | desconocida (sigue a la ayuda «Exportación Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 97 | Exportaciones | no | div[tab] | pestaña «Exportaciones» | alta (texto) | estable_rol_texto | rol: Exportaciones ( ? ) | clic_seguro (solo navegación, con verificación) |
| 98 | Exportaciones | no | button[button] | ayuda de «Exportaciones» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 99 | Exportaciones | no | input[text] * | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 100 | Exportaciones | no | input[text] * | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 101 | Exportaciones | no | input[text] * | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 102 | Exportaciones | no | select[combobox] * | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 103 | Exportaciones | no | select[combobox] | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 104 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 105 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 106 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Exportaciones») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 107 | Exportaciones | no | input[text] | «Número de Autorización Provisional» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 108 | Exportaciones | no | button[button] | ayuda de «Número de Autorización Provisional» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 109 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 110 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 111 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 112 | Exportaciones | no | input[textbox] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 113 | Exportaciones | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 114 | Exportaciones | no | select[combobox] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 115 | Exportaciones | no | select[combobox] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 116 | Exportaciones | no | input[text] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 117 | Factura Especial | no | div[tab] | pestaña «Factura Especial» | alta (texto) | estable_rol_texto | rol: Factura Especial | clic_seguro (solo navegación, con verificación) |
| 118 | Cobro por cuenta ajena | no | div[tab] | pestaña «Cobro por cuenta ajena» | alta (texto) | estable_rol_texto | rol: Cobro por cuenta ajena | clic_seguro (solo navegación, con verificación) |
| 119 | Cobro por cuenta ajena | no | input[number] | desconocida (sigue a la ayuda «Número de Autorización Provisional») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 120 | Cobro por cuenta ajena | no | button[button] | Agregar | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 121 | Espectáculos Públicos | no | div[tab] | pestaña «Espectáculos Públicos» | alta (texto) | estable_rol_texto | rol: Espectáculos Públicos | clic_seguro (solo navegación, con verificación) |
| 122 | Espectáculos Públicos | no | input[text] | número de autorización | alta (name) | estable_nombre_indexado | nombre[input]: numeroAutorizacion0 | dinámico: aparece tras una acción manual |
| 123 | Espectáculos Públicos | no | input[text] | nombre del evento | alta (name) | estable_nombre_indexado | nombre[input]: nombreEvento0 | dinámico: aparece tras una acción manual |
| 124 | Espectáculos Públicos | no | input[text] | nombre de la localidad | alta (name) | estable_nombre_indexado | nombre[input]: nombreLocalidad0 | dinámico: aparece tras una acción manual |
| 125 | Espectáculos Públicos | no | input[text] | precio de admisión | alta (name) | estable_nombre_indexado | nombre[input]: precioAdmision0 | dinámico: aparece tras una acción manual |
| 126 | Espectáculos Públicos | no | input[text] | cantidad de boletos | alta (name) | estable_nombre_indexado | nombre[input]: cantidadBoletos0 | dinámico: aparece tras una acción manual |
| 127 | Espectáculos Públicos | no | input[text] | total del boleto (calculado) | alta (name) | estable_nombre_indexado | nombre[input]: totalBoleto0 | solo lectura (valor calculado) |
| 128 | Espectáculos Públicos | no | button[button] | Eliminar item espectáculo | alta (texto/title) | sin_identificador |  | BLOQUEADA (prohibida) |
| 129 | Espectáculos Públicos | no | button[button] | Agregar ítem | alta (texto/title) | estable_rol_texto | rol: Agregar ítem | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 130 | Referencias de Constancias | no | div[tab] | pestaña «Referencias de Constancias» | alta (texto) | estable_rol_texto | rol: Referencias de Constancias ( ? ) | clic_seguro (solo navegación, con verificación) |
| 131 | Referencias de Constancias | no | button[button] | ayuda de «Refencias de Constancias» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 132 | Referencias de Constancias | no | select[combobox] | «Régimen del Documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 133 | Referencias de Constancias | no | button[button] | ayuda de «Régimen del Documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 134 | Referencias de Constancias | no | input[text] | «Número de autorización del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 135 | Referencias de Constancias | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 136 | Referencias de Constancias | no | input[text] | «Número de autorización del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 137 | Referencias de Constancias | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 138 | Referencias de Constancias | no | input[text] | «Número del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 139 | Referencias de Constancias | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 140 | Referencias de Constancias | no | input[text] | desconocida (sigue a la ayuda «Número del documento origen») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 141 | Referencias de Constancias | no | input[text] | «Número del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 142 | Referencias de Constancias | no | button[button] | ayuda de «Número del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 143 | Referencias de Constancias | no | input[textbox] | desconocida (sigue a la ayuda «Número del documento origen») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 144 | Referencias de Constancias | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 145 | Referencias de Constancias | no | input[text] | desconocida (sigue a la ayuda «Número del documento origen») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 146 | Boletos Aéreos | no | div[tab] | pestaña «Boletos Aéreos» | alta (texto) | estable_rol_texto | rol: Boletos Aéreos ( ? ) | clic_seguro (solo navegación, con verificación) |
| 147 | Boletos Aéreos | no | button[button] | ayuda de «Boletos Aéreos» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 148 | Boletos Aéreos | no | input[text] | «NIT de la reclutadora» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 149 | Boletos Aéreos | no | button[button] | ayuda de «NIT de la reclutadora» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 150 | Boletos Aéreos | no | input[text] | «CUI del beneficiario» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 151 | Boletos Aéreos | no | button[button] | ayuda de «CUI del beneficiario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 152 | Boletos Aéreos | no | input[text] | «Nombre del beneficiario» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 153 | Boletos Aéreos | no | button[button] | ayuda de «Nombre del beneficiario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 154 | Boletos Aéreos | no | input[textbox] | «Fecha de viaje» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 155 | Boletos Aéreos | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 156 | Boletos Aéreos | no | button[button] | ayuda de «Fecha de viaje» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 157 | Boletos Aéreos | no | input[text] | «Pais de destino» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 158 | Boletos Aéreos | no | button[button] | ayuda de «Pais de destino» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 159 | Medios de Pago | no | div[tab] | pestaña «Medios de Pago» | alta (texto) | estable_rol_texto | rol: Medios de Pago ( ? ) | clic_seguro (solo navegación, con verificación) |
| 160 | Medios de Pago | no | button[button] | ayuda de «Medios Pago» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 161 | Medios de Pago | no | select[combobox] | «Tipo forma de pago» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 162 | Medios de Pago | no | button[button] | ayuda de «Tipo forma de pago» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 163 | Medios de Pago | no | input[text] | «Número de transacción» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 164 | Medios de Pago | no | button[button] | ayuda de «Número de transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 165 | Medios de Pago | no | input[textbox] | «Fecha de transacción» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 166 | Medios de Pago | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 167 | Medios de Pago | no | button[button] | ayuda de «Fecha de transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 168 | Medios de Pago | no | input[text] | «Monto Transacción» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 169 | Medios de Pago | no | button[button] | ayuda de «Monto Transacción» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 170 | Organizaciones Políticas | no | div[tab] | pestaña «Organizaciones Políticas» | alta (texto) | estable_rol_texto | rol: Organizaciones Políticas ( ? ) | clic_seguro (solo navegación, con verificación) |
| 171 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 172 | Organizaciones Políticas | no | select[combobox] | «» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 173 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 174 | Organizaciones Políticas | no | select[combobox] | «» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 175 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 176 | Organizaciones Políticas | no | input[text] | «» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 177 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 178 | Organizaciones Políticas | no | input[text] | «» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 179 | Organizaciones Políticas | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 180 | Traslado de Mercancías | no | div[tab] | pestaña «Traslado de Mercancías» | alta (texto) | estable_rol_texto | rol: Traslado de Mercancías ( ? ) | clic_seguro (solo navegación, con verificación) |
| 181 | Traslado de Mercancías | no | button[button] | ayuda (sin title) | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 182 | Traslado de Mercancías | no | input[text] * | «ID del transportista» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 183 | Traslado de Mercancías | no | button[button] | ayuda de «ID del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 184 | Traslado de Mercancías | no | input[text] * | «Nombre del transportista» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 185 | Traslado de Mercancías | no | button[button] | ayuda de «Nombre del transportista» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 186 | Traslado de Mercancías | no | input[text] * | «Placa» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 187 | Traslado de Mercancías | no | button[button] | ayuda de «Placa» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 188 | Traslado de Mercancías | no | input[text] * | «Dirección de procedencia» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 189 | Traslado de Mercancías | no | button[button] | ayuda de «Dirección de procedencia» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 190 | Traslado de Mercancías | no | input[text] * | «ID del consignatario» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 191 | Traslado de Mercancías | no | button[button] | ayuda de «ID del consignatario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 192 | Traslado de Mercancías | no | input[text] * | «Nombre del consignatario» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | solo lectura / deshabilitado |
| 193 | Traslado de Mercancías | no | button[button] | ayuda de «Nombre del consignatario» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 194 | Traslado de Mercancías | no | input[text] * | «Dirección de destino» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 195 | Traslado de Mercancías | no | button[button] | ayuda de «Dirección de destino» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 196 | Traslado de Mercancías | no | input[text] * | «Motivo» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 197 | Traslado de Mercancías | no | button[button] | ayuda de «Motivo» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 198 | Factura Especifica | no | div[tab] | pestaña «Factura Especifica» | alta (texto) | estable_rol_texto | rol: Factura Especifica | clic_seguro (solo navegación, con verificación) |
| 199 | Factura Especifica › Detalle de productos | no | div[tab] | pestaña «Detalle de productos» | alta (texto) | estable_rol_texto | rol: Detalle de productos | clic_seguro (solo navegación, con verificación) |
| 200 | Factura Especifica › Almacenamiento y Galonaje | no | div[tab] | pestaña «Almacenamiento y Galonaje» | alta (texto) | estable_rol_texto | rol: Almacenamiento y Galonaje | clic_seguro (solo navegación, con verificación) |
| 201 | Factura Especifica › Almacenamiento y Galonaje | no | button[button] | Agregar item | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 202 | Factura Especifica › Almacenamiento y Galonaje | no | input[text] * | desconocida (sigue a la ayuda «Motivo») | baja | sin_identificador |  | dinámico: aparece tras una acción manual |
| 203 | Factura Especifica › Información Gas Licuado de Petróleo GLP | no | div[tab] | pestaña «Información Gas Licuado de Petróleo GLP» | alta (texto) | estable_rol_texto | rol: Información Gas Licuado de Petróleo GLP | clic_seguro (solo navegación, con verificación) |
| 204 | Factura Especifica › Información Gas Licuado de Petróleo GLP | no | button[button] | Agregar item | alta (texto/title) | sin_identificador |  | BLOQUEADA (ambigua/sin texto: requiere aprobación humana) |
| 205 | Factura Especifica › Referencia boleta despacho IDP | no | div[tab] | pestaña «Referencia boleta despacho IDP» | alta (texto) | estable_rol_texto | rol: Referencia boleta despacho IDP | clic_seguro (solo navegación, con verificación) |
| 206 | Factura Especifica › Referencia boleta despacho IDP | no | input[text] | «Número de autorización del documento origen» | media (adyacencia: la ayuda sigue al campo) | sin_identificador |  | dinámico: aparece tras una acción manual |
| 207 | Factura Especifica › Referencia boleta despacho IDP | no | button[button] | ayuda de «Número de autorización del documento origen» | alta (title) | ayuda_sin_localizador_propio |  | ayuda: no se pulsa |
| 208 | Factura Especifica › Referencia boleta despacho IDP | no | input[textbox] | desconocida (sigue a la ayuda «Número de autorización del documento origen») | baja | sin_identificador |  | solo lectura / deshabilitado |
| 209 | Factura Especifica › Referencia boleta despacho IDP | no | button[button] | botón del selector de fecha (calendario) | media (placeholder) | sin_identificador |  | BLOQUEADA (calendario: requiere diseño aparte) |
| 210 | Factura Especifica › Referencia boleta despacho IDP | sí | button[button] | Vista Previa | alta (texto/title) | estable_rol_texto | rol: Vista Previa | BLOQUEADA (prohibida) |

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
