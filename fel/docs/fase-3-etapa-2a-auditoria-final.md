# Etapa 2A — auditoría final de seguridad (antes de decidir la prueba real)

Base: `61fbdfb` + los cambios de este informe, rama `fel-fase-1-0`.
**No se entró a SAT, no se inició sesión, no se ejecutó Playwright contra SAT, no se escribió nada en el portal, no se tocó `main`, no se desplegó y la Etapa 2 real sigue SIN habilitar.** Todo lo que sigue es análisis de código, investigación documental y pruebas simuladas locales.

## 1. Recomendación (resumen)

**NO autorizar todavía la prueba real 2A.** Hay dos bloqueos que ninguna simulación puede cerrar:
1. **Condiciones de uso no confirmadas** (§5): no pude leer el texto oficial de los Términos y condiciones de SAT, así que no hay evidencia de que el llenado automatizado esté permitido ni de que esté prohibido.
2. **Comportamiento real del formulario ante foco/blur/cambio sin observar** (§3–§4): el robot dispara eventos reales que ningún mapa estático puede describir; falta la observación pasiva O-1/O-2.

Con ambos cerrados y las comprobaciones del §8 en verde, la 2A pasaría a **autorizable con autorización nueva y explícita** (D.6 del documento de diseño). La recomendación se apoya en que el robot **ya se detiene ante todo lo que sabemos simular**, y en que lo que desconocemos es precisamente lo que se puede cerrar sin escribir nada.

## 2. Riesgos pendientes del informe de validación local, revisados

| Riesgo (de `fase-3-etapa-2-validacion-local.md`) | Estado tras esta auditoría | ¿Bloquea 2A? |
|---|---|---|
| Manejadores `ng-blur/keyup/jQuery` y efectos al escribir no observados | Sigue abierto; se agravó con el hallazgo H2 (§3) | **Sí** (hasta O-1/O-2) |
| Posible autoguardado real o consultas distintas | Sigue abierto; se encontró y **corrigió** una vía de escape (H1, autoguardado tardío) | Sí, junto con el anterior |
| Formato real del total | Mitigado: comparación con decimal declarado; si no coincide se detiene | No |
| Consulta del CF a `felav02` | Solo afecta al tramo 2B (2A no escribe el NIT) | No para 2A |
| Subtotal/total del documento y efecto del tipo de línea no observados | Abierto; el robot solo lee `Total0` | No, pero O-1/O-2 debe cubrirlo |
| Condiciones de uso de SAT sin revisar | Abierto; no se pudo confirmar (§5) | **Sí** |
| Repetir verificación en Windows con Chrome | La persona informa que se completó satisfactoriamente; **yo no pude verificarlo** | No (dato aportado por la persona) |
| El ensayo local no demuestra seguridad frente al portal real | Se mantiene | — |

## 3. Auditoría de efectos secundarios (código y comportamiento de Playwright)

Acciones del ejecutor sobre el formulario: `fill`, `selectOption`, `blur` (solo en el tramo 2B), `isChecked`, lectura de texto/valor. No hay `click`, `press` ni `type` en ningún paso del mapa de Etapa 2 (verificado: la única `click` del ejecutor es `clic_seguro`, que el mapa de Etapa 2 no puede contener).

| Acción | Eventos reales que dispara | Consecuencia a vigilar |
|---|---|---|
| `fill` | desplazar el campo a la vista, `focus`, selección, `input`; no `change` hasta perder el foco | `ng-focus`, `ng-keyup`/handlers jQuery de foco, `ng-change` de `Cantidad`, `Precio`, `Descuento` (`calcularTotal(0)`, `limpiarFrasesEspeciales()`, `limpiarReferencia()`) |
| `selectOption` | `focus`, `input`, `change` | `ng-change` del tipo de línea (no observado) |
| Pasar al campo siguiente | `blur` + `change` del campo anterior | **H2**: los `ng-blur` y `change` se disparan aunque el mapa no use `salir_del_campo` |
| `verificar_marcado` | ninguno (`isChecked`) | — |
| Leer `Total0` | ninguno | — |

