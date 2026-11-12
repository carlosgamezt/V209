# NEXA FEL · preparación de producción (sin habilitar nada real)

Estado: **todo lo fiscal y de pagos permanece bloqueado**. Este documento dice qué está listo, qué se enciende y con qué candados.

## 1. Piezas y dónde viven
| Pieza | Producción prevista | Estado |
|---|---|---|
| Base de datos + RLS + funciones | Supabase (Postgres). Las migraciones de `fel/supabase/migrations` se aplican tal cual | lista, probada en CI contra Supabase local real |
| API (`fel-api`) | Supabase Edge Function (Deno) | lista, con pruebas de integración |
| Interfaz | Cloudflare Pages (estáticos) + Auth de Supabase (MFA para el maestro) | la demostración usa un servidor propio y cuentas ficticias; **no** es la interfaz de producción |
| Certificador | `EmissionProvider` → `DigifactProvider` (adaptador) | **solo simulador**; contrato HTTP real pendiente de documentación oficial |
| Pagos | pasarela a elegir | **no existe**; el único medio es `simulado` |

## 2. Candados que deben seguir cerrados hasta autorización expresa
1. `proveedores_emision`: Digifact solo habilitado en ambiente `simulado` (restricción de tabla). Abrir `pruebas` o `produccion` exige una migración nueva y autorización.
2. `empresas.emision_real_habilitada = false` (interruptor por empresa, auditado) y el interruptor de plataforma de emisión real.
3. Cuentas del bolsón de `produccion`: tres cerrojos independientes (proveedor habilitado, ambiente permitido, interruptor).
4. `pagos.medio = 'simulado'` (restricción de tabla). Una pasarela real requiere migración y revisión de seguridad.
5. Los artefactos y autorizaciones simulados llevan el prefijo `SIM-`; la base rechaza mezclarlos con ambientes reales.

## 3. Secretos (solo del lado del servidor; nunca en el navegador ni en el repositorio)
Nombres previstos (sin valores): `DIGIFACT_USUARIO`, `DIGIFACT_CLAVE`, `DIGIFACT_URL_BASE` (Edge Function secrets de Supabase), `SUPABASE_SERVICE_ROLE_KEY` (solo Edge Function). El código del adaptador recibe las credenciales por inyección y no las escribe en logs ni respuestas (hay prueba de que el cuerpo de certificación no las contiene).

## 4. Lista antes de producción (riesgos reales)
1. **Fiscal:** IVA, redondeo, plazos de anulación y reglas por régimen siguen sin fuente oficial verificada (V1–V12): hoy la factura calcula base imponible, **no impuestos ni total**.
2. **Certificador:** sin documentación ni acceso a TEST, el adaptador real no existe; el riesgo es que el contrato real difiera del hipotético (autenticación, idempotencia, respuestas, errores, consumos).
3. **Autenticación:** la demostración usa contraseñas ficticias y TOTP de juguete; producción debe usar Supabase Auth con MFA obligatoria (aal2) para el maestro y políticas de recuperación.
4. **Bolsón y conciliación:** las reglas de consumo por evento son hipótesis conservadoras (todo evento desconocido consume); deben confirmarse con el proveedor.
5. **Pagos:** inexistentes; sin pasarela no hay cobro automático ni conciliación bancaria.
6. **Operación:** respaldo/restauración, monitoreo, límites de tasa, retención de PDF/XML, política de privacidad y términos, y un entorno de staging separado.
7. **Pruebas pendientes:** navegadores reales (WebKit/Firefox, teléfono físico), carga, pruebas de penetración.

## 5. Cambiar de certificador sin reconstruir
Un certificador nuevo implementa `EmissionProvider` (+ `ProveedorAnulacion` si anula) y se registra con un `id` en `proveedores_emision`; el orquestador, la cobertura (bolsón + monedero), la conciliación de estados desconocidos y la interfaz no cambian. `ProveedorEnrutado` ya concilia cada operación con SU proveedor.
