// ESTABLECIMIENTO ASIGNADO Y BLOQUEADO POR USUARIO en la API (función encendida mediante un lector de alcance inyectado; apagada por omisión): dos facturadores en dos establecimientos de la MISMA empresa, el titular con alcance total, y
// otra empresa. Peticiones manipuladas, aislamiento de documentos (lectura, modificación, certificación), listados, reasignación, concurrencia e idempotencia con un Digifact SIMULADO. Nada toca la red real.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO, EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import type { Alcance, LectorAlcance } from "../src/alcance_establecimientos.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, AUTORIZACION_CICLO, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", HUELLA = "0123456789abcdef";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

async function entorno(conAlcance: boolean) {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const e1 = mundo.establecimientos[0].id;
  const [e2f] = await bd.filas<{ id: string }>("select (public.fel_op_establecimiento_guardar($1, $2, null, '88', 'Sucursal 88', 'Dirección 88', 'activo')).id as id", [PERSONAS.ana.id, EMPRESA]); const e2 = e2f.id;
  const [esb] = await bd.filas<{ id: string }>("select id from public.establecimientos where empresa_id = $1 limit 1", [EMPRESA2]);
  const mapa: Record<string, Alcance | null> = {   // quién está asignado a qué (lo decide el administrador; en producción lo lee la base con la sesión validada)
    marta: { todos: false, multiples: false, ids: [e1], activo: e1 }, luis: { todos: false, multiples: false, ids: [e2], activo: e2 }, ana: { todos: true, multiples: false, ids: [], activo: null } };
  const alcance: LectorAlcance = async (_req, a) => mapa[a.clave] ?? null;
  let envios = 0; let seq = 0;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; await new Promise((r) => setTimeout(r, 20)); const n = ++seq; return ok({ code: "1", message: "Procesado Correctamente", authNumber: `AAAAAAAA-0000-4000-8000-${String(n).padStart(12, "0")}`, batch: "A001", serial: String(n), enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" }); }
    if (p.ruta.startsWith("/GetDocument")) return ok({ RESPONSE: [] });
    if (p.ruta.startsWith("/Shared")) return ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] });
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA || e === EMPRESA2 ? cliente : null), emisorDe: (e) => (e === EMPRESA || e === EMPRESA2 ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(),
    autorizaPrueba: () => AUTORIZACION_CICLO, prevueloDias: 0 });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc, ...(conAlcance ? { alcance } : {}) });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async ll(m: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t }; }
    async entrar() { assert.equal((await this.ll("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevo = async (c: Cli, extra: J = {}, cli = "") => { const est = (await c.ll("GET", "/api/estado")).json; const cf = est.clientes.find((x: J) => x.tipo_identificacion === "CF") ?? est.clientes[0]; return c.ll("POST", "/api/documentos", { cliente_id: cli || cf.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "100" }], fecha: hoy, ...extra }); };
  return { Cli, nuevo, bd, mapa, e1, e2, eb: esb.id, envios: () => envios, hoy };
}
const todo = (c: { ll: (m: string, r: string, b?: unknown) => Promise<{ status: number; json: J }> }, d: J) => c.ll("POST", `/api/documentos/${d.id}/digifact/certificar-todo`, { version: d.version, confirmacion: "CERTIFICAR-TEST" });

Deno.test({ name: "establecimiento por usuario (API): el servidor fija y bloquea el establecimiento, rechaza el ajeno, aísla lectura/modificación/certificación, filtra listados, respeta la reasignación y el historial; concurrencia e idempotencia", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(true);
  const marta = await new e.Cli("marta").entrar(), luis = await new e.Cli("luis").entrar(), ana = await new e.Cli("ana").entrar(), sofia = await new e.Cli("sofia").entrar();
  // 1) el documento nuevo nace en SU establecimiento sin elegirlo
  const dm = await e.nuevo(marta); assert.equal(dm.status, 200, dm.texto); const dl = await e.nuevo(luis); assert.equal(dl.status, 200, dl.texto);
  const estDe = async (id: string) => (await e.bd.filas<{ establecimiento_id: string }>("select establecimiento_id from public.documentos where id = $1", [id]))[0].establecimiento_id;
  assert.equal(await estDe(dm.json.documento.id), e.e1, "marta: su establecimiento"); assert.equal(await estDe(dl.json.documento.id), e.e2, "luis: el suyo");
  // 2) peticiones manipuladas: otro establecimiento (de su empresa o de otra) y campos de empresa/actor → rechazo, nunca cambio en silencio
  for (const est of [e.e2, e.eb]) { const r = await e.nuevo(marta, { establecimiento_id: est }); assert.equal(r.status, 403, `marta pide ${est}`); assert.equal(r.json.codigo, "establecimiento_no_autorizado"); }
  assert.equal((await e.nuevo(marta, { establecimiento_id: e.e1 })).status, 200, "pedir el suyo es válido");
  const manip = await e.nuevo(marta, { empresa_id: EMPRESA2, actor: PERSONAS.ana.id, p_actor: PERSONAS.ana.id }); assert.equal(manip.status, 200); assert.equal(await estDe(manip.json.documento.id), e.e1, "los campos de empresa/actor del cuerpo se ignoran");
  const ed = await marta.ll("POST", "/api/documentos", { id: dm.json.documento.id, version: dm.json.documento.version, cliente_id: dm.json.documento.cliente_id, establecimiento_id: e.e2, lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "100" }], fecha: e.hoy }); assert.equal(ed.status, 403, "editar pidiendo otro establecimiento se rechaza");
  assert.equal(await estDe(dm.json.documento.id), e.e1, "y no cambió");
  // 3) aislamiento de documentos entre establecimientos de la MISMA empresa (y de otra empresa)
  const idM = dm.json.documento.id, idL = dl.json.documento.id;
  for (const [quien, ajeno] of [[luis, idM], [marta, idL]] as const) {
    for (const [m, r, b] of [["GET", `/api/documentos/${ajeno}`], ["GET", `/api/documentos/${ajeno}/pdf-demo`], ["POST", `/api/documentos/${ajeno}/estado`, { estado: "revisado", version: 1 }], ["POST", `/api/documentos/${ajeno}/digifact/certificar-todo`, { version: 1, confirmacion: "CERTIFICAR-TEST" }], ["POST", `/api/documentos/${ajeno}/digifact/validar`, {}], ["GET", `/api/documentos/${ajeno}/digifact`]] as [string, string, unknown?][]) {
      const x = await quien.ll(m, r, b); assert.equal(x.status, 404, `${quien.usuario} ${m} ${r}: ${x.status} ${x.texto.slice(0, 120)}`); }
  }
  assert.equal(e.envios(), 0, "ningún intento ajeno envió nada");
  assert.equal((await ana.ll("GET", `/api/documentos/${idM}`)).status, 200); assert.equal((await ana.ll("GET", `/api/documentos/${idL}`)).status, 200, "el titular (alcance total) ve ambos");
  assert.notEqual((await sofia.ll("GET", `/api/documentos/${idM}`)).status, 200, "otra empresa no lo ve");
  // 4) listados: cada quien ve solo lo suyo (y los conteos también)
  const ids = async (c: J) => (await c.ll("GET", "/api/documentos?pagina=1&tam=50")).json.items.map((x: J) => x.id) as string[];
  const lm = await ids(marta), ll = await ids(luis), la = await ids(ana);
  assert.ok(lm.includes(idM) && !lm.includes(idL), "marta solo ve el 1"); assert.ok(ll.includes(idL) && !ll.includes(idM), "luis solo ve el 2"); assert.ok(la.includes(idM) && la.includes(idL), "ana ve ambos");
  // 5) concurrencia e idempotencia: establecimientos distintos a la vez sin mezclarse; el mismo documento dos veces = un envío
  const d2 = await e.nuevo(luis); const d3 = await e.nuevo(luis);
  const rs = await Promise.all([todo(ana, dm.json.documento), todo(luis, dl.json.documento), todo(luis, d2.json.documento), todo(luis, d2.json.documento)]);
  assert.equal(rs[0].status, 200, JSON.stringify(rs[0].json).slice(0, 200)); assert.equal(rs[1].status, 200); assert.equal(rs[2].status, 200);
  assert.equal(e.envios(), 3, "tres documentos distintos = tres envíos; el duplicado simultáneo no envía otro");
  void d3;
  // 6) reasignación: el historial no cambia; el nuevo alcance rige; el viejo documento deja de ser suyo
  e.mapa.marta = { todos: false, multiples: false, ids: [e.e2], activo: e.e2 };
  assert.equal((await marta.ll("GET", `/api/documentos/${idM}`)).status, 404, "tras la reasignación, el documento del 1 ya no es de marta");
  assert.ok(!(await ids(marta)).includes(idM), "ni aparece en su listado");
  assert.equal(await estDe(idM), e.e1, "el documento histórico conserva su establecimiento");
  const dm2 = await e.nuevo(marta); assert.equal(await estDe(dm2.json.documento.id), e.e2, "lo nuevo nace en el establecimiento nuevo");
  // 7) sin establecimiento asignado no se crea nada (falla cerrado)
  e.mapa.marta = { todos: false, multiples: false, ids: [], activo: null }; const sin = await e.nuevo(marta); assert.equal(sin.status, 403); assert.equal(sin.json.codigo, "sin_establecimiento");
  // 8) supervisor con permiso expreso: elige entre sus establecimientos asignados, no fuera de ellos
  e.mapa.marta = { todos: false, multiples: true, ids: [e.e1, e.e2], activo: e.e1 };
  assert.equal(await estDe((await e.nuevo(marta, { establecimiento_id: e.e2 })).json.documento.id), e.e2); assert.equal((await e.nuevo(marta, { establecimiento_id: e.eb })).status, 403);
  assert.ok((await ids(marta)).includes(idM), "el supervisor ve ambos establecimientos");
} });

Deno.test({ name: "establecimiento por usuario (API): APAGADO por omisión no cambia nada (el navegador puede elegir, como hoy)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(false); const marta = await new e.Cli("marta").entrar(), luis = await new e.Cli("luis").entrar();
  const d = await e.nuevo(marta, { establecimiento_id: e.e2 }); assert.equal(d.status, 200, d.texto);
  assert.equal((await luis.ll("GET", `/api/documentos/${d.json.documento.id}`)).status, 200, "sin la función, todos los de la empresa ven el documento (comportamiento actual)");
} });
