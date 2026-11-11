# NEXA FEL SaaS multiempresa — diseño técnico de proveedores de emisión

Rama: `fel-proveedores-diseno` (parte de `fel-fase-1-0`; **no toca `main`** y **no modifica el prototipo Playwright** `fel/poc-sat/`). Estado: **DISEÑO PARA REVISIÓN. No se programó ninguna integración real, no se usaron credenciales, no se llamó a ningún endpoint, no se emitió ni se certificó nada.**

**Decisiones aprobadas:** D1, D2, D3 y las prioridades (Playwright principal; certificadores secundarios; individual antes que masivo) están registradas en `saas-decisiones-arquitectura.md`, que prevalece sobre este texto si hay diferencias. El plan técnico está en `saas-plan-implementacion.md`.

Documentos hermanos: `saas-proveedores-digifact-investigacion.md` (investigación y preguntas comerciales) y `saas-proveedores-hoja-de-ruta.md` (fases, decisiones pendientes y puertas de avance).

## 0. Prioridades y tres hechos que condicionan el diseño

**Prioridades (vuestras):** (1) facturación **individual**; (2) la masiva es secundaria; (3) el canal **principal** es la automatización del formulario con Playwright y el **certificador autorizado es secundario**. El diseño pone ambos detrás de la misma interfaz, con Playwright como primer canal en la hoja de ruta **en cuanto sus puertas se abran**.

Tres hechos que conviene tener presentes antes de aprobar:

1. **El principio 7 original decía «no hay automatización del portal del SAT».** Con la decisión D1 (aprobada) pasa a permitir la **investigación y el desarrollo** de esa automatización manteniendo **bloqueada su ejecución real** hasta aclarar los permisos y las condiciones de SAT.
2. **Las condiciones de uso de SAT siguen sin confirmar** respecto a automatizar el llenado (B1 de la auditoría 2A), y O-1/O-2/O-3 siguen pendientes. Hasta cerrarlas, el canal Playwright solo puede existir como **simulación y modo asistido de pruebas**, no como emisión real.
3. **El prototipo se detiene a propósito antes de «Vista Previa», «Guardar», «Certificar» y «Emitir»** (guardias activas). Un canal que emita de verdad necesita el tramo posterior al formulario, que **nunca se ha observado** (qué ocurre tras Vista Previa, cómo se confirma la emisión y de dónde se obtiene serie, número, autorización, PDF y XML). Sin esa observación, el canal Playwright solo puede ser «llenado asistido + emisión por una persona».

El diseño es **honesto sobre eso**: el canal certificador tiene un contrato documentado; el canal Playwright es el que más incógnitas tiene. Por eso la interfaz y el mock se construyen primero y sirven a ambos.

## 1. Principios e invariantes (se heredan los del proyecto y se añaden los nuevos)

Heredados (siguen): la app solo lee; toda escritura pasa por `fel-api` y por funciones SQL con permiso; dato y auditoría en la misma transacción; doc certificado inmutable; sin reglas fiscales por defecto; `serie`, `numero_fiscal` y `autorizacion_sat` vacíos salvo confirmación verificable; **sin reintentos automáticos** ante resultado desconocido; doble eje de estado (preparación / fiscal).

Nuevos:
- **I1. Un solo punto de salida.** Ningún código fuera de `EmissionProvider` habla con SAT, un certificador o el portal.
- **I2. Escribir antes de enviar.** La operación y su clave de idempotencia se persisten *antes* de cualquier salida (write-ahead).
- **I3. Lo desconocido es un estado, no un error.** Todo resultado que no sea éxito o fallo **confirmado** deja la operación en `desconocida` y el documento en `por_verificar`.
- **I4. Aislamiento por empresa en todas las capas:** datos, secretos, archivos, agentes y colas.
- **I5. Los secretos nunca viajan al navegador ni se guardan en claro.** Las credenciales de SAT (usuario/clave de la Agencia Virtual) **no se almacenan jamás**.
- **I6. Todo canal real está apagado por defecto** (`emision_real_habilitada` por empresa, más una bandera por canal y por ambiente) y se enciende solo con autorización explícita y registrada.
- **I7. El mock es un ciudadano de primera:** mismas interfaces, mismos estados y mismas pruebas que un canal real.

## 2. Modelo multiempresa: empresas, usuarios, establecimientos, permisos y credenciales

