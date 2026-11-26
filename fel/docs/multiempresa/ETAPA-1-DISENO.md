# NEXA FEL · Multiempresa · Etapa 1: diseño técnico (PROPUESTA · 26/11/2026)

Alcance: SOLO diseño. Nada de esto se aplica ni se publica sin autorización expresa. Digifact solo TEST (producción sigue bloqueada). El modelo comercial con Digifact (multiempresa, comercialización, soporte) está confirmado por el propietario y no se vuelve a investigar. Autenticación: Supabase Auth con MFA.

## 1. Principios
1. Una empresa = un conjunto propio de usuarios, establecimientos, configuración fiscal y credenciales de Digifact. Ninguna se comparte (NIT de Digifact único por empresa).
2. Las credenciales son **solo de escritura** desde cualquier pantalla o API: nadie (ni propietario ni maestro) las lee; solo el resolvedor del servidor las descifra, en memoria, al usarlas.
3. El maestro opera con funciones de servicio (como hoy `fel_admin_*`), que devuelven agregados. No existe política RLS que le permita leer documentos, clientes ni configuración fiscal de una empresa.
4. Alta de empresas sin código ni despliegue: todo vive en tablas; el servicio crea el cliente de Digifact de cada empresa a demanda.
5. No se toca nada de las migraciones 1–30 ni de las rutas calientes de certificación: la idempotencia, la concurrencia y las optimizaciones de rendimiento quedan como están (el resolvedor consulta la base como mucho una vez cada 60 s por empresa; en caliente cuesta 0).

## 2. Tablas propuestas (migraciones aditivas; se numeran al aplicarse, después de la 30)
**M-A · Configuración fiscal por empresa**
- `empresa_emisor_versiones` (id, empresa_id, version, nit, nombre_fiscal, nombre_comercial, afiliacion_iva, frases jsonb, correo, direccion/codigo_postal/municipio/departamento, huella text, estado `borrador|aprobada|reemplazada`, creado_por/en, aprobado_por/en). Una versión aprobada es **inmutable** (disparador); la huella la calcula el servicio con la misma función que hoy (`huellaEmisor`) y la base la guarda. Solo una versión `aprobada` vigente por empresa (índice único parcial).
- `establecimientos` (existe): se agregan columnas aditivas `codigo_postal`, `municipio`, `departamento` (hoy la dirección del establecimiento es un solo texto).

**M-B · Conexión con Digifact por empresa**
- `empresa_digifact_config` (empresa_id PK/FK, `ambiente` con CHECK = `'pruebas'` (cerrojo: `produccion` se abre en una migración futura), `estado` `sin_configurar|pendiente_prueba|activo|suspendido`, `digifact_nit` (UNIQUE, inmutable una vez exista una operación), `credencial_cifrada bytea`, `llave_version smallint`, banderas `consulta_nit`, `consulta_cui`, `certificar`, `correo_digifact`, `ultima_prueba_en`, `ultima_prueba_ok`, `version int` (bloqueo optimista), creado/actualizado por y en).
- Disparador: `certificar = true` solo si `estado='activo'` y existe emisor aprobado; `estado='activo'` solo tras una prueba de conexión correcta registrada.
- `empresa_digifact_eventos` (empresa_id, tipo, actor, detalle jsonb **sin valores secretos**, creado_en): conectar, cambiar, probar, suspender, rotar llave.

**M-C · Acceso excepcional del maestro**
- `acceso_maestro_datos` (id, maestro_id, empresa_id, alcance `documentos|configuracion`, motivo ≥ 20 caracteres, aprobado_por (otro maestro), creada_en, expira_en ≤ 24 h (por defecto 2 h), revocada_en, avisado_a_empresa_en). Las credenciales **nunca** son alcance posible: solo se pueden reemplazar.
- La lectura excepcional se hace por funciones de servicio `fel_admin_datos_excepcionales_*` que comprueban el permiso vigente y registran **cada lectura** en `auditoria`. No se agregan políticas nuevas a las tablas existentes.

**M-D · Permisos** (en `permisos_catalogo` y `rol_permisos`): `fiscal.configurar` (propietario y administrador), `fiscal.aprobar_emisor` (propietario), `digifact.conectar` (propietario), `digifact.probar` (propietario y administrador). Los roles existentes y sus permisos no cambian.

**Onboarding:** no necesita tabla: la vista `v_empresa_onboarding` calcula el avance (datos fiscales, establecimiento, usuarios, MFA del propietario, conexión Digifact, prueba de NIT, prueba de certificación en TEST) a partir de las tablas anteriores.

