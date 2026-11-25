// MEDICIÓN DE RENDIMIENTO de la demostración PUBLICADA (la ejecuta quien despliega junto con la prueba de Digifact TEST, solo con «digifact_prueba=habilitado»):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…' deno run -A nube/medir_rendimiento.ts
// Cronometra, desde fuera y contra la infraestructura real (Cloudflare → Supabase → PostgreSQL → Digifact TEST): archivos estáticos, lecturas de la API y el ciclo completo guardar → revisar → preparar →
// certificar → leer, repetido 3 veces. De cada respuesta lee la cabecera Server-Timing (solo números: tiempo total en la función, consultas a la base y su tiempo, llamadas a Digifact, arranque en frío).
// Los documentos son de PRUEBA (Digifact TEST, sin valor fiscal). No imprime contraseñas, tokens ni cookies.
import { JarraCookies } from "./jarra_cookies.ts";
const url = (Deno.env.get("FEL_DEMO_URL") ?? "").replace(/\/$/, ""); if (!url) { console.error("Falta FEL_DEMO_URL."); Deno.exit(1); }
const claves = Object.fromEntries((Deno.env.get("FEL_DEMO_CLAVES") ?? "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; }));
if (!claves.ana) { console.error("Falta la contraseña de «ana» en FEL_DEMO_CLAVES."); Deno.exit(1); }
type J = Record<string, any>; // deno-lint-ignore no-explicit-any
const jarra = new JarraCookies();
interface Medida { ms: number; fn?: number; db?: number; n?: number; dfxToken?: number; dfxEnvio?: number; dfxOtro?: number; arranque?: number; status: number; json: J }
const num = (s: string, k: string) => { const m = new RegExp(`${k};dur=([\\d.]+)`).exec(s); return m ? Number(m[1]) : undefined; };
async function ll(m: string, ruta: string, cuerpo?: unknown): Promise<Medida> {
  const t0 = performance.now();
  const r = await fetch(url + ruta, { method: m, redirect: "manual", headers: { "x-demo": "1", "content-type": "application/json", ...(jarra.cabecera() ? { cookie: jarra.cabecera() } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  jarra.guardar(r.headers.getSetCookie()); const t = await r.text(), ms = performance.now() - t0; let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ }
  const st = r.headers.get("server-timing") ?? ""; const n = /(\d+) consultas/.exec(st);
  return { ms, status: r.status, json, fn: num(st, "fn"), db: num(st, "db"), n: n ? Number(n[1]) : undefined, dfxToken: num(st, "dfx_token"), dfxEnvio: num(st, "dfx_envio"), dfxOtro: num(st, "dfx_otro"), arranque: num(st, "arranque") };
}
const f = (x?: number) => (x === undefined ? "–" : String(Math.round(x)));
const fila = (nombre: string, a: Medida) => `| ${nombre.padEnd(34)} | ${f(a.ms).padStart(6)} | ${f(a.fn).padStart(6)} | ${f(a.db).padStart(6)} | ${String(a.n ?? "–").padStart(4)} | ${f(a.dfxToken).padStart(6)} | ${f(a.dfxEnvio).padStart(6)} | ${f(a.dfxOtro).padStart(6)} | ${f(a.arranque).padStart(6)} | ${a.status} |`;
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log("\n== MEDICIÓN DE RENDIMIENTO (publicada) · tiempos en ms · «total» = visto desde el cliente; «fn» = dentro de la función; «db» = tiempo y N° de consultas a la base ==");
console.log(`| ${"llamada".padEnd(34)} | total  | fn     | db     | N°db | dfxTok | dfxEnv | dfxOtr | arranq | HTTP |`); console.log("|" + "-".repeat(36) + "|--------|--------|--------|------|--------|--------|--------|--------|------|");

// ---- estáticos (Cloudflare Pages): 3 pidas cada uno
for (const ruta of ["/", "/web/js/main.js", "/web/js/factura.js", "/web/js/proceso.js"]) {
  const v: number[] = []; let tam = 0; for (let i = 0; i < 3; i++) { const t0 = performance.now(); const r = await fetch(url + ruta, { redirect: "manual" }); const b = await r.arrayBuffer(); v.push(performance.now() - t0); tam = b.byteLength; }
  console.log(`| ${("GET " + ruta).padEnd(34)} | ${f(mediana(v)).padStart(6)} | (estático, mediana de 3, ${(tam / 1024).toFixed(0)} KB; mín ${f(Math.min(...v))}, máx ${f(Math.max(...v))})`);
}
// ---- sesión
const ent = await ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana }); console.log(fila("POST /api/sesion/entrar (login)", ent)); if (ent.status !== 200) { console.error("No se pudo iniciar sesión."); Deno.exit(1); }
// ---- diagnóstico de la conexión función → base (solo números y regiones)
{ const d = await ll("GET", "/api/diag/latencia"); console.log(`diag latencia: HTTP ${d.status}${d.status === 200 ? ` · select 1 ×4 dentro de la función (ms): ${JSON.stringify(d.json.selectUnoMs)} · región de la función: ${d.json.regionFuncion} · región de la base: ${d.json.regionBd} · puerto ${d.json.puertoBd}` : " (no disponible en esta versión)"} · total visto ${f(d.ms)} ms`); }
// ---- lecturas (3 veces cada una; se muestra la mediana por columna y la primera, que puede incluir arranque en frío)
const lecturas: [string, string][] = [["GET /api/sesion", "/api/sesion"], ["GET /api/estado", "/api/estado"], ["GET /api/documentos (lista)", "/api/documentos?pagina=1&tam=25&categoria=emitidos"], ["GET /api/tipos-documento", "/api/tipos-documento"], ["GET /api/digifact/estado", "/api/digifact/estado"], ["GET /api/fecha-emision", "/api/fecha-emision"]];
let est: J = {};
for (const [nombre, ruta] of lecturas) {
  const ms: Medida[] = []; for (let i = 0; i < 3; i++) ms.push(await ll("GET", ruta)); if (ruta === "/api/estado") est = ms[0].json;
  const med = (g: (x: Medida) => number | undefined) => mediana(ms.map(g).filter((x): x is number => x !== undefined) as number[]);
  console.log(fila(nombre + " (mediana de 3)", { ms: med((x) => x.ms), fn: med((x) => x.fn), db: med((x) => x.db), n: ms[0].n, status: ms[0].status, json: {} }));
}
// ---- ciclo completo ×3
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const cliente = (est.clientes ?? []).find((c: J) => c.tipo_identificacion === "NIT") ?? (est.clientes ?? [])[0], estab = (est.establecimientos ?? [])[0];
if (!cliente || !estab) { console.error("Sin cliente o establecimiento para la prueba."); Deno.exit(1); }
const totales: number[] = [], dfxs: number[] = [];
for (let i = 1; i <= 3; i++) {
  console.log(`-- ciclo ${i} --`); let acum = 0, dfxEnv = 0, dfxTok = 0;
  const reg = (nombre: string, m: Medida) => { console.log(fila(nombre, m)); acum += m.ms; dfxEnv += m.dfxEnvio ?? 0; dfxTok += m.dfxToken ?? 0; };
  const d = await ll("POST", "/api/documentos", { cliente_id: cliente.id, establecimiento_id: estab.id, fecha: hoy, observaciones: `MEDICIÓN RENDIMIENTO ${i}`, lineas: [{ descripcion: "Servicio de prueba de medición", cantidad: "1", precio_unitario: "100" }] }); reg("POST /api/documentos (guardar)", d); if (d.status !== 200) { console.error("No se pudo guardar el borrador."); Deno.exit(1); }
  const id = d.json.documento.id as string;
  reg("POST …/estado (revisado)", await ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version }));
  const prep = await ll("POST", `/api/documentos/${id}/digifact/preparar`, {}); reg("POST …/digifact/preparar", prep);
  const cer = await ll("POST", `/api/documentos/${id}/digifact/certificar`, { operacionId: prep.json.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: prep.json.referencia, huellaEmisor: prep.json.huellaEmisor }); reg("POST …/digifact/certificar", cer);
  console.log(`      certificar: estado ${cer.json.operacion?.estado ?? "?"}, tiempo de Digifact medido por la función ${cer.json.tiempoDigifactMs ?? "–"} ms (de ello, chequeo previo ${cer.json.prevueloMs ?? "–"} ms), documento_actualizado ${cer.json.documento_actualizado ? "sí" : "no"}`);
  if (!cer.json.documento_actualizado) reg("GET /api/documentos/:id (recarga)", await ll("GET", `/api/documentos/${id}`));
  const dfx = Number(cer.json.tiempoDigifactMs ?? dfxEnv + dfxTok); totales.push(acum); dfxs.push(dfx);
  console.log(`      CICLO ${i}: total ${f(acum)} ms · Digifact ${f(dfx)} ms · atribuible a NEXA/red ${f(acum - dfx)} ms`);
}
console.log(`\nRESUMEN (3 ciclos): total mediana ${f(mediana(totales))} ms (mín ${f(Math.min(...totales))}, máx ${f(Math.max(...totales))}) · Digifact mediana ${f(mediana(dfxs))} ms · NEXA/red ${f(mediana(totales) - mediana(dfxs))} ms`);
