# Respaldo real de `nexa-demo` antes de la etapa 3 — análisis y propuesta

Estado: **análisis y desarrollo local. Nada de esto se ha ejecutado contra `nexa-demo`.** La fase 1 y `verificar-respaldo` están **implementadas en local** (sin commit ni publicación): `tools/respaldo-nexa-demo.sh`, `tools/test-respaldo-nexa-demo.sh` y `.github/workflows/respaldo-nube.yml`. La fase 2 (R2) solo está **documentada** en `RESPALDO-FASE-2-CLOUDFLARE-R2.md`. Complementa `RESPALDO-Y-RECUPERACION-29.md` (opciones, escenarios y ensayo local).

## 1. Qué hay que proteger frente a la migración 29
La 29 es **aditiva**: crea 2 tablas (`digifact_operaciones`, `digifact_artefactos`), 3 funciones, disparadores e índices, y la CLI añade **una fila** al historial. No modifica ni borra ninguna tabla, función, política ni dato de las migraciones 1–28 (probado: la etapa 3 verifica que el catálogo de la 28 sigue sano).

| Qué | Por qué importa | Va en el respaldo |
|---|---|---|
| Esquema `public` (estructura, datos y permisos de las 67 tablas) | Es lo que la 29 toca por vecindad; un error de aplicación o de reversión actúa sobre él | **Sí** |
| `supabase_migrations.schema_migrations` (28 filas) | La etapa 3 exige EXACTAMENTE las 28; `migration repair` y `db push` la modifican | **Sí** |
| Privilegios (ACL) y privilegios por defecto de `public` | El catálogo de la 28 los verifica; una restauración los puede inflar (lo detectó el ensayo) | **Sí** (con el procedimiento de «destino limpio») |
| Usuarios de Auth (`auth.users`, factores MFA) | La app los usa por FK; **la 29 no los toca** | **No** (se recrean con `aprovisionar`) |
| Vault, Storage, funciones Edge, ajustes de Auth, claves y secretos de GitHub/Cloudflare | No son de la base `public`; la 29 no los toca | **No** (ver §5) |

**Consideración de proporcionalidad.** `nexa-demo` solo tiene datos simulados y se puede recrear desde las 29 migraciones. El valor real del respaldo es (a) volver al estado exacto de antes de la 29 sin reconstruir y (b) **entrenar el procedimiento**: lo importante vendrá **después** de la 29, cuando existan operaciones fiscales (TEST) que sí convendrá respaldar.

## 2. Respaldos automáticos del plan
- Los docs internos dicen «plan Free»: **no confirmado**. Según Supabase, Free **no** tiene copias automáticas ni descarga; Pro tiene diarias con 7 días; PITR es un complemento de pago.
- **Se puede confirmar sin tocar nada**: `GET /v1/projects/<ref>/database/backups` (API de gestión, solo lectura) devuelve `pitr_enabled`, la lista de copias y las fechas. El flujo ya tiene `DEMO_SUPABASE_ACCESS_TOKEN`; una acción `verificar-respaldo` (solo lectura, sin secretos nuevos, que imprima solo plan/fechas/cantidad) lo haría **sin que tengas que entrar al panel**. **No implementada.**
- Mientras no se confirme, el plan se trata como **sin respaldo automático**.

## 3. ¿Se puede hacer el respaldo desde GitHub sin instalar nada? Análisis
**Sí.** Un flujo manual y protegido (`demo-privada`, aprobación tuya) puede correr `pg_dump` en el ejecutor de GitHub (que no requiere que instales nada). Hechos técnicos:
- `pg_dump` es **solo lectura por sí mismo** (abre `BEGIN … ISOLATION LEVEL REPEATABLE READ, READ ONLY`). Debe usar el **Session Pooler (5432)**, no el puerto 6543; el script ya sabe derivarlo de `DEMO_BD_URL`.
- El servidor es **PostgreSQL 17.11**; el ejecutor trae por defecto el cliente 16 y `pg_dump` **no vuelca un servidor más nuevo que él**: hay que instalar `postgresql-client-17` (repositorio oficial de PostgreSQL) en el flujo. A confirmar en la primera corrida.
- Permisos: `permissions: contents: read`; secretos solo `DEMO_SUPABASE_PROYECTO_REF` y `DEMO_BD_URL` (ya existen); cero secretos nuevos para la fase 1.
- El volcado queda en el disco **efímero** del ejecutor y se destruye al terminar; el registro solo muestra tamaño, SHA-256 y conteos (nada de contenido).

### Fase 1 — «ensayo de respaldo» (sin que ningún archivo salga de GitHub)
1. `pg_dump -Fc --schema=public --schema=supabase_migrations` de `nexa-demo`.
2. SHA-256 y `pg_restore --list` (debe listar `TABLE DATA public empresas` y `supabase_migrations schema_migrations`).
3. **Restaurar en un PostgreSQL 17 efímero del propio ejecutor** (no en Supabase) con el procedimiento de «destino limpio» ya ensayado (sin recrear `public`, retirando los privilegios por defecto de `anon`/`authenticated`/`service_role`).
4. Comprobar: mismos conteos que el origen, 28 migraciones, la 29 ausente, **catálogo de la 28 sano** en una transacción de solo lectura.
5. Publicar **solo** el informe (tamaño, SHA-256, conteos, «restaurable: sí/no»). **El archivo no se sube a ningún sitio** (ni artefacto, ni caché, ni release). Un guardián automático de `verificar-publicacion.py` fallará si ese flujo contiene `upload-artifact`, `actions/cache`, `gh release` o `git push`.
**Qué demuestra:** que una copia lógica de `nexa-demo` **se puede producir y restaurar sin errores y deja la base sana**. **Qué no da:** una copia conservada (el archivo se descarta).

