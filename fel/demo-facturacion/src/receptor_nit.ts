// Autollenado del NOMBRE de un receptor a partir de su NIT. Todo ocurre en el SERVIDOR: el navegador solo habla con POST /api/receptores/nit (misma sesión, misma cabecera de la demostración)
// y NUNCA recibe credenciales ni habla con Digifact.
//  · «CF» (consumidor final) se resuelve aquí, sin ningún proveedor: nombre «CONSUMIDOR FINAL».
//  · Con Digifact TEST habilitado se usa el servicio existente (consulta SHARED_GETINFONITcom: razón social registrada en SAT); permisos, límite y auditoría son los de ese servicio.
//  · Con Digifact APAGADO se usa un SIMULADOR con datos FICTICIOS (unos pocos NIT de prueba). Toda respuesta simulada lleva `simulado: true`: la interfaz muestra la advertencia por separado; el nombre NO se altera.
import { ErrorFelGt, type ContextoFel, type ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";

export const NOMBRE_CF = "CONSUMIDOR FINAL";
export const RE_NIT = /^\d{1,11}[0-9K]$/;

/** Identificación sin espacios ni guiones y en mayúsculas («c f», «Cf», «1234567-8» → «CF», «CF», «12345678»). */
export const normalizarId = (texto: unknown): string => String(texto ?? "").replace(/[\s-]+/g, "").toUpperCase();
export const esCF = (texto: unknown): boolean => normalizarId(texto) === "CF";

/**
 * Dígito verificador del NIT (módulo 11, «K» = 10). Solo sirve para decidir si una consulta AUTOMÁTICA vale la pena; nunca rechaza un NIT por sí mismo.
 * Contrastado con dos NIT conocidos (5888492 y 44653948); no se da por algoritmo oficial.
 */
export function digitoVerificadorValido(nit: string): boolean {
  const n = normalizarId(nit); if (!RE_NIT.test(n) || n.length < 2) return false;
  const cuerpo = n.slice(0, -1), n1 = cuerpo.length + 1; let s = 0;
  for (let i = 0; i < cuerpo.length; i++) s += Number(cuerpo[i]) * (n1 - i);
  const r = (11 - (s % 11)) % 11; return (r === 10 ? "K" : String(r)) === n.slice(-1);
}

export type OrigenReceptor = "local" | "demo" | "digifact_test";
export interface RespuestaReceptorNit { origen: OrigenReceptor; simulado: boolean; encontrado: boolean; nit: string; nombre?: string; cf?: true }

/** NIT FICTICIOS del simulador (con dígito verificador válido). Ninguno es de una persona ni empresa real. */
export const DEMO_NIT: Readonly<Record<string, string>> = {
  "10000011": "CONTRIBUYENTE DE PRUEBA UNO, S.A.",
  "1000002K": "CONTRIBUYENTE DE PRUEBA DOS",
  "10000038": "PERSONA DE PRUEBA TRES",
};
/** NIT del simulador que reproduce un fallo del proveedor (para probar el manejo de errores). */
export const DEMO_NIT_ERROR = "99900017";

export class ErrorReceptorNit extends Error {
  constructor(public codigo: "entrada_invalida" | "limite" | "proveedor" | "no_autorizado", mensaje: string, public status: number) { super(mensaje); this.name = "ErrorReceptorNit"; }
}

/** Límite de consultas por minuto y por empresa (el mismo tope que el servicio de Digifact: 20). */
export function crearLimitador(max = 20, ahora: () => number = Date.now) {
  const v = new Map<string, number[]>();
  return (empresa: string): boolean => { const t = ahora(), l = (v.get(empresa) ?? []).filter((x) => t - x < 60_000); if (l.length >= max) { v.set(empresa, l); return false; } l.push(t); v.set(empresa, l); return true; };
}

export interface DepsReceptorNit {
  svc?: ServicioFelGt;
  limitador: (empresa: string) => boolean;
  auditar: (evento: string, empresa: string, actor: string, datos: Record<string, unknown>) => Promise<void> | void;
}

export async function consultarReceptorNit(ctx: ContextoFel, entrada: unknown, d: DepsReceptorNit): Promise<RespuestaReceptorNit> {
  if (!ctx.permisos.includes("clientes.ver")) throw new ErrorReceptorNit("no_autorizado", "No tienes permiso para consultar receptores", 403);
  const nit = normalizarId(entrada);
  if (nit === "CF") return { origen: "local", simulado: false, encontrado: true, cf: true, nit: "CF", nombre: NOMBRE_CF };   // CF nunca sale hacia ningún proveedor
  if (!RE_NIT.test(nit)) throw new ErrorReceptorNit("entrada_invalida", "NIT no válido: usa solo números y, al final, un dígito o K", 400);
  if (!d.limitador(ctx.empresaId)) throw new ErrorReceptorNit("limite", "Demasiadas consultas de NIT; espera un minuto", 429);
  if (d.svc) {   // Digifact TEST habilitado: el servicio existente (permisos, auditoría y traducción de errores propios)
    try { const r = await d.svc.consultarNit(ctx, nit); return r.encontrado ? { origen: "digifact_test", simulado: false, encontrado: true, nit: r.nit, nombre: r.nombre } : { origen: "digifact_test", simulado: false, encontrado: false, nit }; }
    catch (e) {
      if (e instanceof ErrorFelGt && e.codigo === "SIN_CANAL") return await simulado(ctx, nit, d);   // esta empresa no tiene canal de Digifact: para ella Digifact está apagado → simulador
      if (e instanceof ErrorFelGt) throw new ErrorReceptorNit(e.codigo === "NO_AUTORIZADO" ? "no_autorizado" : e.codigo === "LIMITE" ? "limite" : e.codigo === "ENTRADA" ? "entrada_invalida" : "proveedor", e.message, e.status);
      throw e;
    }
  }
  return await simulado(ctx, nit, d);
}

/** Digifact apagado (o sin canal para la empresa): simulador con datos ficticios. */
async function simulado(ctx: ContextoFel, nit: string, d: DepsReceptorNit): Promise<RespuestaReceptorNit> {
  await d.auditar("receptor.nit_consultado", ctx.empresaId, ctx.actorId, { origen: "demo", encontrado: nit in DEMO_NIT });
  if (nit === DEMO_NIT_ERROR) throw new ErrorReceptorNit("proveedor", "El servicio de consulta (simulado) no respondió", 502);
  return nit in DEMO_NIT ? { origen: "demo", simulado: true, encontrado: true, nit, nombre: DEMO_NIT[nit] } : { origen: "demo", simulado: true, encontrado: false, nit };
}
