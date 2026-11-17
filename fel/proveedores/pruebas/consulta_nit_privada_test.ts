// «consultar-nit-privado»: una sola consulta real al ambiente TEST, sin datos personales en la salida. TODAS las pruebas usan un `fetch` SIMULADO: ninguna toca la red ni usa credenciales reales.
// Uso: deno test --allow-net=127.0.0.1 pruebas/consulta_nit_privada_test.ts   (sin subprocesos: la prueba que necesita ejecutar «deno run» está aparte, en pruebas_cli/)
import assert from "node:assert/strict";
import { CONFIRMACION_NIT_PRIVADO, consultaNitPrivada, presenciaCredenciales } from "../src/consulta_nit_privada.ts";

const USUARIO = "GT.000005888492.USUARIO_INVENTADO", CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", NIT = "5888492", NOMBRE = "RAZON SOCIAL INVENTADA PARA PRUEBAS, S.A.", PROVEEDOR = "DETALLE-INTERNO-DEL-PROVEEDOR";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const envDe = (extra: Record<string, string> = {}) => { const m: Record<string, string> = { DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT, DIGIFACT_CONFIRMAR: CONFIRMACION_NIT_PRIVADO, ...extra }; return (k: string) => (m[k] === "" ? undefined : m[k]); };
const SECRETOS = [USUARIO, CLAVE, NIT, NOMBRE, TOKEN, "firma-secreta", PROVEEDOR, "USUARIO_INVENTADO"];

type Modo = "ok" | "sin_coincidencia" | "nit_distinto" | "shared401" | "login401" | "http500" | "ilegible" | "tiempo";
function falso(modo: Modo = "ok") {
  const llamadas: { url: string; metodo: string }[] = [];
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); llamadas.push({ url: u, metodo: init?.method ?? "GET" });
    if (modo === "tiempo") return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    if (u.endsWith("/login/get_token")) return modo === "login401" ? json({ mensaje: PROVEEDOR }, 401) : json({ Token: TOKEN });
    if (u.includes("/Shared?")) {
      if (modo === "shared401") return json({ mensaje: PROVEEDOR }, 401);
      if (modo === "http500") return json({ mensaje: PROVEEDOR }, 500);
      if (modo === "ilegible") return new Response(`<html>${PROVEEDOR}</html>`, { status: 200 });
      return json({ RESPONSE: modo === "sin_coincidencia" ? [] : [{ NIT: modo === "nit_distinto" ? "12345678" : NIT, NOMBRE }] });
    }
    return json({ mensaje: "ruta no permitida" }, 404);
  }) as typeof fetch;
  return { fetchImpl, llamadas, consultas: () => llamadas.filter((l) => l.url.includes("/Shared?")).length, sesiones: () => llamadas.filter((l) => l.url.endsWith("/login/get_token")).length };
}
const sinSecretos = (r: unknown, donde: string) => { const t = JSON.stringify(r); for (const s of SECRETOS) assert.ok(!t.includes(s), `${donde}: la salida no debe contener «${s}»`); };

Deno.test("comprobación de presencia: solo sí/no, sin valores ni longitudes y sin ninguna llamada", () => {
  assert.deepEqual(presenciaCredenciales(envDe()), { usuario: true, clave: true, nit: true });
  assert.deepEqual(presenciaCredenciales(envDe({ DIGIFACT_TEST_PASSWORD: "" })), { usuario: true, clave: false, nit: true });
  assert.deepEqual(presenciaCredenciales(() => undefined), { usuario: false, clave: false, nit: false });
  sinSecretos(presenciaCredenciales(envDe()), "presencia");
});

Deno.test("sin credenciales, sin la palabra de confirmación, o con cualquier NIT escrito a mano: no se hace NINGUNA llamada", async () => {
  for (const [que, env, motivo] of [
    ["sin contraseña", envDe({ DIGIFACT_TEST_PASSWORD: "" }), "faltan_credenciales"], ["sin usuario", envDe({ DIGIFACT_TEST_USERNAME: "" }), "faltan_credenciales"], ["sin NIT de la cuenta", envDe({ DIGIFACT_TEST_NIT: "" }), "faltan_credenciales"],
    ["sin confirmación", envDe({ DIGIFACT_CONFIRMAR: "" }), "falta_confirmacion"], ["confirmación equivocada", envDe({ DIGIFACT_CONFIRMAR: "CERTIFICAR-TEST" }), "falta_confirmacion"],
    ["un NIT ajeno", envDe({ DIGIFACT_NIT_CONSULTA: "44653948" }), "solo_nit_de_la_cuenta"], ["incluso el mismo NIT escrito a mano", envDe({ DIGIFACT_NIT_CONSULTA: NIT }), "solo_nit_de_la_cuenta"],
    ["NIT de la cuenta con formato inválido", envDe({ DIGIFACT_TEST_NIT: "no-es-un-nit" }), "nit_de_la_cuenta_no_valido"],
  ] as const) {
    const f = falso(); const r = await consultaNitPrivada(env, { fetchImpl: f.fetchImpl });
    assert.equal(r.consulta, "no_ejecutada", que); assert.equal(r.ok, false, que); assert.equal(r.motivo, motivo, que); assert.equal(f.llamadas.length, 0, `${que}: no sale ninguna llamada`); sinSecretos(r, que);
  }
});