## 3. RLS y permisos (mismo patrón que hoy: `fel_tiene_permiso`, escritura solo por funciones de `service_role`)
- Todas las tablas nuevas: RLS activado; `revoke all` a `anon` y `authenticated`.
- Lectura para usuarios: solo vistas con `security_invoker` que **no incluyen** `credencial_cifrada` ni `llave_version` (`v_empresa_digifact_estado`, `v_empresa_emisor`), con política `fel_tiene_permiso(empresa_id, 'fiscal.ver')`.
- Escritura: funciones `fel_op_digifact_*` y `fel_op_emisor_*` (`security definer`, `search_path=''`, ejecutables solo por `service_role`), que llaman a `fel__exigir_permiso` y validan que el actor es miembro activo con MFA verificado (aal2).
- El maestro no recibe ninguna política ni permiso sobre estas tablas. Prueba obligatoria: con la identidad de maestro, `select` devuelve 0 filas o error en documentos, clientes, emisor y credenciales.

## 4. Gestión de secretos: Vault frente a cifrado de sobre
| Requisito | Supabase Vault | Cifrado de sobre (AES-256-GCM en la función) |
|---|---|---|
| Cifrado en reposo y en respaldos | Sí (llave administrada por Supabase, fuera de la base) | Sí (llave maestra como secreto de la función, fuera de la base) |
| Aislamiento por empresa | No lo da: una sola tabla `vault.secrets` sin columna de empresa; el aislamiento depende de nuestra asignación `empresa → id de secreto` | Lo da: el `empresa_id` entra como dato autenticado (AAD); copiar el cifrado de una empresa a otra falla al descifrar |
| Quién puede leer en claro | Quien consulte `vault.decrypted_secrets` (la guía oficial lo marca como el riesgo principal); `service_role` tiene SELECT en esa vista | Solo el código que posee la llave maestra; la base nunca ve el claro |
| Control de acceso | Privilegios SQL sobre una vista que expone todos los secretos juntos | Ningún camino de lectura en la API; el claro vive solo en memoria del resolvedor |
| Rotación | La llave interna no la controlamos | Versión de llave: se descifra con la anterior y se vuelve a cifrar con la nueva |
| Auditoría de uso | Sin registro de lectura por defecto | El resolvedor registra cada uso (sin valores) |
| Pruebas locales y CI | Requiere la extensión (la demo local usa PGlite sin Vault) | Funciona en cualquier PostgreSQL |
| Costo | Incluido | Ninguno |
- **Recomendación: cifrado de sobre.** Mejor aislamiento por empresa (AAD), rotación y auditoría bajo nuestro control, y el claro nunca pasa por SQL. Vault queda como alternativa válida; si se prefiere, se puede intercambiar detrás de la misma interfaz `almacenarCredencial / usarCredencial`.
- Diseño: `credencial_cifrada = versión(1) ‖ nonce(12) ‖ cifrado ‖ etiqueta`, con AAD = `empresa_id ‖ 'digifact' ‖ llave_version`. Llaves: `FEL_CREDENCIALES_LLAVE_V1` (y `_V2` durante una rotación) como secretos de la función. Alta de empresas: no requiere cambiar la llave ni redesplegar.
- Límite que ni Vault ni el cifrado de sobre eliminan: quien comprometa la función puede descifrar. Se mitiga con privilegio mínimo, sin camino de lectura en la API, auditoría de uso, rotación y la llave fuera de la base.
- Estado de Vault en `nexa-demo`: **no verificado**. Existe una acción de solo lectura (`diagnostico-inicial`, privilegios efectivos sobre Vault) lista para correr con tu aprobación.

## 5. Resolvedor de Digifact por empresa (diseño del servicio)
- `ProveedorDigifactPorEmpresa.clienteDe(empresa)`/`emisorDe(empresa)`: lee `empresa_digifact_config` + emisor aprobado, descifra la credencial, crea un `DigifactGt` por empresa y lo guarda en caché 60 s con invalidación al editar (`version`). Falla cerrado si algo falta o no coincide la huella.
- NIT, CUI, correo y certificación se habilitan según las banderas de cada empresa. Los interruptores de entorno actuales pasan a ser el freno global.
- Cambio de credenciales o emisor con operaciones en vuelo: las operaciones preparadas conservan la huella de emisor aprobada (la comprobación actual rechaza las desactualizadas); el `digifact_nit` no cambia tras la primera operación.

