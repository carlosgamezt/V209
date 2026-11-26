// IDENTIDAD DE SESIÓN en las llamadas a la base (R2, fase F1). DESACTIVADA por defecto (sin M-I aplicada no existen los envoltorios).
// Con ella activada, toda llamada `fel_op_X` con envoltorio se envía como `fel_ses_X(p_sesion, …)`: el servidor NO envía actor ni empresa; la base los saca de la sesión validada (cookie). Si el código intentara mandar
// otra persona u otra empresa distintas de las de la petición, se rechaza ANTES de llegar a la base (un error de programación nunca se convierte en suplantación).
// F5 (Supabase Auth): lo único que cambia es qué es el «token» (hoy el identificador opaco de la cookie; luego el JWT) y cómo lo valida `fel__sesion_empresa` en la base; este archivo no cambia.
import type { BdDemo } from "./bd.ts";

/** Funciones `fel_op_*` con envoltorio `fel_ses_*` (M-I). Se verifica contra el catálogo de la base en `tests/identidad_sesion_test.ts`: si M-I genera uno más o uno menos, la prueba falla. */
export const CON_ENVOLTORIO: ReadonlySet<string> = new Set(["agente_codigo_crear", "agente_metricas", "agente_revocar", "agentes_listar", "alerta_resolver", "anulacion_iniciar", "anulacion_simulada_iniciar", "canal_configurar", "certificacion_iniciar",
  "certificacion_solicitar", "cliente_estado", "cliente_frecuente", "cliente_guardar", "concepto_estado", "concepto_guardar", "conciliacion_decidir", "conciliacion_proponer", "documento_establecimiento", "documento_guardar", "documento_origenes",
  "documento_preparacion", "documento_reabrir", "documento_tipo", "empresa_datos_guardar", "establecimiento_guardar", "invitacion_registrar", "invitacion_revocar", "miembro_actualizar", "miembros_listar", "operacion_desconocida", "operacion_resolver",
  "orden_confirmacion_autorizar", "orden_vista_previa", "tipos_empresa_guardar"].map((n) => `fel_op_${n}`));

export class ErrorIdentidad extends Error { constructor(m: string, readonly codigo = "no_autorizado") { super(`FEL_NO_AUTORIZADO: ${m}`); } }   // el prefijo hace que la API responda 403 como cualquier otro rechazo de la base
export interface ContextoPeticion { token: string | null; actor: string | null; empresa: string | null }

/** Devuelve una base cuyo `rpc` envía las funciones con envoltorio por la ruta de sesión. `contexto()` entrega la petición en curso (token de la cookie y, para comprobar, la persona y la empresa que el servidor ya resolvió). */
export function conIdentidadDeSesion(bd: BdDemo, contexto: () => ContextoPeticion | undefined): BdDemo {
  return { ...bd, rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    if (!CON_ENVOLTORIO.has(fn)) return bd.rpc(fn, args);
    const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida");
    const { p_actor, p_empresa, ...resto } = args;
    if (c.actor && p_actor !== undefined && p_actor !== c.actor) throw new ErrorIdentidad("La persona de la llamada no es la de la sesión", "identidad_distinta");
    if (c.empresa && p_empresa !== undefined && p_empresa !== c.empresa) throw new ErrorIdentidad("La empresa de la llamada no es la de la sesión", "identidad_distinta");
    return bd.rpc(`fel_ses_${fn.slice(7)}`, { p_sesion: c.token, ...resto });
  } } as BdDemo;
}
