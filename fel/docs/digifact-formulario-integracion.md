# NEXA FEL · Formulario conectado a Digifact TEST (diseño y garantías)

Estado: **código listo y probado con simulaciones; apagado por defecto; sin certificaciones reales ni cambios en la nube.**

## Qué hace
| Paso | Ruta de la API de NEXA (solo servidor) | Permiso | Efecto |
|---|---|---|---|
| Consultar NIT | `POST /api/digifact/nit` | `clientes.ver` | Solo lectura en Digifact; rellena el nombre en «Nuevo cliente». Límite de 20 por minuto y empresa. |
| Validar | `POST /api/documentos/:id/digifact/validar` | `borradores.ver` | Sin red y sin guardar nada: arma la factura NUC y devuelve TODOS los errores. |
| Preparar | `POST /api/documentos/:id/digifact/preparar` | `fiscal.certificar` | Guarda la operación con su referencia interna única; **no envía nada**. |
| Certificar (TEST) | `POST /api/documentos/:id/digifact/certificar` | `fiscal.certificar` | **Un solo envío**, solo con las garantías de abajo. |
| Conciliar | `POST /api/documentos/:id/digifact/conciliar` | `fiscal.ver` | Consulta por la referencia interna; nunca reenvía. |

El navegador solo conoce estas rutas (`web/js/api.js`); una prueba verifica que ningún archivo de la interfaz menciona el servidor, las credenciales ni el token de Digifact.

## Garantías (cada una con prueba)
- **Multiempresa:** la empresa, la persona y los permisos salen de la sesión y de la base; todo se filtra por `empresa_id`; las credenciales se resuelven **por empresa** (sin canal → no sale nada).
- **Confirmación manual:** preparar → escribir `CERTIFICAR-TEST` + repetir la referencia y la huella del emisor. Si el documento cambia después de preparar, se rechaza.
- **Autorización por prueba:** solo se envía la referencia que la persona responsable autorizó (`FEL_DIGIFACT_AUTORIZA_REFERENCIA`). Sin ella, nada sale.
- **Un documento, un envío:** el estado «enviando» se guarda antes de llamar (write-ahead); la referencia es determinista; doble clic o procesos concurrentes producen un solo envío.
- **Resultado incierto → «desconocida»:** nunca se reenvía; se concilia por la referencia (reporte de acuses). Un proceso caído a mitad de envío también pasa a «desconocida».
- **Falla cerrado:** sin almacén persistente no se envía nada real; sin variables o huella correcta, el servicio no se habilita.
- **Cerrado:** producción, anulación y nota de crédito. Sin credenciales, tokens ni XML/PDF en respuestas ni en la auditoría.

## Configuración (variables del servidor; nada de esto va en el repositorio)
`FEL_DIGIFACT_TEST=habilitado`, `FEL_DIGIFACT_TEST_EMPRESA`, `DIGIFACT_TEST_USERNAME/PASSWORD/NIT`, `FEL_DIGIFACT_TEST_EMISOR` (JSON del paso `datos-emisor`), `FEL_DIGIFACT_TEST_HUELLA` (la que se aprobó), `FEL_DIGIFACT_AUTORIZA_REFERENCIA` (una referencia, solo durante la prueba autorizada).

## Pendiente (requiere autorización expresa)
1. **Almacén persistente de operaciones reales** (migración nueva: ambiente `pruebas` hoy está vedado por las barreras `simulado` de la base). Hasta entonces el servicio prepara y valida, pero **se niega a enviar**.
2. Almacenamiento privado de XML/PDF.
3. Credenciales y cuotas por empresa (hoy: una sola empresa vinculada a las credenciales de TEST).
4. Política de impuestos: IVA 12 % incluido, solo afiliación GEN, **pendiente de validación fiscal** (`ivaIncluidoGeneral`).
5. Confirmar con Digifact: fecha de emisión admitida (hoy: la del momento de preparar), deduplicación por referencia, límites de uso.
