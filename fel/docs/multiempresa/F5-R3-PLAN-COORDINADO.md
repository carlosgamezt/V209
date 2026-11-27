# F5 + R3 · Plan coordinado (arquitectura C) — sin duplicar trabajo

Decisiones vigentes: arquitectura **C** (Supabase Auth + Data API/RPC para personas; conexiones independientes de mínimo privilegio para procesos internos); F4 implementada (local); **no hay clientes reales hasta cerrar R1, R2 y R3**. Detalle de la comparación: [`F5-COMPARACION-ARQUITECTURA.md`](F5-COMPARACION-ARQUITECTURA.md).

## 1. Una sola identidad, tres usos (el principio que evita el trabajo doble)
R1 (fabricar sesiones), R2 (suplantar con parámetros) y R3 (lecturas confiadas a la aplicación) tienen **la misma raíz**: la base cree lo que le dice la aplicación. Con C la identidad la afirma Supabase Auth y la base solo la **comprueba**. Por eso el trabajo se organiza alrededor de una pieza común:

| Activo ya construido | Hoy | En F5 / R3 | Qué cambia |
|---|---|---|---|
| `fel__sesion_empresa` / `fel__sesion_maestro` | validan el token de `demo_sesiones` | validan `auth.uid()` + `session_id` vivo + `aal2` | **solo estas dos funciones** |
| 35 envoltorios `fel_ses_*` (+26 `fel_ses_sys_*`) y 33 `fel_pla_*` | `p_sesion` = token opaco | se publican como `api.*`; el parámetro desaparece (identidad = JWT) | cambio **mecánico por catálogo** (el generador ya existe) |
| Políticas RLS por permiso y empresa (migración 3) y restrictiva por establecimiento (M-F) | existen para `authenticated`; sin privilegios concedidos | pasan a ser **la frontera de lectura** de la Data API | se conceden `SELECT` tabla por tabla (F5-3) |
| **M-L** (nuevo): `fel__sesion_viva`, `fel__aal2`, política restrictiva de sesión viva en las 42 tablas con `empresa_id` | probada local | idem | ya no se reescribe |
| Sonda R2 por clases | C1–C5 cerradas, **R1 abierta (aceptación real de una sesión fabricada)** | R1 pasa a cerrada al retirar `demo_sesiones` | se reutiliza |
| `nexa_sys` + `nexa-sys` (función interna) | local | función Edge separada con su credencial | despliegue |
| Pruebas con `request.jwt.claims` (imitan a PostgREST) | `prueba-rls-sesion-viva.sql` | se amplían a cada tabla/RPC | método reutilizable |

## 2. Medidas (reales, de este repositorio)
**Inventario** (`tools/inventario-lecturas.ts` → [`R3-INVENTARIO-LECTURAS.md`](R3-INVENTARIO-LECTURAS.md), generado):
- **170 consultas SQL directas**: **66 sobre datos de empresa** (el alcance de R3), 51 sin tabla (funciones/utilidades), 31 de plataforma y catálogos globales, 22 de sesiones y simuladores de la demostración (desaparecen en F5).
- **111 llamadas `rpc` a 80 funciones**: 85 ya con identidad de sesión (empresa 33, plataforma 16, sistema en petición 31+3, auditoría 5, `fel_adm_*`/`fel_ses_*`/`fel_pla_*` 9), 11 de sistema o protocolo del agente (credencial propia), 1 acceso acotado y **2 pendientes con alcance de persona/empresa**: `fel_permisos_efectivos` (lectura de los permisos de cualquier usuario: debe salir de `fel_adm_contexto`) y `fel_op_invitacion_aceptar` (acotada por la base; cierra con F5).
**Costo en la base** (`tools/medir-envoltorios.sh`, PostgreSQL local, 1 conexión, **sin red**): la validación de sesión cuesta **≈ 0.12 ms**; el envoltorio suma **≈ 0.08–0.12 ms por llamada** (lectura 1.51 → 1.63 ms; escritura 1.02 → 1.10 ms; ≈ +5–8 % del tiempo de la base, despreciable frente a una vuelta de red de varios ms). **No es una medición contra #55**: esa se hace en `nexa-fel-test` con la red real (sección 5).

