// ALCANCE de establecimientos de una persona (requisito: establecimiento asignado y bloqueado por usuario). DESACTIVADO por defecto: sin un lector de alcance nada cambia.
// El alcance sale del SERVIDOR (la sesión validada y la base: `fel_adm_contexto`), nunca del navegador. Un facturador tiene UN establecimiento; un supervisor autorizado, varios (con permiso expreso); propietario y administrador, todos.
import type { BdDemo } from "./bd.ts";
export interface Alcance { todos: boolean; multiples: boolean; ids: string[]; activo: string | null }
/** null = sin restricción (función apagada o persona sin alcance que aplicar). */
export type LectorAlcance = (req: Request, a: { clave: string; id: string }, empresa: string) => Promise<Alcance | null>;
export class ErrorAlcance extends Error { constructor(public status: number, public codigo: string, mensaje: string) { super(mensaje); this.name = "ErrorAlcance"; } }

export const restringido = (al: Alcance | null | undefined): al is Alcance => !!al && !al.todos;
/** ¿El documento de ese establecimiento está dentro del alcance? Sin alcance (apagado) o con alcance total: sí. Un documento SIN establecimiento solo es del alcance total. */
export const enAlcance = (al: Alcance | null | undefined, est: string | null | undefined): boolean => !al || al.todos || (!!est && al.ids.includes(est));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Establecimiento con el que NACE un documento. Si la persona está restringida: el pedido por el navegador solo se acepta si es el suyo; uno distinto se RECHAZA (nunca se cambia en silencio). Sin pedido, el activo. */
export function establecimientoNuevo(al: Alcance | null | undefined, pedido?: string): string | undefined {
  if (!restringido(al)) return pedido && UUID.test(pedido) ? pedido : undefined;
  if (pedido && !al.ids.includes(pedido)) throw new ErrorAlcance(403, "establecimiento_no_autorizado", "Tu usuario no está autorizado para emitir en ese establecimiento.");
  const e = pedido ?? al.activo ?? al.ids[0];
  if (!e) throw new ErrorAlcance(403, "sin_establecimiento", "Tu usuario no tiene un establecimiento asignado. Pídele al administrador de tu empresa que te lo asigne.");
  if (!al.multiples && pedido && al.activo && pedido !== al.activo) throw new ErrorAlcance(403, "establecimiento_no_autorizado", "Tu establecimiento está asignado y bloqueado.");
  return e;
}
export function alcanceDeContexto(c: Record<string, unknown>): Alcance | null {
  if (!c || c.por_usuario !== true) return null;   // interruptor de la base apagado: sin restricción
  const al = (c.alcance ?? {}) as Record<string, unknown>;
  return { todos: al.todos === true, multiples: al.multiples === true, ids: Array.isArray(al.ids) ? (al.ids as unknown[]).map(String) : [], activo: typeof c.establecimiento_activo === "string" ? c.establecimiento_activo : null };
}
/** Lector real: pregunta a la base por el contexto de la SESIÓN VALIDADA (cookie) — la identidad y la empresa no son parámetros del navegador. */
export function lectorDeAlcanceBd(bd: BdDemo, tokenDe: (req: Request) => string | null): LectorAlcance {
  return async (req) => { const t = tokenDe(req); if (!t) return { todos: false, multiples: false, ids: [], activo: null }; return alcanceDeContexto(await bd.rpc("fel_adm_contexto", { p_sesion: t }) as Record<string, unknown>); };
}
