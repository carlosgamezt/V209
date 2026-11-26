# Plan técnico de activación — etapa 1E (PROPUESTA; no se ejecuta nada sin autorización)

Alcance: llevar a la base hospedada de Supabase las propuestas M-D, M-A, M-B, M-C, M-F, M-G, M-H y M-E, y encender, por fases, el establecimiento asignado por usuario, la administración de establecimientos y el rol restringido `nexa_app`.
**Fuera de alcance de 1E:** certificar desde los establecimientos 2 y 67 (exige `datos-emisor` verificado) y activar el resolvedor multiempresa de Digifact.

## 1. Migraciones y orden

Prerrequisito: migraciones 1 a 30 aplicadas (la 29 y la 30 se verifican, no se aplican aquí).

| Orden | Archivo | Qué hace | Reversible con datos |
|---|---|---|---|
| 0 | (verificación) | `tools/sql-solo-lectura.sh` con consultas de solo lectura: versión de las migraciones, funciones y tablas existentes, parámetros | — |
| 1 | `M-D_permisos` | catálogo y permisos efectivos | `reversion.sql` |
| 2 | `M-A_emisor_fiscal` | emisor por establecimiento (versiones) | `reversion.sql` (se niega si hay emisores aprobados) |
| 3 | `M-B_digifact_config` | configuración Digifact por empresa (sin credenciales aún) | `reversion.sql` (se niega con datos) |
| 4 | `M-C_acceso_maestro` | acceso excepcional del administrador de la plataforma | `reversion.sql` (se niega con datos) |
| 5 | `M-F_establecimientos_usuario` | asignaciones, disparadores, interruptor `establecimiento_por_usuario = 0` | `reversion.sql` (se niega si hay asignaciones) |
| 6 | `M-G_sesion_admin` | funciones `fel_adm_*` con identidad de la sesión | `reversion.sql` |
| 7 | `M-H_admin_establecimientos` | listado, nombre interno y supervisión | `reversion.sql` |
| 8 | `M-E_rol_app` | rol `nexa_app`, privilegios explícitos y políticas | `reversion-M-E.sql` |

Cada archivo se aplica en **una transacción** (`psql --single-transaction`, `ON_ERROR_STOP`), uno por vez, con `verificacion.sql` (solo lectura) entre uno y otro. M-E va al final porque otorga privilegios sobre todo lo anterior. Tras M-D…M-H, **todo queda apagado**: el interruptor de base vale 0 y las rutas `/api/admin/*` no existen mientras el servidor no lo encienda.

## 2. Compatibilidad con la base hospedada (lo que NO está demostrado)

Probado solo en PostgreSQL temporal local. Antes de tocar producción hay que repetirlo en un **proyecto de pruebas restaurado desde la copia de seguridad más reciente**:
1. Que `create role nexa_app login nobypassrls` y las concesiones funcionen con el usuario administrador de Supabase (permisos de `postgres` en el proyecto alojado).
2. Formato real de usuario del pooler para un rol propio (en Supabase suele ser `rol.<ref-del-proyecto>`) y que el puerto 6543 (modo transacción) acepte `nexa_app`.
3. Que el esquema `auth` (llaves foráneas a `auth.users`) y `vault` se comporten como en el shim local; que M-E no necesite privilegios sobre `auth` ni `vault`.
4. Que las extensiones y funciones usadas (`sha256`, `gen_random_uuid`, `pgcrypto` si aplica) existan sin cambios.
5. Duración y bloqueos: las tablas nuevas no bloquean a las existentes, pero los `ALTER`/disparadores sobre `documentos` y `miembros` toman un bloqueo breve; aplicar en ventana tranquila.
6. Que la función desplegada hoy siga funcionando con el rol anterior hasta el cambio explícito de la cadena de conexión.

## 3. Riesgos de seguridad

| # | Riesgo | Mitigación / estado |
|---|---|---|
| R1 | Quien controle `nexa_app` puede ejecutar funciones `fel_adm_*` con un token robado y crear sesiones | Secreto de conexión solo en la función; rotación; solución de fondo: sesiones por Supabase Auth con MFA validadas por la base (fuera de 1E) |
| R2 | Las 86 funciones `fel_op_*` siguen recibiendo `p_actor`/`p_empresa`; `nexa_app` ya no las ejecuta directamente, pero el código del servidor sí las usa | El servidor es la frontera de confianza; migrarlas a `fel_adm_*` por etapas |
| R3 | Las políticas de `nexa_app` son `using (true)` en tablas de la aplicación: el aislamiento entre empresas por SQL directo lo aplica la aplicación | Documentado; las tablas protegidas no tienen concesiones ni políticas |
| R4 | Error en la asignación deja a un facturador sin establecimiento (no puede facturar) | Fase de observación con interruptor apagado, asignar antes de encender; mensaje claro; reversión por interruptor |
| R5 | Reasignación con borradores pendientes | El borrador se queda en su establecimiento; solo un administrador lo traslada con motivo (auditado) |
| R6 | Consulta extra por petición para usuarios restringidos (alcance) | Medida acotada; solo con el interruptor encendido; no afecta al camino sin restricción |
| R7 | Rutas administrativas expuestas con la función apagada | Probado: apagado = ninguna ruta `/api/admin/*` (404 con o sin sesión) y la pantalla no aparece |
| R8 | Hosted: formato del usuario del pooler o privilegios distintos al local | Ensayo en proyecto restaurado antes de producción |

