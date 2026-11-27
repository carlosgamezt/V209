// IDENTIDAD DE SESIÓN en las llamadas a la base (R2, fase F1). DESACTIVADA por defecto (sin M-I aplicada no existen los envoltorios).
// Con ella activada, toda llamada `fel_op_X` con envoltorio se envía como `fel_ses_X(p_sesion, …)`: el servidor NO envía actor ni empresa; la base los saca de la sesión validada (cookie). Si el código intentara mandar
// otra persona u otra empresa distintas de las de la petición, se rechaza ANTES de llegar a la base (un error de programación nunca se convierte en suplantación).
// F5 (Supabase Auth): lo único que cambia es qué es el «token» (hoy el identificador opaco de la cookie; luego el JWT) y cómo lo valida `fel__sesion_empresa` en la base; este archivo no cambia.
import { AsyncLocalStorage } from "node:async_hooks";
import type { BdDemo } from "./bd.ts";

/** Funciones `fel_op_*` (y `fel_tipos_empresa`) con envoltorio `fel_ses_*` (M-I). Se verifica contra el catálogo de la base en `tests/identidad_sesion_test.ts`: si M-I genera uno más o uno menos, la prueba falla. */
export const CON_ENVOLTORIO: ReadonlySet<string> = new Set(["agente_codigo_crear", "agente_metricas", "agente_revocar", "agentes_listar", "alerta_resolver", "anulacion_iniciar", "anulacion_simulada_iniciar", "canal_configurar", "certificacion_iniciar",
  "certificacion_solicitar", "cliente_estado", "cliente_frecuente", "cliente_guardar", "concepto_estado", "concepto_guardar", "conciliacion_decidir", "conciliacion_proponer", "documento_establecimiento", "documento_guardar", "documento_origenes",
  "documento_preparacion", "documento_reabrir", "documento_tipo", "empresa_datos_guardar", "establecimiento_guardar", "invitacion_registrar", "invitacion_revocar", "miembro_actualizar", "miembros_listar", "operacion_desconocida", "operacion_resolver",
  "orden_confirmacion_autorizar", "orden_vista_previa", "tipos_empresa_guardar"].map((n) => `fel_op_${n}`).concat(["fel_tipos_empresa"]));

export class ErrorIdentidad extends Error { constructor(m: string, readonly codigo = "no_autorizado") { super(`FEL_NO_AUTORIZADO: ${m}`); } }   // el prefijo hace que la API responda 403 como cualquier otro rechazo de la base
export interface ContextoPeticion { token: string | null; actor: string | null; empresa: string | null }
/** F4 · funciones del SISTEMA `fel_sys_*` con empresa que se usan DENTRO de una petición (máquina de estados de certificación, cobertura, artefactos, credencial y emisor): `fel_ses_sys_*` toma la empresa de la sesión. */
export const SYS_CON_SESION: ReadonlySet<string> = new Set(["anulacion_cerrar","anulacion_desconocida","artefacto_guardar","cobertura_cerrar","cobertura_confirmar","cobertura_liberar","cobertura_reservar","consumo_confirmar","consumo_liberar","consumo_reservar","consumo_vigilar","digifact_aplicar","digifact_credencial","documento_instantanea","emisor_vigente","evento_registrar","hash_documento","operacion","operacion_desconocida","operacion_marcar_envio","operacion_no_enviada","operacion_orden","operacion_resolver_evento","orden_crear","orden_por_operacion"].map((n) => `fel_sys_${n}`));

