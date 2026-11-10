# Matriz de pruebas de integración con Supabase real

> **Estado:** preparada, **NO ejecutada contra ningún proyecto real**. La columna «Pila local» indica lo que **ya** se verifica en CI con la pila Supabase local efímera (GoTrue + PostgREST + PostgreSQL con las migraciones + `fel-api` en Deno). La columna «Proyecto de desarrollo» es lo que **falta** y exige tu autorización (ver al final).
> Script: `fel/tools/integracion-local/ejecutar.mjs`. Resultado de cada comprobación: **OK** · **FALLO** (rompe la CI) · **OBSERVADO** (comportamiento de Supabase que se registra).

## A. Autenticación y sesión
| ID | Escenario | Pila local (CI) | Proyecto de desarrollo (pendiente) |
|---|---|---|---|
| A-01 | Login con contraseña correcta/incorrecta | ✅ `A01` (encontró el error de `config.toml`) | Repetir; límites de intentos reales del proyecto |
| A-02 | Forma de los claims (`sub`, `role`, `aal`, `exp`, `amr`) | ✅ `A02` | Confirmar con las claves de firma del proyecto (JWKS/asimétricas) |
| A-03 | Token basura, firma falsa, caducado, `anon`/`service_role` como usuario | ✅ `J01` (fel-api y PostgREST) | Además contra el gateway alojado con `verify_jwt` activo |
| A-04 | Cierre de sesión: efecto en Auth, `fel-api` y PostgREST | ✅ `L01` (OBSERVADO: PostgREST sigue sirviendo hasta `exp`) | Igual; medir con `jwt_expiry` definitivo |
| A-05 | Renovar token: conserva `aal` y `amr` | ✅ `M01c` | Igual |
| A-06 | Sesión caducada real (esperar `jwt_expiry`) | ➖ cubierto por pruebas unitarias | Esperar el vencimiento real (con `jwt_expiry` corto de prueba) |
| A-07 | Límites de sesión del servidor (rotación, reutilización, `timebox`, `inactivity_timeout`) | ➖ no aplicable en local | **Solo real**: verificar los valores configurados y su efecto |

## B. MFA TOTP
| ID | Escenario | Pila local | Proyecto de desarrollo |
|---|---|---|---|
| M-01 | Enrolar y verificar TOTP → aal2 con evento `totp` | ✅ `M01` | Repetir con app autenticadora real (reloj de un teléfono) |
| M-02 | Maestro: `fel_bootstrap_primer_maestro` con factor verificado real; lecturas aal1 vs aal2 | ✅ `P01` | Ejecutar el **procedimiento documentado** de punta a punta (invitación real → TOTP → consola SQL) |
| M-03 | Autorizar un maestro adicional (API aal2) y consumirlo con `fel_agregar_maestro_adicional` | ✅ parcial (`P01f` autoriza) | Consumir la autorización en el SQL Editor del panel |
| M-04 | aal2 antiguo (> 15 min) pide confirmar código | ✅ `unit`, `cuentas.cjs` | Esperar 16 min con una sesión real y comprobar `mfa_reciente` + paso intermedio |

## C. Invitaciones
| ID | Escenario | Pila local | Proyecto de desarrollo |
|---|---|---|---|
| I-01 | Invitar a la empresa con aal2: se registra la invitación y se crea la cuenta de Auth | ✅ `I01a–d` | **Correo real**: plantilla, remitente, entrega, enlace de un solo uso, `redirect_to` en la lista permitida |
| I-02 | Cuenta sin invitación vigente no entra; con invitación aceptada, sí | ✅ `C01`, `I01e–i` | Repetir tras abrir el enlace real del correo |
| I-03 | Invitación de una persona no la usa otra (suplantación) | ✅ `SQL 08`, `unit` | — |
| I-04 | Aislamiento de invitaciones entre empresas (RLS) | ✅ `I01j–l` | Repetir con dos empresas reales de prueba |

## D. Recuperación de contraseña
| ID | Escenario | Pila local | Proyecto de desarrollo |
|---|---|---|---|
| R-01 | Enlace de recuperación (`generate_link`) entrega sesión `type=recovery` en el `#fragmento` | ✅ `R01a` | **Correo real** y flujo completo en el navegador (`site_url`, `additional_redirect_urls`) |
| R-02 | Sin TOTP: se puede fijar contraseña; la vieja deja de servir | ✅ `R01b–c` | Repetir |
| R-03 | Con TOTP: la sesión aal1 de recuperación **es rechazada (`insufficient_aal`)**; tras el código, se permite; el TOTP sigue activo | ✅ `R01d` (**OBSERVADO: 401 insufficient_aal**), `R01e–f` | Confirmar en el proyecto real (mismo comportamiento esperado) |
| R-04 | Respuesta idéntica exista o no la cuenta; límites de envío | ✅ interfaz (falso) | **Solo real**: límite de correos por hora y comportamiento de `/recover` |

