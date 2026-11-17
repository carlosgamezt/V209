// «consultar-cui-privado»: una sola consulta de CUI al ambiente TEST (SHARED_GETINFOCUI) sin datos personales en la salida. TODO con un `fetch` SIMULADO y CUI INVENTADOS: ninguna prueba toca la red.
// Uso: deno test --allow-net=127.0.0.1 pruebas/consulta_cui_privada_test.ts
import assert from "node:assert/strict";
import { CONFIRMACION_CUI_PRIVADO, consultaCuiPrivada, presenciaCuiPrueba } from "../src/consulta_cui_privada.ts";

const USUARIO = "GT.000005888492.USUARIO_INVENTADO", CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", NIT = "5888492", CUI = "1234567891234", NOMBRE = "PERSONA INVENTADA DE PRUEBA", PROVEEDOR = "DETALLE-INTERNO-DEL-PROVEEDOR";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const envDe = (extra: Record<string, string> = {}) => { const m: Record<string, string> = { DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT, DIGIFACT_CUI_PRUEBA: CUI, DIGIFACT_CONFIRMAR: CONFIRMACION_CUI_PRIVADO, ...extra }; return (k: string) => (m[k] === "" ? undefined : m[k]); };
const SECRETOS = [USUARIO, CLAVE, NIT, CUI, NOMBRE, TOKEN, "firma-secreta", PROVEEDOR, "USUARIO_INVENTADO"];
type Modo = "ok" | "sin_coincidencia" | "cui_distinto" | "campo_raro" | "shared401" | "login401" | "http500" | "ilegible" | "tiempo";
function falso(modo: Modo = "ok") {
  const llamadas: { url: string; metodo: string }[] = [];
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); llamadas.push({ url: u, metodo: init?.method ?? "GET" });
    if (modo === "tiempo") return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    if (u.endsWith("/login/get_token")) return modo === "login401" ? json({ mensaje: PROVEEDOR }, 401) : json({ Token: TOKEN });
    if (u.includes("/Shared?")) {
      if (modo === "shared401") return json({ mensaje: PROVEEDOR }, 401); if (modo === "http500") return json({ mensaje: PROVEEDOR }, 500);
      if (modo === "ilegible") return new Response(`<html>${PROVEEDOR}</html>`, { status: 200 });
      return json({ RESPONSE: modo === "sin_coincidencia" ? [] : [modo === "campo_raro" ? { CUI, DATO_RARO: NOMBRE } : { CUI: modo === "cui_distinto" ? "9999999999999" : CUI, NOMBRE }] });
    }
    return json({ mensaje: "ruta no permitida" }, 404);
  }) as typeof fetch;
  return { fetchImpl, llamadas, consultas: () => llamadas.filter((l) => l.url.includes("/Shared?")).length, sesiones: () => llamadas.filter((l) => l.url.endsWith("/login/get_token")).length };
}
const sinSecretos = (r: unknown, donde: string) => { const t = JSON.stringify(r); for (const s of SECRETOS) assert.ok(!t.includes(s), `${donde}: la salida no debe contener «${s}»`); };