**Hallazgos**
- **H1 (corregido en esta sesión): ventana sin vigilancia al terminar.** La guardia de red vive solo mientras el comando está conectado por CDP. Un temporizador o autoguardado tardío del portal que disparara *después* del último paso, o *después* de que el comando cerrara, ya no estaba bloqueado. Lo demostré con la simulación (`?tardio=7000`): el POST llegó al servidor tras salir el comando con código 0. Corrección en `bin/ejecutar.mjs`: en modo estricto la guardia se mantiene `FEL_REPOSO_FINAL_MS` (15 s por defecto) tras el último paso, el comando sale con código 1 e imprime «ALERTA TARDÍA» si algo se bloquea, y después **espera a que la persona pulse Enter** (guardia activa mientras revisa y cierra la pestaña). Ahora el POST tardío se bloquea y se señala (prueba nueva «AUDITORÍA · AUTOGUARDADO TARDÍO»). Riesgo residual: un temporizador más largo que la ventana, pero la guardia sigue activa hasta el Enter.
- **H2 (abierto): el foco y el desenfoque son reales.** Aunque el mapa no use `salir_del_campo`, cada `fill` hace perder el foco al campo anterior. Los manejadores de blur son un punto ciego declarado y el mapa no puede garantizar su inocuidad. Cierre: O-1 (§4).
- **H3 (abierto, mitigado): la guardia de GET es una lista de rutas prohibidas.** Todo POST/PUT/PATCH/DELETE se bloquea sin excepciones y todo XHR/fetch a un dominio no listado se bloquea. Pero un GET al mismo dominio cuya ruta no contenga `emit|emisi|certific|firma|guardar|anular|enviar|envio|transmit` pasa (verificado con `evaluarSolicitud`). Un efecto por GET con otro nombre no se vería como bloqueo; solo se registraría como lectura XHR (método + host + ruta saneada). Cierre: O-2 y revisión del registro tras cada ejecución.
- **H4: la vigilancia entre pasos es por muestreo.** Tras cada escritura el robot espera 400–800 ms (`reposo_ms`) y revisa; una solicitud más tardía se detecta en el siguiente punto de control o en la ventana final (H1). No es continua.
- **H5: el último campo (Descuento) queda enfocado** hasta que la persona cierre o recargue; no se hace `blur` automático, por lo que su manejador de blur se dispara cuando la persona actúe sobre la página. Por eso el procedimiento pide no pulsar nada y recargar/cerrar la pestaña.
- **H6 (aceptado):** los datos ficticios quedan en el formulario del navegador (solo en el cliente, mientras no se guarde nada). Se eliminan recargando o cerrando la pestaña.

## 4. Procedimiento de observación pasiva (propuesta, sin ejecutar)

Objetivo: conocer los eventos AngularJS/jQuery y las solicitudes automáticas **antes** de que el robot escriba. Los niveles O-0 a O-2 **no escriben nada**; O-3 sí (lo hace una persona).

| Nivel | Qué hace | Escribe en el portal | Estado |
|---|---|---|---|
| **O-0** estático | Atributos `ng-*` del DOM (ya hecho con los fragmentos 1 y 3) | No | Hecho |
| **O-1** escuchas | La persona, en la consola de DevTools de su propio Chrome (el robot no se conecta), lista por cada control de la lista cerrada: tipos de evento con escuchas (`getEventListeners(el)`), eventos jQuery (`$._data(el, "events")`), y nombres de las funciones que invocan los `ng-*` (`ng-change`, `ng-blur`, `ng-focus`, `ng-keyup`, `ng-click`). Solo lectura. Salida: tipo de evento + identificador del control + nombres de función, **sin valores, textos de opciones ni datos personales**. | No | Por revisar y escribir (fragmento 4) |
| **O-2** red en reposo | Con DevTools → Network abierto («Preservar registro»), la persona deja el formulario **sin tocar nada** 5 minutos y anota si aparecen solicitudes periódicas (sondeos, guardados automáticos, renovación de sesión): método, host, ruta, frecuencia, **sin cuerpos ni cabeceras**. | No | Por ejecutar |
| **O-3** campo a campo (humano) | Una persona, a mano, con Network abierto, escribe un dato ficticio en **un** campo a la vez en el orden de 2A y anota las solicitudes y avisos que aparecen tras cada campo. Equivale a una 2A manual asistida; no automatiza nada. Requiere que la persona decida que su uso manual es aceptable. | Sí (datos ficticios, solo en el formulario) | Opcional; recomendada como paso previo a 2A |

