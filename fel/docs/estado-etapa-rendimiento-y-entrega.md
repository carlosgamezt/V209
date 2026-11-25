# Estado de la etapa «rendimiento, historial, entrega y correo» (25/11/2026)

Todo es de PRUEBA (Digifact TEST o simulado), sin valor fiscal. Producción deshabilitada; NEXA principal sin tocar; **la migración 31 NO está aplicada** (solo propuesta en `docs/migracion-31/`).

## Lo implementado y cómo se verifica
| Tema | Qué hay | Verificación automática |
|---|---|---|
| Historial | Paginación y filtros **en el servidor** (25 por página): Emitidos (predeterminado) · Borradores · Anulados · Pendientes; filtros por texto (cliente, serie, número, UUID, BR-), NIT, tipo, estado y fechas; conteos por categoría | `tests/lista_paginada_api_test.ts`, `e2e.cjs`, `e2e_vistas.cjs` |
| Acciones de facturación | «Certificar en TEST» a todo el ancho; debajo «Guardar borrador» y «Vista previa»; sin menú «Más»; acciones del documento (validar, revisar, volver a borrador, archivar) como texto; indicador «Datos completos · Listo para certificar» | `e2e_movil`, `e2e_acceso`, `e2e_rediseno`, `e2e_digifact_ciclo` |
| Pantalla posterior a la certificación | Tarjeta con total, serie, número fiscal, UUID (copiar), ambiente (TEST/SIMULADO) y acciones: Enviar por correo, Descargar PDF, Imprimir, Ticket 80 mm, Compartir, Nueva factura, Volver | `tests/e2e_emitido.cjs` (6 anchos, descargas reales de PDF, compartir con y sin API nativa, permisos) |
| Caché segura | Solo memoria, por sesión, lista blanca de 4 lecturas con TTL corto, vaciada al entrar/salir/cambiar de persona/escribir; lecturas simultáneas compartidas; documentos nunca | `tests/cache_cliente_test.ts` |
| Carga | Pantallas con carga diferida; pendientes con límite de frecuencia | `tests/medir_navegacion.cjs` (medición) |
| Correo en Nueva factura | Casilla «Enviar factura por correo» (la envía **Digifact** al certificar), apagada por defecto, precarga del correo del cliente, editable, validada, atada a la preparación (`correo_ref`), conservada al guardar y certificar un documento nuevo. Solo si el servidor lo habilita para la empresa | `e2e_digifact_ciclo.cjs` (sección 8), `e2e_digifact_correo.cjs`, `e2e_correo.cjs` |
| PDF y tickets | Matriz 4 tipos × estados × carta/ticket: PDF válido, tamaño (carta 612×792; ticket ≈226 pt), rótulos (PRUEBA/SIMULADO/ANULADO), serie/número/UUID, referencia de notas, escapado de texto hostil | `tests/pdf_matriz_api_test.ts` |
| Seguridad | Aislamiento entre empresas en 17 rutas por documento, roles (lector/emisor), sesión obligatoria, canal Digifact solo para su empresa, confirmaciones inválidas no envían nada, ninguna respuesta ni auditoría contiene secretos | `tests/seguridad_api_test.ts` |
| Vistas | Documentos, Nueva factura, Clientes, Conceptos, Configuración y Panel a 320/360/390/412/768/1440 px: sin desbordes, objetivos táctiles ≥ 40 px, barra fija sin tapar la navegación | `tests/e2e_vistas.cjs` |

## Mediciones (ver `rendimiento-historial.md`)
Historial con 10,000 documentos: lista completa 283 ms / 5.8 MB → página de 25: 71 ms / 15.6 KB. Carga inicial: 39 → 15 solicitudes; navegación interna: 7 → 1 solicitud (225 ms con red lenta emulada). **No medido todavía:** red móvil real, arranque en frío de la función en Supabase/Cloudflare, tiempos de Digifact (se separarán de los de NEXA en la medición con Actions).

## Hallazgos de las revisiones visuales y pruebas
- La inspección de capturas encontró un doble marco en el buscador del historial (las comprobaciones de desbordamiento no lo detectaban): corregido y ahora hay una aserción específica.
- En Firefox el tipo de identificación medía menos de 40 px (no aplicaba la regla táctil): se fijó el mínimo explícito.
- `GET /api/documentos/:id/digifact` y `/digifact/correo` de otra empresa responden 200 con una lista vacía / «no solicitado» (no filtran datos, pero sería más claro un 404): **riesgo bajo, no cambiado**.
- Los campos con caracteres de control se rechazan en el servidor (400), lo que protege los PDF.

## Pendiente / decisiones
1. **Migración 31** (alcance en `migracion-31/ALCANCE.md`): sin autorizar; hasta entonces NCRE/NDEB/RECI solo se guardan y se ven, no se certifican (el bloqueo se verifica en `tipos_documento_api_test.ts`).
2. **Anulación en TEST**: revisada (`anulacion-digifact-test.md`); no habilitada.
3. **Envío automático por empresa** (configurable en pantalla): hoy es una variable del servidor (`FEL_CORREO_AUTOMATICO`); el ajuste por empresa requeriría una columna (migración) → no hecho. **Reenvío desde el historial:** se hace abriendo el documento (tarjeta «Documento emitido» → «Enviar por correo» → panel con historial y reenvío); no hay un botón de reenvío en cada fila de la lista.
4. **Identidad corporativa del correo de Digifact (logotipo AGRIPACK):** sin respuesta de Digifact; mientras tanto no se habilitan envíos reales multiempresa.
5. **Validación en dispositivo real** (Android, impresión, compartir nativo) y con red móvil real: a cargo del responsable con la demostración publicada.
6. El ciclo `CICLO-TEST` sigue vigente en la demo publicada; se retira publicando con `digifact=apagado` cuando se cierre el ciclo de pruebas.
