# NEXA FEL · Tipos de documento (DTE)

Estado: **implementado y probado en local; sin aplicar a ninguna base hospedada, sin publicar, sin certificar nada.** Solo **FACT** certifica. NCRE, NDEB y RECI se pueden elaborar, validar y previsualizar («en pruebas»). El resto está catalogado como «pendiente».

## Dónde vive cada cosa
| Capa | Archivo | Qué hace |
|---|---|---|
| Catálogo (única fuente de verdad) | `proveedores/src/catalogo_dte.ts` | 17 tipos con código SAT, nombre, régimen/condición, campos, complementos, disponibilidad, motivo pendiente y pendientes por verificar; habilitación y predeterminado por empresa; validaciones por tipo |
| Constructor NUC | `proveedores/src/nuc_gt.ts` | Construye FACT (idéntico a siempre), NCRE/NDEB (complemento con el documento de origen, estructura del ejemplo oficial «NUC 4 - NCRE») y RECI (adenda «Tipo»). Rechaza los pendientes |
| Servicio de emisión | `proveedores/src/felgt_servicio.ts` | `validar` funciona para todos (sin red, avisa si el tipo aún no certifica); `preparar` y `certificar` rechazan todo tipo no implementado (`TIPO_NO_HABILITADO`) |
| Base (PROPUESTA, fuera de `supabase/migrations`) | `docs/migracion-tipos-documento/20261115000100_fel_tipos_documento.sql` | Catálogo en solo lectura, habilitación por empresa, columnas del documento, guardianes (tipo inmutable al revisar, origen certificado, tope, duplicados, recibo≠factura) y bloqueo de operaciones fiscales de tipos no implementados |
| API | `demo-facturacion/src/api.ts` | `GET/POST /api/tipos-documento`, `GET /api/documentos/origenes`, `tipo_dte` en el guardado y en el listado |
| Interfaz | `demo-facturacion/web/js/{tipos,factura,lista,config,vista_previa}.js` | «Nuevo documento», selector compacto, campos del tipo, pestaña «Tipos de documento» en Configuración, tipo en historial y filtro |
| PDF | `demo-facturacion/src/pdf_demo.ts` | Título del tipo, referencia de la nota, aviso de recibo |

## Catálogo
| Código | Nombre | Disponibilidad | Certifica | Notas |
|---|---|---|---|---|
| FACT | Factura | implementado | **sí** | Sin cambios |
| NCRE | Nota de crédito | en pruebas | no | Origen certificado FACT; motivo; mismo receptor |
| NDEB | Nota de débito | en pruebas | no | Igual; sin ejemplo JSON oficial leído |
| RECI | Recibo | en pruebas | no | Habilitación expresa con base escrita; tipo Universidad/Colegio/Inmobiliaria |
| FCAM | Factura cambiaria | pendiente | no | Falta complemento FCAMB (abonos) con ejemplo JSON; Digifact la publica como `FACM` y el resto de su manual como `FCAM` |
| FPEQ | Factura pequeño contribuyente | pendiente | no | Sin IVA (V6), matriz de afiliación (V3), frases (V4) bloqueados en el inventario fiscal |
| FCAP, FESP, NABN, RDON, FEPE, FARP, FCRP, FPEC, FCPC, CIVA, CAIS | — | pendiente | no | Ver `motivoPendiente` de cada uno |

Un tipo solo sale de «pendiente» con sus reglas SAT verificadas **y** probadas. Que Digifact lo liste no basta.

