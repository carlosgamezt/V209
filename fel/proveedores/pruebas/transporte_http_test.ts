import assert from "node:assert/strict";
import { crearTransporteHttp } from "../src/transporte_http.ts";

Deno.test("transporte HTTP: HTTPS obligatorio, sin credenciales en la dirección, ruta absoluta", async () => {
  assert.throws(() => crearTransporteHttp({ baseUrl: "http://api.example.com" }), /HTTPS/);
  assert.throws(() => crearTransporteHttp({ baseUrl: "https://usuario:clave@api.example.com" }), /usuario/);
  crearTransporteHttp({ baseUrl: "https://api.example.com/v1" }); crearTransporteHttp({ baseUrl: "http://127.0.0.1:9" });
  await assert.rejects(() => crearTransporteHttp({ baseUrl: "http://127.0.0.1:9" })({ metodo: "GET", ruta: "sin-barra", cabeceras: {} }), /ruta/);
});

Deno.test("transporte HTTP: envía una sola vez, no sigue redirecciones, corta por tiempo y por tamaño, y los errores no filtran nada", async () => {
  let llamadas = 0, ultimoCuerpo = "", ultimaCab = "";
  const srv = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    llamadas++; const u = new URL(req.url.replace("/api/", "/")); ultimoCuerpo = await req.text(); ultimaCab = req.headers.get("x-cliente") ?? "";
    if (u.pathname === "/redir") return new Response(null, { status: 302, headers: { location: "https://otro.example/robado" } });
    if (u.pathname === "/lento") { await new Promise((r) => setTimeout(r, 600)); return new Response("tarde"); }
    if (u.pathname === "/grande") return new Response("x".repeat(5000));
    if (u.pathname === "/error500") return new Response('{"codigo":"X"}', { status: 500 });
    return new Response(`{"ok":true,"eco":${JSON.stringify(ultimoCuerpo)}}`, { headers: { "content-type": "application/json" } });
  });
  try {
    const t = crearTransporteHttp({ baseUrl: `http://127.0.0.1:${srv.addr.port}/api`, tiempoMaximoMs: 200, maxBytesRespuesta: 1000, cabecerasFijas: { "x-cliente": "NEXA" } });
    const ok = await t({ metodo: "POST", ruta: "/eco", cabeceras: { "content-type": "application/json" }, cuerpo: '{"a":1}' }); assert.equal(ok.estado, 200); assert.equal(JSON.parse(ok.cuerpo).eco, '{"a":1}'); assert.equal(ultimaCab, "NEXA"); assert.equal(llamadas, 1);
    const r = await t({ metodo: "GET", ruta: "/redir", cabeceras: {} }); assert.equal(r.estado, 302, "no sigue la redirección"); assert.equal(llamadas, 2);
    assert.equal((await t({ metodo: "GET", ruta: "/error500", cabeceras: {} })).estado, 500, "un 500 llega tal cual; interpretarlo es del adaptador");
    await assert.rejects(() => t({ metodo: "GET", ruta: "/lento", cabeceras: {} }), (e: Error) => e.name === "TiempoAgotado");
    await assert.rejects(() => t({ metodo: "GET", ruta: "/grande", cabeceras: {} }), (e: Error) => /demasiado grande/.test(e.message));
    const antes = llamadas; await assert.rejects(() => t({ metodo: "GET", ruta: "/lento", cabeceras: {} })); assert.equal(llamadas, antes + 1, "un solo intento, sin reintento automático");
  } finally { await srv.shutdown(); }
  // un fallo de red no filtra la dirección ni las cabeceras
  const muerto = crearTransporteHttp({ baseUrl: "http://127.0.0.1:1/secreto", cabecerasFijas: { authorization: "Bearer TOKEN-SECRETO" } });
  await assert.rejects(() => muerto({ metodo: "GET", ruta: "/x?clave=ABC", cabeceras: {} }), (e: Error) => e.name === "CorteDeRed" && !/secreto|TOKEN|ABC|127/i.test(e.message + (e.stack ?? "").split("\n")[0]));
});
