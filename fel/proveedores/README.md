# fel/proveedores — Fase 1: interfaz de proveedores y adaptador simulado

**Solo simulación local.** Sin red, sin credenciales, sin llamadas a SAT ni a certificadores, sin emisión. No importa nada de `fel/poc-sat/`.

- `src/tipos.ts` — contrato `EmissionProvider` y tipos de resultado. Solo `certificado` y `rechazado_confirmado` son resultados garantizados; todo lo demás es `desconocido` o `requiere_accion_humana`.
- `src/mock.ts` — adaptador `mock` con «servidor simulado» y 13 escenarios (éxito, rechazo, tiempo agotado/corte antes y después de certificar, respuesta ilegible, código desconocido con y sin certificación, tardío, indeterminado, límite, caída, acción humana). Solo funciona en el ambiente `simulado`. Todo lleva la marca «SIMULADO - SIN VALOR FISCAL».
- `src/validacion.ts` — validación estructural local (sin reglas fiscales no verificadas; aritmética decimal exacta).
- `src/orquestador_referencia.ts` — semántica de referencia en memoria (write-ahead, un envío por clave, `por_verificar`, sin reintentos automáticos, una operación abierta por documento, certificado inmutable). La Fase 2 la reimplementa sobre la base de datos con estas mismas pruebas.
- `pruebas/suite_contrato.ts` — **suite de contrato reutilizable** por cualquier adaptador.
- `pruebas/propiedades_test.ts` — 400 secuencias × 30 acciones con semilla fija contra un servidor que NO deduplica.

```bash
cd fel/proveedores && deno task test && deno task check
```
