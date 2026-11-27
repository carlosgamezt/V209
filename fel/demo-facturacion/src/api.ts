import { tiposCertificablesTest } from "./tipos_prueba.ts";
import { leerLote } from "./lote.ts";
// API HTTP de la demostración. Cada endpoint llama a las MISMAS funciones SQL y al MISMO orquestador que las pruebas; no hay lógica fiscal aquí.
// Todo es simulado: el único proveedor es el simulado y nada sale de este equipo.
import { MockProvider, type Escenario } from "../../proveedores/src/mock.ts";
import { OrquestadorDb, ProcesoCaido } from "../../proveedores/src/orquestador_db.ts";
import { ErrorBd } from "../../proveedores/src/rpc.ts";
import { aInterno, calcular, type LineaEntrada } from "../../supabase/functions/fel-api/lib/calculo.ts";
import { esCF, NOMBRE_CF } from "./receptor_nit.ts";
import { tiposDisponibles } from "./tipos_disponibles.ts";
import { leerFiltros, listarDocumentos } from "./lista_documentos.ts";
import type { AdminEst } from "./admin_establecimientos.ts";
import { conIdentidadDeSesion, peticion, ErrorIdentidad } from "./identidad_sesion.ts";
import { conDataApi, type OpcionesDataApi } from "./puerto_datos.ts";
import { PARAMETROS_USUARIO, SQL_PARAMETROS_USUARIO } from "./parametros.ts";
import { filtrosClientes, filtrosConceptos, paginarClientes, paginarConceptos, TOPE_CLIENTES_ESTADO, TOPE_CONCEPTOS_ESTADO } from "./lista_catalogos.ts";
import { enAlcance, establecimientoNuevo, restringido, ErrorAlcance, type Alcance, type LectorAlcance } from "./alcance_establecimientos.ts";
import { CATALOGO_DTE, esCodigoDte, tipoDte, TIPOS_RECIBO } from "../../proveedores/src/catalogo_dte.ts";
import type { EmissionProvider } from "../../proveedores/src/tipos.ts";
import type { Autorizador } from "../../proveedores/src/autorizacion_humana.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { ProveedorEnrutado } from "../../proveedores/src/proveedor_enrutado.ts";
import type { BdDemo } from "./bd.ts";
import { Sesiones } from "./sesiones.ts";
import { PERSONAS, esMaestro } from "./mundo_practico.ts";
import type { Persona } from "./almacen.ts";
import { crearPractico, ErrorPr } from "./api_practico.ts";
import type { ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import type { ConsultorNit } from "./digifact_nit_entorno.ts";
import type { ConsultorCui } from "./digifact_cui_entorno.ts";
import { normalizarCui, RE_CUI } from "./receptor_cui.ts";
import { PersistenciaSimuladores } from "./simuladores.ts";
import { EMPRESA, type Sembrado } from "./mundo_demo.ts";
import { ErrorCorreo, type ServicioCorreo } from "./correo/servicio.ts";
import { hoyGt, validarFechaEmision, ventanaEmision } from "../../proveedores/src/fecha_emision.ts";
import type { PoliticaCorreoDigifact } from "./digifact_correo_entorno.ts";

export const ESCENARIOS: { id: Escenario; nombre: string; explicacion: string }[] = [
  { id: "exito", nombre: "Éxito", explicacion: "El proveedor certifica y responde correctamente." },
  { id: "rechazo", nombre: "Rechazo confirmado", explicacion: "El proveedor garantiza que NO hay documento: se puede corregir." },
  { id: "timeout_antes", nombre: "Tiempo agotado · el proveedor NO procesó", explicacion: "No hay respuesta y nada se certificó. Queda «por verificar»." },
  { id: "timeout_despues", nombre: "Tiempo agotado · el proveedor SÍ certificó", explicacion: "No hay respuesta pero el proveedor certificó. Queda «por verificar»; al consultar se confirma." },
  { id: "respuesta_ilegible", nombre: "Respuesta ilegible", explicacion: "El proveedor certificó pero la respuesta no se entiende." },
  { id: "codigo_desconocido_certificado", nombre: "Código desconocido (sí certificó)", explicacion: "Respuesta que el sistema no sabe interpretar; nunca se toma por éxito." },
  { id: "timeout_indeterminado", nombre: "Sin forma de saberlo", explicacion: "Ni consultando al proveedor se puede decidir: exige conciliación manual de dos personas." },
  { id: "timeout_tardio", nombre: "Respuesta tardía", explicacion: "El proveedor certificará DESPUÉS; mientras tanto no se sabe." },
  { id: "caida", nombre: "Servicio caído", explicacion: "El proveedor no responde; no es un rechazo garantizado." },
  { id: "accion_humana", nombre: "Canal asistido (una persona termina)", explicacion: "Imita al futuro canal de Playwright: el sistema llena y una persona emite en el portal." },
];
const ESC_IDS = new Set(ESCENARIOS.map((e) => e.id));
export class ErrorHttp extends Error { constructor(public status: number, mensaje: string, public codigo = "error") { super(mensaje); } }

const STATUS: Record<string, number> = { FEL_NO_AUTORIZADO: 403, FEL_NO_ENCONTRADO: 404, FEL_CONFLICTO: 409, FEL_OPERACION_ABIERTA: 409, FEL_POR_VERIFICAR: 409, FEL_ALERTA_ABIERTA: 409,
  FEL_ESPERA_TARDIA: 409, FEL_ESTADO: 409, FEL_REVOCADO: 409, FEL_AUDITORIA_PENDIENTE: 409, FEL_YA_ENVIADA: 409, FEL_REGLA: 422 };
const uuidOk = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const texto = (x: unknown, min: number, max: number, campo: string): string => { if (typeof x !== "string" || x.trim().length < min || x.length > max) throw new ErrorHttp(400, `${campo}: texto de ${min} a ${max} caracteres`, "entrada_invalida"); return x.trim(); };
// (Ahora los datos de contacto viven en la tabla de empresas y se editan con fel_op_empresa_datos_guardar.)
const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
type Obj = Record<string, unknown>;

export function crearApi(bdBase: BdDemo, mundo: Sembrado, extras: { identidadSesion?: boolean; /** W3 · Data API: opciones del cliente de PostgREST (con el JWT de la petición); nada de credenciales de base */ datosApi?: OpcionesDataApi; /** W3 · extrae el access token de la persona de la petición (cabecera o cookie); sin él, las funciones de `api` se rechazan antes de salir */ jwtDe?: (req: Request) => string | null;  ahora?: () => Date; supervisor?: { salud(): unknown }; autorizador?: Autorizador; proveedor?: EmissionProvider; metricas?: { vaciar(): Promise<number> }; sesiones?: Sesiones; practico?: boolean; mfa?: Map<string, string>; digifact?: ServicioFelGt; digifactNit?: ConsultorNit; digifactCui?: ConsultorCui; digifactCorreo?: PoliticaCorreoDigifact; correo?: ServicioCorreo; /** Establecimiento asignado y bloqueado por usuario (apagado por omisión). */ alcance?: LectorAlcance; adminEst?: AdminEst } = {}) {
  const mock = new MockProvider({ idempotenciaNativa: false });   // el «servidor» del proveedor simulado NO deduplica: la protección está en nuestro lado
  const alcance = new AsyncLocalStorage<{ empresa: string; alc: Alcance | null }>();   // la empresa de CADA petición (una persona pertenece a una sola empresa; el maestro opera desde «Plataforma»)
  // IDENTIDAD DE SESIÓN (R2 · F1): con el interruptor, las funciones con envoltorio `fel_ses_*` se llaman con el token de la sesión y SIN actor ni empresa (la base los deduce); ver identidad_sesion.ts
  const bdInterna = extras.identidadSesion ? conIdentidadDeSesion(bdBase) : bdBase;
  const bd = extras.datosApi ? conDataApi(bdInterna, extras.datosApi) : bdInterna;   // W3: la Data API es la capa más externa (ve los nombres originales); lo que no existe en `api` baja a la conexión interna
  const emp = () => alcance.getStore()?.empresa ?? EMPRESA;
  const alc = () => alcance.getStore()?.alc ?? null;   // alcance de establecimientos de la persona de ESTA petición (null = sin restricción)
  const pr = extras.practico ? crearPractico(bd, { mock, emp, identidadSesion: extras.identidadSesion, sesiones: extras.sesiones, mfa: extras.mfa, digifact: extras.digifact, digifactNit: extras.digifactNit, digifactCui: extras.digifactCui, digifactCorreo: extras.digifactCorreo, correo: extras.correo }) : null;
  // estado de los simuladores en la base real (solo modo PostgreSQL con versión práctica): sobrevive a reinicios y es común a todas las instancias
  const simPersist = pr ? new PersistenciaSimuladores(bd, { mock, ...Object.fromEntries(pr.registro.listar().filter((x) => x.persistible).map((x) => [x.id, x.persistible!])) }) : null;
  const base = extras.proveedor ?? mock;   // «proveedor»: solo las pruebas del agente lo sustituyen (canal asistido); la demostración usa el simulado
  const orq = (ganchos?: ConstructorParameters<typeof OrquestadorDb>[2]) => new OrquestadorDb(bd.rpc, base, ganchos);
  const orqRec = () => new OrquestadorDb(bd.rpc, pr ? new ProveedorEnrutado(bd.rpc, { mock: base, ...Object.fromEntries(pr.registro.listar().map((x) => [x.id, x.proveedor])) }, base) : base);   // conciliar / recuperar: cada operación con SU proveedor
  const CTX = { ambiente: "simulado" as const, ahora: extras.ahora ?? (() => new Date()) };   // el reloj del SERVIDOR decide qué día es hoy (America/Guatemala); el del dispositivo no cuenta
  const personas = (): typeof PERSONAS => extras.sesiones ? PERSONAS : Object.fromEntries(Object.entries(PERSONAS).filter(([, u]) => u.empresa === EMPRESA)) as typeof PERSONAS;
  const canalDe = async (proveedor: string): Promise<string> => {
    const [c] = await bd.filas<{ id: string }>("select id from public.empresa_canales where empresa_id = $1 and proveedor_id = $2 and ambiente = 'simulado' and habilitado order by prioridad limit 1", [emp(), proveedor]);
    if (!c) throw new ErrorHttp(422, `La empresa no tiene un canal «${proveedor}» simulado habilitado`, "regla");
    return c.id;
  };
  const canalBase = async () => (pr ? await canalDe("mock") : mundo.canal);   // sin la versión práctica (pruebas del agente) el canal es el sembrado; con ella, el de la empresa de la petición
  /** Persona de una cuenta: con inicio de sesión sale del almacén (memoria o base de datos); en el modo de pruebas, del mundo sembrado. */
  const personaDe = async (clave: string): Promise<Persona | undefined> => extras.sesiones ? await extras.sesiones.persona(clave) : PERSONAS[clave];
  const todasPersonasLeer = async (): Promise<Record<string, Persona>> => extras.sesiones ? Object.fromEntries((await extras.sesiones.almacen.cuentas()).map((c) => [c.usuario, c.persona])) : personas();
  // Los nombres de las personas (para «Registrado por…») casi no cambian: se reutilizan 30 s en lugar de leer todas las cuentas en cada detalle de documento.
  let todasCache: { hasta: number; p: Promise<Record<string, Persona>> } | null = null;
  const todasPersonas = (): Promise<Record<string, Persona>> => { const t = Date.now(); if (todasCache && todasCache.hasta > t) return todasCache.p; const p = todasPersonasLeer(); todasCache = { hasta: t + 30_000, p }; p.catch(() => { todasCache = null; }); return p; };
  const actor = async (req: Request): Promise<{ clave: string; id: string }> => {
    if (extras.sesiones) {
      const s = await extras.sesiones.validar(Sesiones.idDeCookie(req)); if (!s) throw new ErrorHttp(401, "Inicia sesión para continuar", "no_sesion");
      const p = await personaDe(s.usuario); if (!p) throw new ErrorHttp(401, "Inicia sesión para continuar", "no_sesion");
      return { clave: s.usuario, id: p.id };
    }
    const c = req.headers.get("x-demo-usuario") ?? "ana"; if (!(c in personas())) throw new ErrorHttp(400, "Usuario de la demostración no válido", "entrada_invalida");
    return { clave: c, id: PERSONAS[c].id };
  };

  async function empresaDatos() {
    const [e] = await bd.filas<Obj>("select id, razon_social as nombre, nombre_comercial, nit, direccion_fiscal as direccion, telefono, correo_facturacion as correo from public.empresas where id = $1", [emp()]);
    return e;
  }
  // Los permisos se reutilizan unos segundos (cada consulta a la base remota cuesta un viaje de red, ≈140 ms medidos); cualquier escritura que no sea de datos de negocio (usuarios, roles, empresas…) los olvida.
  const permisosCache = new Map<string, { hasta: number; p: Promise<string[]> }>();
  const permisosDe = (a: { id: string }): Promise<string[]> => {
    const k = `${emp()}|${a.id}`, t = Date.now(), c = permisosCache.get(k); if (c && c.hasta > t) return c.p;
    const p = Promise.resolve(bd.rpc("fel_permisos_efectivos", { p_empresa: emp(), p_user: a.id }) as Promise<string[]>); permisosCache.set(k, { hasta: t + 5000, p }); p.catch(() => permisosCache.delete(k)); return p;
  };
  // Escrituras de datos de NEGOCIO: no cambian roles ni permisos ni el estado de los simuladores, así que no vacían lo reutilizado ni necesitan la sección crítica de los simuladores.
  const NEGOCIO_POST = [/^\/api\/(documentos|clientes|conceptos|establecimientos|empresa|tipos-documento)$/, /^\/api\/admin\/(establecimientos\/[^/]+\/nombre|asignaciones|asignaciones\/revocar|supervisor)$/, /^\/api\/documentos\/[^/]+\/(estado|reabrir|correo|digifact\/(validar|preparar|certificar|certificar-todo|conciliar|correo|destinatario))$/, /^\/api\/(clientes|conceptos)\/[^/]+\/(frecuente|estado)$/, /^\/api\/(receptores\/(nit|cui)|digifact\/(nit|calentar))$/];
  const LECTURA_SIN_SIM = /^\/api\/(estado|sesion|fecha-emision|tipos-documento|clientes|conceptos|correo\/estado|digifact\/estado)$|^\/api\/documentos$|^\/api\/documentos\/[^/]+\/correos$/;

  async function detalle(docId: string) {
    const viaApi = bd.lecturaApi ? await bd.lecturaApi("documento_detalle", { p_id: docId }) as Record<string, unknown> : null;   // Data API: UNA RPC por pantalla (RLS + empresa de la sesión)
    const [[d], lineas, operaciones, eventos, conciliaciones, alertas, artefactos] = viaApi ? [[viaApi.documento as Obj], viaApi.lineas, viaApi.operaciones, viaApi.eventos, viaApi.conciliaciones, viaApi.alertas, viaApi.artefactos] as [Obj[], Obj[], Obj[], Obj[], Obj[], Obj[], Obj[]] : await leerLote(bd, [   // siete lecturas independientes en UN solo viaje a la base
      ["select d.*, d.fecha_emision_prevista::text as fecha_emision_txt, c.nombre as cliente_nombre, c.email as cliente_email, c.tipo_identificacion as cliente_tipo, c.numero_identificacion as cliente_numero, e.nombre as establecimiento_nombre, e.codigo_sat as establecimiento_codigo from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos e on e.id = d.establecimiento_id and e.empresa_id = d.empresa_id where d.id = $1 and d.empresa_id = $2", [docId, emp()]],
      ["select orden, descripcion, cantidad::text as cantidad, precio_unitario::text as precio_unitario, descuento_tipo, descuento_valor::text as descuento_valor, importes from public.documento_lineas where documento_id = $1 order by orden", [docId]],
      ["select id, tipo, estado, proveedor, ambiente, enviada_en, orden_externa, resolucion, motivo_desconocido, reintento_desde, iniciada_en, resuelta_en, clave_idempotencia from public.operaciones_fiscales where documento_id = $1 order by iniciada_en, id", [docId]],
      ["select id, operacion_id, tipo, resultado, motivo, serie, numero, autorizacion, creado_en from public.eventos_proveedor where operacion_id in (select id from public.operaciones_fiscales where documento_id = $1) order by id", [docId]],
      ["select id, operacion_id, tipo, estado, evidencia, propuesta_por, propuesta_en, decidida_por, decidida_en, nota from public.conciliaciones where operacion_id in (select id from public.operaciones_fiscales where documento_id = $1) order by propuesta_en", [docId]],
      ["select id, operacion_id, tipo, detalle, creada_en, resuelta_en, nota from public.alertas_fiscales where documento_id = $1 order by creada_en", [docId]],
      ["select id, operacion_id, tipo, nombre, mime, sha256, tamano from public.artefactos_documento where documento_id = $1 order by tipo", [docId]],
    ]) as [Obj[], Obj[], Obj[], Obj[], Obj[], Obj[], Obj[]];
    if (!d) throw new ErrorHttp(404, "Documento no encontrado", "no_encontrado");
    // la fecha de emisión SIEMPRE como texto AAAA-MM-DD, tal cual está en la base (un objeto Date dependería de la zona horaria del servidor y el PDF mostraba «Sat Nov 21»)
    d.fecha_emision_prevista = d.fecha_emision_txt ?? null; delete d.fecha_emision_txt;
    let instantanea: unknown = null;
    if (d.establecimiento_id) { try { instantanea = await bd.rpc("fel_sys_documento_instantanea", { p_empresa: emp(), p_doc: docId }); } catch { instantanea = null; } }
    const nombresUsuario = Object.fromEntries(Object.values(await todasPersonas()).map((u) => [u.id, u.nombre]));
    return { documento: d, lineas, operaciones, eventos, conciliaciones, alertas, artefactos, instantanea, escenario: mock.escenarioDeDocumento(docId), nombresUsuario, ...(pr ? await pr.detalleExtra(docId) : {}) };
  }

  /** Tipo de documento pedido por el formulario (Factura por defecto). Valida lo que se puede validar ANTES de crear nada, para no dejar un borrador a medias: tipo conocido y disponible,
   *  habilitado para la empresa, origen certificado entre los candidatos, motivo y tipo de recibo. La base y el servicio lo vuelven a comprobar (el guardián del documento es el definitivo). */
  async function prevalidarTipo(a: { id: string }, b: Obj): Promise<{ tipo: string; origen: string | null; motivo: string | null; recibo: string | null; mantener?: boolean }> {
    if (!(await tiposDisponibles(bd))) {   // base sin la propuesta de tipos: la demostración sigue como antes (solo Factura); no se consulta ninguna columna ni función nuevas
      if (b.tipo_dte === undefined || b.tipo_dte === null || b.tipo_dte === "" || b.tipo_dte === "FACT") return { tipo: "FACT", origen: null, motivo: null, recibo: null, mantener: true };
      throw new ErrorHttp(422, "Los tipos de documento aún no están habilitados en esta base de datos.", "regla");
    }
    // un cliente que no manda el tipo (versiones anteriores del formulario) NO cambia el tipo de un documento existente
    if ((b.tipo_dte === undefined || b.tipo_dte === null) && uuidOk(b.id)) { const [d] = await bd.filas<{ tipo_dte: string }>("select tipo_dte from public.documentos where id = $1 and empresa_id = $2", [b.id, emp()]); return { tipo: d?.tipo_dte ?? "FACT", origen: null, motivo: null, recibo: null, mantener: true }; }
    const tipo = b.tipo_dte === undefined || b.tipo_dte === null || b.tipo_dte === "" ? "FACT" : b.tipo_dte;
    if (!esCodigoDte(tipo)) throw new ErrorHttp(400, "Tipo de documento no válido", "entrada_invalida");
    const t = tipoDte(tipo)!;
    if (t.disponibilidad === "pendiente") throw new ErrorHttp(422, `${t.nombre} aún no está disponible: ${t.motivoPendiente ?? "pendiente"}`, "regla");
    const cfg = await bd.rpc("fel_tipos_empresa", { p_actor: a.id, p_empresa: emp() }) as { tipos: { codigo: string; habilitado: boolean; motivo: string | null }[] };
    const h = cfg.tipos.find((x) => x.codigo === tipo);
    if (!h?.habilitado) throw new ErrorHttp(422, h?.motivo ?? `${t.nombre} no está habilitado para esta empresa`, "regla");
    const opc = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
    let origen: string | null = null, motivo: string | null = null, recibo: string | null = null;
    if (t.requiereOrigen) {
      if (!uuidOk(b.documento_origen_id)) throw new ErrorHttp(400, `${t.nombre}: elige el documento certificado al que hace referencia`, "entrada_invalida");
      const cand = await bd.rpc("fel_op_documento_origenes", { p_actor: a.id, p_empresa: emp(), p_tipo: tipo, p_cliente: null, p_buscar: null }) as { id: string }[];
      if (!cand.some((x) => x.id === b.documento_origen_id)) throw new ErrorHttp(422, "El documento de origen no existe, no está certificado o no es de un tipo permitido", "regla");
      origen = b.documento_origen_id; motivo = opc(b.motivo_ajuste, 50);
      if (!motivo || motivo.length < 3) throw new ErrorHttp(400, "Indica el motivo del ajuste (3 a 50 caracteres)", "entrada_invalida");
    }
    if (tipo === "RECI") { recibo = opc(b.tipo_recibo, 20); if (!recibo || !(TIPOS_RECIBO as readonly string[]).includes(recibo)) throw new ErrorHttp(400, `El recibo exige su tipo: ${TIPOS_RECIBO.join(", ")}`, "entrada_invalida"); }
    return { tipo, origen, motivo, recibo };
  }

  /** La fecha de emisión del documento guardado debe estar dentro de la ventana AHORA (reloj del servidor). Se usa al revisar y justo antes de certificar; nunca modifica la fecha. */
  async function exigirFechaVigente(docId: string, soloSiPendiente = false) {
    const [d] = await bd.filas<{ f: string | null; ef: string }>("select fecha_emision_prevista::text as f, estado_fiscal as ef from public.documentos where id = $1 and empresa_id = $2", [docId, emp()]);
    if (!d || (soloSiPendiente && !["ninguno", "rechazado"].includes(d.ef))) return;   // lo ya certificado no se juzga de nuevo (la reutilización es idempotente)
    if (!d.f) throw new ErrorHttp(422, "Indica la fecha de emisión.", "fecha_emision");
    const v = validarFechaEmision(d.f, CTX.ahora());
    if (!v.ok) throw new ErrorHttp(422, `${v.mensaje} Elige otra fecha de emisión: el borrador no se cambia solo.`, "fecha_emision");
  }

  async function guardar(a: { id: string }, b: Obj) {
    const tp = await prevalidarTipo(a, b);   // antes de tocar nada
    // ESTABLECIMIENTO (antes de escribir nada: una petición rechazada no modifica el documento). Restringido: el pedido solo vale si es el suyo; uno ajeno se RECHAZA (nunca se cambia en silencio); un documento que ya tiene establecimiento no lo cambia.
    let estPedido: string | undefined;
    try {
      estPedido = establecimientoNuevo(alc(), uuidOk(b.establecimiento_id) ? String(b.establecimiento_id) : undefined);
      if (restringido(alc()) && uuidOk(b.id)) { const [cur] = await bd.filas<{ establecimiento_id: string | null }>("select establecimiento_id from public.documentos where id = $1 and empresa_id = $2", [b.id, emp()]);
        if (cur?.establecimiento_id) { if (uuidOk(b.establecimiento_id) && b.establecimiento_id !== cur.establecimiento_id) throw new ErrorAlcance(403, "establecimiento_no_autorizado", "El establecimiento de un documento no se puede cambiar."); estPedido = undefined; } }
    } catch (e) { if (e instanceof ErrorAlcance) throw new ErrorHttp(e.status, e.message, e.codigo); throw e; }
    const lineasEntrada = b.lineas; if (!Array.isArray(lineasEntrada) || lineasEntrada.length < 1 || lineasEntrada.length > 50) throw new ErrorHttp(400, "Debe haber de 1 a 50 líneas", "entrada_invalida");
    const lineas = lineasEntrada.map((x: unknown, i: number) => {
      const l = x as Obj; const d = texto(l.descripcion, 1, 300, `Línea ${i + 1}: descripción`);
      for (const k of ["cantidad", "precio_unitario"]) if (typeof l[k] !== "string" || !RE_MONTO.test(l[k] as string)) throw new ErrorHttp(400, `Línea ${i + 1}: ${k === "cantidad" ? "cantidad" : "precio"} no válido (número con hasta 6 decimales)`, "entrada_invalida");
      const tipo = (l.descuento_tipo ?? "ninguno") as string; if (!["ninguno", "monto", "porcentaje"].includes(tipo)) throw new ErrorHttp(400, `Línea ${i + 1}: tipo de descuento no válido`, "entrada_invalida");
      const dv = String(l.descuento_valor ?? "0"); if (!RE_MONTO.test(dv)) throw new ErrorHttp(400, `Línea ${i + 1}: descuento no válido`, "entrada_invalida");
      return { descripcion: d, cantidad: l.cantidad as string, precio_unitario: l.precio_unitario as string, descuento_tipo: tipo as LineaEntrada["descuento_tipo"], descuento_valor: dv };
    });
    let c; try { c = calcular(lineas); } catch (e) { throw new ErrorHttp(400, (e as Error).message, "entrada_invalida"); }
    let clienteId = b.cliente_id as string | undefined;
    const nuevo = b.cliente_nuevo as Obj | undefined;
    // «CF» se reconoce con cualquier combinación de mayúsculas y espacios y se guarda siempre como tipo CF, número «CF», nombre «CONSUMIDOR FINAL»
    const tipoNuevo = nuevo ? (esCF(nuevo.numero_identificacion) || nuevo.tipo_identificacion === "CF" ? "CF" : String(nuevo.tipo_identificacion ?? "NIT")) : null;
    // SAT: «CF» solo se admite en facturas por montos MENORES a Q2,500.00 (Reglamento de la Ley del IVA, art. 30 núm. 9, reformado por el Acuerdo Gubernativo 12-2023, según las preguntas frecuentes del portal SAT; el texto oficial se contrastará con un contador antes de la emisión real).
    // Aquí el monto es la base de este documento (los precios incluyen IVA; los impuestos finales siguen pendientes). Es una regla de la DEMO; no habilita la emisión real, que sigue bloqueada.
    const esReceptorCF = nuevo && !clienteId ? tipoNuevo === "CF" : clienteId && uuidOk(clienteId) ? (await bd.filas<{ t: string }>("select tipo_identificacion as t from public.clientes where id = $1 and empresa_id = $2", [clienteId, emp()]))[0]?.t === "CF" : false;
    if (esReceptorCF && tp.tipo === "FACT" && aInterno(c.base_imponible) >= aInterno("2500")) throw new ErrorHttp(422, "Consumidor final solo se admite en facturas menores a Q2,500.00. Identifica al receptor con su NIT (o con su CUI si es persona individual sin NIT).", "regla");
    if (!clienteId && nuevo) {
      const tipo = tipoNuevo!; let num = tipo === "CF" ? "CF" : texto(nuevo.numero_identificacion, 1, 30, "Identificación del receptor");
      if (tipo === "CUI") { num = normalizarCui(num); if (!RE_CUI.test(num)) throw new ErrorHttp(400, "El CUI debe tener exactamente 13 dígitos (sin letras).", "entrada_invalida"); }
      // CF: la identificación SIEMPRE es «CF»; el nombre es «CONSUMIDOR FINAL» por omisión pero la persona puede escribir otro (p. ej. «Juan Pérez») sin que cambie la identificación. Un receptor CF con ese nombre se reutiliza si ya existe en la empresa.
      let nombreCF = NOMBRE_CF;
      if (tipo === "CF" && typeof nuevo.nombre === "string" && nuevo.nombre.trim() !== "" && nuevo.nombre.trim().toUpperCase() !== NOMBRE_CF) nombreCF = texto(nuevo.nombre, 1, 200, "Nombre del receptor");
      const previo = tipo === "CF" ? (await bd.filas<{ id: string }>("select id from public.clientes where empresa_id = $1 and tipo_identificacion = 'CF' and nombre = $2 and activo order by creado_en limit 1", [emp(), nombreCF]))[0] : undefined;
      if (previo) clienteId = previo.id;
      else {
        const r = await bd.rpc("fel_op_cliente_guardar", { p_actor: a.id, p_empresa: emp(), p_id: null, p_tipo_identificacion: tipo, p_numero_identificacion: num, p_nombre: tipo === "CF" ? nombreCF : texto(nuevo.nombre, 1, 200, "Nombre del receptor"), p_direccion: null, p_email: null, p_telefono: null, p_version: null }) as Obj;
        clienteId = r.id as string;
      }
    }
    if (clienteId && !uuidOk(clienteId)) throw new ErrorHttp(400, "Receptor no válido", "entrada_invalida");
    // FECHA DE EMISIÓN: se valida AQUÍ, en el servidor, con su reloj y la zona de Guatemala (la interfaz solo ayuda; una petición directa no la salta). Sin fecha: la que ya tenía el borrador o, si es nuevo, hoy.
    // Una fecha que NO cambia no se vuelve a juzgar al guardar (un borrador que venció no se cambia solo: se le impide revisarse y certificarse hasta que se elija otra fecha).
    const ahoraSrv = CTX.ahora();
    const previaFecha = uuidOk(b.id) ? ((await bd.filas<{ f: string | null }>("select fecha_emision_prevista::text as f from public.documentos where id = $1 and empresa_id = $2", [b.id, emp()]))[0]?.f ?? null) : null;
    let fecha: string;
    if (b.fecha === undefined || b.fecha === null || b.fecha === "") fecha = previaFecha ?? hoyGt(ahoraSrv);
    else {
      if (typeof b.fecha !== "string") throw new ErrorHttp(422, "La fecha de emisión debe tener el formato AAAA-MM-DD.", "fecha_emision");
      fecha = b.fecha;
      if (fecha !== previaFecha) { const v = validarFechaEmision(fecha, ahoraSrv); if (!v.ok) throw new ErrorHttp(422, v.mensaje, "fecha_emision"); }
    }
    const doc = await bd.rpc("fel_op_documento_guardar", { p_actor: a.id, p_empresa: emp(), p_id: b.id ?? null, p_cliente: clienteId ?? null, p_fecha: fecha, p_observaciones: typeof b.observaciones === "string" && b.observaciones.trim() ? b.observaciones.trim().slice(0, 500) : null,
      p_lineas: lineas.map((l, i) => ({ orden: i + 1, ...l, importes: c.lineas[i] })), p_subtotal: c.subtotal, p_descuento_total: c.descuento_total, p_base: c.base_imponible, p_calculo: c.meta, p_version: b.id ? Number(b.version) : null }) as Obj;
    // AUDITORÍA de la fecha de emisión (las fechas de creación, emisión y certificación son tres cosas distintas): se registra cuando se fija una distinta de hoy o cuando cambia
    if (previaFecha ? fecha !== previaFecha : fecha !== hoyGt(ahoraSrv)) {
      const v = validarFechaEmision(fecha, ahoraSrv);
      await bd.rpc("fel_auditar", { p_empresa: emp(), p_actor: a.id, p_accion: previaFecha ? "documento.fecha_emision_cambiada" : "documento.fecha_emision_fijada", p_entidad: "documento", p_entidad_id: doc.id, p_datos: JSON.stringify({ anterior: previaFecha, nueva: fecha, dias_atras: v.ok ? v.diasAtras : null, mes_anterior: v.ok ? v.mesAnterior : null, hoy_servidor: hoyGt(ahoraSrv) }) });
    }
    if (estPedido) await bd.rpc("fel_op_documento_establecimiento", { p_actor: a.id, p_empresa: emp(), p_doc: doc.id, p_est: estPedido });   // ya validado ANTES de escribir; con la función encendida el establecimiento lo decide el servidor
    // el tipo se asigna DESPUÉS (la base copia el receptor y la referencia fiscal del origen y valida habilitación, origen certificado, tope y duplicados)
    if (!tp.mantener) {
      const [ver] = await bd.filas<{ version: number; tipo_dte: string }>("select version, tipo_dte from public.documentos where id = $1 and empresa_id = $2", [doc.id, emp()]);
      if (tp.tipo !== "FACT" || ver.tipo_dte !== "FACT") await bd.rpc("fel_op_documento_tipo", { p_actor: a.id, p_empresa: emp(), p_doc: doc.id, p_tipo: tp.tipo, p_origen: tp.origen, p_motivo: tp.motivo, p_tipo_recibo: tp.recibo, p_version: ver.version });
    }
    return doc.id as string;
  }

  async function manejar(req: Request, url: URL): Promise<Response> {
    const ruta = url.pathname, m = req.method;
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    const cuerpo = async (): Promise<Obj> => { if (req.headers.get("x-demo") !== "1") throw new ErrorHttp(403, "Falta la cabecera de la demostración", "no_autorizado"); const t = await req.text(); if (t.length > 262144) throw new ErrorHttp(413, "Cuerpo demasiado grande"); try { const o = t ? JSON.parse(t) : {}; if (o === null || typeof o !== "object" || Array.isArray(o)) throw 0; return o as Obj; } catch { throw new ErrorHttp(400, "JSON no válido", "entrada_invalida"); } };
    const id = (p: string) => { const x = p; if (!uuidOk(x)) throw new ErrorHttp(400, "Identificador no válido", "entrada_invalida"); return x; };
    const a = await actor(req); let r: RegExpExecArray | null;

    if (m === "GET" && ruta === "/api/estado") {
      const permisos = await permisosDe(a);
      const lecturaApi = bd.lecturaApi ? await bd.lecturaApi("estado_catalogos") as Record<string, unknown[]> : null;   // W4: Data API, una RPC por pantalla (RLS + empresa de la sesión)
      const [establecimientos, clientes, conceptos, [totales], parametros] = lecturaApi ? [lecturaApi.establecimientos, lecturaApi.clientes, lecturaApi.conceptos, [{ clientes_total: lecturaApi.clientes_total, conceptos_total: lecturaApi.conceptos_total }], lecturaApi.parametros] : await leerLote(bd, [   // cuatro lecturas independientes en UN solo viaje a la base
      ["select id, codigo_sat, nombre from public.establecimientos where empresa_id = $1 and estado = 'activo' order by codigo_sat", [emp()]],
      ["select id, tipo_identificacion, numero_identificacion, nombre, direccion, email, telefono, frecuente from public.clientes where empresa_id = $1 and activo order by frecuente desc, nombre limit " + TOPE_CLIENTES_ESTADO, [emp()]],
      ["select id, codigo, descripcion, tipo, unidad_medida, precio_unitario::text as precio_unitario from public.conceptos where empresa_id = $1 and activo order by descripcion limit " + TOPE_CONCEPTOS_ESTADO, [emp()]],
      ["select (select count(*)::int from public.clientes where empresa_id = $1 and activo) as clientes_total, (select count(*)::int from public.conceptos where empresa_id = $1 and activo) as conceptos_total", [emp()]],
      [SQL_PARAMETROS_USUARIO, [PARAMETROS_USUARIO as string[]]],   // lista explícita (clase «usuario»): jamás todos los parámetros de plataforma
      ]);
      const alcE = alc(), restr = restringido(alcE);   // persona con establecimiento asignado: SOLO ve el suyo (o los suyos) y el servidor lo fija; la pantalla solo lo muestra bloqueado
      const estPermitidos = restr ? (establecimientos as Array<{ id: string }>).filter((x) => alcE!.ids.includes(x.id)) : establecimientos;
      const alcancePublico = restr ? { restringido: true, multiples: alcE!.multiples, activo: alcE!.activo ?? (alcE!.ids[0] ?? null), ids: alcE!.ids } : { restringido: false };
      return json({ empresa: await empresaDatos(), usuario: { clave: a.clave, ...(await personaDe(a.clave)) }, login: !!extras.sesiones, persistente: bd.tipo === "pg", practico: !!pr, ...(pr ? await pr.estadoExtra() : {}), usuarios: extras.sesiones ? [] : Object.entries(personas()).map(([k, u]) => ({ clave: k, nombre: u.nombre, rol: u.rol, descripcion: u.descripcion })),
        permisos, establecimientos: estPermitidos, alcance: alcancePublico, adminEstablecimientos: !!extras.adminEst, clientes, conceptos, clientes_total: (totales as Obj).clientes_total, conceptos_total: (totales as Obj).conceptos_total, canal: await canalBase(), escenarios: ESCENARIOS, parametros, aviso: "SIMULADO - SIN VALOR FISCAL" });
    }
    if (m === "GET" && ruta === "/api/clientes" && url.searchParams.has("pagina")) {   // paginado en el servidor (se usa cuando hay más clientes que el conjunto de trabajo de /api/estado)
      const f = filtrosClientes(url.searchParams); return json(bd.lecturaApi ? await bd.lecturaApi("clientes_pagina", { p_filtros: f }) : await paginarClientes(bd, emp(), f));
    }
    if (m === "GET" && ruta === "/api/conceptos" && url.searchParams.has("pagina")) {
      const f = filtrosConceptos(url.searchParams); return json(bd.lecturaApi ? await bd.lecturaApi("conceptos_pagina", { p_filtros: f }) : await paginarConceptos(bd, emp(), f));
    }
    if (m === "GET" && ruta === "/api/clientes") {
      if (bd.lecturaApi) return json(await bd.lecturaApi("clientes_listar"));   // con la Data API activa NO hay degradación: sin JWT se rechaza
      return json(await bd.filas("select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.activo, c.version, c.frecuente, (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas from public.clientes c where c.empresa_id = $1 order by c.nombre", [emp()]));
    }
    if (m === "POST" && ruta === "/api/clientes") {
      const b = await cuerpo(); const tipo = String(b.tipo_identificacion ?? "NIT"); if (!["NIT", "CUI", "EXT", "CF"].includes(tipo)) throw new ErrorHttp(400, "Tipo de identificación no válido", "entrada_invalida");
      let num = tipo === "CF" ? "CF" : texto(b.numero_identificacion, 1, 30, "Identificación");
      if (tipo === "CUI") { num = normalizarCui(num); if (!RE_CUI.test(num)) throw new ErrorHttp(400, "El CUI debe tener exactamente 13 dígitos (sin letras).", "entrada_invalida"); }   // 13 dígitos es lo que exige el documento fiscal (TaxIDType=\"CUI\"); sin algoritmos no confirmados
      const opc = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
      const r = await bd.rpc("fel_op_cliente_guardar", { p_actor: a.id, p_empresa: emp(), p_id: uuidOk(b.id) ? b.id : null, p_tipo_identificacion: tipo, p_numero_identificacion: num, p_nombre: tipo === "CF" ? "Consumidor final" : texto(b.nombre, 1, 200, "Nombre"), p_direccion: opc(b.direccion, 300), p_email: opc(b.email, 200), p_telefono: opc(b.telefono, 40), p_version: b.id ? Number(b.version) : null });
      return json(r);
    }
    if (m === "GET" && ruta === "/api/conceptos" && bd.lecturaApi) return json(await bd.lecturaApi("conceptos_listar"));
    if (m === "GET" && ruta === "/api/conceptos") return json(await bd.filas("select id, codigo, descripcion, tipo, unidad_medida, precio_unitario::text as precio_unitario, activo, version from public.conceptos where empresa_id = $1 order by descripcion", [emp()]));
    if (m === "POST" && ruta === "/api/conceptos") {
      const b = await cuerpo(); if (!["bien", "servicio"].includes(String(b.tipo))) throw new ErrorHttp(400, "Tipo de concepto no válido", "entrada_invalida");
      if (typeof b.precio_unitario !== "string" || !RE_MONTO.test(b.precio_unitario)) throw new ErrorHttp(400, "Precio no válido (número con hasta 6 decimales)", "entrada_invalida");
      const r = await bd.rpc("fel_op_concepto_guardar", { p_actor: a.id, p_empresa: emp(), p_id: uuidOk(b.id) ? b.id : null, p_codigo: texto(b.codigo, 1, 40, "Código"), p_descripcion: texto(b.descripcion, 1, 300, "Descripción"), p_tipo: b.tipo, p_unidad_medida: "UND", p_precio_unitario: b.precio_unitario, p_categoria_fiscal: null, p_version: b.id ? Number(b.version) : null });
      return json(r);
    }
    if (m === "GET" && ruta === "/api/fecha-emision") return json(ventanaEmision(CTX.ahora()));   // hoy en Guatemala (servidor) y la fecha más antigua permitida
    if (m === "GET" && ruta === "/api/configuracion") {
      const [empr] = await bd.filas("select e.razon_social, e.nombre_comercial, e.nit, e.estado, e.moneda, e.emision_real_habilitada, r.nombre as regimen, r.estado as regimen_estado from public.empresas e left join public.regimenes_fiscales r on r.id = e.regimen_id where e.id = $1", [emp()]);
      const establecimientos = bd.lecturaApi ? await bd.lecturaApi("establecimientos_listar") as unknown[] : await bd.filas("select id, codigo_sat, nombre, direccion, estado, (select count(*)::int from public.documentos d where d.establecimiento_id = x.id and d.empresa_id = x.empresa_id) as documentos from public.establecimientos x where x.empresa_id = $1 order by codigo_sat", [emp()]);
      const proveedores = await bd.filas("select id, nombre, ambientes, habilitado, nota from public.proveedores_emision order by case id when 'mock' then 0 when 'portal_playwright' then 1 else 2 end");
      const canales = await bd.filas("select proveedor_id, ambiente, habilitado, prioridad from public.empresa_canales where empresa_id = $1", [emp()]);
      const parametros = await bd.filas(SQL_PARAMETROS_USUARIO, [PARAMETROS_USUARIO as string[]]);   // lista explícita (clase «usuario»)
      const [cont] = await bd.filas("select coalesce(max(numero_borrador), 0)::int as ultimo from public.documentos where empresa_id = $1", [emp()]);
      return json({ empresa: { ...empr, ...(await empresaDatos()) }, establecimientos, proveedores, canales, parametros, ultimo_borrador: cont.ultimo });
    }
    // ---- ADMINISTRACIÓN de establecimientos y asignaciones (solo con el puerto activado). Jamás se lee un «actor» ni una «empresa» del cuerpo: la identidad es la de la sesión y la valida la base.
    if (extras.adminEst && ruta.startsWith("/api/admin/")) {
      const AD = extras.adminEst, motivo = (x: unknown, min = 5) => { const t = typeof x === "string" ? x.trim() : ""; if (t.length < min || t.length > 300) throw new ErrorHttp(422, `Indica el motivo (entre ${min} y 300 caracteres)`, "entrada_invalida"); return t; };
      if (m === "GET" && ruta === "/api/admin/establecimientos") return json(await AD.listar(req));
      if (m === "POST" && (r = /^\/api\/admin\/establecimientos\/([^/]+)\/nombre$/.exec(ruta))) { const b = await cuerpo(); await AD.nombre(req, id(r[1]), texto(b.nombre, 1, 120, "Nombre")); return json({ ok: true }); }
      if (m === "POST" && ruta === "/api/admin/asignaciones") { const b = await cuerpo(); return json(await AD.asignar(req, id(String(b.usuario ?? "")), id(String(b.establecimiento_id ?? "")), b.predeterminado !== false, motivo(b.motivo))); }
      if (m === "POST" && ruta === "/api/admin/asignaciones/revocar") { const b = await cuerpo(); await AD.revocar(req, id(String(b.usuario ?? "")), id(String(b.establecimiento_id ?? "")), motivo(b.motivo)); return json({ ok: true }); }
      if (m === "POST" && ruta === "/api/admin/supervisor") { const b = await cuerpo(); if (typeof b.valor !== "boolean") throw new ErrorHttp(422, "Indica si se concede o se retira", "entrada_invalida"); await AD.supervisor(req, id(String(b.usuario ?? "")), b.valor, motivo(b.motivo)); return json({ ok: true }); }
      throw new ErrorHttp(404, "No existe", "no_encontrado");
    }
    if (m === "POST" && ruta === "/api/establecimientos") {
      const b = await cuerpo(); const estado = b.estado === "inactivo" ? "inactivo" : "activo";
      const r = await bd.rpc("fel_op_establecimiento_guardar", { p_actor: a.id, p_empresa: emp(), p_id: uuidOk(b.id) ? b.id : null, p_codigo: texto(b.codigo_sat, 1, 10, "Código SAT"), p_nombre: texto(b.nombre, 1, 120, "Nombre"), p_direccion: typeof b.direccion === "string" && b.direccion.trim() ? b.direccion.trim().slice(0, 300) : null, p_estado: estado });
      return json(r);
    }
    if (m === "POST" && ruta === "/api/empresa") {
      const b = await cuerpo(); const opc = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
      await bd.rpc("fel_op_empresa_datos_guardar", { p_actor: a.id, p_empresa: emp(), p_nombre_comercial: texto(b.nombre_comercial, 1, 120, "Nombre comercial"), p_direccion: opc(b.direccion, 300), p_telefono: opc(b.telefono, 40), p_correo: opc(b.correo, 200) });
      return json(await empresaDatos());
    }
    if (m === "POST" && (r = /^\/api\/clientes\/([^/]+)\/(frecuente|estado)$/.exec(ruta))) {
      const b = await cuerpo(); const cid = id(r[1]);
      if (r[2] === "frecuente") await bd.rpc("fel_op_cliente_frecuente", { p_actor: a.id, p_empresa: emp(), p_id: cid, p_frecuente: b.frecuente === true });
      else await bd.rpc("fel_op_cliente_estado", { p_actor: a.id, p_empresa: emp(), p_id: cid, p_activo: b.activo === true });
      return json({ ok: true });
    }
    if (m === "POST" && (r = /^\/api\/conceptos\/([^/]+)\/estado$/.exec(ruta))) {
      const b = await cuerpo(); await bd.rpc("fel_op_concepto_estado", { p_actor: a.id, p_empresa: emp(), p_id: id(r[1]), p_activo: b.activo === true }); return json({ ok: true });
    }
    // ---- agentes locales (lado de la persona de la empresa; el lado del agente está en /api/agente/v1/*, con firma)
    if (m === "POST" && ruta === "/api/agentes/codigo") { await cuerpo(); return json(await bd.rpc("fel_op_agente_codigo_crear", { p_actor: a.id, p_empresa: emp() })); }
    if (m === "GET" && ruta === "/api/agentes") return json(await bd.rpc("fel_op_agentes_listar", { p_actor: a.id, p_empresa: emp() }));
    if (m === "POST" && ruta === "/api/agentes/revocar") { const b = await cuerpo(); await bd.rpc("fel_op_agente_revocar", { p_actor: a.id, p_empresa: emp(), p_agente: id(b.agente as string) }); return json({ ok: true }); }
    // ---- autorización HUMANA de la confirmación (la persona, no el agente; fel/docs/agente-confirmacion-humana.md). La respuesta nunca incluye la concesión firmada.
    if (m === "GET" && (r = /^\/api\/ordenes\/([^/]+)\/vista-previa$/.exec(ruta))) return json(await bd.rpc("fel_op_orden_vista_previa", { p_actor: a.id, p_empresa: emp(), p_orden: id(r[1]) }));
    if (m === "POST" && (r = /^\/api\/ordenes\/([^/]+)\/autorizar$/.exec(ruta))) {
      await cuerpo(); if (!extras.autorizador) throw new ErrorHttp(404, "La autorización de confirmación no está disponible en esta demostración", "no_disponible");
      return json({ ok: true, ...(await extras.autorizador.autorizar({ actor: a.id, empresa: emp(), orden: id(r[1]) })) });
    }
    if (m === "GET" && ruta === "/api/agentes/metricas") {   // uso real del plano de control de SU empresa (para estimar costos); requiere permiso en la base
      const h = Number(url.searchParams.get("horas") ?? "24"); if (!Number.isInteger(h) || h < 1 || h > 720) throw new ErrorHttp(400, "Horas no válidas", "entrada_invalida");
      await extras.metricas?.vaciar();
      return json(await bd.rpc("fel_op_agente_metricas", { p_actor: a.id, p_empresa: emp(), p_horas: h }));
    }
    if (m === "GET" && ruta === "/api/agentes/salud") {
      if (!(await permisosDe(a)).includes("canales.ver")) throw new ErrorHttp(403, "No tienes permiso", "no_autorizado");
      return json(extras.supervisor?.salud() ?? { ok: false, en_marcha: false });
    }
    // ---- tipos de documento: catálogo (código), habilitación y predeterminado por empresa (base), origen de las notas
    if (m === "GET" && ruta === "/api/tipos-documento" && !(await tiposDisponibles(bd))) {   // sin la propuesta aplicada: el catálogo se ve, pero solo Factura está habilitada
      return json({ predeterminado: "FACT", puede_configurar: false, sin_migracion: true, tipos: CATALOGO_DTE.map((t) => ({ codigo: t.codigo, nombre: t.nombre, corto: t.corto, familia: t.familia, titulo: t.tituloDocumento, disponibilidad: t.disponibilidad, certificacion_habilitada: t.certificacionHabilitada,
        requiere_origen: t.requiereOrigen, origenes_permitidos: t.origenesPermitidos, campos_obligatorios: t.camposObligatorios, complementos: t.complementos, regimen: t.regimen.condicion, regimen_verificado: t.regimen.verificado, motivo_pendiente: t.motivoPendiente ?? null, pendientes_verificar: t.pendientesVerificar,
        habilitado: t.codigo === "FACT", motivo_no_habilitado: t.codigo === "FACT" ? null : "Falta aplicar la migración de tipos de documento en esta base de datos", base_habilitacion: null, predeterminado: t.codigo === "FACT" })) });
    }
    if (((ruta === "/api/tipos-documento" && m === "POST") || (ruta === "/api/documentos/origenes" && m === "GET")) && !(await tiposDisponibles(bd))) throw new ErrorHttp(422, "Los tipos de documento aún no están habilitados en esta base de datos.", "regla");
    if (m === "GET" && ruta === "/api/tipos-documento") {
      const tiposTest = await tiposCertificablesTest(bd);
      const permisos = await permisosDe(a), cfg = await bd.rpc("fel_tipos_empresa", { p_actor: a.id, p_empresa: emp() }) as { tipos: { codigo: string; habilitado: boolean; motivo: string | null; base_habilitacion: string | null; predeterminado: boolean }[]; predeterminado: string };
      return json({ predeterminado: cfg.predeterminado, puede_configurar: permisos.includes("empresa.editar"), tipos: CATALOGO_DTE.map((t) => {
        const h = cfg.tipos.find((x) => x.codigo === t.codigo);
        return { codigo: t.codigo, nombre: t.nombre, corto: t.corto, familia: t.familia, titulo: t.tituloDocumento, disponibilidad: t.disponibilidad, certificacion_habilitada: t.certificacionHabilitada, certificacion_test: t.certificacionHabilitada || tiposTest.includes(t.codigo), requiere_origen: t.requiereOrigen, origenes_permitidos: t.origenesPermitidos,
          campos_obligatorios: t.camposObligatorios, complementos: t.complementos, regimen: t.regimen.condicion, regimen_verificado: t.regimen.verificado, motivo_pendiente: t.motivoPendiente ?? null, pendientes_verificar: t.pendientesVerificar,
          habilitado: !!h?.habilitado, motivo_no_habilitado: h?.motivo ?? null, base_habilitacion: h?.base_habilitacion ?? null, predeterminado: !!h?.predeterminado };
      }) });
    }
    if (m === "POST" && ruta === "/api/tipos-documento") {
      const b = await cuerpo(); if (!esCodigoDte(b.tipo)) throw new ErrorHttp(400, "Tipo de documento no válido", "entrada_invalida");
      await bd.rpc("fel_op_tipos_empresa_guardar", { p_actor: a.id, p_empresa: emp(), p_tipo: b.tipo, p_habilitado: b.habilitado === true, p_base: typeof b.base_habilitacion === "string" ? b.base_habilitacion.slice(0, 300) : null, p_predeterminado: b.predeterminado === true });
      return json({ ok: true });
    }
    if (m === "GET" && ruta === "/api/documentos/origenes") {
      const tipo = url.searchParams.get("tipo") ?? ""; if (!esCodigoDte(tipo)) throw new ErrorHttp(400, "Tipo de documento no válido", "entrada_invalida");
      const cli = url.searchParams.get("cliente"), q = url.searchParams.get("q");
      return json(await bd.rpc("fel_op_documento_origenes", { p_actor: a.id, p_empresa: emp(), p_tipo: tipo, p_cliente: cli && uuidOk(cli) ? cli : null, p_buscar: q ? q.slice(0, 40) : null }));
    }
    if (m === "GET" && ruta === "/api/documentos" && bd.lecturaApi) {   // Data API: RPC INVOKER + RLS; sin JWT se rechaza (no hay degradación al pooler). Sin «pagina» (ruta antigua) se devuelven las primeras 100 filas
      const f = leerFiltros(url.searchParams); const r = await bd.lecturaApi("documentos_listar", { p_filtros: { ...f, ...(restringido(alc()) ? { establecimientos: alc()!.ids } : {}) } }) as { items: unknown[] };
      return json(url.searchParams.has("pagina") || restringido(alc()) ? r : (await bd.lecturaApi("documentos_listar", { p_filtros: { tam: 100 } }) as { items: unknown[] }).items);
    }
    if (m === "GET" && ruta === "/api/documentos") {
      if (url.searchParams.has("pagina") || restringido(alc())) return json(await listarDocumentos(bd, emp(), { ...leerFiltros(url.searchParams), ...(restringido(alc()) ? { establecimientos: alc()!.ids } : {}) }, await tiposDisponibles(bd)));   // paginado y filtrado en el servidor
      return json(await bd.filas("select d.id, d.numero_borrador, " + ((await tiposDisponibles(bd)) ? "d.tipo_dte, d.documento_origen_id, d.referencia_origen->>'serie' as origen_serie, d.referencia_origen->>'numero' as origen_numero, " : "") + "d.estado_preparacion, d.estado_fiscal, d.fecha_emision_prevista, d.base_imponible::text as base_imponible, d.serie, d.numero_fiscal, d.autorizacion_sat, d.version, d.actualizado_en, c.nombre as cliente_nombre, e.nombre as establecimiento_nombre, (select count(*)::int from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null) as alertas, uo.proveedor as canal_id, pe.nombre as canal_nombre, uo.ambiente as canal_ambiente, uo.estado as operacion_estado from public.documentos d left join lateral (select o.proveedor, o.ambiente, o.estado from public.operaciones_fiscales o where o.documento_id = d.id and o.tipo = 'certificacion' order by o.iniciada_en desc, o.id desc limit 1) uo on true left join public.proveedores_emision pe on pe.id = uo.proveedor left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos e on e.id = d.establecimiento_id and e.empresa_id = d.empresa_id where d.empresa_id = $1 order by d.numero_borrador desc", [emp()]));
    }
    if (m === "GET" && (r = /^\/api\/documentos\/([^/]+)$/.exec(ruta))) return json(await detalle(id(r[1])));
    if (m === "GET" && (r = /^\/api\/artefactos\/([^/]+)$/.exec(ruta)) && bd.lecturaApi) {   // Data API: la base exige `artefactos.descargar`, la empresa de la sesión y el alcance de establecimiento
      const x = await bd.lecturaApi("artefacto_descargar", { p_id: id(r[1]) }) as { nombre: string; mime: string; contenido_b64: string };
      const bytes = Uint8Array.from(atob(x.contenido_b64), (c) => c.charCodeAt(0));
      return new Response(bytes.buffer as ArrayBuffer, { headers: { "content-type": x.mime, "content-disposition": `attachment; filename="SIMULADO-${x.nombre.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
    }
    if (m === "GET" && (r = /^\/api\/artefactos\/([^/]+)$/.exec(ruta))) {
      const [x] = await bd.filas<{ nombre: string; mime: string; contenido: Uint8Array; tipo: string }>("select nombre, mime, contenido, tipo from public.artefactos_documento where id = $1 and empresa_id = $2", [id(r[1]), emp()]);
      if (!x) throw new ErrorHttp(404, "Archivo no encontrado", "no_encontrado");
      const permisos = await permisosDe(a); if (!permisos.includes("artefactos.descargar")) throw new ErrorHttp(403, "No tienes permiso para descargar", "no_autorizado");
      return new Response(new Uint8Array(x.contenido).buffer as ArrayBuffer, { headers: { "content-type": x.mime, "content-disposition": `attachment; filename="SIMULADO-${x.nombre.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
    }
    if (m === "POST" && ruta === "/api/documentos") { const b = await cuerpo(); const docId = await guardar(a, b); return json(await detalle(docId)); }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/estado$/.exec(ruta))) {
      const b = await cuerpo(); const nuevo = b.estado; if (!["borrador", "revisado", "archivado"].includes(nuevo as string)) throw new ErrorHttp(400, "Estado no válido", "entrada_invalida");
      if (nuevo === "revisado") await exigirFechaVigente(id(r[1]));   // no se revisa un borrador con la fecha fuera del plazo
      await bd.rpc("fel_op_documento_preparacion", { p_actor: a.id, p_empresa: emp(), p_id: id(r[1]), p_nuevo: nuevo, p_motivo: typeof b.motivo === "string" ? b.motivo : null, p_version: Number(b.version) });
      return json(await detalle(r[1]));
    }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/reabrir$/.exec(ruta))) { const b = await cuerpo(); await bd.rpc("fel_op_documento_reabrir", { p_actor: a.id, p_empresa: emp(), p_doc: id(r[1]), p_version: Number(b.version) }); return json(await detalle(r[1])); }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/validar$/.exec(ruta))) {
      const v = await orq().validar(emp(), id(r[1])); return json({ ok: v.ok, errores: v.errores, nota: "Validación estructural del proveedor simulado; no incluye reglas fiscales (impuestos, NIT oficial), que siguen pendientes de verificación." });
    }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/certificar$/.exec(ruta))) {
      const b = await cuerpo(); const docId = id(r[1]);
      await exigirFechaVigente(docId, true);   // revalidación justo antes de certificar (reloj del servidor); no cambia la fecha
      // Envío AUTOMÁTICO del correo tras certificar: solo si el servidor lo habilita (FEL_CORREO_AUTOMATICO) Y la petición lo pide Y quedó certificada. Un fallo del correo NUNCA afecta a la certificación.
      const correoAuto = async (): Promise<Obj | null> => {
        const svc = extras.correo; if (!svc || b.enviar_correo !== true || !svc.automatico) return null;
        try {
          const [op] = await bd.filas<{ id: string }>("select id from public.operaciones_fiscales where documento_id = $1 and empresa_id = $2 and tipo = 'certificacion' and estado = 'confirmada_exitosa' order by iniciada_en desc limit 1", [docId, emp()]);
          if (!op) return null;   // no quedó certificada: no hay nada que enviar
          const x = await svc.enviar({ empresaId: emp(), actorId: a.id, permisos: [] }, { documentoId: docId, clave: `auto:${op.id}`, origen: "automatico" });
          return { estado: x.envio.estado, repetido: x.repetido };
        } catch (e) { return { error: e instanceof ErrorCorreo ? e.codigo : "error_interno", mensaje: e instanceof ErrorCorreo ? e.message : "No se pudo enviar el correo." }; }
      };
      if (b.proveedor !== undefined && b.proveedor !== "mock") {   // certificador SIMULADO registrado: con cobertura (bolsón + monedero)
        if (!pr || !pr.registro.tiene(b.proveedor)) throw new ErrorHttp(400, "Certificador no válido o no disponible en este modo", "entrada_invalida");
        const s = await pr.certificar(a, docId, b, await canalDe(b.proveedor as string));
        return json({ resultado: { operacion: s.operacion.id, estado: s.operacion.estado, reutilizada: s.reutilizada, en_curso: s.enCurso }, ...(await detalle(docId)), correo_auto: await correoAuto() });
      }
      const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!ESC_IDS.has(esc as Escenario)) throw new ErrorHttp(400, "Escenario no válido", "entrada_invalida");
      const clave = texto(b.clave, 16, 80, "Clave de idempotencia");
      mock.fijarEscenario(docId, esc as Escenario);
      const s = await orq().solicitar({ actor: a.id, empresa: emp(), documento: docId, clave, canal: await canalBase() });
      return json({ resultado: { operacion: s.operacion.id, estado: s.operacion.estado, reutilizada: s.reutilizada, en_curso: s.enCurso }, ...(await detalle(docId)), correo_auto: await correoAuto() });
    }
    if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliar$/.exec(ruta))) {
      const permisos = await permisosDe(a); if (!permisos.includes("fiscal.conciliar")) throw new ErrorHttp(403, "No tienes permiso para conciliar", "no_autorizado");
      const op = await bd.rpc("fel_sys_operacion", { p_empresa: emp(), p_op: id(r[1]) }) as Obj; const c = await orqRec().conciliar(emp(), r[1]); await pr?.sincronizar();
      return json({ conciliacion: c, ...(await detalle(op.documento_id as string)) });
    }
    if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliacion$/.exec(ruta))) {
      const b = await cuerpo(); const op = await bd.rpc("fel_sys_operacion", { p_empresa: emp(), p_op: id(r[1]) }) as Obj;
      const e = (b.evidencia ?? {}) as Obj;
      await bd.rpc("fel_op_conciliacion_proponer", { p_actor: a.id, p_empresa: emp(), p_op: r[1], p_tipo: b.tipo, p_evidencia: { fuente: e.fuente, referencia: e.referencia, fecha_consulta: new Date().toISOString(), conclusion: b.tipo === "manual_fallida" ? "no_figura" : "figura" }, p_datos: b.datos ?? null });
      return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && (r = /^\/api\/conciliaciones\/([^/]+)\/decidir$/.exec(ruta))) {
      const b = await cuerpo(); const [c] = await bd.filas<{ operacion_id: string }>("select operacion_id from public.conciliaciones where id = $1 and empresa_id = $2", [id(r[1]), emp()]); if (!c) throw new ErrorHttp(404, "Conciliación no encontrada", "no_encontrado");
      await bd.rpc("fel_op_conciliacion_decidir", { p_actor: a.id, p_empresa: emp(), p_conciliacion: r[1], p_aprobar: b.aprobar === true, p_nota: typeof b.nota === "string" ? b.nota : "" });
      await pr?.sincronizar(); const op = await bd.rpc("fel_sys_operacion", { p_empresa: emp(), p_op: c.operacion_id }) as Obj; return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && (r = /^\/api\/alertas\/([^/]+)\/resolver$/.exec(ruta))) {
      const b = await cuerpo(); const [x] = await bd.filas<{ documento_id: string }>("select documento_id from public.alertas_fiscales where id = $1 and empresa_id = $2", [id(r[1]), emp()]); if (!x) throw new ErrorHttp(404, "Alerta no encontrada", "no_encontrado");
      await bd.rpc("fel_op_alerta_resolver", { p_actor: a.id, p_empresa: emp(), p_alerta: r[1], p_nota: typeof b.nota === "string" ? b.nota : "" }); return json(await detalle(x.documento_id));
    }
    // ---- controles de la DEMOSTRACIÓN: reproducen lo que en la realidad hacen el proveedor, el tiempo o una caída del proceso ----
    if (m === "POST" && ruta === "/api/demo/liberar-tardios") { await cuerpo(); await mock.liberarTardios(CTX); await pr?.sincronizar(); return json({ ok: true, aviso: "El proveedor simulado procesó las solicitudes tardías." }); }
    // barridos del SISTEMA sobre todas las empresas: con identidad de sesión no existen en la ruta de personas (los hace la función interna de sistema con nexa_sys)
    if (!extras.identidadSesion && m === "POST" && ruta === "/api/demo/auditar") { await cuerpo(); const x = await orqRec().auditarFallidas(); await pr?.sincronizar(); return json(x); }
    if (!extras.identidadSesion && m === "POST" && ruta === "/api/demo/recuperar") { await cuerpo(); const x = await orqRec().recuperar({ umbralMin: 0 }); await pr?.sincronizar(); return json(x); }
    if (m === "POST" && ruta === "/api/demo/completar-humana") {
      const b = await cuerpo(); const op = await bd.rpc("fel_sys_operacion", { p_empresa: emp(), p_op: id(b.operacion as string) }) as Obj;
      if (!op.orden_externa) throw new ErrorHttp(422, "La operación no espera una acción humana", "regla");
      const fin = await mock.completarAccionHumana(String(op.orden_externa), CTX); await orq().resolverAccionHumana(emp(), op.id as string, fin); return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && ruta === "/api/demo/caida") {
      const b = await cuerpo(); const docId = id(b.documento as string), punto = String(b.punto);
      if (!["a", "b", "c", "d"].includes(punto)) throw new ErrorHttp(400, "Punto de caída no válido", "entrada_invalida");
      const esc = typeof b.escenario === "string" && ESC_IDS.has(b.escenario as Escenario) ? b.escenario as Escenario : "exito"; mock.fijarEscenario(docId, esc);
      const caer = () => { throw new ProcesoCaido(punto); };
      const o = orq({ ganchos: { despuesDeSolicitar: punto === "a" ? caer : undefined, despuesDeMarcarEnvio: punto === "b" ? caer : undefined, despuesDeEnviar: punto === "c" ? caer : undefined, despuesDeEvento: punto === "d" ? caer : undefined } });
      let caido = false;
      try { await o.solicitar({ actor: a.id, empresa: emp(), documento: docId, clave: texto(b.clave, 16, 80, "Clave"), canal: await canalBase() }); } catch (e) { if (e instanceof ProcesoCaido) caido = true; else throw e; }
      return json({ caido, punto, ...(await detalle(docId)) });
    }
    if (pr) { const x = await pr.rutasEmpresa({ req, url, a, ruta, m, cuerpo, id, json, canalDe, detalle, permisos: () => permisosDe(a), alcance: alc(), revisar: async (docId, version) => { await exigirFechaVigente(docId); await bd.rpc("fel_op_documento_preparacion", { p_actor: a.id, p_empresa: emp(), p_id: docId, p_nuevo: "revisado", p_motivo: null, p_version: version }); } }); if (x) return x; }
    throw new ErrorHttp(404, "Ruta no encontrada", "no_encontrado");
  }

  const atenderPeticion = async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      if (pr) { const s = await pr.rutasSesion(req, url); if (s) return s; }   // inicio y cierre de sesión (no requieren sesión previa)
      const a = await actor(req);
      if (extras.datosApi && !extras.jwtDe?.(req)) throw new ErrorIdentidad("Sesión no válida");   // con la Data API activa, la cookie propia NO basta: toda ruta autenticada exige el JWT de la persona (nada llega a la base sin él)
      const negocio = req.method === "POST" && NEGOCIO_POST.some((r) => r.test(url.pathname));
      if (req.method === "POST" && !negocio) permisosCache.clear();   // puede cambiar roles o membresías: los permisos reutilizados no sobreviven
      const atender = async () => {
        if (pr && esMaestro(a.clave)) return await peticion.run({ token: Sesiones.idDeCookie(req), actor: a.id, empresa: null, jwt: extras.jwtDe?.(req) ?? null }, () => pr.rutasMaestro(req, url, a));   // el administrador de la plataforma opera desde «Plataforma», no dentro de una empresa
        const empresaP = (await personaDe(a.clave))?.empresa ?? EMPRESA, alcP = extras.alcance ? await extras.alcance(req, a, empresaP) : null;   // la identidad y el alcance salen de la sesión validada, no de la petición
        return await alcance.run({ empresa: empresaP, alc: alcP }, () => peticion.run({ token: Sesiones.idDeCookie(req), actor: a.id, empresa: empresaP, jwt: extras.jwtDe?.(req) ?? null }, async () => {
          if (restringido(alcP)) {   // un documento fuera del alcance de establecimientos de la persona NO EXISTE para ella (lectura, modificación, certificación, descargas, correo…)
            const mDoc = /^\/api\/documentos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(url.pathname);
            if (mDoc && !/\/digifact\//.test(url.pathname)) { const [r] = await bd.filas<{ establecimiento_id: string | null }>("select establecimiento_id from public.documentos where id = $1 and empresa_id = $2", [mDoc[1], empresaP]); if (r && !enAlcance(alcP, r.establecimiento_id)) throw new ErrorHttp(404, "Documento no encontrado", "no_encontrado"); }
          }
          return await manejar(req, url);
        }));
      };
      if (!simPersist?.activa) return await atender();
      if (negocio) return await atender();   // no toca el estado de los simuladores: se evita la sección crítica (bloqueo, lectura y escritura del estado de cada simulador = una decena de viajes a la base)
      if (req.method === "GET" || req.method === "HEAD") { if (!LECTURA_SIN_SIM.test(url.pathname)) await simPersist.sincronizar(); return await atender(); }
      return await simPersist.con(atender);   // toda operación que escribe: estado de los simuladores cargado → atender → guardado, en exclusión mutua
    }
    catch (e) {
      const cab = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
      if (e instanceof ErrorPr) return new Response(JSON.stringify({ codigo: e.codigo, mensaje: e.message }), { status: e.status, headers: cab });
      if (e instanceof ErrorHttp) return new Response(JSON.stringify({ codigo: e.codigo, mensaje: e.message }), { status: e.status, headers: cab });
      if (e instanceof ErrorIdentidad) return new Response(JSON.stringify({ codigo: "FEL_NO_AUTORIZADO", mensaje: e.message.replace(/^FEL_[A-Z_]+:\s*/, "") }), { status: 403, headers: cab });   // identidad rechazada ANTES de llegar a la base: 403, nunca 500
      if (e instanceof ErrorBd) {
        const status = STATUS[e.codigo];
        if (status) return new Response(JSON.stringify({ codigo: e.codigo, mensaje: e.message.replace(/^FEL_[A-Z_]+:\s*/, "") }), { status, headers: cab });
        if (e.codigo.startsWith("SQL_22")) return new Response(JSON.stringify({ codigo: "entrada_invalida", mensaje: "Algún dato no tiene un formato válido (por ejemplo, caracteres no permitidos)." }), { status: 400, headers: cab });   // errores de datos de la base: nunca un 500
        if (e.codigo === "SQL_23514" || e.codigo === "SQL_23505") return new Response(JSON.stringify({ codigo: "regla", mensaje: e.codigo === "SQL_23505" ? "Ya existe un registro con esos datos" : "Los datos no cumplen una regla de la base de datos" }), { status: 422, headers: cab });
      }
      console.error("error interno:", e);
      // «detalle»: solo el CÓDIGO de la causa (p. ej. SQL_42501 o el nombre de la clase de error), nunca el mensaje, la consulta ni datos: permite diagnosticar un 500 sin abrir los registros de la función
      const detalle = e instanceof ErrorBd ? e.codigo : (e instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : "desconocido");
      return new Response(JSON.stringify({ codigo: "interno", mensaje: "Error interno de la demostración", detalle }), { status: 500, headers: cab });
    }
  };
  return (req: Request): Promise<Response> => Sesiones.enPeticion(() => atenderPeticion(req));   // sesión y persona se consultan una sola vez por petición
}