Se **reutiliza** lo ya construido (`empresas`, `perfiles`, `miembros`, `invitaciones`, `clientes`, `conceptos`, `documentos`, `documento_lineas`, `documento_estados`, `operaciones_fiscales`, `reglas_normativas`, `auditoria`, `permisos_catalogo`, `rol_permisos`) y se **añade** lo siguiente (propuesta; las migraciones se escriben en la fase 2).

| Entidad nueva | Propósito | Notas de aislamiento |
|---|---|---|
| `establecimientos` | Establecimientos de la empresa (código SAT del establecimiento, nombre, dirección fiscal, estado) | `empresa_id` obligatorio; único (`empresa_id`, `codigo_sat`) |
| `miembro_establecimientos` | Alcance de un miembro a establecimientos concretos (opcional; sin filas = todos) | RLS por empresa |
| `proveedores_emision` | Catálogo global (administrado por el maestro): `mock`, `portal_playwright`, `digifact`, futuros | No contiene secretos |
| `empresa_canales` | Qué canal usa cada empresa/establecimiento y para qué tipo de DTE: ambiente (`simulado`, `pruebas`, `produccion`), prioridad, `habilitado`, versión del adaptador, autorizado_por/en | Un canal de producción exige `emision_real_habilitada` + autorización registrada |
| `credenciales_proveedor` | **Referencia** a un secreto (id en Vault / envoltura KMS), `empresa_id`, `canal_id`, huella no reversible, rotación, caducidad, últimos accesos | **Nunca el valor.** Ninguna política de lectura para `authenticated` |
| `agentes_locales` | Agentes del canal Playwright: `empresa_id`, nombre, clave pública, estado, última vez visto, versión | Cada agente solo ve sus propias órdenes |
| `ordenes_emision` | Cola del canal Playwright (ver §5.2) | Reclamo con arrendamiento; solo el agente de esa empresa |
| `artefactos_documento` | XML/PDF/evidencias: tipo, ruta en almacenamiento, SHA-256, tamaño, `operacion_id` | Ruta `{empresa_id}/{documento_id}/{operacion_id}/…`; inmutables (sin UPDATE/DELETE) |
| `eventos_proveedor` | Registro saneado de cada intercambio con un canal (método, ruta, código, duración, hash del cuerpo, tipo de resultado) | Sin credenciales ni cuerpos con datos innecesarios |

**Permisos nuevos** (se suman a `fiscal.certificar`, `fiscal.anular`, `fiscal.conciliar`, `fiscal.ver` ya existentes):
`emision.solicitar`, `emision.aprobar` (separación de funciones: opcionalmente quien revisa ≠ quien solicita ≠ quien aprueba), `canales.ver`, `canales.configurar`, `credenciales.administrar`, `agentes.administrar`, `artefactos.descargar`, `establecimientos.gestionar`. El **administrador maestro de la plataforma administra el catálogo de proveedores pero no ve documentos ni secretos de las empresas** (se mantiene el principio 4).

**Roles propuestos por empresa:** propietario, administrador, facturador (crea/edita), revisor, aprobador/emisor, contador (solo lectura + descarga), auditor.

**Dos capas de validación del permiso** (API y función SQL), igual que hoy. **MFA (aal2)** para `credenciales.administrar`, `canales.configurar` y `emision.aprobar` en producción.

## 3. Interfaz de proveedores intercambiables

Contrato (TypeScript, solo definición; **no se implementa** en esta entrega):

