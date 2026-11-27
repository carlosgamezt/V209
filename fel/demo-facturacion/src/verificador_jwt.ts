// Verificación de los JWT de Supabase Auth EN EL SERVIDOR (llaves asimétricas publicadas en el JWKS del proyecto). Solo ES256 y RS256: HS256 (secreto compartido), «none» y cualquier otro algoritmo se rechazan.
// Comprueba firma, `exp`/`nbf` (con tolerancia de 30 s), emisor y audiencia si se configuran, y que exista `sub`. Las claves se guardan en memoria 10 minutos y se vuelven a pedir UNA vez si llega un `kid` desconocido (rotación).
// NO sustituye a la base: la sesión viva y el MFA los sigue decidiendo PostgreSQL; esto impide que una ruta que no pasa por la Data API acepte un token falsificado.
const dec = new TextDecoder();
const deB64u = (s: string): Uint8Array | null => { if (!/^[A-Za-z0-9_-]*$/.test(s)) return null; try { return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)); } catch { return null; } };
export interface OpcionesVerificador { jwks: () => Promise<{ keys: (JsonWebKey & { kid?: string; alg?: string })[] }>; emisor?: string; audiencia?: string; ahora?: () => number; ttlClavesMs?: number }
export type Claims = Record<string, unknown> & { sub: string; exp: number };

export function crearVerificadorJwt(o: OpcionesVerificador): (jwt: string) => Promise<Claims | null> {
  let cache: { t: number; keys: (JsonWebKey & { kid?: string; alg?: string })[] } | null = null; const ahora = o.ahora ?? (() => Date.now()), ttl = o.ttlClavesMs ?? 600_000;
  const claves = async (forzar = false) => { if (!forzar && cache && ahora() - cache.t < ttl) return cache.keys; const r = await o.jwks(); cache = { t: ahora(), keys: Array.isArray(r?.keys) ? r.keys : [] }; return cache.keys; };
  return async (jwt) => {
    try {
      const partes = jwt.split("."); if (partes.length !== 3 || jwt.length > 8192) return null;
      const cab = JSON.parse(dec.decode(deB64u(partes[0]) ?? new Uint8Array())) as { alg?: string; kid?: string }; const carga = deB64u(partes[1]), firma = deB64u(partes[2]); if (!carga || !firma) return null;
      if (cab.alg !== "ES256" && cab.alg !== "RS256") return null;   // jamás HS256 ni «none»
      let jwk = (await claves()).find((k) => k.kid === cab.kid && (!k.alg || k.alg === cab.alg));
      if (!jwk) jwk = (await claves(true)).find((k) => k.kid === cab.kid && (!k.alg || k.alg === cab.alg));   // rotación: una sola recarga
      if (!jwk || !cab.kid) return null;
      const alg = cab.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      const llave = await crypto.subtle.importKey("jwk", { ...jwk, ext: true, key_ops: ["verify"] }, alg, false, ["verify"]);
      const valida = await crypto.subtle.verify(cab.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, llave, firma as unknown as BufferSource, new TextEncoder().encode(`${partes[0]}.${partes[1]}`) as unknown as BufferSource);
      if (!valida) return null;
      const c = JSON.parse(dec.decode(carga)) as Claims; const t = ahora() / 1000;
      if (typeof c.sub !== "string" || !c.sub || typeof c.exp !== "number" || c.exp + 30 < t) return null; if (typeof c.nbf === "number" && c.nbf - 30 > t) return null;
      if (o.emisor && c.iss !== o.emisor) return null; if (o.audiencia) { const a = c.aud; if (!(a === o.audiencia || (Array.isArray(a) && a.includes(o.audiencia)))) return null; }
      return c;
    } catch { return null; }
  };
}
