// Supervisor de órdenes: ciclos periódicos sin solapamiento, errores visibles en la salud, intervalo validado y cierre ordenado. Con un RPC falso (sin base de datos).
import assert from "node:assert/strict";
import { crearSupervisor } from "../src/supervisor_ordenes.ts";
import type { Rpc } from "../src/rpc.ts";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = (n: string, f: () => Promise<void>) => Deno.test({ name: `supervisor: ${n}`, sanitizeOps: false, sanitizeResources: false, fn: f });

T("el intervalo se valida (mínimo, máximo y enteros)", async () => {
  for (const mal of [0, 10, 49, 3_600_001, 1.5, NaN]) assert.throws(() => crearSupervisor({ rpc: (() => Promise.resolve(0)) as Rpc, intervaloMs: mal }), /no válido/, String(mal));
});
T("ejecuta ciclos por sí solo, aplica los vencimientos y el cierre, y acumula lo vencido", async () => {
  const llamadas: string[] = []; let cierres = 0;
  const rpc: Rpc = (fn) => { llamadas.push(fn); return Promise.resolve(2); };
  const s = crearSupervisor({ rpc, cerrar: () => { cierres++; return Promise.resolve(); }, intervaloMs: 50 });
  assert.equal(s.salud().en_marcha, false); s.iniciar(); await dormir(260); await s.detener();
  const h = s.salud(); assert.ok(h.ciclos >= 3, `ciclos: ${h.ciclos}`); assert.equal(h.vencidas_total, h.ciclos * 2); assert.equal(cierres, h.ciclos); assert.ok(llamadas.every((f) => f === "fel_sys_ordenes_vencer"));
});
T("los ciclos no se solapan aunque uno tarde más que el intervalo", async () => {
  let activos = 0, maximo = 0;
  const rpc: Rpc = async () => { activos++; maximo = Math.max(maximo, activos); await dormir(120); activos--; return 0; };
  const s = crearSupervisor({ rpc, intervaloMs: 50 }); s.iniciar(); await dormir(450); await s.detener(); assert.equal(maximo, 1);
});
T("un error se cuenta, se muestra en la salud (sin detalles internos) y se recupera solo", async () => {
  let fallar = true; const rpc: Rpc = () => fallar ? Promise.reject(Object.assign(new Error("password=secreto host=interno"), { codigo: "BD" })) : Promise.resolve(0);
  const s = crearSupervisor({ rpc, intervaloMs: 50 }); s.iniciar(); await dormir(200);
  let h = s.salud(); assert.equal(h.ok, false); assert.ok(h.errores_consecutivos >= 2); assert.equal(h.ultimo_error, "BD"); assert.doesNotMatch(JSON.stringify(h), /secreto|interno/, "la salud no filtra el mensaje del error");
  fallar = false; await dormir(200); h = s.salud(); assert.equal(h.ok, true); assert.equal(h.errores_consecutivos, 0); assert.equal(h.ultimo_error, null); await s.detener();
});
T("cierre ordenado: espera al ciclo en curso, no empieza ciclos nuevos y es idempotente; detenido ⇒ salud no ok", async () => {
  let terminado = false, llamadas = 0; const rpc: Rpc = async () => { llamadas++; await dormir(150); terminado = true; return 0; };
  const s = crearSupervisor({ rpc, intervaloMs: 50 }); s.iniciar(); await dormir(30);
  await s.detener(); assert.equal(terminado, true, "esperó al ciclo en curso"); const n = llamadas;
  await dormir(250); assert.equal(llamadas, n, "no hay ciclos después de detener"); await s.detener(); assert.equal(s.salud().en_marcha, false); assert.equal(s.salud().ok, false);
  s.iniciar(); await dormir(120); assert.equal(llamadas, n, "un supervisor detenido no se reinicia");
});
T("salud: tres intervalos sin ciclo se marcan como atrasado", async () => {
  let t = 1_000_000; const rpc: Rpc = () => Promise.resolve(0);
  const s = crearSupervisor({ rpc, intervaloMs: 100, ahora: () => new Date(t) }); s.iniciar(); await dormir(60);
  assert.equal(s.salud().atrasado, false); t += 100 * 3 + 1; assert.equal(s.salud().atrasado, true); assert.equal(s.salud().ok, false); await s.detener();
});
