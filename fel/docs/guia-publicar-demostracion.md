# Guía sencilla: publicar la demostración privada de NEXA FEL (Cloudflare + Supabase)

**Antes de empezar:** nada de esto está hecho; no se despliega nada hasta que lo autorices. Todo cuesta US$0 con los planes gratuitos (confirma los límites vigentes en las páginas de Cloudflare y Supabase). **No me pegues contraseñas, claves ni cadenas de conexión en el chat**: se escriben solo en tu terminal o en los paneles de Cloudflare/Supabase.

## Qué haces tú y qué hago yo
| Tú (personalmente) | Yo |
|---|---|
| Crear las cuentas/proyectos en Supabase y Cloudflare (tus datos y, si lo pidieran, tu tarjeta) | Mantener el código, las pruebas y esta guía |
| Copiar las claves desde los paneles a tu terminal | Nunca ver ni tocar tus claves |
| Registrar el código MFA en tu teléfono | Revisar el resultado de la prueba de humo que me describas |
| Ejecutar los comandos de abajo (o autorizarme a guiarte uno por uno) | |

## Preparación (una vez, en tu computadora)
Instala **Deno** (https://deno.com), **Node.js** y la **CLI de Supabase** (https://supabase.com/docs/guides/cli). Abre una terminal en la carpeta `fel` del proyecto.

## Paso 1 · Proyecto Supabase NUEVO (no el principal de NEXA)
1. En supabase.com crea un proyecto nuevo llamado, p. ej., `nexa-demo` (plan Free). **No uses el proyecto principal.**
2. Anota (en un bloc de notas, no en el chat): la **referencia** (las 20 letras de `https://<referencia>.supabase.co`), la **contraseña de base de datos** que elegiste, y desde *Project Settings → API*: la **URL** y la clave **service_role** (la larga que empieza por `eyJ`; si tu panel solo muestra claves nuevas, usa la «secret key» que empieza por `sb_secret_`).
3. En *Project Settings → Database → Connection string* copia la cadena del **Transaction pooler** (puerto 6543).

## Paso 2 · Aplicar la estructura de datos
```
supabase login
supabase link --project-ref <REFERENCIA> --workdir .
supabase db push --workdir .
```
Esto aplica las migraciones al proyecto **nuevo** (son aditivas; no tocan otros proyectos). Comprueba en pantalla que el proyecto enlazado es `nexa-demo`.

## Paso 3 · Generar contraseñas y MFA
```
deno run demo-facturacion/src/generar_secretos.ts
```
Te muestra una contraseña por usuario y la clave MFA de los administradores (`maestro`, `maestro2`): **guárdalas en tu gestor de contraseñas** y agrega el MFA a tu aplicación de autenticación (Google Authenticator, Authy…). El programa también te muestra las líneas `FEL_DEMO_CLAVES=…` y `FEL_DEMO_MFA_SEMILLAS=…` que usarás abajo. Genera además un secreto para unir Cloudflare con Supabase: `openssl rand -hex 32` (o cualquier texto aleatorio de 40+ caracteres).

## Paso 4 · Publicar (un solo comando)
Con las variables definidas en tu terminal (nunca en el chat ni en archivos del repositorio):
```
export FEL_DEMO_PROYECTO_REF='<REFERENCIA>'           # protección: debe coincidir con la URL y la conexión
export SUPABASE_ACCESS_TOKEN='<token personal de Supabase>'   # Account → Access Tokens
export SUPABASE_DB_PASSWORD='<contraseña de la base>'
export FEL_DEMO_BD_URL='<cadena del Transaction pooler>'
export SUPABASE_URL='https://<REFERENCIA>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<clave service_role>'
export FEL_DEMO_CLAVES='<línea generada en el paso 3>'
export FEL_DEMO_MFA_SEMILLAS='<línea generada en el paso 3>'
export FEL_PROXY_SECRETO='<secreto del paso 3>'
export CLOUDFLARE_API_TOKEN='<token de API de Cloudflare con «Cloudflare Pages: Edit»>'
export CLOUDFLARE_ACCOUNT_ID='<id de tu cuenta de Cloudflare>'
export PAGES_PROYECTO='<nombre>'                      # la página será https://<nombre>.pages.dev
bash tools/publicar-nube.sh --simular   # solo comprueba y muestra el plan
bash tools/publicar-nube.sh             # ejecuta todo en orden y se detiene en el primer fallo
```
Qué hace, en orden: comprueba que la referencia coincide → aplica las migraciones al proyecto **nuevo** → siembra la base y crea los usuarios con la API oficial de Supabase Auth → construye → sube la función de Supabase (secretos desde un archivo temporal que se borra) → crea el proyecto de Pages, carga `FUNCION_URL` y `PROXY_SECRETO` como secretos y sube la página **con Wrangler** → ejecuta la prueba de humo contra la dirección real.

**Por qué Wrangler:** la subida desde el panel de Cloudflare no admite una carpeta `functions`. La página lleva el intermediario como un único archivo `_worker.js` (modo avanzado) más `_routes.json` (solo `/api/*` lo invoca); Wrangler lo sube sin problemas. Cómo crear el token: dash.cloudflare.com → *My Profile → API Tokens → Create Token* con permiso *Account · Cloudflare Pages · Edit*; el id de cuenta aparece en la página principal de *Workers & Pages*.

## Alternativa: que yo lo despliegue (sin que ejecutes comandos)
Desde mi entorno no puedo llegar a Supabase ni a Cloudflare (la red está restringida: probé `api.supabase.com` y `api.cloudflare.com` y responden 403, y no hay salida directa a PostgreSQL), así que el despliegue corre en **GitHub Actions**, que sí tiene red, con tus secretos guardados en GitHub (nunca en el chat):
1. En el repositorio: *Settings → Environments → New environment* → nombre **`demo-privada`** → activa **Required reviewers** y agrégate a ti (así nada se publica sin tu clic de aprobación).
2. En ese entorno, *Add secret* para cada uno de estos nombres (los valores salen de los pasos 1 y 3): `FEL_DEMO_PROYECTO_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `FEL_DEMO_BD_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FEL_DEMO_CLAVES`, `FEL_DEMO_MFA_SEMILLAS`, `FEL_PROXY_SECRETO`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PAGES_PROYECTO`.
3. Me escribes «**autorizo la publicación**». Yo hago el commit que lanza el flujo `publicar-nube.yml`; tú apruebas la ejecución en la pestaña *Actions* (botón *Review deployments*).
4. Yo leo el resultado, te paso la URL y la prueba de humo. Si algo falla, el flujo se detiene en ese paso y lo corrijo.

## Paso 5 · Prueba desde tu teléfono
(La prueba de humo automática ya corrió al final del paso 4.) Abre `https://<nombre>.pages.dev`: entra como `ana` (contraseña del paso 3) → crea un cliente y una factura con varios ítems → certifícala (simulada) → descarga el PDF → cierra sesión y vuelve a entrar → comprueba que todo sigue. Luego entra como `maestro` con el código MFA. Si algo falla, copia **solo el mensaje de error** (sin claves) y lo reviso.

## Si algo sale mal / para apagar
- Pausar o borrar el proyecto de Supabase y el de Cloudflare detiene todo; no hay cobros si usas los planes gratuitos.
- Para rotar contraseñas: repite los pasos 3 y 4.
- Plan B ya preparado si la función de Supabase diera problemas: contenedor en Fly.io (≈ US$5–8/mes), `demo-facturacion/despliegue/fly.toml`.
