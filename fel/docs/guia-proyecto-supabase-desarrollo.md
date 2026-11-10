# Guía: proyecto Supabase de desarrollo independiente para NEXA FEL

> **Estado:** guía preparada. **No se ha creado ni tocado ningún proyecto alojado.** Cada etapa (A–D) exige **tu autorización por separado**; la autorización de una etapa no vale para la siguiente.
> Regla de oro: este proyecto **no es el de NEXA principal ni producción**. Nunca se usan sus claves, su URL ni su base de datos. Las credenciales **no van en el chat ni en el repositorio**.

## 0. Qué tiene que ser verdad antes de empezar
- Es un proyecto **nuevo**, con nombre claro (p. ej. `nexa-fel-dev`), en una organización/cuenta que controlas tú, **sin datos reales** y sin clientes de producción conectados.
- Su referencia (los 20 caracteres de `https://<ref>.supabase.co`) es distinta de la del NEXA principal. Anótala: se usa en el script como lista de permitidos.
- La emisión fiscal (certificador FEL) **no está configurada ni se configurará** en este proyecto. El interruptor `plataforma_config.emision_real_disponible` debe quedar en `false`.

## 1. Crear el proyecto (lo haces tú, en el panel)
1. https://supabase.com/dashboard → **New project**. Organización de pruebas, región cercana, contraseña de base de datos **larga y única** (guárdala en tu gestor de contraseñas; no la reutilices).
2. **Settings → API**: copia en tu gestor de secretos `Project URL`, `anon` y `service_role`. (Si el proyecto muestra claves nuevas `sb_publishable_…`/`sb_secret_…`, ver «claves opacas» en la etapa C.)
3. **Settings → Database → Connection string**: la cadena directa `postgresql://postgres:<contraseña>@db.<ref>.supabase.co:5432/postgres` o la del pooler (usuario `postgres.<ref>`). El script solo acepta estas dos formas y solo de **este** `<ref>`.
4. Marca el proyecto como «desarrollo»: nombre, etiqueta y, si tu plan lo permite, protección contra borrado.

### Configuración de Auth (Authentication → …)
| Ajuste | Valor | Por qué |
|---|---|---|
| Sign In / Providers → **Allow new users to sign up** | **Desactivado** | Sin registro abierto: las personas entran por invitación (`V02`) |
| Providers → **Email** | **Activado** | Si no, no hay login con contraseña (hallazgo real de la fase 1.2; `V03`) |
| Email → **Confirm email** | Activado | Sin autoconfirmación (`V04`) |
| Password policy | mínimo 12, minúsculas + mayúsculas + dígitos | Igual que `config.toml` |
| **Multi-Factor → TOTP** | Enroll y Verify **activados** | MFA de administración |
| Sessions → **JWT expiry** | 900–1800 s (por defecto 3600) | Menor ventana de un token robado; PostgREST no revisa sesiones (ver `seguridad-sesion.md`) |
| Sessions → rotación de refresh tokens | Activada; intervalo de reutilización 10 s | Detecta reutilización |
| Sessions → *Time-box* / *Inactivity timeout* | Opcional (plan Pro); anota el valor | Solo existen en proyectos reales (A-07) |
| URL Configuration → **Site URL** | URL de la interfaz de **desarrollo** (nunca producción) | Enlaces de invitación/recuperación |
| URL Configuration → **Redirect URLs** | Lista exacta, sin comodines amplios | Evita redirecciones abiertas |
| SMTP | El SMTP integrado limita el envío (pocos correos/hora); para las pruebas con correo real, usa un buzón de prueba tuyo | I-01, R-01, R-04 |
| Edge Functions → `fel-api` | **No se despliega** en estas etapas; se corre en local con Deno apuntando al proyecto | Mantiene «no desplegar» |

## 2. Dónde van los secretos
- **Gestor de contraseñas personal** para la contraseña de la base y las claves.
- Para que las use Claude: **solo** por el formulario seguro de credenciales del entorno (`request_credential`) o variables del entorno de la sesión; **nunca** pegadas en el chat, en commits, en issues ni en archivos del repositorio. no crees archivos con claves dentro del repositorio.
- Si una clave se expone por error: rotarla de inmediato en **Settings → API** (y la contraseña de la base en **Settings → Database**).
- Nunca poner en este proyecto la clave `service_role` de NEXA ni al revés.

## 3. Las cuatro etapas, cada una con su propia autorización

El script `fel/tools/integracion-local/ejecutar.mjs` tiene tres etapas propias (`verificar`, `ejecutar`, `limpiar`) y la aplicación de migraciones es otra. Cada una exige en el entorno `FEL_ETAPA_AUTORIZADA=<etapa>` **igual a la etapa pedida**; si no coincide, el script se niega. Variables comunes del script (definidas por ti, nunca escritas en archivos del repositorio):