## 3. Cómo se cierra cada riesgo (con evidencia exigible)
| Riesgo | Estado hoy | Se cierra cuando | Evidencia |
|---|---|---|---|
| **R2** identidad por parámetros | **clases C1–C5 cerradas en local** (sonda: 10 sondas, 9 rechazadas por `permission denied`/regla; ninguna por error de datos) | ensayo hospedado + F5 | sonda en el pooler real con `esperado=cerrado` |
| **R1** fabricar sesiones | **ABIERTO**: la sonda inserta en `demo_sesiones` y la base devuelve el contexto de otra persona | se retira `demo_sesiones` y `nexa_app` no puede afirmar identidad | sonda R1 «rechazada» y recorrido completo en verde |
| **R3** lecturas por la aplicación | **ABIERTO**: 66 consultas de empresa por `nexa_app` con `using (true)` | cada consulta pasa a RPC/RLS con identidad de Auth y `nexa_app` pierde `SELECT` | prueba de catálogo («`nexa_app` sin privilegios sobre tablas de empresa») + pruebas con claims |

## 4. Orden de trabajo (qué se puede hacer ya y qué espera a `nexa-fel-test`)
| Paso | Contenido | Dónde se valida |
|---|---|---|
| W0 | Verificaciones de plataforma: llaves asimétricas en Free, *Custom Access Token*, mínimo de vida del access token, `auth.sessions` legible por función definer, latencia de la Data API | **solo `nexa-fel-test`** (F5-0 autorizado) |
| W1 | `fel__sesion_empresa`/`maestro` sobre `auth.uid()`, `session_id` vivo, `aal2` (mismo contrato, otra fuente) | local (claims simulados) + `nexa-fel-test` |
| W2 | Esquema `api` y publicación de los envoltorios como `api.*`; `revoke` a `anon`; `search_path` vacío; prueba de que ninguna función `api.*` acepta identidad por parámetro | local + `nexa-fel-test` |
| W3 | **Capa de datos del servidor** con una interfaz y dos implementaciones (pooler/Data API) elegibles por interruptor; el login pasa a Supabase Auth con TOTP | local (doble implementación) + `nexa-fel-test` |
| W4 | **R3**: 66 consultas → RPC de lectura (listas y «estado» en **una RPC por pantalla** para conservar #55) o RLS; `SELECT` a `authenticated` tabla por tabla; `nexa_app` pierde `SELECT` | local (claims) + `nexa-fel-test` |
| W5 | Dos funciones Edge: **`nexa-api`** (sin credencial de base) y **`nexa-sys`** (nexa_sys) | `nexa-fel-test` |
| W6 | Retiro de `demo_sesiones`/`demo_credenciales` y cierre de R1; sonda en «cerrado» | `nexa-fel-test` |

Orden de ejecución sin trabajo doble: W1 → W2 → W3 → W4 → W5 → W6; **W0 va primero y condiciona el diseño de W1**.

## 5. Rendimiento: regla de decisión
- Línea base de #55: tiempos de «Nueva factura», certificación y lista medidos con `nube/medir_frio.cjs`, `nube/medir_ui_real.cjs` y el procedimiento de `docs/rendimiento-historial.md`.
- En `nexa-fel-test`: misma medición con (a) pooler + envoltorios (hoy) y (b) Data API con una RPC por pantalla. **Criterio**: sin regresión reproducible frente a #55 en los flujos medidos; si (b) la causa, se aplica el **modelo híbrido** (personas por Data API solo en operaciones sensibles; lecturas masivas por `nexa_app` con R3 documentado y **sin clientes reales**).
- Las mediciones de la red de Cloudflare → Supabase no se presentan como tiempos garantizados desde Guatemala.

## 6. Compatibilidad con NEXA POS, inventarios y Hotel
Cada módulo publica `api.<módulo>_*` con la **misma identidad** (JWT → `fel__sesion_*`), agrega sus permisos al catálogo (`permisos_catalogo`/`rol_permisos`, efectivos por rol, extras y revocados) y reutiliza el establecimiento fijo por usuario. Las terminales y sincronizaciones usan usuarios de Supabase Auth con *claims* de dispositivo o `nexa_sys`; ningún módulo recibe una credencial de base de datos en el cliente.
