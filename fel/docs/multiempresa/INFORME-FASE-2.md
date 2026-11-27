# Informe consolidado · fase 2 (agentes, parámetros, R3 y rendimiento) — validación local

Rama `fel-proveedores-diseno`, desde 24978b0. Todo se probó **solo en local** (PostgreSQL temporal, PGlite y un emulador de PostgREST con verificación de firma de JWT). No se tocó `nexa-demo`, otros worktrees ni producción; no se activó Resend ni se envió correo; no se certificó nada real; no hay clientes reales; el borrador a Digifact sigue sin versionar; sin credenciales ni costos. **R1, R2 y R3 NO se declaran cerrados** (ver §5).

## 1. Cambios
### 1.1 Agente local (M-Q, M-P y ruta en `nexa-sys`)
**Revisión de la autenticación efectiva** (código y pruebas, no solo la teoría):
| Aspecto | Hecho verificado | Resultado |
|---|---|---|
| Firma | Ed25519 sobre `método\nruta\nhora\nnonce\nsha256(cuerpo)`; se verifica **antes** de consumir nada, con la clave pública del agente | cuerpo alterado, otra ruta, clave ajena y otro agente → `FEL_FIRMA` |
| Existencia | agente desconocido y firma inválida reciben la **misma** respuesta (sin oráculo) | probado (cuerpo idéntico) |
| Repetición | nonce de un solo uso por agente + ventana de hora (±60 s) | repetir la misma petición → `FEL_REPETICION`; hora fuera de ventana → `FEL_RELOJ` |
| Alcance | la empresa sale del agente autenticado, jamás del cuerpo; órdenes ajenas → `FEL_EMPRESA`; token de la orden (fencing); solo resultados `SIM-` | probado, incluida la inyección de `empresa_id` en el cuerpo |
| Revocación | inmediata, tras comprobar la firma | `FEL_REVOCADO` |
| **Lo que la base NO verifica** | la firma se verifica en TypeScript; la base solo recibe el `uuid` | **mitigado, no resuelto**: M-P (solo `nexa_sys` ejecuta el protocolo) + el protocolo corre en `nexa-sys`. Trasladarlo no autentica por sí solo; un `nexa-sys` comprometido sigue pudiendo actuar como cualquier agente (riesgo inherente, acotado a esa función) |

**M-Q (nuevo):** límite de vinculación **por origen** (10 fallos/10 min) con cortacircuitos global alto (1 000); antes, 20 fallos globales permitían a cualquiera en internet bloquear la vinculación de **todas** las empresas (el endpoint no lleva firma). El origen se guarda en **huella** (nunca la IP). Tope de **peticiones por agente** (120/min), que no afecta a otros agentes. Parámetros nuevos, reversión incluida.
**M-P (aprobada) y corte:** la suite aplica M-P sobre una copia y comprueba que `nexa_app` pasa de 130 a **121** funciones (−9), sin `fel_sys_*`, y que sesión, envoltorios y `nexa_sys` siguen en verde. El protocolo se sirve desde `nexa-sys` (`POST /api/agente/v1/<operación>`, **firmado, sin el secreto de sistema**), activable con `FEL_AGENTE_EN_SISTEMA=1`; la función de personas no lo monta. El `tick` conserva el secreto. Las rutas del agente están ancladas (ni `/x/api/agente/v1/latido` ni `/latido/x`).