## Reglas que impone la base (además de la API y el formulario)
- `tipo_dte`, `documento_origen_id`, `referencia_origen`, `motivo_ajuste` y `tipo_recibo` solo cambian en un **borrador** sin estado fiscal.
- **Notas:** referencian un documento **certificado** de la misma empresa, de un tipo permitido (hoy solo FACT), con serie/número/autorización, al **mismo receptor**. La referencia fiscal la **copia la base** del origen (lo que llegue de fuera se descarta). El origen no se modifica.
- **Regla de PROYECTO (no SAT):** lo acreditado por notas de crédito activas sobre un origen no supera su total; una nota activa idéntica (origen, tipo, importe y motivo) no se duplica.
- **Recibo:** la empresa debe haberlo habilitado con su base escrita; no se admite si hay una factura activa del mismo receptor, importe y fecha (no sustituye a una factura).
- **Operaciones fiscales:** `fel_operacion_tipo_guard` impide crear una operación para un tipo sin `certificacion_habilitada`. Esa bandera solo puede ser `true` en un tipo «implementado» (restricción de la tabla) y el catálogo no se puede modificar sin una migración.
- Habilitación por empresa (`fel_op_tipos_empresa_guardar`, permiso `empresa.editar`): FACT siempre; NCRE/NDEB/RECI solo si la empresa los habilita; los pendientes nunca.

## Propuesta de migración (`docs/migracion-tipos-documento/`) — **NO aplicada a ninguna base hospedada**
Igual que la del correo, **vive fuera de `supabase/migrations`**: el conjunto de 29 migraciones aprobadas no cambia, la guardia de publicación (`verificar-publicacion.py`) lo vigila y ninguna etapa de publicación la conoce. Se aplica **a mano, con autorización, después de la 29** (28 → 29 → esta).
- Archivos: `20261115000100_fel_tipos_documento.sql` (la propuesta), `verificacion-tipos.sql` (solo lectura, todas las filas `ok = true`), `reversion-tipos.sql` (se niega si hay notas, recibos o configuración), `prueba-tipos-documento.sql` (prueba SQL).
- Crea 2 tablas, 5 columnas en `documentos`, 9 funciones y 3 disparadores. No modifica funciones, políticas ni datos existentes; no toca la 29. Los documentos existentes quedan como FACT.
- Si la 29 se aplica **después**: `select public.fel_tipos_instalar_guardian_digifact();` instala el guardián en `digifact_operaciones` (idempotente; en las bases que ya tienen la 29 lo instala la propia propuesta).
- **La demostración funciona igual sin ella** (solo Factura): `tipos_disponibles.ts` detecta si existe y, si no, no consulta ninguna columna ni función nueva y rechaza los tipos nuevos con un mensaje claro. La demostración EN MEMORIA (PGlite) la trae aplicada (se apaga con `FEL_TIPOS=0`) y `tools/test-demo-pg.sh` la aplica a su plantilla.
- Prueba completa: `bash fel/tools/test-tipos-documento.sh` (PostgreSQL temporal: migraciones aprobadas → propuesta → prueba → verificación → reversión negada con datos → reversión en limpio → reaplicación).

## Pruebas (todas locales; nada toca la red, Supabase hospedado ni Digifact)
- `proveedores/pruebas/catalogo_dte_test.ts`, `nuc_tipos_test.ts`, `felgt_servicio_test.ts` (tipos); `demo-facturacion/tests/catalogo_migracion_test.ts` (catálogo del código = catálogo de la base).
- `docs/migracion-tipos-documento/prueba-tipos-documento.sql` (+ verificación y reversión) vía `tools/test-tipos-documento.sh`.
- `demo-facturacion/tests/tipos_documento_api_test.ts` (API real en proceso, PGlite; con y sin la propuesta aplicada).
- `demo-facturacion/tests/e2e_tipos.cjs` (navegador, 390 y 1100 px).

## Lo que falta antes de certificar cualquier tipo nuevo
Ver `pendientesVerificar` de cada tipo en el catálogo. En lo común: documento «Reglas y Validaciones» de la SAT (matriz tipo × afiliación × personería, frases por régimen, IVA de recibos/pequeño contribuyente, notas: plazo e importes), ejemplos JSON oficiales de Digifact de NDEB/RECI/FCAM, y una corrida **autorizada** en TEST por cada tipo.
