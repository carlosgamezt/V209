# NEXA FEL · Lista definitiva y ordenada de operaciones para habilitar la demostración en la nube
Estado: 17/11/2026. **Nada de lo remoto se ha ejecutado.** Cada paso remoto necesita tu autorización expresa y se ejecuta de uno en uno; después de cada uno se entrega el resultado y se espera tu decisión. Emisión fiscal de producción: bloqueada en todo el recorrido (el cliente rechaza producción, `emision_real_disponible=false`, todo `simulado` salvo la prueba TEST de la fase D).

Criterios generales para DETENER todo (cualquiera basta): ver `migracion-28/PROPUESTA-FINAL-APLICACION-SEGURA.md` §3. Resumen: un resultado distinto de «0 REVISAR», una verificación que no da exactamente lo esperado, un commit distinto del aprobado, una referencia de proyecto que no sea `nexa-demo`, una credencial visible en cualquier registro, o un hallazgo nuevo sin explicar.

## Fase 0 · Repositorio (sin nube)
| # | Operación | Tipo | Autorización | Resultado esperado |
|---|---|---|---|---|
| 0.1 | Subir a `fel-proveedores-diseno` el arreglo de la prueba horaria (`923ec9c`) y la guarda de la migración 29 (commit nuevo) | `git push` a la rama de trabajo | **Sí** (push) | `fel-tests` en verde, incluidos los dos trabajos que fallaron por el puerto del ejecutor y por la prueba del minuto 0 |

## Fase A · Verificaciones de solo lectura de `nexa-demo` (no cambian nada)
| # | Operación | Cómo | Autorización | Se detiene si |
|---|---|---|---|---|
| A1 | Resultado de `verificar-api-vault` (#8): ¿expone la API el esquema `vault`? | Aprobar la ejecución #8 en `demo-privada` (ya está en espera). Antes, crear `DEMO_SUPABASE_ANON_KEY` si falta (clave **pública** `anon`/`sb_publishable_…`, nunca `service_role`) | **Sí** (aprobación en `demo-privada`; secreto si falta) | `REVISAR` (vault expuesto) o `NO VERIFICADO` sin explicación aceptada |
| A2 | `verificar-inicial` inmediatamente antes de migrar | `migraciones-nube` · `accion=verificar-inicial` | **Sí** (aprobación en `demo-privada`) | Cualquier `REVISAR` o huella de `rls_auto_enable` distinta |

## Fase B · Esquema en `nexa-demo` (primera operación que MODIFICA algo)
| # | Operación | Cómo | Autorización | Verificación / parada |
|---|---|---|---|---|
| B1 | Etapa 1: migraciones 1–27 | `migraciones-nube` · `migraciones-etapa` · `etapa=1` · `confirmar=APLICAR-MIGRACIONES` | **Sí, específica** | V1 automática (solo lectura): 27 registradas, 67 tablas con RLS, dependencias de Auth sin faltantes, 0 filas. Si falla: no se sigue |
| B2 | Etapa 2: migración 28 (endurecimiento) **justo después de V1**, sin cargar datos entre ambas | mismo flujo, `etapa=2` | **Sí, específica** | V2: 28 registradas, catálogo de la 28 correcto, `service_role` sin DELETE/TRUNCATE |
Recuperación si algo sale mal (sin script destructivo): crear un proyecto Supabase nuevo y descartar el anterior (ver `PROPUESTA-FINAL-APLICACION-SEGURA.md` §1).

## Fase C · Demostración simulada en HTTPS (Supabase + Cloudflare Pages)
| # | Operación | Cómo | Autorización | Verificación |
|---|---|---|---|---|
| C1 | Comprobar que existen los 12 secretos `DEMO_*` y la conectividad, sin tocar nada | `publicar-nube` · `modo=verificar` | **Sí** (aprobación) | Lista de variables y herramientas completa; conexión por el Session Pooler OK |
| C2 | Publicar (función de Supabase + página de Cloudflare Pages) con **`digifact=apagado`** | `publicar-nube` · `modo=publicar` · `confirmar=PUBLICAR` | **Sí, específica** | Prueba de humo contra la URL real (200, inicio de sesión, MFA, factura simulada, PDF, persistencia) |
| C3 | Entregarte la URL **solo después** de verificarla; pruebas en PC y Android | Guía `GUIA-PRIMERA-SESION.md` (contraseñas de `DEMO_CLAVES`, nunca en el chat) | — | Recorrido completo desde Android y PC |

## Fase D · Digifact TEST en la nube (después de C, cada paso por separado)
| # | Operación | Cómo | Autorización | Verificación / parada |
|---|---|---|---|---|
| D1 | Autorizar la migración 29 y preparar su aplicación: mover el archivo a `supabase/migrations`, añadir la etapa 3 y actualizar contadores (`supabase-hospedado.sh`, `verificar-publicacion.py`, pruebas 28→29, 67→69 tablas) | Cambio de código local + CI + push | **Sí** (autorizar la 29 y el push) | CI en verde; la guarda actual falla a propósito hasta que se actualice |
| D2 | Etapa 3: aplicar la migración 29 | `migraciones-etapa` · `etapa=3` · `APLICAR-MIGRACIONES` | **Sí, específica** | V3: 29 registradas, `digifact_operaciones` y `digifact_artefactos` con RLS y sin privilegios para `anon`/`authenticated`/`service_role` |
| D3 | Crear 3 secretos NUEVOS en `demo-privada`: `DEMO_DIGIFACT_TEST_EMPRESA`, `DEMO_DIGIFACT_TEST_EMISOR`, `DEMO_DIGIFACT_TEST_HUELLA` (los de usuario, contraseña y NIT ya existen). El emisor y su huella salen del paso `datos-emisor` de `digifact-test.yml` y los apruebas tú | Los creas tú en GitHub (nunca en el chat) | **Sí** (secretos) | `publicar-nube` en `verificar`: la función solo se publica si Digifact está completo (todo o nada) |
| D4 | Republicar la función con Digifact habilitado | `publicar-nube` · `digifact=habilitado` (sin referencia al inicio) | **Sí, específica** | Prueba de humo; el servicio de Digifact existe pero **no envía** sin una referencia autorizada |
| D5 | Una prueba real contra Digifact TEST: preparar en la interfaz → copiar la referencia → republicar con `digifact_referencia=<esa referencia>` → certificar escribiendo `CERTIFICAR-TEST` | Interfaz + `publicar-nube` | **Sí, por cada referencia** | El documento queda certificado con serie, número y UUID del certificador; XML y PDF descargables; si el XML/PDF reales no cumplen la validación, se ajusta (no hay formato real verificado todavía) |
| D6 | Cierre: republicar con `digifact=apagado` (la autorización de la referencia se retira) | `publicar-nube` | **Sí** | Digifact deshabilitado de nuevo |

## Lo que sigue bloqueado en todo momento
Producción fiscal, anulación y nota de crédito, cualquier migración sin autorización específica, cambios de permisos/RLS fuera de las migraciones aprobadas, y la modificación de `main`/NEXA principal.
