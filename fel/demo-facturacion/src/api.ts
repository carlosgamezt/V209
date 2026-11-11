// API HTTP de la demostración. Cada endpoint llama a las MISMAS funciones SQL y al MISMO orquestador que las pruebas; no hay lógica fiscal aquí.
// Todo es simulado: el único proveedor es el simulado y nada sale de este equipo.
import { MockProvider, type Escenario } from "../../proveedores/src/mock.ts";
import { OrquestadorDb, ProcesoCaido } from "../../proveedores/src/orquestador_db.ts";
import { ErrorBd } from "../../proveedores/src/rpc.ts";
import { calcular, type LineaEntrada } from "../../supabase/functions/fel-api/lib/calculo.ts";
import type { BdDemo } from "./bd.ts";
import { EMPRESA, USUARIOS, type ClaveUsuario, type Sembrado } from "./mundo_demo.ts";

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
  FEL_ESPERA_TARDIA: 409, FEL_AUDITORIA_PENDIENTE: 409, FEL_YA_ENVIADA: 409, FEL_REGLA: 422 };
const uuidOk = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const texto = (x: unknown, min: number, max: number, campo: string): string => { if (typeof x !== "string" || x.trim().length < min || x.length > max) throw new ErrorHttp(400, `${campo}: texto de ${min} a ${max} caracteres`, "entrada_invalida"); return x.trim(); };
// (Ahora los datos de contacto viven en la tabla de empresas y se editan con fel_op_empresa_datos_guardar.)
const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
type Obj = Record<string, unknown>;

