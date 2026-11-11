# Etapa 2 — llenado controlado del formulario FEL (auditoría, diseño y procedimiento)

**Estado: PREPARADA EN LOCAL. NO AUTORIZADA. NO EJECUTADA contra SAT.**
La autorización de la Etapa 1 no habilita la Etapa 2. La Etapa 2 exige una autorización nueva, explícita e independiente (plantilla en D.6).

## A. Auditoría técnica (de lectura a escritura)

La Etapa 1 solo comprobó que los localizadores existen y son únicos, visibles y editables. **No demuestra que escribir sea inocuo.**

| Acción de la Etapa 2 | Efecto conocido | Efecto desconocido | Mitigación |
|---|---|---|---|
| Verificar radio NIT | — (solo lee `isChecked`) | — | Nunca se pulsa: su `ng-change` ejecuta `asignacionesRadioNIT()` y `onChangeComboDestinoDespacho()`; el radio CUI limpia el receptor. Si no está marcado, se detiene y lo marcas tú. |
| Escribir dirección | `ng-model` | Handlers `ng-blur`/jQuery no observados | Reposo + vigilancia tras escribir |
| Tipo de línea (Servicio) | — | Efectos al cambiar | Reposo + vigilancia |
| Cantidad / Precio / Descuento | `ng-change`: `calcularTotal(0)`, `limpiarFrasesEspeciales()`, `limpiarReferencia()` | ¿Autoguardado, consultas de red, diálogos? | Guardia de red + detención ante cualquier solicitud bloqueada o diálogo |
| NIT = CF y salir del campo (**solo tramo 2B**) | Con CF se observó un GET a `felav02.c.sat.gob.gt/fel-rest/rest/publico/consultaFallecido/CF` (otro dominio, no autorizado) | Origen del texto «Consumidor Final» no confirmado | Va aparte (2B). Sin `permitir_get` aprobado y fechado la guardia bloquea la petición y la ejecución se detiene. |
| Leer Total0 | Calculado de forma asíncrona | Formato numérico real (coma/punto) | Comparación numérica con separador decimal declarado; si no coincide, se detiene |

Puntos ciegos: handlers `ng-blur/ng-keyup/ng-focus` y jQuery no capturados; no se observó subtotal/total del documento (solo total de línea); se desconoce si el portal autoguarda; cambiar la moneda ejecuta `detalleFactura = []` (borra líneas) → **no se toca**.

Protecciones existentes que se mantienen: guardia de red (POST/PUT/PATCH/DELETE abortados; XHR a dominios no listados bloqueados; rutas de emisión bloqueadas), clasificación de controles prohibidos/ambiguos, vocabulario cerrado de pasos, localizadores únicos, monitor pasivo de sesión, autorización por etapa.

## B. Plan de implementación

- **Modo `estricto`** (automático con dominios reales o `--estricto`): sin reanudación ni progreso; tras cada escritura se espera un reposo y se vigila; **cualquier** solicitud bloqueada, diálogo o pérdida de sesión DETIENE (`detenido_por_alerta`, `sesion_perdida`). Antes la vigilancia solo existía en `--solo-comprobar`.
- **Lista cerrada de campos escribibles en el código** (`ETAPA2_ESCRITURA`): NIT, dirección, tipo de línea, cantidad, descripción, precio, descuento y otros descuentos de la línea 0. Otro campo, `clic_seguro` o `marcar` → el mapa se rechaza. `permitir_post` debe estar vacío; `permitir_get` exige `aprobado_por` y `fecha`.
- **`verificar_marcado`**: comprueba radios sin pulsarlos.
- **`compararValor`**: comparación numérica con separador decimal declarado, nunca supuesto.
- **`--hasta=ID`**: tramos **2A** (hasta `p150-linea0-leer-total`, sin NIT) y **2B** (NIT=CF, salir del campo, leer respuesta).
- **Autorización**: `FEL_AUTORIZACION_SAT=si`, `FEL_ETAPA_AUTORIZADA=etapa2`, `FEL_CONDICIONES_USO_REVISADAS=si`, `FEL_EMPRESA_CONFIRMADA=<alias>`, confirmación manual y NIT solo «CF».
- **Mapa** `config/mapeo.sat-etapa2.json`: entregado **sin confirmar a propósito** (indicador de sesión y `p026` en `verificado:false`); no arranca hasta que una persona los confirme en su copia local.