## E. Recuperación de MFA (dispositivo perdido)
| ID | Escenario | Pila local | Proyecto de desarrollo |
|---|---|---|---|
| X-01 | Solicitud (aal1) no cambia el MFA; solo resuelve quien corresponde, con aal2 reciente y evidencia | ✅ `X01a–e` | Repetir con personas reales (una de otra empresa) |
| X-02 | Aprobar elimina el factor con la **API de administración real** | ✅ `X01f–g` | Repetir |
| X-03 | Sesiones anteriores quedan fuera: Auth las borra (`2 → 0`), el token viejo da 403/401, la renovación falla (`refresh_token_not_found`), RLS no entrega datos | ✅ `X01h–o` (observados y afirmados) | **Solo real**: permisos de `postgres` sobre `auth.sessions` en un proyecto alojado (`fel__borrar_sesiones_auth` es de mejor esfuerzo) |
| X-04 | Tras recuperar: login nuevo en aal1; lo sensible exige TOTP nuevo | ✅ `X01p–r` | Repetir |
| X-05 | Fallo parcial al borrar factores; reintento sin duplicar; aprobación simultánea | ✅ `unit` + `SQL 13` | Provocar un fallo real (p. ej. cortar la red a mitad) y reintentar |

## F. Roles, permisos y aislamiento multiempresa
| ID | Escenario | Pila local | Proyecto de desarrollo |
|---|---|---|---|
| P-01 | Lector no escribe; propietario sí; otra empresa → 403 | ✅ `D01e–h` | Repetir |
| P-02 | RLS: nadie lee datos de otra empresa; `anon` no lee | ✅ `D01a–d` | Repetir con datos reales de prueba |
| P-03 | Cuenta bloqueada con token vigente: PostgREST y `fel-api` cortan de inmediato; al reactivar vuelve | ✅ `B01`, `C01d` | Repetir |
| P-04 | Persona con dos empresas: permisos separados por empresa | ✅ `MU01` | Repetir |
| P-05 | Cambio de rol/permisos en caliente | ✅ `cuentas.cjs` (falso), `SQL 11` | Repetir con dos navegadores reales |

## Solicitud de autorización (NO se ejecuta nada sin tu respuesta)
La guía paso a paso está en **`guia-proyecto-supabase-desarrollo.md`**. El trabajo se divide en **cuatro etapas independientes**; cada una se autoriza por separado, con texto propio (plantillas en la guía), y el script se niega si `FEL_ETAPA_AUTORIZADA` no coincide con la etapa pedida.

| Etapa | Qué hace | Escribe en el proyecto | Comando |
|---|---|---|---|
| A. Preparación | Revisión del panel y consultas de solo lectura | No | manual (SQL Editor, solo `select`) |
| B. Migraciones | `supabase db push --dry-run`, luego `db push` de las 10 migraciones; poscomprobaciones `V01–V11` | Sí (esquema `public`) | `supabase db push` + `ejecutar.mjs --etapa=verificar` |
| C. Pruebas | Escenarios de esta matriz; crea datos con identificadores aleatorios y los anota en un **manifiesto** | Sí (datos de prueba) | `ejecutar.mjs --etapa=ejecutar --manifiesto=…` |
| D. Limpieza | Borra **solo** lo del manifiesto (UUID); suspende las empresas (la auditoría de solo-anexar las referencia) | Sí (borrado acotado) | `ejecutar.mjs --etapa=limpiar --manifiesto=…` |

**Qué necesito de ti** (por el canal seguro de credenciales, nunca en el chat): proyecto de desarrollo **nuevo e independiente** (URL, `anon`, `service_role`, cadena de BD solo de ese proyecto); confirmar los ajustes de Auth de la guía; un buzón de prueba para los pasos con correo real.
**Salvaguardas del script** (`guardia.mjs`, 96 casos de prueba): rechaza todo lo que no sea local salvo con `FEL_AUTORIZACION_PRUEBAS_REALES=si`, `FEL_ETAPA_AUTORIZADA=<etapa>`, `FEL_PROYECTOS_DEV_PERMITIDOS=<ref>` (≤ 3 referencias exactas), `FEL_CONFIRMAR_REF=<ref>`, URL/BD/función/claves del **mismo** proyecto y `ref` distinto del NEXA principal (`FEL_PROYECTO_NEXA_PRINCIPAL`). Configuración incompleta o contradictoria ⇒ se niega.
**Limpieza:** ya **no** hay limpieza por correo ni por NIT. Los usuarios usan el dominio `integracion.fel.test` con sufijo aleatorio, pero eso es solo una etiqueta para humanos: lo que se borra es la lista de identificadores del manifiesto de la ejecución.
**Qué NO hará:** no toca producción ni el proyecto de NEXA, no habilita la emisión fiscal, no despliega, no modifica `main`.
