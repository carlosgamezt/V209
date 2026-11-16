# NEXA FEL · Evaluación de riesgos y plan de ejecución de la ETAPA 1 (migraciones 1–27 en `nexa-demo`)

**PROPUESTA. Nada de esto se ha ejecutado. No se aplica ninguna migración sin tu aprobación expresa.** Destino único: `nexa-demo` (PostgreSQL 17.11, plan Free, vacía, sin historial). La migración 28 (etapa 2) queda fuera de este documento.

## 1. Estado de partida verificado
- `verificar-inicial` #7: **0 REVISAR** (base vacía, sin historial, roles y dependencias de Auth correctos, `rls_auto_enable()` reconocida por huella SHA-256).
- `diagnostico-inicial` #5: Vault con `service_role` privilegiado (no se usa Vault; ninguna migración 1–27 lo toca).
- `verificar-api-vault` #8: **pendiente de tu aprobación** (no condiciona la etapa 1 técnicamente; sí conviene conocer su resultado antes de decidir).

## 2. Qué hace la etapa 1 (probado en una base local con la función de plataforma real y su disparador)
| Resultado esperado | Valor |
|---|---|
| Migraciones registradas | 27 |
| Tablas en `public` / con RLS | 67 / 67 |
| Funciones propias | 182 |
| Políticas RLS | 49 |
| Disparadores | 57 |
| `anon`: privilegios sobre tablas | 0 |
| Funciones ejecutables por `authenticated` | solo `fel_es_admin_plataforma`, `fel_es_miembro`, `fel_tiene_permiso` |
| Filas de datos tras aplicar | `empresas` = **0** (confirmado en una ejecución limpia; la «1» vista antes provenía de la base de pruebas reutilizada, no de las migraciones) |
| Semillas «falla cerrado» | `emision_real_disponible=false`; proveedores solo `simulado`; regímenes `sin_verificar` |
Los números se comprobarán de nuevo en la verificación automática V1 (solo lectura) al terminar.

## 3. Riesgos
| # | Riesgo | Prob. | Impacto | Mitigación / decisión |
|---|---|---|---|---|
| R1 | La migración 3 ejecuta `alter default privileges in schema public revoke all … from anon, authenticated`: único efecto a nivel de esquema; afecta a objetos futuros creados por `postgres` | Segura (intencional) | Medio | Es la intención de diseño. Cualquier tabla futura creada fuera de migraciones no será accesible a `anon`/`authenticated` hasta otorgar permisos explícitos. Se documenta aquí |
| R2 | Ventana hasta la etapa 2: `service_role` conserva DELETE/TRUNCATE en 17 tablas (hallazgo M1 de la auditoría; lo corrige la migración 28) | Segura mientras dure | Medio-bajo (base vacía y simulada, sin datos reales) | Ejecutar la etapa 2 **inmediatamente después** de V1, con su propia aprobación; no cargar datos entre ambas |
| R3 | Una migración falla a mitad: no está comprobado si la CLI envuelve cada archivo en una transacción | Baja (27/27 aplican en 3 bases locales, PG16 y PG17 de CI) | Medio | La CLI se detiene en el primer fallo; no reintentar a ciegas; correr `verificar-etapa 1` y leer el estado; ver §5 |
| R4 | Diferencias entre PG local (16) y hospedado (17.11) | Baja | Bajo | CI usa PG17 con Supabase local y pasa; la etapa 1 solo usa SQL estándar |
| R5 | Disparador de plataforma `ensure_rls` interfiere | Muy baja | Bajo | Probado con la definición exacta: 27/27 aplican, 67/67 con RLS, 28 suites |
| R6 | Plan Free: pausa por inactividad y copias de seguridad limitadas | Media | Bajo (base reproducible) | Documentado; recrear desde migraciones. **A verificar:** copias del plan Free |
| R7 | Restauración a «vacía» sin romper la plataforma | — | Medio | Ver §5: nunca `drop schema public cascade` (borraría `rls_auto_enable`); usar un script de limpieza que conserve esa función y limpie `supabase_migrations.schema_migrations` — **no está escrito ni probado todavía; se preparará solo si lo pides** |
| R8 | Las migraciones `demo_*` son parte de las 27 | Cierta | Bajo en demo / **relevante en producción** | Recordatorio para el futuro: las de demostración no deben ir a producción |
| R9 | Confusión de destino (otro proyecto) | Muy baja | Alto | El script exige referencia `sbmchmknfercbtziwrge` y base vacía; se niega sin llamar a la CLI si no coincide |
| R10 | Exposición de `vault` por la API (pendiente #8) | Desconocida | Medio | No condiciona la etapa 1; informará `verificar-api-vault` |
| R11 | Fiscal: ninguna migración activa emisión real ni credenciales | — | — | Todo permanece `simulado`; certificaciones Digifact bloqueadas; sin migración 29 |

## 4. Plan de ejecución (cada paso con su aprobación; nada se ejecuta ahora)
1. **Previo:** resultado de `verificar-api-vault` (#8) entregado y entendido; tu autorización escrita de la etapa 1.
2. **Ejecución:** lanzar `migraciones-nube` con `accion=migraciones-etapa`, `etapa=1`, `confirmar=APLICAR-MIGRACIONES`; tú apruebas en `demo-privada`. Concurrencia: una sola ejecución.
3. **Durante:** el script revalida (referencia, base vacía, sin historial) → carpeta temporal con solo las 27 → `supabase db push` acotado → **V1 automática (solo lectura)**.
4. **V1 debe mostrar:** 27 registradas; 67 tablas con RLS; dependencias de Auth sin faltantes; 0 filas en datos. Se detiene.
5. **Entrego** el resultado exacto (sin secretos) y espero tu decisión sobre la etapa 2.

## 5. Si algo falla
| Situación | Acción |
|---|---|
| Precondición no cumplida | Se niega sin llamar a la CLI; se corrige y se repite |
| Falla una migración | Detener; `verificar-etapa 1` (solo lectura); informar qué quedó aplicado; decidir con tu autorización: corrección hacia adelante o vuelta a base vacía |
| Falla V1 | Flujo en rojo; no se avanza a la etapa 2 |
| Necesidad de volver a vacía | Solo con tu autorización y con un script que **conserve** `rls_auto_enable` y el disparador `ensure_rls`, y borre las filas de `supabase_migrations.schema_migrations` (a preparar y probar antes) |

## 6. Recomendación
Técnicamente la etapa 1 está lista y el riesgo es bajo (base vacía, simulada, reproducible). Condiciones para autorizarla: (a) tener el resultado de #8; (b) aceptar la ventana R2 y planificar la etapa 2 inmediatamente después; (c) decidir si quieres antes el script de limpieza (R7). **Espero tu aprobación expresa.**
