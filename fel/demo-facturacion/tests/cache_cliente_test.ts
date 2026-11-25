// Caché en memoria del cliente (web/js/api.js): solo lecturas de catálogo con TTL corto, atada a la sesión, vaciada al escribir/entrar/salir/cambiar de persona, con lecturas simultáneas
// compartidas, sin cachear documentos ni errores, y aislada de mutaciones. Sin navegador: fetch simulado.
// Uso: deno test -A tests/cache_cliente_test.ts
import assert from "node:assert/strict";

let n: Record<string, number> = {}; let respuestas: Record<string, () => Response | Promise<Response>> = {};
globalThis.fetch = (async (ruta: string | URL | Request, init?: RequestInit) => {
  const r = String(ruta); n[`${init?.method ?? "GET"} ${r}`] = (n[`${init?.method ?? "GET"} ${r}`] ?? 0) + 1;
  const f = respuestas[r]; return f ? await f() : new Response(JSON.stringify({ ruta: r, v: n[`${init?.method ?? "GET"} ${r}`] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const { llamar, vaciarCache, cambiarUsuario, estadisticasCache } = await import("../web/js/api.js");
const llamadas = (k: string) => n[k] ?? 0;
const reset = () => { n = {}; respuestas = {}; vaciarCache(); };

Deno.test("catálogos: la segunda lectura sale de la memoria; los documentos jamás se cachean", async () => {
  reset();
  const a = await llamar("GET", "/api/tipos-documento"), b = await llamar("GET", "/api/tipos-documento");
  assert.equal(llamadas("GET /api/tipos-documento"), 1); assert.deepEqual(a, b);
  await llamar("GET", "/api/documentos/abc"); await llamar("GET", "/api/documentos/abc"); await llamar("GET", "/api/documentos?pagina=1"); await llamar("GET", "/api/documentos?pagina=1");
  assert.equal(llamadas("GET /api/documentos/abc"), 2, "un documento se pide siempre al servidor"); assert.equal(llamadas("GET /api/documentos?pagina=1"), 2, "el historial no se cachea");
  await llamar("GET", "/api/estado"); await llamar("GET", "/api/estado"); assert.equal(llamadas("GET /api/estado"), 2, "lo que no está en la lista blanca no se cachea");
});
Deno.test("aislamiento: mutar lo recibido no envenena la caché", async () => {
  reset(); const a = await llamar("GET", "/api/tipos-documento") as { ruta: string }; a.ruta = "ENVENENADO"; const b = await llamar("GET", "/api/tipos-documento") as { ruta: string };
  assert.equal(b.ruta, "/api/tipos-documento");
});
Deno.test("lecturas simultáneas idénticas comparten una sola solicitud", async () => {
  reset(); const antes = estadisticasCache.compartidas;
  const [x, y, z] = await Promise.all([llamar("GET", "/api/estado"), llamar("GET", "/api/estado"), llamar("GET", "/api/estado")]);
  assert.equal(llamadas("GET /api/estado"), 1); assert.deepEqual(x, y); assert.deepEqual(y, z); assert.equal(estadisticasCache.compartidas - antes, 2);
  await llamar("GET", "/api/estado"); assert.equal(llamadas("GET /api/estado"), 2, "pasado el vuelo, la siguiente lectura vuelve al servidor (no hay TTL para /api/estado)");
});
Deno.test("una escritura de configuración, cliente o sesión vacía la caché; escribir un documento no", async () => {
  reset(); await llamar("GET", "/api/tipos-documento");
  await llamar("POST", "/api/documentos", { x: 1 }); await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 1, "guardar un documento no cambia los catálogos");
  await llamar("POST", "/api/tipos-documento", { tipo: "RECI" }); await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 2, "cambiar la configuración invalida");
  await llamar("POST", "/api/clientes", {}); await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 3);
  await llamar("POST", "/api/sesion/salir", {}); await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 4, "cerrar sesión vacía todo");
  await llamar("POST", "/api/sesion/entrar", {}); await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 5, "entrar vacía todo");
});
Deno.test("cambiar de persona o vencer la sesión vacía la caché", async () => {
  reset(); await llamar("GET", "/api/digifact/estado"); cambiarUsuario("marta"); await llamar("GET", "/api/digifact/estado"); assert.equal(llamadas("GET /api/digifact/estado"), 2);
  cambiarUsuario("ana"); await llamar("GET", "/api/digifact/estado"); assert.equal(llamadas("GET /api/digifact/estado"), 3, "la entrada de una persona no sirve a otra");
  vaciarCache(); await llamar("GET", "/api/digifact/estado"); assert.equal(llamadas("GET /api/digifact/estado"), 4);
});
Deno.test("los errores no se cachean y una respuesta que llega tras cerrar sesión no se guarda", async () => {
  reset(); respuestas["/api/tipos-documento"] = () => new Response(JSON.stringify({ mensaje: "x", codigo: "e" }), { status: 500, headers: { "content-type": "application/json" } });
  await assert.rejects(llamar("GET", "/api/tipos-documento")); delete respuestas["/api/tipos-documento"]; await llamar("GET", "/api/tipos-documento"); assert.equal(llamadas("GET /api/tipos-documento"), 2, "tras un error se vuelve a pedir");
  reset(); let soltar!: () => void; const pausa = new Promise<void>((ok) => { soltar = ok; });
  respuestas["/api/fecha-emision"] = async () => { await pausa; return new Response(JSON.stringify({ de: "sesion-vieja" }), { status: 200, headers: { "content-type": "application/json" } }); };
  const pendiente = llamar("GET", "/api/fecha-emision"); vaciarCache(); /* se cierra la sesión mientras la lectura vuela */ delete respuestas["/api/fecha-emision"]; soltar(); await pendiente;
  const nueva = await llamar("GET", "/api/fecha-emision") as { ruta?: string; de?: string }; assert.equal(nueva.de, undefined, "la respuesta de la sesión anterior no quedó guardada para la nueva");
  assert.equal(llamadas("GET /api/fecha-emision"), 2);
});
