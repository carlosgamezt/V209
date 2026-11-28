# Medición del consumo REAL (Supabase) tras publicar P0 y después E1

**Regla:** no se declara ningún ahorro (ni «99 %») hasta comprobarlo en las métricas de Supabase. Los porcentajes de `INFORME-EGRESS-FASE-2.md` son de un banco de pruebas simulado.
**Cada organización cuenta su propia cuota:** «pa carlos» y «nexa-demo» están en organizaciones distintas (verificado por ti con ChatGPT; yo no lo puedo comprobar desde el código). No se asume cuota compartida; la medición se hace solo en la organización de «pa carlos».

## 1. Eventos (anotar hora exacta, hora de Guatemala)
| Evento | Fecha y hora |
|---|---|
| Publicación v513 (P0) | 28-nov-2026 00:54 UTC (= 27-nov 18:54 Guatemala; flujos «Publicar Nexa» y «Publicar Supabase» en verde) |
| Equipos con v513 (≥ 90 % de activos) | por anotar |
| E0 + E1 | por anotar |
| E2 (si se autoriza) | por anotar |

## 2. Qué capturar (Supabase → organización → **Usage**, proyecto «pa carlos»)
1. **Egress total por día** (selector de periodo: 30 días; pasar el cursor por cada día para ver el desglose) **por servicio**: Database/API, Realtime, Storage, Edge Functions, Auth, Shared pooler; además «Cached egress». Anotar también el acumulado del ciclo y la fecha de reinicio (Billing → Upcoming invoice).
2. **Usuarios activos por día:** `supabase/consultas/usuarios_activos_por_dia.sql` (SQL Editor). Alternativa: Usage → Monthly Active Users (mensual).
3. **Solicitudes por ruta:** Reports → **API Gateway** (o Logs → API Edge Logs): top de rutas (`/rest/v1/pa_docs`, `/pa_descargas`, `/pa_arqueos`, `/rpc/...`) y su cantidad por día. Reports → **Realtime**: mensajes y clientes conectados. Reports → **Edge Functions**: invocaciones de `recordatorios-de-nexa`, `arqueos`, `super-api`.
4. Opcional (Logs Explorer): `select r.path, count(*) from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r where r.method = 'GET' group by 1 order by 2 desc limit 15` (ajustar si el esquema de logs cambió).

## 3. Registro diario (plantilla: `pruebas/egress/plantilla_medicion_real.csv`)
`fecha, evento, egress_total_MB, db_api_MB, realtime_MB, functions_MB, storage_MB, auth_MB, usuarios_activos, egress_por_usuario_MB, solicitudes_pa_docs, mensajes_realtime, invocaciones_recordatorios`.

## 4. Cómo comparar
- **Periodos:** 5 días hábiles ANTES del evento vs 5 días hábiles DESPUÉS (excluir el día del cambio y los 2 días de transición de versión). Mezcla de días de la semana comparable.
- **Por persona:** `egress_por_usuario = egress_total_del_día ÷ usuarios_activos_del_día`; comparar medianas, no promedios, y mostrar el rango.
- **Ahorro real** = 1 − (mediana_después ÷ mediana_antes) por servicio y total. Declararlo solo con ≥ 3 días completos tras el cambio y usuarios activos dentro de ±25 % del periodo base; si no, marcarlo «preliminar».
- **Atribución:** P0 debe bajar sobre todo Database/API (listados periódicos) y las solicitudes a `pa_docs`/`pa_arqueos`/`pa_descargas`; E1 debe bajar el tamaño por solicitud (Database/API y Realtime). Si un servicio no baja donde se espera, investigar antes de seguir (p. ej. `super-api`, `arqueos`, `recordatorios`).
- **Ciclo:** el acumulado del ciclo no baja; lo que se mide es la **pendiente diaria**. La restricción por haber excedido la cuota se levanta al reiniciar el ciclo o al pasar a Pro.
- **Informe:** tabla antes/después por servicio, por usuario activo y por día + gráfico de Usage con las marcas de los eventos.
