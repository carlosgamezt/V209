# Estrategia integral para cerrar el riesgo R2 (suplantación por funciones con actor y empresa como parámetros)

Estado: **PROPUESTA**. Nada de esto se ha implementado ni aplicado. R2 sigue **ABIERTO** y es un **impedimento para activar clientes reales** (no para el ensayo ni para TEST con datos simulados).

## 1. Evidencia de que R2 sigue abierto
`docs/multiempresa/propuesta/prueba-r2-suplantacion.sql`, conectada **como `nexa_app` y sin ninguna sesión**, con la base temporal del ensayo:

| Sonda | Resultado |
|---|---|
| Listar a las personas de la empresa A diciendo que se es su propietaria | **POSIBLE** |
| Crear un establecimiento en la empresa A como su propietaria (se deshace) | **POSIBLE** |
| La propietaria de la empresa B actuando en la empresa A | rechazada (el permiso se evalúa en la empresa objetivo) |

Que las funciones `fel_adm_*` superen sus pruebas **no cierra R2**: solo prueba que esa ruta nueva no se puede suplantar. Las funciones antiguas siguen ejecutables por `nexa_app` con cualquier actor.

## 2. Inventario exacto (corrige la cifra «86» usada antes)
Medido en el catálogo con las migraciones 1 a 30 (todas `SECURITY DEFINER`, `search_path` vacío). `nexa_app` ejecuta hoy 108 funciones (105 + 3 de M-H).

| Familia | Total | Identidad por parámetro |
|---|---|---|
| `fel_op_*` | 40 | 34 con **actor + empresa** (incluye `fel_op_miembro_actualizar`, que además recibe un usuario objetivo) · 4 con **solo actor** (recuperación de MFA de la plataforma) · 2 **previas a la sesión** (`fel_op_invitacion_aceptar`, `fel_op_mfa_recuperacion_solicitar`, reciben un usuario) |
| `fel_admin_*` | 29 | 20 con **solo actor** (operaciones de la plataforma) · 9 con **actor + empresa** |
| `fel_sys_*` | 45 | **sin actor**: 24 reciben una empresa, 21 nada (identidad «sistema»: servidor y agente) |
| otras | — | `fel_auditar(actor, empresa, …)` permite **falsificar auditoría**; `fel_limite_consumir`, `fel_es_*`, etc. |

**Superficie de suplantación de personas: 69 funciones** (`fel_op_*` + `fel_admin_*`) **+ `fel_auditar`**. Aparte, las 24 `fel_sys_*` con empresa permiten a una conexión comprometida operar sobre cualquier empresa sin actor (otro problema: identidad «sistema»).
El servidor llama hoy a **40 funciones distintas** de las 69 (`rpc("fel_op_…")`/`rpc("fel_admin_…")`).

## 3. Principio
Ninguna función ejecutable por la aplicación toma de **parámetros** quién actúa ni de qué empresa. La identidad sale de (a) la **sesión validada en la base** (`fel__sesion_empresa`, `fel__sesion_maestro`, ya en M-G) o (b) una **credencial de máquina validada** (patrón de `fel_sys_agente_autenticar`) para los procesos sin persona.

## 4. Clases y tratamiento
| Clase | Funciones | Tratamiento |
|---|---|---|
| **C1 · persona de una empresa** | 34 `fel_op_*` + 9 `fel_admin_*` con empresa | Envoltorio `fel_adm_<nombre>(p_sesion, …)` **generado desde el catálogo**: actor y empresa salen de la sesión; los demás parámetros se conservan. Se retira `EXECUTE` de la original a `nexa_app` |
| **C2 · plataforma** | 20 `fel_admin_*` solo actor + 4 `fel_op_mfa_recuperacion_*` | `fel_adm_maestro_<nombre>(p_sesion, …)` con `fel__sesion_maestro` (exige sesión de plataforma con MFA); si hay empresa objetivo, se valida con las reglas de M-C y se audita |
| **C3 · previas a la sesión** | `invitacion_aceptar`, `mfa_recuperacion_solicitar`, inicio de sesión | Funciones estrechas que **prueban la credencial** (invitación vigente, código de recuperación) en vez de aceptar un usuario; el inicio de sesión se cierra en la fase 5 |
| **C4 · sistema** | 45 `fel_sys_*` | Rol de base separado `nexa_sys` con credencial distinta, solo para agente, supervisor y servicio de certificación; `nexa_app` pierde las que no necesita. Las que se ejecutan dentro de una petición de persona reciben el token y validan la empresa de la sesión |
| **C5 · auditoría** | `fel_auditar` | Solo interna: se llama dentro de los envoltorios; se retira a `nexa_app` |

