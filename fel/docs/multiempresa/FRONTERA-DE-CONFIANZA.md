# Frontera de confianza de NEXA FEL (arquitectura C) — qué confía en qué y qué pasa si algo se compromete

Estado: **diseño verificado en local**; la parte de infraestructura (funciones separadas, llaves, cabeceras reales) se confirma en `nexa-fel-test`. Este documento fija las fronteras para que nadie las amplíe «por compatibilidad».

## 1. Componentes y credenciales
| Componente | Qué puede hacer | Qué NO tiene | Quién la controla |
|---|---|---|---|
| **Navegador de la persona** | usar su sesión de Supabase Auth (JWT + refresh token) | ninguna credencial de base, ni llave de servicio | la persona |
| **Cloudflare Pages** | servir la web y reenviar peticiones | secretos de base de datos | NEXA |
| **`nexa-api`** (función de personas; hoy `nexa-demo`) | reenviar el **JWT de la persona** a la Data API; resolver Digifact/correo con los servicios propios | tras W5: **ninguna** credencial de base de datos; no monta el protocolo del agente; no conoce `FEL_SYS_*` | NEXA |
| **Supabase Auth** | emitir/revocar sesiones; MFA TOTP; llave de firma (fuera del alcance de NEXA) | — | Supabase |
| **PostgREST (Data API)**, esquema `api` | ejecutar `api.*` con el rol `authenticated` y los claims del JWT verificado | no expone `public`, sistema ni auditoría | Supabase |
| **PostgreSQL** | decide **identidad** (`auth.uid()` + sesión viva + membresía), **MFA** (`aal2` en token y en `auth.sessions`), **permisos**, **alcance** y **empresa** | no cree en `p_actor`/`p_empresa` de nadie | NEXA (migraciones) |
| **`nexa-sys`** (función interna) | credencial `nexa_sys`: solo `EXECUTE` de `fel_sys_*`; `POST /tick` (secreto) y `POST /api/agente/v1/*` (firma de agente) | no tiene tablas ni esquemas; no firma como persona | NEXA |
| **`nexa_app`** (rol heredado de la transición) | las funciones permitidas por lista explícita; con M-P pierde las `fel_sys_*` | no es dueño de nada; sin tablas protegidas | se retira cuando `nexa-api` deje de usar el pooler |
| **Agente local** (equipo del cliente) | firmar peticiones con su clave Ed25519 y operar **solo** sobre su empresa | no tiene credencial de base; no puede crear órdenes ni cambiar su empresa | el cliente |

## 2. Reglas de la frontera (las que las pruebas defienden)
1. **La identidad nunca se afirma desde la aplicación.** `api.*` no recibe `p_sesion`, `p_actor` ni `p_empresa` de empresa; la base los deduce del JWT verificado por PostgREST. La aplicación solo retransmite el token que recibió; no puede acuñarlo (la llave privada no está a su alcance).
2. **Revocación inmediata en la base.** Cada llamada comprueba que `session_id` siga existiendo en `auth.sessions`; cerrar sesión o dar de baja surte efecto en la siguiente llamada aunque el access token no haya vencido.
3. **MFA real.** Las operaciones sensibles y la plataforma exigen `aal2` en el token **y** en la sesión guardada (el token puede estar desactualizado).
4. **Sin JWT no hay base.** Con la Data API activa, toda ruta autenticada sin JWT válido se rechaza antes de tocar nada (probado con un espía: 0 consultas).
5. **Los pasos fiscales del sistema no están en `api`.** Estados de certificación, auditoría y protocolos de máquina viven en el nivel `nexa_sys`: una persona no puede registrar resultados fiscales ni asentar auditoría.
6. **Archivos:** la columna `contenido` no es legible por `authenticated`; la descarga es una RPC con permiso, empresa y alcance verificados.
7. **Parámetros:** solo salen los de la clase «usuario» (o los de empresa/plataforma con permiso/MFA); los umbrales de defensa no salen nunca de la base.

