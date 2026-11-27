# Informe de cierre de la etapa de seguridad (fase 3) — validación local

Rama `fel-proveedores-diseno`, desde a71b7b8. Solo local (PostgreSQL temporal, PGlite, emulador de PostgREST con firma de JWT, Chromium de Playwright). No se tocó `nexa-demo`, producción ni otros worktrees; no se activó Resend ni se envió correo; no se certificó nada real; sin clientes reales; el borrador a Digifact no se modificó ni se publicó; sin credenciales ni costos. No se desarrolló NEXA POS (solo se conserva `NEXA-POS-COMPONENTES-REUTILIZABLES.md`).

## 1. Qué se hizo
| Actividad | Resultado |
|---|---|
| 1 · Lecturas restantes de R3 | **M-T**: plan, reporte de consumos, usuarios y las rutas de plataforma (resumen, planes, plan por empresa, bolsón, conciliaciones, verificación de saldos) por RPC `DEFINER` con identidad de Auth y permiso/MFA explícitos; tablas financieras y de plataforma siguen **sin** `SELECT` para `authenticated`. Rutas acopladas a los simuladores y a las cuentas de demostración: 404 con la Data API. |
| 2 · Paginación | **M-U**: `clientes_pagina`/`conceptos_pagina` (RPC) y su equivalente por pooler; `/api/estado` entrega un **conjunto de trabajo** (500 clientes, 1 000 conceptos) con totales. La interfaz cambia a modo servidor **solo** con más de 500 clientes / 200 conceptos; por debajo es idéntica. La factura busca en el servidor al cliente que no está en memoria. |
| 3 · Playwright | **19 de 19** pruebas existentes en Chromium + la nueva `e2e_paginacion.cjs` (agregada al CI). Una mutación de interfaz (volver a la lista completa) se detecta. Firefox y WebKit siguen en el flujo de CI (`fel-navegadores.yml`); aquí solo se dispone de Chromium. |
| 4 · Cobertura | Aplicación **148** (146 + 2 nuevas), proveedores **223**, base de datos **59** (con migraciones solas y con todas las propuestas), multiempresa y rol-app (17 comprobaciones) en verde; guardas de publicación en verde. |
| 5 · Frontera de confianza | `FRONTERA-DE-CONFIANZA.md`: componentes, credenciales, reglas, qué verifica cada capa del agente y qué pasa si algo se compromete (riesgo residual de `nexa-sys` declarado). |
| 6–7 · Secuencia y listas | `SECUENCIA-Y-LISTAS-NEXA-FEL-TEST.md`: orden definitivo de migraciones, verificaciones y reversiones; listas W0, W5, W6 y ensayo 1E. `tools/ensayo-1e.sh` ampliado (M-Q…M-U, pruebas 8h/8i y corte M-P opcional). |
| 8 · Rendimiento | `COMPARACION-RENDIMIENTO-55.md` (procedimiento, escenarios, criterios). Las optimizaciones de #55 no se tocaron. |
Mutaciones de esta fase (todas detectadas): M-T 9/9, paginación 7/7 (una sobrevivía y se cubrió con un caso de persona con dos empresas), interfaz 1/1.

## 2. R1, R2, R3 (compuertas) — sin cierres globales
- **R1 abierto:** `demo_sesiones` existe; se cierra en W6.
- **R2 cerrado solo en local por clases;** pendiente el ensayo hospedado y el retiro de `demo_sesiones`.
- **R3 abierto.** Con la Data API: toda ruta autenticada sin JWT se rechaza antes de tocar la base (0 consultas, probado) y las pantallas migradas no usan el pooler. **Quedan por migrar** (desarrollo local, no hospedado; ver `RIESGO-RESIDUAL-R3.md`): lecturas pequeñas de `/api/estado` y `/api/configuracion` (permisos, empresa, canales), las pre-lecturas de validación dentro de los flujos de escritura de documentos, Digifact, correo y el almacén de Digifact.