### 1.2 Parámetros de plataforma (M-R)
Cuatro clases, **lista explícita en la base** y fallo cerrado (un parámetro sin clasificar nunca sale):
| Clase | Parámetros | Quién |
|---|---|---|
| usuario | `espera_conciliacion_manual_min`, `ventana_tardia_min`, `umbral_recuperacion_min`, `ventana_auditoria_min` | cualquier persona con sesión viva (es lo que muestra Configuración) |
| empresa | `establecimiento_por_usuario` (`empresa.editar`), `agente_codigo_min`, `agente_latido_max_seg` (`agentes.administrar`) | solo con ese permiso, en su empresa |
| plataforma | `agente_version_minima/recomendada`, `agente_sondeo_activo/reposo_ms`, `agente_lease_seg`, `agente_actividad_reciente_seg` | solo administrador de plataforma con **MFA real** |
| interno | `agente_reloj_max_seg`, `agente_max_peticiones_min`, `agente_vinculacion_max_origen/global`, `mfa_operaciones_sensibles`, `plataforma_mfa_obligatoria` | **nunca** sale de la base (ni siquiera al administrador) |
El servidor (`/api/estado`, `/api/configuracion`) entrega solo la clase «usuario» por **ambos** caminos (pooler y Data API); una prueba exige que la lista del servidor coincida con la clasificación de la base. La interfaz no cambia (solo usaba esas cuatro).
**Hallazgo corregido:** `fel_es_admin_plataforma()` (migración 1000, usada en políticas RLS de plataforma) aceptaba `aal2` mirando **solo el token**; ahora exige también la sesión guardada (`fel__aal2()`). Solo es más estricta.

### 1.3 R3 · lecturas (M-S) y puerto de datos
- Nuevas RPC de lectura `SECURITY INVOKER` + RLS: `documentos_listar`, `documento_detalle`, `panel_resumen`, `reporte_documentos`; archivos: metadatos por **grant de columnas** (`contenido` ilegible por lectura de tablas) y descarga por `artefacto_descargar` (`DEFINER` con permiso `artefactos.descargar`, empresa de la sesión y alcance de establecimiento).
- Rutas del servidor con alternativa por Data API: `/api/clientes`, `/api/conceptos`, `/api/estado`, `/api/configuracion` (establecimientos), `/api/documentos`, `/api/documentos/:id`, `/api/artefactos/:id`, `/api/panel`, `/api/reportes/documentos.csv`.
- **Sin JWT no hay pooler:** con la Data API activa, **toda** ruta autenticada sin JWT válido se rechaza (403, «sesión no válida») antes de tocar la base. Probado con un espía: **0 consultas/rpc** de la aplicación sin JWT, con firma ajena o vencido; y 0 llamadas a la Data API.
- Políticas reescritas (mismo resultado, otro costo): permisos y alcance por **conjuntos calculados una vez por consulta**. Equivalencia con la lógica original comprobada **fila por fila** para 6 personas con el alcance apagado y encendido.
- Reversiones: `reversion-M-S.sql`, `reversion-M-R.sql`, `reversion-M-Q.sql`, `reversion-M-P.sql` y `reversion.sql` general actualizados.

## 2. Mediciones (base local, sin red; detalle en `MEDICIONES-R3.md`)
Mismos datos para cada variante y volumen (V0 original → V3 propuesto), latencia media en ms:
| caso | N=300 | N=3 000 | N=15 000 |
|---|---|---|---|
| `documentos_listar` (25 filas) | 575.6 → **7.5** | 2 453.8 → **10.1** | 11 600.8 → **26.7** |
| `panel_resumen` | 592.4 → **8.1** | 5 830.8 → **12.4** | 29 153.7 → **161.6** |
| `estado_catalogos` | 77.8 → **4.6** | 787.2 → **17.9** | 4 376.2 → **115.8** |
| `clientes_listar` | 298.9 → **5.8** | 3 160.6 → **29.3** | 17 842.2 → **146.1** |
| `documento_detalle` | 5.8 → 6.4 | 5.7 → 6.3 | 5.7 → 6.2 |
Conclusión honesta: las políticas **originales no eran viables** por la Data API (por fila); con las propuestas la lectura es utilizable. Una optimización adicional (conteo de facturas por cliente como agregación única) bajó `clientes_listar` de 16.9 s a 146 ms con 15 000. `clientes_listar`/`estado_catalogos` siguen creciendo con N porque devuelven **todas** las filas (la consulta actual del servidor también); conviene paginar esa lista en la pantalla. Las optimizaciones de #55 no se tocaron (las rutas sin Data API usan el lote de siempre). **No es una medición contra #55 ni de la red de Supabase.**

