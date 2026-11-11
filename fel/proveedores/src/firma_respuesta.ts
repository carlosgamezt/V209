// FIRMA DE LAS RESPUESTAS de NEXA al agente (Ed25519), ligada a la petición. Sin ella, el agente confiaría en lo que dijera cualquier intermediario (proxy, red hostil).
// Mensaje firmado: «nexa-respuesta-v1\n<kid>\n<nonce-de-la-petición>\n<estado-HTTP>\n<marca-de-tiempo>\n<sha256-hex-del-cuerpo>».
//  · el nonce liga la respuesta a UNA petición (una respuesta vieja repetida no coincide);  · la marca de tiempo la hace caducar;  · el estado y el cuerpo no se pueden alterar.
// Distribución y rotación de claves: el agente trae claves públicas incrustadas; NEXA anuncia claves nuevas firmadas por una clave que el agente ya confía («nexa-clave-v1»)
// y puede revocar claves («nexa-revoca-v1»). Diseño: fel/docs/agente-transporte-remoto.md.
import { b64u, sha256Hex, verificarFirma } from "./firma_agente.ts";

const enc = new TextEncoder();
export const DOMINIO_RESPUESTA = "nexa-respuesta-v1", DOMINIO_ANUNCIO = "nexa-clave-v1", DOMINIO_REVOCA = "nexa-revoca-v1";
export const mensajeRespuesta = (kid: string, nonce: string, status: number, ts: string, hashCuerpo: string) => `${DOMINIO_RESPUESTA}\n${kid}\n${nonce}\n${status}\n${ts}\n${hashCuerpo}`;
export const mensajeAnuncio = (kid: string, publica: string, desde: string, hasta: string | null) => `${DOMINIO_ANUNCIO}\n${kid}\n${publica}\n${desde}\n${hasta ?? ""}`;
export const mensajeRevocacion = (kid: string) => `${DOMINIO_REVOCA}\n${kid}`;
const firmar = async (privada: CryptoKey, m: string) => b64u(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privada, enc.encode(m) as unknown as BufferSource)));

export interface AnuncioClave { kid: string; publica: string; desde: string; hasta: string | null; anuncio_kid: string; firma: string }
export interface Revocacion { kid: string; anuncio_kid: string; firma: string }

/** Genera un anuncio de clave nueva firmado con la clave (ya confiable) `firmante`. */
export async function firmarAnuncio(firmante: { kid: string; privada: CryptoKey }, nueva: { kid: string; publica: string; desde: string; hasta: string | null }): Promise<AnuncioClave> {
  return { ...nueva, anuncio_kid: firmante.kid, firma: await firmar(firmante.privada, mensajeAnuncio(nueva.kid, nueva.publica, nueva.desde, nueva.hasta)) };
}
export async function firmarRevocacion(firmante: { kid: string; privada: CryptoKey }, kid: string): Promise<Revocacion> {
  return { kid, anuncio_kid: firmante.kid, firma: await firmar(firmante.privada, mensajeRevocacion(kid)) };
}

export interface FirmanteRespuestas {
  /** Cabeceras de firma para una respuesta ya construida (estado + cuerpo en bytes). `nonce` es el de la petición («-» si no vino uno válido). */
  cabeceras(nonce: string, status: number, cuerpo: Uint8Array): Promise<Record<string, string>>;
  /** Anuncios y revocaciones que el agente aún no conoce (según los `kid` que declara conocer). */
  distribucion(kidsConocidos: string[]): { claves_nexa: AnuncioClave[]; revocadas: Revocacion[] };
  kid: string;
}
export function crearFirmanteRespuestas(o: { kid: string; privada: CryptoKey; anuncios?: AnuncioClave[]; revocadas?: Revocacion[]; ahora?: () => Date }): FirmanteRespuestas {
  const ahora = o.ahora ?? (() => new Date());
  return {
    kid: o.kid,
    async cabeceras(nonce, status, cuerpo) {
      const ts = ahora().toISOString(), hash = await sha256Hex(cuerpo);
      return { "x-nexa-kid": o.kid, "x-nexa-ts": ts, "x-nexa-firma": await firmar(o.privada, mensajeRespuesta(o.kid, nonce, status, ts, hash)) };
    },
    distribucion(kids) {
      const conocidos = new Set(kids);
      return { claves_nexa: (o.anuncios ?? []).filter((a) => !conocidos.has(a.kid)), revocadas: o.revocadas ?? [] };
    },
  };
}

/** Verificación (para pruebas y herramientas del lado de NEXA; el agente tiene la suya en Node). */
export async function verificarRespuestaFirmada(publica: string, o: { kid: string; nonce: string; status: number; ts: string; firma: string; cuerpo: Uint8Array }): Promise<boolean> {
  return await verificarFirma(publica, mensajeRespuesta(o.kid, o.nonce, o.status, o.ts, await sha256Hex(o.cuerpo)), o.firma);
}
