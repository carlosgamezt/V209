# Informe de viabilidad — Fase 2 (observaciones reales 1, 2a y 2d)

> Resume lo aprendido del portal FEL real **solo con observaciones de estructura hechas por una persona** (nada de Playwright contra SAT, ningún clic en Vista Previa, nada guardado ni emitido). **No contiene datos personales ni fiscales**: se revisaron las observaciones (una opción de lista con un nombre propio se descartó y no está en el repositorio) y no hay valores de campos, cookies ni tokens. `main` no se tocó.
> Veredicto actual: **viabilidad técnica favorable, condicionada** a una prueba en seco controlada (ver `docs/fase-3-procedimiento-llenado-en-seco.md`, pendiente de autorización).

## 1. Qué es el portal (hechos observados)
| Hecho | Evidencia |
|---|---|
| Formulario en un **iframe** `felav.c.sat.gob.gt/fel-web/privado/vistas/fel.jsf` dentro de la página del menú (`farm3.sat.gob.gt`, dato de la persona) | observaciones 1, 2a, 2d |
| **AngularJS 1.5.8 + jQuery**; no hay PrimeFaces ni `<form>` | 2a |
| 211 controles (30–31 visibles); estructura **idéntica** en las tres observaciones | comparación |
| Identificadores estables: **`ng-model`** (casi todos los campos), `name` con índice en la tabla de artículos, pestañas por rol y texto | 2a |
| Las acciones se conocen por `ng-click`: Vista Previa = `validarInformacion()`, Eliminar = `eliminarItem()`, Agregar = `agregarItem()`, Editar impuestos = `mostrarModalImpuestos()` | 2a |
| **No existe botón de emitir/guardar en el DOM**; la emisión no es alcanzable sin pasar por Vista Previa (hipótesis) | 1, 2a |

## 2. Consulta del receptor con CF (observación 2d)
- **Qué cambió con CF:** solo el control `resultadoNIT.nombre` (c23) pasó de oculto y deshabilitado a **visible y habilitado**; el resto de controles, selectores y estados no cambió (solo clases `ng-*` de validación). Su `ng-disabled` es `nitReceptor.toUpperCase() !== CONSTANTE.CF`: **solo es editable cuando el NIT es CF**.
- **Red observada por la persona:** una solicitud **GET + preflight (OPTIONS)**, estado 200; el portal devolvió «Consumidor Final». *Faltan el host y la ruta (enmascarada) de esa petición; no se aportaron.*
- **El mapeo del receptor sigue válido:** radio NIT por etiqueta (la opción NIT venía seleccionada por defecto: sin cambios de clases al pulsarla), NIT por `ng-model` único y visible, dirección sin cambios, nombre devuelto por `ng-model` con `:visible` (1 visible de 3). Se añadieron al mapeo `salir_del_campo` en el NIT y la lectura de la respuesta.

## 3. Qué implica la consulta GET para la guardia de red
| Aspecto | Resultado (verificado en la simulación con hosts reales resueltos a localhost) |
|---|---|
| ¿Bloquea la guardia un GET? | **No**: GET/HEAD/OPTIONS pasan. **No hace falta `permitir_post`.** |
| Preflight (OPTIONS) bajo interceptación | **Hallazgo:** con la guardia activa Playwright **responde el preflight por su cuenta**; al servidor solo llega el GET, y el nombre aparece. Es normal y no afecta al flujo. |
| GET con efectos | Un GET «no debería» cambiar nada, pero no se confía: **nuevo** bloqueo de GET/HEAD dinámicos (fetch/XHR/documentos) cuya ruta contiene emitir, emisión, certificar, firma, guardar, anular, enviar o transmitir. Si la ruta real de la consulta contuviera una de esas palabras quedaría bloqueada y hay que verla (por eso pedimos la ruta). |
| Visibilidad | **Nuevo:** las lecturas fetch/XHR permitidas se registran como `lecturas_xhr` (método + host + ruta saneada; un NIT largo en la ruta sale `:id`; nunca parámetros, cabeceras ni cuerpos). |
| Moderación del motor | `salir_del_campo` dispara la consulta; `leer` reintenta hasta que llega el valor asíncrono. |
| Límite | Solo se vio CF. **Un NIT real** podría usar otra ruta o un POST: no se sabe. |

## 4. Estado del mapeo (`config/mapeo.sat-preliminar.json`)
**Confirmado en la observación (existe, único, estable; no comprobado en ejecución):** radio NIT, NIT del receptor y su consulta (blur + lectura), dirección, línea 0 (tipo, cantidad, descripción, precio, descuento, otros descuentos, total de lectura), tipo de documento y moneda (listas), pestañas.
**Pendiente:** host/ruta de la consulta; fecha de emisión (solo lectura con calendario → dejar la de la página); opción de tipo de documento (decisión de la persona); impuestos (sin campos observados, probablemente automáticos); varias líneas (patrón por comprobar); texto exacto de la respuesta CF (mayúsculas/acentos); indicador de sesión activa y manifestación del cierre; errores de validación reales (solo aparecen al validar, que está prohibido).

## 5. Lo que se añadió a la PoC en esta fase
Observadores 1→3 (el 2 retirado por privacidad), análisis y comparación de observaciones, iframe con comprobación de dominio del marco, pasos `salir_del_campo` y `verificar_ausente`, estrategias `ng_model`/`clase`/`nombre+tag`, lectura con reintento, **modo `--solo-comprobar`** (resuelve y comprueba localizadores sin escribir ni pulsar nada), registro de lecturas XHR, bloqueo de GET sensibles. Pruebas: 24 tests, 31 casos con Chrome y 18 de simulación AngularJS con hosts reales resueltos a localhost (el navegador de pruebas no resuelve ningún otro nombre).

## 6. Riesgos y límites que siguen abiertos
Simulación ≠ portal (tiempos, mensajes, máscaras, reglas); validaciones que solo ocurren en Vista Previa nunca se verán; `angular.element().scope()` probablemente no esté disponible en producción (se verifican valores del DOM); sesión SAT (cierre, un segundo inicio de sesión podría cerrar el primero); **términos de uso de SAT y autorización para automatizar**: no revisados.
