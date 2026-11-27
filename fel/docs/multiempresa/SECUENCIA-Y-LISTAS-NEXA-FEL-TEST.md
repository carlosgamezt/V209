# Secuencia definitiva y listas de comprobación para `nexa-fel-test` (W0, W5, W6 y ensayo 1E)

**Nada de esto se ejecuta sin autorización expresa y solo en `nexa-fel-test`** (proyecto aislado, plan Free, USD 0.00 adicional, sin Resend ni correo, datos simulados). Nunca en `nexa-demo` ni en producción. Ningún secreto en archivos, commits, registros o chat; los secretos los crea el titular en el entorno protegido de GitHub `ensayo-1e`.

## A. Prerrequisitos que solo puede aportar el titular
- [ ] Proyecto `nexa-fel-test` creado (Free), **sin** integraciones, webhooks, tareas programadas, Resend ni correo.
- [ ] Entorno GitHub `ensayo-1e` con aprobación manual y secretos: `ENSAYO_REF`, `ENSAYO_URL_ADMIN` (session pooler 5432), `ENSAYO_URL_APP` (pooler 6543, usuario `nexa_app.<ref>`), `ENSAYO_CLAVE_NEXA_APP`, y para F4: `ENSAYO_URL_SYS`, `ENSAYO_CLAVE_NEXA_SYS`.
- [ ] Confirmación de que el ref **no** es el de `nexa-demo` (el guion se niega si lo es).
- [ ] Copia lógica previa (`tools/respaldo-nexa-demo.sh`, aplicable también a este proyecto vacío solo para ensayar el procedimiento).

## B. Secuencia (cada paso termina con su verificación; si falla, se detiene y se revierte)
| # | Paso | Verificación | Reversión |
|---|---|---|---|
| 0 | **W0** (ver §C): verificaciones de plataforma, sin código nuevo | lista W0 completa | — |
| 1 | Migraciones 1–30 en proyecto vacío (la 29 y la 30 se **verifican**) | `tools/ensayo-1e.sh validar`; conteos de tablas y funciones | recrear el proyecto vacío |
| 2 | Propuestas, **una transacción cada una**, en este orden: `M-D, M-A, M-B, M-C, M-F, M-G, M-H, M-I, M-J, M-K, M-L, M-M, M-N, M-O, M-Q, M-R, M-S, M-T, M-U, M-V1, M-V, M-E` (`tools/ensayo-1e.sh aplicar`) | `verificacion.sql` (solo lectura) entre una y otra; auditoría `SECURITY DEFINER` (todas con `search_path` vacío; nada ejecutable por `anon`/PUBLIC; las únicas ejecutables por `authenticated` son los ayudantes de RLS esperados) | `reversion-M-V` (retira M-V1 y M-V), `reversion-M-U, -T, -S, -R, -Q`, luego `reversion-M-M-N-O.sql`, luego `reversion.sql` (se niega con datos de configuración) y `reversion-M-E.sql` |
| 3 | Datos **simulados** (`fixture-sesion.sql`: dos empresas, establecimientos 2 y 67, personas de prueba) | `tools/ensayo-1e.sh probar` | borrar el proyecto de pruebas |
| 4 | Pruebas como `nexa_app` por el pooler y como `nexa_sys`; suites de §8–8i del guion (identidad, lecturas, parámetros, documentos, plan/plataforma, agente) | todas en «OK»; sonda R2 esperada «abierto» hasta W6 | — |
| 5 | **Configurar la Data API:** esquemas expuestos = **solo `api`**; `anon` sin privilegios; límites de filas; JWT con llaves asimétricas si W0 lo confirma | llamada anónima a `/rest/v1/rpc/contexto` → 401; perfil `public` → 406 | volver a la configuración previa |
| 6 | Usuarios de Supabase Auth **de prueba** (sin copiar contraseñas) con TOTP; membresías de la fixture | iniciar sesión, verificar TOTP y ver que `auth.sessions.aal` pasa a `aal2` | borrar usuarios de prueba |
| 7 | **W5:** desplegar `nexa-api` (sin credencial de base) y `nexa-sys` (`FEL_SYS_BD_URL`, `FEL_SYS_SECRETO`, `FEL_AGENTE_EN_SISTEMA=1`) | lista W5 | retirar las funciones |
| 8 | Ruta del agente por `nexa-sys` y luego **M-P** (`ENSAYO_CORTE_M_P=1`) | `nexa_app` sin ninguna `fel_sys_*`; agente de prueba vincula y emite latidos firmados | `reversion-M-P.sql` |
| 9 | **W6:** inicio de sesión por Supabase Auth; retiro de `demo_sesiones`/`demo_credenciales` | lista W6; sonda R1 «rechazada» (`FEL_R2_ESPERADO=cerrado`) | restaurar desde la copia previa (solo ensayo) |
| 10 | Mediciones contra #55 (`COMPARACION-RENDIMIENTO-55.md`) | criterios de aceptación de ese documento | — |

