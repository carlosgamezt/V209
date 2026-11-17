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
