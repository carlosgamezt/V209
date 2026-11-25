# Recuperación verificada del respaldo persistente de nexa-demo (24/11/2026)

Estado: **respaldo persistente conservado en R2 Y recuperado con éxito en un PostgreSQL 17 aislado** (paso 6 del procedimiento `PROCEDIMIENTO-RESPALDO-PERSISTENTE-ANTES-ETAPA-4.md`).
Este documento no contiene datos del contenido ni credenciales.

## 1. Cómo se generó el respaldo
- Flujo: `respaldo-nube.yml`, acción `respaldo-persistente`, ejecución https://github.com/carlosgamezt/V209/actions/runs/45389805290 (commit `7e604de`, entorno protegido `demo-privada`).
- Instantánea consistente del origen (solo lectura): 24/11/2026 06:04:45, hora de Guatemala · 70 tablas · 565 filas · 29 migraciones.
- Ensayo de restauración efímera en esa misma ejecución: OK (datos, historial, 1994 elementos de estructura, catálogo de la 29).
- Cifrado con `age` (clave pública) y subida al bucket privado `nexa-fel-backups` sin sobrescribir; el volcado en claro se borró del ejecutor. Sin artefactos, cachés ni releases.

| Objeto | Tamaño |
|---|---|
| `nexa-demo/20261124-120509-b0bd6343.dump.age` | 808.927 bytes |
| `nexa-demo/20261124-120509-b0bd6343.dump.sha256` | 80 bytes |
| `nexa-demo/20261124-120509-b0bd6343.informe.txt` | 1.073 bytes |

- SHA-256 del volcado original: `b0bd634320e97dc9cb4ddcaef17c3e2d2c50a01c24e44faa425bcbf892eec7c8` (808.535 bytes).
- SHA-256 del archivo cifrado: `700952e2a2d97328204f39bfe4b6483423579cf8d76d438ceca08f8384955fcc`.

## 2. Recuperación independiente (paso 6)
Ejecutada por el propietario en su equipo Windows 11 el 24/11/2026 a las 19:20 (hora de ese equipo), con `tools/recuperar-respaldo.ps1` en modo Docker (contenedor `postgres:17` nuevo, sin puertos publicados, eliminado al terminar). La clave privada de age nunca salió de su equipo. Resultado: **«RECUPERACIÓN VERIFICADA: OK»**.

| Comprobación | Resultado |
|---|---|
| Descarga de los tres objetos desde R2 | OK (808.927 · 80 · 1.073 bytes, los publicados) |
| SHA-256 del archivo cifrado = informe | OK (`700952e2…`) |
| Descifrado con la clave privada | OK, 808.535 bytes |
| SHA-256 del volcado = `.sha256` = informe = valor esperado independiente (registro de GitHub) | OK, `b0bd6343…ec7c8` |
| `pg_restore --list` | OK: contiene los datos de `public` y el historial |
| Restauración completa (estructura, datos, restricciones, índices, permisos) | OK |
| Tablas y registros | OK: 70 tablas · 565 filas, exactamente las del informe |
| Historial de migraciones | OK: 29 versiones, idénticas a `supabase/migrations` (última `20261114000100`) |
| RLS | OK: las 69 tablas de `public` con RLS activa · 49 políticas |
| Catálogo de la migración 29 | OK (políticas, funciones, disparadores y privilegios; transacción de solo lectura) |
| Limpieza | OK: contenedor eliminado y volcado descifrado sobrescrito y borrado |

El informe completo que generó la herramienta en ese equipo coincide línea por línea con la tabla anterior.

## 3. Qué queda demostrado
El respaldo `nexa-demo/20261124-120509-b0bd6343` es **recuperable**: el objeto de R2 es el que se subió (huellas), se descifra solo con la clave privada del propietario, y su volcado se restaura en un PostgreSQL 17 limpio con los mismos datos, historial y políticas RLS que `nexa-demo` tenía a las 06:04:45 del 24/11/2026.

## 4. Límites y riesgos que siguen vigentes
- **No se probó restaurar en un proyecto Supabase real.** Faltan por reproducir: roles y membresías, extensiones, disparadores de evento de la plataforma (p. ej. `ensure_rls`), y `auth`, `storage` y `vault` (los usuarios de Auth se sustituyen por usuarios de prueba). Una restauración real tendría que rehacer esas piezas con los procedimientos de Supabase.
- **El respaldo es una fotografía:** cualquier cambio en `nexa-demo` posterior a las 06:04:45 del 24/11/2026 no está en él. Antes de una operación que cambie la base conviene generar uno nuevo (ver `docs/migracion-tipos-documento/SOLICITUD-AUTORIZACION-ETAPA-4.md`).
- **Token de R2** con lectura y escritura: puede borrar o sobrescribir objetos del bucket. Mitigación pendiente del propietario: bloqueo de retención del bucket y un token de solo lectura para recuperar.
- **Clave privada de age:** si se pierde, todas las copias son inservibles. Debe tener copia en el gestor de contraseñas y en papel.
- **Retención:** plazo legal de conservación de copias con operaciones fiscales, a confirmar con el contador.
- Tras cualquier restauración real no se reactiva la certificación: se concilia con Digifact (`RECUPERACION-Y-CONCILIACION.md`).
