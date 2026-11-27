# Informe consolidado · W1–W4 (arquitectura C, validación local)

Rama `fel-proveedores-diseno`, desde el commit 220a5a6. Todo se probó **solo en local** (PostgreSQL temporal, PGlite y un emulador de PostgREST con verificación de firma de JWT). No se tocó `nexa-demo`, otros worktrees ni producción; no se activó Resend ni se envió correo; no se certificó nada real; no hay clientes reales; el borrador a Digifact sigue sin versionar; no se usaron credenciales ni se generó costo.

## 1. Estado de los riesgos (sin declarar cierres que no estén demostrados)
| Riesgo | Estado | Por qué |
|---|---|---|
| **R1** fabricar sesiones | **ABIERTO** | `demo_sesiones` sigue existiendo y la sonda aún la acepta; se cierra en W6 (nexa-fel-test) |
| **R2** identidad por parámetros | **Cerrado en local por clases C1–C5; no declarado cerrado global** | falta el ensayo hospedado; los 9 protocolos del agente siguen en `nexa_app` (ver §4) |
| **R3** lecturas por `nexa_app` con `using (true)` | **ABIERTO** | el piloto cubre 4 lecturas; las 66 consultas de empresa siguen existiendo como ruta del pooler (inventario regenerado) |

## 2. Cambios
- **W1 · M-M** `fel__ctx` (exige `auth.uid()`, sesión viva en `auth.sessions`, perfil activo, empresa por membresía con selector opcional en `app_metadata`), `fel__exigir_aal2` (aal2 en token **y** sesión guardada), `fel__sesion_empresa/maestro(null)` por Auth (plataforma sin membresías, aal2 si `plataforma_mfa_obligatoria`).
- **W2 · M-N** esquema `api`: 88 funciones generadas por catálogo, `SECURITY DEFINER`, `search_path` vacío, sin `p_sesion`/`p_actor`/`p_empresa` de empresa, aal2 en 28 operaciones sensibles; no se publican pasos del sistema ni auditoría; solo `authenticated` ejecuta.
- **W3** `puerto_datos.ts` (pooler / Data API conmutable con `FEL_DATOS=dataapi`), `emulador_postgrest.ts` (solo pruebas). Sin JWT, firma ajena, vencido, `alg:none`, sesión cerrada, aal1 en sensible o identidad distinta: rechazados **antes de salir** o por la base. Sin degradación silenciosa al pooler. Se corrigió que `ErrorIdentidad` salía como 500 (ahora 403).
- **W4 · M-O** 4 RPC de lectura `SECURITY INVOKER` (clientes, conceptos, establecimientos, `estado_catalogos` en una sola vuelta) + RLS; ayudante mínimo `fel__parametros_lista` (no se concede `plataforma_parametros`); RLS de las 3 tablas piloto y `sesion_viva` reescritas para evaluarse una vez por consulta.
- **Punto 7 · M-P** (+ reversión): corte de los 9 protocolos del agente al nivel `nexa_sys`.
- **Punto 8**: guardas del secreto y de la interfaz de `nexa-sys`; ruta anclada `POST /tick`.
- Reversiones: `reversion.sql` retira ahora `api` y ayudantes primero; `reversion-M-M-N-O.sql`; `reversion-M-P.sql`.
- Documento NEXA POS: `NEXA-POS-COMPONENTES-REUTILIZABLES.md` (solo documentación).

## 3. Pruebas
Nuevas: `prueba-api-identidad.sql`, `prueba-api-lecturas.sql`, `prueba-agente-protocolo.sql`, `tests/puerto_datos_test.ts` (6), `tests/secreto_sistema_test.ts` (3). Proveedores: **223/223**. Suite de aplicación, multiempresa y rol-app: ver el resultado final en el mensaje de entrega. Rechazos comprobados por su mensaje o efecto (permission denied, «sesión no válida», «aal2», filas vacías por RLS), no por error de datos.
**Mutaciones** (cada defecto introducido a propósito fue detectado): W1/W2 5/5 (sin aal2, anon ejecuta, sin sesión viva, aal2 solo en token, plataforma sin MFA); W3 6/6; W4 5/5 tras añadir una aserción (sin filtro de empresa, lectura DEFINER, ayudante sin sesión, anon, escritura concedida); M-P 2 detectadas y 1 equivalente (el `grant` a `nexa_sys` es redundante porque M-K ya lo concede); punto 8 4/4.

## 4. Hallazgos que requieren decisión
1. **Protocolos del agente (9 `fel_sys_*`)**: la base valida agente activo, reloj, nonce, empresa de la orden, token de fencing, solo resultados simulados `SIM-` y un límite global de vinculación. **No verifica la firma**: con solo el id de un agente, `nexa_app` puede enviar latidos (medido). Además el límite global de 20 fallos permite a un `nexa_app` comprometido bloquear las vinculaciones 10 min. Recomendación: aplicar M-P cuando la ruta del agente use `nexa-sys` (W5).
2. **Parámetros de plataforma** se entregan hoy a cualquier persona con sesión (`/api/estado`); se conservó el comportamiento. Conviene decidir si todos deben verse.
3. **`auditoria`**: `authenticated` ya tenía `SELECT` por RLS desde las migraciones originales; solo lectura, comprobado.
4. **RLS por fila**: `fel_tiene_permiso` por fila costaba 1.8 s con 15 000 clientes; resuelto en las tablas piloto. Las demás tablas (p. ej. `documentos`, usada en el conteo de `facturas`) conservan la política por fila: debe medirse antes de migrarlas.

## 5. Rendimiento (base local, 1 conexión, sin red; **no es medición contra #55**)
Validación de sesión ≈0.13 ms; envoltorio de lectura 1.67→1.66 ms y de escritura 1.19→1.28 ms; `api.cliente_guardar` 1.89 ms; `api.estado_catalogos` con 300 clientes 5.1 ms (incluye serializar JSON). Las optimizaciones de #55 no se tocaron (rutas sin Data API usan exactamente el lote anterior). La latencia real de la Data API se mide en `nexa-fel-test`.

## 6. Pendiente (reservado a `nexa-fel-test` o a decisión)
W0 (llaves asimétricas en Free, vida mínima del access token, latencia Data API, `auth.sessions` desde función definer); W5 (`nexa-api` sin credencial de base y `nexa-sys` desplegada, ruta real de la función); W6 (retiro de `demo_sesiones`, cierre de R1); login por Supabase Auth con TOTP; migrar el resto de lecturas (R3); ensayo hospedado y medición contra #55; decisión sobre M-P y sobre los parámetros.