/** F2 · funciones de PLATAFORMA con envoltorio `fel_pla_*` (M-J): `fel_admin_*` y `fel_op_mfa_recuperacion_*` (aprobar, cerrar, listar, rechazar). El actor sale de la sesión de plataforma; la empresa OBJETIVO, si la hay, se conserva. */
export const PLATAFORMA: ReadonlySet<string> = new Set(["bolson_alerta_resolver","bolson_conciliar_decidir","bolson_conciliar_proponer","bolson_cuenta_crear","bolson_cuenta_estado","bolson_evento_tipo_crear","bolson_extracto_importar","bolson_lote_registrar","bolson_partida_resolver","bolson_regla_registrar","cobro_emitir","cobro_generar","contrato_asignar","cuenta_comercial_ajustar","emision","empresa_crear","empresa_estado","empresa_regimen","identificacion_verificar","invitar_propietario","maestro_autorizar","maestro_revocar_autorizacion","pago_simulado_registrar","plan_crear","plan_version_crear","regimen_crear_version","regimen_verificar","regla_crear_version","regla_verificar"].map((n) => `fel_admin_${n}`).concat(["aprobar", "cerrar", "listar", "rechazar"].map((n) => `fel_op_mfa_recuperacion_${n}`)));
export const destinoPlataforma = (fn: string) => `fel_pla_${fn.replace(/^fel_(op|admin)_/, "")}`;
/** Petición en curso (token de la cookie, persona y empresa que el servidor ya resolvió). Es única para todo el proceso: los servicios (Digifact, correo) la usan sin recibir la petición. */
export const peticion = new AsyncLocalStorage<ContextoPeticion>();
export const contextoActual = (): ContextoPeticion | undefined => peticion.getStore();


/** Devuelve una base cuyo `rpc` envía las funciones con envoltorio por la ruta de sesión. `contexto()` entrega la petición en curso (token de la cookie y, para comprobar, la persona y la empresa que el servidor ya resolvió). */
export function conIdentidadDeSesion(bd: BdDemo, contexto: () => ContextoPeticion | undefined = contextoActual): BdDemo {
  return { ...bd, rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    if (PLATAFORMA.has(fn)) {   // F2: el actor es el de la sesión de PLATAFORMA; la empresa objetivo (si la hay) se conserva
      const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida");
      const { p_actor, ...resto } = args; if (c.actor && p_actor !== undefined && p_actor !== c.actor) throw new ErrorIdentidad("La persona de la llamada no es la de la sesión", "identidad_distinta");
      return bd.rpc(destinoPlataforma(fn), { p_sesion: c.token, ...resto });
    }
    if (SYS_CON_SESION.has(fn)) {   // F4: la empresa de la llamada DEBE ser la de la sesión (y se envía solo la sesión)
      const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida");
      const { p_empresa, ...resto } = args; if (c.empresa && p_empresa !== undefined && p_empresa !== c.empresa) throw new ErrorIdentidad("La empresa de la llamada no es la de la sesión", "identidad_distinta");
      return bd.rpc(`fel_ses_sys_${fn.slice(8)}`, { p_sesion: c.token, ...resto });
    }
    if (fn === "fel_sys_bolson_cuenta_simulada") { const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida"); return bd.rpc("fel_ses_sys_bolson_cuenta_simulada", { p_sesion: c.token, ...args }); }
    if (fn === "fel_sys_bolson_revisar") { const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida"); return bd.rpc("fel_pla_sys_bolson_revisar", { p_sesion: c.token, p_umbral_min: args.p_umbral_min ?? null }); }
    if (fn === "fel_auditar") {   // F3: la auditoría de una petición la firma la sesión (lista cerrada de acciones); jamás una persona enviada por parámetro
      const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida");
      const { p_actor, p_empresa, ...resto } = args;
      if (c.actor && p_actor !== undefined && p_actor !== c.actor) throw new ErrorIdentidad("La persona de la llamada no es la de la sesión", "identidad_distinta");
      if (c.empresa && p_empresa !== undefined && p_empresa !== c.empresa) throw new ErrorIdentidad("La empresa de la llamada no es la de la sesión", "identidad_distinta");
      return bd.rpc("fel_ses_auditar", { p_sesion: c.token, ...resto });
    }
    if (!CON_ENVOLTORIO.has(fn)) return bd.rpc(fn, args);
    const c = contexto(); if (!c?.token) throw new ErrorIdentidad("Sesión no válida");
    const { p_actor, p_empresa, ...resto } = args;
    if (c.actor && p_actor !== undefined && p_actor !== c.actor) throw new ErrorIdentidad("La persona de la llamada no es la de la sesión", "identidad_distinta");
    if (c.empresa && p_empresa !== undefined && p_empresa !== c.empresa) throw new ErrorIdentidad("La empresa de la llamada no es la de la sesión", "identidad_distinta");
    return bd.rpc(`fel_ses_${fn.replace(/^fel_(op_)?/, "")}`, { p_sesion: c.token, ...resto });
  } } as BdDemo;
}
