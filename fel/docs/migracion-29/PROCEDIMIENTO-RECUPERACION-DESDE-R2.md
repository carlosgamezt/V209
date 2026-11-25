# Procedimiento · recuperación verificada del respaldo desde Cloudflare R2 (paso 6, Windows 11)

Objetivo: demostrar que el respaldo `nexa-demo/20261124-120509-b0bd6343` se puede **descargar, descifrar y restaurar**. Hasta que este procedimiento termine con «RECUPERACIÓN VERIFICADA: OK» en tu equipo, el respaldo NO se considera recuperable.

Todo ocurre en tu computadora. No se toca `nexa-demo`, ni ningún Supabase, ni una base local que ya tengas: se crea un PostgreSQL 17 **nuevo** y se elimina al terminar.
- **Modo Docker (recomendado, el que usa el envoltorio si Docker está en marcha):** contenedor `postgres:17` con nombre único y **sin puertos publicados** (solo se entra con `docker exec`); se elimina solo.
- **Modo nativo (si no hay Docker):** un clúster nuevo con las herramientas de PostgreSQL 17 instaladas, en un directorio temporal, solo 127.0.0.1, puerto libre y contraseña aleatoria.

Tu clave privada de age no sale de tu equipo: el programa solo le pasa su **ruta** a `age`. Nada se descarga ni se descifra en servicios externos: solo se descarga el objeto cifrado de R2 (y, en modo Docker, la imagen pública `postgres:17`, que no contiene datos tuyos).

## Objetos
| Objeto (bucket `nexa-fel-backups`) | Tamaño |
|---|---|
| `nexa-demo/20261124-120509-b0bd6343.dump.age` | 808.927 bytes |
| `nexa-demo/20261124-120509-b0bd6343.dump.sha256` | 80 bytes |
| `nexa-demo/20261124-120509-b0bd6343.informe.txt` | 1.073 bytes |

Valores de referencia, tomados del registro de GitHub Actions (ejecución 45389805290), independientes de los archivos descargados:
SHA-256 del volcado original `b0bd634320e97dc9cb4ddcaef17c3e2d2c50a01c24e44faa425bcbf892eec7c8` (808.535 bytes) · SHA-256 del cifrado `700952e2a2d97328204f39bfe4b6483423579cf8d76d438ceca08f8384955fcc`.

## Requisitos (una sola vez)
En PowerShell:
```powershell
winget install Python.Python.3.12
winget install FiloSottile.age
winget install Docker.DockerDesktop
```
Cierra y vuelve a abrir PowerShell, y abre **Docker Desktop** hasta que diga «running». (Si prefieres no usar Docker: `winget install PostgreSQL.PostgreSQL.17`; de él solo se usan sus herramientas y el servicio que instala no se utiliza.)
Necesitas además: un clon actualizado del repositorio (`git pull` en la rama `fel-proveedores-diseno`) y, para descargar, una credencial de R2 (Account ID, Access Key ID, Secret Access Key). **Recomendado:** un token de R2 de *solo lectura* limitado al bucket `nexa-fel-backups`; el programa solo hace GET.

## Opción A — descarga automática (recomendada)
```powershell
cd RUTA\DEL\REPOSITORIO\fel
powershell -ExecutionPolicy Bypass -File .\tools\recuperar-respaldo.ps1
```
Te pedirá, sin mostrarlos: la ruta del archivo de tu clave privada de age y las tres credenciales de R2. Las credenciales viven solo en esa sesión y se borran al terminar.

## Opción B — descarga manual desde el panel de Cloudflare
1. En Cloudflare → R2 → `nexa-fel-backups` → carpeta `nexa-demo`, descarga los tres archivos a una carpeta, por ejemplo `C:\respaldo-nexa`.
2. Ejecuta:
```powershell
cd RUTA\DEL\REPOSITORIO\fel
powershell -ExecutionPolicy Bypass -File .\tools\recuperar-respaldo.ps1 -Carpeta C:\respaldo-nexa
```
(En esta opción no se piden credenciales de R2.)

