# Fase 3 — Procedimiento propuesto: primera prueba real de llenado en seco

> **ESTADO: PROPUESTA. NO AUTORIZADA. Nada de esto se ejecuta hasta que la persona responsable lo autorice por escrito, etapa por etapa.** No se usa Playwright contra SAT, no se pulsa Vista Previa, no se guarda ni se emite. `main` no se toca.

> **Etapa 1 (solo comprobar): autorizada, procedimiento en `docs/fase-3-etapa-1-procedimiento.md`, pendiente de revisión conjunta antes de ejecutar. Etapa 2: BLOQUEADA.**
> **Etapa 0: completada en Windows con Chrome (27/27, 32/32, 18/18 en su momento).** Entregables: ZIP de la PoC, guía de instalación en Windows y verificación solo con páginas simuladas. Las etapas 1 y 2 **siguen sin autorizar**.

## 1. Qué falta antes de poder empezar (bloqueos reales)
| # | Falta | Quién | Nota |
|---|---|---|---|
| 1 | **Node.js 20+ y la PoC en tu Windows** (hoy no hay Node ni Git) | tú + yo | Instalar Node (instalador oficial) y recibir la PoC como un ZIP (sin Git); yo lo preparo cuando lo autorices. |
| 2 | **Chrome con puerto de depuración y un perfil separado** | tú | Obliga a **iniciar sesión otra vez** en SAT (otra sesión). **No sabemos** si SAT invalida la sesión anterior. Cerrar y reabrir tu Chrome actual **no** se hace. |
| 3 | **Revisión específica de la petición `GET felav02.c.sat.gob.gt/fel-rest/rest/publico/consultaFallecido/CF`** (otro dominio, preflight, 200, XHR) | persona responsable | **No autorizada.** No se asume que devuelva el nombre. Con la guardia actual **se bloquearía**; hay que decidir (a) permitir esa ruta exacta con `permitir_get` revisado, o (b) mantenerla bloqueada y ver cómo reacciona la página en la Etapa 2. Antes de la Etapa 2. |
| 4 | Decisiones de datos: **tipo de documento** (qué opción de la lista), moneda (valor por defecto de la página), **fecha** (por defecto), identificación NIT + **CF** | tú | Todo ficticio o genérico; ningún NIT de terceros. |
| 5 | Texto exacto de la respuesta de CF («Consumidor Final»: mayúsculas/acentos) | tú | Para la lectura de verificación. |
| 6 | Revisión de los localizadores: pasar `verificado:false` → `true` **solo tras** la etapa 1 | tú + yo | Hoy ninguno está comprobado en una ejecución. |
| 7 | **Términos de uso de SAT y autorización** para automatizar | persona responsable | No revisados. |
| 8 | Qué hacer con el formulario al terminar (descartar sin guardar) y si SAT guarda borradores | tú | Se desconoce si el portal guarda algo por sí solo. |

## 2. Etapas (cada una necesita tu autorización aparte)
**Etapa 0 — Preparación (nada contra SAT):** instalar Node, recibir el ZIP, verificar huellas, `npm install`, crear el perfil de Chrome separado **sin abrir SAT todavía**.
**Etapa 1 — Solo comprobar (`ejecutar --solo-comprobar`): solo lectura.** (No escribe ni sale de ningún campo, así que **no dispara** esa petición.) Requiere en el entorno `FEL_AUTORIZACION_SAT=si` y `FEL_ETAPA_AUTORIZADA=etapa1`; sin ellas el programa **se niega**. La etapa 2 exige `etapa2`; una no autoriza a la otra. Playwright se conecta al Chrome de perfil separado con sesión iniciada **a mano**, abre el iframe indicado y **resuelve cada localizador** (existe, único, visible/habilitado/editable) **sin escribir, elegir, marcar, salir de campos ni pulsar nada**; confirma que las opciones pedidas existen. Resultado: tabla OK/FALLO por paso. Si todo es OK, tú marcas `verificado:true`.
**Etapa 2 — Llenado en seco con datos ficticios:** llena tipo de documento, moneda, radio NIT, NIT = **CF**, sale del campo (consulta GET), lee la respuesta, dirección ficticia y una línea de prueba (cantidad, descripción «… PRUEBA — NO EMITIR», precio, descuento); lee el total calculado; **se detiene** (paso `detener`). Tú revisas visualmente y **descartas sin guardar** (cierras la pestaña o recargas a mano). Sin Vista Previa, guardar ni emitir.
**Etapa 3 — Cierre:** revisar el registro (tiempos, errores, `lecturas_xhr`, `solicitudes_bloqueadas`, sin valores) y decidir si se repite.

## 3. Salvaguardas que se mantienen
Vista Previa, Guardar, Eliminar, Editar impuestos y «Agregar …» bloqueados (por texto, `title` y `ng-click`); red de solo lectura (todo POST/PUT/PATCH/DELETE abortado; GET con ruta de emisión/guardado abortado; lecturas XHR solo se registran como método+host+ruta saneada); dominios permitidos (`felav.c.sat.gob.gt`, `farm3.sat.gob.gt`) también para el **host del iframe**; paso `detener` obligatorio; confirmación manual de que la sesión es de la empresa; datos ficticios; sin credenciales; el registro no guarda valores, cookies ni cabeceras; sin `clic` repetible; sin Supabase.

## 4. Se aborta de inmediato si
Aparece una ventana de confirmar o guardar; la guardia bloquea algo inesperado; una ruta de red contiene palabras de emisión o guardado; la sesión se cierra; el iframe no es el esperado; un localizador no es único; hay cualquier duda.

## 5. Plantillas de autorización (copiar y pegar, una por etapa)
- **Etapa 0:** «Autorizo la ETAPA 0 (preparación, nada contra SAT): instalar Node y recibir el ZIP de la PoC.»
- **Etapa 1:** «Autorizo la ETAPA 1 (solo comprobar, solo lectura) con Playwright contra el formulario real en el iframe indicado, sesión iniciada por mí en el perfil separado, **sabiendo que implica iniciar otra sesión SAT**. No autorizo llenado, Vista Previa, guardado ni emisión.»
- **Etapa 2:** «Autorizo la ETAPA 2 (llenado en seco con datos ficticios y NIT CF, deteniéndose antes de Vista Previa). Yo descarto el formulario sin guardar. No autorizo Vista Previa, guardado ni emisión.»
