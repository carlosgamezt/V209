# Transporte remoto seguro del agente — fase 8a

Estado: **implementado en 8a**. Todo sigue limitado al simulador local: sin SAT, sin certificadores, sin contraseñas SAT, sin instalador definitivo. La autorización humana del commit 6 no cambia.

## 1. Qué se añade respecto al commit 7
| Capa | Antes | 8a |
|---|---|---|
| Destino de NEXA | solo `http://127.0.0.1` | `http` solo en loopback (desarrollo) · **`https` en loopback o en un host de la lista exacta autorizada** (la fijará el instalador, 8c); nunca IP, ni SAT/certificadores, ni credenciales, ruta o puertos raros en la URL |
| TLS | – | **validación estricta**: certificado y nombre siempre verificados, TLS ≥ 1.2, sin redirecciones, tiempo máximo y tope de tamaño. Una prueba estática impide `rejectUnauthorized:false` y variables que desactiven TLS |
| Autenticidad de las respuestas | se confiaba en la red | **toda respuesta, también los errores, va firmada por NEXA (Ed25519) y ligada a la petición** |
| Consulta de órdenes | `latido` + `reclamar` (2 peticiones/ciclo) | **una sola petición por ciclo** (`reclamar` hace de latido) |
| Ritmo de consulta | fijo | **adaptativo** (lo indica NEXA) + **espera exponencial con variación aleatoria** si hay fallos |
| Versiones | – | **`version_minima`** (bloqueo seguro) y `version_recomendada` |
| Métricas | – | contadores por agente y hora (peticiones, estados, errores, reconexiones) por empresa, para estimar costos reales |

## 2. Respuestas firmadas y ligadas a la petición
Cada respuesta del plano de control lleva `x-nexa-kid`, `x-nexa-ts` y `x-nexa-firma`:
`firma = Ed25519( "nexa-respuesta-v1\n<kid>\n<nonce de la petición>\n<estado HTTP>\n<ts>\n<sha256 del cuerpo>" )`.
El agente la comprueba **antes de leer nada**:
- **Ligada a la petición**: el nonce es el que el propio agente envió; una respuesta válida de otra petición no coincide (**repetición** rechazada).
- **Alterada**: cualquier cambio de cuerpo, estado o cabeceras invalida la firma.
- **Vencida**: la marca de tiempo debe estar a ±120 s del reloj del equipo (una respuesta vieja, o con el reloj mal puesto, no se acepta).
- **De otra clave**: solo claves de confianza y vigentes.
- Un fallo de verificación **nunca se interpreta como una instrucción**: ni una orden ni un «revocado» sin firma tienen efecto; el agente lo trata como fallo transitorio (reintento con espera) y lo cuenta (`no_autenticas`). Por eso un intermediario no puede ni inventar órdenes ni detener a los equipos.
- El `403 FEL_REVOCADO` auténtico también va firmado: solo así el agente lo obedece. Un equipo desconocido y una firma inválida siguen recibiendo exactamente la misma respuesta 401 (sin oráculo), ahora firmada.

## 3. Claves de verificación: distribución y rotación
- **Incrustadas**: el agente trae claves públicas de NEXA (las fijará el instalador firmado, 8c; hoy `CLAVES_NEXA_INCRUSTADAS` está vacío y las pruebas las entregan por configuración). Debe haber **al menos una activa y una de reserva** (guardada fuera de línea).
- **Anuncio de claves nuevas** (`nexa-clave-v1`): NEXA anuncia una clave nueva **firmada por una clave que el agente ya confía y que sigue vigente**; el agente declara en cada consulta los `kid` que conoce y NEXA solo anuncia lo nuevo. Una clave ya conocida no se puede sustituir.
- **Rotación sin ventana de transición**: NEXA puede firmar ya con la clave nueva: si el agente no la conoce, lee el anuncio (verificable por sí mismo) y vuelve a comprobar la respuesta una vez.
- **Revocación** (`nexa-revoca-v1`): solo con una clave **incrustada** (una clave anunciada y comprometida no puede revocar a las demás) y nunca una clave a sí misma. Lo revocado deja de valer al instante.
- **Persistencia**: lo aprendido se guarda en la carpeta del agente y **se vuelve a verificar contra las claves incrustadas al arrancar**: un archivo manipulado no añade confianza.
- Alcance honesto: si se comprometiera una clave **incrustada** (no solo anunciada) habría que publicar un instalador nuevo; por eso la reserva va fuera de línea.

