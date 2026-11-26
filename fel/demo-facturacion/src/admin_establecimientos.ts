// ADMINISTRACIÓN de establecimientos y de su asignación a personas (etapa 1D). DESACTIVADA por defecto: sin este puerto las rutas /api/admin/* no existen.
// La identidad y la empresa NUNCA llegan como parámetros: se envía solo el token de la SESIÓN (la cookie HttpOnly) y la base lo valida (`fel_adm_*`, M-F/M-G/M-H); lo que el navegador mande como «actor» o «empresa» ni se lee.
import type { BdDemo } from "./bd.ts";
import { Sesiones } from "./sesiones.ts";

export class ErrorSesionAdmin extends Error { constructor() { super("Sesión no válida"); } }
export interface AdminEst {
  listar(req: Request): Promise<unknown>;
  nombre(req: Request, establecimiento: string, nombre: string): Promise<void>;
  asignar(req: Request, usuario: string, establecimiento: string, predeterminado: boolean, motivo: string): Promise<unknown>;
  revocar(req: Request, usuario: string, establecimiento: string, motivo: string): Promise<void>;
  supervisor(req: Request, usuario: string, valor: boolean, motivo: string): Promise<void>;
}
const tokenDe = (req: Request): string => { const t = Sesiones.idDeCookie(req); if (!t) throw new ErrorSesionAdmin(); return t; };
/** Implementación real: cada operación es UNA llamada a una función `fel_adm_*` con el token de la sesión. */
export function adminDeBd(bd: BdDemo): AdminEst {
  return {
    listar: (req) => bd.rpc("fel_adm_asignaciones_listar", { p_sesion: tokenDe(req) }),
    nombre: async (req, est, nombre) => { await bd.rpc("fel_adm_establecimiento_nombre", { p_sesion: tokenDe(req), p_establecimiento: est, p_nombre: nombre }); },
    asignar: (req, u, est, pred, motivo) => bd.rpc("fel_adm_asignar", { p_sesion: tokenDe(req), p_usuario: u, p_establecimiento: est, p_predeterminado: pred, p_motivo: motivo }),
    revocar: async (req, u, est, motivo) => { await bd.rpc("fel_adm_asignacion_revocar", { p_sesion: tokenDe(req), p_usuario: u, p_establecimiento: est, p_motivo: motivo }); },
    supervisor: async (req, u, valor, motivo) => { await bd.rpc("fel_adm_supervisor", { p_sesion: tokenDe(req), p_usuario: u, p_valor: valor, p_motivo: motivo }); },
  };
}
