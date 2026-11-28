# NEXA CORE · auditoría de compatibilidad (28-nov-2026)
## 0. Fuentes de las decisiones
No existe en el repositorio ni en el historial de esta sesión un registro rotulado «NEXA CORE». Se recuperaron y respetaron las decisiones aprobadas más cercanas: **arquitectura multiempresa de NEXA FEL (Arquitectura C aprobada)** — Supabase Auth, Data API/RPC con JWT, `empresa_id` y membresías, plataforma sin membresías con aal2, sesión viva, procesos internos separados (`nexa_sys`), auditoría — el **principio 13 del estándar** (módulos independientes; núcleo común consultado por API estable; sin tablas compartidas) y los objetivos del mensaje de inicio de CORE. Si existe otro documento de decisiones de CORE, hay que incorporarlo (las diferencias se resuelven en `ARQUITECTURA.md`).
## 1. Qué existe hoy
| Sistema | Identidad y permisos hoy | Compatibilidad con CORE |
|---|---|---|
| NEXA v517 (proyecto «pa carlos») | Supabase Auth con correo `usuario@planes.sistegua.com`; `pa_profiles` (auth_id, user_id, role, region, branch, assigned); roles de fábrica + roles editables (`cfg.roles`); una sola organización (sin empresas); `super-api` administra usuarios | **Intacto.** Se incorporará como módulo `nexa` mediante un puente futuro (D5). Manifiesto borrador en `manifiestos/nexa.json` |
| NEXA FEL (Supabase independiente) | `empresas`, `perfiles`, `miembros` (rol + permisos extra/revocados), `invitaciones`, `permisos_catalogo`/`rol_permisos`, `auditoria`, `plataforma_parametros`; sesión viva y aal2; esquema `api`; `nexa_sys` | **Intacto.** CORE generaliza el mismo modelo: empresa↔`core.empresas`; `miembros.rol`↔`core.roles` del módulo `fel`; permisos extra/revocados↔`core.membresia_permisos`; invitaciones↔`core.invitaciones`; plataforma↔`core.plataforma_admins` con aal2 |
## 2. Qué se reutiliza y qué no se duplica
Se reutilizan **patrones** probados de FEL (identidad por `auth.uid()` + sesión viva + aal2, esquema `api` de funciones DEFINER con `search_path` vacío, permisos efectivos = rol + extras − revocados, auditoría, parámetros de plataforma, verificador JWT ES256/RS256 por JWKS para el pase de módulo). **No se copia código ni se toca la rama FEL.** Lo nuevo y propio de CORE: varios módulos por empresa, planes/suscripciones, activación y aprovisionamiento, eventos, manifiestos.
## 3. Estándar obligatorio aplicado
Autorización por recurso (permiso por empresa+módulo en cada función; sin acceso directo a tablas); `anon` sin privilegios; RLS en todo; funciones DEFINER con `search_path` fijo y privilegios mínimos por rol (`authenticated` solo `api.*`; módulos solo `core_sys.*`); auditoría solo-añadir; secretos fuera del repositorio; activación progresiva (registro público apagado por omisión, módulos solo tras aprovisionar, MFA de plataforma parametrizable); consumo: API mínima y paginada por clave, contadores en SQL, eventos incrementales con retención (sin sondeo), contexto de empresa a pedido del módulo; pruebas locales + mutaciones + reversión.
## 4. Riesgos detectados
1. **Cuota gratuita:** el plan gratuito permite 2 proyectos activos; CORE sería el tercero (FEL independiente + NEXA). Sin decisión de costo no se crea el proyecto (D1).
2. **Autenticación entre proyectos:** los módulos viven en otros proyectos; no pueden validar por sí solos una sesión de CORE (D2).
3. **Doble fuente de identidad** mientras NEXA y FEL no migren: se mitiga con el puente y con que CORE nunca borra ni modifica proyectos existentes.
4. **Egress/consumo:** cada llamada de un módulo a CORE cuesta; el diseño exige pases de módulo con permisos en el token (una consulta por sesión, no por petición) y eventos incrementales.
## 5. Decisiones pendientes (no bloquean el desarrollo local)
| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Proyecto de Supabase de CORE (`nexa-core`) y su costo | Pro (~10 USD por proyecto Micro adicional) / pausar otro proyecto / seguir solo local | Seguir local hasta cerrar D2; crear el proyecto cuando se autorice el costo |
| D2 | Cómo un módulo reconoce a la persona | (a) Third-Party Auth de Supabase con JWKS de CORE; (b) **pase de módulo**: función de CORE firma un JWT corto (5–15 min) con `sub`, `empresa`, `modulo`, `permisos` y el módulo lo verifica por JWKS (patrón ya usado en FEL); (c) un solo proyecto (descartado: sin aislamiento) | (b) |
| D3 | Cobro recurrente | Sin cobro (solo definición) / pasarela / facturar con NEXA FEL | Fuera de CORE hasta decidir; CORE ya bloquea módulos al vencer (con gracia) |
| D4 | Planes y precios reales | — | Se definen con `api.pla_plan_definir`; no hay datos comerciales sembrados |
| D5 | Puente NEXA v517 → módulo `nexa` | Migrar usuarios / sincronizar / mantener separado | Después de D1–D2 |
| D6 | Panel maestro: diseño y hospedaje | Cloudflare Pages (proyecto propio) | La API ya cubre todas las pantallas; la interfaz se construye con el diseño de NEXA |
| D7 | Credencial de los módulos hacia `core_sys` | JWT con `role=core_worker` + `modulo` emitido por función de CORE / un rol de Postgres por módulo | JWT por módulo con rotación |