export function crearApi(bd: BdDemo, mundo: Sembrado) {
  const mock = new MockProvider({ idempotenciaNativa: false });   // el «servidor» del proveedor simulado NO deduplica: la protección está en nuestro lado
  const orq = (ganchos?: ConstructorParameters<typeof OrquestadorDb>[2]) => new OrquestadorDb(bd.rpc, mock, ganchos);
  const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };
  const actor = (req: Request): { clave: ClaveUsuario; id: string } => {
    const c = (req.headers.get("x-demo-usuario") ?? "ana") as ClaveUsuario; if (!(c in USUARIOS)) throw new ErrorHttp(400, "Usuario de la demostración no válido", "entrada_invalida");
    return { clave: c, id: USUARIOS[c].id };
  };

  async function empresaDatos() {
    const [e] = await bd.filas<Obj>("select id, razon_social as nombre, nombre_comercial, nit, direccion_fiscal as direccion, telefono, correo_facturacion as correo from public.empresas where id = $1", [EMPRESA]);
    return e;
  }
  const permisosDe = async (a: { id: string }) => await bd.rpc("fel_permisos_efectivos", { p_empresa: EMPRESA, p_user: a.id }) as string[];

  async function detalle(docId: string) {
    const [d] = await bd.filas<Obj>("select d.*, c.nombre as cliente_nombre, c.tipo_identificacion as cliente_tipo, c.numero_identificacion as cliente_numero, e.nombre as establecimiento_nombre, e.codigo_sat as establecimiento_codigo from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos e on e.id = d.establecimiento_id and e.empresa_id = d.empresa_id where d.id = $1 and d.empresa_id = $2", [docId, EMPRESA]);
    if (!d) throw new ErrorHttp(404, "Documento no encontrado", "no_encontrado");
    const lineas = await bd.filas("select orden, descripcion, cantidad::text as cantidad, precio_unitario::text as precio_unitario, descuento_tipo, descuento_valor::text as descuento_valor, importes from public.documento_lineas where documento_id = $1 order by orden", [docId]);
    const operaciones = await bd.filas("select id, tipo, estado, proveedor, ambiente, enviada_en, orden_externa, resolucion, motivo_desconocido, reintento_desde, iniciada_en, resuelta_en, clave_idempotencia from public.operaciones_fiscales where documento_id = $1 order by iniciada_en, id", [docId]);
    const ids = operaciones.map((o) => o.id);
    const eventos = ids.length ? await bd.filas("select id, operacion_id, tipo, resultado, motivo, serie, numero, autorizacion, creado_en from public.eventos_proveedor where operacion_id = any($1::uuid[]) order by id", [ids]) : [];
    const conciliaciones = ids.length ? await bd.filas("select id, operacion_id, tipo, estado, evidencia, propuesta_por, propuesta_en, decidida_por, decidida_en, nota from public.conciliaciones where operacion_id = any($1::uuid[]) order by propuesta_en", [ids]) : [];
    const alertas = await bd.filas("select id, operacion_id, tipo, detalle, creada_en, resuelta_en, nota from public.alertas_fiscales where documento_id = $1 order by creada_en", [docId]);
    const artefactos = await bd.filas("select id, operacion_id, tipo, nombre, mime, sha256, tamano from public.artefactos_documento where documento_id = $1 order by tipo", [docId]);
    let instantanea: unknown = null;
    if (d.establecimiento_id) { try { instantanea = await bd.rpc("fel_sys_documento_instantanea", { p_empresa: EMPRESA, p_doc: docId }); } catch { instantanea = null; } }
    const nombresUsuario = Object.fromEntries(Object.values(USUARIOS).map((u) => [u.id, u.nombre]));
    return { documento: d, lineas, operaciones, eventos, conciliaciones, alertas, artefactos, instantanea, escenario: mock.escenarioDeDocumento(docId), nombresUsuario };
  }

  async function guardar(a: { id: string }, b: Obj) {
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
    if (!clienteId && nuevo) {
      const tipo = String(nuevo.tipo_identificacion ?? "NIT"), num = tipo === "CF" ? "CF" : texto(nuevo.numero_identificacion, 1, 30, "Identificación del receptor");
      const r = await bd.rpc("fel_op_cliente_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_id: null, p_tipo_identificacion: tipo, p_numero_identificacion: num, p_nombre: tipo === "CF" ? "Consumidor final" : texto(nuevo.nombre, 1, 200, "Nombre del receptor"), p_direccion: null, p_email: null, p_telefono: null, p_version: null }) as Obj;
      clienteId = r.id as string;
    }
    if (clienteId && !uuidOk(clienteId)) throw new ErrorHttp(400, "Receptor no válido", "entrada_invalida");
    const fecha = typeof b.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : null;
    const doc = await bd.rpc("fel_op_documento_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_id: b.id ?? null, p_cliente: clienteId ?? null, p_fecha: fecha, p_observaciones: typeof b.observaciones === "string" && b.observaciones.trim() ? b.observaciones.trim().slice(0, 500) : null,
      p_lineas: lineas.map((l, i) => ({ orden: i + 1, ...l, importes: c.lineas[i] })), p_subtotal: c.subtotal, p_descuento_total: c.descuento_total, p_base: c.base_imponible, p_calculo: c.meta, p_version: b.id ? Number(b.version) : null }) as Obj;
    if (uuidOk(b.establecimiento_id)) await bd.rpc("fel_op_documento_establecimiento", { p_actor: a.id, p_empresa: EMPRESA, p_doc: doc.id, p_est: b.establecimiento_id });
    return doc.id as string;
  }

  async function manejar(req: Request, url: URL): Promise<Response> {
    const ruta = url.pathname, m = req.method;
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    const cuerpo = async (): Promise<Obj> => { if (req.headers.get("x-demo") !== "1") throw new ErrorHttp(403, "Falta la cabecera de la demostración", "no_autorizado"); const t = await req.text(); if (t.length > 262144) throw new ErrorHttp(413, "Cuerpo demasiado grande"); try { const o = t ? JSON.parse(t) : {}; if (o === null || typeof o !== "object" || Array.isArray(o)) throw 0; return o as Obj; } catch { throw new ErrorHttp(400, "JSON no válido", "entrada_invalida"); } };
    const id = (p: string) => { const x = p; if (!uuidOk(x)) throw new ErrorHttp(400, "Identificador no válido", "entrada_invalida"); return x; };
    const a = actor(req); let r: RegExpExecArray | null;

    if (m === "GET" && ruta === "/api/estado") {
      const permisos = await bd.rpc("fel_permisos_efectivos", { p_empresa: EMPRESA, p_user: a.id }) as string[];
      const establecimientos = await bd.filas("select id, codigo_sat, nombre from public.establecimientos where empresa_id = $1 and estado = 'activo' order by codigo_sat", [EMPRESA]);
      const clientes = await bd.filas("select id, tipo_identificacion, numero_identificacion, nombre, direccion, email, telefono, frecuente from public.clientes where empresa_id = $1 and activo order by frecuente desc, nombre", [EMPRESA]);
      const conceptos = await bd.filas("select id, codigo, descripcion, tipo, unidad_medida, precio_unitario::text as precio_unitario from public.conceptos where empresa_id = $1 and activo order by descripcion", [EMPRESA]);
      const parametros = await bd.filas("select clave, valor::text as valor from public.plataforma_parametros order by clave");
      return json({ empresa: await empresaDatos(), usuario: { clave: a.clave, ...USUARIOS[a.clave] }, usuarios: Object.entries(USUARIOS).map(([k, u]) => ({ clave: k, nombre: u.nombre, rol: u.rol, descripcion: u.descripcion })),
        permisos, establecimientos, clientes, conceptos, canal: mundo.canal, escenarios: ESCENARIOS, parametros, aviso: "SIMULADO - SIN VALOR FISCAL" });
    }
    if (m === "GET" && ruta === "/api/clientes") {
      return json(await bd.filas("select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.activo, c.version, c.frecuente, (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas from public.clientes c where c.empresa_id = $1 order by c.nombre", [EMPRESA]));
    }
    if (m === "POST" && ruta === "/api/clientes") {
      const b = await cuerpo(); const tipo = String(b.tipo_identificacion ?? "NIT"); if (!["NIT", "CUI", "EXT", "CF"].includes(tipo)) throw new ErrorHttp(400, "Tipo de identificación no válido", "entrada_invalida");
      const num = tipo === "CF" ? "CF" : texto(b.numero_identificacion, 1, 30, "Identificación");
      const opc = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
      const r = await bd.rpc("fel_op_cliente_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_id: uuidOk(b.id) ? b.id : null, p_tipo_identificacion: tipo, p_numero_identificacion: num, p_nombre: tipo === "CF" ? "Consumidor final" : texto(b.nombre, 1, 200, "Nombre"), p_direccion: opc(b.direccion, 300), p_email: opc(b.email, 200), p_telefono: opc(b.telefono, 40), p_version: b.id ? Number(b.version) : null });
      return json(r);
    }
    if (m === "GET" && ruta === "/api/conceptos") return json(await bd.filas("select id, codigo, descripcion, tipo, unidad_medida, precio_unitario::text as precio_unitario, activo, version from public.conceptos where empresa_id = $1 order by descripcion", [EMPRESA]));
    if (m === "POST" && ruta === "/api/conceptos") {
      const b = await cuerpo(); if (!["bien", "servicio"].includes(String(b.tipo))) throw new ErrorHttp(400, "Tipo de concepto no válido", "entrada_invalida");
      if (typeof b.precio_unitario !== "string" || !RE_MONTO.test(b.precio_unitario)) throw new ErrorHttp(400, "Precio no válido (número con hasta 6 decimales)", "entrada_invalida");
      const r = await bd.rpc("fel_op_concepto_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_id: uuidOk(b.id) ? b.id : null, p_codigo: texto(b.codigo, 1, 40, "Código"), p_descripcion: texto(b.descripcion, 1, 300, "Descripción"), p_tipo: b.tipo, p_unidad_medida: "UND", p_precio_unitario: b.precio_unitario, p_categoria_fiscal: null, p_version: b.id ? Number(b.version) : null });
      return json(r);
    }
    if (m === "GET" && ruta === "/api/configuracion") {
      const [emp] = await bd.filas("select e.razon_social, e.nombre_comercial, e.nit, e.estado, e.moneda, e.emision_real_habilitada, r.nombre as regimen, r.estado as regimen_estado from public.empresas e left join public.regimenes_fiscales r on r.id = e.regimen_id where e.id = $1", [EMPRESA]);
      const establecimientos = await bd.filas("select id, codigo_sat, nombre, direccion, estado, (select count(*)::int from public.documentos d where d.establecimiento_id = x.id and d.empresa_id = x.empresa_id) as documentos from public.establecimientos x where x.empresa_id = $1 order by codigo_sat", [EMPRESA]);
      const proveedores = await bd.filas("select id, nombre, ambientes, habilitado, nota from public.proveedores_emision order by case id when 'mock' then 0 when 'portal_playwright' then 1 else 2 end");
      const canales = await bd.filas("select proveedor_id, ambiente, habilitado, prioridad from public.empresa_canales where empresa_id = $1", [EMPRESA]);
      const parametros = await bd.filas("select clave, valor::text as valor from public.plataforma_parametros order by clave");
      const [cont] = await bd.filas("select coalesce(max(numero_borrador), 0)::int as ultimo from public.documentos where empresa_id = $1", [EMPRESA]);
      return json({ empresa: { ...emp, ...(await empresaDatos()) }, establecimientos, proveedores, canales, parametros, ultimo_borrador: cont.ultimo });
    }
    if (m === "POST" && ruta === "/api/establecimientos") {
      const b = await cuerpo(); const estado = b.estado === "inactivo" ? "inactivo" : "activo";
      const r = await bd.rpc("fel_op_establecimiento_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_id: uuidOk(b.id) ? b.id : null, p_codigo: texto(b.codigo_sat, 1, 10, "Código SAT"), p_nombre: texto(b.nombre, 1, 120, "Nombre"), p_direccion: typeof b.direccion === "string" && b.direccion.trim() ? b.direccion.trim().slice(0, 300) : null, p_estado: estado });
      return json(r);
    }
    if (m === "POST" && ruta === "/api/empresa") {
      const b = await cuerpo(); const opc = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
      await bd.rpc("fel_op_empresa_datos_guardar", { p_actor: a.id, p_empresa: EMPRESA, p_nombre_comercial: texto(b.nombre_comercial, 1, 120, "Nombre comercial"), p_direccion: opc(b.direccion, 300), p_telefono: opc(b.telefono, 40), p_correo: opc(b.correo, 200) });
      return json(await empresaDatos());
    }
    if (m === "POST" && (r = /^\/api\/clientes\/([^/]+)\/(frecuente|estado)$/.exec(ruta))) {
      const b = await cuerpo(); const cid = id(r[1]);
      if (r[2] === "frecuente") await bd.rpc("fel_op_cliente_frecuente", { p_actor: a.id, p_empresa: EMPRESA, p_id: cid, p_frecuente: b.frecuente === true });
      else await bd.rpc("fel_op_cliente_estado", { p_actor: a.id, p_empresa: EMPRESA, p_id: cid, p_activo: b.activo === true });
      return json({ ok: true });
    }
    if (m === "POST" && (r = /^\/api\/conceptos\/([^/]+)\/estado$/.exec(ruta))) {
      const b = await cuerpo(); await bd.rpc("fel_op_concepto_estado", { p_actor: a.id, p_empresa: EMPRESA, p_id: id(r[1]), p_activo: b.activo === true }); return json({ ok: true });
    }
    if (m === "GET" && ruta === "/api/documentos") {
      return json(await bd.filas("select d.id, d.numero_borrador, d.estado_preparacion, d.estado_fiscal, d.fecha_emision_prevista, d.base_imponible::text as base_imponible, d.serie, d.numero_fiscal, d.autorizacion_sat, d.version, d.actualizado_en, c.nombre as cliente_nombre, e.nombre as establecimiento_nombre, (select count(*)::int from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null) as alertas, uo.proveedor as canal_id, pe.nombre as canal_nombre, uo.ambiente as canal_ambiente, uo.estado as operacion_estado from public.documentos d left join lateral (select o.proveedor, o.ambiente, o.estado from public.operaciones_fiscales o where o.documento_id = d.id and o.tipo = 'certificacion' order by o.iniciada_en desc, o.id desc limit 1) uo on true left join public.proveedores_emision pe on pe.id = uo.proveedor left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id left join public.establecimientos e on e.id = d.establecimiento_id and e.empresa_id = d.empresa_id where d.empresa_id = $1 order by d.numero_borrador desc", [EMPRESA]));
    }
    if (m === "GET" && (r = /^\/api\/documentos\/([^/]+)$/.exec(ruta))) return json(await detalle(id(r[1])));
    if (m === "GET" && (r = /^\/api\/artefactos\/([^/]+)$/.exec(ruta))) {
      const [x] = await bd.filas<{ nombre: string; mime: string; contenido: Uint8Array; tipo: string }>("select nombre, mime, contenido, tipo from public.artefactos_documento where id = $1 and empresa_id = $2", [id(r[1]), EMPRESA]);
      if (!x) throw new ErrorHttp(404, "Archivo no encontrado", "no_encontrado");
      const permisos = await bd.rpc("fel_permisos_efectivos", { p_empresa: EMPRESA, p_user: a.id }) as string[]; if (!permisos.includes("artefactos.descargar")) throw new ErrorHttp(403, "No tienes permiso para descargar", "no_autorizado");
      return new Response(new Uint8Array(x.contenido).buffer as ArrayBuffer, { headers: { "content-type": x.mime, "content-disposition": `attachment; filename="SIMULADO-${x.nombre.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
    }
    if (m === "POST" && ruta === "/api/documentos") { const b = await cuerpo(); const docId = await guardar(a, b); return json(await detalle(docId)); }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/estado$/.exec(ruta))) {
      const b = await cuerpo(); const nuevo = b.estado; if (!["borrador", "revisado", "archivado"].includes(nuevo as string)) throw new ErrorHttp(400, "Estado no válido", "entrada_invalida");
      await bd.rpc("fel_op_documento_preparacion", { p_actor: a.id, p_empresa: EMPRESA, p_id: id(r[1]), p_nuevo: nuevo, p_motivo: typeof b.motivo === "string" ? b.motivo : null, p_version: Number(b.version) });
      return json(await detalle(r[1]));
    }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/reabrir$/.exec(ruta))) { const b = await cuerpo(); await bd.rpc("fel_op_documento_reabrir", { p_actor: a.id, p_empresa: EMPRESA, p_doc: id(r[1]), p_version: Number(b.version) }); return json(await detalle(r[1])); }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/validar$/.exec(ruta))) {
      const v = await orq().validar(EMPRESA, id(r[1])); return json({ ok: v.ok, errores: v.errores, nota: "Validación estructural del proveedor simulado; no incluye reglas fiscales (impuestos, NIT oficial), que siguen pendientes de verificación." });
    }
    if (m === "POST" && (r = /^\/api\/documentos\/([^/]+)\/certificar$/.exec(ruta))) {
      const b = await cuerpo(); const docId = id(r[1]);
      const esc = typeof b.escenario === "string" ? b.escenario : "exito"; if (!ESC_IDS.has(esc as Escenario)) throw new ErrorHttp(400, "Escenario no válido", "entrada_invalida");
      const clave = texto(b.clave, 16, 80, "Clave de idempotencia");
      mock.fijarEscenario(docId, esc as Escenario);
      const s = await orq().solicitar({ actor: a.id, empresa: EMPRESA, documento: docId, clave, canal: mundo.canal });
      return json({ resultado: { operacion: s.operacion.id, estado: s.operacion.estado, reutilizada: s.reutilizada, en_curso: s.enCurso }, ...(await detalle(docId)) });
    }
    if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliar$/.exec(ruta))) {
      const permisos = await bd.rpc("fel_permisos_efectivos", { p_empresa: EMPRESA, p_user: a.id }) as string[]; if (!permisos.includes("fiscal.conciliar")) throw new ErrorHttp(403, "No tienes permiso para conciliar", "no_autorizado");
      const op = await bd.rpc("fel_sys_operacion", { p_empresa: EMPRESA, p_op: id(r[1]) }) as Obj; const c = await orq().conciliar(EMPRESA, r[1]);
      return json({ conciliacion: c, ...(await detalle(op.documento_id as string)) });
    }
    if (m === "POST" && (r = /^\/api\/operaciones\/([^/]+)\/conciliacion$/.exec(ruta))) {
      const b = await cuerpo(); const op = await bd.rpc("fel_sys_operacion", { p_empresa: EMPRESA, p_op: id(r[1]) }) as Obj;
      const e = (b.evidencia ?? {}) as Obj;
      await bd.rpc("fel_op_conciliacion_proponer", { p_actor: a.id, p_empresa: EMPRESA, p_op: r[1], p_tipo: b.tipo, p_evidencia: { fuente: e.fuente, referencia: e.referencia, fecha_consulta: new Date().toISOString(), conclusion: b.tipo === "manual_fallida" ? "no_figura" : "figura" }, p_datos: b.datos ?? null });
      return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && (r = /^\/api\/conciliaciones\/([^/]+)\/decidir$/.exec(ruta))) {
      const b = await cuerpo(); const [c] = await bd.filas<{ operacion_id: string }>("select operacion_id from public.conciliaciones where id = $1 and empresa_id = $2", [id(r[1]), EMPRESA]); if (!c) throw new ErrorHttp(404, "Conciliación no encontrada", "no_encontrado");
      await bd.rpc("fel_op_conciliacion_decidir", { p_actor: a.id, p_empresa: EMPRESA, p_conciliacion: r[1], p_aprobar: b.aprobar === true, p_nota: typeof b.nota === "string" ? b.nota : "" });
      const op = await bd.rpc("fel_sys_operacion", { p_empresa: EMPRESA, p_op: c.operacion_id }) as Obj; return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && (r = /^\/api\/alertas\/([^/]+)\/resolver$/.exec(ruta))) {
      const b = await cuerpo(); const [x] = await bd.filas<{ documento_id: string }>("select documento_id from public.alertas_fiscales where id = $1 and empresa_id = $2", [id(r[1]), EMPRESA]); if (!x) throw new ErrorHttp(404, "Alerta no encontrada", "no_encontrado");
      await bd.rpc("fel_op_alerta_resolver", { p_actor: a.id, p_empresa: EMPRESA, p_alerta: r[1], p_nota: typeof b.nota === "string" ? b.nota : "" }); return json(await detalle(x.documento_id));
    }
    // ---- controles de la DEMOSTRACIÓN: reproducen lo que en la realidad hacen el proveedor, el tiempo o una caída del proceso ----
    if (m === "POST" && ruta === "/api/demo/liberar-tardios") { await cuerpo(); await mock.liberarTardios(CTX); return json({ ok: true, aviso: "El proveedor simulado procesó las solicitudes tardías." }); }
    if (m === "POST" && ruta === "/api/demo/auditar") { await cuerpo(); return json(await orq().auditarFallidas()); }
    if (m === "POST" && ruta === "/api/demo/recuperar") { await cuerpo(); return json(await orq().recuperar({ umbralMin: 0 })); }
    if (m === "POST" && ruta === "/api/demo/completar-humana") {
      const b = await cuerpo(); const op = await bd.rpc("fel_sys_operacion", { p_empresa: EMPRESA, p_op: id(b.operacion as string) }) as Obj;
      if (!op.orden_externa) throw new ErrorHttp(422, "La operación no espera una acción humana", "regla");
      const fin = await mock.completarAccionHumana(String(op.orden_externa), CTX); await orq().resolverAccionHumana(EMPRESA, op.id as string, fin); return json(await detalle(op.documento_id as string));
    }
    if (m === "POST" && ruta === "/api/demo/caida") {
      const b = await cuerpo(); const docId = id(b.documento as string), punto = String(b.punto);
      if (!["a", "b", "c", "d"].includes(punto)) throw new ErrorHttp(400, "Punto de caída no válido", "entrada_invalida");
      const esc = typeof b.escenario === "string" && ESC_IDS.has(b.escenario as Escenario) ? b.escenario as Escenario : "exito"; mock.fijarEscenario(docId, esc);
      const caer = () => { throw new ProcesoCaido(punto); };
      const o = orq({ ganchos: { despuesDeSolicitar: punto === "a" ? caer : undefined, despuesDeMarcarEnvio: punto === "b" ? caer : undefined, despuesDeEnviar: punto === "c" ? caer : undefined, despuesDeEvento: punto === "d" ? caer : undefined } });
      let caido = false;
      try { await o.solicitar({ actor: a.id, empresa: EMPRESA, documento: docId, clave: texto(b.clave, 16, 80, "Clave"), canal: mundo.canal }); } catch (e) { if (e instanceof ProcesoCaido) caido = true; else throw e; }
      return json({ caido, punto, ...(await detalle(docId)) });
    }
    throw new ErrorHttp(404, "Ruta no encontrada", "no_encontrado");
  }

  return async (req: Request): Promise<Response> => {
    try { return await manejar(req, new URL(req.url)); }
    catch (e) {
      const cab = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
      if (e instanceof ErrorHttp) return new Response(JSON.stringify({ codigo: e.codigo, mensaje: e.message }), { status: e.status, headers: cab });
      if (e instanceof ErrorBd) {
        const status = STATUS[e.codigo];
        if (status) return new Response(JSON.stringify({ codigo: e.codigo, mensaje: e.message.replace(/^FEL_[A-Z_]+:\s*/, "") }), { status, headers: cab });
        if (e.codigo === "SQL_23514" || e.codigo === "SQL_23505") return new Response(JSON.stringify({ codigo: "regla", mensaje: e.codigo === "SQL_23505" ? "Ya existe un registro con esos datos" : "Los datos no cumplen una regla de la base de datos" }), { status: 422, headers: cab });
      }
      console.error("error interno:", e);
      return new Response(JSON.stringify({ codigo: "interno", mensaje: "Error interno de la demostración" }), { status: 500, headers: cab });
    }
  };
}
