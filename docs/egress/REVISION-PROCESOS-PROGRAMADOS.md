# Revisión de los procesos programados (cron) — sin cambios de frecuencia

Fuente: `supabase/functions/recordatorios-de-nexa/index.ts`, `supabase/recordatorios_horarios.sql`, `supabase/recordatorios_tareas_nuevas.sql`. Los tres modos se llaman con el secreto `x-cron-secret`; el contenido de `cron.job` real se confirma con `medicion_egress.sql` (sección `cron`).
| Tarea | Horario (hora de Guatemala) | Obligación operativa | ¿Puede cambiarse la frecuencia? |
|---|---|---|---|
| `slot am` / `slot pm` | 8:30 y 13:00 | recordatorios diarios de plazos a sucursales y supervisores (clave única por plan/día/turno) | **No** (compromiso horario con las sucursales) |
| `nexa-sin-leer` (`mode unread`) | cada hora, 7:00–19:00 | avisar a la sucursal que no abrió un plan a las **4, 8 y 12 h**; avisar a Inventarios cuando un informe lleva 4/8/12 h sin descargarse | **No**: la ventana de cada aviso es de 1 h; espaciarla desplaza o pierde avisos |
| `nexa-badge` (`mode badge`) | cada 15 min, 6:00–20:00 (~56/día) | reponer el aviso fijo y el numerito del ícono si la persona lo borró | Sí, pero **es decisión del negocio**: pasar a 30 min retrasa hasta 30 min el regreso del aviso; no se pierde ningún aviso de plazo |
## Consumo de los procesos
Cada corrida lee TODOS los planes (límite 5 000, con las miniaturas Base64), los usuarios, descargas (20 000), recordatorios (20 000) y avisos (5 000) para calcular pendientes. Son ~72 corridas al día **aunque nadie use la app**. Si el tráfico función→base cuenta como Egress es un dato **no confirmado**; lo que sí es seguro es la carga de base de datos.
## Qué se hizo y qué se recomienda
- **Hecho (sin tocar horarios):** los planes se leen por `pa_docs_lite` (sin miniaturas) con retroceso a la tabla si la vista no existe. Los cálculos solo usan fechas, estados y asignaciones, por lo que el resultado es el mismo.
- **Recomendado después (requiere autorización):** reemplazar las lecturas completas por una consulta agregada en la base (contar pendientes por persona) y valorar `nexa-badge` a 30 min **solo** si el negocio lo acepta.
