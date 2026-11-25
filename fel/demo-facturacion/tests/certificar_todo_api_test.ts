// «Certificar en TEST» en UNA petición (revisar + preparar + certificar): mismos controles, una sola vez, sin reenvíos.
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
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, AUTORIZACION_CICLO, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", HUELLA = "0123456789abcdef", AUT_ORIGEN = "62496FB5-75B4-4C75-83FA-DFBEF92DE92D", AUT_NOTA = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

async function entorno(opc: { certificar?: () => RespuestaHttp; reporte?: () => RespuestaHttp } = {}) {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = []; let envios = 0;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; if (opc.certificar) return opc.certificar(); return ok({ code: "1", message: "Procesado Correctamente", authNumber: AUT_NOTA, batch: "BDE0DEC2", serial: "5", enrolledTimeStamp: "2026-11-25T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" }); }
    if (p.ruta.startsWith("/GetDocument")) return ok({ RESPONSE: [] });
    if (p.ruta.startsWith("/Shared")) return opc.reporte ? opc.reporte() : ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] });
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => AUTORIZACION_CICLO,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar(), pedro = await new Cli("pedro").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cf = est.clientes.find((c: J) => c.tipo_identificacion === "CF") ?? est.clientes[0], es = est.establecimientos[0];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevo = async () => { const r = await ana.llamar("POST", "/api/documentos", { cliente_id: cf.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "100" }], fecha: hoy }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.documento as J; };
  return { ana, pedro, bd, llamadas, envios: () => envios, nuevo };
}
const CONF = { confirmacion: "CERTIFICAR-TEST" };
const certTodo = (c: { llamar: (m: string, r: string, b?: unknown) => Promise<{ status: number; json: J }> }, d: J, extra: J = {}) => c.llamar("POST", `/api/documentos/${d.id}/digifact/certificar-todo`, { version: d.version, ...CONF, ...extra });

Deno.test("certificar-todo: revisa, prepara y certifica en UNA petición; UNA sola vez; repetir no reenvía; sin confirmación no sale nada; un lector no puede", async () => {
  const e = await entorno(); const d = await e.nuevo();
  const sin = await certTodo(e.ana, d, { confirmacion: "otra cosa" }); assert.ok(sin.status >= 400 || sin.json.error || sin.json.codigo, JSON.stringify(sin.json)); assert.equal(e.envios(), 0, "sin la confirmación explícita no se envía nada");
  const d2 = await e.nuevo(); const lector = await certTodo(e.pedro, d2); assert.ok(lector.status === 403 || lector.status === 401 || lector.status === 422, `lector: ${lector.status} ${JSON.stringify(lector.json).slice(0, 120)}`); assert.equal(e.envios(), 0);
  const r = await certTodo(e.ana, d); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.operacion.estado, "certificada"); assert.equal(e.envios(), 1); assert.ok(r.json.documento_actualizado?.documento?.id === d.id, "devuelve el documento actualizado");
  const otra = await certTodo(e.ana, { ...d, version: r.json.documento_actualizado.documento.version }); assert.ok(otra.status >= 400, "repetir una certificación ya hecha se rechaza"); assert.equal(e.envios(), 1, "NO se reenvía");
});

Deno.test("certificar-todo: tres peticiones simultáneas del mismo documento envían UNA sola vez", async () => {
  const e = await entorno(); const d = await e.nuevo();
  const rs = await Promise.all([certTodo(e.ana, d), certTodo(e.ana, d), certTodo(e.ana, d)]);
  assert.equal(e.envios(), 1, "un solo NUC enviado"); assert.equal(rs.filter((x) => x.status === 200 && x.json.operacion?.estado === "certificada").length, 1, "una sola certificación exitosa");
});

Deno.test("certificar-todo: resultado incierto (corte tras enviar) → «desconocida»; repetir NO reenvía; con duda en el chequeo previo no se envía nada", async () => {
  const u = await entorno({ certificar: () => { throw new Error("corte"); } }); const d = await u.nuevo();
  const r = await certTodo(u.ana, d); assert.equal(r.status, 200); assert.equal(r.json.operacion.estado, "desconocida"); assert.equal(u.envios(), 1);
  const dv = (await u.ana.llamar("GET", `/api/documentos/${d.id}`)).json.documento; const otra = await certTodo(u.ana, dv); assert.ok(otra.status >= 400); assert.equal(u.envios(), 1, "repetir NO reenvía (solo se concilia)");
  const q = await entorno({ reporte: () => ok({}, 500) }); const dq = await q.nuevo(); const rq = await certTodo(q.ana, dq); assert.ok(rq.status >= 400 || rq.json.codigo, JSON.stringify(rq.json).slice(0, 160)); assert.equal(q.envios(), 0, "chequeo previo dudoso: no se envía");
});

Deno.test("certificar-todo: pide a Digifact solo el XML cuando se indica (el PDF de Digifact se recupera al descargarlo) y por defecto XML y PDF", async () => {
  const e = await entorno(); const d1 = await e.nuevo(), d2 = await e.nuevo();
  await certTodo(e.ana, d1, { formatos: ["XML"] }); await certTodo(e.ana, d2);
  const envio = e.llamadas.filter((l) => l.ruta.startsWith("/v2/transform/nuc_json")).map((l) => decodeURIComponent(l.ruta));
  assert.equal(envio.length, 2); assert.match(envio[0], /FORMAT=XML(&|$)/); assert.match(envio[1], /FORMAT=XML\|PDF/);
});
