# Hoja de ruta, decisiones pendientes y riesgos — proveedores de emisión

Rama `fel-proveedores-diseno`. Acompaña a `saas-proveedores-diseno.md` y `saas-proveedores-digifact-investigacion.md`. **Nada de esto está implementado ni autorizado.** Tamaños relativos: S (pequeño), M (mediano), L (grande); no son plazos.

## 1. Decisiones pendientes (hay que tomarlas vosotros)

| ID | Decisión | Mi recomendación | Por qué importa |
|---|---|---|---|
| **D1** | ¿Se reemplaza el principio 7 («no hay automatización del portal del SAT») para que Playwright sea el canal principal? | Solo si D2 y D3 se aceptan y B1 (condiciones de uso) se cierra | Es un cambio de política del proyecto, con riesgo legal y operativo |
| **D2** | Dónde corre Playwright | **Agente local en el equipo de la empresa**, sesión manual; **nunca** en nuestros servidores | En la nube obligaría a guardar usuario y clave de la Agencia Virtual de cada empresa |
| **D3** | Alcance del canal Playwright | **Llenado asistido + emisión por una persona + lectura del resultado**; sin clic automático en «Emitir» | Un clic automático derriba las guardias actuales y no hay forma segura de saber si surtió efecto |
| **D4** | Custodia de la firma electrónica del emisor | La que decida el certificador (C6); evitar que NEXA custodie el `.pfx` salvo exigencia y con KMS/HSM | Mayor responsabilidad y superficie de ataque |
| **D5** | Modelo de credenciales de proveedor | Vault/KMS por empresa y, si el certificador lo permite, **claves de API creadas por cada empresa** | Aislamiento y menor custodia |
| **D6** | Modelo comercial multiempresa con el certificador | Resolver con C3–C5 antes de diseñar el onboarding | Determina contratos, facturación y alta de empresas |
| **D7** | Ambientes | Proyectos o esquemas separados por ambiente (simulado/pruebas/producción) con secretos distintos | Evita que un canal de pruebas toque datos reales |
| **D8** | Separación de funciones | Configurable por empresa; obligatoria en producción para `emision.aprobar` | Control interno y evidencia |
| **D9** | Empresa piloto y tipo de DTE inicial | Una empresa propia y un solo tipo (el de pequeño contribuyente si es el vuestro) | Acota alcance y riesgo |
| **D10** | Retención de documentos y exportación | Definir plazo (por verificar en la normativa) y exportación completa por empresa | Cumplimiento y portabilidad |
| **D11** | Permitir `documentacion.digifact.com` en la red de la sesión | Sí, para leer la documentación completa | Hoy la investigación se basa en fragmentos |
| **D12** | Prioridad real de la hoja de ruta | Interfaz + mock primero (sirven a ambos canales); luego el canal que tenga abiertas sus puertas | Playwright depende de B1 y de observaciones pendientes; el certificador depende de la parte comercial |

## 2. Hoja de ruta por fases

Orden: honra vuestra prioridad (Playwright principal, certificador secundario, individual antes que masivo) **sujeta a las puertas**. Las fases 1–3 son comunes y se pueden hacer ya; la 4 (Playwright) y la 5 (certificador) se pueden llevar **en paralelo**: avanza primero la que tenga abierta su puerta.

