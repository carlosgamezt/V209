// Digifact TEST a través de la API REAL de la demostración (en el mismo proceso, PostgreSQL real en memoria con las migraciones del proyecto).
// El cliente de Digifact es el REAL con un transporte SIMULADO: ninguna prueba toca la red ni usa credenciales reales.
// Uso: deno test -A tests/digifact_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO, EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { crearDigifactDesdeEntorno } from "../src/digifact_entorno.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", HUELLA = "0123456789abcdef";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
const XML_REAL = `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento><dte:NumeroAutorizacion Numero="5" Serie="A001">${AUT}</dte:NumeroAutorizacion></dte:GTDocumento>`, PDF_REAL = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "Digifact TEST por la API: permisos, aislamiento entre empresas, un solo envío y nada de secretos", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  // servicio con cliente REAL de Digifact y transporte simulado; SOLO la empresa 1 tiene canal
  const llamadas: PeticionHttp[] = []; let autorizada: string | null = null; const salidaCruda: string[] = [];
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) return ok({ code: "1", message: "Procesado Correctamente", authNumber: AUT, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: btoa(XML_REAL), responseData3: btoa(PDF_REAL) });
    if (p.ruta.startsWith("/Shared")) return ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA DE PRUEBA, S.A." }] });
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const emisor = { emisor: facturaPrueba().emisor, huella: HUELLA };
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? emisor : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => autorizada,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  const sinDigifact = crearApi(bd, mundo, { sesiones, practico: true });

  class Cli { cookie = ""; constructor(public usuario: string, public h = api) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = { "x-demo": "1" }) {
      const r = await this.h(new Request("http://127.0.0.1" + ruta, { method: m, headers: { ...cab, "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      const t = await r.text(); salidaCruda.push(t); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ }
      return { status: r.status, json };
    }
    async entrar() { const r = await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO }); assert.equal(r.status, 200, `login ${this.usuario}`); return this; } }
  const ana = await new Cli("ana").entrar(), marta = await new Cli("marta").entrar(), pedro = await new Cli("pedro").entrar(), sofia = await new Cli("sofia").entrar(), anon = new Cli("ana");

  // ---- 0. sin el servicio habilitado, las rutas existen pero responden «no habilitado» y nada sale
  const sd = await new Cli("ana", sinDigifact).entrar();
  assert.deepEqual((await sd.llamar("GET", "/api/digifact/estado")).json.habilitado, false);
  assert.equal((await sd.llamar("POST", "/api/digifact/nit", { nit: "44653948" })).status, 503);
  assert.equal(llamadas.length, 0);

  // ---- documento revisado de la empresa 1
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT"), es = est.establecimientos[0];
  const d = await marta.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Supervisión de obra", cantidad: "2", precio_unitario: "500" }], fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()) }); assert.equal(d.status, 200, JSON.stringify(d.json));
  const docId = d.json.documento.id as string;
  assert.equal((await ana.llamar("POST", `/api/documentos/${docId}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200);
  const R = (id: string, x: string) => `/api/documentos/${id}/digifact${x}`;

  // ---- 1. sesión obligatoria y cabecera de la demostración
  assert.equal((await anon.llamar("GET", "/api/digifact/estado")).status, 401); assert.equal((await anon.llamar("POST", "/api/digifact/nit", { nit: "44653948" })).status, 401);
  assert.equal((await ana.llamar("POST", "/api/digifact/nit", { nit: "44653948" }, {})).status, 403, "sin la cabecera de la demostración no se acepta (anti-CSRF)");
  const e0 = (await ana.llamar("GET", "/api/digifact/estado")).json; assert.equal(e0.habilitado, true); assert.equal(e0.produccion, "bloqueada"); assert.equal(e0.anulacion, "cerrada");
  assert.equal(llamadas.length, 0, "ninguna de las pruebas anteriores salió hacia Digifact");

  // ---- 2. consulta de NIT: desde el servidor, con permiso
  const nit = await ana.llamar("POST", "/api/digifact/nit", { nit: "44653948" }); assert.equal(nit.status, 200); assert.deepEqual(nit.json, { encontrado: true, nit: "44653948", nombre: "EMPRESA DE PRUEBA, S.A." });
  assert.equal((await ana.llamar("POST", "/api/digifact/nit", { nit: "44-65" })).status, 400);

  // ---- 3. permisos: el lector no prepara ni certifica; quien no tiene «fiscal.certificar» tampoco
  const v = await ana.llamar("POST", R(docId, "/validar"), {}); assert.equal(v.status, 200, JSON.stringify(v.json)); assert.equal(v.json.ok, true, JSON.stringify(v.json.errores)); assert.equal(v.json.total, "1000.000000");
  assert.equal((await pedro.llamar("POST", R(docId, "/preparar"), {})).status, 403); assert.equal((await pedro.llamar("POST", R(docId, "/certificar"), { operacionId: "x" })).status, 403);
  const permMarta = (await marta.llamar("GET", "/api/estado")).json.permisos as string[];
  if (!permMarta.includes("fiscal.certificar")) assert.equal((await marta.llamar("POST", R(docId, "/preparar"), {})).status, 403, "la emisora no certifica");

  // ---- 4. aislamiento multiempresa: la empresa 2 no ve, no valida, no prepara, no certifica ni consulta NIT con el canal de la 1
  assert.equal((await sofia.llamar("POST", "/api/digifact/nit", { nit: "44653948" })).status, 422, "la empresa 2 no tiene canal: nada sale");
  assert.equal((await sofia.llamar("POST", R(docId, "/validar"), {})).status, 404, "el documento de la empresa 1 no existe para la 2");
  assert.equal((await sofia.llamar("POST", R(docId, "/preparar"), {})).status, 404);
  assert.deepEqual((await sofia.llamar("GET", R(docId, ""))).json.operaciones, []);
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/")).length, 0);

  // ---- 5. preparar, y que certificar sin cada garantía no envíe nada
  const p = await ana.llamar("POST", R(docId, "/preparar"), {}); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(p.json.total, "1000.000000"); assert.match(p.json.aviso, /NO se envió/);
  assert.equal((await ana.llamar("POST", R(docId, "/preparar"), {})).json.operacionId, p.json.operacionId, "preparar es idempotente");
  const c = { operacionId: p.json.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.json.referencia, huellaEmisor: p.json.huellaEmisor };
  assert.equal((await sofia.llamar("POST", R(docId, "/certificar"), c)).status, 404, "otra empresa no puede usar la operación preparada");
  assert.equal((await ana.llamar("POST", R(docId, "/certificar"), { ...c, confirmacion: "si" })).status, 400);
  const sinAut = await ana.llamar("POST", R(docId, "/certificar"), c); assert.equal(sinAut.status, 403); assert.equal(sinAut.json.codigo, "prueba_no_autorizada");
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/")).length, 0, "sin autorización de la prueba no sale nada");

  // ---- 6. con todo en regla: UN envío; repetir (o doble clic simultáneo) no reenvía
  autorizada = p.json.referencia;
  const [r1, r2, r3] = await Promise.all([ana.llamar("POST", R(docId, "/certificar"), c), ana.llamar("POST", R(docId, "/certificar"), c), ana.llamar("POST", R(docId, "/certificar"), c)]);
  assert.deepEqual([r1.status, r2.status, r3.status], [200, 200, 200]);
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/transform/nuc_json")).length, 1, "un solo envío aunque el botón se pulse varias veces a la vez");
  const fin = (await ana.llamar("GET", R(docId, ""))).json.operaciones as J[]; assert.equal(fin.length, 1); assert.equal(fin[0].estado, "certificada"); assert.equal(fin[0].resultado.autorizacion, AUT);
  assert.equal((await ana.llamar("POST", R(docId, "/certificar"), c)).json.reutilizada, true);
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/transform/nuc_json")).length, 1);
  assert.deepEqual((await sofia.llamar("GET", R(docId, ""))).json.operaciones, [], "la 2 sigue sin ver nada");

  // ---- 6b. el documento queda certificado con los datos del certificador y sus archivos REALES se descargan con sesión, permiso y empresa
  const bajar = async (u: Cli, tipo: string) => { const r = await api(new Request(`http://127.0.0.1${R(docId, "/" + tipo)}`, { headers: { "x-demo": "1", ...(u.cookie ? { cookie: u.cookie } : {}) } })); return { r, bytes: new Uint8Array(await r.arrayBuffer()) }; };
  const x = await bajar(ana, "xml"); assert.equal(x.r.status, 200); assert.equal(x.r.headers.get("content-type"), "application/xml"); assert.equal(x.r.headers.get("content-disposition"), 'attachment; filename="DTE-A001-5.xml"');
  assert.equal(x.r.headers.get("x-content-type-options"), "nosniff"); assert.equal(x.r.headers.get("cache-control"), "no-store"); assert.match(x.r.headers.get("content-security-policy") ?? "", /sandbox/); assert.equal(new TextDecoder().decode(x.bytes), XML_REAL);
  const f = await bajar(ana, "pdf"); assert.equal(f.r.status, 200); assert.equal(f.r.headers.get("content-type"), "application/pdf"); assert.equal(new TextDecoder().decode(f.bytes), PDF_REAL);
  assert.equal((await bajar(anon, "xml")).r.status, 401, "sin sesión no se descarga"); assert.equal((await bajar(sofia, "xml")).r.status, 404, "otra empresa no descarga el archivo de la 1");
  assert.equal((await bajar(ana, "html")).r.status, 404, "solo xml y pdf");
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/GetDocument")).length, 0, "los archivos salieron de NUESTRO almacén, no se volvieron a pedir a Digifact");

  // ---- 7. auditoría en la base (sin secretos) y nada sensible en NINGUNA respuesta
  const aud = await bd.filas<J>("select accion, datos::text as datos from public.auditoria where accion like 'digifact_test.%' order by id");
  for (const x of ["digifact_test.nit_consultado", "digifact_test.preparada", "digifact_test.envio_iniciado", "digifact_test.certificada"]) assert.ok(aud.some((a) => a.accion === x), `auditoría: ${x}`);
  const todo = JSON.stringify(aud) + salidaCruda.join("\n");
  for (const secreto of [CLAVE, "firma-secreta", btoa(PDF_REAL), btoa(XML_REAL)]) assert.ok(!todo.includes(secreto), `ni respuestas ni auditoría contienen «${secreto.slice(0, 8)}…»`);
  void EMPRESA2;
} });

Deno.test("el navegador NUNCA habla con Digifact ni toca credenciales: ningún archivo de la interfaz los menciona", async () => {
  const raiz = new URL("../web/", import.meta.url).pathname; const ruidosos: string[] = [];
  const recorrer = async (dir: string) => { for await (const e of Deno.readDir(dir)) { const r = `${dir}${e.name}`; if (e.isDirectory) await recorrer(r + "/"); else if (/\.(js|html)$/.test(e.name)) { const t = await Deno.readTextFile(r);
    if (/digifact\.com|testnucgt|get_token|DIGIFACT_TEST|api\.digifact|Authorization|authorization/i.test(t.replace(/\/api\/digifact\//g, "").replace(/panelDigifact|digifactEstado|digifactNit|digifactDocumento|digifactValidar|digifactPreparar|digifactCertificar|digifactConciliar|digifact-/g, ""))) ruidosos.push(r); } } };
  await recorrer(raiz); assert.deepEqual(ruidosos, [], "la interfaz no debe conocer el servidor, las credenciales ni el token de Digifact");
  const t = await Deno.readTextFile(`${raiz}js/digifact.js`); assert.ok(!/fetch\(/.test(t), "digifact.js no llama directamente a ninguna red: usa api.js");
  const a = await Deno.readTextFile(`${raiz}js/api.js`); for (const m of a.matchAll(/llamar\("(?:GET|POST)", [`"]([^`"]+)/g)) assert.ok(m[1].startsWith("/api/"), `solo rutas de NEXA: ${m[1]}`);
});

Deno.test("configuración por entorno: apagado por defecto y falla cerrado (producción inexistente, huella obligatoria, sin valores en los mensajes)", async () => {
  const EMISOR = { nit: "5888492", nombre: "EMISOR DE PRUEBA", nombreComercial: "X", afiliacionIva: "GEN", codigoEstablecimiento: "2", correo: "", direccion: { direccion: "CIUDAD 1", codigoPostal: "01010", municipio: "GUATEMALA", departamento: "GUATEMALA", pais: "GT" }, frases: [{ tipo: 1, escenario: 2 }] };
  const { huellaEmisor } = await import("../../proveedores/src/datos_emisor.ts"); const huella = await huellaEmisor(EMISOR);
  const base: Record<string, string> = { FEL_DIGIFACT_TEST: "habilitado", FEL_DIGIFACT_TEST_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: "USUARIO_TEST", DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: "5888492", FEL_DIGIFACT_TEST_EMISOR: JSON.stringify(EMISOR), FEL_DIGIFACT_TEST_HUELLA: huella };
  const con = (o: Record<string, string | undefined>) => crearDigifactDesdeEntorno((k) => ({ ...base, ...o })[k]);
  assert.equal((await crearDigifactDesdeEntorno(() => undefined)).servicio, undefined, "sin variables no existe");
  assert.ok((await con({})).servicio, "con todo correcto se habilita");
  for (const [que, o] of [["interruptor", { FEL_DIGIFACT_TEST: "si" }], ["empresa", { FEL_DIGIFACT_TEST_EMPRESA: "no-es-uuid" }], ["usuario", { DIGIFACT_TEST_USERNAME: undefined }], ["contraseña", { DIGIFACT_TEST_PASSWORD: undefined }], ["NIT", { DIGIFACT_TEST_NIT: "999" }],
    ["emisor", { FEL_DIGIFACT_TEST_EMISOR: "{no json" }], ["huella", { FEL_DIGIFACT_TEST_HUELLA: "ffffffffffffffff" }]] as const) {
    const r = await con(o as Record<string, string | undefined>); assert.equal(r.servicio, undefined, `${que}: debe quedar deshabilitado`); assert.ok(!r.motivo.includes(CLAVE), "el motivo no muestra valores");
  }
  // el servicio de entorno nunca envía con el almacén por defecto (no persistente) aunque la prueba esté autorizada
  const sv = (await con({ FEL_DIGIFACT_AUTORIZA_REFERENCIA: "00000000-0000-5000-8000-000000000001" })).servicio!;
  const ctx = { empresaId: EMPRESA, actorId: "u", permisos: ["borradores.ver", "fiscal.certificar", "fiscal.ver"] };
  const doc = { id: "d", empresaId: EMPRESA, estadoPreparacion: "revisado", estadoFiscal: "ninguno", receptor: { tipoId: "CF" as const, id: "CF", nombre: "CONSUMIDOR FINAL" }, lineas: [{ tipo: "Servicio" as const, descripcion: "Algo de prueba", cantidad: "1", precioUnitario: "10", descuento: "0" }] };
  const prep = await sv.preparar(ctx, doc);
  await assert.rejects(() => sv.certificar(ctx, doc, { operacionId: prep.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: prep.referencia, huellaEmisor: prep.huellaEmisor }), (e: { codigo?: string }) => e.codigo === "ALMACEN_NO_PERSISTENTE");
});
