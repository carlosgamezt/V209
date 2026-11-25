// CONCURRENCIA de «certificar-todo»: varias personas de DOS empresas certifican a la vez sin bloqueo global (no entra en la sección crítica de simuladores) y sin certificaciones duplicadas; una ruta que sí usa simuladores sí entra (control).
// migración, la nota de crédito se prepara y se certifica una sola vez contra un Digifact SIMULADO (con su referencia al origen), y que NDEB, RECI y los pendientes siguen bloqueados; y que SIN la
// migración (estado actual) la NCRE sigue bloqueada. La pantalla recibe `certificacion_test` desde el servidor. Nada toca la red real.
// Uso: deno test -A tests/ncre_test_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { EMPRESA2 } from "../src/mundo_practico.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, AUTORIZACION_CICLO, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", HUELLA = "0123456789abcdef", AUT_ORIGEN = "62496FB5-75B4-4C75-83FA-DFBEF92DE92D", AUT_NOTA = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
type J = Record<string, any>; // deno-lint-ignore no-explicit-any


const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function entorno(retardoMs: number) {
  const real = await crearBd(); let transacciones = 0;
  // la base «parece» PostgreSQL real para que la sección crítica de simuladores esté ACTIVA; cuenta cuántas veces se entra en ella
  const bd = new Proxy(real, { get(t, k) { if (k === "tipo") return "pg"; if (k === "transaccion") return (fn: (tx: unknown) => Promise<unknown>) => { transacciones++; return fn({ filas: t.filas.bind(t), ejecutar: t.ejecutar.bind(t) }); }; const v = (t as unknown as Record<string, unknown>)[k as string]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v; } }) as typeof real;
  const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = []; let envios = 0; let enCurso = 0, maxEnCurso = 0;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; enCurso++; maxEnCurso = Math.max(maxEnCurso, enCurso); await dormir(retardoMs); enCurso--; return ok({ code: "1", message: "Procesado Correctamente", authNumber: crypto.randomUUID().toUpperCase(), batch: "BDE0DEC2", serial: String(envios), enrolledTimeStamp: "2026-11-25T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" }); }
    if (p.ruta.startsWith("/GetDocument")) return ok({ RESPONSE: [] });
    if (p.ruta.startsWith("/Shared")) return ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] });
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const dosEmpresas = (e: string) => e === EMPRESA || e === EMPRESA2;
  const svc = new ServicioFelGt({ clienteDe: (e) => (dosEmpresas(e) ? cliente : null), emisorDe: (e) => (dosEmpresas(e) ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => AUTORIZACION_CICLO,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevoDe = async (c: Cli) => {
    const est = (await c.llamar("GET", "/api/estado")).json, cf = est.clientes.find((x: J) => x.tipo_identificacion === "CF") ?? est.clientes[0], es = est.establecimientos[0]; assert.ok(cf && es, `${c.usuario}: tiene receptor y establecimiento`);
    const r = await c.llamar("POST", "/api/documentos", { cliente_id: cf.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "100" }], fecha: hoy }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.documento as J;
  };
  return { Cli, nuevoDe, llamadas, envios: () => envios, maxEnCurso: () => maxEnCurso, transacciones: () => transacciones };
}
const todo = (c: { llamar: (m: string, r: string, b?: unknown) => Promise<{ status: number; json: J }> }, d: J) => c.llamar("POST", `/api/documentos/${d.id}/digifact/certificar-todo`, { version: d.version, confirmacion: "CERTIFICAR-TEST" });

Deno.test({ name: "certificar-todo: personas de DOS empresas certifican a la vez sin bloqueo global; ni una certificación duplicada; la sección crítica de simuladores no se usa (y sí en una ruta que usa simuladores)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const RETARDO = 400, e = await entorno(RETARDO);
  const ana = await new e.Cli("ana").entrar(), sofia = await new e.Cli("sofia").entrar();
  const docs = [await e.nuevoDe(ana), await e.nuevoDe(ana), await e.nuevoDe(sofia), await e.nuevoDe(sofia)];
  const t0 = performance.now();
  // 4 documentos distintos de 2 empresas a la vez + una repetición simultánea del primero (duplicado)
  const rs = await Promise.all([todo(ana, docs[0]), todo(ana, docs[1]), todo(sofia, docs[2]), todo(sofia, docs[3]), todo(ana, docs[0])]);
  const ms = performance.now() - t0;
  assert.equal(e.envios(), 4, "exactamente un envío por documento (el duplicado simultáneo NO envió)");
  assert.equal(rs.filter((x) => x.status === 200 && x.json.operacion?.estado === "certificada").length, 4, JSON.stringify(rs.map((x) => [x.status, x.json.operacion?.estado ?? x.json.codigo])));
  assert.ok(e.maxEnCurso() >= 3, `las certificaciones se solapan (hasta ${e.maxEnCurso()} a la vez): no hay bloqueo global`); assert.ok(ms < RETARDO * 2.5, `4 certificaciones simultáneas tardaron ${Math.round(ms)} ms (< ${RETARDO * 2.5}): no se serializan`);
  assert.equal(e.transacciones(), 0, "«certificar-todo» no entra en la sección crítica de simuladores (sin bloqueo consultivo global)");
  // control: una ruta que SÍ usa simuladores entra en la sección crítica (la clasificación distingue las dos clases)
  const maestro = await new e.Cli("maestro").entrar(); await maestro.llamar("POST", "/api/demo/liberar-tardios", {}); await ana.llamar("POST", "/api/demo/liberar-tardios", {});
  assert.ok(e.transacciones() >= 1, "una ruta de simuladores sí entra en la sección crítica");
} });
