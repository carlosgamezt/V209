# NEXA FEL · Fase A preparada: `verificar-api-vault` (#8) y validación inicial de Supabase
Estado: 17/11/2026. **Nada de esto se ha ejecutado por mi parte desde que lo pediste; todo es de solo lectura y cada paso lo apruebas tú en `demo-privada`.** Meta: llegar cuanto antes a una URL de demostración funcional para Android y PC sin saltarse ningún control.

## 1. Qué secretos usa esta fase (solo nombres; los valores nunca se ven ni se pegan)
| Paso | Secretos del entorno `demo-privada` | ¿Ya existen? |
|---|---|---|
| `verificar-inicial` (A2) | `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL` | **Sí**: la ejecución #7 los usó y dio 0 REVISAR |
| `verificar-api-vault` (A1 · #8) | `DEMO_SUPABASE_PROYECTO_REF`, **`DEMO_SUPABASE_ANON_KEY`** | La referencia sí. **La clave pública: no lo sé** (no puedo listar secretos) |
Cómo comprobarlo: GitHub → repositorio → *Settings → Environments → demo-privada → Environment secrets*: muestra solo los nombres. Si falta `DEMO_SUPABASE_ANON_KEY`, la ejecución #8 se detiene sola antes de enviar nada, con «Falta FEL_DEMO_ANON_KEY…».

## 2. Si falta `DEMO_SUPABASE_ANON_KEY` (lo creas tú)
1. Supabase → proyecto `nexa-demo` → *Project Settings → API (API Keys)* → copia la clave **pública**: la `anon` (JWT que empieza por `eyJ…`) **o** la «publishable» (`sb_publishable_…`).
2. GitHub → *Settings → Environments → demo-privada → Add environment secret* → nombre exacto `DEMO_SUPABASE_ANON_KEY` → pega la clave.
3. **Nunca** `service_role`, `sb_secret_…` ni la de otro proyecto: el verificador las rechaza antes de hacer ninguna petición.

## 3. Orden exacto de la Fase A (de uno en uno)
| # | Qué | Cómo | Resultado posible | Yo después |
|---|---|---|---|---|
| A1 | `verificar-api-vault` | Aprobar en `demo-privada` la ejecución **#8** (ya está en espera): https://github.com/carlosgamezt/V209/actions/runs/43955049367 | **OK** (la API no expone `vault`) · **REVISAR** (lo expone) · **NO VERIFICADO** (no se pudo comprobar; nunca se toma por seguro) | Leo el registro (sin claves) y te presento el resultado exacto, distinguiendo acceso por API de privilegios de PostgreSQL |
| A2 | `verificar-inicial` (justo antes de migrar) | **Solo después** de que #8 termine: lanzo `migraciones-nube` con `accion=verificar-inicial` y tú la apruebas | 0 REVISAR · o diferencias que se presentan sin ajustar nada | Te presento las filas; si hay cualquier REVISAR, me detengo |
**Importante (concurrencia):** los dos flujos comparten el grupo `publicar-nube`; GitHub guarda solo la ejecución pendiente más reciente. Lanzar A2 mientras #8 espera **cancelaría #8**. Por eso A2 se lanza únicamente cuando #8 haya terminado.

## 4. Qué decide cada resultado de A1
- **OK:** se sigue con A2 y luego la Fase B.
- **REVISAR (vault expuesto):** me detengo y te propongo cómo cerrarlo en los ajustes de la API del proyecto (sin tocar esquemas ni permisos por mi cuenta); no se migra hasta resolverlo.
- **NO VERIFICADO:** se explica la causa (clave inválida, red, 401…) y se repite tras corregirla; no se continúa como si fuera seguro.
Nota: el privilegio directo de PostgreSQL de `service_role` sobre `vault` ya está verificado (diagnóstico #5) y no depende de A1; por eso las credenciales de Digifact **no** irán a Vault.

## 5. Después de la Fase A (camino más corto hacia la URL, sin atajos de seguridad)
B1 etapa 1 → V1 → B2 etapa 2 → V2 → C1 `publicar-nube` en modo `verificar` → C2 `publicar` (Digifact apagado) → C3 URL verificada con la prueba de humo. Detalle y criterios de parada: `OPERACIONES-HABILITAR-DEMO-NUBE.md`. Son 6 aprobaciones tuyas (A1, A2, B1, B2, C1, C2) en `demo-privada` y, antes de C1, comprobar que existen los 12 secretos `DEMO_*` de publicación (lista en `PREPARACION-DEMO-NUBE.md` §4).

## 6. Corrección de la sonda tras la ejecución #9 (local, sin subir ni ejecutar)
#9 dio NO VERIFICADO: la sonda de control (GET a la raíz «/rest/v1/», que devuelve el listado OpenAPI) recibió **HTTP 401**. Supabase retiró ese listado a las claves públicas (aviso «Breaking Change: Removing access to OpenAPI spec via the anon key»), así que el 401 de la raíz no prueba que la clave sea mala. Ahora ambas sondas piden una **tabla inexistente** (`fel_sonda_inexistente?limit=0`; no se lee ningún dato): control = 404 `PGRST205`/`42P01` (clave válida y `public` expuesto); vault = 406 `PGRST106` sin `vault` en la lista → OK; 404/200 con el perfil `vault` o `vault` en la lista → REVISAR; 401, 403, 500, red o cualquier otra cosa → NO VERIFICADO (nunca seguro). Pendiente: tu autorización de push y de una ejecución nueva (#10).

## 7. A1 CERRADA: ejecución #12 (commit `b849c05`) = OK
Control `public`: HTTP 404 `PGRST205` (clave publicable válida). Sonda `vault`: HTTP 406 `PGRST106`; esquemas expuestos por la API: `public, graphql_public` → **`vault` NO está expuesto por la API de datos**. Solo lectura; nada se modificó. (Lo que sigue pendiente de seguridad en `vault` son los privilegios directos de PostgreSQL de `service_role`, ya conocidos: por eso Digifact no usa Vault.)

## 8. A2 preparada (`verificar-inicial`), NO ejecutada
- **Cómo:** `migraciones-nube.yml` · `accion=verificar-inicial` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`. Sin confirmaciones de escritura: no existe ruta a `db push`.
- **Secretos que usa:** `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL` (ya usados por #7 con 0 REVISAR). No necesita `DEMO_SUPABASE_ANON_KEY`.
- **Qué hace:** una conexión por el Session Pooler, sesión y transacción de solo lectura, SQL solo SELECT (`docs/migracion-28/verificacion-inicial-nexa-demo.sql`); confirma «sesión de solo lectura | on | on | OK».
- **Se detiene si:** cualquier `REVISAR`, huella de `rls_auto_enable` distinta, o la sesión no queda confirmada como de solo lectura.
- **Condición previa:** que no haya otra ejecución pendiente en el grupo `publicar-nube` (ya no la hay; #12 terminó).
- **Después:** B1 etapa 1 (`APLICAR-MIGRACIONES`), con autorización específica.

## 9. A2 CERRADA: ejecución #13 (commit `f39149d`) = 0 REVISAR
19 comprobaciones OK, 12 informativas (INFO), **0 REVISAR**; sesión confirmada de solo lectura. Base vacía: 0 tablas en `public`, sin historial de migraciones (las 28 aprobadas están pendientes: 27 de la etapa 1 + la 28), 0 funciones propias no reconocidas, `public.rls_auto_enable()` reconocida por huella, PostgreSQL 17.11, dependencias de Auth completas. Informativo conocido: `service_role` tiene USAGE sobre `vault` (ya registrado; Digifact no usa Vault).

## 10. B1 preparada, NO ejecutada (primera operación que MODIFICA nexa-demo)
- **Cómo:** `migraciones-nube.yml` · `accion=migraciones-etapa` · `etapa=1` · `confirmar=APLICAR-MIGRACIONES` · rama `fel-proveedores-diseno` · aprobación en `demo-privada`.
- **Secretos:** `DEMO_SUPABASE_PROYECTO_REF`, `DEMO_BD_URL`, `DEMO_SUPABASE_ACCESS_TOKEN`, `DEMO_SUPABASE_DB_PASSWORD` (los dos últimos solo los usa este paso). Confirmar que existen antes: si faltan, el flujo falla sin aplicar nada.
- **Qué aplica:** migraciones 1–27 (exige base vacía y sin historial, como confirma A2). V1 automática al terminar (solo lectura): 27 registradas, 67 tablas con RLS, dependencias de Auth sin faltantes, 0 filas.
- **Se detiene si:** V1 da cualquier cifra distinta; entonces NO se lanza la etapa 2 y la recuperación es un proyecto Supabase nuevo (`PROPUESTA-FINAL-APLICACION-SEGURA.md` §1).
- **Después:** B2 (etapa 2, migración 28) solo con otra autorización, sin cargar datos entre ambas.

## 11. B1 EJECUTADA: ejecución #14 (commit `c8bd7d6`) = OK
Etapa 1 aplicada en `nexa-demo`: las 27 migraciones, una por una, sin errores. V1 de la propia ejecución: 27 registradas, RLS activo en las **67** tablas, dependencias de Auth sin faltantes; `service_role` con USAGE sobre `vault` (conocido), `anon`/`authenticated` sin él. La etapa 2 NO se ha aplicado.
**Limitación detectada:** V1 (código de la ejecución #14) NO comprobaba políticas, privilegios efectivos ni filas, aunque los documentos lo decían. Se refuerza (ver §12).

## 12. V1 reforzada (local, probada en PostgreSQL con las 27 migraciones; pendiente de subir)
`docs/migracion-28/verificacion-posterior-27.sql` (solo lectura, mismo mecanismo que el de la 28) comprueba tras la etapa 1: RLS en toda tabla; `anon` sin ningún privilegio y `authenticated` solo SELECT; políticas solo de lectura y con condición de empresa; sin vistas; SECURITY DEFINER con `search_path` y sin acceso de `anon`; CASCADE solo en la lista conocida; **67 tablas, 49 políticas, 182 funciones, 57 disparadores**; `anon` sin funciones ejecutables y `authenticated` solo `fel_es_admin_plataforma`, `fel_es_miembro`, `fel_tiene_permiso`; `anon`/`authenticated` sin USAGE en `vault`; **0 filas de negocio** (solo las 9 tablas de semillas con su número exacto, `empresas`=0); semillas «falla cerrado» (`emision_real_disponible=false`, proveedores solo `simulado`, regímenes `sin_verificar`). `supabase-hospedado.sh verificar-etapa 1` y `migraciones-etapa 1` lo ejecutan. Probado: pasa sobre las 27 migraciones y detecta 5 alteraciones provocadas (GRANT a `anon`, escritura a `authenticated`, ejecución de función por `anon`, fila ajena a las semillas…).
**Para ejecutarla en la nube:** autorizar el push de este commit y lanzar `verificar-etapa` · `etapa=1` (solo lectura; aprobación en `demo-privada`).

## 13. B2 preparada, NO ejecutada
- **Antes:** `verificar-etapa 1` con la V1 reforzada en verde (§12).
- **Cómo:** `migraciones-nube` · `migraciones-etapa` · `etapa=2` · `confirmar=APLICAR-MIGRACIONES`. Exige EXACTAMENTE las 27 registradas; sin cargar datos entre etapas.
- **Qué aplica:** migración 28 (empresas no se borran ni se vacían, `service_role` pierde DELETE/TRUNCATE, disparadores sin EXECUTE, FK compuesta en `ordenes_confirmaciones`). V2 automática: 28 registradas y `verificacion-posterior-28.sql` (catálogo completo).
- **Después (sin atajos):** C1 `publicar-nube` modo `verificar` (comprueba los 12 secretos `DEMO_*` y la conectividad sin tocar nada) → C2 `publicar` con `digifact=apagado` y `PUBLICAR` → C3 URL entregada solo tras la prueba de humo; luego recorrido en Android y PC con `GUIA-PRIMERA-SESION.md`.

## 14. V1 reforzada EJECUTADA en la nube: ejecución #15 (commit `1a3f947`, `verificar-etapa` etapa 1) = OK
27 registradas; RLS en las 67 tablas; Auth sin faltantes; `vault`: `anon`/`authenticated` sin USAGE (`service_role` sí, conocido); `verificacion-posterior-27.sql` en verde: 67 tablas, 49 políticas, 182 funciones, 57 disparadores, `anon` sin privilegios ni funciones, `authenticated` solo SELECT y solo 3 funciones, 0 filas de negocio (solo las 9 tablas de semillas con su número exacto), `emision_real_disponible=false`, proveedores solo `simulado`, regímenes `sin_verificar`. **B2 lista para autorizar** (§13).
