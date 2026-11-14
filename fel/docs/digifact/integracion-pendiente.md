# Digifact Guatemala · bitácora de integración (qué está confirmado y qué falta)

Actualizada el **14/11/2026**. Ambiente de trabajo: **TEST** (`https://testnucgt.digifact.com/api/`). Producción: **bloqueada** hasta autorización expresa.
Regla: este documento solo afirma lo que la documentación oficial dice. Todo lo demás figura como **PENDIENTE** y no se ha supuesto en el código.

## 1. Documentación

| Documento | Versión | Leída | Dónde |
|---|---|---|---|
| API Reference Guatemala | V2.0.6 (el servicio TEST corre V2.4.0; PROD V2.4.12) | Sí | `documentacion.digifact.com/gt/api.md` |
| NUC JSON | V2.0.3 (vigente desde 17/03/2026) | Sí | `/gt/nuc/json.md` |
| NUC XML | V2.0.3 | Descargado, no usado todavía | `/gt/nuc/xml.md` |
| Esquema JSON (draft-04) y XSD | sin versión propia | Sí (copia en `fel/proveedores/digifact/`) | `/schemas/gt/NUCSchema.json`, `.xsd` |
| Ejemplos (46: 36 XML, 10 JSON) | — | 2 JSON usados en pruebas | `/gt/nuc/ejemplos.md` |
| Conceptos fiscales, Novedades (última: 13/10/2026, complemento TRASMER para NEV) | — | Sí | `/gt/conceptos.md`, `/gt/novedades.md` |
| Guía «Reportes diarios: contingencia, acuses SAT y resumen» | v1.0.0 (16/10/2026) | Sí | `/gt/guias/reportes-diarios-contingencia-acuses-resumen.md` |
| Catálogos (DocType, tipo de forma de pago, complementos…) | — | DocType leído; el resto sin descargar | `/gt/catalogos.md` |
| **SAT · Reglas y Validaciones FEL V2.2 (matriz «Frases a incorporar en los DTE», sección 2.5)** | — | **NO disponible en el portal** | PENDIENTE: pedirlo |
| Catálogo completo de códigos de respuesta (`code`) | — | **NO publicado** (solo 1, 401, 500 y «otro») | PENDIENTE |

Observaciones de la propia documentación: (a) «los links» del portal apuntan a `localhost:3001` pero las páginas existen en `documentacion.digifact.com`; (b) el catálogo `doctype` lista `FACM` para Factura Cambiaria mientras `/gt/nuc.md` usa `FCAM`; (c) el ejemplo de respuesta de certificación muestra `code` como texto (`"1"`) y el del NUC JSON como número (`0`): el cliente acepta ambos.

## 2. Credenciales (solo nombres; los valores nunca se escriben aquí, ni en el repositorio, ni en el chat, ni en registros)

| Dato | Valor de TEST conocido | Dónde vive el secreto |
|---|---|---|
| NIT TEST | `5888492` (el NIT no es secreto; se rellena a `000005888492`) | Supabase: `DIGIFACT_TEST_NIT` · GitHub (entorno `demo-privada`): `DEMO_DIGIFACT_TEST_NIT` |
| Usuario TEST | el que entregó Digifact (no se escribe aquí) → inicio de sesión `GT.000005888492.<usuario>` | `DIGIFACT_TEST_USERNAME` · `DEMO_DIGIFACT_TEST_USERNAME` |
| Contraseña TEST | (ya cambiada por el propietario) | `DIGIFACT_TEST_PASSWORD` · `DEMO_DIGIFACT_TEST_PASSWORD` |
| Afiliación IVA / establecimiento / frase | GEN · 2 · tipo 1 escenario 2 | datos del emisor (no secretos) |

- Un secreto de **Supabase** solo lo lee una Edge Function desplegada. Un script de CI no puede leerlo: por eso, para las pruebas reales **sin desplegar nada**, el workflow `NEXA FEL · Digifact TEST` usa los secretos **de entorno de GitHub** `DEMO_DIGIFACT_TEST_*`. Los de Supabase se usarán cuando se despliegue la función.
- Estado de los secretos: **no verificable desde la sesión de desarrollo** (no tiene acceso a Supabase ni a los secretos de GitHub).

## 3. Ambientes

| Ambiente | URL | Notas |
|---|---|---|
| TEST | `https://testnucgt.digifact.com/api/` | No exige firma electrónica del emisor. |
| Producción | `https://nucgt.digifact.com/gt.com.apinuc/api/` | Exige la firma electrónica del emisor (agencia virtual de SAT). **No se usa.** |

## 4. Servicios