## 3. Lista definitiva de bloqueos que requieren EXCLUSIVAMENTE el proyecto hospedado
### 3.1 Indispensables para el lanzamiento
| # | Bloqueo | Por qué solo se puede en hospedado |
|---|---|---|
| H1 | **W0:** llaves de firma asimétricas en Free y JWKS; vida mínima del access token; claims exactos (`sub, role, aal, session_id`) | depende de Supabase real |
| H2 | **`auth.sessions` desde función `DEFINER`; `aal` pasa a `aal2` tras TOTP; cerrar sesión elimina la fila** | es el supuesto de `fel__sesion_viva`/`fel__aal2`; el local usa un *shim* |
| H3 | **Ensayo 1E** completo (M-D…M-U y M-E) por el pooler real, con `nexa_app` y `nexa_sys` (formato de usuario del pooler, `create role`, `SET ROLE` del administrador, duración y bloqueos de las migraciones) | solo el proyecto real revela diferencias con PostgreSQL local |
| H4 | **Data API:** esquema expuesto = solo `api`, `anon` sin privilegios, llamada anónima 401, perfil `public` 406 | configuración de PostgREST/Supabase |
| H5 | **W5:** `nexa-api` sin credencial de base y `nexa-sys` desplegada (`FEL_SYS_BD_URL`, `FEL_SYS_SECRETO`, `FEL_AGENTE_EN_SISTEMA=1`); ruta real que ve la función; **cabecera de origen** fiable para M-Q; cambio de URL de los agentes | despliegue de funciones Edge |
| H6 | **Aplicar M-P** (corte) tras comprobar el agente de prueba por `nexa-sys` | depende de H5 |
| H7 | **W6:** inicio de sesión por Supabase Auth con TOTP; retiro de `demo_sesiones`/`demo_credenciales`; **sonda R1 «rechazada»** y R2 «cerrado» | Auth real; cierra R1 |
| H8 | **Comparación de rendimiento contra #55** (A pooler vs B Data API; 3 volúmenes; frío y caliente) y decisión híbrida si B incumple | red y región reales |
| H9 | **Reversión ensayada** (orden U→T→S→R→Q→P, luego M-M-N-O y general) y restauración desde copia | solo valida el procedimiento en el motor real |
### 3.2 Pueden hacerse después del lanzamiento (mejoras)
| # | Mejora | Nota |
|---|---|---|
| P1 | Rotación automática de claves de agente | hoy: revocar y vincular de nuevo |
| P2 | Firma de las respuestas del servidor al agente en `nexa-sys` | opcional (decisión de W5) |
| P3 | Programación y monitoreo del `tick`, alertas de fallos de `nexa-sys` | operación |
| P4 | Paginar por completo las listas históricas largas de clientes en la pantalla de factura (hoy: conjunto de trabajo + búsqueda) | UX |
| P5 | Respaldo a almacenamiento externo (fase 2 documentada) y pruebas de carga extendidas | costo/infraestructura |
| P6 | Ejecución de Firefox/WebKit contra el proyecto hospedado | ya corren en CI contra la demo local |
| P7 | NEXA POS, inventarios y Hotel (componentes reutilizables ya documentados) | fuera de esta etapa |

### 3.3 Pendiente de desarrollo LOCAL antes del lanzamiento (no requiere el hospedado)
Cerrar §3 y §4 de `RIESGO-RESIDUAL-R3.md` (RPC de contexto de pantalla y de configuración; mover las pre-lecturas a `fel_op_*`/RPC; pasos de Digifact/correo/almacén al nivel `nexa_sys`) y regenerar el inventario. Sin ello R3 no puede declararse cerrado aunque el hospedado esté listo.

## 4. Riesgos que persisten
1. `nexa-sys` comprometido equivale a todos los agentes (frontera residual aceptada, acotada a esa función).
2. La firma del agente no se verifica en la base (por diseño; ver `FRONTERA-DE-CONFIANZA.md`).
3. Con el estado de sesión anterior a una siembra masiva, la pantalla de clientes usa una vez la lista completa hasta recargar (sin impacto funcional).
4. Las mediciones locales no son contra #55 ni incluyen red.
