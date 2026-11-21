# Recuperación y conciliación de certificaciones (migración 29)

**Principio:** una certificación hecha en Digifact **no se deshace** restaurando una copia de Supabase. La base de NEXA es la *memoria* de lo enviado; el certificador es la *fuente de verdad*. Por eso, antes de cualquier envío se consulta al certificador (solo lectura), y ante cualquier incertidumbre **no se reintenta solo**.

## Cómo se evita una segunda certificación
| Situación | Mecanismo | Dónde se prueba |
|---|---|---|
| Doble clic, dos procesos, reintento del navegador | índice único: una sola operación que bloquea por documento (`enviando`/`certificada`/`desconocida`) y transición con compare-and-set | `29_digifact_operaciones.sql`, `almacen_gt_pg_test.ts` (25 envíos simultáneos → 1) |
| Mismo documento, misma operación repetida | la operación `certificada`/`desconocida` se reutiliza: nunca se reenvía | `felgt_servicio_test.ts` |
| **La base perdió la memoria (restauración de un respaldo, reversión)** | la referencia es **determinista** (empresa, documento, huella del contenido, intento). **Chequeo previo:** antes de enviar se busca la referencia en el reporte de acuses de Digifact (solo lectura) el día de la emisión y 7 días atrás. Si Digifact la tiene → **NO se envía**: la operación queda `desconocida` (`ya_existia_en_digifact`) y una persona la concilia | `felgt_servicio_test.ts` y `almacen_gt_pg_test.ts` (restauración sobre PostgreSQL real) |
| Autorización de Digifact repetida dentro de la empresa | índice único por (empresa, autorización) | suite SQL 29 |
| La autorización de una prueba concreta | `FEL_DIGIFACT_AUTORIZA_REFERENCIA`: solo esa referencia se puede enviar; se retira al publicar sin ella | pruebas existentes |

## Resultados desconocidos: nunca hay reintento automático
- **Tras enviar** y sin respuesta clara (corte, tiempo agotado, 5xx, ilegible, código no mapeado): `desconocida`; repetir, volver a preparar o conciliar sin hallazgo **nunca** reenvían (`felgt_servicio_test.ts`, 3 vueltas comprobadas).
- **Antes de enviar**, si no se puede verificar en Digifact que la referencia sea nueva (reporte caído, ilegible, sin respuesta clara): **no se envía** (`PREVUELO`, falla cerrado), la operación sigue `preparada`, hay **una sola consulta** y ningún reintento; una persona decide cuándo repetirlo.
- **Conciliación** (`Consultar a Digifact`): lee el reporte por referencia (en el día en que se halló); si aparece, adopta SU resultado (UUID, serie, número), lo aplica al documento y recupera el XML y el PDF de Digifact (se validan y su SHA-256 queda registrado). Es idempotente.

## Procedimiento tras restaurar un respaldo (o tras un error en la base)
1. **No volver a certificar nada** hasta terminar. Dejar `FEL_DIGIFACT_TEST` apagado y sin `FEL_DIGIFACT_AUTORIZA_REFERENCIA` (la publicación lo retira).
2. Listar lo certificado en Digifact después de la fecha del respaldo (reporte de acuses de Digifact o el flujo manual de TEST: `consulta-posterior`).
3. Con el servicio encendido y **sin** autorización de envío, abrir cada documento afectado y usar «Preparar» + «Consultar a Digifact»: el chequeo previo hallará la referencia, dejará la operación `desconocida` y «Consultar» registrará UUID, serie y número y recuperará XML/PDF.
4. Verificar con `verificacion-posterior-29.sql` y comparar contra el registro de `docs/digifact/RESULTADO-*.md`.
5. Solo entonces volver a autorizar envíos, uno por vez.

## Qué se BLOQUEA con seguridad y qué NO (explícito)
| Caso | Resultado | Cómo se garantiza |
|---|---|---|
| Resultado desconocido tras enviar | **bloquea** para siempre hasta conciliar; **nunca** se reenvía solo | índice único (`desconocida` bloquea) + el servicio reutiliza la operación; prueba «resultado desconocido tras enviar: no hay reintento automático» |
| Digifact ya tiene la referencia (dentro de la ventana) | **bloquea** el envío; queda `desconocida` para conciliar | chequeo previo; pruebas de restauración (servicio y PostgreSQL real) |
| No se puede verificar en Digifact (reporte caído, ilegible, ambiguo, respuesta con otra referencia) | **bloquea** el envío (`PREVUELO`, falla cerrado); sin reintento automático | pruebas «chequeo previo… con una duda NO se envía» |
| La referencia es más antigua que la ventana de 7 días | **NO se puede detectar** (límite del método) | ver «Límites»; se cubre con el procedimiento y con el control humano de abajo |
| La ventana no se puede reducir ni apagar en producción | `prevueloDias` solo existe como dependencia del código (pruebas); `crearDigifactDesdeEntorno` no lo expone y **ninguna variable de entorno lo cambia** | el valor por defecto es 7 y una prueba comprueba las 8 consultas previas |

**Control humano que cubre el límite:** solo se puede enviar la referencia de `FEL_DIGIFACT_AUTORIZA_REFERENCIA` (una a la vez). Tras restaurar un respaldo, lo primero es publicar con `digifact = apagado` (retira esa autorización y los secretos de Digifact de la función) y conciliar antes de volver a autorizar nada.

## Preparaciones vencidas: renovación acotada (sin crear otra operación)
Una preparación vence a los 30 minutos (no se certifica vencida). Al volver a preparar el mismo documento, **la misma operación se renueva**: misma referencia, huella y contenido fiscal, sin segunda operación y sin autorizar nada (certificar sigue exigiendo la confirmación escrita, la referencia, la huella y la autorización expresa de esa referencia).
- Solo se renueva una operación **«preparada»**. «enviando», «certificada» y «desconocida» no se renuevan ni se reemplazan: un resultado incierto sigue bloqueando.
- Tope, impuesto también por la base: de a una renovación por vez, **máximo 3** y dentro de las **24 horas** de su creación. Agotada, se **descarta sin enviar** (`preparada → no_enviada`, nunca salió nada) y se prepara otra con referencia nueva.
- Queda auditada (`digifact_test.preparada_renovada` / `digifact_test.preparada_descartada`). Esto permite publicar la función con la referencia autorizada entre preparar y certificar sin que la preparación venza.

## Límites que conviene conocer (no se ocultan)
- La ventana del chequeo previo es **7 días**; una certificación más antigua que la fecha de emisión menos 7 días no se vería (ampliar `prevueloDias` si el respaldo es más viejo).
- El chequeo depende de la **disponibilidad del reporte de acuses** de Digifact. Su respuesta para días sin documentos (`Respuesta = 0`) se asume como «no hay» según la documentación y las pruebas hechas; **debe confirmarse con una consulta real de solo lectura antes de habilitar la certificación desde la aplicación** (ver el plan de aplicación). Si Digifact respondiera algo distinto, el sistema **se niega a enviar** (falla cerrado), nunca envía de más.
- Una reversión de la migración **con datos se rechaza** (`reversion-29.sql`): esas tablas son la evidencia de certificaciones que existen fuera de Supabase.
