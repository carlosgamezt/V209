# Plan técnico de implementación (versión aprobada de la secuencia)

Rama `fel-proveedores-diseno`. Complementa `saas-decisiones-arquitectura.md`. **Todo en simulación local; nada contra SAT; sin credenciales.**

## Estructura de código prevista
```
fel/proveedores/                 (proyecto Deno/TypeScript independiente; no importa nada de fel/poc-sat)
  src/tipos.ts                   contrato EmissionProvider, tipos de resultado, catálogo de errores
  src/mock.ts                    adaptador simulado con servidor simulado y escenarios
  src/orquestador_referencia.ts  semántica de referencia (en memoria): write-ahead, idempotencia, por_verificar
  src/validacion.ts              validación estructural local (sin reglas fiscales no verificadas)
  pruebas/                       suite de contrato reutilizable + pruebas del mock y del orquestador
fel/poc-sat/                     (intacto) base del adaptador Playwright en la Fase 3
fel/supabase/…                   migraciones y funciones SQL (Fase 2)
```
CI: se añade el proyecto al job Deno del workflow existente.

## Fase 1 — Interfaz de proveedores + mock (COMPLETADA)
- Contrato `EmissionProvider` y tipos (§3 del diseño), con `portal_playwright`/`digifact` declarados como identificadores futuros.
- Adaptador `mock` con servidor simulado: éxito, rechazo confirmado, timeout/corte antes y después de certificar, respuesta ilegible, código desconocido (con y sin certificación), respuesta tardía, límite/caída, conciliación indeterminada, acción humana; duplicado cuando el «servidor» no deduplica.
- Validación estructural local (no fiscal).
- **Suite de contrato** reutilizable por cualquier adaptador.
- **Orquestador de referencia en memoria** que fija la semántica anti-duplicados para que la Fase 2 la reimplemente sobre la base de datos con las mismas pruebas.
- **Pruebas:** unitarias por escenario, tabla escenario × acción, doble envío concurrente, y una **prueba de propiedades** con secuencias aleatorias (semilla fija) que afirma «nunca más de una certificación por documento» aun con un servidor que no deduplica.
- **Criterio de salida:** todas las pruebas en verde en local y en CI.

## Fase 2 — Flujo individual completo en simulación (COMPLETADA en simulación; informe: `saas-fase-2-informe.md`)
Migraciones multiempresa (`establecimientos`, `empresa_canales`, `credenciales_proveedor` solo con referencias, `artefactos_documento`, `eventos_proveedor`, `ordenes_emision`, permisos nuevos), orquestador real sobre la base con las pruebas de la Fase 1, validaciones, errores y **recuperación** (conciliación, `por_verificar`, reintento con otra clave), almacenamiento de PDF/XML simulados con URL firmada, pruebas SQL de aislamiento entre empresas y pantallas del flujo borrador → validación → revisión → aprobación → solicitud → respuesta → PDF/XML. **Criterio:** recorrido completo con mock incluidos todos los fallos; pruebas de aislamiento en CI.

## Fase 3 — Adaptador `portal_playwright` con el simulador local
Reutiliza `fel/poc-sat/` **sin modificarlo**: un adaptador que traduce una orden de emisión a datos ficticios para el ejecutor y devuelve `requiere_accion_humana` tras el llenado (D3). Se prueba con el simulador AngularJS local y los hosts mapeados a localhost; la suite de contrato se aplica al adaptador. **Criterio:** la suite de contrato pasa con el adaptador contra el simulador, y las pruebas de poc-sat siguen intactas.

## Fase 4 — Agente local para Windows
Proceso local (Node) con inicio de sesión manual, registro con clave pública, cola con arrendamiento y *fencing*, sin contraseñas almacenadas, instalador/empaquetado para Windows y procedimiento. Solo contra el simulador. **Criterio:** pruebas del agente (reclamo, vencimiento, orden duplicada, agente caído) y revisión de seguridad.

## Fase 5 — Condiciones de SAT y prueba real controlada (sin ejecutarla)
Cierre de B1 (lectura de términos y consulta escrita a SAT), O-1/O-2/O-3 y observación de las pantallas posteriores a Vista Previa; plan de prueba real con autorización escrita, empresa piloto, un documento, criterios de parada y reversión. **No se ejecuta sin autorización.**

## Fuera de alcance por ahora
Integración real con Digifact; masiva; emisión real; clic automático en el portal.
