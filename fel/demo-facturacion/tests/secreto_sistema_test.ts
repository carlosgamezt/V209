// Punto 8 · El secreto y la credencial de `nexa-sys` NO están al alcance de personas ni de clientes, y su interfaz tiene un alcance estrictamente limitado.
// (1) Guardas ESTÁTICAS: ni el grafo de importaciones de la función de cara al usuario, ni la web estática, ni los flujos de publicación del usuario nombran el secreto/la conexión de sistema.
// (2) Interfaz: solo `POST /tick` con secreto de ≥24 caracteres; cualquier otro método/ruta → 404; sin secreto → 401; sin configurar → 503; errores sin detalles; respuesta solo con conteos.
import assert from "node:assert/strict";
import { crearManejadorSistema, type ResultadoTick } from "../src/sistema.ts";
import type { BdDemo } from "../src/bd.ts";

const RAIZ = new URL("../", import.meta.url).pathname, REPO = new URL("../../../", import.meta.url).pathname;
const PROHIBIDO = /FEL_SYS_(BD_URL|SECRETO)|x-nexa-sys-secreto|ENSAYO_(CLAVE|URL)_(NEXA_)?SYS|nexa_sys\.[a-z<]/i;   // nombres de variables/cabeceras/usuario de la credencial de sistema
async function importaciones(archivo: string, vistos = new Set<string>()): Promise<Set<string>> {
  if (vistos.has(archivo)) return vistos;
  let t = ""; try { t = await Deno.readTextFile(archivo); } catch { return vistos; }
  vistos.add(archivo);
  for (const m of t.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.ts)["']/g)) await importaciones(new URL(m[1], "file://" + archivo).pathname, vistos);
  return vistos;
}
async function archivos(dir: string, ext: RegExp, acc: string[] = []): Promise<string[]> {
  try { for await (const e of Deno.readDir(dir)) { const p = dir + "/" + e.name; if (e.isDirectory) { if (!/node_modules|\.git$/.test(e.name)) await archivos(p, ext, acc); } else if (ext.test(e.name)) acc.push(p); } } catch { /* no existe */ }
  return acc;
}
const o = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "P8 estático: la función de cara al usuario (grafo de importaciones completo) no nombra el secreto ni la conexión de nexa-sys, ni importa el manejador de sistema", ...o, fn: async () => {
  const grafo = new Set<string>(); for (const e of ["nube/funcion.ts", "nube/funcion_entrada.ts", "nube/pages/worker.ts", "servidor.ts"]) await importaciones(RAIZ + e, grafo);
  assert.ok(grafo.size > 15, `grafo de importaciones cargado (${grafo.size})`);
  const malos: string[] = []; for (const f of grafo) { const t = await Deno.readTextFile(f); if (PROHIBIDO.test(t)) malos.push(f.replace(RAIZ, "")); if (/\.\/(?:nube\/)?sistema\.ts/.test(t) && !/sistema\.ts$/.test(f)) malos.push(`${f.replace(RAIZ, "")} importa sistema.ts`); }
  assert.deepEqual(malos, [], "la función de usuarios no debe conocer la credencial de sistema");
  assert.ok(![...grafo].some((f) => /\/(src|nube)\/sistema\.ts$/.test(f)), "sistema.ts no forma parte de la función de usuarios");
}});

Deno.test({ name: "P8 estático: la web estática y los flujos de publicación del usuario no contienen el secreto de sistema; solo `ensayo-1e` (manual, entorno protegido) usa la clave de nexa_sys", ...o, fn: async () => {
  const web = [...await archivos(RAIZ + "web", /\.(html|js|css|json|ts|webmanifest|txt)$/), ...await archivos(RAIZ + "nube/pages", /./)]; assert.ok(web.length > 0);
  for (const f of web) assert.ok(!PROHIBIDO.test(await Deno.readTextFile(f)), `web: ${f.replace(RAIZ, "")}`);
  const flujos = await archivos(REPO + ".github/workflows", /\.ya?ml$/); assert.ok(flujos.length >= 5, "flujos cargados");
  for (const f of flujos) { const t = await Deno.readTextFile(f), n = f.split("/").pop()!;
    if (n === "ensayo-1e.yml") { assert.match(t, /workflow_dispatch/); assert.ok(!/\n\s*(push|pull_request|schedule):/.test(t), "ensayo-1e solo se dispara a mano"); assert.match(t, /environment:\s*ensayo-1e/); continue; }
    assert.ok(!/FEL_SYS_|NEXA_SYS|nexa-sys-secreto/i.test(t), `${n}: no transporta la credencial ni el secreto de sistema`); }
  const publicar = await Deno.readTextFile(REPO + ".github/workflows/publicar-nube.yml"); assert.ok(!/nexa-sys/i.test(publicar), "publicar-nube.yml no despliega ni configura nexa-sys: va por su propio flujo en W5");
}});

