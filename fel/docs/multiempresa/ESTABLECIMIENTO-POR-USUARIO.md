# NEXA FEL · Multiempresa · Requisito obligatorio: establecimiento asignado y bloqueado por usuario (DISEÑO · 26/11/2026)
Solo diseño; no se ejecutó nada hospedado ni se publicó. Se integra en 1B-bis y 1C y se identifica lo que queda para 1D.

## 1. Hallazgos del código actual (por qué hay que cambiar)
- Hoy el navegador **elige** el establecimiento (selector con todos los activos de la empresa) y lo **envía** (`establecimiento_id`); el servidor solo comprueba que pertenezca a la empresa y esté activo (`fel_op_documento_establecimiento`). No existe asignación por usuario ni se valida que el usuario esté autorizado.
- Los documentos ya guardan `documentos.establecimiento_id` (clave foránea compuesta con la empresa); ese campo solo se puede asignar a un borrador sin estado fiscal. Las operaciones fiscales ya guardan el código de establecimiento con el que se enviaron.
- **Hallazgo importante:** el servicio de Digifact toma el establecimiento del **emisor único de la empresa** (`emisor.establecimiento.codigo`), no del documento. Con dos establecimientos en TEST, el emisor (y su huella aprobada) debe depender del establecimiento del documento. Es un cambio en el servicio (1C).
- Los permisos existentes (`miembros.rol`, `permisos_extra`) permiten distinguir facturador (`emisor`), administrador y propietario sin crear roles nuevos.

## 2. Cómo queda la asignación
- **Tabla nueva `usuario_establecimientos`** (empresa_id, user_id, establecimiento_id, predeterminado, creado_por/en, revocado_en): clave foránea compuesta a `miembros (empresa_id, user_id)` y a `establecimientos (id, empresa_id)` (imposible asignar un establecimiento de otra empresa); **varios usuarios por establecimiento** (sin unicidad por establecimiento); un solo predeterminado activo por usuario; las asignaciones revocadas se conservan (historial).
- **Facturador (`emisor`) = exactamente 1 asignación activa, obligatoria**: sin asignación no puede crear documentos (falla cerrado con mensaje claro). Disparador que impide tener 0 o 2+ a un facturador común.
- **Alcance por rol:** facturador y lector → solo sus establecimientos asignados; propietario y administrador → todos los de su empresa. **Supervisor** = permiso extra `establecimientos.multiples` (en `permisos_extra`, concedido por el administrador; nunca a facturadores comunes) con una lista de establecimientos asignados y un **cambio explícito**: `POST /api/sesion/establecimiento` (valida que esté entre sus asignados, exige confirmación, queda auditado y se guarda en la sesión del servidor; el navegador nunca fija el alcance por sí solo).
- **Permisos nuevos:** `establecimientos.asignar` (administrador y propietario) y `establecimientos.multiples` (solo por permiso extra).
- **Documentos existentes:** conservan su `establecimiento_id` (inmutable desde la revisión; reasignar a un usuario solo afecta a los documentos nuevos). Documentos sin establecimiento (anteriores) quedan visibles solo para administrador y propietario.
- **Inicio de sesión:** el servidor reconoce empresa y establecimiento desde `miembros` + `usuario_establecimientos` (misma lectura que ya carga permisos; con la caché de permisos de 5 s, sin consultas nuevas en la ruta de certificación).

## 3. Validación en el servidor (nunca solo el navegador)
- **Crear:** el servidor fija el establecimiento del documento con la asignación del usuario e **ignora** el que mande el navegador; si manda uno distinto → rechazo `establecimiento_no_autorizado` (403) y auditoría.
- **Leer, listar, modificar, revisar, reabrir, validar, preparar, certificar (incluida `certificar-todo`), conciliar, descargar PDF/XML, correo y anular:** una función central `autorizarDocumento` comprueba empresa + establecimiento del documento ∈ alcance del usuario + permiso; fuera de alcance responde como «no encontrado» (no revela que existe). El listado filtra por el alcance en SQL.
- **Defensa en la base:** `fel_op_documento_establecimiento` y las funciones de documento verifican la asignación del actor aunque se llamen directamente; el establecimiento de un documento no se cambia tras la revisión.
- **Servicio de Digifact (1C):** `DocumentoFel` lleva el establecimiento; el emisor y su huella aprobada se resuelven por (empresa, establecimiento); la referencia y el hash incluyen el establecimiento (referencias distintas por establecimiento); la operación conserva el código con el que se envió (el chequeo previo y la conciliación ya lo usan).

