# NEXA POS · componentes de seguridad reutilizables (DOCUMENTO, no se implementa el POS)

Alcance pedido: lectores de códigos de barras **Bluetooth HID** y **USB**, inventarios, ventas, movimientos de caja e integración con NEXA FEL. Aquí solo se indica **qué de lo ya construido (W1–W4, F1–F4) se reutiliza tal cual, qué se adapta y qué falta diseñar**. No se crea ninguna tabla, función ni pantalla de POS.

## 1. Reutilizable sin cambios de diseño
| Componente (ya probado) | Uso en POS / inventario | Condición |
|---|---|---|
| **Identidad por Supabase Auth** (`fel__ctx`: `auth.uid()` + sesión viva en `auth.sessions` + empresa por membresía) | cada función `api.pos_*`/`api.inventario_*` nace con la misma identidad; el JWT es la única fuente | el POS usa el mismo proyecto de Auth |
| **Generador de `api.*` por catálogo** (M-N) y regla «ninguna función de `api` recibe `p_sesion`/`p_actor`/`p_empresa`» (`prueba-api-identidad.sql`) | los envoltorios de escritura de POS se generan igual; la prueba de catálogo impide que alguien añada identidad por parámetro | cada módulo agrega su prefijo (`pos_`, `inv_`) a la regla de nombres |
| **MFA real (`aal2` en token Y sesión guardada)** y lista de operaciones sensibles (`v_aal2`) | cierre de caja, anulación de venta, ajuste de inventario, descuentos sobre un umbral, retiros de efectivo | la lista de sensibles se amplía por módulo; el cajero común no necesita aal2 para vender |
| **Permisos efectivos** (rol + extras − revocados, `permisos_catalogo`/`rol_permisos`, `fel_tiene_permiso`) | `pos.vender`, `pos.caja.abrir`, `pos.caja.cerrar`, `inventario.ajustar`, `inventario.ver` | los decide la base; se prueban con la misma matriz que `prueba-api-lecturas.sql` |
| **RLS restrictiva `sesion_viva` generada por catálogo** (M-L) y prueba de cobertura «toda tabla con `empresa_id` la tiene» | toda tabla nueva de POS/inventario con `empresa_id` queda cubierta o **la prueba falla** | seguir la convención `empresa_id` + RLS activada |
| **Establecimiento fijo por usuario** (M-F) y política restrictiva por establecimiento | una caja o terminal pertenece a un establecimiento; el cajero solo ve el suyo | la caja se modela con `establecimiento_id` |
| **Lecturas por RPC `SECURITY INVOKER` + RLS** (M-O) | listas de productos, existencias y ventas del día: la RLS decide filas, la RPC solo acota a la empresa de la sesión | una RPC por pantalla (conserva el patrón de #55) |
| **Libro de movimientos de solo agregar + verificación de saldos** (bolsón/monedero: `bolson_movimientos`, `fel_sys_verificar_saldos`/`verificar_monederos`) | movimientos de caja y de inventario como libro inmutable con saldo derivado y verificación por el sistema | el POS no actualiza saldos «en sitio»: inserta movimientos; el saldo se verifica por `nexa-sys` |
| **Idempotencia y máquina de estados de certificación** (claves de idempotencia, `fel_sys_*` de pasos fiscales en el nivel `nexa_sys`) | una venta cobrada que debe facturarse llama a la misma certificación; reintentos de red no duplican | los pasos fiscales siguen **fuera de `api`** (nivel sistema), como hoy |
| **Auditoría de lista cerrada** (`fel_ses_auditar`, acciones permitidas) | acciones POS (`pos.venta.anulada`, `caja.cerrada`, `inventario.ajustado`) se agregan a la lista cerrada; la firma la pone la sesión | ampliar la lista por migración, nunca por parámetro |
| **Nivel `nexa_sys`** y función interna con secreto acotado (`POST /tick`) | conciliaciones, sincronización diferida y verificaciones periódicas | cada tarea nueva es una `fel_sys_*`; la interfaz sigue limitada |
| **Pruebas de método**: claims simulados (PostgREST), mutaciones, sonda por clases, emulador con firma de JWT (`emulador_postgrest.ts`) | misma disciplina de pruebas negativas por módulo | — |

### Añadido en la fase siguiente (también reutilizable por POS, inventarios y Hotel)
| Componente | Uso futuro | Condición |
|---|---|---|
| **Parámetros por clase** (M-R: usuario / empresa con permiso / plataforma / interno; sin clasificar = nunca sale) | cada módulo clasifica sus parámetros (p. ej. tope de descuento de caja = empresa; umbrales antifraude = interno) | un parámetro nuevo falla cerrado hasta clasificarlo; la prueba exige que no quede ninguno sin clase |
| **Patrón de lectura optimizada** (políticas por conjunto de empresas/establecimientos evaluadas una vez por consulta + RPC `INVOKER`) | listas de productos, existencias, ventas y movimientos de caja con volúmenes altos | medido: con 15 000 filas la política por fila tardaba 12 s y la propuesta 26 ms (ver `MEDICIONES-R3.md`); toda tabla nueva debe seguir el patrón, no `fel_tiene_permiso(...)` por fila |
| **Descarga de archivos con permiso explícito** (columna `contenido` sin `SELECT`; RPC `DEFINER` que verifica permiso, empresa y alcance) | comprobantes, reportes de cierre de caja, tickets almacenados | el binario nunca se lee por tablas |
| **Agentes de dispositivo firmados** (Ed25519 sobre método, ruta, hora, nonce y hash del cuerpo; nonce de un solo uso; límites por origen y por agente; alcance de empresa desde el agente) | terminales, balanzas, impresoras y sincronizadores de POS/Hotel | misma separación: el protocolo del agente corre en `nexa-sys`, nunca en la función de personas |
| **Guardia global de JWT** (con la Data API activa, ninguna ruta autenticada llega a la base sin el JWT de la persona) | todos los módulos nuevos nacen detrás de esa guardia | sin excepciones por «compatibilidad» |

## 2. Lectores de códigos de barras (Bluetooth HID y USB)
- Un lector en modo **HID teclado** (USB o Bluetooth HID) no necesita controlador, **no transporta credenciales ni identidad** y no se «autentica»: escribe caracteres como un teclado. La seguridad no depende del dispositivo sino de lo que la aplicación hace con el texto leído.
- **El código leído es dato no confiable:** se valida formato y dígito de control (EAN-13/EAN-8/UPC-A/Code-128 según el catálogo) en el cliente **y de nuevo en la base**; la búsqueda del producto es una RPC de lectura acotada por empresa (RLS), nunca una consulta con el código concatenado.
- Distinguir escáner de teclado humano es una **conveniencia** (ráfagas rápidas terminadas en Enter), no una frontera de seguridad: un atacante con acceso a la caja podría teclear el mismo texto. Por eso el control real son los permisos (`pos.vender`), el límite por establecimiento y el libro de movimientos.
- Web USB / Web HID / Web Bluetooth **no son necesarios** para el modo teclado; se evitan por exigir permisos de dispositivo y no ampliar la superficie. Si algún día se requiere un lector en modo serie/propietario, se evalúa aparte.
- Límite de tasa y de tamaño por escaneo en la RPC (evita inundar la base con códigos inválidos).

## 3. Lo que NO está cubierto y requiere diseño propio (no se hace ahora)
1. **Identidad de terminal/cajero**: inicio de sesión rápido por PIN en una terminal compartida y su relación con Supabase Auth (sesiones de corta vida por dispositivo, claims de dispositivo). W0 debe confirmar el mínimo de vida del access token en el plan Free.
2. **Modo sin conexión**: cola local firmada, claves de idempotencia por venta, resolución de conflictos y límite de riesgo fiscal. No existe hoy ningún componente reutilizable; es el mayor diseño pendiente.
3. **Rendimiento de caja**: una vuelta HTTP más (Edge → Data API) frente al SQL directo. Se mide en `nexa-fel-test` contra #55; si no cumple, el POS usa lecturas de catálogo en caché de corta vida (sin datos sensibles) y una sola RPC por venta.
4. **Impresión de tickets y cajón**: hardware y formatos; el PDF/ticket fiscal ya existe para FEL, el resto es nuevo.
5. **Inventario multi-bodega y costos**: modelo contable propio; reutiliza solo el patrón de libro de movimientos.

## 4. Regla para no ampliar el alcance actual
Hasta que se apruebe expresamente el POS: ningún objeto `pos_*`/`inv_*` en la base, ningún permiso nuevo en el catálogo y ninguna ruta nueva en la aplicación. Este documento solo fija **cómo** se reutilizaría lo existente para que W1–W4 no se diseñen en una dirección incompatible.
