# Ciclo de facturación con Digifact TEST (guardar → revisar → certificar en pruebas)

Estado (25/11/2026): **implementado y probado con Digifact simulado; la certificación real en TEST se ejecuta desde GitHub Actions con tu aprobación (ver §4).** Todos los documentos son de PRUEBA, sin valor fiscal. NEXA principal no se toca; no hay endpoints ni credenciales de producción (el cliente de Digifact solo conoce el ambiente TEST).

## 1. Qué había (revisión del flujo)
| Pieza | Estado previo |
|---|---|
| Guardar borrador → revisado → validar → preparar → certificar | Existía en el servidor (`felgt_servicio.ts`) con garantías fuertes: confirmación escrita, huella del emisor, referencia determinista, escritura previa a la llamada, bloqueo por resultado incierto, conciliación, consulta previa a Digifact, sin reintentos. |
| Interfaz | Un panel aparte «Digifact TEST» con tres pasos manuales (validar, preparar, escribir `CERTIFICAR-TEST` y repetir referencia y huella). Sin una acción única de «guardar y certificar». |
| Autorización | **Por referencia y por despliegue**: cada certificación exigía publicar la función con `FEL_DIGIFACT_AUTORIZA_REFERENCIA=<esa referencia>`. Imposible un ciclo continuo de pruebas. |
| Vista previa | Con un formulario sin guardar mostraba `BR-????`, «impuestos y total pendientes», y PDF y Compartir deshabilitados (solo imprimir). |
| Documentos certificados en TEST | PDF del certificador disponible en el panel, pero la vista previa seguía rotulada «SIMULADO». |

## 2. Qué se implementó
- **La vista previa se abre con el documento guardado.** Si hay cambios y los datos están completos, se guarda primero (con su `BR-####`; PDF y Compartir habilitados). Si faltan datos, muestra lo escrito y dice qué falta.
- **IVA 12 % incluido** en el resumen, la vista previa (carta y ticket) y el PDF local: base gravable, IVA y TOTAL (misma política y redondeo que el documento enviado a Digifact; Q100 → IVA Q10.714286). Es una estimación: el importe definitivo lo fija el certificador.
- **Dos acciones claras** cuando hay ciclo de pruebas autorizado: «Guardar borrador/cambios» y **«Certificar en TEST»** (guarda y revisa por dentro; el id interno sigue siendo guardar-certificar); con el documento ya guardado y revisado, «Certificar en TEST». El flujo: guarda → marca revisado → prepara (no envía nada) → **un solo diálogo de confirmación** («UNA sola vez… PRUEBAS… sin valor fiscal») → certifica. La confirmación escrita, la referencia y la huella siguen validándose en el servidor (el diálogo las rellena con lo que el servidor devolvió al preparar).
- **El documento se guarda siempre**, pase lo que pase con la certificación: rechazo antes de salir, resultado incierto, caída de red, «Ahora no». En cada caso el mensaje lo dice.
- **Rotulado de pruebas**: un documento certificado en TEST muestra «PRUEBA (TEST) · SIN VALOR FISCAL» (nunca «SIMULADO») en pantalla, ticket y PDF.
- **Autorización del ciclo de pruebas** (`FEL_DIGIFACT_AUTORIZA_REFERENCIA=CICLO-TEST`, entrada `digifact_referencia` del flujo de publicación): vale para cualquier documento de la empresa de demostración **mientras esa publicación esté vigente**. Sigue exigiendo la aprobación de `demo-privada` en cada despliegue, solo funciona con `digifact=habilitado`, solo para la única empresa con credenciales TEST, y se retira publicando con `digifact=apagado`. Solo el valor exacto `CICLO-TEST` vale; cualquier otro texto que no sea un GUID se rechaza.
- **Prueba de certificación contra la demostración publicada** (`nube/prueba_digifact.ts`, entrada `digifact_prueba=habilitado`, apagada por defecto): crea documentos de prueba con la API real, certifica y valida (ver §4).
- El estado `/api/digifact/estado` informa `empresaConCanal` y `ciclo` para que la pantalla ofrezca certificar solo cuando corresponde.

## 3. Controles contra duplicados, errores de conexión y respuestas inciertas (ya existentes, ahora ejercitados desde la interfaz)
| Situación | Qué pasa |
|---|---|
| Doble clic / dos pestañas | La transición `preparada → enviando` es atómica: gana una sola; la otra recibe la operación existente (`reutilizada`), sin reenviar. El botón se deshabilita mientras corre. |
| Certificar un documento ya certificado | Devuelve la misma autorización (idempotente); nunca reenvía. |
| Digifact ya tenía esa referencia (p. ej. tras restaurar un respaldo) | Consulta previa de solo lectura: si existe, NO se envía; queda «desconocida» y una persona concilia. Si no se puede comprobar, tampoco se envía. |
| Tiempo agotado, respuesta ilegible, caída | Queda «desconocida» y el documento BLOQUEADO; no hay reintento automático; «Consultar a Digifact» adopta el resultado real. |
| Rechazo confirmado | Queda «rechazada»; el documento sigue guardado y puede corregirse. |
| Rechazo antes de salir (credenciales, permisos) | «No enviada»; nada salió. |
| Borrador cuya fecha de emisión ya venció | Se revalida justo antes de enviar; no se certifica ni se cambia la fecha sola. |

