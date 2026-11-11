// Firma Ed25519 de las peticiones del agente: ida y vuelta y rechazo de cualquier alteración. Sin red ni base de datos.
import assert from "node:assert/strict";
import { b64u, cabecerasFirmadas, deB64u, generarParClaves, mensajeFirmado, sha256Hex, verificarFirma } from "../src/firma_agente.ts";
import { INTERVALO_DEFECTO_MS, intervaloDesdeEntorno } from "../src/supervisor_ordenes.ts";

const enc = new TextEncoder();
async function firmado(cuerpo = '{"a":1}', ruta = "/api/agente/v1/latido") {
  const par = await generarParClaves();
  const c = await cabecerasFirmadas({ agenteId: crypto.randomUUID(), privada: par.privada, ruta, cuerpo });
  const msg = (r = ruta, ts = c["x-ts"], n = c["x-nonce"], cu = cuerpo, m = "POST") => sha256Hex(enc.encode(cu)).then((h) => mensajeFirmado(m, r, ts, n, h));
  return { par, c, msg };
}

Deno.test("firma: ida y vuelta válida", async () => { const { par, c, msg } = await firmado(); assert.equal(await verificarFirma(par.publica, await msg(), c["x-firma"]), true); });
Deno.test("firma: cualquier alteración del método, la ruta, la marca de tiempo, el nonce o el cuerpo invalida la firma", async () => {
  const { par, c, msg } = await firmado();
  for (const [campo, m] of Object.entries({ ruta: await msg("/api/agente/v1/reclamar"), ts: await msg(undefined, "2030-01-01T00:00:00Z"), nonce: await msg(undefined, undefined, "otro-nonce-0123456789"), cuerpo: await msg(undefined, undefined, undefined, '{"a":2}'), metodo: await msg(undefined, undefined, undefined, undefined, "GET") })) {
    assert.equal(await verificarFirma(par.publica, m, c["x-firma"]), false, `alterar ${campo} debe invalidar la firma`);
  }
});
Deno.test("firma: otra clave, firma o clave mal formadas y basura → false, nunca lanzan", async () => {
  const { par, c, msg } = await firmado(); const otra = await generarParClaves(), m = await msg();
  assert.equal(await verificarFirma(otra.publica, m, c["x-firma"]), false);
  const f = deB64u(c["x-firma"])!; f[0] ^= 1;
  for (const mala of [b64u(f), c["x-firma"].slice(0, 40), "", "***", c["x-firma"] + "A", "A".repeat(86)]) assert.equal(await verificarFirma(par.publica, m, mala), false);
  for (const mala of ["", "corta", "A".repeat(43), "***", par.publica + "A", "é".repeat(43)]) assert.equal(await verificarFirma(mala, m, c["x-firma"]), false);
});
Deno.test("base64url: ida y vuelta y rechazo de caracteres ajenos", () => {
  const x = crypto.getRandomValues(new Uint8Array(33)); assert.deepEqual(deB64u(b64u(x)), x); assert.equal(deB64u("a+b"), null); assert.equal(deB64u("a b"), null);
});
Deno.test("intervalo del supervisor desde el entorno: por defecto, límites y valores raros", () => {
  assert.equal(intervaloDesdeEntorno(undefined), INTERVALO_DEFECTO_MS); assert.equal(intervaloDesdeEntorno(""), INTERVALO_DEFECTO_MS); assert.equal(intervaloDesdeEntorno("100"), 100);
  for (const mal of ["49", "3600001", "abc", "1.5", "-1", "0"]) assert.throws(() => intervaloDesdeEntorno(mal), /no válido/, mal);
});
