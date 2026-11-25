// Línea base de rendimiento del historial (servidor, PostgreSQL en memoria; sin red): lista completa (antes) frente a una página de 25 (después), con 100, 1,000 y 10,000 documentos ficticios.
// Mide tiempo p50/p95 de la consulta + serialización y bytes transferidos. NO mide red ni navegador. Uso: deno run -A tests/bench_lista.ts
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";

const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
const api = crearApi(bd, mundo, { sesiones, practico: true });
let cookie = "";
const llamar = async (m: string, ruta: string, cuerpo?: unknown) => { const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return await r.text(); };
await llamar("POST", "/api/sesion/entrar", { usuario: "ana", clave: CLAVE_DEMO });
const est = JSON.parse(await llamar("GET", "/api/estado")); const cli = est.clientes[0], es = est.establecimientos[0];
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const id0 = JSON.parse(await llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "S", cantidad: "1", precio_unitario: "10" }], fecha: hoy })).documento.id;
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const medir = async (ruta: string, n = 15) => { const t: number[] = []; let bytes = 0; for (let i = 0; i < n; i++) { const a = performance.now(); const cuerpo = await llamar("GET", ruta); t.push(performance.now() - a); bytes = new TextEncoder().encode(cuerpo).length; } return { p50: pct(t, 0.5), p95: pct(t, 0.95), kb: bytes / 1024 }; };
let base = 0; const tam = [100, 1000, 10000]; let actual = (await bd.filas<{ n: number }>("select count(*)::int n from public.documentos"))[0].n;
console.log("| documentos | consulta | p50 ms | p95 ms | KB transferidos |\n|---|---|---|---|---|");
for (const n of tam) {
  // clona el documento base (sin pasar por la API) hasta llegar a n
  await bd.ejecutar("select set_config('fel.op_fiscal', 'on', false)");
  await bd.ejecutar(`insert into public.documentos (id, numero_borrador, empresa_id, establecimiento_id, cliente_id, estado_preparacion, estado_fiscal, fecha_emision_prevista, subtotal, descuento_total, total, base_imponible, moneda, creado_por, actualizado_por)
    select gen_random_uuid(), 1000000 + g, empresa_id, establecimiento_id, cliente_id, 'borrador', 'ninguno', fecha_emision_prevista, subtotal, descuento_total, total, base_imponible, moneda, creado_por, actualizado_por from public.documentos d, generate_series($3::int + 1, $3::int + $2::int) g where d.id = $1`, [id0, n - actual, base]).catch((e) => { console.error("clonado:", String(e).slice(0, 300)); Deno.exit(1); });
  base += n - actual; actual = (await bd.filas<{ n: number }>("select count(*)::int n from public.documentos"))[0].n;
  const a = await medir("/api/documentos", n >= 10000 ? 5 : 12), b = await medir("/api/documentos?pagina=1&tam=25&categoria=borradores"), c = await medir("/api/documentos?pagina=1&tam=25&categoria=emitidos&q=SERIE");
  const f = (x: { p50: number; p95: number; kb: number }) => `${x.p50.toFixed(0)} | ${x.p95.toFixed(0)} | ${x.kb.toFixed(1)}`;
  console.log(`| ${actual} | lista completa (antes) | ${f(a)} |\n| ${actual} | página de 25 (después) | ${f(b)} |\n| ${actual} | página de 25 con búsqueda | ${f(c)} |`);
}
Deno.exit(0);