## 6. Autenticación: Supabase Auth con MFA (transición segura)
1. Hoy: inicio de sesión propio (`demo_credenciales`: sal+hash, semilla TOTP cifrada, sesión por cookie); `auth.users` ya existe como clave foránea de `miembros`.
2. Fase 1: habilitar contraseña y factor TOTP de Supabase Auth; el servidor exige sesión con nivel `aal2` para `fiscal.certificar`, administrar y todas las funciones del maestro (ayudante SQL `fel_aal2()`).
3. Fase 2 (convivencia): el servidor acepta Supabase Auth y, solo en la demostración, el inicio de sesión propio. Los usuarios existentes se pasan con restablecimiento de contraseña y alta de MFA.
4. Fase 3: el proyecto comercial deshabilita el inicio de sesión propio. Sesiones cortas, cierre remoto y registro de accesos.

## 7. Riesgos
- Compromiso de la función de servidor ⇒ lectura de credenciales (mitigado, no eliminado).
- Pérdida de la llave maestra ⇒ credenciales irrecuperables: se reingresan (nunca se pierden documentos). Respaldar la llave por un canal aparte.
- Muchas empresas ⇒ un token de Digifact por empresa por instancia; los límites de inicio de sesión de Digifact siguen sin documentarse: pedirlos a su soporte técnico.
- Migración 30: estado real sin verificar (acción `verificar-etapa` etapa 4 lista, solo lectura). Las migraciones M-A a M-D no dependen de la 30, pero se aplican después de ella para mantener el historial lineal.
- Transición de autenticación: ventana de convivencia; deshabilitar el inicio de sesión propio solo cuando todos los usuarios tengan MFA.

