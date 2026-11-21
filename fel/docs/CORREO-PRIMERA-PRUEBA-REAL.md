# Primera prueba REAL de correo (TEST) · guía y autorizaciones

Estado: el código del correo está **construido y probado con proveedor simulado**. **Nada de lo de abajo está hecho ni autorizado.** Los envíos reales siguen apagados hasta que lo autorices expresamente.

## 1. Lo que haces TÚ en Resend (no se puede automatizar desde aquí)
1. **Cuenta de Resend** (plan gratuito basta para pruebas) y entrar a *Domains → Add Domain*.
2. **Dominio remitente**: recomendado un **subdominio** dedicado (por ejemplo `facturas.tu-dominio.com`) para no mezclar la reputación del correo normal. El remitente final será `NEXA FEL <facturas@facturas.tu-dominio.com>` (o el que elijas).
3. **Registros DNS**: Resend te muestra los **valores exactos**; no se inventan aquí. Son de tres tipos y se crean en el proveedor donde administras el DNS del dominio:
   - **SPF** (TXT) y el **MX de retorno** del subdominio de envío, que Resend indica.
   - **DKIM** (TXT o CNAME, según indique Resend).
   - **DMARC** (TXT en `_dmarc.<dominio>`): recomendado; empieza con política de solo observación (`p=none`) y un correo tuyo para los reportes.
   Después pulsa *Verify* en Resend; la propagación puede tardar de minutos a horas. El dominio debe quedar **«Verified»** antes de enviar.
4. **Clave de API**: *API Keys → Create*, permiso **«Sending access»** (solo enviar) **limitado a ese dominio**. Cópiala una sola vez y **no la pegues en el chat, en commits ni en correos**: se entrega por el mecanismo de secretos (sección 3). Empieza por `re_`.
5. Nota de Resend (confírmala en su panel): el remitente de prueba `onboarding@resend.dev` solo puede enviar a **la dirección de tu propia cuenta**; sirve para una primera prueba aunque el dominio aún no esté verificado, pero no representa la identidad NEXA.

## 2. Variables de entorno (solo del servidor; nunca del navegador)
| Variable | Valor / ejemplo | Dónde vive |
|---|---|---|
| `FEL_CORREO` | `simulado` (ensayo, no envía) o `habilitado` (Resend real). **Apagado = no definida.** | entorno de la función |
| `FEL_CORREO_REMITENTE` | `NEXA FEL <facturas@facturas.tu-dominio.com>` | entorno de la función |
| `RESEND_API_KEY` | **secreto**, `re_…` | **secreto** de la función; solo lo lee `src/correo/entorno.ts` |
| `FEL_CORREO_DESTINATARIOS` | `tu.correo@gmail.com, otro@outlook.com, @tu-dominio.com` | entorno de la función |
| `FEL_CORREO_TOPE_DIARIO` | `50` (por defecto) | entorno de la función |
| `FEL_CORREO_AUTOMATICO` | **no definir** en la primera prueba | — |

Garantías verificadas: la clave se lee en **un solo lugar**, vive en un campo privado, solo viaja en la cabecera `Authorization` hacia `api.resend.com`, **no** aparece en `web/`, en el intermediario de Cloudflare, en registros, en respuestas de la API ni en la auditoría (pruebas lo comprueban). Si falta cualquier variable, el correo queda deshabilitado y explica cuál falta **sin mostrar valores**.

## 3. Lista de destinatarios de prueba
Es una **lista cerrada** (`FEL_CORREO_DESTINATARIOS`): direcciones exactas y/o `@dominio`. Sin lista, **no sale nada**; un elemento inválido invalida toda la lista; cualquier otro destinatario recibe «destinatario no autorizado» y no se llama a Resend. Para la primera prueba: **2 o 3 buzones tuyos** (uno Gmail y uno Outlook/Hotmail para comprobar ambos clientes), sin direcciones de clientes reales.

## 4. Migración del historial (pendiente de AUTORIZACIÓN)
- Archivo: `docs/migracion-correo/20261121000100_fel_correo_envios.sql` (**no** está en `supabase/migrations`; las 28 aprobadas no cambian).
- Revisada y probada en bases temporales: aplica limpia sobre las 28; `verificacion-posterior-28.sql` y `verificacion-correo.sql` pasan; la reversión (`reversion-correo.sql`) y la reaplicación funcionan; RLS verificada por rol (la empresa propia ve su historial, otra empresa ve 0, `authenticated` no escribe, `anon` no lee).
- Sin la migración el módulo queda **no disponible, sin errores**.
- Para aplicarla en el Supabase real hace falta **tu autorización** y **definir el procedimiento** (hoy `supabase-hospedado.sh` solo conoce hasta la 28 y `verificar-publicacion.py` vigila que no cambie). Propuesta: una etapa nueva «correo» con verificación previa en solo lectura, aplicación con confirmación y verificación posterior.

## 5. Despliegue del correo (pendiente de AUTORIZACIÓN)
El flujo de publicación fija una lista de secretos, así que activar el correo real exige un cambio **acotado** y autorizado: entrada `correo` (apagado por defecto; `simulado` o `habilitado`), secreto `DEMO_RESEND_API_KEY` en el entorno protegido `demo-privada`, y las variables de la sección 2; sin tocar Digifact ni NIT/CUI.

## 6. Primera prueba controlada (cuando autorices)
Requisitos previos: (a) dominio verificado, (b) clave creada, (c) destinatarios definidos, (d) migración aplicada, (e) función desplegada con `FEL_CORREO=habilitado`.
1. Con una **factura certificada en TEST** (con su PDF y XML guardados) abrir su detalle → tarjeta «Enviar por correo».
2. Escribir **uno** de los destinatarios autorizados → «Enviar por correo».
3. Comprobar en el buzón: asunto `[PRUEBA] Factura …`, rótulo **DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL**, nombre del emisor, receptor, serie/número, fecha, total en quetzales, **PDF y XML adjuntos idénticos** a los certificados (descargarlos de NEXA y comparar), y que se vea bien en el teléfono.
4. En NEXA: historial con destinatario, fecha y estado **«Aceptado por el proveedor»** (no prueba entrega; la entrega se ve en el buzón y en el panel de Resend).
5. Pruebas de control: pulsar de nuevo (mismo destinatario) → «ya se envió», **no** llega otro; **Reenviar** → exige escribir `REENVIAR` y llega un segundo correo; un destinatario fuera de la lista → rechazado sin llamar a Resend.
6. Criterios de **parada**: cualquier correo a un destinatario no autorizado, adjuntos distintos, rótulo ausente o duplicado inesperado → apagar `FEL_CORREO` (quitar la variable) y avisar.

## 7. Reversión / apagado
- **Apagar** el correo: quitar `FEL_CORREO` (la API responde «no habilitado»; nada sale).
- **Revocar** la clave en el panel de Resend (inmediato).
- **Revertir** el historial: `docs/migracion-correo/reversion-correo.sql` (borra el historial de envíos).

## 8. Lo que NO incluye este paso
Envío automático (apagado), estado «entregado» (requiere *webhook* de Resend), campo de correo en *Nueva factura* (etapa 3 del rediseño), correo en producción fiscal.
