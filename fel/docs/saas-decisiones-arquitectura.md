# NEXA FEL SaaS — decisiones de arquitectura (registro)

Rama `fel-proveedores-diseno`. Este registro prevalece sobre `saas-proveedores-diseno.md` y `saas-proveedores-hoja-de-ruta.md` si difieren.

## Prioridades confirmadas
1. **Playwright es el enfoque principal**: se mantiene el objetivo original de automatizar el **llenado individual** del facturador gratuito de SAT.
2. Digifact y otros certificadores autorizados son **alternativas secundarias**. **No se desarrolla todavía la integración real con Digifact.**
3. Facturación **individual** primero; la masiva, después.

## Decisiones aprobadas

| ID | Decisión | Consecuencias |
|---|---|---|
| **D1** | Se actualiza el principio 7: se permite **investigar y desarrollar** la automatización del portal, pero **su ejecución real sigue bloqueada** hasta aclarar los permisos y las condiciones de SAT | `fel/README.md` actualizado. Toda ejecución contra el portal real exige autorización escrita nueva; las protecciones de `fel/poc-sat/` y de la Etapa 2 siguen activas. Sigue vigente B1 (condiciones de uso sin confirmar) |
| **D2** | **Agente local** con **inicio de sesión manual**; **no se almacenan contraseñas** de la Agencia Virtual | Ningún navegador del canal corre en servidores de NEXA. El plano de control en la nube solo ve órdenes y resultados, nunca la sesión |
| **D3** | Playwright se limita inicialmente al **llenado asistido**. **No se automatiza** Vista Previa, Emitir, Certificar ni acciones equivalentes | La emisión la hace una persona en el portal. Las guardias que bloquean esas acciones no se tocan |
| — | `portal_playwright` es el adaptador **principal**; `digifact` es **secundario** | Orden de implementación: mock → flujo → Playwright → agente → condiciones/prueba controlada; Digifact después |
| — | Arquitectura SaaS **multiempresa** con aislamiento de datos y permisos | Se mantiene el modelo de `saas-proveedores-diseno.md` §2 |
| — | Se **conservan** las protecciones contra duplicados y los estados `por_verificar` | Write-ahead, sin reintentos automáticos, una operación abierta por documento |

## Redacción vigente del principio 7
«No se guardan credenciales de la Agencia Virtual ni de la firma FEL. Se permite investigar y desarrollar la automatización del portal del SAT (agente local, inicio de sesión manual, llenado asistido, solo en simulación); su ejecución real contra el portal permanece bloqueada hasta aclarar los permisos y las condiciones de SAT y contar con autorización escrita.»

## Decisiones que siguen pendientes
D4 (custodia de la firma), D5 (modelo de credenciales de proveedor), D6 (modelo comercial multiempresa con certificadores), D7 (ambientes), D8 (separación de funciones), D9 (empresa piloto y tipo de DTE inicial), D10 (retención y exportación), D11 (acceso de red a la documentación de Digifact; ahora de baja prioridad) y B1 (condiciones de uso de SAT).

## Qué sigue prohibido
Ejecutar Playwright contra SAT; emitir, certificar o guardar documentos reales; clic automático en Vista Previa/Emitir/Certificar; almacenar contraseñas de la Agencia Virtual; integrar Digifact; tocar `main`.
