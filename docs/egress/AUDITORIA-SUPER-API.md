# Auditoría de `super-api` (código recibido 28-nov) y mejoras — preparado, NO publicado
Archivos: `supabase/functions/super-api/index.ts` (incluye todas las acciones originales, sin quitar ninguna), `supabase/auto/super_api_funciones.sql`, `supabase/config.toml` (`verify_jwt = false`, necesario para la petición previa CORS y la acción `setup`). Pruebas: `pruebas/egress/test_super_api_sql.sh` (SQL contra políticas reales) y `super_api_test.ts` (la función ejecutándose con Supabase y OneDrive simulados).

## Hallazgos y acciones
| # | Hallazgo | Riesgo | Estado |
|---|---|---|---|
| 1 | Fotos (`put`, `put_begin`, `photo_data`, `get`): solo exigían una sesión iniciada; cualquier usuario podía leer o sobrescribir (`conflictBehavior: replace`) la evidencia de otra sucursal conociendo el nombre | Alto | **Corregido** (`nexa_foto_acceso`, bajo las MISMAS políticas RLS de quien llama; modo `PHOTO_AUTH` off/log/enforce) |
| 2 | `push_send`: cualquiera podía avisar «sobre» un plan que no ve, a cualquier usuario | Medio | **Corregido** para avisos con `pid` (debe poder ver el plan); mismo modo |
| 3 | `pushSend` bajaba hasta 5 000 planes completos en cada aviso y esperaba 1.8 s fijos | Egress interno / latencia | **Corregido**: `nexa_push_pendientes` (SQL) devuelve solo `{usuario: n}`; sin espera si la app confirma que guardó (`synced`, v516); retroceso a la lectura anterior si la función SQL no existe |
| 4 | Estado compartido `P.lastExists` entre peticiones simultáneas (podía devolver «existe/no existe» cruzado) | Medio (concurrencia) | **Corregido** (`urlInfo` devuelve `{exists,url}`) |
| 5 | Cada tramo de `photo_data` consultaba Graph de nuevo (1 + 1 llamadas por tramo) | Consumo | **Corregido**: enlace temporal en memoria 10 min; si vence (401/403) se pide uno nuevo |
| 6 | `branch_edit` movía planes reescribiendo todo el JSON (leer-modificar-escribir): pisaba ediciones simultáneas | Pérdida de datos | **Corregido**: cambio puntual con `pa_docs_patch` (E3) solo de región y sucursal; retroceso a la reescritura anterior |
| 7 | Borrar para siempre desde la papelera dejaba las miniaturas en `pa_thumbs` | Basura acumulada | **Corregido** (se limpian al purgar; al borrar a la papelera se conservan para poder restaurar) |
| 8 | `caller()` hace 2 consultas por acción (getUser + perfil) | Consumo menor | Sin cambio (cachear retrasaría la revocación de sesiones) |
| 9 | `setup` compara la clave sin tiempo constante y sin límite de intentos; los errores 500 devuelven el mensaje interno | Bajo | Sin cambio; recomendación: retirar `SETUP_KEY` cuando OneDrive ya esté vinculado |
| 10 | Si el despliegue usa `verify_jwt = true`, la petición previa CORS del navegador falla | Despliegue | `config.toml` lo fija en `false` como en producción (confirmar en Edge Functions → super-api → Settings) |
No hay referencias a `CRON_SECRET` en `super-api`: confirmado junto con las 4 tareas (todas leen el secreto de la base) y las demás funciones del repositorio → se puede retirar la variable.

## Compatibilidad con E1, E2, E3, papelera y traslado
- Nada en `super-api` lee o necesita las miniaturas embebidas (`t`) de `pa_docs`: usa `k`, `o`, `x` de cada foto. **No depende de E2.** La papelera guarda el plan tal como está en la tabla (con o sin `t`); al restaurar, el disparador de E1 vuelve a separar cualquier miniatura embebida y, si el plan ya viene sin ellas (tras E2), las miniaturas siguen en `pa_thumbs` hasta que se purgue.
- Traslado de planes (`branch_edit`): con E3 usa un cambio puntual (también actualiza `updated_at`, así los demás equipos lo ven); sin E3, igual que antes.
- Restaurar con renumeración: las fotos conservan su clave original; `nexa_foto_acceso` concede la lectura por **plan que referencia la foto** (no solo por el número del plan en el nombre), así que una renumeración no deja sin fotos a su sucursal.
- Falta para E2 solo la verificación de clientes antiguos (`ACTIVACION-Y-RETIRO.md` §5).

## Autorización de fotos: cómo decide
Se clasifica el nombre que genera la app: `<plan>_ev<n>_<marca>[ _orig.ext]` (evidencia), `ref_<marca>` (foto de referencia), `ARQ_…` (comprobante de Arqueos), `prueba_conexion.jpg` y otros. **Lectura:** algún plan visible para la persona referencia la foto (o el plan de su nombre es visible). **Escritura de evidencia:** la persona puede ACTUALIZAR ese plan (bloqueo de fila `FOR SHARE`, que aplica las políticas de actualización sin escribir nada; verificado contra los perfiles reales dentro de la migración). **Referencia:** rol que crea planes (admin, supervisor, comodín, inventarios o un rol propio con la vista «Nuevo»). **Arqueos:** lectura admin/supervisor/sucursal, escritura admin/supervisor. **Prueba y nombres sin plan:** administrador. Las sesiones de carga solo se abren tras esa comprobación y siguen siendo temporales y de una sola ruta.

## Procedimiento de activación en producción (cada paso es reversible)
1. **Autorizar publicar** la rama (SQL + función + v516). El flujo «Publicar Supabase» ejecuta `super_api_funciones.sql` (se deshace solo si difiere de los permisos reales) y despliega `super-api`. Con el secreto `PHOTO_AUTH` sin definir, la función queda en modo **log**: nada cambia para nadie, solo se registra lo que se negaría.
2. **Observar 1–2 jornadas:** Supabase → Edge Functions → `super-api` → Logs, buscar `photo_auth_deny` y `push_auth_deny`. Cada línea indica rol y nombre de foto. Lo esperado es 0 (o solo accesos indebidos). Si aparece un caso legítimo, se ajusta antes de obligar.
3. **Obligar:** Edge Functions → Secrets → `PHOTO_AUTH` = `enforce`. **Reversión inmediata:** `PHOTO_AUTH` = `off` (o `log`); no requiere desplegar.
4. **OneDrive directo** (después, `ACTIVACION-Y-RETIRO.md` §2) y **caché** (§3), cada uno por fases.