**Factibilidad medida:** las 69 son `SECURITY DEFINER`; solo 3 devuelven conjuntos, 7 tienen valores por defecto y el resto devuelve filas de una tabla, `void`, `uuid` o `jsonb`. Un generador por catálogo (`pg_get_function_arguments`/`pg_get_function_result`) las cubre sin escribir 69 funciones a mano; las 3 con conjuntos y las 7 con valores por defecto se revisan aparte.

## 5. Mecanismo en el servidor
- Un único punto: `rpcSesion(req, "documento_guardar", args)` reemplaza `bd.rpc("fel_op_documento_guardar", { p_actor, p_empresa, … })`. Rechaza cualquier argumento llamado `p_actor` o `p_empresa`.
- **Guarda estática** (prueba): ninguna llamada del código del servidor puede contener `p_actor` ni `p_empresa`.
- Interruptor `FEL_IDENTIDAD_SESION=1` por fases; las funciones originales siguen existiendo (las usa el propio envoltorio) pero dejan de ser ejecutables por `nexa_app`.
- **Rendimiento:** cada envoltorio agrega una validación de sesión. Se medirá contra la versión #55; si pesa, se valida la sesión una sola vez por petición y se reutiliza dentro de la misma transacción.

## 6. Pruebas y compuertas (todas obligatorias)
1. **Catálogo:** `nexa_app` no tiene `EXECUTE` sobre ninguna función con `p_actor`, `p_empresa` o `p_user` de identidad (se calcula del catálogo, no de una lista).
2. **Sonda R2** (`prueba-r2-suplantacion.sql`) con `-v esperado=cerrado`.
3. **Por envoltorio:** misma llamada con (a) sesión de otra empresa, (b) sesión de otra persona sin permiso, (c) sesión vencida o desactivada, (d) token inventado → todas rechazadas; la persona correcta funciona igual que antes.
4. **Equivalencia:** la batería actual (123 pruebas de la demo, SQL, navegador) pasa sin cambios con el interruptor encendido.
5. **Guarda estática** del servidor y **pruebas de mutación** (quitar la validación de sesión de un envoltorio debe hacer fallar una prueba).
6. **Ensayo en `nexa-fel-test`** con el rol real por el pooler.

## 7. Fases (cada una requiere autorización)
| Fase | Contenido | Riesgo si se detiene aquí |
|---|---|---|
| F0 | Generador por catálogo + prueba de catálogo + sonda en modo «cerrado» (rojo hasta terminar) | — |
| F1 | C1 (43 funciones): primero lo fiscal y de dinero (certificación, anulación, documentos), luego clientes, conceptos y empresa | Plataforma y MFA siguen abiertas |
| F2 | C2 (24): panel de la plataforma y recuperación de MFA | Quedan C3, C4, C5 |
| F3 | C5 y C3 (auditoría, invitación aceptada, recuperación solicitada) | Quedan C4 y R1 |
| F4 | C4: rol `nexa_sys` separado | Queda R1 |
| F5 | **R1, raíz de confianza:** sesiones con Supabase Auth (JWT que la base valida con la clave del proyecto) con MFA | — |

## 8. Cuándo se considera cerrado R2
Cuando F1 a F3 pasen todas las compuertas **y** el ensayo en `nexa-fel-test` dé la sonda en «cerrado». Con F4 se acota el poder del servidor sobre las operaciones del sistema.
**Cierre honesto:** tras F3 una conexión comprometida ya no puede actuar como cualquiera con solo conocer sus identificadores, pero **sigue pudiendo fabricar sesiones** (R1) porque la aplicación puede escribir en `demo_sesiones`. Solo la F5 elimina esa capacidad. Hasta la F5 no se recomienda activar clientes reales sin la mitigación operativa (secreto de conexión solo en la función, rotación y alertas de auditoría).