```ts
type Ambiente = "simulado" | "pruebas" | "produccion";

interface CapacidadesProveedor {
  id: string;                          // "mock" | "portal_playwright" | "digifact" | …
  ambientes: Ambiente[];
  tiposDte: string[];                  // códigos DTE que declara soportar (se contrastan con reglas verificadas)
  emiteSinHumano: boolean;             // false en portal_playwright: la emisión final la pulsa una persona
  idempotenciaNativa: boolean;         // ¿el proveedor deduplica por una referencia nuestra?
  consultaPorReferencia: boolean;      // ¿se puede conciliar por nuestra referencia?
  entregaXml: boolean; entregaPdf: boolean;
  soportaAnulacion: boolean; soportaNotaCredito: boolean;
  tiempoMaximoMs: number;              // sin reintento automático
}

interface SolicitudCertificacion {
  empresaId: string; establecimientoId: string; documentoId: string; operacionId: string;
  claveIdempotencia: string; hashContenido: string;      // ya persistidos (I2)
  instantanea: DocumentoCongelado;                         // contenido inmutable revisado y aprobado
  ambiente: Ambiente;
}

type ResultadoEnvio =
  | { tipo: "certificado"; serie: string; numero: string; autorizacion: string; fechaCertificacion: string; artefactos: ArtefactoRef[]; crudoSaneado: unknown }
  | { tipo: "rechazado_confirmado"; codigo: string; mensaje: string; crudoSaneado: unknown }          // el proveedor garantiza que NO hay DTE
  | { tipo: "desconocido"; motivo: "timeout" | "corte" | "respuesta_ilegible" | "codigo_no_mapeado" | "accion_humana_pendiente" }
  | { tipo: "requiere_accion_humana"; instruccion: string; ordenId: string };                          // canal portal_playwright

interface EmissionProvider {
  readonly capacidades: CapacidadesProveedor;
  validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion>;     // local y, si existe, del proveedor (sin efectos fiscales)
  enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio>;       // NUNCA reintenta por sí mismo
  conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion>;        // solo lectura; "certificado" | "no_existe_confirmado" | "indeterminado"
  obtenerArtefactos(op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]>;       // PDF/XML
  anular?(sol: SolicitudAnulacion, ctx: Contexto): Promise<ResultadoEnvio>;
  salud(ctx: Contexto): Promise<{ ok: boolean; detalle: string }>;                    // sin efectos
}
```

**Reglas del contrato (se prueban con el mock y se repiten para cada adaptador real):**
- `enviar` solo puede devolver `certificado` o `rechazado_confirmado` cuando el proveedor **lo garantiza**; cualquier otra cosa es `desconocido`.
- Un código de respuesta que el adaptador no reconoce **es `desconocido`**, nunca éxito ni fallo (respuestas desconocidas).
- `enviar` no se llama dos veces para la misma clave de idempotencia: lo garantiza el orquestador (§6), no el adaptador.
- Los adaptadores **no** acceden a la base de datos ni al almacenamiento: reciben el contexto (secreto ya resuelto, cliente HTTP con tiempos) y devuelven datos; el orquestador persiste.
- El adaptador declara sus errores en un catálogo normalizado (`AUTENTICACION`, `VALIDACION_PROVEEDOR`, `LIMITE`, `RED`, `FORMATO`, `NO_SOPORTADO`, `DESCONOCIDO`).

**Registro y selección:** el orquestador resuelve el adaptador con `empresa_canales` (empresa + establecimiento + tipo DTE + ambiente) y valida que la capacidad cubra el tipo de DTE. Cambiar de canal es **un cambio de configuración**, no de código; un documento ya enviado queda atado a su proveedor para conciliar y anular.

## 4. Adaptador simulado (mock) — diseño (se implementa en la fase 1, no ahora)

El mock debe poder **reproducir todos los casos que importan**, de forma determinista y sin red ni credenciales:
- éxito (genera serie/número/autorización **ficticios con prefijo inequívoco**, p. ej. `SIM-`, XML y PDF de ejemplo marcados «SIMULADO — SIN VALOR FISCAL»);
- rechazo confirmado (códigos de validación);
- tiempo agotado, corte de conexión y respuesta ilegible **antes** o **después** de «certificar» (la parte difícil: el servidor simulado puede haber certificado o no);
- respuesta con código desconocido; respuesta duplicada; respuesta tardía;
- conciliación consistente e indeterminada;
- límite de tasa y caída del servicio;
- modo `requiere_accion_humana` (para imitar el canal Playwright).

Se controla con un «guion» por documento (`escenario` en la solicitud o en la configuración del canal simulado), nunca con datos reales, y **no puede habilitarse en producción** (un trigger/validación impide un canal `simulado` con empresa de producción y el inverso).

## 5. Los dos canales

### 5.1 Canal secundario: certificador autorizado (Digifact primero)
Servicio HTTP con contrato documentado: autenticación por token (JWT), endpoints de **pruebas** y **producción** separados, certificar por XML o JSON (URL distinta según formato), anular, consultar y obtener documento (detalles y fuentes en `saas-proveedores-digifact-investigacion.md`). En producción exige la firma electrónica del emisor. Va detrás de `EmissionProvider` como `digifact`. **Fase de pruebas solo contra el ambiente de pruebas del proveedor, con credenciales de pruebas, cuando exista autorización.**