## 4. Cómo se prueba la certificación real en TEST
1. Publicar: `publicar-nube` con `modo=publicar`, `confirmar=PUBLICAR`, `digifact=habilitado`, `digifact_referencia=CICLO-TEST` (y, para correr la prueba de inmediato, `digifact_prueba=habilitado`). Aprobar en `demo-privada`. Exige los secretos `DEMO_DIGIFACT_TEST_*` (usuario, contraseña, NIT, empresa, emisor, huella).
2. La prueba (`prueba_digifact.ts`) verifica con la API real: Digifact TEST habilitado y producción bloqueada; almacén persistente; FACT de hoy y FACT con fecha anterior → certificada; serie, número y UUID entregados; documento guardado como certificado con esos mismos datos; no es `SIM-`; **XML**: total, IVA 12 %, UUID, serie, número, tipo y fecha de emisión elegida; PDF del certificador y PDF/ticket local rotulados PRUEBAS; certificar otra vez NO reenvía; aparece en Documentos como certificado. El resumen sale en el resumen de la ejecución de GitHub.
3. Para cerrar: publicar con `digifact=apagado` (retira la autorización del ciclo).

## 5. NCRE, NDEB y RECI: requisitos y por qué siguen sin certificarse
| Tipo | Requisitos particulares (según el catálogo y el NUC V2.0.3) | Lo que falta confirmar |
|---|---|---|
| **NCRE** (nota de crédito) | Referencia a un FACT certificado del mismo emisor y receptor (serie, número, autorización, fecha, copiados de la base, nunca a mano); motivo del ajuste de 3 a 50 caracteres; la nota no puede ser anterior al origen; complemento `NCRE` con la estructura de «NUC 4 - NCRE.json». | Regla SAT V9: plazo máximo frente al origen (dos meses), IVA y tope del importe frente al origen; si serie y número del origen van en régimen FEL. |
| **NDEB** (nota de débito) | Igual que NCRE (aumenta lo facturado). | Además no se ha leído el ejemplo oficial «NUC 3 - NDEB.json»; se usa la estructura común. |
| **RECI** (recibo) | No es factura. Tipo de recibo obligatorio (Universidad, Colegio o Inmobiliaria; adenda `Tipo`, campo FA13); habilitación expresa por empresa con su base legal; no se emite a consumidor final. | Qué emisores pueden emitir RECI (V3), si lleva IVA (V6) y las frases que exige (V4); ejemplos «NUC 7 - RECI». |

**Bloqueo técnico, además del fiscal:** la migración 30 hace que la **base de datos** rechace crear una operación de Digifact para un tipo con `certificacion_habilitada = false` (solo FACT la tiene en `true`), y su restricción exige `disponibilidad = 'implementado'`. Habilitar NCRE/NDEB/RECI en TEST requiere por tanto **una migración 31** (datos de `fel_tipos_dte` + el catálogo del código) que **no se ejecuta sin tu autorización específica**; tampoco se ha aplicado. Propuesta, para decidirla con calma:
- Opción A (recomendada): habilitar primero **NCRE** (el único con ejemplo oficial leído), en TEST, usando como origen una FACT ya certificada en TEST; NDEB y RECI después de leer sus ejemplos oficiales.
- Opción B: habilitar los tres solo en TEST y dejar que el certificador de pruebas nos diga qué rechaza (un rechazo en TEST no tiene efecto fiscal, pero consume pruebas).
- En ambos casos los documentos siguen rotulados PRUEBA y no hay producción.

## 6. Riesgos y límites
- La regla de 5 días para la fecha de emisión sigue **sin confirmación oficial** (ver `fecha-emision.md`); la prueba con fecha anterior también revela si Digifact TEST la acepta.
- El IVA en pantalla y PDF local es una **estimación para régimen general (afiliación GEN)**; el definitivo lo entrega el certificador. Otros regímenes siguen sin política de impuestos (el servidor lo rechaza).
- La autorización `CICLO-TEST` es más amplia que la de una sola referencia: acepta cualquier documento de la empresa de demostración mientras esté publicada. Se retira publicando con Digifact apagado; el token de Supabase y el de Cloudflare vencen/rotan según tu política.
- Mi entorno no llega al dominio publicado ni tiene cuentas de demostración: la certificación real y la prueba en el teléfono se hacen desde Actions y desde tu dispositivo.