| Fase | Contenido | Tamaño | Puerta para pasar a la siguiente |
|---|---|---|---|
| **F0 · Aprobación** | Revisión de los tres documentos; decisiones D1–D12 | S | Decisiones registradas por escrito |
| **F1 · Contrato y mock** | Tipos de la interfaz `EmissionProvider`; adaptador `mock` con todos los escenarios (éxito, rechazo, corte antes/después, desconocido, duplicado, tardío, límite); **suite de propiedades de idempotencia** | M | El mock pasa 100 % de las pruebas de duplicados y desconocidos |
| **F2 · Datos multiempresa** | Migraciones: `establecimientos`, `miembro_establecimientos`, `proveedores_emision`, `empresa_canales`, `credenciales_proveedor` (solo referencias), `artefactos_documento`, `eventos_proveedor`, permisos nuevos; políticas de almacenamiento; pruebas SQL de aislamiento entre empresas | M | Pruebas SQL en verde en CI; revisión de seguridad de RLS y de storage |
| **F3 · Flujo individual con mock** | Orquestador (write-ahead, sin reintentos, conciliación), API y pantallas: borrador → validación → revisión → aprobación → solicitud → respuesta → PDF/XML **simulados**; descarga con URL firmada | L | Recorrido completo con mock, incluidos los escenarios de fallo; auditoría de la pista de eventos |
| **F4 · Canal Playwright (principal por prioridad)** | **4a** Observación: cerrar B1; ejecutar O-1/O-2/O-3; observar (con autorización, sin emitir) lo que sigue a Vista Previa y cómo se confirma una emisión. **4b** Agente local con cola (`agentes_locales`, `ordenes_emision`, arrendamiento y *fencing*) y **llenado asistido** (sin emisión real). **4c** Lectura del resultado tras emisión humana, en ambiente real **controlado** (una empresa, un documento) | L | 4a: B1 cerrado y observaciones aceptables. 4b: pruebas del agente en simulación y revisión de seguridad. 4c: autorización nueva y explícita, empresa piloto, plan de reversión |
| **F5 · Canal certificador (secundario)** | **5a** Lectura completa de la documentación y respuestas comerciales (C1–C17). **5b** Adaptador `digifact` solo contra el ambiente de **pruebas** con credenciales de pruebas. **5c** Homologación y pruebas de conciliación | L | 5a: respuestas C3, C6, C9, C10 por escrito. 5b: el adaptador pasa la misma suite del mock más las pruebas de contrato del proveedor |
| **F6 · Emisión real controlada** | Una empresa piloto, un tipo de DTE, el canal elegido, volumen mínimo, supervisión manual, monitoreo y conciliación diaria | M | Autorización explícita por empresa; plan de contingencia; cero duplicados y cero documentos desconocidos sin conciliar |
| **F7 · Anulaciones y notas de crédito** | Reglas de anulación **verificadas y versionadas**; flujo de anulación y nota de crédito con la misma disciplina de idempotencia | M | Regla verificada y vigente; pruebas con mock y con el canal elegido |
| **F8 · Facturación masiva (secundaria)** | Lotes sobre el mismo orquestador: cola por empresa, límites de tasa, reanudación, reporte de resultados, conciliación por lote | L | Estabilidad de F6; límites del proveedor conocidos (C13) |
| **Transversal** | Auditoría de seguridad externa, pruebas de intrusión, observabilidad (métricas y alertas por empresa), copias de seguridad y restauración, runbook de incidentes, soporte, documentación para usuarios | continuo | Antes de F6 |

**Qué se puede empezar ya sin riesgo:** F0, F1 y F2 (solo código y base de datos locales, sin credenciales ni llamadas externas).

## 3. Riesgos principales

| Riesgo | Efecto | Mitigación |
|---|---|---|
| Condiciones de uso de SAT prohíben o limitan el llenado automatizado | El canal Playwright no se puede usar | B1: lectura de términos y consulta escrita a SAT antes de F4c; el certificador queda como vía |
| Portal sin contrato estable (cambios de versión, CAPTCHA, caducidad de sesión) | Rotura frecuente del canal | Detección de versión, pruebas de humo, modo asistido, soporte del equipo |
| Canal Playwright sin API de conciliación | Duplicados difíciles de detectar | Sin clic automático (D3); conciliación por lectura de la lista de emitidos; todo desconocido → `por_verificar` |
| Idempotencia desconocida del certificador | Reintento duplica | Sin reintentos automáticos; conciliación obligatoria; confirmar C9/C10 |
| Custodia de firma y credenciales | Fuga con impacto fiscal | Referencias a secretos, cifrado por empresa, MFA, rotación; evitar custodiar la firma (D4/D5) |
| Fuga entre empresas | Incidente grave de privacidad | RLS en todas las tablas, almacenamiento por ruta de empresa, pruebas de aislamiento en CI |
| Dependencia de un solo certificador | Interrupción del servicio | Interfaz intercambiable; segundo proveedor documentado; portabilidad contractual (C16) |
| Reglas fiscales mal aplicadas | Documentos incorrectos | Reglas versionadas y verificadas; nada habilitado sin regla verificada |

## 4. Lo que queda fuera por ahora
Integración real con cualquier certificador, emisión real, clic automático en el portal, custodia de la firma, facturación masiva, anulaciones reales y cualquier cambio en `main` o en `fel/poc-sat/`.
