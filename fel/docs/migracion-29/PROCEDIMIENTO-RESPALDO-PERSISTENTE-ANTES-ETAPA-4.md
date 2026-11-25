# Procedimiento · respaldo persistente, cifrado y recuperable ANTES de la etapa 4

Estado (25/11/2026): **pasos 1 a 6 COMPLETADOS.** El respaldo `nexa-demo/20261124-120509-b0bd6343` se generó, se conservó cifrado en R2 y se **recuperó con éxito** en el equipo del propietario (ver `RECUPERACION-VERIFICADA-20261124.md`).
Queda el paso 7: la autorización de la etapa 4, con su solicitud en `docs/migracion-tipos-documento/SOLICITUD-AUTORIZACION-ETAPA-4.md`. La etapa 4 NO se ha ejecutado.
Base de diseño: `RESPALDO-FASE-2-CLOUDFLARE-R2.md` (arquitectura, credenciales, retención, riesgos).
Punto de partida probado: el ensayo `respaldo-nube.yml` (`ensayo-respaldo`) del 23/11/2026 terminó en OK sobre el estado de 29 migraciones. Herramientas: `tools/respaldo-nexa-demo.sh` (acción `respaldo-persistente`), `tools/r2_subir.py` y `tools/recuperar-respaldo.py` / `.ps1`.

## Reglas
- Nunca un artefacto, caché ni release de GitHub con el volcado (los guardianes de `verificar-publicacion.py` ya lo exigen).
- Cifrado de **clave pública** (`age`) en el ejecutor; la clave privada nunca entra a GitHub, a R2 ni a un chat.
- Solo se sube si el ensayo de restauración termina en «OK» en la misma ejecución.
- La restauración de prueba va siempre a una base **aparte**, nunca sobre `nexa-demo`.

## Pasos (cada uno con su autorización)
1. **Responsable (tú):** crear un bucket privado en Cloudflare R2 (sin dominio público) y un token «Object Read & Write» limitado a ese bucket, con vencimiento. R2 no ofrece solo escritura.
2. **Responsable:** generar el par de claves `age` en su equipo (`age-keygen`). Guardar la privada en un gestor de contraseñas y en copia impresa. Entregar **solo la pública**.
3. **Responsable:** cargar en el entorno `demo-privada` el token y el identificador de cuenta (secretos), y el nombre del bucket y la clave pública (variables).
4. **Claude, con commit autorizado:** añadir un trabajo de subida a `respaldo-nube.yml`, separado del ensayo y detrás del mismo entorno protegido. Debe:
   - repetir el ensayo y seguir solo si termina en OK;
   - calcular el SHA-256 del archivo en claro;
   - cifrar con la clave pública;
   - subir `nexa-demo/AAAAMMDD-HHMMSS-<sha8>.dump.age`, más el `.sha256` y un informe sin datos;
   - borrar el archivo en claro del disco del ejecutor.
   Con sus guardianes y pruebas locales.
5. **Primera corrida real**, aprobada por ti en `demo-privada`.
6. **Prueba de recuperación desde R2:** descargar el objeto, descifrar con la clave privada, comparar el SHA-256, `pg_restore --list` y restaurar en una base aparte. Comprobar tablas, filas, historial (29 migraciones), catálogo y RLS con el script del ensayo.
7. **Solo entonces** se pide la autorización de la etapa 4. Anotar el identificador del respaldo (nombre del objeto y SHA-256) en esa autorización.

## Condición de parada
Sin los pasos 1 a 6 completos no hay respaldo comprobable. La etapa 4 sigue bloqueada.

## Pendiente fuera de este procedimiento
- La restauración real sobre un proyecto Supabase distinto sigue sin probarse.
- Tras cualquier restauración no se reactiva la certificación. Se concilia con Digifact antes de enviar nada (`RECUPERACION-Y-CONCILIACION.md`).
- Plazo legal de retención de copias con operaciones fiscales: a confirmar con el contador.