| Servicio | Endpoint | Estado en el cliente (`src/digifact_gt.ts`) | Pendiente de confirmar |
|---|---|---|---|
| Token | `POST /login/get_token` · cuerpo `{Username, Password}` · respuesta `{token}` | Implementado y probado con transporte simulado | Vigencia del token; límite de inicios de sesión; formato del encabezado `Authorization` |
| Certificar | `POST /v2/transform/nuc_json?TAXID&FORMAT&USERNAME` (JSON). El XML va a `/v2/transform/nuc` (no usado) | Implementado; **no ejecutado contra TEST** | Códigos de `code`; tiempos; idempotencia |
| Consultar NIT | `GET /Shared` · `DATA1=SHARED_GETINFONITcom` · `DATA2=NIT\|<nit>` | Implementado | — |
| Consultar DTE | `GET /Shared` · `DATA1=SHARED_GETDTEINFO` · `DATA2=AUTHNUMBER\|<uuid>` | Implementado | — |
| Descargar | `GET /GetDocument?AUTHNUMBER&TAXID&FORMAT&USERNAME` (XML, HTML, PDF, JSON) | Implementado (XML/HTML/PDF) | Si `JSON` se necesita y dónde llega |
| Conciliar | `GET /Shared` · `DATA1=SHARED_GETREPORTDAILYACUSES` · `DATA2=FECHA\|aaaa-mm-dd[\|ESTABLECIMIENTO\|n]` | Implementado (por `REFERENCIA_INTERNA`) | Retardo; disponibilidad en PRODUCCIÓN (la guía dice «por ahora solo TEST») |
| Anular | `POST /CancelFelGT` | Implementado y **cerrado** (habilitación + confirmación `ANULAR`) | `Taxid` con o sin ceros; plazos; efecto en consumo |
| Nota de crédito total | `POST /cert/ncredtotal` | Implementado y **cerrado** (habilitación + confirmación `NOTA-CREDITO-TOTAL`) | `Staxid` con o sin ceros; alcance (¿solo DTE de Digifact?); plazos |

Formatos: el NIT va **con ceros a 12** en `TAXID` y en el usuario de inicio de sesión; en `Seller.TaxID` del NUC el ejemplo oficial lo muestra **sin ceros** (`123456`) y así se envía. En `CancelFelGT` y `ncredtotal` el ejemplo oficial también lo muestra sin ceros.

## 5. Cómo se evita certificar dos veces (diseño; lo que depende de Digifact está marcado)

1. Cada operación lleva una **referencia interna única** (GUID de 36 caracteres) que se escribe en la **Adenda** del NUC (`AdditionalDocumentInfo.AdditionalInfo[].Code`, campo obligatorio). Es nuestro identificador de idempotencia.
2. El cliente envía **una sola vez**. Si después de enviar hay tiempo agotado, corte, 5xx, 429 o respuesta ilegible, devuelve **«desconocido»** y **no reenvía**.
3. Para resolver el «desconocido» se **concilia** con el reporte diario de acuses buscando esa referencia interna (`conciliarPorReferencia`). «No encontrado» **no** prueba que no se certificó: el orquestador debe esperar y repetir la consulta antes de permitir un reenvío.
4. Dentro de un mismo proceso, el cliente impide dos envíos simultáneos de la misma referencia.
5. **PENDIENTE de confirmar con Digifact:** el efecto real de `VALIDAR_REFERENCIA_INTERNA = VALIDAR` (¿rechaza una referencia repetida?). Hasta confirmarlo se envía `NO_VALIDAR` y no se confía en que Digifact deduplique.

## 6. Estados de un documento (los mapea el orquestador existente; este cliente solo reporta resultados)

Borrador → Validado → Enviando → (Certificado | Rechazado | **Pendiente de confirmación**) → Anulación solicitada → Anulado.
El cliente distingue: **certificado** (código 1 y autorización, serie y número completos), **rechazado_confirmado** (código distinto de 1 o HTTP 400/406/415), **desconocido** (todo lo demás tras enviar). Un 401/403 **antes de procesar** se propaga como error: no cuenta como «desconocido» porque nada se envió.

## 7. Límites, tiempos y manejo de errores

- Límites de solicitudes: **no documentados**. Códigos HTTP documentados: 200, 400, 401, 406 («verificar contenido del NUC»), 415 (Content-Type que no coincide con la URL), 500.
- Tiempo máximo del cliente: 30 s (configurable), sin reintento automático de operaciones fiscales.
- Un 401 se trata como «no procesada»: se renueva el token y se repite **una** vez.

## 8. Preguntas para soporte (soporte-gt@digifact.com · +502 3357 7512) — listas para enviar