Deno.test({ name: "P8 interfaz de nexa-sys: solo POST /tick con secreto; todo lo demás se rechaza; sin configurar no responde; la respuesta son conteos y el error no filtra nada", ...o, fn: async () => {
  const SEC = "secreto-de-sistema-para-pruebas-0123456789"; let llamadas = 0;
  const conteo: ResultadoTick = { ordenesVencidas: 0, bolsonRevisado: 0, operacionesPendientes: 0, fallidasManuales: 0, consumosIncoherentes: 0, saldosInconsistentes: 0, monederosInconsistentes: 0 };
  const bd = { rpc: async (fn: string) => { llamadas++; assert.match(fn, /^fel_sys_/, "el tick solo llama funciones fel_sys_*"); return []; } } as unknown as BdDemo;
  const h = crearManejadorSistema({ sys: () => bd, secreto: SEC });
  const pet = (m: string, ruta: string, cab: Record<string, string> = {}) => h(new Request("http://x" + ruta, { method: m, headers: cab }));
  // ruta y método: solo POST /tick (y su forma anclada bajo el prefijo de la función)
  for (const [m, r] of [["GET", "/tick"], ["PUT", "/tick"], ["DELETE", "/tick"], ["OPTIONS", "/tick"], ["POST", "/"], ["POST", "/otra"], ["POST", "/x/tick"], ["POST", "/tick/x"], ["POST", "/tick/../admin"], ["POST", "/ticks"]] as const)
    assert.equal((await pet(m, r, { "x-nexa-sys-secreto": SEC })).status, 404, `${m} ${r}`);
  assert.equal(llamadas, 0, "ninguna ruta ajena tocó la base");
  // secreto: ausente, vacío, parcial, distinto, en la URL o en otra cabecera → 401 sin tocar la base
  for (const cab of [{} as Record<string, string>, { "x-nexa-sys-secreto": "" }, { "x-nexa-sys-secreto": SEC.slice(0, -1) }, { "x-nexa-sys-secreto": SEC + "x" }, { authorization: `Bearer ${SEC}` }, { "x-secreto": SEC }]) assert.equal((await pet("POST", "/tick", cab)).status, 401);
  assert.equal((await h(new Request(`http://x/tick?secreto=${SEC}`, { method: "POST" }))).status, 401, "el secreto en la URL no vale");
  assert.equal(llamadas, 0);
  const ok = await pet("POST", "/tick", { "x-nexa-sys-secreto": SEC }); assert.equal(ok.status, 200); const j = await ok.json(); assert.deepEqual(Object.keys(j).sort(), Object.keys(conteo).sort(), "la respuesta son SOLO conteos"); assert.ok(Object.values(j).every((v) => typeof v === "number"));
  assert.equal((await pet("POST", "/nexa-sys/tick", { "x-nexa-sys-secreto": SEC })).status, 200); assert.equal((await pet("POST", "/functions/v1/nexa-sys/tick", { "x-nexa-sys-secreto": SEC })).status, 200);
  // sin configurar o con secreto corto: 503 (no se puede «adivinar» un secreto vacío)
  for (const s of [undefined, "", "corto-menos-de-24"]) { const x = await crearManejadorSistema({ sys: () => bd, secreto: s })(new Request("http://x/tick", { method: "POST", headers: { "x-nexa-sys-secreto": s ?? "" } })); assert.equal(x.status, 503); }
  // un fallo de la base no filtra la cadena de conexión ni el mensaje
  const roto = crearManejadorSistema({ sys: () => { throw new Error("postgres://nexa_sys.ref:CLAVE-SECRETA@host/postgres"); }, secreto: SEC });
  const e = await roto(new Request("http://x/tick", { method: "POST", headers: { "x-nexa-sys-secreto": SEC } })); assert.equal(e.status, 500); const t = await e.text(); assert.ok(!/CLAVE-SECRETA|postgres:|nexa_sys/.test(t), "el error no contiene detalles"); assert.deepEqual(JSON.parse(t), { codigo: "error" });
}});