**Reglas de análisis** (aplican a O-1, O-2, O-3): registrar método + host + ruta saneada (sin ids ni tokens); cualquier POST/PUT/DELETE, ruta con `guardar|emitir|certificar|…`, host nuevo o diálogo → **parar y analizar** antes de seguir; las rutas nuevas se tratan como en el hallazgo `felav02` (revisión específica, nada se permite automáticamente). Todo lo observado se compara con el mapa y con la lista de campos escribibles; si un manejador de eventos llama a funciones de guardado, envío o emisión, la 2A **no se autoriza**.

El fragmento 4 de consola (O-1) **no se entrega aún**: debe escribirse y revisarse con el mismo criterio de los anteriores (solo lectura, sin valores, huella SHA publicada, probado en el simulador) antes de pegarlo en SAT.

## 5. Condiciones oficiales de uso de SAT — qué está confirmado y qué no

**Limitación de la investigación:** desde este entorno **no se pudo abrir `portal.sat.gob.gt`** (la red de la sesión no resuelve ese dominio) y la búsqueda web solo devolvió fragmentos. **No leí el texto oficial de los «Términos y condiciones».** Por tanto, lo siguiente es lo que pude confirmar con fragmentos de fuentes oficiales y lo que no.

**Confirmado (fragmento de fuente oficial, sin lectura completa):**
- SAT publica una [Política de Privacidad de las aplicaciones SAT GT y FEL](https://portal.sat.gob.gt/portal/politica-de-privacidad-aplicaciones-sat-gt-y-fel/). Según el fragmento: las plataformas se dirigen a mayores de 18 años con NIT, y las *cookies* sirven para identificar al usuario que accede a las consultas en línea y evitar el mal uso de ellas. No habla de automatización en lo que alcancé a ver.
- El sitio oficial tiene secciones de [preguntas frecuentes de gestiones en línea](https://portal.sat.gob.gt/portal/preguntas-frecuentes/gestiones-en-linea/), de [cumplimiento tributario](https://portal.sat.gob.gt/portal/preguntas-frecuentes/cumplimiento-tributario/) y de [activación de usuario de Agencia Virtual](https://portal.sat.gob.gt/portal/requisitos-tramites-agencias/activacion-de-usuario-de-agencia-virtual/); no leí su contenido completo.

**Respaldado solo por fuentes secundarias (no oficiales; tratar como no verificado):**
- La habilitación FEL por la Agencia Virtual y el certificador de SAT son gratuitos ([Vesco](https://vescco.tax/blog/facturas-electronicas-en-linea-fel-guatemala-como-me-habilito/), [Living in Guatemala](https://livinginguatemala.com/tramites/sat-fel-habilitacion/)).
- El régimen FEL se basa en el Acuerdo de Directorio 13-2018 de SAT ([Seres](https://blog.groupseres.com/de-face-a-fel-la-transformaci%C3%B3n-del-esquema-de-factura-electr%C3%B3nica-en-guatemala)); el requisito de uso para todos los contribuyentes tiene fechas contradictorias entre fuentes.
- Consejos generales de seguridad (no compartir credenciales, usar el dominio oficial) sin relación con automatización.

**NO confirmado (sin evidencia ni a favor ni en contra):**
1. Que los Términos y condiciones de SAT o de la aplicación FEL **permitan** o **prohíban** automatizar el llenado con una herramienta como Playwright.
2. Que exista una cláusula sobre robots, scripts, *scraping* o uso automatizado.
3. Que el «portal gratuito FEL» tenga condiciones propias distintas de las del portal general.
4. Qué consecuencias tendría un uso que SAT considere indebido (bloqueo de usuario, bitácora, etc.).

**Acciones para cerrar este punto (las hace la persona, no el robot):** leer los Términos y condiciones del portal y los que se aceptan al entrar en la Agencia Virtual/FEL; leer la política FEL completa; y, ante cualquier duda, **preguntar a SAT por escrito** (servicio al contribuyente) si el llenado asistido por una herramienta de automatización en la aplicación FEL está permitido. Guardar la respuesta. Esto no es asesoría legal.

## 6. Protecciones contra Guardar, Vista Previa, Certificar y Emitir

Comprobadas ahora (clasificación y guardia) y por las baterías:
- `clasificarControl`: «Vista Previa», «Guardar», «Guardar borrador», «Certificar», «Emitir», «Enviar», «Eliminar item», «Anular» y «Firmar» → **prohibido**; «Editar», «Agregar item», «Aceptar», «Continuar», «Siguiente», «OK» → **ambiguo** (tampoco se ejecutan).
- `evaluarSolicitud`: POST y PUT → bloqueados siempre; GET de ruta con `emitir` o `guardar` → bloqueado; XHR a `felav02` sin regla → bloqueado.
- Estructura: el mapa de Etapa 2 no puede contener `clic_seguro` ni `marcar`; la lista de campos escribibles es cerrada en el código; `permitir_post` debe estar vacío; `permitir_get` exige `aprobado_por` y fecha; el motor falla si cualquier `.fill/.selectOption/.setChecked/.blur/.click` no está precedido de `soloComprobar`.
- Pruebas simuladas que lo demuestran: «INALCANZABLES», rechazo de un mapa con clic en «Vista Previa» (código 2), E2E del comando real con 0 POST y Vista Previa/impuestos intactos.
- **Matiz honesto:** que «no existan» rutas para esas acciones no es una prueba sobre el portal real; es que el robot **no las pulsa y no tiene cómo hacerlo**, y que cualquier envío por POST se bloquea. Un efecto por GET con nombre distinto (H3) o por navegación no se detectaría como bloqueo.

## 7. Riesgos que impiden autorizar la 2A hoy

| ID | Riesgo | Cómo se cierra |
|---|---|---|
| B1 | **Condiciones de uso no confirmadas** respecto a la automatización | La persona lee los términos oficiales y, si no son inequívocos, obtiene respuesta escrita de SAT |
| B2 | **Eventos blur/focus/change y solicitudes automáticas del formulario real sin observar** (H2, H3) | O-1 y O-2; idealmente O-3 |
| B3 | El mapa se entrega sin confirmar (indicador de sesión) | La persona lo confirma en su copia local contra el portal real |
| B4 | No hay autorización nueva, explícita e independiente para la Etapa 2 | Plantilla D.6 firmada |
| B5 | Empresa de prueba no confirmada manualmente para esta ejecución | Confirmación manual + `FEL_EMPRESA_CONFIRMADA` |

No bloquean 2A (pero conviene registrarlos): formato del total (el robot se detiene si difiere), `felav02` y NIT (solo 2B), vigilancia por muestreo (H4, mitigada con la ventana final), datos ficticios que quedan en el formulario (H6).

## 8. Lista de comprobaciones antes de autorizar

- [ ] B1: términos oficiales leídos; respuesta escrita de SAT archivada si hace falta
- [ ] O-1: escuchas y funciones de `ng-*` de los 8 campos de la lista cerrada documentadas; ninguna llama a guardar/enviar/emitir
- [ ] O-2: 5 min de red en reposo sin POST ni sondeos de guardado
- [ ] (Recomendado) O-3: 2A manual asistida con Network abierto, sin solicitudes inesperadas
- [ ] Ninguna ruta nueva ni host nuevo en lo observado (o, si la hay, revisada una por una)
- [ ] Indicador de sesión confirmado en la copia local del mapa
- [ ] Empresa de prueba confirmada manualmente
- [ ] Tres baterías en verde en Windows con Chrome (`npm run verificar:chrome`) en el commit exacto a usar
- [ ] CI verde en ese commit
- [ ] Autorización D.6 firmada, con la fecha de revisión de términos
- [ ] Plan de limpieza listo (Enter final, recargar/cerrar pestaña, comprobar 0 facturas, `Remove-Item Env:FEL_*`)

## 9. Cambios realizados en esta sesión

- `bin/ejecutar.mjs`: guardia activa tras el último paso (`FEL_REPOSO_FINAL_MS`, 15 s), «ALERTA TARDÍA» con código 1, y espera final por Enter con la guardia activa (solo en modo estricto). Ninguna protección se quitó ni se debilitó.
- Simulación: variante `?tardio=ms` y la prueba «AUDITORÍA · AUTOGUARDADO TARDÍO» (primero falló, demostrando el hallazgo; con la corrección pasa).

**Resultados de las baterías tras el cambio:** unitarias 32/32 · navegador 32/32 · simulación 40/40.

## 10. Limitaciones de esta auditoría

No se observó el portal real; todo comportamiento de AngularJS/jQuery es el declarado, no el medido. No pude abrir el sitio oficial de SAT, así que el punto de condiciones de uso queda sin confirmar. La validación en Windows con Chrome es un dato de la persona; no la ejecuté yo. Las pruebas de este informe usan Chromium de Playwright en Linux.
