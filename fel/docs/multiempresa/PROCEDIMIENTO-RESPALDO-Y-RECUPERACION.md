# Respaldo y recuperación — procedimiento básico (verificado en local)

**Verificado en local:** `bash tools/ensayo-respaldo-esquema.sh` (PostgreSQL temporal, datos simulados, sin red): esquema completo (migraciones 1–30 + propuestas M-D…M-V + M-E) + 200 000 filas simuladas → `pg_dump -Fc` + `pg_dumpall --roles-only --no-role-passwords` → restauración en OTRO servidor → la copia es idéntica (filas por tabla, funciones, políticas RLS, privilegios, atributos de roles) → las pruebas de seguridad (identidad, lecturas, cierre R3, parámetros) pasan sobre la copia → un respaldo truncado se rechaza con error → el origen no cambia. Referencia de tiempo con ese volumen: respaldo ≈1 s, restauración ≈1–2 s, verificación ≈1 s (no extrapolar al proyecto real).

## Procedimiento mínimo (proyecto hospedado)
1. **Antes de cualquier migración o cambio de privilegios:** copia lógica (`tools/respaldo-nexa-demo.sh` para datos; `pg_dump -Fc` del esquema `public`/`api`; roles sin contraseñas). Guardar fuera del proyecto, cifrada, con fecha y huella SHA-256.
2. **Frecuencia mínima:** diaria + antes de cada despliegue. Conservar 7 diarias y 4 semanales. (Los respaldos automáticos del plan de Supabase son un complemento, no sustituyen la copia propia; su disponibilidad depende del plan: confirmar en `nexa-fel-test`.)
3. **Restauración:** proyecto/base vacía → roles (`roles.sql`; las contraseñas se asignan de nuevo con el procedimiento de rotación) → `pg_restore --no-owner --exit-on-error` → `tools/ensayo-1e.sh probar` (o las pruebas SQL) → comparar conteos con el origen → solo entonces apuntar la aplicación.
4. **Un respaldo que no se restauró no existe:** repetir el ensayo de restauración tras cada cambio de esquema y al menos una vez al mes.
5. **Datos fuera de la base:** secretos (no se respaldan; se regeneran), `FEL_*` de la función (reconfigurar), claves de agentes (los agentes se vinculan de nuevo).

## Pendiente de verificación hospedada
Restauración en un proyecto Supabase real (extensiones, esquema `auth` gestionado por la plataforma, `pg_dump` por el pooler/conexión directa, tiempo con volumen real) — **nexa-fel-test, paso 10 / H9**.