### 5.2 Canal principal por prioridad: portal con Playwright (`portal_playwright`)
**Restricción de arquitectura (no negociable por seguridad): el navegador no corre en nuestros servidores.** Un navegador en la nube obligaría a **guardar usuario y clave de la Agencia Virtual de cada empresa**, lo que contradice I5 y el principio actual. Por eso:

- Un **agente local** (extensión del actual `fel/poc-sat`, sin modificarlo: lo empaqueta o lo invoca como biblioteca) corre en el equipo de la empresa, con un **Chrome propio de la empresa** al que la persona inicia sesión **a mano**. El plano de control en la nube solo ve **órdenes y resultados**, nunca la sesión.
- El agente se registra con una clave pública (`agentes_locales`), se autentica con firma por petición y solo puede **reclamar órdenes de su empresa**.
- **Cola** `ordenes_emision` con estados: `creada → reclamada(arrendamiento con vencimiento) → llenando → listo_para_emision_humana → emitida_por_humano → resultado_leido → conciliada | fallida`; si el arrendamiento vence **no se reasigna automáticamente** una orden que ya pasó de `llenando`: queda `desconocida`.
- **Alcance por fases del canal:** (a) *llenado asistido*: el agente llena y **se detiene** (como hoy), y la persona revisa y emite en el portal; (b) *lectura del resultado*: tras la emisión humana, el agente lee en pantalla serie/número/autorización y obtiene PDF/XML **solo si el portal los ofrece y solo con autorización de la fase 4b**; (c) la emisión con clic del robot **no está en el alcance de este diseño** y exigiría una decisión y autorización separadas, porque derriba las guardias actuales.
- **Anti-duplicados específicos del canal:** el robot no puede saber con certeza si un clic de emisión surtió efecto. Por eso no se diseña un clic automático, y la conciliación se hace leyendo la **lista de documentos emitidos del portal en solo lectura** (p. ej. buscando el marcador de la operación en un campo libre, si el campo existe y es fiscalmente admisible; **por verificar**).
- **Incógnitas que solo la observación pasiva puede despejar** (O-1, O-2, O-3 y una observación nueva de las pantallas posteriores a Vista Previa, siempre con autorización y sin emitir): eventos y autoguardado del formulario, qué pantalla sigue a Vista Previa, cómo se confirma la emisión, si hay PDF/XML descargables y desde dónde, caducidad de sesión, CAPTCHA y límites.
- **Riesgos propios:** cambio de versión del portal (se detecta la versión visible, p. ej. «build …»), sesión caducada, un solo operador por sesión, dependencia de las condiciones de uso (B1), y falta de contrato de soporte.

## 6. Flujo individual y anti-duplicados

### 6.1 Flujo (sobre los dos ejes de estado existentes)
1. **Borrador** (`estado_preparacion = borrador`): edita quien tenga `borradores.editar`.
2. **Validación:** local (NIT del receptor, totales y redondeos, reglas fiscales *verificadas*, catálogos, límites de longitud) + validación del proveedor si el canal la ofrece (sin efectos fiscales). Resultado persistido; los errores impiden pasar.
3. **Revisión** (`borradores.revisar` → `revisado`): se **congela una instantánea** y se calcula `hash_contenido`; cualquier cambio posterior invalida la revisión.
4. **Aprobación y solicitud de certificación** (`emision.aprobar` + `emision.solicitar`): comprueba empresa habilitada, régimen verificado, canal habilitado para el ambiente y reglas vigentes. Crea la `operacion_fiscal` (`iniciada`) con clave de idempotencia y el documento pasa a `pendiente_certificacion` — **en la misma transacción** y **antes** de cualquier salida.
5. **Respuesta:** el orquestador llama a `enviar` (o crea la orden del agente) y aplica el resultado: `certificado` → serie/número/autorización (obligatorios) y artefactos; `rechazado_confirmado` → `rechazado`; **cualquier otro** → `por_verificar` + operación `desconocida`.
6. **PDF/XML:** se guardan como artefactos inmutables con SHA-256 en el almacenamiento privado de la empresa; la descarga usa URL firmada de corta duración y registra auditoría.
7. **Conciliación** (solo `por_verificar`): `conciliar` del proveedor o resolución manual con evidencia (`fiscal.conciliar`), como hoy.

