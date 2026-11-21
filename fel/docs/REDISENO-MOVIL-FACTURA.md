# NEXA FEL · Rediseño móvil de la factura (implementado en local; NO publicado)
Estado: 17/11/2026. Todo SIMULADO · SIN VALOR FISCAL. Sin cambios en migraciones, funciones SQL, permisos, auditoría ni aislamiento por empresa. Capturas en `docs/rediseno-movil/`.

## Qué cambió
| Área | Antes | Ahora |
|---|---|---|
| Nueva factura | Asistente de 3 pasos (Datos · Ítems · Vista previa), una fila de 5 campos por ítem | **Una sola pantalla**: receptor + establecimiento + fecha/observaciones, ítems como **filas compactas** (descripción, `cant × precio · descuento`, neto), «Agregar ítem» **al final de la lista**, resumen compacto (subtotal, descuentos, **total provisional** sin impuestos) |
| Captura de ítems | Cinco campos por fila, todos a la vez | **Hoja de edición** (desde abajo en móvil, diálogo en PC): descripción → cantidad → precio con **Intro/«Siguiente»**; Intro en el precio guarda y deja la hoja lista para el **siguiente ítem** («Agregar y otro»); descuento opcional; neto en vivo; concepto del catálogo rellena el precio |
| Acciones | 5 botones en fila + botón flotante «+» (se superponían) | **Una acción principal** (Guardar borrador → Marcar como revisado → Vista previa e impresión, según el estado) + menú **«Más acciones»** (vista previa e impresión, validar con el proveedor, revisar, volver a borrador, archivar, volver a facturas). Sin botón flotante |
| Zonas seguras | Barra a 66 px fijos (quedaba tapada por la navegación) | La barra se apoya sobre la navegación inferior con su **altura medida** (`--nav-movil-h`) y `env(safe-area-inset-bottom)`; `scroll-padding` evita que lo fijo tape lo enfocado; avisos emergentes arriba (no tapan acciones) |
| Encabezado | ~160 px (marca, usuario y banda en 3 filas) | ~92 px: una fila + banda de simulación compacta |
| Vista previa | Modal con «Imprimir» | Vista limpia con selector **Hoja carta / Ticket 80 mm**, **Imprimir**, **PDF** y **Compartir** (Web Share con respaldo de descarga) |
| PDF | Solo A4 | `GET /api/documentos/:id/pdf-demo?formato=carta|ticket`: **carta 612×792 pt**; **ticket de ancho fijo 226 pt (80 mm) y alto variable** según el contenido; descripciones largas en varias líneas |
| Impresión del navegador | `window.print()` genérico | `@page` con nombre por formato (carta; ticket con el **alto real** fijado justo antes de imprimir, porque los navegadores no admiten `size: 80mm auto`); solo se imprime el documento |

## Rotulado fiscal (nunca ambiguo)
- **Simulado** (todo lo de hoy): banda y marca de agua «DOCUMENTO NO FISCAL · DEMOSTRACIÓN · SIN VALOR FISCAL»; serie, número y autorización, si existen, rotulados «simulada» (prefijo `SIM-`). No se genera ningún dato fiscal inventado.
- **Pruebas** (Digifact TEST): «DOCUMENTO DE PRUEBAS (TEST) · SIN VALOR FISCAL».
- **Oficial** (para cuando exista la certificación real): el generador de PDF exige serie, número, autorización e importes del certificador y **rechaza** una autorización `SIM-`. El servidor **no lo usa** mientras la emisión real esté deshabilitada; activarlo requerirá su propia autorización y revisión.

## Lo que se conserva
Borradores (guardar, recargar, editar, conflicto de versión), revisión con contenido congelado, validación con el proveedor, archivado, certificación simulada, validaciones de cantidad/precio/descuento (Q0.00 solo en DEMO con aviso), permisos por rol (`borradores.*`, `fiscal.*`), restricciones de documentos certificados (sin edición), aviso al cerrar la página con cambios sin guardar.

## Pruebas (todas en verde en local, Chromium)
- Nueva `tests/e2e_movil.cjs` a **320 / 360 / 390 / 430 px**: una pantalla sin asistente ni botón «+», captura rápida de 3–5 ítems con teclado, filas compactas, «Agregar ítem» al final, resumen, ningún elemento fijo tapa acciones (`elementFromPoint`), barra sobre la navegación y sin solaparse, menú dentro de pantalla, **sin desplazamiento horizontal** en cada estado (vacía, editor, lista, menú, guardada, vista previa), guardar → recargar → editar → recalcular, vista previa y **PDF carta y ticket** (tamaño de página, rótulo «SIN VALOR FISCAL», sin serie/número inventados), impresión con tamaño de página por formato.
- Adaptadas a la nueva interfaz: `e2e.cjs`, `e2e_acceso.cjs` (objetivos táctiles ≥ 40 px, fuentes ≥ 16 px, teclado virtual), `e2e_practico.cjs`.
- `deno test` de la demostración (24, con nuevas de PDF carta/ticket/oficial), con PostgreSQL real (30), cadena de nube local E2E, verificador de publicación.
- **No verificado aquí:** Firefox y WebKit (los ejecuta `fel-navegadores` al subir) y dispositivos reales (Android/iOS). El selector de fecha muestra el formato del navegador (MM/DD/AAAA en Chromium en inglés).

## Etapas 1 y 2 del rediseño móvil de «Nueva factura» (implementadas en local; NO publicadas)
Referencia: maqueta aprobada a 390 × 844 px. Solo presentación: no cambian el cálculo, los permisos, la seguridad ni la persistencia fiscal; las consultas NIT/CUI siguen siendo las del servidor (`/api/receptores/nit` y `/cui`) con el mismo controlador (`receptor_nit.js`).
- **Etapa 1 · marco (≤ 900 px):** encabezado de 48 px (marca + avatar), franja de simulación de una línea (22 px), navegación de 56 px con acento por línea superior y etiqueta corta («Nueva»), y menú de la cuenta en el avatar (nombre, rol y empresa, estado DEMO, pendientes y «Cerrar sesión»). El encabezado de PC no cambia.
- **Etapa 2 · receptor inteligente:** control segmentado NIT · CUI · CF · Otro, un solo campo de identificación con sugerencias de clientes guardados («Existente») y fila «Consultar … y crear nuevo» («Nuevo»); una identificación idéntica a la de un cliente guardado se elige sin consultar nada fuera. Tarjeta sin marco con nombre (varias líneas), etiqueta Existente/Nuevo, origen del dato y «Cambiar». Establecimiento y fecha en una fila; observaciones plegadas; «Vista previa» junto al título.
- **Desviaciones conscientes de la maqueta:** objetivos táctiles de 40 px (estándar del proyecto) en lugar de 32–34 px; la franja dice «SIMULADO - SIN VALOR FISCAL» con guion (texto que verifican otras pruebas); el icono de «Más» sigue siendo el de información; la fecha usa el formato del navegador; el establecimiento solo se preselecciona si la empresa tiene uno.
- **Pendiente (etapas 3 a 6):** ítems con −/+ y eliminación con «Deshacer», barra fija con el total, «Marcar revisado» diferenciado de «Guardar», vista previa móvil, escritorio y pulido.
- Prueba: `tests/e2e_rediseno.cjs` (marco, menú de la cuenta, receptor existente/nuevo/CF/Otro, «Marcar revisado» sin certificar, 320/360/390/430 px con importes grandes). Las demás pruebas de navegador se adaptaron al nuevo receptor (`tests/ayudas_nueva.cjs`).
