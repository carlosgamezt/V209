**Para:** Emmanuel Guerra; Jeimmy Jimenez (Digifact)
**Asunto:** Re: Consulta técnica – Personalización de correos · plantilla NEXA FEL para integración multiempresa

Buenos días, Emmanuel y Jeimmy:

Gracias por su respuesta. Con ella decidimos que **Digifact seguirá siendo el responsable de certificar y de enviar el correo de la factura**, y que NEXA FEL solo indicará el destinatario en el nodo del receptor al certificar. Queremos que el correo que recibe el cliente tenga la identidad visual de NEXA FEL y el nombre comercial de cada empresa emisora, sin alterar ningún dato fiscal del XML. Les adjuntamos una maqueta de referencia.

Como NEXA FEL atenderá a **varias empresas emisoras** con una sola integración, necesitamos confirmar lo siguiente:

1. **Marca.** ¿Podemos personalizar la plantilla con logotipo, colores y nombre de NEXA FEL? ¿Se hace desde el portal o la configura su equipo?
2. **Alcance de la configuración.** ¿La plantilla se define por NIT emisor, por cuenta de integrador o de forma global? ¿Podemos tener una plantilla común de NEXA FEL y que cada correo muestre el nombre comercial de su emisor tomado del XML?
3. **Datos del XML en el cuerpo.** ¿Cuáles pueden mostrarse (nombre comercial `Seller.BranchInfo.Name`, razón social, NIT, serie, número, fecha, total, receptor, autorización, valores de la adenda) y cuáles se pueden activar o desactivar?
4. **`AdditionalDocumentInfo.DocTemplate`.** ¿Qué función cumple? ¿Permite seleccionar una plantilla distinta por solicitud (por ejemplo, por emisor) o la plantilla solo se elige en el portal?
5. **Desarrollo y costo.** ¿La personalización que describimos requiere desarrollo de Digifact? De ser así, ¿cuál es el alcance, el costo adicional y el plazo?
6. **Ambiente TEST.** Si enviamos un correo en `Buyer.Contact.EmailList.Email`, ¿los certificados de TEST llegan a esa dirección real? Necesitamos saberlo para limitar nuestras pruebas a buzones propios.
7. **`Seller.Contact.EmailList`.** ¿Qué efecto tiene sobre los destinatarios? ¿Se envía copia al emisor, se usa como remitente o `reply-to`, o es solo informativo?

De nuestro lado: incluiremos `Buyer.Contact.EmailList.Email` únicamente cuando el usuario lo solicite para ese documento, enviaremos un solo NUC por referencia interna y no reenviaremos ni alteraremos datos fiscales.

Les agradeceremos una confirmación por escrito, y si es posible una breve llamada para revisar la maqueta.

Quedamos atentos. Saludos cordiales,

Carlos
NEXA FEL
