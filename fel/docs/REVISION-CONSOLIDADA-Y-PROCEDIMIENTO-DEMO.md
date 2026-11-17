# NEXA FEL · Revisión consolidada de migraciones pendientes y procedimiento para habilitar la URL de demostración
Estado a 17/11/2026. **Nada de esto se ha ejecutado.** Destino único: `nexa-demo` (Supabase, vacío, 0 migraciones).

## 1. Migraciones pendientes (28 aprobadas para aplicar + 1 propuesta)
| Bloque | Archivos | Qué hace | Riesgo |
|---|---|---|---|
| **Etapa 1 · 1–10** (Fase 1.x) | `…110000100` a `…110001000` | Estructura base (67 tablas, todas con RLS), funciones atómicas, permisos, clientes/conceptos, documentos y operaciones, límites de seguridad, perfil, MFA de administradores, usuarios y recuperación, revocación de sesiones | Bajo: aditivo en base vacía. Única acción a nivel de esquema: `alter default privileges in schema public revoke all … from anon, authenticated` |
| **Etapa 1 · 11–17** (Fase 2 y 4) | `…111000100` a `…111000700` | Flujo de facturación simulado, ajustes de empresa, agente local (órdenes, firma, confirmación humana, transporte remoto) | Bajo |
| **Etapa 1 · 18–24** (D2/D3) | `…112000100` a `…112000700` | Bolsón global, consumos, Digifact **simulado**, capa comercial (pagos simulados), cobertura, conciliación, multiproveedor | Bajo: solo `simulado`; producción y TEST cerrados por tabla |
| **Etapa 1 · 25–27** (demo) | `…112000800` a `…112001000` | Persistencia de la demostración (credenciales con PBKDF2, sesiones por hash, límites) | Medio-bajo: tablas `demo_*` solo para la demo; **no deben ir a producción** |
| **Etapa 2 · 28** | `…113000100` | Endurecimiento: las empresas no se borran ni se vacían, `service_role` pierde DELETE/TRUNCATE, disparadores sin EXECUTE, FK compuesta en `ordenes_confirmaciones` | Bajo; idempotente, con comprobación final; reversión probada |
| **Propuesta 29** (no está en `supabase/migrations`) | `docs/migracion-29/…114000100` | Tablas `digifact_operaciones` (una sola operación que bloquea por documento, autorización única por empresa, identidad inmutable, transiciones válidas) y `digifact_artefactos` (XML/PDF reales, solo inserción) y la función `fel_sys_digifact_aplicar` (aplica la certificación al documento); RLS cerrado, sin privilegios para `anon`/`authenticated`; solo `service_role` ejecuta la función | Bajo; **probada contra PostgreSQL real** (25 envíos simultáneos → uno; un timeout deja la operación bloqueada) |
Resultados esperados tras 1–28: 67 tablas / 67 con RLS, 182 funciones, 49 políticas, 57 disparadores, `empresas = 0`; con la 29: 69 tablas / 69 con RLS (operaciones y artefactos) y 183 funciones.

**Orden obligatorio:** `verificar-inicial` (0 REVISAR) → etapa 1 → V1 → etapa 2 → V2 → (si se aprueba) 29 como etapa 3. Cada etapa con su aprobación y la confirmación `APLICAR-MIGRACIONES`.

## 2. Qué habría que cambiar si se adopta la 29 (código, sin ejecutar)
1. Copiar la 29 a `supabase/migrations` (con su prueba SQL `29_*.sql`).
2. `tools/supabase-hospedado.sh`: añadir la etapa 3 (`HASTA=20261114000100`, `ESPERADAS=29`) y la guarda «exactamente las 28»; `verificar-etapa 3` con el catálogo de la 29.
3. Actualizar los contadores fijos: `test-local.sh`, `test-plataforma-ensure-rls.sh` (28→29 migraciones y suites, 67→68 tablas), y las guardas de `verificar-publicacion.py`.
4. Cadena de la demo: `publicar-nube.sh` aplicaría las 29 de una vez si no están aplicadas → siempre migrar por etapas **antes**.

## 3. Comprobaciones de aislamiento (verificadas en el código, no en la nube)
| Garantía | Evidencia |
|---|---|
| No modifica `main` ni NEXA principal | Los flujos de despliegue de NEXA (`deploy-nexa`, `deploy-supabase`) solo se activan con push a `main`; los flujos de FEL son solo manuales y exigen `ref == fel-proveedores-diseno` |
| Aprobación humana y entorno aislado | `publicar-nube.yml` y `migraciones-nube.yml`: entorno protegido `demo-privada`; secretos con prefijo `DEMO_` que nunca se mezclan con los de NEXA |
| Sin credenciales fiscales reales | `publicar-nube.sh` **no menciona Digifact** (no transmite ninguna credencial); el cliente de Digifact lanza «Producción está bloqueada» si el ambiente no es `test`; el servidor lo apaga por defecto (`FEL_DIGIFACT_TEST` ausente) |
| Sin certificación real | Todo el flujo de la demo usa proveedores `simulado`; `emision_real_disponible=false`; sin almacén persistente Digifact **no envía** |
| Base exclusiva | El servidor se niega a funcionar sobre una base con empresas que no son de la demo (marca `demo_entorno`) |

## 4. Procedimiento para habilitar la URL de demostración (quedan preparados; ejecuta cada paso solo con tu autorización)
**A. Sin nube (disponible hoy):** paquete ZIP de `fel-paquete` (#29 del commit `ec00067`) + `GUIA-PRIMERA-SESION.md`. PC y teléfono por Wi-Fi.
**B. Nube privada con HTTPS (`https://<DEMO_PAGES_PROYECTO>.pages.dev`):**
1. Confirmar que existen los 12 secretos `DEMO_*` (lista en `PREPARACION-DEMO-NUBE.md` §4). Yo no puedo verlos: lo confirma `publicar-nube` modo `verificar`, que no toca nada.
2. `migraciones-nube` · `verificar-inicial` → debe dar 0 REVISAR.
3. `migraciones-etapa 1` (`APLICAR-MIGRACIONES`) → V1 → `migraciones-etapa 2` → V2.
4. `publicar-nube` modo `verificar` y luego `publicar` (`PUBLICAR`); sube la función y la página y corre la prueba de humo.
5. Verificar con `nube/prueba_humo.ts` (estado 200, login, API con sesión). **Solo entonces** se entrega la URL.
6. Abrir en el teléfono Android (Chrome) y en la PC; seguir `GUIA-PRIMERA-SESION.md`. Contraseñas: las de `DEMO_CLAVES` (generadas con `generar_secretos.ts`, guardadas por ti; nunca en el chat).
**Para Digifact TEST en la nube** (después de lo anterior): 29 como etapa 3, secretos `FEL_DIGIFACT_*` en la función y cambio de `publicar-nube.sh`, autorización de cada referencia, y el código pendiente: propagar el resultado al documento y guardar XML/PDF reales.

## 5. Bloqueos reales
Todos son autorizaciones tuyas: #8 (vault), etapas 1 y 2, decisión sobre la 29, secretos/`publicar`. Ningún bloqueo técnico impide las pruebas locales de hoy.