## 8. Pruebas (PostgreSQL temporal + CI; nada contra la base hospedada)
1. Matriz RLS: usuario de A y de B, lector sin permiso, miembro desactivado, anónimo y maestro, sobre cada tabla y vista nueva.
2. Secretos: `select` de `authenticated` y de maestro nunca devuelve credencial ni versión; la vista no tiene esas columnas; ningún registro, error ni encabezado contiene valores.
3. Cifrado: ida y vuelta; texto cifrado de A copiado a B falla; rotación de llave con descifrado de la versión anterior.
4. Restricciones: NIT único, inmutable tras la primera operación; `ambiente` solo `pruebas`; `certificar` exige estado activo y emisor aprobado; versión aprobada inmutable.
5. Aislamiento del servicio: dos o más empresas con transporte espía (tokens, credenciales y referencias no se mezclan); empresa nueva visible sin reiniciar (en ≤ 60 s); falla cerrado.
6. Concurrencia e idempotencia: las suites actuales siguen verdes; edición simultánea de la configuración (bloqueo optimista); dos certificaciones simultáneas de empresas distintas no se serializan.
7. Maestro: no lee documentos ni credenciales; acceso excepcional (motivo, aprobación de otro maestro, expiración, auditoría de cada lectura, aviso a la empresa).
8. Rendimiento: la ruta de certificación en caliente no suma consultas ni esperas (comparación de consultas por petición con la #55).
9. Reversión: cada migración trae su script de reversión probado.

## 9. Pasos para aprobar uno por uno
- **1A · Verificaciones de solo lectura** (estado real de la migración 30 y de las 29 anteriores; privilegios sobre Vault). Dos ejecuciones de GitHub Actions ya preparadas, cada una con tu aprobación.
- **1B · SQL propuesto** (M-A a M-D) en `docs/multiempresa/propuesta/`, fuera de `supabase/migrations`, con sus pruebas y reversión en PostgreSQL temporal. No se aplica.
- **1C · Servicio de credenciales y resolvedor por empresa** con pruebas de aislamiento y de rendimiento. Apagado por defecto: sin efecto en la demo publicada.
- **1D · API y permisos de administración** (conectar Digifact, probar conexión sin certificar, emisor y aprobación). Sin interfaz todavía.
- **1E · Aplicar migraciones en `nexa-demo`** (después de la 30), con procedimiento de etapa y verificación posterior. Solo con tu autorización expresa.
Siguientes etapas (UI de incorporación en teléfono y computadora, panel del maestro, transición de autenticación, operación comercial) se preparan después.

## 10. Resultados reales de la etapa 1A (solo lectura sobre `nexa-demo`, 26/11/2026) y de la 1B (PostgreSQL temporal)
**1A (ejecuciones 28 y 29 de «solo migraciones», sin cambios en la base):**
- **Migración 30: YA ESTÁ APLICADA y verificada.** 30 migraciones registradas, 71 tablas en `public` con RLS, dependencias de Auth sin faltantes, catálogo de la 29 sano con la 30 aplicada y `verificacion-tipos.sql` con todas las filas correctas.
- **Vault:** `supabase_vault 0.3.2` instalada; `pgsodium` disponible pero no instalada. Privilegios efectivos: `anon` y `authenticated` sin acceso a `vault.secrets` ni a `decrypted_secrets`; `service_role` tiene SELECT (y DELETE) sobre ambas; el esquema no está expuesto por la API. Confirma el riesgo del diseño: quien posea la clave de servicio lee TODOS los secretos de todas las empresas, sin vínculo con la empresa.
- **Hallazgo crítico para la comercialización:** la función se conecta como el rol `postgres` (omite RLS y es propietario de las tablas). Las protecciones de RLS y de privilegios de este diseño aplican a las identidades `authenticated`/`anon`, pero la conexión del servidor las salta. Antes de clientes reales hay que pasar a un rol restringido sin BYPASSRLS (ya anotado en `docs/migracion-29/SEGURIDAD-Y-PERMISOS-29.md`) y probar que las rutas del maestro no consultan documentos, clientes ni configuración fiscal.
**1B (`tools/test-multiempresa.sh`):** migraciones 1–30 + M-D, M-A, M-B, M-C aplicadas; verificación de solo lectura con todas las filas correctas; pruebas funcionales OK (permisos, aislamiento entre empresas, RLS, secretos, acceso excepcional del maestro); reversión que se niega con datos y funciona en limpio; reaplicación. Cinco mutaciones de seguridad (fuga de la credencial, función sin permiso, maestro con política de lectura, credencial en la auditoría, NIT compartido) fueron detectadas por las pruebas. `proveedores/pruebas/credenciales_empresa_test.ts`: 6 pruebas del cifrado AES-256-GCM (vinculación a la empresa, integridad, rotación, errores sin secretos, llaves no exportables); la mutación «sin AAD» fue detectada.

## 11. Etapas 1B-bis (rol de conexión restringido) y 1C (resolvedor de Digifact por empresa) · 26/11/2026
Nada de esto se aplicó en Supabase hospedado, ni sustituye la conexión actual, ni está conectado a la demo publicada.

**1B-bis · `nexa_app` (`docs/multiempresa/propuesta/M-E_rol_app.sql`, `tools/test-rol-app.sh`)**
- Rol sin superusuario, **sin BYPASSRLS**, sin herencia, sin pertenencia a otros roles, **sin propiedad de ninguna tabla ni función**, sin acceso a `auth` ni `vault`. Solo recibe las 86 funciones que el código usa hoy + las 13 nuevas (99 de 194; quedan fuera arranque y administración global como `fel_bootstrap_primer_maestro`) y privilegios mínimos sobre las 51 tablas que la aplicación consulta directamente (lista derivada del código y afinada con el recorrido real: p. ej. `demo_limites`, `demo_intentos` y `demo_simulador_estado` necesitan actualizar).
- Las tablas de credenciales, emisor, eventos de Digifact y accesos del maestro **no tienen privilegios ni política** para `nexa_app`: solo se alcanzan por funciones. Una tabla nueva con RLS y sin política es invisible para el rol (falla cerrado).
- Pruebas conectadas **como el rol real** (conexión real al PostgreSQL temporal): atributos, no puede crear ni alterar objetos, no puede `SET ROLE` a otro rol, no puede concederse privilegios, no puede leer las tablas protegidas, no escribe directamente documentos/clientes/empresas/auditoría, ni borra operaciones; funciones exactamente las previstas. **Compatibilidad:** `tests/rol_app_pg_test.ts` aprovisiona con el administrador (como hoy) y sirve el recorrido real completo de la nube con la base como `nexa_app` (sesión, MFA, factura, certificación simulada, PDF, anulación, otra empresa, panel del maestro) y comprueba en `pg_stat_activity` que la función solo se conectó como `nexa_app`.
- **Auditoría SECURITY DEFINER** (172 funciones tras las propuestas): todas con `search_path` vacío; ninguna ejecutable por `anon`/PUBLIC; `authenticated` solo ejecuta 3 predicados de permisos (`fel_tiene_permiso`, `fel_es_miembro`, `fel_es_admin_plataforma`); propietario `postgres`.
- **Maestro:** el enrutador manda al maestro SIEMPRE a `rutasMaestro` (nunca a rutas de empresa) y sus consultas no tocan documentos, clientes, conceptos, operaciones, artefactos, auditoría, credenciales ni configuración fiscal (guardián estático `tests/maestro_aislamiento_test.ts`, con mutación comprobada); en el recorrido real, el maestro no alcanza `/api/documentos…` y su resumen no trae datos fiscales. El acceso excepcional (M-C) sigue exigiendo aprobación de otro maestro, vencimiento ≤ 24 h y auditoría de cada lectura.
- Mutaciones de seguridad detectadas por las pruebas: BYPASSRLS, escritura directa en documentos, lectura de la tabla de credenciales (con o sin política), `grant execute on all functions`, membresía en `service_role`, propiedad de una tabla, acceso a `auth`.
- **Riesgos residuales (no resueltos):** (1) `nexa_app` puede llamar a las funciones `fel_op_*` con cualquier `p_actor`/`p_empresa`: el servidor sigue siendo la frontera de confianza; proteger el secreto de conexión y, más adelante, atar el actor con `auth.uid()` en vez de un parámetro. (2) Para las tablas que la aplicación consulta directamente, la política de `nexa_app` es `using (true)`: el aislamiento por empresa lo siguen imponiendo el SQL de la aplicación y los permisos de las funciones, no RLS; el siguiente nivel sería políticas por empresa con un parámetro de sesión por petición (cambio mayor en la capa de datos). (3) Las funciones SECURITY DEFINER pertenecen a `postgres` (omite RLS): su control interno de permisos es lo único que las protege. (4) Falta validar en el pooler hospedado (formato del usuario, contraseña como secreto, creación del rol): es el trabajo del paso 1E, con tu autorización.

**1C · resolvedor (`proveedores/src/digifact_multiempresa.ts`, `proveedores/pruebas/digifact_multiempresa_test.ts`, 7 pruebas)**
- `ResolvedorDigifact`: lee (en un solo viaje) la configuración activa y el emisor aprobado de ESA empresa, descifra con AES-256-GCM vinculado al `empresa_id`, verifica que el emisor coincide con su huella aprobada y crea el cliente de Digifact (y su token) propios. Caché positiva de 60 s, negativa de 30 s, de error de 5 s, una sola carga a la vez por empresa y máximo 500 empresas; al vencer con la misma configuración conserva el cliente y su token. Cualquier fallo deja a la empresa **sin canal** y solo registra códigos.
- `crearServicioMultiempresa`: fachada con la misma interfaz que usan las rutas; asegura la resolución de la empresa del contexto y delega en UN `ServicioFelGt` compartido que solo ve el cliente y el emisor de esa empresa. Cambio único en el servicio existente: `autorizaPruebaDe(empresaId)` opcional (el interruptor `certificar` por empresa); sin él todo funciona exactamente igual. Las consultas de NIT respetan el interruptor de cada empresa.
- Pruebas (cliente REAL de Digifact con transporte simulado): cada empresa usa solo su usuario, su clave, su NIT y su token; certificaciones concurrentes de dos empresas sin mezclarse; el mismo documento dos veces simultáneas = un solo envío; una empresa no certifica el documento de otra; empresa nueva sin reiniciar; suspendida, reemplazada o desconectada se respeta; cifrado de A copiado a B, alterado o con huella que no coincide ⇒ sin canal y sin secretos en registros. Cuatro mutaciones (mezcla de empresas, ignorar el interruptor, sin carga única, descifrar con otra empresa) detectadas.
- **Rendimiento:** el resolvedor no está en la ruta de la #55 (no está conectado). Con la caché vigente cuesta 0 consultas (100 validaciones seguidas = 0 lecturas). La carga cuesta 1 lectura al abrir o al vencer (60 s).
- **Falta para activarlo (1D/1E, con tu autorización):** `leer` real sobre `fel_sys_digifact_credencial` y `fel_sys_emisor_vigente` en un lote de la base; conexión en `nube/funcion.ts` detrás de un interruptor apagado por defecto; consultores de NIT y CUI por empresa para el autollenado del receptor; API de administración (conectar, probar sin certificar, emisor y aprobación); llaves `FEL_CREDENCIALES_LLAVE_V1` como secretos de la función; aplicar M-D, M-A, M-B, M-C y M-E y pasar la conexión a `nexa_app`; interfaz de incorporación.