## 4. Qué cambia en cada etapa
| Etapa | Cambios |
|---|---|
| **1B-bis** (SQL + rol real) | Tabla `usuario_establecimientos` con RLS (el usuario ve las suyas con `establecimientos.ver`; escritura solo por función); disparador de «1 asignación activa» para facturadores; permisos nuevos; funciones `fel_op_asignacion_guardar` (auditada) y `fel_alcance_establecimientos(empresa, usuario)`; endurecer `fel_op_documento_establecimiento` y la inmutabilidad; privilegios de `nexa_app`; pruebas con el rol real. |
| **1C** (servicio) | `DocumentoFel.establecimientoId/Codigo`; `emisorDe(empresa, establecimiento)`; versiones de emisor por establecimiento en M-A (vigente único por empresa+establecimiento); resolvedor con caché por (empresa, establecimiento); guardia `autorizarDocumento` en las rutas detrás de un interruptor apagado por defecto (la demo publicada no cambia); pruebas de aislamiento, concurrencia e idempotencia con dos establecimientos. |
| **1D** (administración) | Panel «Establecimientos y usuarios» (asignar y reasignar con auditoría, conceder o retirar `establecimientos.multiples`); API de asignaciones; cambio explícito del supervisor; **interfaz de Nueva factura**: establecimiento mostrado como dato bloqueado (sin selector) para facturadores, selector solo para quien tenga alcance múltiple; pruebas de navegador a 360/390/412/1100 px. |
| **1E** (hospedado, con tu autorización) | Aplicar las migraciones; cargar en TEST los dos emisores y sus huellas aprobadas; prueba real con ambos establecimientos. |

