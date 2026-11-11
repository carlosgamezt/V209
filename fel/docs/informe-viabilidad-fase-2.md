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

## 2. Qué pasó con CF (observación 2d) — y una corrección
- **Qué cambió con CF:** solo el control `resultadoNIT.nombre` (c23) pasó de oculto y deshabilitado a **visible y habilitado**; el resto de controles, selectores y estados no cambió. Su `ng-disabled` es `nitReceptor.toUpperCase() !== CONSTANTE.CF`: la propia página trata CF como caso especial y el campo es editable solo con CF. Apareció el texto «Consumidor Final».
- **Petición observada por la persona (Chrome DevTools):** `GET` + preflight, **HTTP 200, XHR**, a **`felav02.c.sat.gob.gt`** (otro dominio que el formulario, `felav.c.sat.gob.gt`; por eso hay preflight/CORS), ruta **`/fel-rest/rest/publico/consultaFallecido/CF`**.
- **Corrección de mi análisis anterior:** yo había tratado esa petición como «la consulta del receptor que devuelve el nombre». **No hay base para eso**: `consultaFallecido` sugiere una validación específica (fallecidos). **El origen de «Consumidor Final» no está confirmado** (puede ser una constante de la página o la respuesta de otra petición). Los comentarios del mapeo se corrigieron.
- **Estado de revisión:** `felav02.c.sat.gob.gt` y esa ruta están **PENDIENTES de revisión específica y NO autorizados** (no están en `dominios_permitidos` ni en `permitir_get`).
- **El mapeo del receptor sigue válido** para localizar los campos (radio NIT, NIT por `ng-model`, dirección, nombre con `:visible`).

## 3. Qué implica para la guardia de red
| Aspecto | Resultado (probado en simulación con hosts reales resueltos a localhost) |
|---|---|
| **Cambio de política (nuevo)** | Un XHR/fetch **GET a un dominio que no está en `dominios_permitidos` se BLOQUEA por defecto** y se registra. Solo pasa con una regla **`permitir_get`** (host exacto + ruta_prefijo concreta + motivo + `revisado:true`), nunca con rutas de emisión/guardado ni con prefijo «/». Hoy `permitir_get` está **vacío**. |
| Con esta guardia y CF | La petición a `felav02…/consultaFallecido/CF` **se bloquearía**. El efecto en la página (validación pendiente, mensaje de error, formulario bloqueado, o ninguno) **se desconoce** y hay que decidirlo antes de la Etapa 2. |
| XHR a los dominios permitidos | Pasan y se registran (`lecturas_xhr`: método + host + ruta saneada; sin parámetros, cabeceras ni cuerpos). |
| Recursos estáticos y navegaciones | Se permiten (scripts, imágenes, estilos, documentos): no se filtran por host. |
| Preflight (OPTIONS) | Con la interceptación activa **Playwright lo responde por su cuenta**; al servidor solo llega el GET. |
| GET con rutas de emisión/guardado | Siguen bloqueados (emitir, certificar, firma, guardar, anular, enviar…). |
| Límite | WebSockets y service workers no están cubiertos. |
**Experimento opcional (NO autorizado, solo propuesta):** bloquear esa URL en DevTools (Network → bloqueo de solicitudes) y repetir CF para ver si el nombre sigue apareciendo; así se sabría si viene de esa petición.

## 4. Estado del mapeo (`config/mapeo.sat-preliminar.json`)
**Confirmado en la observación (existe, único, estable; no comprobado en ejecución):** radio NIT, NIT del receptor y su consulta (blur + lectura), dirección, línea 0 (tipo, cantidad, descripción, precio, descuento, otros descuentos, total de lectura), tipo de documento y moneda (listas), pestañas.
**Pendiente:** revisión específica de la petición a `felav02` (dominio y ruta); fecha de emisión (solo lectura con calendario → dejar la de la página); opción de tipo de documento (decisión de la persona); impuestos (sin campos observados, probablemente automáticos); varias líneas (patrón por comprobar); texto exacto de la respuesta CF (mayúsculas/acentos); indicador de sesión activa y manifestación del cierre; errores de validación reales (solo aparecen al validar, que está prohibido).

## 5. Lo que se añadió a la PoC en esta fase
Observadores 1→3 (el 2 retirado por privacidad), análisis y comparación de observaciones, iframe con comprobación de dominio del marco, pasos `salir_del_campo` y `verificar_ausente`, estrategias `ng_model`/`clase`/`nombre+tag`, lectura con reintento, **modo `--solo-comprobar`** (resuelve y comprueba localizadores sin escribir ni pulsar nada), registro de lecturas XHR, bloqueo de GET sensibles. Pruebas: 26 tests, 32 casos con Chrome y 18 de simulación AngularJS con hosts reales resueltos a localhost (el navegador de pruebas no resuelve ningún otro nombre).

## 6. Riesgos y límites que siguen abiertos
Simulación ≠ portal (tiempos, mensajes, máscaras, reglas); validaciones que solo ocurren en Vista Previa nunca se verán; `angular.element().scope()` probablemente no esté disponible en producción (se verifican valores del DOM); sesión SAT (cierre, un segundo inicio de sesión podría cerrar el primero); **términos de uso de SAT y autorización para automatizar**: no revisados.