Pruebas locales (sin SAT): unitarias 32, navegador 32/32, simulación AngularJS 35/35 (10 de Etapa 2: tramo 2A feliz, radio no marcado, formatos de total, autoguardado inesperado, diálogo, sesión caducada, GET a dominio no listado con/sin regla, localizador ambiguo, acciones inalcanzables, mapa sin confirmar). No se debilitó ninguna prueba existente.

## D. Procedimiento Windows (solo si se autoriza)

**D.1 Condiciones previas.** 1) Autorización nueva (D.6). 2) **Revisar las condiciones de uso de SAT**: si la automatización de llenado no es claramente compatible, NO ejecutar. 3) Chrome con perfil temporal separado, inicio de sesión manual, una sola empresa de prueba confirmada. 4) Rama `fel-fase-1-0` validada y las tres baterías en verde. 5) Radio NIT marcado a mano. 6) Copia local del mapa (`*.local.json`) con el indicador de sesión confirmado por ti (y `p026` solo para 2B).

**D.2 Ejecución (PowerShell)**
```powershell
$env:FEL_AUTORIZACION_SAT="si"; $env:FEL_ETAPA_AUTORIZADA="etapa2"
$env:FEL_CONDICIONES_USO_REVISADAS="si"; $env:FEL_EMPRESA_CONFIRMADA="<alias>"
node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=config/mapeo.sat-etapa2.local.json `
  --datos=config/datos-ficticios-lineas.json --hasta=p150-linea0-leer-total
```
El tramo 2B solo tras aprobar 2A y revisar específicamente la petición a felav02 (`permitir_get` con `aprobado_por` y `fecha`, host exacto y ruta concreta).

**D.3 Detención inmediata:** campo ambiguo o ausente · solicitud bloqueada · diálogo inesperado · sesión perdida · total que no coincide · error de validación visible · cualquier duda. Tras detenerse **no se reanuda**: se limpia y se analiza.

**D.4 No hacer:** Vista Previa, Guardar, Certificar, Emitir, Enviar, Eliminar, Editar; cambiar moneda o fecha; resolver CAPTCHA o saltar controles; usar datos reales.

**D.5 Limpieza:** cerrar Chrome, eliminar el perfil temporal, `Remove-Item Env:FEL_*`, comprobar manualmente que 0 facturas quedaron emitidas y que no queda borrador, conservar solo el registro saneado.

**D.6 Plantilla de autorización (la rellena la persona responsable)**
> Autorizo la Etapa 2 (tramo __) del proyecto FEL: rama fel-fase-1-0 commit ____; empresa de prueba ____ confirmada manualmente; datos ficticios; una sola línea; condiciones de uso de SAT revisadas el ____ por ____; sin Vista Previa, guardar ni emisión; criterios de detención de D.3 aceptados. Firma/fecha: ____

## E. Criterios de aprobación y de parada

**Aprobar 2A** si: 0 errores, 0 solicitudes bloqueadas, 0 diálogos, 0 facturas, total leído coincide numéricamente y limpieza completada. **Aprobar 2B** además si la petición a felav02 fue revisada y aceptada y el texto de respuesta se confirmó.
**Parar el proyecto de llenado automático** si: aparece autoguardado o cualquier escritura no solicitada; los términos de uso no permiten la automatización; el portal reacciona de forma impredecible a los eventos; o ocurre cualquier emisión no intencionada.

## F. Limitaciones

La simulación usa AngularJS real pero **no es el portal**: no reproduce handlers desconocidos, el formato numérico real, el posible autoguardado ni el cierre de sesión por inactividad. Se desconoce el efecto real de `ng-change/ng-blur` y de los radios. No se observaron subtotal/total del documento. El flujo completo de `bin/ejecutar.mjs` en modo estricto con Chrome/CDP no se ensayó de extremo a extremo (solo sus rechazos de mapa y autorización y las pruebas del motor). Nada garantiza que la Etapa 2 funcione ni sea inocua en el portal real. Recomendado antes de 2B: observación pasiva (sat-2e) de los manejadores de eventos.
