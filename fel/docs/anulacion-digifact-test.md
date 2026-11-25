# Anulación de documentos con Digifact TEST · revisión (25/11/2026)

**Conclusión: la anulación contra Digifact TEST NO está habilitada de punta a punta; hoy solo existe (a) el cliente cerrado y (b) la anulación SIMULADA de la demostración.** No se habilitó nada en esta revisión.

| Pieza | Estado | Evidencia |
|---|---|---|
| Cliente `DigifactGt.anular` (`POST /CancelFelGT`) | Existe. **Cerrado** salvo `permitirAnulacion` explícito + confirmación literal `ANULAR`. Valida GUID, NIT receptor, fecha `AAAA-MM-DDThh:mm:ss` y motivo (3–200). Resultados: `anulado`, `rechazado_confirmado`, `desconocido` (timeout/5xx/429/ilegible/código no mapeado). | `proveedores/src/digifact_gt.ts:322`, pruebas `digifact_gt_test.ts` |
| Fábrica de despliegue | `permitirAnulacion` nunca se activa desde el entorno: la función publicada no lo recibe. | `digifact_entorno.ts` |
| Servicio TEST (`ServicioFelGt`) | **Sin operación de anulación**: no hay write-ahead, ni estado `anulando`, ni conciliación, ni ruta API para TEST. | `felgt_servicio.ts` |
| Anulación en la demo (`/api/documentos/:id/anular`, `anular.js`) | Funciona **solo con certificadores simulados** que soporten anulación (confirmación `ANULAR`, permiso `fiscal.anular`, idempotencia, conciliación). Un documento certificado en Digifact TEST hoy responde 422 («solo… certificador simulado»). | `api_practico.ts:211-227` |
| Persistencia | El estado `anulado` / `anulacion_solicitada` ya existe en `documentos` (y los PDF/ticket lo rotulan «ANULADO»). Falta almacenar la respuesta del certificador y el motivo ligado a una operación de Digifact. | `pdf_demo.ts`, `api_practico.ts:196` |

## Brechas para habilitarla (sin migración, salvo lo marcado)
1. **Operación de anulación con las mismas garantías que certificar**: escritura previa (`anulando`), una sola en curso (transición atómica), consulta previa del estado real, resultado incierto → `desconocida` + conciliación (la consulta de documentos del reporte ya expone `anulado`), sin reintento automático. *Probablemente requiere una columna/tabla de operación de anulación → **migración 32**, no la 31.* Alternativa sin migración: reutilizar `digifact_operaciones.resultado` (jsonb) con un campo `anulacion` — se evaluaría, con la desventaja de mezclar estados.
2. **Autorización explícita de TEST** (mismo patrón `CICLO-TEST`, pero con su propia entrada de publicación `digifact_anulacion=habilitado`, apagada por defecto) y confirmación escrita `ANULAR-TEST` + autorización + huella.
3. **Reglas por documento**: anular dentro de plazo, receptor y fecha de emisión originales tal cual los certificó Digifact, y bloqueo si el documento tiene notas de crédito vigentes (política por confirmar con la regla SAT).
4. **Interfaz**: botón «Anular en TEST» solo para documentos certificados en TEST, con aviso «PRUEBA · sin valor fiscal».
5. **Prueba de aceptación** en `prueba_digifact.ts`: certificar → anular → consultar (`anulado = true`) → PDF rotulado ANULADO → no se puede certificar de nuevo el mismo documento.

## Qué puedo probar hoy sin tocar nada
Las pruebas del cliente (respuestas simuladas) y de la anulación simulada ya cubren el contrato; añado en esta etapa una prueba que **confirma que un documento certificado en TEST NO se anula por la vía simulada** y que el cliente permanece cerrado en la función publicada.

## Decisión pendiente
¿Habilitamos la anulación en TEST (brechas 1–5)? Recomiendo hacerlo **después** de validar NCRE (una anulación y una nota de crédito son dos caminos fiscales distintos) y decidir si basta `digifact_operaciones.resultado` o conviene la migración 32.
