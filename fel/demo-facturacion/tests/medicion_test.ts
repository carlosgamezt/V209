// La medición por petición solo entrega NÚMEROS en «Server-Timing» (tiempo en la función, consultas a la base y su tiempo, llamadas a Digifact): ningún dato del negocio, ruta completa ni secreto.
import assert from "node:assert/strict";
import { conMedicion, envolverBd, fetchMedido, marcar } from "../src/medicion.ts";
import { crearBd } from "../src/bd_memoria.ts";

Deno.test("Server-Timing cuenta las consultas y cronometra Digifact sin exponer datos", async () => {
  const bd = envolverBd(await crearBd());
  const f = fetchMedido((async () => new Response("{}")) as typeof fetch);
  const r = await conMedicion(async () => { await bd.filas("select 1"); await bd.ejecutar("select 2"); await f("https://x.example/login/get_token?clave=SECRETA"); await f("https://x.example/v2/transform/nuc_json"); marcar("arranque", 5); return new Response("ok"); });
  const st = r.headers.get("server-timing") ?? "";
  assert.match(st, /fn;dur=\d+/); assert.match(st, /db;dur=\d+;desc="2 consultas"/); assert.match(st, /dfx_token;dur=\d+/); assert.match(st, /dfx_envio;dur=\d+/); assert.match(st, /arranque;dur=5/);
  assert.ok(!/SECRETA|example|select/i.test(st), "la cabecera no lleva direcciones, consultas ni secretos"); assert.equal(await r.text(), "ok");
});
