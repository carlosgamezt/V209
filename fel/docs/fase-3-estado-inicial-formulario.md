# Estado inicial observado del formulario FEL y controles inferiores

Base: `cf2a52d` + estos cambios, rama `fel-fase-1-0`. **Solo documentación y pruebas locales.** No se modificó el comportamiento del robot, no se ejecutó O-1, no se usó Playwright contra SAT y la Etapa 2 real sigue sin habilitar.

**Fuente:** dos capturas de pantalla (10/11/2026) del formulario ya abierto por la persona, sin interactuar con él. **Las capturas no se guardan en el repositorio ni en el ZIP** porque muestran datos personales y fiscales (la cabecera de la página); este documento y el mapa recogen únicamente los hallazgos, sin ningún dato personal ni fiscal. Es una observación **visual**: no se ha verificado con DevTools ni con el robot.

## 1. Estado inicial del formulario

| Elemento | Valor observado |
|---|---|
| Versión visible del portal (pie de página) | 2.0.0, build 20261028.1439 (útil para detectar cambios del portal) |
| Tipo de DTE | Factura Pequeño Contribuyente |
| Moneda | GTQ-Quetzal |
| Fecha de emisión | la del día; campo de solo lectura con botón de calendario |
| Exportación; Emisión en ubicación temporal | casillas sin marcar |
| **Radios NIT / CUI / ID EXTRANJERO** | **ninguno marcado** |
| NIT del receptor; Dirección del comprador | vacíos |
| **Línea 0: tipo** | **Servicio** |
| Línea 0: cantidad | **1** |
| Línea 0: descripción | vacía |
| Línea 0: precio unitario | **0** |
| Línea 0: descuentos | **0** |
| Línea 0: otros descuentos | **0** |
| Línea 0: total | **`0.000000`** (seis decimales; campo deshabilitado) |
| Línea 0: impuestos | columna vacía |

## 2. Hallazgo 1 — el radio NIT aparece sin marcar

- `p010-receptor-radio-nit` **sigue siendo `verificar_marcado`**: solo lee el estado y **nunca pulsa**. Con el formulario recién abierto se detiene en ese paso, que es lo diseñado.
- El robot no marca el radio. Hacerlo a mano **no es un gesto neutro**: su manejador (`ng-change`) ejecuta `asignacionesRadioNIT()` y `onChangeComboDestinoDespacho()`, y el radio CUI limpia el receptor. **Cualquier selección manual del radio requiere una evaluación independiente de sus efectos** (observación pasiva y, idealmente, una 2A manual asistida con DevTools abierto) y **no está autorizada por este documento ni por el mapa**.
- Consecuencia para el procedimiento: la precondición «radio NIT marcado a mano» de la 2A queda **pendiente de esa evaluación**; hasta entonces la 2A no puede cumplir esa precondición.

## 3. Hallazgo 2 — valores iniciales de la línea 0 y qué cambia el robot

| Paso | Dato ficticio | Valor inicial | ¿Cambia el modelo? |
|---|---|---|---|
| `p100` tipo | Servicio | Servicio | No (mismo valor; eventos del portal no verificados) |
| `p110` cantidad | 2 | 1 | Sí |
| `p120` descripción | texto de prueba | vacía | Sí |
| `p130` precio | 125.50 | 0 | Sí |
| `p140` descuento | 0 | 0 | Probablemente no: AngularJS normalmente no ejecuta `ng-change` si el valor no cambia (no verificado en el portal) |

Otros descuentos (0) no se escribe en la 2A. En simulación local (§5) se comprobó que el paso `p140` con valor igual al inicial no dispara el cálculo y que el flujo 2A funciona con estos valores iniciales.

## 4. Hallazgo 3 — el total se muestra con seis decimales

La comparación del total **sigue siendo numérica** (`p150`: `comparacion: "numerica"`, separador decimal «.», tolerancia 0.005): `251.000000` coincide con `251.00`. Una comparación de texto exacta habría fallado. Si el formato real difiriera (coma decimal o separador de miles), el robot se detiene en lugar de suponerlo.

## 5. Hallazgo 4 — controles inferiores (el robot no actúa sobre ninguno)

| Control | Manejador conocido | Clasificación de la guardia | Riesgo | Robot |
|---|---|---|---|---|
| **Agregar item** | `agregarItem()` | ambiguo | añade una línea y cambia los índices de la tabla; el mapa asume una sola línea | ninguna acción |
| **Seleccione Frase Especial** | sin observar | fuera de la lista cerrada | cantidad, precio y descuento ejecutan `limpiarFrasesEspeciales()`: editarlos puede limpiar la frase especial; el texto fijo «No genera derecho a crédito fiscal» no se ha verificado a qué depende | ninguna acción |
| **Complemento medios de pago** | sin observar | fuera de la lista cerrada | podría abrir campos o cambiar el documento; sin evaluar | ninguna acción |
| **Vista Previa** | `validarInformacion()` | **prohibido** | avanza hacia la emisión; irreversible en la práctica | ninguna acción; inalcanzable (sin `clic_seguro`, texto prohibido) |
| Editar impuestos (lápiz) | `mostrarModalImpuestos()` | ambiguo | abre el diálogo de impuestos | ninguna acción |
| Eliminar item (papelera) | `eliminarItem()` | **prohibido** | borra la línea | ninguna acción |

## 6. Cambios realizados

- `config/mapeo.sat-etapa2.json`: se añadieron los bloques `estado_inicial_observado` y `controles_inferiores_observados` y se completaron los comentarios de `p010`, `p100`, `p110`, `p130`, `p140` y `p150`. **Ningún paso, localizador, dominio, permiso, sesión ni tramo cambió**: una prueba unitaria fija la huella de todos los campos que gobiernan el comportamiento (la misma antes y después).
- Simulación local: variantes `?inicial=1` (valores iniciales observados) y `?formato=seis` (total con seis decimales).
- Pruebas nuevas: unitarias (huella del comportamiento; contenido documentado; ausencia de números largos y correos en el mapa y en este documento) y de simulación (2A con valores iniciales y total de seis decimales).

## 7. Limitaciones

Observación visual de un solo momento; no se conocen los eventos reales de ningún control, ni el efecto de la frase especial, de los medios de pago ni del estado por defecto de los radios en otras condiciones (otro tipo de DTE, otra sesión). Nada de esto autoriza la 2A.