## 4. Sondeo adaptativo y espera exponencial
- NEXA devuelve `politica.siguiente_ms`: **3 s** si la empresa tiene órdenes abiertas o recientes, **30 s** en reposo (parámetros de plataforma `agente_sondeo_activo_ms`, `agente_sondeo_reposo_ms`, `agente_actividad_reciente_seg`; con una orden recién entregada, 2 s). El agente lo acata **acotado a [1 s, 120 s]**: un servidor comprometido no puede ni acelerar el sondeo por debajo de 1 s ni frenarlo más de 2 min. Siempre con **±20 % de variación aleatoria** para desincronizar equipos.
- Tras fallos: `1 s · 2^(n−1)` hasta **60 s**, con variación «mitad fija + mitad aleatoria» y respetando una pausa mínima del servidor; al reconectar vuelve al ritmo normal.

## 5. `version_minima`: política segura
- Parámetros `agente_version_minima` / `agente_version_recomendada` (0 = sin mínimo), editables sin desplegar.
- El servidor **bloquea `reclamar`** (426 `FEL_VERSION`, firmado) y la vinculación (**antes de gastar el código**) de versiones inferiores. Una versión ilegible o ausente cuenta como `0.0.0` (**queda bloqueada** si hay mínimo).
- **No se rompe lo que ya está en marcha**: las órdenes ya reclamadas pueden terminar (`progreso`, `vista_previa`, `resultado` siguen funcionando) para no dejar operaciones fiscales a medias.
- El agente, al enterarse, **solo hace latido** (sin reclamar), avisa («actualiza el agente») y se desbloquea solo cuando se baja el mínimo.

## 6. Métricas para estimar costos
- El plano cuenta en memoria `peticion:<op>`, `estado:<op>:<código>` y `error:<código>` por agente y hora, y las **vuelca por lotes** a `agente_metricas` (una escritura por lote, no por petición; un fallo al volcar no pierde datos).
- El propio agente informa (en el cuerpo firmado, acotado) `reconexiones`, `errores_red`, `no_autenticas` y `peticiones` como **deltas** (`cliente_*`), solo tras una consulta correcta.
- Solo contadores: nunca claves, contenido ni datos de facturas. `GET /api/agentes/metricas?horas=24` (permiso `canales.ver`, solo la empresa propia) devuelve totales, serie por hora, número de agentes y una **proyección a 30 días** de invocaciones.
- Estimación de costo: `proyeccion_30_dias × (tarifa por millón / 1 000 000)` por agente; sumar agentes.

## 7. Qué NO cambia
Aislamiento multiempresa, revocación, arrendamientos, fencing, idempotencia, conciliación, autorización humana de la confirmación y la restricción del navegador al simulador local. El agente **sigue sin poder** conectar con SAT ni certificadores (lista de bloqueo + lista exacta de hosts).

## 8. Límites declarados
- Sin `CLAVES_NEXA_INCRUSTADAS` reales ni host de producción, el agente **no se conecta a ningún NEXA remoto** todavía (8c los incrusta en el instalador firmado).
- Proxy corporativo y almacén de certificados del sistema (inspección TLS con CA propia) **no** se tratan en 8a: la firma de respuestas evita que una inspección comprometa la integridad, pero el agente no usará el proxy del sistema hasta una fase posterior.
- La instancia única (detección de clones), `desvincular` y la rotación de la clave del agente quedan para 8b/8d según el plan.