## 3. Pruebas
| Suite | Resultado |
|---|---|
| Aplicación (Deno) | **146 de 146** (las 139 anteriores + 7 nuevas: agente 5, parámetros 1 y rutas de M-S 1) |
| Proveedores (`pruebas/`) | **223 de 223** |
| `proveedores/pruebas_db` (en PostgreSQL local) | **59 de 59** con las migraciones solas, y **59 de 59** con todas las propuestas (M-D…M-S, M-E y M-P) aplicadas |
| SQL `nexa_app`/rol-app (17 comprobaciones) | verde: identidad, lecturas, documentos, parámetros, agente (estado actual y corte M-P), `nexa_sys`, sonda R2, reversiones |
| Multiempresa (SQL) | verde, incluida la reversión y la re-aplicación |
| Guardas de publicación | verde (155+ comprobaciones) |
**Negativas y motivos específicos:** agente (`FEL_FIRMA/REPETICION/RELOJ/REVOCADO/EMPRESA/LIMITE/CODIGO`), parámetros (por efecto: la lista no contiene la clave), lecturas (`sesión no válida`, `permission denied`, filas vacías por RLS), descarga (`FEL_NO_AUTORIZADO`, `FEL_NO_ENCONTRADO`), aislamiento entre empresas (incluida una persona con dos empresas y selector).
**Mutaciones** (cada defecto introducido a propósito fue detectado): agente 8/8; parámetros 7/7 en SQL y 3/3 en TypeScript; M-S 11/11 más 3 de TypeScript (una más con patrón mal escrito que se repitió bien). Una mutación de M-P (`grant` a `nexa_sys`) es equivalente: M-K ya lo concede.
**No ejecutado / limitaciones:** pruebas de navegador (Playwright) — no se tocó la interfaz, pero no se corrieron en esta fase; medición contra #55; medición con la red/pooler de Supabase; JWKS reales (el emulador usa HS256).

## 4. Riesgos pendientes
1. **R3 abierto:** quedan por el pooler (aun con JWT presente): reporte de consumos, plan y consumos (necesitan tablas de plataforma: RPC `DEFINER` con permiso explícito), lectura de usuarios/miembros, `tipos-documento` y `origenes`, PDF de demostración, consulta al proveedor, rutas de plataforma y administración, y la validación de la cookie propia (`demo_sesiones`). El inventario cuenta **4 de 66** consultas SQL de empresa con ruta alternativa (los lotes de `/api/estado` y del detalle y la lista no se cuentan como sitios).
2. **R1 abierto:** `demo_sesiones` existe; se cierra en W6.
3. **Agente:** `nexa-sys` comprometido = todos los agentes (acotado a esa función); sin rotación de claves de agente; la firma de respuestas del servidor no se cablea en `nexa-sys` (decisión de W5).
4. **Origen de la vinculación:** M-Q es tan fiable como la cabecera de origen; hay que verificar en `nexa-fel-test` cuál (`cf-connecting-ip` o el último `x-forwarded-for`) garantiza la plataforma. Sin ella hay un solo origen compartido.
5. **Ruta real de `nexa-sys`:** se aceptan `/api/agente/v1/…` con o sin prefijo `/functions/v1/nexa-sys`; falta confirmar el path que ve la función.
6. **Migración de agentes ya instalados:** apuntan a la URL actual; el corte a `nexa-sys` exige cambiar su URL (operativo).
7. M-S exige la migración 30 (`tipo_dte`, `referencia_origen`).

## 5. Estado de los riesgos (compuertas)
R1 **abierto**; R2 **cerrado solo en local por clases**, no global (falta el ensayo hospedado y retirar `demo_sesiones`); R3 **abierto** (lecturas de empresa pendientes y rutas por pooler). No se declara cierre global de ninguno.

## 6. Actividades que requieren el ambiente hospedado (`nexa-fel-test`)
W0 (llaves asimétricas en Free, vida mínima del access token, latencia real de la Data API, `auth.sessions` desde función definer); W5 (`nexa-api` sin credencial de base y `nexa-sys` con `FEL_AGENTE_EN_SISTEMA`, cabecera de origen, ruta real, cambio de URL de agentes); W6 (retiro de `demo_sesiones`, cierre de R1); aplicar M-O, M-Q, M-R, M-S y M-P en orden con sus verificaciones; medición contra #55 y con red/pooler reales; login con TOTP; repetir las mediciones de §2 con la Data API real.