## 4. Reversión

Dos niveles, del menos al más drástico:
1. **Apagar (inmediato, sin pérdida):** quitar `FEL_ESTABLECIMIENTO_POR_USUARIO` de la función y poner `establecimiento_por_usuario = 0`. Desaparecen rutas y bloqueos; los datos quedan. Es la reversión normal.
2. **Retirar objetos:** `reversion.sql` (M-H…M-D, orden inverso) **se niega por diseño** si ya hay asignaciones, emisores aprobados o configuración Digifact: primero exportar y decidir con el propietario. `reversion-M-E.sql` retira políticas y el rol `nexa_app` (cerrar sus sesiones antes).
3. **Conexión:** volver a la cadena de conexión anterior de la función (se conserva hasta cerrar la fase) — no depende de las migraciones.
4. Copia de seguridad lógica (`tools/respaldo-nexa-demo.sh`) justo antes de empezar; ensayo de restauración ya documentado.

## 5. Validación de la conexión con `nexa_app`

Antes de cambiar la función, en este orden y en solo lectura donde sea posible:
1. `select current_user, rolbypassrls, rolsuper from pg_roles where rolname = current_user` conectado como `nexa_app` → no super, sin BYPASSRLS.
2. Conteo exacto de funciones ejecutables (108 previstas) y ninguna interna `fel_op_*` de administración.
3. `tools/test-rol-app.sh` equivalente contra el proyecto de pruebas: auditoría SECURITY DEFINER (todas con `search_path` vacío; nada ejecutable por `anon`/PUBLIC), pruebas como `nexa_app`, sesión validada, administración de establecimientos y recorrido completo (sesión, MFA, factura, certificación simulada, PDF, anulación, otra empresa, administrador de la plataforma).
4. Cambiar la cadena de conexión **solo en el entorno de pruebas** de la función; recorrido manual; luego producción en horario tranquilo con la anterior lista para volver.

## 6. Pruebas posteriores a la activación

- Verificación de solo lectura (`verificacion.sql`) y auditoría de funciones.
- Suite de seguridad con dos usuarios (A en el 2, B en el 67), supervisor acotado, otra empresa y peticiones manipuladas (`usuarios_ab_interruptores_test.ts`, `establecimiento_api_test.ts`, `admin_establecimientos_api_test.ts`, SQL como `nexa_app`).
- Pantallas a 390 y 1100 px (`e2e_establecimientos_admin.cjs`, `e2e_establecimiento_bloqueado.cjs`) y regresiones móvil/rediseño/práctica.
- Rendimiento: comparar tiempos de «Nueva factura» y lista con la medición de la versión #55 (las optimizaciones no se tocan; el alcance añade una consulta solo a usuarios restringidos).
- Observación 24 h: errores 403 `sin_establecimiento`, tiempos, auditoría de asignaciones.

## 7. Secuencia propuesta (todo requiere autorización expresa por fase)

| Fase | Acción | Interruptores |
|---|---|---|
| 0 | Respaldo + ensayo completo en proyecto restaurado | — |
| 1 | Aplicar M-D…M-H en producción, verificar | todo apagado |
| 2 | Crear los dos usuarios reales y asignarlos (2 y 67) desde SQL controlado | base 0, servidor apagado |
| 3 | Aplicar M-E y validar `nexa_app`; cambiar la conexión (con la anterior lista) | apagados |
| 4 | Encender el servidor (`FEL_ESTABLECIMIENTO_POR_USUARIO=1`) y la base (1) | encendidos; supervisión de 24 h |
| 5 | Cerrar: retirar la conexión anterior | — |

La certificación real por establecimiento queda **bloqueada** hasta completar `datos-emisor` de 2 y 67 y la aprobación de su emisor.

## 8. Ensayo en el proyecto aislado «nexa-fel-test» (procedimiento)
Prerrequisitos que coordina el titular: proyecto creado (plan Free, USD 0.00 adicional según la consulta a la organización), **sin ninguna integración, webhook, tarea programada, Resend ni correo habilitados**, y un entorno protegido de GitHub (p. ej. `ensayo-1e`, con aprobación manual) con los secretos `ENSAYO_REF`, `ENSAYO_URL_ADMIN` (session pooler 5432), `ENSAYO_URL_APP` (pooler 6543, usuario `nexa_app.<ref>`) y `ENSAYO_CLAVE_NEXA_APP`.
Script: `tools/ensayo-1e.sh validar|aplicar|probar|todo` — guardas (exige `ENSAYO_CONFIRMO=nexa-fel-test`, se niega si el ref es el de nexa-demo o si los usuarios no corresponden), migraciones 1-30 solo si el proyecto está vacío, propuestas en orden, verificación de solo lectura, datos **simulados** (dos empresas, establecimientos 2 y 67), pruebas como `nexa_app` por el pooler, sonda R2 y comprobación de RLS sin política.
Validado hoy contra un PostgreSQL local (no contra el pooler ni el proyecto real): todas las etapas en verde, `nexa_app` sin super ni BYPASSRLS, 108 funciones ejecutables, sonda R2 «abierto» (esperado hoy).
Lo que solo se puede comprobar en el proyecto real: formato del usuario del pooler, `create role`/`alter role` con el administrador de Supabase, comportamiento de `auth`/`vault` y duración de las migraciones.