1. **Encabezado `Authorization`**: ¿el token JWT se envía tal cual o con el prefijo `Bearer `? (La documentación dice «Token JWT»; la guía de reportes muestra `Authorization: <token JWT>`.)
2. **Vigencia del token** y política de renovación. ¿Hay límite de inicios de sesión por minuto/hora/día para un mismo usuario?
3. **Límites de tasa** por servicio (certificar, consultas, descargas). ¿Cuándo responden 429? ¿Envían `Retry-After`?
4. **Idempotencia**: ¿qué hace exactamente `VALIDAR_REFERENCIA_INTERNA = VALIDAR`? Si enviamos dos veces la misma referencia interna con la misma factura, ¿rechazan la segunda? ¿con qué código? ¿por cuánto tiempo se recuerda la referencia?
5. Si una certificación termina con **tiempo agotado o corte**, ¿cuál es el método recomendado para saber si se certificó? ¿Existe consulta directa por referencia interna? ¿Con qué retardo aparece un documento en `SHARED_GETREPORTDAILYACUSES`? ¿Ese reporte llegará a producción y cuándo?
6. **Catálogo completo de códigos de `code`** (más allá de 1, 401 y 500) y cuáles garantizan que el documento **no** fue certificado.
7. **Tiempo máximo** de respuesta esperado de `/v2/transform/nuc_json` y tiempo de espera del servidor.
8. `CancelFelGT` y `ncredtotal`: ¿`Taxid`/`Staxid` van con o sin ceros a la izquierda? ¿Qué plazo hay para anular? ¿La nota de crédito total aplica solo a documentos certificados por Digifact?
9. **Credenciales en producción por emisor**: ¿cada empresa debe tener su propio usuario y NIT en Digifact? ¿Existe una cuenta de integrador/distribuidor que emita por varios NIT (parámetro `TAXID`) con un solo usuario? ¿Cómo se da de alta un emisor nuevo (API o trámite)? 
10. **Consumo y saldo**: ¿hay API para consultar el consumo o el saldo mayorista de la cuenta? ¿Las certificaciones de TEST consumen saldo? ¿Una anulación o una nota de crédito consumen?
11. **Firma electrónica en producción**: ¿quién la custodia (Digifact o el emisor) y cómo se carga?
12. **Establecimiento de TEST**: ¿cuál es la dirección registrada del establecimiento 2 del NIT 5888492 (`ESTABLECIMIENTO "TEST GEN"`)? ¿Validan el código de establecimiento y la dirección contra el registro de SAT en TEST?
13. ¿Pueden compartirnos el documento **SAT · Reglas y Validaciones FEL V2.2** (matriz de frases por tipo de DTE y afiliación)? Nuestra frase de TEST es tipo 1, escenario 2.
14. El servicio TEST corre **V2.4.0** y la documentación es **V2.0.6**: ¿hay diferencias de comportamiento que debamos conocer?
15. Orden de `ResponseData1/2/3` cuando se piden formatos parciales (p. ej. `PDF` solo): ¿siempre XML=1, HTML=2, PDF=3? (El ejemplo de `GetDocument` muestra `ResponseData1` vacío al pedir `HTML|PDF`.)
16. ¿Por cuánto tiempo se pueden descargar los DTE (`GetDocument`)?
17. `FACM` vs `FCAM` para Factura Cambiaria: ¿cuál es el valor correcto de `DocType`?

## 9. Casos de prueba reales pendientes (en TEST, con autorización por cada uno)

| # | Caso | Quién lo ejecuta | Estado |
|---|---|---|---|
| 1 | Autenticación (JWT válido) | Workflow `Digifact TEST` → `autenticar` | Pendiente (faltan los secretos `DEMO_DIGIFACT_TEST_*` y tu autorización) |
| 2 | Consulta de NIT | `consultar-nit` (prueba sin prefijo y, si hay 401, con `Bearer`) | Pendiente |
| 3 | Validación del NUC (sin red) | `validar-nuc` | Se ejecuta en CI en cada commit |
| 4 | Certificación TEST (1 factura) | `certificar-test` con `CERTIFICAR-TEST` | Pendiente de autorización explícita |
| 5 | Consulta posterior y descarga | `consulta-posterior`, `descargar` | Pendiente |
| 6 | Misma referencia dos veces (con `VALIDAR` y con `NO_VALIDAR`) | manual, con autorización | Pendiente |
| 7 | Conciliación por referencia tras una certificación | `conciliarPorReferencia` | Pendiente |
| 8 | Anulación y nota de crédito total en TEST | requieren habilitación explícita | Pendiente |
| 9 | Timeout real forzado (cliente con tiempo muy corto) | manual | Pendiente |
| 10 | Receptor con NIT y con CUI; ítem de Bien y de Servicio; descuento | manual | Pendiente |

## 10. Pendientes de NEXA (no de Digifact)

- **Migración nueva y aditiva** para permitir el ambiente `pruebas` en el proveedor `digifact` (hoy una restricción de tabla lo limita a `simulado`). **No creada ni aplicada**: necesita tu autorización.
- Dirección real del establecimiento 2 (hoy se usa la del ejemplo oficial solo en TEST).
- Almacenamiento privado de XML/PDF y descarga autorizada por usuario/empresa.
- Credenciales **por emisor** (diseño propuesto, sin implementar hasta la respuesta a la pregunta 9): una tabla de **referencias** (nunca valores) por `empresa_id` + proveedor + ambiente, con el NIT del emisor, el usuario de Digifact y el **nombre** del secreto en Supabase Vault (o el secreto de la propia empresa); RLS por empresa, lectura solo desde el backend con permiso, rotación auditada. Los valores TEST actuales son de **un solo emisor**: no se asume que sirvan para otras empresas ni para producción.
- Conexión del formulario con el backend (Prueba 6), después de una autenticación real exitosa.
