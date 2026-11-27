// FUNCIÓN INTERNA DE SISTEMA (F4): el trabajo SIN persona (vencimiento de órdenes, revisión del bolsón, alertas de operaciones atascadas y verificaciones de saldos) corre con la credencial `nexa_sys`, que solo puede ejecutar `fel_sys_*`
// y no ve tablas. Se despliega como una función Edge SEPARADA de la de cara al usuario, que no recibe nunca esta credencial. Nada aquí llama a un proveedor fiscal ni envía correos.
import type { BdDemo } from "./bd.ts";

export interface ResultadoTick { ordenesVencidas: number; bolsonRevisado: number; operacionesPendientes: number; fallidasManuales: number; consumosIncoherentes: number; saldosInconsistentes: number; monederosInconsistentes: number }
const n = (x: unknown): number => (Array.isArray(x) ? x.length : typeof x === "number" ? x : x ? 1 : 0);
/** Un ciclo del sistema. Solo cuenta y marca; las decisiones sobre cada operación siguen siendo de las personas autorizadas. */
export async function tickSistema(sys: BdDemo, o: { umbralMin?: number } = {}): Promise<ResultadoTick> {
  const u = o.umbralMin ?? 15;
  return {
    ordenesVencidas: n(await sys.rpc("fel_sys_ordenes_vencer", {})), bolsonRevisado: n(await sys.rpc("fel_sys_bolson_revisar", { p_umbral_min: u })),
    operacionesPendientes: n(await sys.rpc("fel_sys_operaciones_pendientes", { p_umbral_min: u })), fallidasManuales: n(await sys.rpc("fel_sys_fallidas_manuales_recientes", {})),
    consumosIncoherentes: n(await sys.rpc("fel_sys_consumos_incoherentes", {})), saldosInconsistentes: n(await sys.rpc("fel_sys_verificar_saldos", {})), monederosInconsistentes: n(await sys.rpc("fel_sys_verificar_monederos", {})),
  };
}
const igual = async (a: string, b: string) => { const h = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x))); const [x, y] = await Promise.all([h(a), h(b)]); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
/** Manejador HTTP de la función de sistema: solo `POST /tick` con el secreto compartido (cabecera `x-nexa-sys-secreto`); sin secreto configurado no responde nada. */
export function crearManejadorSistema(o: { sys: () => BdDemo; secreto: string | undefined }): (req: Request) => Promise<Response> {
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  return async (req) => {
    if (!o.secreto || o.secreto.length < 24) return json({ codigo: "no_configurado" }, 503);
    const url = new URL(req.url);
    if (req.method !== "POST" || !/^(?:\/functions\/v1)?(?:\/nexa-sys)?\/tick$/.test(url.pathname)) return json({ codigo: "no_encontrado" }, 404);   // ruta ANCLADA: ni `/x/tick` ni `/tick/x`; solo POST
    if (!(await igual(req.headers.get("x-nexa-sys-secreto") ?? "", o.secreto))) return json({ codigo: "no_autorizado" }, 401);
    try { return json(await tickSistema(o.sys())); } catch { return json({ codigo: "error" }, 500); }   // sin detalles: nunca cadenas de conexión ni mensajes de la base
  };
}