Deno.test("CUI privado: sin credenciales, sin CUI de prueba, sin confirmación, con entrada manual o con un CUI inválido NO se hace ninguna llamada", async () => {
  assert.equal(presenciaCuiPrueba(envDe()), true); assert.equal(presenciaCuiPrueba(envDe({ DIGIFACT_CUI_PRUEBA: "  " })), false);
  for (const [que, env, motivo] of [
    ["sin contraseña", envDe({ DIGIFACT_TEST_PASSWORD: "" }), "faltan_credenciales"], ["sin CUI de prueba", envDe({ DIGIFACT_CUI_PRUEBA: "" }), "falta_cui_de_prueba"],
    ["sin confirmación", envDe({ DIGIFACT_CONFIRMAR: "" }), "falta_confirmacion"], ["confirmación del NIT", envDe({ DIGIFACT_CONFIRMAR: "CONSULTAR-NIT-TEST" }), "falta_confirmacion"],
    ["dato escrito en la entrada", envDe({ DIGIFACT_NIT_CONSULTA: "1234567891234" }), "no_usar_entrada_manual"], ["CUI corto", envDe({ DIGIFACT_CUI_PRUEBA: "12345" }), "cui_de_prueba_no_valido"], ["CUI con letras", envDe({ DIGIFACT_CUI_PRUEBA: "123456789123A" }), "cui_de_prueba_no_valido"],
  ] as const) { const f = falso(); const r = await consultaCuiPrivada(env, { fetchImpl: f.fetchImpl }); assert.equal(r.consulta, "no_ejecutada", que); assert.equal(r.motivo, motivo, que); assert.equal(f.llamadas.length, 0, `${que}: ninguna llamada`); sinSecretos(r, que); }
});
Deno.test("CUI privado: una sesión y una consulta a TEST; la salida dice encontrado, coincide, que hubo nombre y los NOMBRES de los campos (nunca valores)", async () => {
  const f = falso(); const r = await consultaCuiPrivada(envDe(), { fetchImpl: f.fetchImpl });
  assert.deepEqual(r, { prueba: "consultar-cui-privado", ambiente: "TEST", credenciales: { usuario: true, clave: true, nit: true }, cuiPrueba: true, ok: true, consulta: "encontrado", coincide: true, nombrePresente: true, camposRespuesta: ["CUI", "NOMBRE"], llamadas: { inicioSesion: 1, consulta: 1 }, reintentoBloqueado: false });
  assert.equal(f.llamadas.length, 2); for (const l of f.llamadas) assert.ok(l.url.startsWith("https://testnucgt.digifact.com/api/"));
  const q = new URL(f.llamadas[1].url); assert.equal(q.searchParams.get("DATA1"), "SHARED_GETINFOCUI"); assert.equal(q.searchParams.get("DATA2"), `CUI|${CUI}`);
  assert.ok(!f.llamadas.some((l) => /transform|CancelFelGT|ncredtotal|GetDocument|gt\.com\.apinuc/.test(l.url))); sinSecretos(r, "resultado");
});
Deno.test("CUI privado: sin coincidencia, CUI distinto, campo de nombre desconocido: se informa sin mostrar nada y se ven los nombres de campo para entender la respuesta", async () => {
  const a = await consultaCuiPrivada(envDe(), { fetchImpl: falso("sin_coincidencia").fetchImpl }); assert.equal(a.consulta, "no_encontrado"); assert.equal(a.ok, true); assert.deepEqual(a.camposRespuesta, []); sinSecretos(a, "sin coincidencia");
  const b = await consultaCuiPrivada(envDe(), { fetchImpl: falso("cui_distinto").fetchImpl }); assert.equal(b.consulta, "no_encontrado", "una respuesta de otro CUI nunca cuenta como encontrada"); assert.deepEqual(b.camposRespuesta, ["CUI", "NOMBRE"]); sinSecretos(b, "otro CUI");
  const c = await consultaCuiPrivada(envDe(), { fetchImpl: falso("campo_raro").fetchImpl }); assert.equal(c.consulta, "no_encontrado"); assert.deepEqual(c.camposRespuesta, ["CUI", "DATO_RARO"], "se ve CÓMO viene la respuesta sin ver el dato"); sinSecretos(c, "campo raro");
});
Deno.test("CUI privado: sin reintentos ante 401, 500, respuesta ilegible, inicio de sesión rechazado o tiempo agotado; nada de texto del proveedor", async () => {
  for (const [modo, tipo] of [["shared401", undefined], ["login401", "autenticacion"], ["http500", "servidor"], ["ilegible", "respuesta_invalida"], ["tiempo", "tiempo_agotado"]] as const) {
    const f = falso(modo); const r = await consultaCuiPrivada(envDe(), { fetchImpl: f.fetchImpl, tiempoMaximoMs: modo === "tiempo" ? 60 : undefined });
    assert.equal(r.ok, false, modo); assert.equal(r.consulta, "error", modo); assert.ok(f.consultas() <= 1, modo); assert.ok(f.sesiones() <= 1, modo); if (tipo) assert.equal(r.errorTipo, tipo, modo);
    if (modo === "shared401") { assert.equal(r.reintentoBloqueado, true); assert.equal(f.sesiones(), 1, "no se renovó el token"); } sinSecretos(r, modo);
  }
});
Deno.test("CUI privado: la salida es solo banderas, contadores y nombres de campo; la consola del módulo permanece en silencio", async () => {
  const vistos: string[] = []; const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { vistos.push(a.join(" ")); };
  let casos; try { casos = [await consultaCuiPrivada(envDe(), { fetchImpl: falso().fetchImpl }), await consultaCuiPrivada(envDe(), { fetchImpl: falso("http500").fetchImpl }), await consultaCuiPrivada(envDe({ DIGIFACT_CONFIRMAR: "" }), { fetchImpl: falso().fetchImpl })]; } finally { Object.assign(console, orig); }
  assert.deepEqual(vistos, []);
  const PERMITIDAS = new Set(["prueba", "ambiente", "credenciales", "cuiPrueba", "ok", "consulta", "coincide", "nombrePresente", "camposRespuesta", "llamadas", "reintentoBloqueado", "motivo", "errorTipo", "estadoHttp"]);
  for (const r of casos) for (const [k, v] of Object.entries(r)) { assert.ok(PERMITIDAS.has(k), `propiedad inesperada «${k}»`); if (typeof v === "string") assert.match(v, /^[a-z_A-Z\-]{1,40}$/, `«${k}» debe ser un código corto`); }
});
