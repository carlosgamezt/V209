# Plan exacto para aplicar la migración 29 en `nexa-demo` (NO ejecutado; cada paso con su propia autorización)

Todo se hace con el flujo manual **«NEXA FEL · solo migraciones (manual, por etapas)»** (`migraciones-nube.yml`), rama `fel-proveedores-diseno`, entorno protegido `demo-privada` (aprobación humana en cada ejecución). El flujo **no despliega función, no publica el frontend, no carga secretos de función, no toca Cloudflare**.

## 0. Antes de empezar (condiciones)
- Los cambios de esta preparación están en la rama (commit autorizado por ti) y **los tres flujos del CI pasaron**.
- `nexa-demo` tiene las 28 migraciones registradas (según la documentación: etapas 1 y 2 aplicadas el 14/11/2026). Se **comprueba**, no se supone (paso 1).

## 1. Verificar el proyecto y el estado (solo lectura)
`accion = verificar-etapa` · `etapa = 2` → debe terminar «VERIFICACIÓN DE LA ETAPA 2: OK» (28 registradas, 67 tablas con RLS, catálogo de la 28). Destino fijo: el script solo opera sobre la referencia de `nexa-demo` y su URL derivada del pooler. **Si falla, no se continúa.**

Lectura del **rol efectivo** y de los **requisitos de la 29** (solo lectura, sin cadena de conexión ni contraseña): `verificar-etapa` etapa 2 muestra «INFO rol efectivo de la conexión» (usuario, superusuario, omite RLS, propietario de `public.documentos`, puede crear en `public`) y «INFO alcance del rol», y comprueba «requisitos de la migración 29» (28 registradas, 29 ausente, `fel__fiscal_cambiar`, `fel_auditar`, unicidad `(id, empresa_id)`, roles y propietario). Si falta algo, **FALLA** y lo nombra: no se aplica la etapa 3.

## 2. Inventario previo y respaldo
> Respaldo y recuperación, con el estado real y las condiciones para autorizar la etapa 3: **`RESPALDO-Y-RECUPERACION-29.md`** (lo que sigue es el resumen original).

- El **inventario** (tablas | políticas | funciones | disparadores | empresas | documentos) lo imprime la propia etapa 3 antes de tocar nada (solo lectura). Esperado: `67 | 49 | 182 | 59 | N | M`. Guárdalo.
- **Respaldo** (lo haces tú; yo no puedo verlo ni confirmar el plan de Supabase del proyecto): panel de Supabase → *Database → Backups* (copia diaria o punto en el tiempo, según el plan) y, además, un volcado lógico del esquema `public` hecho por ti. Anota la **hora de Guatemala** del respaldo. `nexa-demo` solo tiene datos simulados de demostración y los usuarios de Auth se recrean con `aprovisionar` (idempotente).

## 3. Aplicar la etapa 3 (escribe en la base)
`accion = migraciones-etapa` · `etapa = 3` · `confirmar = APLICAR-MIGRACIONES` (+ aprobación en `demo-privada`).
El script, **antes de tocar nada** y en solo lectura: exige EXACTAMENTE las 28 registradas, la 29 **ausente** (ni tablas ni funciones), el **catálogo de la 28 sano** y muestra el inventario y el rol de la conexión. Después aplica **solo** la 29 (carpeta temporal con las 29, la CLI empuja la pendiente), corre `verificacion-posterior-29.sql` (solo lectura) y **se detiene**. Si cualquier precondición falla: no se hace nada (código 2).

## 4. Verificación posterior independiente (solo lectura)
`accion = verificar-etapa` · `etapa = 3` → «OK»: 29 registradas, **69 tablas** con RLS, 49 políticas, **185 funciones**, **61 disparadores**, privilegios (nadie salvo el propietario), claves foráneas compuestas, índices contra duplicados, y las garantías de la 28 intactas.

## 5. Qué cambia para la aplicación al aplicar la 29
Nada visible: la certificación sigue **apagada** (`FEL_DIGIFACT_TEST` sin definir). La función, al arrancar, detecta las tablas y usará el almacén persistente **solo si** se habilita la certificación en una publicación posterior. No hay despliegue en esta etapa.

## 6. Antes de habilitar la certificación desde la aplicación (autorización aparte)
1. **Publicación** (`publicar-nube`, modo publicar) con `digifact = habilitado`, `digifact_referencia` = UNA referencia autorizada y, si se quiere, `digifact_correo = habilitado` + empresa + lista cerrada.
2. **Chequeo previo de Digifact:** el 21/11/2026 la consulta por referencia del flujo manual (solo lectura) respondió «no encontrada» antes de certificar, para la fecha de ese día. Para fechas pasadas no se ha comprobado la forma de la respuesta: antes de habilitar, hacer una consulta real **de solo lectura** de una fecha pasada y confirmar que responde igual; si Digifact respondiera algo distinto, el sistema se niega a enviar (falla cerrado), nunca envía de más.
3. Primera certificación desde la app: una sola, con referencia nueva, buzón propio y verificación en el buzón, como la prueba del 21/11/2026.
4. Actualizar el texto del panel (hoy dice que el resultado real no cambia el documento ni guarda archivos) para que refleje el almacén persistente.

5. **Clientes reales: NO.** Antes hay que resolver el rol propietario de la conexión (`SEGURIDAD-Y-PERMISOS-29.md`, «Condición bloqueante») y reevaluar el límite de siete días del chequeo previo (`RECUPERACION-Y-CONCILIACION.md`).

## 7. Qué es reversible y qué no
| Operación | ¿Reversible? | Cómo |
|---|---|---|
| Verificaciones (pasos 1, 4) | no cambian nada | — |
| Aplicar la 29 **sin datos** en las tablas | **Sí** | `docs/migracion-29/reversion-29.sql` (propietario, con tu autorización) + `supabase migration repair --status reverted 20261114000100`; el esquema vuelve a 67/182/59 y la 28 vuelve a verificar (probado) |
| Aplicar la 29 **con** operaciones o artefactos | **No se revierte** (la reversión se rechaza) | corregir hacia adelante, o restaurar el respaldo **y conciliar** (`RECUPERACION-Y-CONCILIACION.md`) |
| Una certificación hecha en Digifact (TEST) | **Irreversible** (la anulación está cerrada; restaurar Supabase no la deshace) | conciliar; nunca recertificar |
| Un correo ya enviado por Digifact | **Irreversible** | — |
| Restaurar un respaldo anterior a una certificación | **Peligroso** sin conciliar | el chequeo previo impide la 2.ª certificación (probado), pero hay que conciliar |

## 8. Cortes inmediatos (kill-switches)
Rechazar la aprobación de `demo-privada` o cancelar la ejecución (antes del paso 3 no pasa nada) · `publicar-nube` con `digifact = apagado` retira de verdad los secretos de Digifact de la función · sin `FEL_DIGIFACT_AUTORIZA_REFERENCIA` el servicio no envía ninguna referencia · `FEL_DIGIFACT_CORREO` apagado por defecto y se retira al apagarlo.