Opciones del envoltorio: `-Modo auto|docker|nativo` (por defecto `auto`: Docker si está en marcha), `-PgBin` (solo modo nativo) e `-Informe` (ruta del informe; por defecto `Documentos\informe-recuperacion-nexa-AAAAMMDD-HHMMSS.txt`; nunca se sobrescribe uno existente).

## Qué resultado debes ver
Al final, estas líneas (todas con `OK`):
```
  OK    los tres objetos obtenidos …
  OK    SHA-256 del archivo cifrado = informe (700952e2a2d97328…)
  OK    descifrado con tu clave privada: 808535 bytes
  OK    SHA-256 del volcado descifrado = .sha256 = informe = valor esperado independiente: b0bd634320e97dc9…
  OK    pg_restore --list: el volcado contiene los datos de public y el historial de migraciones
  OK    PostgreSQL 17 temporal e independiente (contenedor nexa-recuperacion-…, sin puertos publicados)
  OK    restauración completa en la base temporal …
  OK    tablas y registros: 70 tablas · 565 filas, exactamente las del informe
  OK    historial de migraciones: 29 versiones, idénticas a supabase/migrations del repositorio (última 20261114000100)
  OK    RLS: las 69 tablas de public tienen RLS activa y hay N políticas
  OK    catálogo de la migración 29 sano en lo restaurado …
  OK    PostgreSQL temporal apagado y archivos temporales (volcado descifrado incluido) sobrescritos y borrados
RECUPERACIÓN VERIFICADA: OK
  INFO  informe guardado en …\Documentos\informe-recuperacion-nexa-….txt
```
El **informe de recuperación** es ese archivo: contiene las mismas líneas, sin datos del contenido ni claves. Pégamelo para cerrar el paso 6.
Si ves `FALLO`, copia ese mensaje y no sigas. Los fallos comunes: clave privada equivocada (`age no pudo descifrar`), archivo alterado (`SHA-256 … no coincide`), falta una herramienta (`REQUISITO`).

## Valores esperados según el estado del respaldo
La herramienta vale para respaldos de los tres estados de `nexa-demo` y los reconoce por el informe y el historial:
| Estado del respaldo | Migraciones | Tablas en `public` con RLS | Comprobaciones extra |
|---|---|---|---|
| Anterior a la 29 | 28 | 67 | catálogo de la 28 |
| Posterior a la 29 (el del 24/11/2026) | 29 | 69 (49 políticas) | catálogo de la 29 |
| Posterior a la 30 (tipos de documento, tras la etapa 4) | 30 | 71 (51 políticas) | catálogo de la 29 con las cifras de la 30 **y** `verificacion-tipos.sql` |
Un respaldo cuyo historial y objetos no coinciden (por ejemplo, 29 versiones pero con las tablas de la 30, o al revés) se rechaza como deriva.

## Qué demuestra y qué no
- Demuestra: que el objeto en R2 es el que se subió (huellas), que se descifra con tu clave, que el volcado se restaura en un PostgreSQL 17 limpio y que tablas, filas, historial de migraciones, RLS y el catálogo de la migración 29 quedan como en el informe.
- No demuestra: restauración en un proyecto Supabase real (sin probar); roles y membresías, extensiones, disparadores de evento de la plataforma, `auth`/`storage`/`vault` (los usuarios de Auth se sustituyen por usuarios de prueba) ni expresiones CHECK/políticas comparadas con paréntesis.
- Tras cualquier restauración real no se reactiva la certificación: se concilia con Digifact (`RECUPERACION-Y-CONCILIACION.md`).

## Seguridad
- No compartas ni subas la clave privada ni las credenciales; el informe final no las contiene.
- El volcado descifrado vive solo en una carpeta temporal de tu usuario y se sobrescribe y borra al terminar (también si hay un fallo).
- El programa no contiene ninguna cadena de conexión de `nexa-demo`: no puede tocarla.
