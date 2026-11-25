# Fecha de emisión de la factura (emisión con fecha anterior)

Estado (25/11/2026): **implementada y probada en la demostración (certificación simulada). La regla de los cinco días está PENDIENTE de confirmar con el texto oficial vigente.**

## 1. La regla y su estado de confirmación
- **Regla adoptada** (investigación del propietario): la fecha de emisión puede ser anterior a la de certificación hasta **5 días calendario**; nunca futura. La fecha de **certificación la asigna el certificador** y no se puede escribir en NEXA FEL.
- **Confirmación oficial: NO lograda.** En una búsqueda pública no se pudo acceder al texto oficial con ese plazo. Lo encontrado:
  - La SAT publicó la **Resolución SAT-DSI-1793-2026** el 11/11/2026 en el Diario de Centro América, **vigente desde el 12/11/2026** (procedimientos y requisitos para emitir, validar, entregar y conservar DTE). Referencia secundaria: [La Voz de Xela](https://lavozdexela.com/noticias/sat-actualiza-las-disposiciones-para-emitir-facturas-electronicas/); un análisis de [Vesco Consultores](https://vescco.tax/blog/nueva-resolucion-fel-sat-2026-9-puntos-que-pueden-costarle-el-credito-fiscal/) afirma que esa resolución no fija un plazo de aceptación o rechazo por parte de la SAT.
  - Una fuente indica que las validaciones de «fecha y hora de emisión» se actualizan para que la hora esté en la zona horaria de Guatemala ([Thomson Reuters](https://europe.thomsonreuters.com/compliance/regulatory-updates/guatemala)), sin fecha de vigencia ni detalle técnico.
  - Marco general: Acuerdo de Directorio 13-2018 y reformas (15-2020, 26-2019); ninguna fuente accesible cita el plazo de cinco días ni sus excepciones.
- **Pendiente (lo confirma una persona con acceso al texto oficial o al contador / soporte de Digifact):** el plazo exacto y su cómputo (¿días calendario o hábiles?, ¿contados hasta la certificación?), la fecha de entrada en vigor y las excepciones.
- **Cómo se cambia si el texto oficial dice otra cosa:** una sola constante, `FECHA_EMISION_MAX_DIAS` en `fel/proveedores/src/fecha_emision.ts` (y el mismo valor en `ventanaLocal` de `web/js/factura.js`, que solo se usa si el servidor no responde). Todo el flujo la sigue.
- **Sin riesgo fiscal mientras tanto:** la certificación real está deshabilitada; en la demostración todo es simulado o Digifact TEST.

## 2. Qué ya existía (auditoría del recorrido de la fecha)
| Tramo | Antes |
|---|---|
| Formulario (`web/js/factura.js`) | Campo de fecha (dd/mm/aaaa) con selector nativo; **default con `new Date().toISOString()` (UTC)** |
| API (`src/api.ts`) | Solo validaba el formato AAAA-MM-DD; una fecha mal escrita se guardaba como «sin fecha» |
| Base | Columna `fecha_emision_prevista` (date); el disparador del documento ya la hace inmutable al revisar/certificar |
| Camino a Digifact (`proveedores/src/felgt_servicio.ts`) | `preparar` **ignoraba la fecha elegida** y enviaba la fecha y hora de ese momento en `Header.IssuedDateTime` |
| Notas (`catalogo_dte.ts`) | Ya existía la regla «la nota no puede ser anterior al documento de origen» |
| PDF / detalle | El detalle devolvía un objeto `Date` y el PDF imprimía «Fecha: Sat Nov 21» |

## 3. Qué se implementó
- **Una sola implementación de la regla:** `proveedores/src/fecha_emision.ts` (`hoyGt`, `ventanaEmision`, `validarFechaEmision`, `fechaHoraEmisionGt`, `fechaReal`; esta última sustituye a la copia local de `catalogo_dte.ts`).
- **Zona horaria:** todo en `America/Guatemala` (UTC-6 fijo). La API publica `GET /api/fecha-emision` (`{hoy, minima, maxDias}`) con el **reloj del servidor**; el navegador no decide qué día es hoy (si el servidor no responde, calcula con la zona de Guatemala, nunca con UTC). Entre las 18:00 y las 23:59 de Guatemala UTC ya marca el día siguiente: ahora «hoy» no se adelanta.
- **Interfaz:** se mantiene el campo de fecha; por defecto, hoy; el selector solo admite de hoy a 5 días atrás (cambia de mes y año dentro del plazo); una fecha anterior muestra un aviso discreto de una línea («Fecha anterior (hace N días). La fecha de certificación la asigna el certificador.» y, si cambia el mes, que cuenta para el período de IVA de ese mes); fuera del plazo se señala en rojo y no se guarda; sin pantallas ni pasos nuevos.
- **Servidor (`api.ts`):** valida al guardar (formato, fecha real, no futura, no anterior al plazo), con 422 y código `fecha_emision`; sin fecha usa la de hoy en Guatemala; una fecha que no cambia no se vuelve a juzgar al guardar otra cosa. Se **revalida** al marcar «revisado» y justo antes de certificar (también en el camino simulado). Nunca cambia la fecha de un borrador vencido: lo deja como está y le impide revisarse o certificarse hasta que se elija otra.
- **Digifact (`felgt_servicio.ts`):** `preparar` usa la fecha **elegida** (`DocumentoFel.fechaEmisionPrevista`, leída de la base) con la hora local de Guatemala y el desfase `-06:00` en `Header.IssuedDateTime`; la fecha entra en la huella del documento (cambiarla obliga a preparar de nuevo y da otra referencia); `certificar` la **revalida** antes de enviar y conserva la fecha preparada (no la de ese instante). Un código de error nuevo, `FECHA_EMISION` (422).
- **Auditoría:** `documento.fecha_emision_fijada` (al crear con una fecha distinta de hoy) y `documento.fecha_emision_cambiada`, con anterior, nueva, días atrás, si es de un mes anterior y el «hoy» del servidor.
- **Las tres fechas separadas:** creación (`creado_en`), emisión (`fecha_emision_prevista`, la elegida) y certificación (`certificacion_verificada_en`, asignada por el certificador/proceso). Un documento certificado no cambia de fecha (lo impide la base).
- **Correcciones relacionadas:** el detalle entrega la fecha siempre como texto AAAA-MM-DD (el PDF ya no imprime «Sat Nov 21»); 18 archivos de pruebas y la **prueba de humo de la publicación** armaban la fecha con UTC y fallaban entre las 18:00 y las 23:59 de Guatemala: ahora usan la zona de Guatemala; el default del formulario antiguo `app/js/pantallas/borradores.js` también.

## 4. Notas, recibos y restricciones fiscales
- **NCRE / NDEB:** la misma ventana de fecha; además la nota no puede ser anterior a la emisión de su documento de origen; su certificación sigue bloqueada.
- **RECI:** misma ventana para el borrador; certificación bloqueada.
- **Mes anterior (informativo, no bloquea):** una factura de un mes anterior cuenta para el período de IVA de ese mes, cuya declaración puede estar ya presentada. Se avisa en la interfaz y se deja constancia en la auditoría. **Pendiente de confirmar con el contador** si hay restricciones adicionales (p. ej. una declaración ya presentada).
- **XML:** la demostración no genera el XML; envía el NUC JSON con `Header.IssuedDateTime`, y Digifact lo transforma a XML. La prueba comprueba el NUC enviado.

## 5. Pruebas
- `proveedores/pruebas/fecha_emision_test.ts` (regla pura): hoy, 1–5 días atrás, 6 atrás, un día futuro, cambio de mes y de año, bisiesto, 18:00–23:59 de Guatemala, cambio de día con un borrador abierto, formato `Header.IssuedDateTime`.
- `proveedores/pruebas/felgt_servicio_test.ts` (8 casos nuevos): la fecha elegida viaja en el NUC (0 a 5 días), rechazo de 6 días y futuro sin guardar ni enviar, 18:00–23:59, borrador que vence antes de certificar, cambio de día con el borrador abierto, cambio de fecha tras preparar, documentos sin fecha, y NCRE/NDEB/RECI sin certificar.
- `demo-facturacion/tests/fecha_emision_api_test.ts`: la API real con reloj inyectado — ventana, manipulación directa, fecha por defecto en Guatemala, borrador vencido, auditoría, certificación simulada, inmutabilidad del documento certificado (API y base), PDF con la fecha elegida, cambio de mes y de año.
- `demo-facturacion/tests/e2e_fecha_emision.cjs`: navegador en 390 px y 1100 px, con el reloj del dispositivo en otra zona: default de hoy en Guatemala, límites del selector, aviso discreto, fuera de plazo rechazado y petición directa rechazada.

## 6. Limitaciones pendientes
- Confirmar el plazo, su cómputo, su vigencia y excepciones (sección 1).
- La hora de una fecha anterior es la hora local actual del momento de preparar; si Digifact o la SAT exigieran otra regla para la hora, se cambia en `fechaHoraEmisionGt`.
- Una restricción a nivel de base de datos (disparador) sería una defensa adicional; hoy la API es la única vía de escritura (las funciones `fel_op_*` no son ejecutables por los roles de la API) y valida; no se creó una migración nueva.
- El formulario antiguo `fel/app` (no la demostración) solo recibió la corrección de zona horaria del valor por defecto.
