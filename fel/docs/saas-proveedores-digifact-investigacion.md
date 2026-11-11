# Investigación: Digifact Guatemala y requisitos de certificación FEL

Rama `fel-proveedores-diseno`. **Investigación documental; no se llamó a ningún endpoint, no se usó ninguna credencial.** Este documento acompaña a `saas-proveedores-diseno.md`.

## 0. Límite de esta investigación (importante)

**No pude abrir `documentacion.digifact.com` desde este entorno**: la red de la sesión no resuelve ese dominio (el mismo problema que con `portal.sat.gob.gt`). Todo lo «confirmado» abajo proviene de **fragmentos de la propia referencia de Digifact devueltos por un buscador**, no de una lectura completa. Si queréis que lea la documentación entera, hay que **permitir `documentacion.digifact.com` en la configuración de red de la sesión**; entonces repito la lectura y completo este documento. Lo que no aparece en los fragmentos queda como **no confirmado**.

## 1. Digifact: qué está confirmado y qué no

**Confirmado (fragmentos de la referencia oficial [API Reference — Guatemala](https://documentacion.digifact.com/gt/api) y de la especificación [NUC XML V2.0.3](https://documentacion.digifact.com/gt/nuc/xml)):**
- Ambientes separados: **pruebas** en `testnucgt.digifact.com/api/` y **producción** en `nucgt.digifact.com/gt.com.apinuc/api/`.
- Todas las operaciones requieren un **token JWT** que se envía en el encabezado `Authorization`.
- Operación de certificación **`CERTIFICATE_FE_XML_TOSIGN` V2** (la V1 está obsoleta): certifica un DTE ante la SAT, acepta el NUC en **XML o JSON** con una **URL distinta** para cada formato, y devuelve el documento certificado en **base64** (XML/HTML/PDF).
- Con XML el `Content-Type` debe ser `application/xml`; un `Content-Type` que no coincide con la URL devuelve **415 Unsupported Media Type**.
- **Producción exige la firma electrónica del emisor** (obtenida en la Agencia Virtual de SAT); el ambiente de **pruebas no la exige**.
- Operaciones listadas: certificar, **anular** (`CancelFelGT`: cuerpo JSON con `Taxid`, `Autorizacion` —UUID del documento—, `IdReceptor`, `FechaEmisionDocumentoAnular`, `MotivoAnulacion`, `Username`; encabezado `Authorization` con JWT), **consultar** (`Shared`), **obtener documento** (`GetDocument`) y **nota de crédito total** (`cert/ncredtotal`).

**Fuentes secundarias (no oficiales; tratar como no verificadas):** un manual técnico antiguo de Digifact alojado en [Studocu](https://www.studocu.com/pe/document/universidad-cesar-vallejo/analisis-y-diseno-de-sistemas/manual-tecnico-digifact-fel-v-0-03/126161397) menciona completar el **NIT a 12 dígitos con ceros a la izquierda**, devolver el XML certificado en `ResponseData1` y usar URLs antiguas que ya no coinciden con la referencia actual; un [PR de GitHub](https://github.com/mazariegososcar77/tallerAEG/pull/27) y un [SDK PHP](https://github.com/aalonzolu/digifact) describen integraciones de terceros. Un tercero afirma que la firma la aplica el certificador, lo que **contradice** el requisito de firma del emisor en producción de la referencia oficial: **se debe aclarar con Digifact** (pregunta C6).

**No confirmado** (no apareció en los fragmentos): el endpoint y el formato exacto de **obtención de token** (credenciales, caducidad, renovación); límites de tasa y tamaño; si certificar **deduplica** por una referencia nuestra (idempotencia); campo para una referencia del integrador; códigos de error completos y su semántica (cuáles garantizan que **no** hubo DTE); cómo se **sube o gestiona la firma**; existencia de **webhooks**; modelo **multiempresa/reventa**; precios; SLA y soporte; datos de las **credenciales de prueba**; si hay **sandbox con datos persistentes**; formato de `GetDocument` y de `Shared`.

## 2. Tipos de DTE y requisitos técnicos

**Tipos de DTE del régimen FEL (lista de memoria de la normativa; NO verificada en esta investigación, a confirmar con la tabla oficial de SAT y con Digifact):** factura (`FACT`), factura cambiaria (`FCAM`), factura de pequeño contribuyente (`FPEQ`), factura cambiaria de pequeño contribuyente (`FCAP`), factura especial (`FESP`), nota de abono (`NABN`), recibo por donación (`RDON`), recibo (`RECI`), nota de débito (`NDEB`) y nota de crédito (`NCRE`). **Prioridad del MVP individual:** el tipo que usa la empresa piloto (en la captura del formulario aparece «Factura Pequeño Contribuyente»); el resto se añade por catálogo versionado y *no se habilita ninguno sin regla verificada*.

**Requisitos técnicos a respetar (mezcla de confirmado y por confirmar):** XML/JSON en el formato NUC; NIT con el relleno que exija el proveedor; moneda y redondeos según reglas verificadas; fecha de emisión; establecimiento; receptor (NIT, CUI o ID extranjero; «CF» para consumidor final); firma del emisor en producción; respuesta en base64 con XML/PDF.

**Anulaciones:** según el [portal de SAT](https://portal.sat.gob.gt/portal/preguntas-frecuentes/cumplimiento-tributario/) (fragmento), el plazo de anulación es el mes de emisión y, como máximo, hasta el vencimiento de la declaración mensual del IVA; existe la anulación extemporánea con análisis de SAT. Una fuente de terceros ([GoSocket](https://gosocket.net/centro-de-recursos/la-sat-aplicara-nuevas-reglas-a-las-anulaciones-de-dte-y-en-la-emision-de-la-factura-especial-para-el-regimen-exento/)) habla de reglas nuevas y otra ([INDRESE](http://www.indrese.com/noticias/index.html)) de que las facturas a CF solo se anularían el mismo día o el siguiente; **sin confirmar y sin fecha de vigencia segura**. En el proyecto, las reglas de anulación siguen **vacías y sin verificar**: no se anula nada hasta tener una regla verificada y vigente.

**Autoridad de la lista de certificadores:** SAT publica un [listado de certificadores de DTE](https://portal.sat.gob.gt/portal/certificador-de-dte/); la búsqueda lo confirmó como la fuente oficial pero no devolvió su contenido, así que la **vigencia de la autorización de Digifact** debe comprobarse ahí.

## 3. Limitaciones y riesgos de la API (a validar)
1. **Dos formatos, dos URLs, un `Content-Type`**: un error de configuración produce 415; el adaptador debe fijar formato y URL juntos.
2. **Token JWT**: la caducidad y la política de renovación son desconocidas; el adaptador no debe renovar ni reintentar certificar en bucle.
3. **Respuesta en base64** con múltiples formatos: validar y almacenar con hash.
4. **Producción exige firma del emisor; pruebas no**: un éxito en pruebas **no prueba** que producción funcione.
5. **Idempotencia desconocida**: hasta confirmar lo contrario, se asume que **reintentar puede duplicar**; la conciliación por consulta es obligatoria.
6. **Semántica de errores desconocida**: todo código no mapeado → `desconocido` (diseño §3).
7. **Límites de tasa y tamaño** desconocidos: el adaptador declara `tiempoMaximoMs` y no reintenta.
8. **Dependencia del proveedor**: caída, cambio de contrato o suspensión de la autorización → la interfaz permite un segundo proveedor, pero un documento ya enviado se concilia y anula con **su** proveedor.

## 4. Qué consultar comercialmente (a Digifact y a otros certificadores)

**Modelo y precios**
- C1. Precio por DTE (tramos por volumen), cuota mensual/anual, costo de ambiente de pruebas, costo por anulación, por consulta y por almacenamiento; ¿cobran por documento **rechazado**?
- C2. ¿Moneda, facturación y condiciones de pago? ¿Penalizaciones o mínimos?

**Multiempresa y reventa (clave para un SaaS)**
- C3. ¿Permiten que **una plataforma** (NEXA) integre **múltiples empresas emisoras** con una sola integración? ¿Cada empresa necesita su **contrato/credencial**, o hay una cuenta de **integrador/reseller**? ¿Cómo se factura (a NEXA o a cada empresa)?
- C4. ¿Existe programa de **reventa/marca blanca** y condiciones (precios mayoristas, márgenes, uso de su marca)?
- C5. ¿Límites o requisitos al **alta masiva de empresas** (onboarding por API, validación de NIT, autorizaciones del emisor)?

**Firma y seguridad**
- C6. **¿Quién custodia y aplica la firma electrónica del emisor?** ¿Cómo se carga o gestiona por empresa? ¿Puede la empresa firmar localmente? ¿Aceptan una firma que NEXA custodie, y con qué requisitos de seguridad?
- C7. Gestión de credenciales de API (creación por empresa, rotación, revocación, límites por IP).

**Técnico y operación**
- C8. **Ambientes de prueba**: URL, credenciales de prueba, datos y límites, ¿se parece al comportamiento de producción? ¿Hay un ambiente de **homologación** con SAT?
- C9. **Idempotencia**: ¿deduplican por una referencia del integrador? ¿Qué campo? ¿Qué pasa al reenviar el mismo documento?
- C10. **Códigos de error**: catálogo completo y cuáles garantizan que **no** se generó un DTE; cómo conciliar tras un corte (consulta por referencia o por autorización).
- C11. **Webhooks o notificaciones**; descarga de PDF/XML (formatos, plantillas de PDF personalizables, marca de la empresa).
- C12. Tipos de DTE soportados hoy, **notas de crédito/débito**, factura especial, exportación, contingencia (¿modo de contingencia?).
- C13. Límites de tasa, tamaño, ventanas de mantenimiento, **SLA**, tiempos típicos de respuesta.
- C14. Anulaciones: reglas que aplican, extemporáneas, y cómo se tramitan.

**Soporte y legal**
- C15. Soporte (horario, canales, tiempos de respuesta, escalamiento, gestor de cuenta).
- C16. Contrato: responsabilidad, tratamiento de datos, ubicación y **retención** de documentos, terminación y **portabilidad** (exportar todo si cambiamos de proveedor).
- C17. Confirmación de su **autorización vigente** como certificador ante SAT.

**Preguntas equivalentes para el canal Playwright (a SAT, por escrito):** ¿está permitido el llenado asistido por una herramienta de automatización en el formulario FEL de la Agencia Virtual? (ver B1 en `fase-3-etapa-2a-auditoria-final.md`).

## 5. Qué necesitamos pedirle a Digifact para empezar (sin firmar nada todavía)
Acceso de lectura a la documentación completa, credenciales **de pruebas** (no de producción), el catálogo de errores, la política de idempotencia, una reunión técnica sobre multiempresa y la propuesta comercial por escrito.