## 9. Decisiones que necesito
1. Aprobar F0 y F1 como siguiente trabajo (solo local, sin tocar nexa-demo ni la base hospedada).
2. Confirmar que **F5 (Supabase Auth)** es el objetivo final, o aceptar R1 como riesgo conocido para el piloto en TEST.
3. Decidir si `nexa_sys` (F4) entra antes del primer cliente real o después.

---
# Anexo A · Compatibilidad de F1 con F5 (Supabase Auth) — evitar deuda técnica
**Conclusión: F1 no duplica trabajo con F5, siempre que se mantenga una sola regla: la identidad se resuelve ÚNICAMENTE en `fel__sesion_empresa` / `fel__sesion_maestro`.**
- Los envoltorios `fel_ses_*` (M-I) llaman a `fel__sesion_empresa(p_sesion)` y nada más para saber quién actúa y de qué empresa. Hoy `p_sesion` es el identificador opaco de la cookie (tabla `demo_sesiones`); en F5 será el JWT de Supabase Auth y **solo se reimplementa esa función** (validar firma, expiración, `aal2`, `sub` y la empresa de los metadatos). Los envoltorios, el generador, la capa del servidor (`identidad_sesion.ts`) y las pruebas por envoltorio **no cambian**.
- Qué cambia en F5 y no en F1: la tabla de sesiones y su escritura por `nexa_app` (R1) desaparecen; el inicio de sesión pasa a Supabase Auth con MFA.
- **Punto crítico que condiciona F5:** con conexión directa a PostgreSQL (nuestro caso, por el pooler) *nadie valida el JWT fuera de la base*. Si la función solo leyera `request.jwt.claims`, una conexión comprometida podría escribir esas claves. Por eso `fel__sesion_empresa` debe **verificar la firma del JWT dentro de la base** con material que `nexa_app` no pueda leer (clave pública del proyecto o secreto en una función `SECURITY DEFINER`). Hay que confirmar con el proyecto de pruebas si la base puede verificar la firma de las llaves asimétricas del proyecto; si no, el diseño alterno es un servicio de sesiones de confianza que firme tokens de corta vida con una clave que solo conozca la base. Es una **decisión de F5, no de F1**.
- Deuda evitada: no se introdujo un segundo mecanismo de identidad (ni cabeceras de identidad, ni funciones por cliente, ni listas de personas autorizadas).
- Deuda aceptada y acotada: el parámetro se llama `p_sesion` (hoy token opaco). Se documenta como «credencial de sesión»; renombrarlo en F5 sería un cambio mecánico por catálogo.

# Anexo B · Módulos futuros (NEXA POS, inventarios, otros)
- El patrón es reutilizable: cada módulo expone sus funciones con el mismo envoltorio (`<módulo>_ses_*`) y la misma resolución de identidad; los permisos nuevos se agregan al catálogo (`permisos_catalogo`/`rol_permisos`) y siguen siendo efectivos por rol, extras y revocados.
- La empresa y el establecimiento activo salen de la sesión (`fel_adm_contexto`), por lo que un módulo de punto de venta puede reutilizar el establecimiento fijo por usuario sin una nueva fuente de verdad.
- Los procesos sin persona (sincronización con POS, agentes) usarán el rol de sistema `nexa_sys` (F4) con credencial propia, no el rol de la aplicación.

# Anexo C · Estado de las fases
| Fase | Estado |
|---|---|
| F0 generador por catálogo + prueba de catálogo + sonda por clases | **hecha (local)**: `M-I` genera por catálogo; `prueba-r2-suplantacion.sql` por clases; `identidad_sesion_test.ts` compara el catálogo con la lista del servidor |
| F1 clase C1 (34 funciones `fel_op_*` de empresa) | **hecha (local)**: 34 envoltorios, servidor con `FEL_IDENTIDAD_SESION`, `nexa_app` sin las originales, recorrido completo como `nexa_app` en verde |
| F2 plataforma (C2) · F3 auditoría y previas a la sesión (C3, C5) · F4 `nexa_sys` · F5 Supabase Auth | pendientes |
**R2 NO está cerrado:** la sonda sigue en «abierto» por C2 y C5 (y C3/C4/R1).