### 6.2 Defensas contra duplicados (capas)
| Capa | Mecanismo |
|---|---|
| Base de datos (ya existe) | `unique (documento_id, clave_idempotencia)`; índice único parcial: **una operación abierta por documento**; bloqueo de la fila del documento; triggers del doble eje; documento certificado inmutable |
| Identidad del documento | `unique (empresa_id, autorizacion_sat)` y `unique (empresa_id, proveedor, referencia_externa)` donde existan |
| Orquestador | Persistir antes de enviar (I2); **sin reintentos automáticos**; un solo `enviar` por clave; misma clave + mismo hash → devuelve la misma operación; misma clave + otro contenido → rechazo |
| Resultado desconocido | `por_verificar`; no se permite ninguna operación nueva hasta conciliar; el reintento exige **otra** clave **solo** tras confirmar que no se generó el DTE |
| Proveedor | Referencia propia por operación (si el certificador la admite y deduplica: **por confirmar**); conciliación por esa referencia |
| Agentes | Arrendamiento con vencimiento y *fencing token*: una orden vencida no se reasigna; un agente tardío no puede cerrar una orden que ya no le pertenece |
| Respuestas repetidas o tardías | Aplicación idempotente: una operación ya resuelta no se reabre ni se modifica |
| Advertencia humana | Aviso (no bloqueo) ante un documento con mismo receptor, total y fecha en una ventana corta |

Pruebas obligatorias antes de cualquier canal real (con el mock): doble clic, doble envío concurrente, corte antes/después de certificar, respuesta duplicada y tardía, código desconocido, conciliación indeterminada y reintento con la misma y con otra clave.

## 7. Almacenamiento seguro y aislamiento

**Credenciales del proveedor.** Secreto por empresa y canal en **Supabase Vault** o cifrado de sobre con **KMS** (clave de datos por empresa); en la base solo la referencia y metadatos. Descifrado únicamente dentro de la Edge Function y únicamente para la llamada; sin registro del valor; rotación y caducidad; cada acceso audita. Ningún rol `authenticated` puede leerlas. Alternativa a evaluar con el certificador: **claves de API por empresa creadas por la propia empresa** (menos custodia para NEXA).

**Credenciales de SAT.** No se almacenan (I5). El canal Playwright usa una sesión manual en el equipo de la empresa.

**Firma electrónica del emisor.** Decisión D4: (a) la firma la custodia el certificador (cómo se carga, **por confirmar**); (b) NEXA la custodia (archivo `.pfx` cifrado con clave por empresa y contraseña separada; mayor responsabilidad y superficie de ataque; solo si el certificador lo exige y con evaluación de HSM/KMS); (c) la firma queda en el equipo de la empresa (agente local). **No se implementa ninguna hasta decidir.**

**Documentos (XML/PDF/evidencias).** Bucket privado; ruta `{empresa_id}/{documento_id}/{operacion_id}/…`; políticas de `storage.objects` por pertenencia a la empresa y permiso `artefactos.descargar`; objetos escritos una sola vez (sin UPDATE/DELETE) con SHA-256 registrado; URL firmada de corta duración; cifrado en reposo; copias de seguridad por empresa; **retención** según la normativa (plazo **por verificar**). El administrador maestro no accede.

**Aislamiento.** RLS en todas las tablas nuevas; pruebas SQL de aislamiento entre empresas ampliando las existentes (`02_rls_aislamiento.sql`); pruebas de que un agente o una credencial de la empresa A no puede tocar la B; sin consultas entre empresas; registros de auditoría por empresa.

**Operación.** Separación de ambientes (simulado/pruebas/producción) por proyecto o por esquema, secretos distintos por ambiente; sin datos reales en pruebas; registro saneado (sin NIT completos, sin credenciales, sin cuerpos innecesarios).

## 8. Lo que este diseño NO hace

No integra Digifact ni ningún certificador; no implementa el mock, el agente ni las migraciones; no habilita ninguna emisión real; no toca `fel/poc-sat/` ni la Etapa 2; no usa credenciales; no llama a endpoints (de pruebas ni de producción); no modifica `main`.