## 3. Frontera del agente local y de `nexa_sys` (riesgo residual declarado)
**Qué verifica cada capa**
| Capa | Verifica |
|---|---|
| `nexa-sys` (TypeScript) | firma Ed25519 sobre `método\nruta\nhora\nnonce\nsha256(cuerpo)` con la clave pública del agente; forma de las cabeceras; tamaño y tipo del cuerpo |
| Base (`fel_sys_agente_*`) | agente existente y activo; desfase de hora (±60 s); nonce de un solo uso; límite de 120 peticiones/min **por agente**; empresa de la orden = empresa del agente; token de la orden (fencing); resultado solo `SIM-`; vinculación: código de un solo uso, 48 bits, caducidad y límite **por origen** (10 fallos/10 min) con freno global de 1 000 |
**Lo que la base NO puede verificar:** la firma. PostgreSQL no valida Ed25519 de forma oficial; recibe el `uuid` del agente que `nexa-sys` ya autenticó.
**Consecuencias si algo se compromete**
| Si se compromete… | Alcance del daño | Qué lo limita |
|---|---|---|
| un **agente** (su clave) | actuar como ese agente, solo en su empresa y sobre sus órdenes vigentes | alcance de empresa y fencing en la base; revocación inmediata; 120 pet./min; resultados solo simulados |
| el equipo de una persona | operar con el JWT de esa persona hasta que se cierre su sesión | permisos efectivos y alcance de establecimiento en la base; MFA para lo sensible; revocación inmediata |
| **`nexa-api`** | retransmitir tokens en vuelo; no puede acuñar identidades ni leer más allá de lo que cada JWT permite | no tiene credencial de base (tras W5); RLS y permisos en la base |
| **`nexa_app`** (credencial heredada) | ejecutar la lista de funciones permitidas con identidad por token de sesión (R1/R2 abiertos hasta W6) | M-P le quita `fel_sys_*`; se retira con `demo_sesiones` |
| **`nexa-sys`** | actuar como **cualquier** agente y ejecutar cualquier `fel_sys_*` (pasos del sistema) | credencial separada, sin tablas, interfaz limitada a `/tick` y al protocolo firmado; es la **frontera residual aceptada**: sus secretos viven solo en esa función |
| la base de datos / `service_role` | todo | fuera del modelo: protegido por Supabase y por el procedimiento de respaldos |
**Decisiones explícitas:** (a) no se verifica la firma dentro de la base; (b) `nexa-sys` es la única función con credencial de sistema; (c) sin rotación automática de claves de agente (se revoca y se vincula de nuevo); (d) la firma de las respuestas del servidor al agente queda opcional (decisión de W5).

## 3.1 Añadidos de la fase 4
- **El servidor verifica el JWT** (ES256/RS256 por JWKS, caché 10 min, cierra si falla) en las rutas que no pasan por la Data API (Digifact, PDF) y exige que `sub` coincida con la persona de la sesión; además comprueba sesión viva por `api.empresa_contexto()`.
- **`nexa-sys` con privilegios mínimos de tabla**: solo las cuatro tablas de servicio; el resto por `fel_sys_*` que reciben la empresa ya verificada. Un servicio (correo, Digifact, almacén, límites) no puede emitir SQL fuera de su lista (cerrojo estructural).
- **Operación:** rotación manual (`ROTACION-DE-CREDENCIALES.md`, con secreto doble sin interrupción para `/tick`) y monitoreo mínimo (`salud` en `/tick`).

## 4. Qué se retira y cuándo
`demo_sesiones`/`demo_credenciales` y el inicio de sesión propio (W6) → cierra R1 y el último uso de `nexa_app` para identidad; con ello `nexa_app` pasa a ser un rol de compatibilidad sin lecturas de empresa. Hasta entonces R1, R2 y R3 permanecen **abiertos**.
