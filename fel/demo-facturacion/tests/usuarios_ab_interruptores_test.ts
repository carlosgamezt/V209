// (1) USUARIO A (Sucursal Principal, código 2) y USUARIO B (Sucursal 2, código 67), cuentas independientes: cada uno usa SU establecimiento y no llega a los documentos del otro (lectura, modificación, PDF, certificación, listas);
//     el administrador cambia nombres internos y reasigna conservando historial y documentos originales; un supervisor solo llega a los establecimientos que se le autorizaron.
// (2) INTERRUPTORES coordinados: con la administración apagada no existe NINGUNA ruta /api/admin/* (ni para el administrador ni sin sesión), /api/estado lo declara y no hay alcance; con ella encendida, solo el administrador entra.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenPg, AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { lectorDeAlcanceBd } from "../src/alcance_establecimientos.ts";
import { adminDeBd } from "../src/admin_establecimientos.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";

type J = Record<string, any>; // deno-lint-ignore no-explicit-any
const CL = "Clave-Prueba-123";
async function entorno(modo: "completo" | "apagado") {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); const ids = modo === "completo" ? await activarEstablecimientosLocal(bd) : { e2: "", e67: "" };
  const sesiones = new Sesiones(undefined, modo === "completo" ? new AlmacenPg(bd) : new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true, ...(modo === "completo" ? { identidadSesion: true, alcance: lectorDeAlcanceBd(bd, Sesiones.idDeCookie), adminEst: adminDeBd(bd) } : {}) });
  class Cli { cookie = ""; constructor(public usuario: string, public clave = CLAVE_DEMO) {}
    async ll(m: string, ruta: string, cuerpo?: unknown, sinCookie = false) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie && !sinCookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t }; }
    async entrar() { assert.equal((await this.ll("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: this.clave })).status, 200); return this; } }
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const borrador = async (c: Cli, extra: J = {}) => { const est = (await c.ll("GET", "/api/estado")).json; const cf = est.clientes.find((x: J) => x.tipo_identificacion === "CF") ?? est.clientes[0]; const con = est.conceptos[0];
    return c.ll("POST", "/api/documentos", { cliente_id: cf.id, fecha: hoy, lineas: [{ descripcion: con.descripcion, cantidad: "1", precio_unitario: con.precio_unitario, concepto_id: con.id }], ...extra }); };
  const codDe = async (doc: string) => (await bd.filas<{ c: string }>("select e.codigo_sat as c from public.documentos d join public.establecimientos e on e.id = d.establecimiento_id where d.id = $1", [doc]))[0].c;
  return { bd, ids, Cli, borrador, codDe };
}
const RUTAS_ADMIN: Array<[string, string, J | undefined]> = [["GET", "/api/admin/establecimientos", undefined], ["POST", "/api/admin/establecimientos/00000000-0000-4000-8000-000000000001/nombre", { nombre: "X" }], ["POST", "/api/admin/asignaciones", { usuario: "00000000-0000-4000-8000-000000000001", establecimiento_id: "00000000-0000-4000-8000-000000000002", motivo: "prueba" }],
  ["POST", "/api/admin/asignaciones/revocar", { usuario: "00000000-0000-4000-8000-000000000001", establecimiento_id: "00000000-0000-4000-8000-000000000002", motivo: "prueba" }], ["POST", "/api/admin/supervisor", { usuario: "00000000-0000-4000-8000-000000000001", valor: true, motivo: "prueba" }]];

Deno.test({ name: "usuarios A (código 2) y B (código 67): aislamiento cruzado, reasignación con historial, nombres internos y supervisor acotado", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno("completo"); const { e2, e67 } = e.ids;
  const ana = await new e.Cli("ana").entrar();
  for (const [u, n] of [["usuarioa", "Usuario A"], ["usuariob", "Usuario B"], ["supervi", "Supervisor Uno"]]) assert.equal((await ana.ll("POST", "/api/usuarios", { usuario: u, nombre: n, clave: CL, rol: "emisor" })).status, 200);
  const l0 = (await ana.ll("GET", "/api/admin/establecimientos")).json; const uid = (u: string) => l0.personas.find((p: J) => p.usuario === u).user_id;
  const asignar = (u: string, est: string, pred = true, motivo = "alta de prueba") => ana.ll("POST", "/api/admin/asignaciones", { usuario: uid(u), establecimiento_id: est, predeterminado: pred, motivo });
  assert.equal((await asignar("usuarioa", e2)).status, 200); assert.equal((await asignar("usuariob", e67)).status, 200);
  const A = await new e.Cli("usuarioa", CL).entrar(), B = await new e.Cli("usuariob", CL).entrar();
  // cada uno ve y usa SOLO el suyo
  assert.deepEqual((await A.ll("GET", "/api/estado")).json.establecimientos.map((x: J) => x.codigo_sat), ["2"]); assert.deepEqual((await B.ll("GET", "/api/estado")).json.establecimientos.map((x: J) => x.codigo_sat), ["67"]);
  const dA = await e.borrador(A), dB = await e.borrador(B); assert.equal(dA.status, 200, dA.texto); assert.equal(dB.status, 200, dB.texto);
  const iA = dA.json.documento.id, iB = dB.json.documento.id; assert.equal(await e.codDe(iA), "2"); assert.equal(await e.codDe(iB), "67");
  // aislamiento cruzado: leer, modificar, cambiar de estado, PDF, certificar, listar
  for (const [quien, doc] of [[A, iB], [B, iA]] as const) {
    assert.equal((await quien.ll("GET", `/api/documentos/${doc}`)).status, 404, "leer"); assert.equal((await quien.ll("POST", `/api/documentos/${doc}/estado`, { estado: "revisado", version: 1 })).status, 404, "estado");
    assert.equal((await quien.ll("GET", `/api/documentos/${doc}/pdf-demo`)).status, 404, "pdf"); { const rc = await quien.ll("POST", `/api/documentos/${doc}/digifact/certificar-todo`, { version: 1, confirmacion: "CERTIFICAR" }); assert.ok([403, 404, 503].includes(rc.status), `certificar ${rc.status} ${rc.texto.slice(0, 160)} `); }
    assert.equal((await quien.ll("POST", "/api/documentos", { id: doc, version: 1, cliente_id: (await quien.ll("GET", "/api/estado")).json.clientes[0].id, fecha: "2026-11-26", lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1.00" }] })).status >= 400, true, "modificar");
  }
  assert.ok(!(await A.ll("GET", "/api/documentos?pagina=1&tam=50")).texto.includes(iB) && (await A.ll("GET", "/api/documentos?pagina=1&tam=50")).texto.includes(iA)); assert.ok(!(await B.ll("GET", "/api/documentos?pagina=1&tam=50")).texto.includes(iA));
  assert.equal((await A.ll("POST", "/api/documentos", { cliente_id: (await A.ll("GET", "/api/estado")).json.clientes[0].id, fecha: "2026-11-26", establecimiento_id: e67, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1.00" }] })).status, 403, "A no factura desde el 67");
  // el administrador cambia nombres internos y reasigna: el historial y los documentos originales se conservan
  assert.equal((await ana.ll("POST", `/api/admin/establecimientos/${e2}/nombre`, { nombre: "Casa Central" })).status, 200); assert.equal((await ana.ll("POST", `/api/admin/establecimientos/${e2}/nombre`, { nombre: "Sucursal Principal" })).status, 200);
  assert.equal((await asignar("usuariob", e2, true, "B pasa a la sucursal principal")).status, 200);
  assert.equal(await e.codDe(iB), "67", "el documento de B conserva el 67"); assert.equal((await B.ll("GET", `/api/documentos/${iB}`)).status, 404); assert.deepEqual((await B.ll("GET", "/api/estado")).json.establecimientos.map((x: J) => x.codigo_sat), ["2"]);
  assert.equal((await ana.ll("GET", `/api/documentos/${iB}`)).status, 200, "el administrador conserva el acceso"); assert.equal((await e.borrador(B)).status, 200, "B ya factura desde el 2");
  const l1 = (await ana.ll("GET", "/api/admin/establecimientos")).json; const pb = l1.personas.find((p: J) => p.usuario === "usuariob"); assert.equal(pb.asignaciones.length, 1); assert.ok(pb.revocadas >= 1);
  assert.ok(l1.historial.some((h: J) => h.accion === "establecimiento.nombre") && l1.historial.some((h: J) => h.accion === "usuario.establecimiento" && h.persona === uid("usuariob") && h.datos.anterior === e67));
  // supervisor ACOTADO: autorizado solo para el 2, no llega al 67 aunque lo pida
  assert.equal((await ana.ll("POST", "/api/admin/supervisor", { usuario: uid("supervi"), valor: true, motivo: "supervisa la sucursal principal" })).status, 200); assert.equal((await asignar("supervi", e2)).status, 200);
  const S = await new e.Cli("supervi", CL).entrar(); const est = (await S.ll("GET", "/api/estado")).json; assert.deepEqual(est.establecimientos.map((x: J) => x.codigo_sat), ["2"]); assert.equal(est.alcance.multiples, true);
  assert.equal((await S.ll("GET", `/api/documentos/${iB}`)).status, 404, "el supervisor no ve el 67"); assert.ok(!(await S.ll("GET", "/api/documentos?pagina=1&tam=50")).texto.includes(iB));
  assert.equal((await S.ll("POST", "/api/documentos", { cliente_id: est.clientes[0].id, fecha: "2026-11-26", establecimiento_id: e67, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1.00" }] })).status, 403, "el supervisor no factura desde un establecimiento no autorizado");
  assert.equal((await S.ll("POST", "/api/admin/supervisor", { usuario: uid("usuarioa"), valor: true, motivo: "escalada" })).status, 403, "un supervisor no administra");
  assert.equal((await A.ll("GET", `/api/documentos/${iA}`)).status, 200, "A conserva lo suyo");
}});

Deno.test({ name: "interruptores coordinados: apagado = ninguna ruta administrativa ni alcance (ni con sesión de administrador ni sin sesión); encendido = solo el administrador", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const off = await entorno("apagado"); const anaOff = await new off.Cli("ana").entrar();
  for (const [m, r, b] of RUTAS_ADMIN) { assert.equal((await anaOff.ll(m, r, b)).status, 404, `apagado: ${m} ${r} (administrador)`); assert.ok([401, 403, 404].includes((await anaOff.ll(m, r, b, true)).status), `apagado: ${m} ${r} (sin sesión)`); }
  const eo = (await anaOff.ll("GET", "/api/estado")).json; assert.equal(eo.adminEstablecimientos, false); assert.equal(eo.alcance.restringido, false, "apagado: nadie está restringido");
  const mo = await new off.Cli("marta").entrar(); assert.equal((await mo.ll("GET", "/api/estado")).json.adminEstablecimientos, false); assert.equal((await off.borrador(mo)).status, 200, "apagado: se factura como siempre");
  const on = await entorno("completo"); const anaOn = await new on.Cli("ana").entrar(), mOn = await new on.Cli("marta").entrar();
  assert.equal((await anaOn.ll("GET", "/api/estado")).json.adminEstablecimientos, true); assert.equal((await anaOn.ll("GET", "/api/admin/establecimientos")).status, 200);
  for (const [m, r, b] of RUTAS_ADMIN) { assert.ok([403, 404].includes((await mOn.ll(m, r, b)).status), `encendido: ${m} ${r} (facturadora)`); assert.ok([401, 403].includes((await mOn.ll(m, r, b, true)).status), `encendido: ${m} ${r} (sin sesión)`); }
  assert.equal((await anaOn.ll("GET", "/api/admin/no-existe")).status, 404);
}});
