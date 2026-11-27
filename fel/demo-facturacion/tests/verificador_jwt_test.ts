// Verificador de JWT del servidor (JWKS, ES256/RS256) con llaves REALES generadas en la prueba. Cada rechazo se comprueba como «null» por su causa concreta.
import assert from "node:assert/strict";
import { crearVerificadorJwt } from "../src/verificador_jwt.ts";

const enc = new TextEncoder(); const b64u = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
interface Par { kid: string; alg: "ES256" | "RS256"; priv: CryptoKey; jwk: JsonWebKey & { kid: string; alg: string } }
async function par(alg: "ES256" | "RS256", kid: string): Promise<Par> {
  const k = alg === "ES256" ? await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair
    : await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return { kid, alg, priv: k.privateKey, jwk: { ...(await crypto.subtle.exportKey("jwk", k.publicKey)), kid, alg } };
}
async function firmar(p: Par, claims: Record<string, unknown>, cab: Record<string, unknown> = {}) {
  const h = b64u(JSON.stringify({ alg: p.alg, typ: "JWT", kid: p.kid, ...cab })), c = b64u(JSON.stringify(claims));
  const f = new Uint8Array(await crypto.subtle.sign(p.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" }, p.priv, enc.encode(`${h}.${c}`) as unknown as BufferSource));
  return `${h}.${c}.${b64u(f)}`;
}
const AHORA = 1_800_000_000, ok = { sub: "00000000-0000-0000-0000-0000000000c1", role: "authenticated", session_id: "s1", aal: "aal2", exp: AHORA + 600, iss: "https://x.supabase.co/auth/v1", aud: "authenticated" };
const o = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "Verificador JWT: ES256 y RS256 válidos; rechaza firma ajena, cuerpo alterado, vencido, aún no válido, HS256, none, algoritmo cambiado, emisor y audiencia distintos y basura", ...o, fn: async () => {
  const es = await par("ES256", "k-es"), rs = await par("RS256", "k-rs"), otro = await par("ES256", "k-es");   // «otro» usa el MISMO kid con otra llave
  let t = AHORA * 1000; const v = crearVerificadorJwt({ jwks: async () => ({ keys: [es.jwk, rs.jwk] }), ahora: () => t, emisor: ok.iss, audiencia: "authenticated" });
  assert.equal((await v(await firmar(es, ok)))?.sub, ok.sub, "ES256"); assert.equal((await v(await firmar(rs, ok)))?.aal, "aal2", "RS256");
  assert.equal(await v(await firmar(otro, ok)), null, "firmado con otra llave (mismo kid)");
  const bueno = await firmar(es, ok), [h, c, f] = bueno.split("."); const c2 = b64u(JSON.stringify({ ...ok, aal: "aal2", sub: "00000000-0000-0000-0000-0000000000ff" }));
  assert.equal(await v(`${h}.${c2}.${f}`), null, "cuerpo alterado (otro sub) con la firma original");
  assert.equal(await v(await firmar(es, { ...ok, exp: AHORA - 60 })), null, "vencido (más allá de la tolerancia)"); assert.ok(await v(await firmar(es, { ...ok, exp: AHORA - 10 })), "dentro de la tolerancia de 30 s");
  assert.equal(await v(await firmar(es, { ...ok, nbf: AHORA + 600 })), null, "aún no válido"); assert.equal(await v(await firmar(es, { ...ok, iss: "https://otro.example" })), null, "emisor distinto"); assert.equal(await v(await firmar(es, { ...ok, aud: "otra" })), null, "audiencia distinta");
  assert.equal(await v(await firmar(es, { ...ok, sub: "" })), null, "sin sub"); assert.equal(await v(await firmar(es, { role: "authenticated", exp: AHORA + 60 })), null, "sin sub");
  // algoritmos prohibidos
  const hs = `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "k-es" }))}.${c}.${b64u("firma")}`; assert.equal(await v(hs), null, "HS256"); assert.equal(await v(`${b64u(JSON.stringify({ alg: "none", kid: "k-es" }))}.${c}.`), null, "none");
  assert.equal(await v(await firmar(es, ok, { alg: "RS256" })), null, "algoritmo declarado distinto del de la llave");
  for (const x of ["", "a.b", "a.b.c.d", "x".repeat(9000), "....", `${h}.${c}.${f}.extra`, `${h}.${c}`]) assert.equal(await v(x), null, `basura: ${x.slice(0, 12)}`);
  t += 10;
}});

Deno.test({ name: "Verificador JWT: rotación de llaves (kid nuevo → una sola recarga), kid desconocido, caché de 10 minutos y fallo del JWKS (cierra, nunca abre)", ...o, fn: async () => {
  const a = await par("ES256", "k1"), b = await par("ES256", "k2"); let llamadas = 0, claves = [a.jwk], caer = false, t = AHORA * 1000;
  const v = crearVerificadorJwt({ jwks: async () => { llamadas++; if (caer) throw new Error("sin red"); return { keys: claves }; }, ahora: () => t });
  assert.ok(await v(await firmar(a, ok))); assert.ok(await v(await firmar(a, ok))); assert.equal(llamadas, 1, "caché: una sola descarga");
  assert.equal(await v(await firmar(b, ok)), null, "kid aún no publicado"); assert.equal(llamadas, 2, "una recarga al ver un kid desconocido");
  claves = [a.jwk, b.jwk]; assert.ok(await v(await firmar(b, ok)), "tras publicarlo, la recarga lo encuentra"); assert.equal(llamadas, 3);
  assert.equal(await v(await firmar(await par("ES256", "k3"), ok)), null); const n = llamadas; assert.equal(await v(await firmar(await par("ES256", "k3"), ok)), null); assert.ok(llamadas - n <= 1, "un kid desconocido repetido no inunda el JWKS más de una vez por petición");
  t += 11 * 60_000; caer = true; const antes = llamadas; assert.equal(await v(await firmar(a, { ...ok, exp: (t / 1000) + 600 })), null, "caché vencida y JWKS caído: se rechaza (falla cerrado)"); assert.ok(llamadas > antes);
}});
