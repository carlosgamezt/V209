// AUTORIZACIÓN HUMANA de la confirmación (lado NEXA). Separada de la identidad del agente: la concesión la firma NEXA con SU clave (el agente nunca la tiene)
// y solo se emite cuando una PERSONA con permiso la pide. El simulador la verifica en el servidor antes de registrar nada. Diseño: fel/docs/agente-confirmacion-humana.md.
import { b64u, deB64u, verificarFirma } from "./firma_agente.ts";
import type { Rpc } from "./rpc.ts";

const enc = new TextEncoder(), dec = new TextDecoder();
export const DOMINIO_CONCESION = "nexa-confirmacion-v1";
export interface Concesion { v: 1; empresa: string; orden: string; resumen_hash: string; usuario: string; emitida: string; expira: string; jti: string }

/** token = base64url(JSON de la concesión) + "." + base64url(firma Ed25519 sobre «dominio\n» + parte-1) */
export async function firmarConcesion(privada: CryptoKey, c: Concesion): Promise<string> {
  const cuerpo = b64u(enc.encode(JSON.stringify(c)));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privada, enc.encode(`${DOMINIO_CONCESION}\n${cuerpo}`) as unknown as BufferSource));
  return `${cuerpo}.${b64u(firma)}`;
}
/** Verifica firma y caducidad. null ante CUALQUIER problema (no lanza). */
export async function verificarConcesion(clavePublica: string, token: string, ahora: Date = new Date()): Promise<Concesion | null> {
  try {
    const [cuerpo, firma, resto] = token.split("."); if (!cuerpo || !firma || resto !== undefined) return null;
    if (!(await verificarFirma(clavePublica, `${DOMINIO_CONCESION}\n${cuerpo}`, firma))) return null;
    const bytes = deB64u(cuerpo); if (!bytes) return null;
    const c = JSON.parse(dec.decode(bytes)) as Concesion;
    if (c.v !== 1 || Date.parse(c.expira) <= ahora.getTime()) return null;
    return c;
  } catch { return null; }
}

/** Destinos de entrega permitidos: SOLO el simulador local (loopback). Nada real puede recibir una concesión. */
export function destinoPermitido(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]") && u.pathname === "/nexa/autorizaciones"; } catch { return false; }
}
export function entregaPorHttp(url: string, fetchFn: typeof fetch = fetch): (token: string) => Promise<void> {
  return async (token) => {
    if (!destinoPermitido(url)) throw new Error("FEL_DESTINO: la concesión solo puede entregarse al simulador local");
    const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(5000) });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`FEL_ENTREGA: el simulador respondió ${r.status}`);
  };
}

export interface Autorizador {
  /** La PERSONA autoriza. Exige permiso (SQL), orden presentada/vigente y vista previa coincidente; firma y entrega. La respuesta NO incluye la concesión. */
  autorizar(o: { actor: string; empresa: string; orden: string }): Promise<{ orden: string; expira_en: string }>;
  clavePublica: string;
}
export function crearAutorizador(o: { rpc: Rpc; privada: CryptoKey; clavePublica: string; entregar: (token: string) => Promise<void>; ttlSeg?: number; ahora?: () => Date }): Autorizador {
  return {
    clavePublica: o.clavePublica,
    async autorizar({ actor, empresa, orden }) {
      const r = await o.rpc("fel_op_orden_confirmacion_autorizar", { p_actor: actor, p_empresa: empresa, p_orden: orden, p_ttl_seg: o.ttlSeg ?? 300 }) as { resumen_hash: string; usuario: string; jti: string; expira_en: string };
      const ahora = (o.ahora?.() ?? new Date()).toISOString();
      const token = await firmarConcesion(o.privada, { v: 1, empresa, orden, resumen_hash: r.resumen_hash, usuario: r.usuario, emitida: ahora, expira: new Date(r.expira_en).toISOString(), jti: r.jti });
      await o.entregar(token);   // de servidor a servidor: no pasa por el agente ni por la respuesta a la persona
      return { orden, expira_en: new Date(r.expira_en).toISOString() };
    },
  };
}
