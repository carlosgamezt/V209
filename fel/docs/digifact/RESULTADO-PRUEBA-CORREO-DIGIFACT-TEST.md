# Resultado · primera certificación TEST con correo enviado por Digifact

**Estado: EXITOSA (21/11/2026).** Digifact certificó la factura de prueba y envió el correo con el PDF y el XML adjuntos. Hora de Guatemala (UTC−6). Plan y controles: [`PRUEBA-CORREO-DIGIFACT-TEST.md`](PRUEBA-CORREO-DIGIFACT-TEST.md).

## Datos del documento (sin datos personales)
| Dato | Valor |
|---|---|
| Ambiente | TEST (`testnucgt.digifact.com`). Documento de prueba, sin validez fiscal |
| Ejecución | Flujo manual «NEXA FEL · Digifact TEST», run 27, paso `certificar-test`, entorno `demo-privada` aprobado a mano |
| Referencia interna | `fc1452e9-1eb2-43ca-b5c5-81b6bddb9c75` |
| Autorización (UUID) | `A7220268-0BCF-4C35-9661-6791E5ADF2DC` |
| Serie y número | `A7220268` · `198134837` |
| Fecha de certificación | 21/11/2026 13:33 (hora de Guatemala) |
| Respuesta de Digifact | `code` 1 · «Proceso de certificacion realizado correctamente!» |
| Documento | Una factura, un servicio de prueba, total Q100.00 (IVA Q10.714286 sobre Q89.285714), receptor Consumidor Final |
| Emisor | Datos leídos del XML del DTE de TEST anterior (autorización `39CBAB22-21E9-4AB9-B863-BA8F1FE87EF6`); huella validada `04a1a7f8ff9a922f` |
| SHA-256 del XML | `8d5ab8eb8259adf1f60a94c5171d3998790502d31cca52f1c7fd26a5fc341005` |
| SHA-256 del PDF | `3d4abc1ebb8febcd3e7f53aae9631cabd6c7e2cbe6ab57cae0a0dd54028885bf` |

No se guarda el correo del destinatario (ni completo ni enmascarado), credenciales ni el NIT del emisor.

## Correo: solicitado vs. entregado
- **Solicitado a Digifact:** sí. El NUC llevó `Buyer.Contact.EmailList.Email` con un solo correo, el del buzón autorizado, y se verificó que nada más cambió. El XML certificado trae ese correo como `CorreoReceptor` (`xmlCertificadoTraeCorreoReceptor: true`).
- **Entregado:** **confirmado a mano por el responsable**: el mensaje llegó a las 13:33 con el PDF y el XML adjuntos. Digifact no confirma la entrega por API; esta comprobación solo se hace en el buzón.

### Datos del correo recibido (confirmados por el responsable con la captura de Gmail)
| Dato | Valor |
|---|---|
| Asunto | «Factura electrónica de TEST GENS disponible» |
| Nombre del remitente | TEST GENS |
| Dirección del remitente | `eface@digifact.com.gt` (dominio de Digifact: el correo lo envía Digifact, no NEXA FEL) |
| Recepción | 21/11/2026 13:33 (hora de Guatemala) |
| Adjuntos | PDF y XML, recibidos correctamente |
| Comparación SHA-256 de los adjuntos con los de arriba | **Pendiente de verificar** |

El nombre del remitente y el asunto toman el nombre del emisor del documento (TEST GENS), no un nombre de NEXA FEL.

## Cómo se evitó el riesgo (se mantiene para futuras pruebas)
Una sola certificación por referencia nueva, sin reintentos; doble confirmación (`CERTIFICAR-TEST` y `ENVIAR-CORREO-TEST`); destinatario desde un secreto de `demo-privada` y lista cerrada; consulta previa de la referencia; aprobación manual del entorno; ningún valor sensible en los registros.

## Lecciones del procedimiento
- `datos-emisor` con correo también exige `confirmar_correo = ENVIAR-CORREO-TEST` (el código la pide para cualquier paso que lleve correo).
- Sin `autorizacion` de un DTE de TEST reciente, `datos-emisor` y `certificar-test` buscan el emisor en los acuses recientes y pueden no encontrar nada.
- Los documentos del flujo se guardan 1 día como artefacto; este registro conserva los identificadores y las huellas.

## Observación importante: el correo muestra el logotipo AGRIPACK
El correo muestra el logotipo de **AGRIPACK**, aunque el emisor del documento de prueba es **TEST GENS**. Es una observación confirmada con la captura de Gmail. **No se ha cambiado nada.**

### Por qué importa para NEXA FEL (multiempresa)
Si la plantilla se asigna por cuenta, integrador o a nivel global, un logotipo ajeno podría aparecer en correos de otras empresas dentro de NEXA FEL. Antes de enviar correos reales a clientes hay que saber **cómo asigna Digifact la plantilla** y **cómo funcionará con varias empresas**.

### Qué NO sabemos (no asumir)
- Cómo se elige la plantilla: por NIT del emisor, por cuenta de usuario, por integrador/proveedor de la cuenta o global; y por qué esta cuenta TEST muestra AGRIPACK.
- Si cada empresa de NEXA FEL puede tener su propia plantilla y logotipo, y quién la configura (portal de Digifact, soporte o nuestro equipo).
- Si `AdditionalDocumentInfo.DocTemplate` o `Seller.Contact.EmailList` influyen. **No se puede suponer que se modifique mediante el NUC sin confirmación del proveedor.**
- Si existe un mecanismo por API para ello, su costo y su alcance.

### Siguiente (investigación con Digifact; cada paso con autorización)
1. Preguntar a Digifact (soporte, Emmanuel y Jeimmy; ya recibieron la consulta anterior, [`borrador-consulta-plantilla-correo.md`](borrador-consulta-plantilla-correo.md), sin respuesta registrada) con el caso concreto: emisor TEST GENS, remitente `eface@digifact.com.gt`, logotipo AGRIPACK, y la pregunta multiempresa. Ese envío lo decide y lo hace el responsable.
2. Según la respuesta, preparar la presentación NEXA FEL minimalista ([`plantilla-correo-propuesta.html`](plantilla-correo-propuesta.html)) y decidir el modelo multiempresa.
3. Hasta tener respuesta: **no** alterar el XML fiscal, **no** enviar parámetros de plantilla no confirmados y **no** enviar correos reales a clientes por esta vía. Resend y el módulo de correo propio siguen apagados.