### B.1 Verificaciones previas al ensayo que ya pasaron en local (repetir en `nexa-fel-test`)
`tools/ensayo-respaldo-esquema.sh` (respaldo/restauración), `tools/carga-basica.sh` (concurrencia), `tools/ensayo-rotacion.sh` (rotación). Documentos: `PROCEDIMIENTO-RESPALDO-Y-RECUPERACION.md`, `MONITOREO-MINIMO.md`, `ROTACION-DE-CREDENCIALES.md`, `CONDICIONES-PREVIAS-LANZAMIENTO.md`.

## C. Lista de comprobación W0 (verificaciones de plataforma; define el diseño de W1)
- [ ] **Llaves de firma asimétricas (ES256/RS256) disponibles en el plan Free** y JWKS publicado. Si no: documentar y decidir (HS256 heredado no es aceptable como destino).
- [ ] **Vida mínima configurable del access token** y valor elegido (la revocación efectiva depende de `session_id` vivo, no del `exp`).
- [ ] `auth.jwt()` expone `sub`, `role`, `aal`, `session_id` con esos nombres exactos.
- [ ] **`auth.sessions` legible desde una función `SECURITY DEFINER`** de dueño `postgres` y `aal` se actualiza a `aal2` tras verificar TOTP (supuesto de `fel__aal2()`).
- [ ] Cerrar sesión elimina/invalida la fila en `auth.sessions` (supuesto de la revocación inmediata).
- [ ] TOTP gratuito operativo; sin proveedores externos ni registro libre habilitados.
- [ ] `postgres` del proyecto puede crear roles y hacer `SET ROLE nexa_app/nexa_sys` (membresía) para las pruebas; formato del usuario del pooler para roles propios.
- [ ] Data API: solo `api` expuesto; latencia p50/p95 de una RPC vs una consulta por el pooler (misma región).
- [ ] Qué cabecera de origen garantiza la plataforma (`cf-connecting-ip` o el último `x-forwarded-for`) — la usa M-Q.
- [ ] Ruta real que ve una función de Supabase (con/sin `/functions/v1/<nombre>`) — la usa el ruteo anclado de `nexa-sys`.

## D. Lista de comprobación W5 (funciones separadas)
- [ ] `nexa-api` **no** tiene `FEL_SYS_BD_URL`, `FEL_SYS_SECRETO` ni cadena de conexión de base alguna (guarda estática ya en `tests/secreto_sistema_test.ts`; repetir revisando los secretos del proyecto).
- [ ] `nexa-api` reenvía el JWT de la persona (`Authorization`) y usa la llave **pública** (`apikey`); `FEL_DATOS=dataapi`.
- [ ] `nexa-sys`: solo `POST /tick` (secreto ≥ 24 caracteres, comparación en tiempo constante) y `POST /api/agente/v1/*` (firma); cualquier otra ruta/método → 404.
- [ ] El `tick` se programa sin costo adicional; respuesta solo con conteos.
- [ ] Vinculación y latido de un agente de prueba por la URL de `nexa-sys`; límite por origen comprobado desde dos orígenes.
- [ ] Decisión sobre firmar las respuestas al agente (`FEL_AGENTE_FIRMA_*`).
- [ ] Sin Resend, sin envíos, sin certificación real.

## E. Lista de comprobación W6 (cierre de R1)
- [ ] Todas las personas de prueba entran por Supabase Auth; ninguna ruta acepta la cookie propia.
- [ ] Invitaciones de cuentas (sin copiar contraseñas); rutas de alta de demostración ya cerradas con la Data API.
- [ ] `demo_sesiones`, `demo_credenciales` y los envoltorios `fel_ses_*` con token retirados; `nexa_app` sin privilegios sobre tablas de sesión.
- [ ] **Sonda R1: «rechazada»** y recorrido completo en verde; sonda R2 con `esperado=cerrado`.
- [ ] Cobertura: ninguna consulta de empresa del servidor llega al pooler con identidad de persona (inventario `R3-INVENTARIO-LECTURAS.md` regenerado; las que queden, justificadas una por una en `RIESGO-RESIDUAL-R3.md`).

## F. Lista del ensayo 1E (`tools/ensayo-1e.sh`)
- [ ] `validar`: identidad del administrador (sin super/BYPASSRLS indebidos), proyecto vacío o esperado, guardas de ref/usuarios.
- [ ] `aplicar`: §B pasos 1–2, con `verificacion.sql` entre cada propuesta.
- [ ] `probar`: pasos 3–4 y las secciones 8–8i, 9 (sonda), 10 (tabla nueva sin política = 0 filas).
- [ ] Sin artefactos con secretos; el flujo `.github/workflows/ensayo-1e.yml` solo se lanza a mano, en el entorno protegido.
- [ ] Informe del ensayo (qué pasó, qué falló, evidencia) para decidir el paso a producción **sin** clientes reales hasta cerrar R1, R2 y R3.
