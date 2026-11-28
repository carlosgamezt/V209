# Activación controlada, retiro del secreto antiguo y requisitos de E2 (guía exacta)
Todo cambio de abajo es **reversible por configuración** y no requiere tocar la base. Nada de esto está activo hoy.

## 1. Obtener el código de `super-api` (no está en `nexa-planes-de-accion` ni en `V209`; solo hay clientes antiguos y notas)
**Desde Supabase (navegador, 1 minuto):** Dashboard del proyecto → **Edge Functions** → `super-api` → pestaña **Code** → abrir cada archivo (normalmente `index.ts`) → **seleccionar todo y copiar**. Pégalo en el chat. Antes de pegarlo, revisa que no contenga valores de claves (los secretos deben leerse con `Deno.env.get(...)`, que es seguro).
**Desde un equipo con la CLI:** `supabase login` → `supabase functions download super-api --project-ref znicbyzszdztwyecydbl --use-api` (crea `supabase/functions/super-api/`). Súbelo a una rama nueva de `V209` o pega el contenido.
**Qué busco en ese código:** (a) la acción `get` (¿entrega `@microsoft.graph.downloadUrl` del archivo original, y con qué vigencia?); (b) `put_begin` (¿devuelve la `uploadUrl` de Graph?); (c) si comprueba sesión, sucursal y región en cada acción (el cliente nunca ve tokens de OneDrive); (d) si lee `pa_docs` con miniaturas (dependencia de E2); (e) si usa `CRON_SECRET`.

## 2. Descarga y subida directa de OneDrive: activación por fases (`PA_CONFIG.odDirect`)
Estado probado en banco local (CORS, sin CORS, enlace vencido, fallo a mitad, integridad SHA-256, ausencia de `Authorization`, 0 MB por Supabase con CORS). **Falta solo lo que depende de OneDrive real:** 
1. En el navegador del administrador, con sesión abierta, pegar el fragmento de `PLAN-V514-Y-VENTANA-E1.md` §1.1: debe decir `LEE BIEN desde <dominio de OneDrive/SharePoint>`. Si el dominio es `*.supabase.co` o falla por CORS, **no activar** (todo sigue como hoy). 
2. Fase A (piloto): `odDirect: 'admin'` en `PA_CONFIG` (solo administradores). Descargar un plan con fotos y subir una foto desde **PC y Android**; en Supabase → Usage el tráfico de la función `super-api` no debe crecer por esas fotos. 
3. Fase B (personas concretas): `odDirect: ['id1','id2']`. Fase C (todos): `odDirect: true`. 
**Reversión inmediata (sin deshacer datos):** poner `odDirect: false` (o quitarlo) y publicar; además cada equipo se autoprotege 24 h tras un fallo (`nx_od_direct`, `nx_od_up` en localStorage). Autorización, sucursal/región y expiración del enlace los decide `super-api` al entregar el enlace/sesión; el cliente no guarda enlaces ni tokens (solo en memoria 40 min).
**Requisito del servidor:** `get` debe devolver un enlace de descarga temporal del archivo ORIGINAL con `Access-Control-Allow-Origin` válido para `fetch`, y `put_begin` la sesión de carga de ESA ruta; ambos solo tras verificar sesión y permiso del plan.

## 3. Caché persistente (`PA_CONFIG.cache`)
Verificado en banco local: aislamiento entre personas (una copia por cuenta; entrar otra persona borra la anterior), invalidación por cambio de perfil/rol/región, plan con permiso revocado desaparece también de la copia, cierre de sesión la borra, modo sesión borra en cualquier cierre. **Nuevo:** (a) nunca se guarda un registro con campos de credencial (`pw`, `pass`, `password`, `token`, `secret`, `clave`, `api_key`…; hoy hay 0 de 75 usuarios con alguno, medido en producción) — si aparece uno la caché se apaga en esa sesión y se borra; (b) piloto por rol: `cacheRoles: ['admin']`; (c) **apagado reversible:** al poner `cache: false` cada equipo borra por completo su base local la próxima vez que abre la app. 
Activación sugerida: Fase A `cache: true, cacheRoles: ['admin']` (modo sesión: se borra al cerrar la sesión; en administradores el primer inicio baja 0.37 MB y los siguientes ~13 KB). Fase B `cache: true` (todos, modo sesión). Fase C `cache: 'dispositivo'` solo en equipos propios de la persona (conserva la copia tras cerrar; **no usar en equipos compartidos de sucursal**). Reversión: `cache: false`.

## 4. Retirar el `CRON_SECRET` antiguo
Verificado en producción: solo existen 4 tareas programadas, todas llaman a `recordatorios-de-nexa` y leen el secreto nuevo de la base; ninguna conserva un secreto escrito. En el repositorio ninguna otra función lo usa. **Falta confirmar `super-api`** (su código no está en el repositorio): en el código descargado (sección 1) buscar `CRON_SECRET`; si no aparece, retirarlo así: Dashboard → **Project Settings → Edge Functions → Secrets** (o Edge Functions → *Secrets*) → fila `CRON_SECRET` → **Delete**; o con la CLI `supabase secrets unset CRON_SECRET --project-ref znicbyzszdztwyecydbl`. Después correr `supabase/consultas/verificar_tareas.sql` (flujo «Consultar Supabase») y confirmar que la siguiente corrida real da 200.

## 5. Requisitos para aplicar E2 (compactar miniaturas) — pendientes
1. **Sin clientes antiguos:** Dashboard → **Logs → API Edge Logs** (consulta SQL) durante la jornada: 
`select count(*) as n, h.x_client_info as cliente from edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as r cross join unnest(r.headers) as h where r.path like '%/rest/v1/pa_docs%' group by h.x_client_info order by n desc`
Todas las filas deben mostrar `nexa/v514` o posterior (v515/v516). Una fila solo con `supabase-js-web/2.45.4` (sin `nexa/`) es un cliente v512/v513: no aplicar E2. 
2. **`super-api` no lee miniaturas de `pa_docs`:** revisar su código (sección 1, punto d).
3. Con ambas confirmadas: aplicar `supabase/propuestas/egress/auto_e2_compactar.sql` (crea `pa_docs_respaldo_e2`, comprueba vista, RLS, `updated_at`, matriz de escritura y reversión dentro de una transacción que se deshace si algo difiere). E2 **no reduce Egress**; es de menor prioridad.
