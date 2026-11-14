# Digifact · preparación para la primera jornada de integración (ambiente TEST)

> **Actualización 14/11/2026:** ya se leyó la documentación oficial y existe el cliente real (`proveedores/src/digifact_gt.ts`) y el constructor del NUC (`proveedores/src/nuc_gt.ts`), probados con transporte simulado. Lo confirmado, lo pendiente y las preguntas para soporte están en **`docs/digifact/integracion-pendiente.md`**. Lo que sigue de este documento es el plan original; donde diga «contrato hipotético» o «rutas de ejemplo», prevalece el documento nuevo.

Estado: **bloqueado por información externa.** No tenemos documentación oficial, credenciales ni acceso de pruebas. **No se inventó ningún endpoint ni contrato.** Todo lo que hoy llama a «Digifact» habla con un simulador local (`DigifactSimulador`) cuyo contrato HTTP es una *hipótesis de trabajo* marcada como tal en `proveedores/src/digifact.ts`.

## 1. Qué ya está listo (y no cambia al llegar la documentación)
| Pieza | Dónde | Qué garantiza |
|---|---|---|
| Contrato interno `EmissionProvider` (+ `ProveedorAnulacion`) | `proveedores/src/tipos.ts`, `digifact.ts` | El resto del sistema solo conoce este contrato; no se modifica |
| Orquestador con las reglas anti-duplicado | `orquestador_db.ts` + funciones SQL | Un solo envío por operación; resultados dudosos → «por verificar», conciliación y bolsón; **nunca** reenvío inseguro |
| Adaptador `DigifactProvider` con transporte **inyectado** | `digifact.ts` | Rutas, cuerpos y lectura de respuestas están en un solo archivo |
| **`crearTransporteHttp`** (nuevo, genérico, probado) | `transporte_http.ts` | HTTPS obligatorio, sin redirecciones, tiempo máximo (`TiempoAgotado`), tope de tamaño, un solo intento, errores sin direcciones ni cabeceras |
| Registro de certificadores y servicio | `registro.ts`, `servicio_digifact.ts` | Un certificador nuevo = implementar el contrato y registrarlo; pantallas y API se dibujan solas |
| Barreras de base de datos | migraciones 0300 y 0700 | Digifact solo en ambiente `simulado` hasta una migración deliberada |
| Nombres de secretos previstos (sin valores) | `docs/produccion-preparacion.md` | `DIGIFACT_USUARIO`, `DIGIFACT_CLAVE`, `DIGIFACT_URL_BASE`: solo servidor, nunca navegador ni repositorio |

## 2. Qué necesitamos recibir de Digifact (lista de pedido)
1. Documentación oficial de la API de **TEST**: dirección base, autenticación (tipo, vigencia, renovación), operaciones de certificación, consulta por referencia/identificador, anulación, descarga de XML/PDF, consulta de consumo/saldo.
2. Credenciales de TEST (usuario/clave/NIT de prueba) entregadas por un canal seguro; **nunca** en el repositorio, el chat ni registros.
3. Comportamiento ante: reintento con la misma referencia (¿idempotencia nativa?), tiempo de espera, errores y códigos, límites de tasa, respuesta tardía, ventana de anulación.
4. Formato exacto del DTE (esquema/versión), series, tipos admitidos, y datos fiscales que exigen.
5. Si existe un entorno de pruebas sin costo y si las certificaciones de TEST consumen saldo.

## 3. Pasos de la primera jornada (en este orden)
1. **Autorización explícita** del titular para abrir TEST (no se hace sin ella).
2. **Migración nueva** (no existe aún; requiere autorización): ampliar `proveedores_emision.ambientes` de `digifact` a `{simulado,pruebas}` reemplazando `proveedores_digifact_solo_simulado_chk`; permitir cuenta de bolsón en `pruebas`; actualizar las funciones `fel_sys_*` que hoy exigen `ambiente = 'simulado'`; mantener `produccion` cerrado. Probar con las suites SQL.
3. **Secretos** como variables del servidor (Edge Function / servidor Deno); `crearTransporteHttp({ baseUrl: DIGIFACT_URL_BASE, tiempoMaximoMs })`.
4. **Autenticación**: adaptar `autenticar()` (hoy hipotética) al esquema real; mantener el caché de token con margen y sin escribirlo en registros.
5. **Certificación**: adaptar `cuerpoCertificacion()` y la lectura de la respuesta en `enviar()`; solo respuestas **garantizadas** son éxito o rechazo; todo lo demás → `desconocido`. `ambientes` de `capacidades` pasa a incluir `pruebas`.
6. **Consulta/conciliación**: adaptar `conciliar()`; es lo que evita reenvíos tras un tiempo agotado.
7. **Artefactos** (XML/PDF) y **anulación/consumos** con sus rutas reales.
8. **Pruebas de contrato**: ajustar `DigifactSimulador` a lo documentado (así las pruebas del sistema siguen cubriendo todos los escenarios) y repetir la suite completa.
9. **Primera factura TEST**: un documento simulado → certificar en TEST con cliente de prueba; verificar autorización/serie/número, XML/PDF, consumo y conciliación. Registrar el resultado; sin tocar producción.
10. **Prueba de caída**: forzar un tiempo agotado real (corte local) y comprobar que queda «por verificar» y que la conciliación decide, sin reenviar.

## 4. Reglas que no se negocian
Sin producción; sin credenciales en el repositorio, registros ni navegador; un solo intento por envío; respuestas dudosas nunca son éxito; `EmissionProvider` no cambia; el agente SAT sigue pausado; `main` intacto.

## 5. Riesgos conocidos hasta recibir la documentación
La hipótesis de contrato puede diferir mucho (formato del DTE, autenticación, referencias). Lo que **no** cambia es la protección contra duplicados y la separación por certificador. Estimación honesta: obtener una factura certificada en TEST en la primera jornada es **plausible solo si** la documentación y las credenciales llegan completas y la API de TEST permite certificar con datos de prueba.
