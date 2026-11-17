# NEXA FEL · Autollenado del receptor por NIT y consumidor final (CF) — implementado en local, NO publicado
Estado: 17/11/2026. Digifact sigue APAGADO por defecto; la emisión fiscal real sigue bloqueada. Sin migraciones.

## Qué hace
- **Nueva factura (receptor nuevo) y Clientes (cliente nuevo):** al terminar de escribir un NIT (600 ms sin teclas, o al salir del campo) el servidor consulta el nombre y lo completa. Una línea discreta bajo «Identificación» indica el estado: «Consultando NIT…», «Dato simulado de demostración: no proviene de SAT.» / «Dato obtenido por Digifact TEST.», «No se encontró este NIT… Escribe el nombre manualmente.», «No se pudo consultar el NIT ahora…», «Se conservó el nombre que escribiste.».
- **Sin una consulta por tecla:** cada tecla reinicia la espera; se cancela la consulta anterior (AbortController) y se descarta cualquier respuesta de un NIT que ya cambió.
- **Nunca se pisa un nombre escrito a mano;** un nombre autollenado se limpia en cuanto cambia el NIT (no queda el del receptor anterior).
- **Se retiró el botón manual «Consultar NIT en Digifact TEST»** del diálogo de Clientes.

## De dónde sale el nombre (todo en el SERVIDOR: `POST /api/receptores/nit`)
| Situación | Origen | Detalle |
|---|---|---|
| `CF` | local | Sin ningún proveedor: `CONSUMIDOR FINAL` |
| Digifact TEST habilitado y la empresa tiene canal | `digifact_test` | Servicio existente `consultarNit` (permiso `clientes.ver`, tope de 20 por minuto por empresa, auditoría). Digifact (documentación interna, leída 14/11/2026; probado contra TEST el 15/11/2026): `GET /Shared` con `DATA1=SHARED_GETINFONITcom` y `DATA2=NIT\|<nit>` → razón social registrada en SAT |
| Digifact apagado (o la empresa sin canal) | `demo` (`simulado: true`) | Simulador con NIT **ficticios** (`10000011`, `1000002K`, `10000038`); `99900017` simula un fallo del proveedor; cualquier otro NIT → «no encontrado». El nombre NO lleva «(DEMO)»: la advertencia se muestra aparte |
Credenciales, token y llamadas autenticadas solo existen en el servidor; el navegador nunca recibe nada de Digifact. Cada consulta se audita (`receptor.nit_consultado`) con el origen y si hubo coincidencia, **sin guardar el NIT**.
**No verificado:** la documentación oficial de Digifact no pudo releerse en esta sesión (dominio fuera de la red permitida); la consulta de NIT en PRODUCCIÓN tampoco está verificada (producción sigue bloqueada).

## Consumidor final (CF)
- «CF», «cf», «Cf», «C F» (también con espacios o guion) se normaliza a **`CF`**, tipo CF, nombre `CONSUMIDOR FINAL` (no editable) y **nunca se consulta**. De CF a un NIT: se limpian los campos y se consulta; de vuelta a CF se restaura el nombre. El servidor guarda siempre CF/CF/`CONSUMIDOR FINAL`.
- **Condición de SAT investigada:** según las preguntas frecuentes del portal oficial de SAT, «Consumidor Final» solo puede colocarse en facturas por **montos menores a Q2,500.00** (Reglamento de la Ley del IVA, art. 30 núm. 9, reformado por el Acuerdo Gubernativo 12-2023); para montos iguales o mayores el receptor se identifica con NIT, o con CUI si es persona individual sin NIT. La SAT también persigue el **fraccionamiento** de facturas a CF para evadir el tope (no se detecta aquí). Fuente: `portal.sat.gob.gt/portal/preguntas-frecuentes/cumplimiento-tributario/` (leída vía búsqueda; **el texto oficial no pudo abrirse desde esta sesión** y debe contrastarse con un contador antes de la emisión real). El estado de la Resolución SAT-DSI-393-2025 (CUI como identificador) no quedó confirmado y no se implementa.
- **Regla aplicada en la DEMO:** la API y la pantalla rechazan guardar una factura a CF con base ≥ Q2,500.00 (los precios incluyen IVA; los impuestos finales siguen pendientes). No habilita la emisión real, que sigue bloqueada hasta tener todas las validaciones fiscales.

## Pruebas (en verde en local, Chromium)
- `tests/receptor_nit_test.ts` (11): NIT válido, una sola consulta tras la espera, escribir dígito a dígito, cambios rápidos con respuestas fuera de orden y cancelación, sin coincidencia, error del proveedor (sin detalles internos), nombre manual conservado, nombre autollenado limpiado, todas las variantes de CF sin consulta, CF ↔ NIT, CUI sin consulta, consulta al salir del campo, temporizador real y coherencia con el servidor.
- `tests/receptor_nit_api_test.ts` (4, PostgreSQL real): simulador con datos ficticios y origen rotulado, errores, auditoría sin el NIT, Digifact TEST simulado (CF no genera llamadas), empresa sin canal → simulador, permiso y tope por minuto, y el tope de Q2,500.00 de CF al guardar (sin dejar receptores a medias).
- `tests/e2e_receptor.cjs`: navegador a 390 px (indicador, una consulta, cambios rápidos, sin coincidencia, error, nombre manual, CF y su tope, Clientes sin botón manual) y a 320/360/390/430 px sin desbordes ni solapamientos. Suites existentes (`e2e`, `e2e_acceso`, `e2e_practico`, `e2e_movil`, PostgreSQL, nube local) sin regresiones.
