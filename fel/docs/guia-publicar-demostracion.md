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

## Paso 4 · Cargar los datos de la demostración (aprovisionar)
En la misma terminal (los valores quedan solo en esa sesión):
```
export FEL_DEMO_BD_URL='<cadena del Transaction pooler>'
export SUPABASE_URL='https://<REFERENCIA>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<clave service_role>'
export FEL_DEMO_PROYECTO_REF='<REFERENCIA>'
export FEL_DEMO_HOSTS='<nombre>.pages.dev'          # el nombre que tendrá tu página en Cloudflare
export FEL_DEMO_CLAVES='<la línea generada>'
export FEL_DEMO_MFA_SEMILLAS='<la línea generada>'
deno run -A demo-facturacion/nube/aprovisionar.ts
```
El programa se niega si la referencia no coincide con la conexión (protección contra equivocarse de proyecto) o si la base ya tiene empresas ajenas. Los usuarios se crean con la API oficial de Supabase Auth (el CI lo comprueba contra Auth local real).

## Paso 5 · Publicar la función de Supabase
```
deno run -A demo-facturacion/nube/construir.ts
supabase secrets set --project-ref <REFERENCIA> FEL_DEMO_BD_URL="$FEL_DEMO_BD_URL" FEL_DEMO_HOSTS="$FEL_DEMO_HOSTS" FEL_DEMO_MFA_SEMILLAS="$FEL_DEMO_MFA_SEMILLAS" FEL_PROXY_SECRETO='<el secreto del paso 3>'
supabase functions deploy nexa-demo --project-ref <REFERENCIA> --workdir dist/nube/funcion --no-verify-jwt
```
(La URL y la clave de servicio de Supabase ya las recibe la función automáticamente de la plataforma.)

## Paso 6 · Publicar la página en Cloudflare Pages
1. En dash.cloudflare.com → *Workers & Pages* → *Create* → *Pages* → **Upload assets** (subida directa). Nombre del proyecto = el de `FEL_DEMO_HOSTS` sin `.pages.dev`.
2. Sube la carpeta `dist/nube/pagina`.
3. En *Settings → Variables and Secrets* agrega, como **Secret** (cifradas): `FUNCION_URL` = `https://<REFERENCIA>.supabase.co/functions/v1/nexa-demo` y `PROXY_SECRETO` = el mismo secreto del paso 3. Vuelve a desplegar para que las tome.
4. Opcional y gratuito: *Zero Trust → Access* para pedir tu correo antes de ver la página.

## Paso 7 · Prueba de humo desde tu teléfono
Abre `https://<nombre>.pages.dev`: entra como `ana` (contraseña del paso 3) → crea un cliente y una factura con varios ítems → certifícala (simulada) → descarga el PDF → cierra sesión y vuelve a entrar → comprueba que todo sigue. Luego entra como `maestro` con el código MFA. Si algo falla, copia **solo el mensaje de error** (sin claves) y lo reviso.

## Si algo sale mal / para apagar
- Pausar o borrar el proyecto de Supabase y el de Cloudflare detiene todo; no hay cobros si usas los planes gratuitos.
- Para rotar contraseñas: repite los pasos 3 y 4.
- Plan B ya preparado si la función de Supabase diera problemas: contenedor en Fly.io (≈ US$5–8/mes), `demo-facturacion/despliegue/fly.toml`.
