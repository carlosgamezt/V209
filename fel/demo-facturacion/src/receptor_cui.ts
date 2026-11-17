// Autollenado del NOMBRE de un receptor a partir de su CUI/DPI, con el mismo principio que el de NIT (src/receptor_nit.ts): todo ocurre en el SERVIDOR (POST /api/receptores/cui, misma sesión y cabecera de la demostración).
//  · Con la consulta de CUI por Digifact TEST habilitada (FEL_DIGIFACT_CUI, independiente de NIT y de la certificación) y SOLO para la empresa configurada, se consulta SHARED_GETINFOCUI mediante un «consultor» que únicamente sabe consultar.
//    Si falla, se informa el error: NUNCA se responde con el simulador en su lugar (no se mezclan nombres ficticios con reales).
//  · Para todas las demás empresas, o con la consulta apagada, un SIMULADOR con datos FICTICIOS y rotulados `simulado: true`.
//  · El CUI y el nombre son datos personales: no se escriben en la auditoría, en registros ni en mensajes de error, y la respuesta NO devuelve el CUI.
import type { ContextoFel } from "../../proveedores/src/felgt_servicio.ts";
import { ErrorDigifact } from "../../proveedores/src/digifact_gt.ts";
import type { ConsultorCui } from "./digifact_cui_entorno.ts";
import { crearLimitador, ErrorReceptorNit } from "./receptor_nit.ts";

export const RE_CUI = /^\d{13}$/;
/** CUI sin espacios ni guiones («2500 12345 0101» → «2500123450101»). */
export const normalizarCui = (t: unknown): string => String(t ?? "").replace(/[\s-]+/g, "");
/** Topes iniciales de la consulta REAL de CUI (dato personal): por empresa y global del proceso; más bajos que los de NIT. */
export const TOPE_CUI_POR_EMPRESA = 5, TOPE_CUI_GLOBAL = 15;
const LIM_REAL = crearLimitador(TOPE_CUI_POR_EMPRESA), LIM_GLOBAL = crearLimitador(TOPE_CUI_GLOBAL);

export interface RespuestaReceptorCui { origen: "demo" | "digifact_test"; simulado: boolean; encontrado: boolean; nombre?: string }
/** CUI FICTICIOS del simulador (13 dígitos sin relación con ninguna persona). */
export const DEMO_CUI: Readonly<Record<string, string>> = {
  "1000000000101": "PERSONA FICTICIA DE PRUEBA CUI UNO",
  "1000000010101": "PERSONA FICTICIA DE PRUEBA CUI DOS",
};
/** CUI del simulador que reproduce un fallo del proveedor (para probar el manejo de errores). */
export const DEMO_CUI_ERROR = "9990000000101";

export interface DepsReceptorCui {
  consultor?: ConsultorCui;
  limitador: (empresa: string) => boolean;                  // simulador: por empresa
  limitadorReal?: (empresa: string) => boolean;             // consulta real: por empresa
  limitadorGlobal?: () => boolean;                          // consulta real: tope global del proceso
  auditar: (evento: string, empresa: string, actor: string, datos: Record<string, unknown>) => Promise<void> | void;
}

export async function consultarReceptorCui(ctx: ContextoFel, entrada: unknown, d: DepsReceptorCui): Promise<RespuestaReceptorCui> {
  if (!ctx.permisos.includes("clientes.ver")) throw new ErrorReceptorNit("no_autorizado", "No tienes permiso para consultar receptores", 403);
  const cui = normalizarCui(entrada);
  if (!RE_CUI.test(cui)) throw new ErrorReceptorNit("entrada_invalida", "CUI no válido: debe tener exactamente 13 dígitos", 400);   // sin repetir lo escrito
  if (d.consultor && ctx.empresaId.toLowerCase() === d.consultor.empresaId) return await real(ctx, cui, d, d.consultor);   // SOLO la empresa configurada
  if (!d.limitador(ctx.empresaId)) throw new ErrorReceptorNit("limite", "Demasiadas consultas de CUI; espera un minuto", 429);
  return await simulado(ctx, cui, d);
}

async function real(ctx: ContextoFel, cui: string, d: DepsReceptorCui, consultor: ConsultorCui): Promise<RespuestaReceptorCui> {
  if (!(d.limitadorReal ?? LIM_REAL)(ctx.empresaId) || !(d.limitadorGlobal ?? (() => LIM_GLOBAL("*")))()) throw new ErrorReceptorNit("limite", "Demasiadas consultas de CUI; espera un minuto", 429);
  try {
    const r = await consultor.consultar(cui);
    await d.auditar("receptor.cui_consultado", ctx.empresaId, ctx.actorId, { origen: "digifact_test", encontrado: r.encontrado });   // sin CUI ni nombre
    return r.encontrado && r.nombre ? { origen: "digifact_test", simulado: false, encontrado: true, nombre: r.nombre } : { origen: "digifact_test", simulado: false, encontrado: false };
  } catch (e) {
    const tipo = e instanceof ErrorDigifact ? e.tipo : "desconocido";
    try { await d.auditar("receptor.cui_consultado", ctx.empresaId, ctx.actorId, { origen: "digifact_test", error: tipo }); } catch { /* la auditoría no tumba la respuesta */ }
    if (tipo === "limite") throw new ErrorReceptorNit("limite", "Digifact TEST limitó las consultas; espera un momento", 429);
    throw new ErrorReceptorNit("proveedor", "Digifact TEST no respondió", 502);   // mensaje fijo: lo que diga el proveedor no llega al navegador
  }
}

async function simulado(ctx: ContextoFel, cui: string, d: DepsReceptorCui): Promise<RespuestaReceptorCui> {
  await d.auditar("receptor.cui_consultado", ctx.empresaId, ctx.actorId, { origen: "demo", encontrado: cui in DEMO_CUI });
  if (cui === DEMO_CUI_ERROR) throw new ErrorReceptorNit("proveedor", "El servicio de consulta (simulado) no respondió", 502);
  return cui in DEMO_CUI ? { origen: "demo", simulado: true, encontrado: true, nombre: DEMO_CUI[cui] } : { origen: "demo", simulado: true, encontrado: false };
}