```bash
export API_URL="https://<ref>.supabase.co"                    # solo el origen
export DB_URL="postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres"
export ANON_KEY="…"   SERVICE_ROLE_KEY="…"                    # del MISMO proyecto
export FEL_AUTORIZACION_PRUEBAS_REALES=si
export FEL_PROYECTOS_DEV_PERMITIDOS="<ref>"                   # 1–3 referencias exactas de 20 caracteres
export FEL_CONFIRMAR_REF="<ref>"                              # repetir la referencia a mano
export FEL_PROYECTO_NEXA_PRINCIPAL="<ref del NEXA principal>" # defensa extra: prohibido
export FEL_API_URL="http://127.0.0.1:8000"                    # fel-api local (Deno), no desplegada
```
Claves con formato `sb_publishable_…`/`sb_secret_…` no traen el claim `ref` y el script no puede comprobar que son de este proyecto: exige `FEL_CLAVES_OPACAS_CONFIRMADAS=si` (confirmación tuya de que las copiaste del panel de **este** proyecto).

### Etapa A — Preparación (solo lectura)
*Objetivo:* comprobar que el proyecto es el correcto y que el panel está bien configurado, **antes** de tocar su base.
1. Verificar a mano la tabla de Auth de arriba y que el proyecto está vacío (Table editor: sin tablas de `public`).
2. En el SQL Editor (solo `select`): `select version();` y `select count(*) from auth.users;` (esperado: 0 o solo tu cuenta de panel).
3. Comprobar la compatibilidad de Auth (solo lectura, no requiere nuestras migraciones):
   ```sql
   select column_name from information_schema.columns where table_schema='auth' and table_name='mfa_factors' order by 1;
   select column_name from information_schema.columns where table_schema='auth' and table_name='sessions' order by 1;
   select has_table_privilege('postgres','auth.sessions','DELETE'), has_table_privilege('postgres','auth.mfa_factors','SELECT');
   ```
   Esperado: `mfa_factors` con `user_id, factor_type, status`; `sessions` con `user_id`; ambos privilegios `true`. Si `sessions` no es borrable, el borrado de sesiones al recuperar MFA será «de mejor esfuerzo» y la revocación dependerá de la marca (documentado en `dependencias-auth-interno.md`).
4. Confirmar que **no** hay copias del script con claves y que `git status` está limpio.

**Texto de autorización A** (tú me lo escribes tal cual): «Autorizo la ETAPA A (preparación, solo lectura) contra el proyecto `<ref>` (desarrollo, independiente de NEXA). No autorizo migraciones, pruebas ni limpieza.»

### Etapa B — Aplicación de migraciones (escribe en la base)
*Objetivo:* crear el esquema `public` de FEL en el proyecto de desarrollo. **Es la única etapa que modifica el esquema.**
1. `supabase link --project-ref <ref>` (pide la contraseña de la base; no se guarda en el repositorio).
2. **Ensayo:** `supabase db push --dry-run` — lista las 10 migraciones pendientes (`20261110000100` … `20261110001000`); verifica que son exactamente esas y en ese orden, y que no aparecen cambios sobre `auth`.
3. Con autorización B: `supabase db push`.
4. Poscomprobaciones (etapa `verificar` del script, solo lectura, con `FEL_ETAPA_AUTORIZADA=verificar` — requiere su propia autorización A′ si no la diste antes):
   ```bash
   FEL_ETAPA_AUTORIZADA=verificar node fel/tools/integracion-local/ejecutar.mjs --etapa=verificar
   ```
   Esperado `V01–V11` todos OK: Auth responde y sin registro abierto, proveedor de correo activo, `fel_verificar_dependencias_auth()` con todas las filas `ok`, interruptor de emisión `false`, RLS en todas las tablas, `authenticated` solo ejecuta 3 funciones, `anon` ninguna, nadie escribe directo en `public`.
5. Si algo falla: **detenerse**. No se «arregla» con SQL manual en el panel; se corrige la migración en el repositorio y se vuelve a pedir autorización.

**Texto de autorización B:** «Autorizo la ETAPA B: aplicar con `supabase db push` las migraciones `20261110000100`–`20261110001000` **solo** al proyecto `<ref>` tras ver el `--dry-run`. No autorizo pruebas ni limpieza.»

### Etapa C — Ejecución de pruebas (crea datos de prueba)
*Objetivo:* correr los escenarios de la matriz (`matriz-integracion-supabase-real.md`) contra el proyecto.
1. En otra terminal: `fel-api` local con Deno (no se despliega):
   ```bash
   SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" FEL_APP_URL="<url de la interfaz de desarrollo>" \
     deno run -A fel/supabase/functions/fel-api/index.ts
   ```
