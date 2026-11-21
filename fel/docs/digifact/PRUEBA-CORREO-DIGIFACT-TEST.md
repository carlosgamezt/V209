# Primera prueba REAL del correo por Digifact (TEST) · plan, controles y reversión

**Estado: EJECUTADA el 21/11/2026 con éxito (ver [`RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md`](RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md)).** El procedimiento sirve de referencia para futuras pruebas, cada una con su propia autorización. Todos los horarios de abajo, en hora de Guatemala (UTC−6). La consulta a Emmanuel y Jeimmy ya se envió: este documento no genera otro envío.

## 1. Qué camino se usa y por qué
| Camino | Qué es | Estado |
|---|---|---|
| **A · flujo manual `NEXA FEL · Digifact TEST (manual)`** (recomendado, **primera prueba**) | La certificación TEST ya probada (15/11/2026) se lanza a mano desde Actions, en el entorno protegido `demo-privada`, con secretos `DEMO_*`. No toca la app hospedada ni NEXA. | Listo para aprobar |
| B · app hospedada (casilla del panel Digifact TEST) | Exige almacén persistente de operaciones (migración 29, **sin aplicar**) y un despliegue con `FEL_DIGIFACT_TEST` + `FEL_DIGIFACT_CORREO`. Sin el almacén persistente el servicio se niega a enviar (`ALMACEN_NO_PERSISTENTE`). | **Posterior**, con su propia autorización |

## 2. Aislamiento y restricciones (verificadas)
- **NEXA principal no interviene:** el camino A corre en GitHub Actions con el entorno `demo-privada`; no usa Supabase, Cloudflare ni la app.
- **Certificación TEST restringida:** solo `workflow_dispatch`, solo desde `fel-proveedores-diseno`, el trabajo espera **tu aprobación** en `demo-privada`, y exige las confirmaciones literales `CERTIFICAR-TEST`, la referencia y la huella del emisor aprobada. Producción, anulación y nota de crédito siguen cerradas.
- **Resend y el módulo propio:** apagados (`FEL_CORREO` sin definir). `FEL_DIGIFACT_CORREO` de la app: **sin definir** en este camino.
- NIT/CUI y reglas de certificación: sin cambios (con `con_correo = no` la salida es la de siempre).

## 3. Controles del correo (todos con pruebas)
| Control | Cómo funciona |
|---|---|
| Doble confirmación | `con_correo = si` **y** `confirmar_correo = ENVIAR-CORREO-TEST`. Sin ambos, no hay correo. |
| Destinatario fuera de las entradas | El correo viene del **secreto** `DEMO_DIGIFACT_CORREO_PRUEBA`; nunca se escribe en la ejecución. |
| Lista cerrada | `DEMO_DIGIFACT_CORREO_DESTINATARIOS` (direcciones y/o `@dominio`). Sin lista, correo fuera de la lista o lista inválida → **no se envía nada**, antes de cualquier llamada a la red. |
| Nodo exacto | Se verifica que `Buyer.Contact.EmailList.Email` tenga **un solo** elemento, igual al autorizado, y que **nada más** cambió respecto al NUC sin correo (datos fiscales del receptor incluidos). |
| Sin reenvío del mismo NUC | Antes de enviar se consulta (solo lectura) si la referencia ya está certificada: **ya certificada** o **no verificable** → no se envía. Se usa una referencia nueva por prueba. |
| Un solo intento | El cliente no reintenta tras enviar; un resultado incierto se **concilia**, nunca se reenvía. |
| Registro sin datos sensibles | La salida lleva el correo **enmascarado** (`c***@dominio`), banderas y huellas; nunca el correo completo, credenciales ni el texto del proveedor. |
| Solicitado ≠ entregado | Se registra `solicitado_a_digifact` y `entregaConfirmada: false`. La entrega solo se comprueba en el buzón. |

## 4. Lo que haces TÚ antes (una vez)
1. En GitHub → *Settings → Environments → demo-privada → secrets*, crear **`DEMO_DIGIFACT_CORREO_PRUEBA`** (un buzón **tuyo**, p. ej. Gmail) y **`DEMO_DIGIFACT_CORREO_DESTINATARIOS`** (lista con ese mismo buzón y, si quieres, otro tuyo de Outlook). No pegues estos valores en el chat ni en entradas del flujo.
2. Confirmar que `demo-privada` sigue exigiendo tu aprobación (revisor requerido).