### Fase 2 — copia conservada (solo si la quieres; requiere secretos nuevos y tu decisión)
| Destino | Riesgos / permisos | Veredicto |
|---|---|---|
| Artefacto de GitHub **cifrado** con clave pública | Cualquiera con lectura del repositorio puede descargar el texto cifrado; sin tu clave privada no sirve. Va contra tu criterio | Posible, **no recomendado** |
| **Cloudflare R2** (bucket privado, cifrado en el ejecutor) | Secretos nuevos: id de cuenta y un token S3 de **lectura y escritura limitado a un bucket** (R2 no ofrece un permiso de solo escritura; corregido respecto a una versión anterior de este análisis); el archivo llega **ya cifrado con tu clave pública** (el ejecutor solo tiene la pública); nombre único con fecha para no sobrescribir | **Recomendado** |
| Storage de Supabase | Dentro de lo mismo que se respalda | **No** |
| Descarga y `pg_dump` en tu computadora | Exige instalar herramientas; es lo que quieres evitar | Plan B |
La **clave privada** (para descifrar) la generas tú y **nunca** entra a GitHub; si se pierde, el respaldo es inservible: se guarda en un gestor de contraseñas o en papel.

## 3 bis. Consistencia de la copia y qué compara la restauración efímera
- **Una sola instantánea.** Una sesión de solo lectura (`REPEATABLE READ`) exporta una instantánea (`pg_export_snapshot`) y la mantiene abierta; los conteos, la huella de contenido de cada tabla, la estructura y el `pg_dump --snapshot` leen **esa misma instantánea**. Nada se compara con datos de otro momento.
- **Modificación legítima vs restauración incorrecta.** Lo que cambie en el origen **después** de la instantánea no afecta a la copia ni a la comparación y solo se informa («INFO … cambió DESPUÉS de la instantánea»). Si lo restaurado difiere de la instantánea, **es** una restauración incorrecta y el ensayo falla. Si no se puede exportar la instantánea, el ensayo falla: sin ella no se puede garantizar la consistencia ni dar la copia por restaurable.
- **Qué se compara (mismo SQL en el origen y en lo restaurado):** filas y huella MD5 del contenido de cada tabla de `public` y `supabase_migrations`; historial de las 28 migraciones (iguales a las del repositorio) y la 29 ausente; columnas, restricciones, índices, disparadores, políticas, funciones (con su huella, `SECURITY DEFINER` y `search_path`), ACL de esquemas, tablas, secuencias y funciones, propietarios, **privilegios por defecto** y **privilegios efectivos de `anon`, `authenticated` y `service_role`** sobre cada objeto; y el catálogo de la 28.
- **Limitaciones declaradas (no son prueba aprobada):** no se reproducen los atributos ni las membresías de los roles (los roles que la copia menciona y el destino no tiene se crean vacíos); los propietarios distintos de `postgres` no se restauran (`--no-owner`); las expresiones `CHECK` y de políticas se comparan sin paréntesis (el volcado puede aplanarlos); extensiones y su configuración, disparadores de evento de la plataforma y todo lo que está fuera de `public` y `supabase_migrations` (auth, storage, vault) no entran; los usuarios de Auth se sustituyen por usuarios de prueba.

## 4. Cómo comprobaremos que realmente se puede restaurar
1. Ya probado en local (PostgreSQL de prueba): respaldo → listado → SHA-256 → restauración en una base aparte → mismos datos → catálogo de la 28 sano → 29 ausente (`supabase/tests/respaldo_restauracion_29.sh`).
2. La **fase 1** repite exactamente eso contra una copia **real** de `nexa-demo` y restaura en un PostgreSQL 17 efímero.
3. Sin probar todavía: restauración sobre **Supabase hospedado** (otro proyecto desechable). Solo con tu autorización.

## 5. Qué queda fuera de la copia
`auth` (usuarios, MFA, sesiones), Vault, Storage, código y secretos de las funciones Edge, ajustes de Auth, claves de API, extensiones y su configuración, y los secretos de GitHub y Cloudflare. Los usuarios se recrean con `aprovisionar`; lo demás se reconstruye desde el repositorio.

## 6. Qué haces tú
- **Fase 1:** nada instalado. Solo aprobar el entorno `demo-privada` cuando lancemos el flujo.
- **Fase 2 (opcional):** crear el bucket privado y un token de R2 con permiso **Object Read & Write limitado a ese bucket**; generar tu par de claves (la privada solo tuya); cargar tres secretos nuevos en el entorno `demo-privada` (cuenta, token, clave pública).

## 7. Qué necesitamos para autorizar la etapa 3
1. Plan confirmado (acción `verificar-respaldo` o el panel) y, si hubiera copias, la hora de la última.
2. Fase 1 ejecutada con resultado «restaurable: sí» (o, si prefieres, una copia propia restaurada y comprobada).
3. Si se decide la fase 2: copia cifrada guardada y comprobada.
4. Tokens vigentes (`DEMO_SUPABASE_ACCESS_TOKEN`, contraseña de la base).
5. Aceptación del rol `postgres` con `BYPASSRLS` solo para TEST.
6. Autorización independiente y aprobación de `demo-privada` para `migraciones-etapa` 3.
