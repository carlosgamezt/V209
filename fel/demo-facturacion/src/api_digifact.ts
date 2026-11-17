// Rutas de la API de la demostración que conectan el formulario de NEXA FEL con Digifact TEST. TODA llamada a Digifact ocurre aquí, en el servidor:
// el navegador solo habla con estas rutas (misma sesión, misma cabecera de la demostración) y NUNCA recibe credenciales, tokens ni documentos en bruto.
// La empresa, la persona y los permisos salen de la SESIÓN y de la base de datos; nunca de lo que mande el navegador.
import type { BdDemo } from "./bd.ts";
import { ErrorFelGt, type ContextoFel, type DocumentoFel, type ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";

type Obj = Record<string, unknown>;
export interface CtxDigifact {
  m: string; ruta: string; a: { clave: string; id: string }; empresa: string;
  cuerpo: () => Promise<Obj>; id: (x: string) => string; json: (x: unknown, s?: number) => Response; permisos: () => Promise<string[]>;
}
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
export async function rutasDigifact(c: CtxDigifact, bd: BdDemo, svc: ServicioFelGt | undefined): Promise<Response | null> {
  const { m, ruta } = c; let r: RegExpExecArray | null;
  const esNit = m === "POST" && ruta === "/api/digifact/nit", esEstado = m === "GET" && ruta === "/api/digifact/estado";
  const rd = (m === "POST" || m === "GET") && (r = /^\/api\/documentos\/([^/]+)\/digifact(?:\/(validar|preparar|certificar|conciliar|xml|pdf))?$/.exec(ruta));
  if (!esNit && !esEstado && !rd) return null;
  if (esEstado) return c.json({ habilitado: !!svc, ambiente: "TEST", produccion: "bloqueada", anulacion: "cerrada", notaCredito: "cerrada", confirmacion: "CERTIFICAR-TEST" });
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
      if (accion) return null; return c.json({ operaciones: await svc.estadoDocumento(ctx, docId) });
    }
    const b = await c.cuerpo();
    const doc = async () => { const x = await leerDocumentoFel(bd, c.empresa, docId); if (!x) throw new ErrorFelGt("NO_ENCONTRADO", "Documento no encontrado"); return x; };
    if (accion === "validar") return c.json(await svc.validar(ctx, await doc()));
    if (accion === "preparar") return c.json(await svc.preparar(ctx, await doc()));
    if (accion === "certificar") return c.json(await svc.certificar(ctx, await doc(), { operacionId: b.operacionId, confirmacion: b.confirmacion, referencia: b.referencia, huellaEmisor: b.huellaEmisor }));
    if (accion === "conciliar") return c.json(await svc.conciliar(ctx, b.operacionId));
    return null;
  } catch (e) {
    if (e instanceof ErrorFelGt) return c.json({ codigo: e.codigo.toLowerCase(), mensaje: e.message, ...(e.errores ? { errores: e.errores } : {}) }, e.status);
    throw e;
  }
}