## 5. Procedimiento exacto (Actions → «NEXA FEL · Digifact TEST (manual)» → Run workflow, rama `fel-proveedores-diseno`)
| # | Paso (`paso`) | Entradas | Qué debe verse | Envía algo |
|---|---|---|---|---|
| 0 | `credenciales-presentes` | — | `correoPrueba: { correoDePrueba: true, listaDeDestinatarios: true }` (solo presencia) | No |
| 1 | `validar-nuc` | — | `ok: true` | No (sin red) |
| 2 | `datos-emisor` | `autorizacion` = UUID de un DTE de TEST ya aceptado, `referencia` = GUID **nuevo**, `con_correo = no` | Datos del emisor, `huellaEmisor`, `ok: true` (igual que siempre) | No |
| 3 | `datos-emisor` | igual que 2 + `con_correo = si` | `correo: { estado: "listo", destinatario: "c***@…", cantidadDeCorreosEnElNuc: 1, nodoExactoYSinOtrosCambios: true }` y el NUC con el correo **enmascarado** | No |
| — | **Tu aprobación** | Revisas 2 y 3 y apruebas la ejecución del paso 4 (anota la hora) | | |
| 4 | `certificar-test` | `confirmar = CERTIFICAR-TEST`, `referencia` (la misma de 2/3), `huella_emisor` (la de 2), `con_correo = si`, `confirmar_correo = ENVIAR-CORREO-TEST`, `autorizacion` (la del paso 2) | `ok: true`, autorización/serie/número, `sha256Xml`, `sha256Pdf`, `correo: { estado: "solicitado_a_digifact", entregaConfirmada: false, xmlCertificadoTraeCorreoReceptor: true/false/null }` | **Sí: UNA certificación TEST y, si Digifact lo hace, UN correo** |
| 5 | `consulta-posterior` (opcional) | `autorizacion` del paso 4 | `ok: true` | No |
| 6 | `descargar` (opcional) | `autorizacion` del paso 4 | `sha256Xml`/`sha256Pdf` **iguales** a los del paso 4 | No |

**No repitas el paso 4.** Si algo falla, no se vuelve a lanzar con la misma referencia: se diagnostica primero.

## 6. Verificación del resultado
1. **Certificación:** `ok: true`, autorización (UUID), serie y número entregados por Digifact; los XML/PDF quedan 1 día como artefacto `digifact-test-documentos`.
2. **¿Envió Digifact el correo?** Revisa el buzón autorizado (y spam) hasta 15 minutos después. Anota: llegó / no llegó, de qué remitente, con qué asunto y plantilla. **Si no llega, NO se reenvía**: en TEST puede que Digifact no envíe (pregunta 6 de la consulta) y es información valiosa.
3. **Adjuntos = documento certificado:** descarga el PDF y el XML del correo y compara su SHA-256 (`sha256sum archivo`) con `sha256Xml`/`sha256Pdf` del paso 4; abre el XML y confirma que la autorización (UUID) coincide y, si el XML trae `CorreoReceptor`, que es el correo autorizado (`xmlCertificadoTraeCorreoReceptor`). El PDF de TEST lleva la marca «Documento de Prueba».
4. **Nada más cambió:** el correo autorizado era el único destinatario y los datos fiscales del receptor siguen siendo «CONSUMIDOR FINAL».

## 7. Medidas para detenerlo
| Momento | Medida |
|---|---|
| Antes del paso 4 | No lanzarlo, **rechazar la aprobación** del entorno o *Cancel workflow*. No hay efecto alguno. |
| Cualquier momento | Borrar o vaciar **`DEMO_DIGIFACT_CORREO_PRUEBA`** o `…_DESTINATARIOS`: el paso falla cerrado (`falta_correo_de_prueba` / `falta_lista_de_destinatarios`) y no sale nada. |
| Siempre | `con_correo` viene en **no** por defecto; sin ambas confirmaciones no hay correo. |
| Después | Los artefactos con XML/PDF expiran al día siguiente. Retirar los secretos del correo al terminar la prueba. |
| **Irreversible** | Una certificación TEST ya hecha **no se anula** (la anulación sigue cerrada) y un correo ya enviado **no se retira**. Por eso: **una sola prueba, un buzón propio, una referencia nueva**. |

## 8. Camino B (después, con su propia autorización)
Requiere: migración 29 (almacén persistente) aplicada, despliegue con `FEL_DIGIFACT_TEST`, `FEL_DIGIFACT_AUTORIZA_REFERENCIA` y `FEL_DIGIFACT_CORREO` (+ `_EMPRESA` + `_DESTINATARIOS`). Se apaga con `secrets unset` del flujo de publicación. No se hace en esta prueba.

## 9. Observación tras la prueba y pendiente que cambiaría lo esperado
El correo real mostró el logotipo AGRIPACK con emisor TEST GENS (remitente `eface@digifact.com.gt`): ver [`RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md`](RESULTADO-PRUEBA-CORREO-DIGIFACT-TEST.md). Sigue pendiente la respuesta de Digifact:
Respuesta de Digifact sobre: si los correos de TEST salen a la dirección real, qué plantilla usa por defecto y el efecto de `Seller.Contact.EmailList`. La plantilla NEXA FEL se mantiene como propuesta; **no se envía ningún parámetro de plantilla** cuyo comportamiento Digifact no haya confirmado.