2. `FEL_ETAPA_AUTORIZADA=ejecutar node fel/tools/integracion-local/ejecutar.mjs --etapa=ejecutar --manifiesto=./manifiesto-<fecha>.json`
3. El script crea **solo** usuarios, empresas, autorizaciones y solicitudes con identificadores aleatorios por ejecución (correos `…@integracion.fel.test`, NIT aleatorios) y **escribe cada identificador en el manifiesto en el instante en que lo crea**. Guarda el manifiesto fuera del repositorio.
4. Resultado: tabla en consola + `integracion-local-resultados.json`. **OK/FALLO** son afirmaciones; **OBSERVADO** documenta el comportamiento real (p. ej. que PostgREST no revisa sesiones).
5. Pasos manuales de la columna «Proyecto de desarrollo» de la matriz (correo real, esperar vencimientos, procedimiento del primer maestro) son **parte de esta etapa** y también se autorizan aquí, con el buzón de prueba que indiques.
6. Si falla a mitad: el manifiesto ya contiene lo creado hasta ese punto; **no** se reintenta a ciegas: se pasa a la etapa D con ese manifiesto.

**Texto de autorización C:** «Autorizo la ETAPA C: ejecutar `ejecutar.mjs --etapa=ejecutar` contra el proyecto `<ref>`, con `fel-api` local, y los pasos manuales de correo con el buzón `<buzón de prueba>`. No autorizo la limpieza.»

### Etapa D — Limpieza (borra solo lo registrado)
*Objetivo:* eliminar lo creado por **una ejecución concreta**.
1. Revisar el manifiesto (`cat manifiesto-<fecha>.json`): usuarios, empresas, autorizaciones, solicitudes. Comprobar que `api`/`ref` son los del proyecto de desarrollo.
2. `FEL_ETAPA_AUTORIZADA=limpiar node fel/tools/integracion-local/ejecutar.mjs --etapa=limpiar --manifiesto=./manifiesto-<fecha>.json`
3. Qué hace: transacción SQL que actúa **exclusivamente sobre los UUID del manifiesto** (nunca por correo, NIT ni patrón); borra los usuarios de Auth con la API de administración; **suspende** las empresas (no se pueden borrar: la auditoría es de solo-anexar y las referencia); verifica que no queda nada de lo registrado. Se niega si el manifiesto es de otro destino (`api`/`ref`), no tiene `runId` o contiene identificadores que no son UUID; con un manifiesto sin identificadores no borra nada.
4. Qué **queda** a propósito: filas de la tabla `auditoria` y las empresas de prueba en estado suspendido. Si quieres un proyecto limpio del todo: **eliminar el proyecto de desarrollo** desde el panel (decisión tuya, fuera del script).
5. No hay «limpieza general»: si perdiste el manifiesto, no se improvisa un `delete … where email like …`; se decide contigo qué hacer (lo más seguro: borrar el proyecto de desarrollo).

**Texto de autorización D:** «Autorizo la ETAPA D: limpiar con `--etapa=limpiar` **únicamente** el manifiesto `<ruta>` contra el proyecto `<ref>`.»

## 4. Lo que el script rechaza (probado con 96 casos en `guardia.test.mjs`)
URL con usuario/ruta/parámetros, dominios propios o subdominios extra, `http` hacia proyecto real, puerto distinto de 443, referencia fuera de la lista o con comodín/vacíos/más de 3, lista que contenga el proyecto principal, `FEL_CONFIRMAR_REF` ausente o distinta, `DB_URL` de otro proyecto, `FEL_API_URL` de otro proyecto, claves de otro `ref` o con roles intercambiados, claves opacas sin confirmar, autorización de etapa distinta de la pedida, mezcla local/real (p. ej. Auth local con DB alojada, o variables «reales» con todo local) y etapa desconocida. Ante una configuración incompleta o contradictoria, **se niega** (el valor por defecto es rechazar).

## 5. Límites y riesgos que esta guía no elimina
- No se ha probado nunca un proyecto alojado: permisos reales de `postgres` sobre `auth.sessions`, entrega de correo, `verify_jwt` del gateway, JWKS/claves asimétricas y límites de sesión del plan solo se confirman en la etapa C.
- Desde el entorno de Claude puede **no haber salida de red** a `db.<ref>.supabase.co` (puerto 5432). En ese caso las etapas con SQL (B poscomprobaciones, C, D) las ejecutas tú en tu equipo con el mismo script, y me compartes `integracion-*-resultados.json` (no contiene claves).
- El borrado completo del proyecto de desarrollo es la única forma de eliminar la auditoría de prueba.