## 5. Pruebas con los dos establecimientos de TEST
Usuario A → establecimiento 1; usuario B → establecimiento 2 (misma empresa); usuario C en otra empresa; supervisor S con ambos.
1. Cada facturador crea documentos y solo se le asigna el suyo, sin elegirlo; la certificación sale con el código de establecimiento y el emisor de ese establecimiento (se verifica el contenido enviado en el transporte espía).
2. Mandar otro `establecimiento_id` al crear o modificar, o llamar directo a la función SQL, se rechaza (servidor y base).
3. A no puede leer, listar, modificar, revisar, certificar, descargar PDF/XML, enviar por correo ni anular documentos de B (ni C); cuentan 404/403 y no hay fuga en listados ni conteos.
4. Permisos: lector no emite; administrador ve ambos; facturador sin asignación no emite; supervisor cambia de establecimiento solo de forma explícita y auditada; facturador no puede.
5. Concurrencia: A y B certifican a la vez (sin bloqueo global, dos envíos); el mismo documento dos veces = un envío; reasignar a A mientras tiene un borrador no cambia el establecimiento del borrador; las facturas ya emitidas conservan el establecimiento; auditoría de la reasignación.
6. Idempotencia: referencia distinta por establecimiento; reintento tras resultado incierto no reenvía.
7. Teléfono y computadora: Nueva factura muestra el establecimiento bloqueado sin selector y sin parpadeo; supervisor ve el cambio explícito.
8. Rendimiento: sin consultas nuevas en `certificar-todo` (comparación con la #55).
Local primero (PostgreSQL temporal, Digifact simulado con dos códigos); en TEST real solo en 1E.

## 6. Datos que necesito de ti
(a) Códigos de los dos establecimientos en Digifact TEST (¿1 y 2?) y sus nombres/direcciones; (b) ¿las mismas credenciales (mismo NIT) sirven para ambos?; (c) autorización para leer los datos del emisor del segundo establecimiento con el paso «datos-emisor» existente (a partir de un DTE aceptado por SAT para ese establecimiento); (d) confirmar que «supervisor» se modela con el permiso extra `establecimientos.multiples` y no con un rol nuevo.

## Establecimientos de pruebas confirmados (Digifact TEST, cuenta CARLOSGAMEZ_TEST)

Confirmados por el titular desde el selector de establecimientos del portal Digifact TEST: **código 2** y **código 67** (ambos con el nombre de Digifact «ESTABLECIMIENTO "TEST GEN"»; el reporte de acuses mostró un solo NIT emisor, el de la cuenta).
Nombres INTERNOS iniciales en NEXA FEL: **2 → Sucursal Principal**, **67 → Sucursal 2**. Se cambian con `POST /api/establecimientos/:id/nombre`, que solo modifica el nombre interno: el código Digifact/SAT, la dirección, el estado y los datos fiscales no se tocan aunque la petición los traiga (prueba en `demo-facturacion/tests/establecimiento_api_test.ts`).
Pendiente: dirección, código SAT real y datos fiscales de cada uno con el paso `datos-emisor` (solo lectura), que necesita la autorización (UUID) de un DTE de cada establecimiento.
En «Nueva factura» el facturador ve solo su establecimiento, elegido y bloqueado; el supervisor con `establecimientos.multiples` elige entre los suyos (`demo-facturacion/tests/e2e_establecimiento_bloqueado.cjs`).

## Administración de establecimientos y personas (etapa 1D, local, apagada por defecto)

- **SQL `M-H_admin_establecimientos.sql`** (propuesta; requiere M-F y M-G): `fel_adm_asignaciones_listar`, `fel_adm_establecimiento_nombre` y `fel_adm_supervisor`. Reciben **solo el token de la sesión**; la persona y la empresa salen de la sesión validada en la base. Añadidas a la lista explícita de `nexa_app` (M-E): 108 funciones.
- **API** `/api/admin/*` (existe solo si se inyecta el puerto `adminEst`): `GET establecimientos`, `POST establecimientos/:id/nombre`, `POST asignaciones`, `POST asignaciones/revocar`, `POST supervisor`. El cuerpo nunca aporta «actor» ni «empresa» (aunque los mande, no se leen).
- **Pantalla** «Establecimientos» (`web/js/establecimientos.js`): tarjetas táctiles; nombre interno editable (el código no); persona → establecimiento con motivo; «supervisor» con motivo; historial. Solo aparece con el permiso `establecimientos.asignar`.
- **Interruptores (todos apagados):** `FEL_ESTABLECIMIENTO_POR_USUARIO=1` en la función (`nube/funcion.ts`), `FEL_DEMO_ESTABLECIMIENTOS=1` en la demo local (PGlite + M-D…M-H, códigos 2 y 67, marta → 2). Con ellos apagados no cambia nada (ni rutas ni rendimiento).
- **Pruebas:** `prueba-admin-establecimientos.sql` (como `nexa_app`, en `tools/test-rol-app.sh`), `tests/admin_establecimientos_api_test.ts`, `tests/e2e_establecimientos_admin.cjs` y `tests/e2e_establecimiento_bloqueado.cjs`.
- **Reglas:** quien factura no administra; el supervisor se concede con motivo, nunca a uno mismo, a un lector ni al propietario; al retirarlo queda un solo establecimiento; una reasignación revoca (no borra) la asignación anterior y nunca cambia el establecimiento de un documento; un borrador del establecimiento anterior solo lo traslada un administrador con motivo (`fel_adm_borrador_trasladar`).
- **Pendiente:** `datos-emisor` de 2 y 67 (integración fiscal real) y aplicar M-F…M-H en la base hospedada (etapa 1E, requiere autorización).