Deno.test("consulta correcta: UNA sesión y UNA consulta, solo al ambiente TEST; la salida solo dice encontrado, coincide y que hubo nombre", async () => {
  const f = falso(); const r = await consultaNitPrivada(envDe(), { fetchImpl: f.fetchImpl });
  assert.deepEqual(r, { prueba: "consultar-nit-privado", ambiente: "TEST", credenciales: { usuario: true, clave: true, nit: true }, ok: true, consulta: "encontrado", coincide: true, nombrePresente: true, llamadas: { inicioSesion: 1, consulta: 1 }, reintentoBloqueado: false });
  assert.equal(f.llamadas.length, 2); assert.equal(f.sesiones(), 1); assert.equal(f.consultas(), 1);
  for (const l of f.llamadas) { assert.ok(l.url.startsWith("https://testnucgt.digifact.com/api/"), "solo el ambiente TEST"); assert.ok(l.metodo === "POST" ? l.url.endsWith("/login/get_token") : l.metodo === "GET", "solo inicio de sesión y GET"); }
  assert.ok(!f.llamadas.some((l) => /transform|CancelFelGT|ncredtotal|GetDocument|nucgt\.digifact\.com\/gt\.com/.test(l.url)), "ni certificar, ni anular, ni descargar, ni producción");
  sinSecretos(r, "resultado");
});

Deno.test("no encontrado y NIT devuelto distinto: se informa sin mostrar ningún dato", async () => {
  const a = await consultaNitPrivada(envDe(), { fetchImpl: falso("sin_coincidencia").fetchImpl }); assert.equal(a.consulta, "no_encontrado"); assert.equal(a.ok, true); assert.equal(a.coincide, null); sinSecretos(a, "no encontrado");
  const b = await consultaNitPrivada(envDe(), { fetchImpl: falso("nit_distinto").fetchImpl }); assert.equal(b.consulta, "encontrado"); assert.equal(b.coincide, false, "el NIT que devuelve Digifact no es el consultado"); sinSecretos(b, "NIT distinto");
});

Deno.test("sin reintentos: un 401 en la consulta NO renueva el token ni repite la consulta; un fallo, un 500, una respuesta ilegible o un tiempo agotado tampoco", async () => {
  for (const [modo, tipo] of [["shared401", undefined], ["login401", "autenticacion"], ["http500", "servidor"], ["ilegible", "respuesta_invalida"], ["tiempo", "tiempo_agotado"]] as const) {
    const f = falso(modo); const r = await consultaNitPrivada(envDe(), { fetchImpl: f.fetchImpl, tiempoMaximoMs: modo === "tiempo" ? 60 : undefined });
    assert.equal(r.ok, false, modo); assert.equal(r.consulta, "error", modo); assert.equal(r.coincide, null); assert.equal(r.nombrePresente, null);
    assert.ok(f.consultas() <= 1, `${modo}: nunca más de una consulta`); assert.ok(f.sesiones() <= 1, `${modo}: nunca más de un inicio de sesión`);
    if (tipo) assert.equal(r.errorTipo, tipo, modo);
    if (modo === "shared401") { assert.equal(r.reintentoBloqueado, true, "el reintento del cliente se bloqueó"); assert.equal(f.consultas(), 1); assert.equal(f.sesiones(), 1, "no se renovó el token"); }
    assert.equal(typeof r.errorTipo, "string", modo); sinSecretos(r, modo);
  }
});

Deno.test("la salida es solo banderas y contadores: ninguna propiedad guarda texto libre del proveedor ni del entorno", async () => {
  const casos = [await consultaNitPrivada(envDe(), { fetchImpl: falso().fetchImpl }), await consultaNitPrivada(envDe(), { fetchImpl: falso("http500").fetchImpl }), await consultaNitPrivada(envDe({ DIGIFACT_CONFIRMAR: "" }), { fetchImpl: falso().fetchImpl })];
  const PERMITIDAS = new Set(["prueba", "ambiente", "credenciales", "ok", "consulta", "coincide", "nombrePresente", "llamadas", "reintentoBloqueado", "motivo", "errorTipo", "estadoHttp"]);
  for (const r of casos) for (const [k, v] of Object.entries(r)) { assert.ok(PERMITIDAS.has(k), `propiedad inesperada «${k}»`); if (typeof v === "string") assert.match(v, /^[a-z_A-Z\-]{1,40}$/, `«${k}» debe ser un código corto, no texto libre`); }
});

Deno.test("la consola del módulo permanece en silencio: no imprime nada por sí mismo", async () => {
  const vistos: string[] = []; const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { vistos.push(a.join(" ")); };
  try { await consultaNitPrivada(envDe(), { fetchImpl: falso().fetchImpl }); await consultaNitPrivada(envDe(), { fetchImpl: falso("http500").fetchImpl }); } finally { Object.assign(console, orig); }
  assert.deepEqual(vistos, []);
});
