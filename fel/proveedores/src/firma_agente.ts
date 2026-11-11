// Firma y verificación de las peticiones del agente local (Ed25519, WebCrypto). Sin red, sin base de datos.
// Mensaje firmado: «MÉTODO\nruta\nmarca-de-tiempo\nnonce\nsha256-hex-del-cuerpo» (ver fel/docs/agente-protocolo.md §1).
const enc = new TextEncoder();

export const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function deB64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try { const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return null; }
}
export async function sha256Hex(datos: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", datos as unknown as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
}
export const mensajeFirmado = (metodo: string, ruta: string, ts: string, nonce: string, hashCuerpo: string) => `${metodo}\n${ruta}\n${ts}\n${nonce}\n${hashCuerpo}`;

/** Verifica una firma Ed25519. Devuelve false ante CUALQUIER problema (clave o firma mal formadas incluidas); nunca lanza. */
export async function verificarFirma(clavePublicaB64u: string, mensaje: string, firmaB64u: string): Promise<boolean> {
  try {
    const clave = deB64u(clavePublicaB64u), firma = deB64u(firmaB64u);
    if (!clave || clave.length !== 32 || !firma || firma.length !== 64) return false;
    const k = await crypto.subtle.importKey("raw", clave as unknown as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, k, firma as unknown as BufferSource, enc.encode(mensaje) as unknown as BufferSource);
  } catch { return false; }
}

/** Par de claves de un agente (para pruebas y para el agente en Deno; el agente de Windows usa node:crypto con el mismo formato). */
export async function generarParClaves(): Promise<{ publica: string; privada: CryptoKey }> {
  const par = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  return { publica: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey))), privada: par.privateKey };
}
/** Cabeceras firmadas para una petición del agente. */
export async function cabecerasFirmadas(o: { agenteId: string; privada: CryptoKey; ruta: string; cuerpo: string; ts?: string; nonce?: string; metodo?: string }): Promise<Record<string, string>> {
  const ts = o.ts ?? new Date().toISOString(), nonce = o.nonce ?? b64u(crypto.getRandomValues(new Uint8Array(18)));
  const hash = await sha256Hex(enc.encode(o.cuerpo));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, o.privada, enc.encode(mensajeFirmado(o.metodo ?? "POST", o.ruta, ts, nonce, hash)) as unknown as BufferSource));
  return { "content-type": "application/json", "x-agente": o.agenteId, "x-ts": ts, "x-nonce": nonce, "x-firma": b64u(firma) };
}
