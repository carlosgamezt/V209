# Condiciones previas al lanzamiento comercial — verificado en local vs pendiente hospedado

Además de cerrar R1, R2 y R3 (compuertas globales, ver `RIESGO-RESIDUAL-R3.md`). Mínimos, sin soluciones avanzadas.
| Condición | Verificado en LOCAL | Evidencia | Pendiente en `nexa-fel-test` |
|---|---|---|---|
| Respaldo y recuperación | respaldo (base + roles sin contraseñas), restauración en otro servidor, copia idéntica, pruebas de seguridad sobre la copia, respaldo dañado rechazado | `tools/ensayo-respaldo-esquema.sh`, `PROCEDIMIENTO-RESPALDO-Y-RECUPERACION.md` | restaurar en proyecto Supabase real; tiempo con volumen real |
| Carga y concurrencia básicas | 16 clientes simultáneos (lecturas, escrituras del mismo cliente, otra empresa): 0 transacciones fallidas, sin duplicados, sin escrituras cruzadas (~280 tps locales, no es capacidad del plan) | `tools/carga-basica.sh`; pruebas de concurrencia existentes en `proveedores/pruebas_db` | latencia y límites reales (Data API/pooler, región) — H8 |
| Monitoreo de certificación y procesos internos | `salud` (`ok`/`atencion`/`critico` con motivos) en `/tick`; sin datos de clientes | `tests/secreto_sistema_test.ts`, `MONITOREO-MINIMO.md` | programar el `tick`, destino de alertas (W5) |
| Rotación manual de credenciales | rotación de `nexa_app`/`nexa_sys` (la anterior deja de entrar, privilegios iguales, deshabilitación de emergencia) y de `FEL_SYS_SECRETO` sin interrupción | `tools/ensayo-rotacion.sh`, `ROTACION-DE-CREDENCIALES.md` | formato del usuario del pooler y propagación de secretos reales |

Regla: nada de lo anterior autoriza clientes reales mientras R1/R2/R3 sigan abiertos.
