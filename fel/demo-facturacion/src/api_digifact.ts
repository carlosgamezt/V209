// Rutas de la API de la demostración que conectan el formulario de NEXA FEL con Digifact TEST. TODA llamada a Digifact ocurre aquí, en el servidor:
// el navegador solo habla con estas rutas (misma sesión, misma cabecera de la demostración) y NUNCA recibe credenciales, tokens ni documentos en bruto.
// La empresa, la persona y los permisos salen de la SESIÓN y de la base de datos; nunca de lo que mande el navegador.
import type { BdDemo } from "./bd.ts";
import { ErrorFelGt, type ContextoFel, type DocumentoFel, type ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { consultarReceptorNit, crearLimitador, ErrorReceptorNit, TOPE_REAL_GLOBAL, TOPE_REAL_POR_EMPRESA } from "./receptor_nit.ts";
import type { ConsultorNit } from "./digifact_nit_entorno.ts";
import type { ConsultorCui } from "./digifact_cui_entorno.ts";
import { correoConFormatoNuc, type PoliticaCorreoDigifact } from "./digifact_correo_entorno.ts";
import { consultarReceptorCui, TOPE_CUI_GLOBAL, TOPE_CUI_POR_EMPRESA } from "./receptor_cui.ts";

type Obj = Record<string, unknown>;
export interface CtxDigifact {
  m: string; ruta: string; a: { clave: string; id: string }; empresa: string;
  cuerpo: () => Promise<Obj>; id: (x: string) => string; json: (x: unknown, s?: number) => Response; permisos: () => Promise<string[]>;
}
const limitadores = new WeakMap<BdDemo, (empresa: string) => boolean>();   // un tope de consultas de NIT por minuto y por empresa (simulador), por base de datos
const limitadoresCui = new WeakMap<BdDemo, { sim: (e: string) => boolean; empresa: (e: string) => boolean; global: () => boolean }>();   // consulta de CUI (dato personal): simulador 20/min por empresa; REAL 5/min por empresa + tope global
const limitesReales = new WeakMap<BdDemo, { empresa: (e: string) => boolean; global: () => boolean }>();   // consulta REAL: 10 por minuto y por empresa + tope global del proceso
const NO_HABILITADO = { codigo: "digifact_no_habilitado", mensaje: "Digifact TEST no está habilitado en este servidor." };

/** Lee un documento de LA empresa indicada (nunca de otra) en la forma que necesita el servicio. */
export async function leerDocumentoFel(bd: BdDemo, empresa: string, docId: string): Promise<DocumentoFel | null> {
  const [d] = await bd.filas<Obj>(`select d.id, d.empresa_id, d.estado_preparacion, d.estado_fiscal, c.tipo_identificacion as c_tipo, c.numero_identificacion as c_num, c.nombre as c_nombre
      from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.id = $1 and d.empresa_id = $2`, [docId, empresa]);
  if (!d) return null;
  const ls = await bd.filas<Obj>(`select l.descripcion, l.cantidad::text as cantidad, l.precio_unitario::text as precio_unitario, l.importes->>'descuento' as descuento, k.tipo as concepto_tipo, k.unidad_medida
      from public.documento_lineas l left join public.conceptos k on k.id = l.concepto_id and k.empresa_id = l.empresa_id where l.documento_id = $1 and l.empresa_id = $2 order by l.orden`, [docId, empresa]);
  const tipo = String(d.c_tipo ?? "CF");
  return {
    id: String(d.id), empresaId: String(d.empresa_id), estadoPreparacion: String(d.estado_preparacion), estadoFiscal: String(d.estado_fiscal),
    receptor: { tipoId: (["NIT", "CUI", "CF"].includes(tipo) ? tipo : "EXT") as "NIT", id: tipo === "CF" ? "CF" : String(d.c_num ?? "").replace(/-/g, ""), nombre: tipo === "CF" ? "CONSUMIDOR FINAL" : String(d.c_nombre ?? "") },
    lineas: ls.map((l) => ({ tipo: String(l.concepto_tipo ?? "servicio").toLowerCase() === "bien" ? "Bien" as const : "Servicio" as const, descripcion: String(l.descripcion), cantidad: String(l.cantidad), precioUnitario: String(l.precio_unitario),
      descuento: String(l.descuento ?? "0"), ...(l.unidad_medida ? { unidad: String(l.unidad_medida).slice(0, 20) } : {}) })),
  };
}

/** Atiende las rutas de Digifact. Devuelve null si la ruta no es de este módulo. */
export async function rutasDigifact(c: CtxDigifact, bd: BdDemo, svc: ServicioFelGt | undefined, consultor?: ConsultorNit, consultorCui?: ConsultorCui, politicaCorreo?: PoliticaCorreoDigifact): Promise<Response | null> {
  const { m, ruta } = c; let r: RegExpExecArray | null;
  const esNit = m === "POST" && ruta === "/api/digifact/nit", esEstado = m === "GET" && ruta === "/api/digifact/estado", esReceptor = m === "POST" && ruta === "/api/receptores/nit", esReceptorCui = m === "POST" && ruta === "/api/receptores/cui";
  const rd = (m === "POST" || m === "GET") && (r = /^\/api\/documentos\/([^/]+)\/digifact(?:\/(validar|preparar|certificar|conciliar|xml|pdf|correo|destinatario))?$/.exec(ruta));
  if (!esNit && !esEstado && !esReceptor && !esReceptorCui && !rd) return null;
  if (esReceptor) {   // autollenado del nombre del receptor: CF local, Digifact TEST si está habilitado, o simulador con datos ficticios (siempre desde el servidor, con la empresa y los permisos de la SESIÓN)
    if (!limitadores.has(bd)) limitadores.set(bd, crearLimitador());
    if (!limitesReales.has(bd)) { const e = crearLimitador(TOPE_REAL_POR_EMPRESA), g = crearLimitador(TOPE_REAL_GLOBAL); limitesReales.set(bd, { empresa: e, global: () => g("*") }); }
    const ctxR: ContextoFel = { empresaId: c.empresa, actorId: c.a.id, permisos: await c.permisos() };
    try {
      const b = await c.cuerpo();
      return c.json(await consultarReceptorNit(ctxR, b.nit, { consultor, limitador: limitadores.get(bd)!, limitadorReal: limitesReales.get(bd)!.empresa, limitadorGlobal: limitesReales.get(bd)!.global, auditar: async (evento, empresa, actor, datos) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'receptor', '', $4::text::jsonb)", [empresa, actor, evento, JSON.stringify(datos)]); } }));
    } catch (e) { if (e instanceof ErrorReceptorNit) return c.json({ codigo: e.codigo, mensaje: e.message }, e.status); throw e; }
  }
  if (esReceptorCui) {   // autollenado del nombre por CUI/DPI: Digifact TEST solo para la empresa autorizada, o simulador rotulado; el CUI nunca se registra ni se devuelve
    if (!limitadoresCui.has(bd)) { const sim = crearLimitador(), e = crearLimitador(TOPE_CUI_POR_EMPRESA), g = crearLimitador(TOPE_CUI_GLOBAL); limitadoresCui.set(bd, { sim, empresa: e, global: () => g("*") }); }
    const lc = limitadoresCui.get(bd)!, ctxC: ContextoFel = { empresaId: c.empresa, actorId: c.a.id, permisos: await c.permisos() };
    try {
      const b = await c.cuerpo();
      return c.json(await consultarReceptorCui(ctxC, b.cui, { consultor: consultorCui, limitador: lc.sim, limitadorReal: lc.empresa, limitadorGlobal: lc.global, auditar: async (evento, empresa, actor, datos) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'receptor', '', $4::text::jsonb)", [empresa, actor, evento, JSON.stringify(datos)]); } }));
    } catch (e) { if (e instanceof ErrorReceptorNit) return c.json({ codigo: e.codigo, mensaje: e.message }, e.status); throw e; }
  }
  if (esEstado) return c.json({ habilitado: !!svc, certificacion: !!svc, consultaNit: !!consultor && c.empresa.toLowerCase() === consultor.empresaId, consultaCui: !!consultorCui && c.empresa.toLowerCase() === consultorCui.empresaId, correoDigifact: { habilitado: !!politicaCorreo && c.empresa.toLowerCase() === politicaCorreo.empresaId }, ambiente: "TEST", produccion: "bloqueada", anulacion: "cerrada", notaCredito: "cerrada", confirmacion: "CERTIFICAR-TEST", almacenamiento: svc ? (svc.almacenPersistente ? "persistente" : "temporal") : null });   // «certificacion» y «consultaNit» son interruptores distintos
  if (!svc) return c.json(NO_HABILITADO, 503);
  const ctx: ContextoFel = { empresaId: c.empresa, actorId: c.a.id, permisos: await c.permisos() };
  try {
    if (esNit) { const b = await c.cuerpo(); return c.json(await svc.consultarNit(ctx, b.nit)); }
    const [, docRaw, accion] = r!; const docId = c.id(docRaw);
    if (m === "GET") {
      if (accion === "xml" || accion === "pdf") {   // archivo REAL certificado: solo con sesión y permiso, solo de la empresa de la sesión; se descarga, nunca se interpreta en el navegador
        const a = await svc.descargar(ctx, docId, accion);
        return new Response(a.contenido as unknown as BodyInit, { status: 200, headers: { "content-type": a.mime, "content-disposition": `attachment; filename="${a.nombre}"`, "content-length": String(a.contenido.length),
          "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "x-nexa-sha256": a.sha256 } });
      }
      if (accion === "correo") {   // ¿se pidió a Digifact enviar el correo al certificar? Solo lo que NEXA sabe: «solicitado». NEXA no recibe confirmación de entrega.
        if (!ctx.permisos.includes("fiscal.ver")) throw new ErrorFelGt("NO_AUTORIZADO", "No tienes permiso para ver Digifact TEST");
        const [x] = await bd.filas<{ ocurrido_en: unknown; datos: Obj }>("select ocurrido_en, datos from public.auditoria where empresa_id = $1 and accion = 'digifact_test.correo_solicitado' and entidad = 'documento' and entidad_id = $2 order by id desc limit 1", [c.empresa, docId]);
        const datosCorreo: Obj = typeof x?.datos === "string" ? (() => { try { return JSON.parse(x.datos as unknown as string) as Obj; } catch { return {}; } })() : (x?.datos ?? {});   // tolera registros guardados como cadena JSON
        return c.json({ solicitado: !!x, destinatario: x ? String(datosCorreo.destinatario ?? "") : null, cuando: x ? (x.ocurrido_en instanceof Date ? x.ocurrido_en.toISOString() : String(x.ocurrido_en)) : null, entrega: "sin_confirmacion" });
      }
      if (accion === "destinatario") {   // el correo REGISTRADO del cliente de ESTE documento, para prellenar la casilla. Solo de la empresa de la sesión (el cliente se busca con la empresa del documento, nunca con lo que mande el navegador) y solo para quien puede certificar.
        if (!politicaCorreo || c.empresa.toLowerCase() !== politicaCorreo.empresaId) return c.json({ codigo: "correo_no_habilitado", mensaje: "El envío de la factura por correo de Digifact no está habilitado para esta empresa." }, 403);
        if (!ctx.permisos.includes("fiscal.certificar")) throw new ErrorFelGt("NO_AUTORIZADO", "No tienes permiso para elegir el envío por correo");
        const [x] = await bd.filas<Obj>("select c.id as cliente_id, c.tipo_identificacion, c.email from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id where d.id = $1 and d.empresa_id = $2", [docId, c.empresa]);
        if (!x) throw new ErrorFelGt("NO_ENCONTRADO", "Documento no encontrado");
        const reg = typeof x.email === "string" ? x.email.trim() : "", valido = reg !== "" && correoConFormatoNuc(reg);
        return c.json({ clienteId: x.cliente_id ? String(x.cliente_id) : null, consumidorFinal: !x.cliente_id || x.tipo_identificacion === "CF", correo: valido ? reg : null, registradoNoValido: reg !== "" && !valido });
      }
      if (accion) return null; return c.json({ operaciones: await svc.estadoDocumento(ctx, docId) });
    }
    const b = await c.cuerpo();
    const doc = async () => { const x = await leerDocumentoFel(bd, c.empresa, docId); if (!x) throw new ErrorFelGt("NO_ENCONTRADO", "Documento no encontrado"); return x; };
    // «Enviar factura por correo»: solo si la petición lo pide Y el servidor lo habilita para esta empresa Y el destinatario está autorizado. Digifact lo envía al certificar; aquí solo se valida y se pasa el destinatario.
    const pedirCorreo = (): { correo?: string; rechazo?: Response } => {
      if (b.enviar_correo !== true) return {};
      if (!politicaCorreo || c.empresa.toLowerCase() !== politicaCorreo.empresaId) return { rechazo: c.json({ codigo: "correo_no_habilitado", mensaje: "El envío de la factura por correo de Digifact no está habilitado para esta empresa." }, 403) };
      const x = typeof b.correo === "string" ? b.correo.trim() : ""; const v = politicaCorreo.evaluar(x);
      if (!v.ok) return { rechazo: c.json({ codigo: v.codigo.toLowerCase(), mensaje: v.mensaje }, v.codigo === "CORREO_INVALIDO" ? 400 : 403) };
      return { correo: x };
    };
    if (accion === "validar" || accion === "preparar" || accion === "certificar") {
      const pc = pedirCorreo(); if (pc.rechazo) return pc.rechazo;
      if (accion === "validar") return c.json(await svc.validar(ctx, await doc(), { correo: pc.correo }));
      // El destinatario queda ATADO a la preparación: «correo_ref» es una huella de (empresa, documento, operación, correo). Al certificar se exige la misma, así que lo que se revisó y lo que se envía no pueden diferir,
      // y cambiar después el correo del cliente (o escribir otro en el navegador) no altera el destinatario de la operación. Es solo una huella: el correo completo no se guarda ni se devuelve.
      const refCorreo = async (operacionId: string, correo: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${c.empresa}|${docId}|${operacionId}|${correo.toLowerCase()}`)))].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
      if (accion === "preparar") { const r = await svc.preparar(ctx, await doc(), { correo: pc.correo }); return c.json(pc.correo ? { ...r, correoRef: await refCorreo(r.operacionId, pc.correo) } : r); }
      if (pc.correo) {
        const ref = typeof b.correo_ref === "string" ? b.correo_ref : "";
        if (!ref) return c.json({ codigo: "correo_sin_preparacion", mensaje: "Prepara de nuevo la certificación con este correo antes de certificar." }, 400);
        if (ref !== await refCorreo(String(b.operacionId ?? ""), pc.correo)) return c.json({ codigo: "correo_distinto", mensaje: "El correo no coincide con el de la preparación. Prepara de nuevo la certificación con el correo que quieres usar." }, 409);
      }
      return c.json(await svc.certificar(ctx, await doc(), { operacionId: b.operacionId, confirmacion: b.confirmacion, referencia: b.referencia, huellaEmisor: b.huellaEmisor, correo: pc.correo }));
    }
    if (accion === "conciliar") return c.json(await svc.conciliar(ctx, b.operacionId));
    return null;
  } catch (e) {
    if (e instanceof ErrorFelGt) return c.json({ codigo: e.codigo.toLowerCase(), mensaje: e.message, ...(e.errores ? { errores: e.errores } : {}) }, e.status);
    throw e;
  }
}
