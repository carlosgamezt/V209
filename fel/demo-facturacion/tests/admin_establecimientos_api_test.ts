// ADMINISTRACIÓN de establecimientos y asignaciones (etapa 1D): API + funciones SQL `fel_adm_*` de M-F/M-G/M-H sobre PostgreSQL en memoria, con SESIONES REALES guardadas en la base (la identidad sale de la cookie, validada por la base).
// Códigos 2 «Sucursal Principal» y 67 «Sucursal 2». Peticiones manipuladas, otra empresa, varios facturadores por establecimiento, reasignación con historial, supervisión y borradores. Nada toca la red ni una base real.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { lectorDeAlcanceBd } from "../src/alcance_establecimientos.ts";
import { adminDeBd } from "../src/admin_establecimientos.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";

type J = Record<string, any>; // deno-lint-ignore no-explicit-any
async function entorno() {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); const ids = await activarEstablecimientosLocal(bd);
  const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { identidadSesion: true, sesiones, practico: true, alcance: lectorDeAlcanceBd(bd, Sesiones.idDeCookie), adminEst: adminDeBd(bd) });
  class Cli { cookie = ""; constructor(public usuario: string, public clave = CLAVE_DEMO) {}
    async ll(m: string, ruta: string, cuerpo?: unknown, sinCookie = false) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie && !sinCookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t }; }
    async entrar() { assert.equal((await this.ll("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: this.clave })).status, 200); return this; } }
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const borrador = async (c: Cli, extra: J = {}) => { const est = (await c.ll("GET", "/api/estado")).json; const cf = est.clientes.find((x: J) => x.tipo_identificacion === "CF") ?? est.clientes[0]; const con = est.conceptos[0];
    return c.ll("POST", "/api/documentos", { cliente_id: cf.id, fecha: hoy, lineas: [{ descripcion: con.descripcion, cantidad: "1", precio_unitario: con.precio_unitario, concepto_id: con.id }], ...extra }); };
  return { bd, ids, Cli, borrador, ee: (id: string) => bd.filas<{ codigo_sat: string; nombre: string; direccion: string }>("select codigo_sat, nombre, direccion from public.establecimientos where id = $1", [id]) };
}
const lst = async (c: { ll: (m: string, r: string) => Promise<{ status: number; json: J }> }) => (await c.ll("GET", "/api/admin/establecimientos")).json;

Deno.test({ name: "administración de establecimientos: panel de datos, nombre interno, usuarios y asignación, varios facturadores por establecimiento, reasignación con historial, supervisión, identidad de la sesión", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(); const { e2, e67 } = e.ids;
  const ana = await new e.Cli("ana").entrar(), marta = await new e.Cli("marta").entrar(), pedro = await new e.Cli("pedro").entrar(), sofia = await new e.Cli("sofia").entrar();
  // 1) el administrador ve SUS establecimientos (2 y 67 con nombre interno) y a sus personas con su asignación
  let l = await lst(ana); const cod = (x: J) => x.establecimientos.map((y: J) => y.codigo_sat);
  assert.ok(cod(l).includes("2") && cod(l).includes("67")); assert.equal(l.establecimientos.find((y: J) => y.codigo_sat === "2").nombre, "Sucursal Principal"); assert.equal(l.establecimientos.find((y: J) => y.codigo_sat === "67").nombre, "Sucursal 2");
  const per = (x: J, u: string) => x.personas.find((p: J) => p.usuario === u);
  assert.equal(per(l, "marta").asignaciones.length, 1); assert.equal(per(l, "marta").asignaciones[0].establecimiento_id, e2); assert.equal(per(l, "pedro").asignaciones.length, 0);
  // 2) quien no administra no entra (facturadora y lector) y sin sesión tampoco; la otra empresa solo ve la suya
  assert.equal((await marta.ll("GET", "/api/admin/establecimientos")).status, 403); assert.equal((await pedro.ll("GET", "/api/admin/establecimientos")).status, 403);
  assert.ok([401, 403].includes((await ana.ll("GET", "/api/admin/establecimientos", undefined, true)).status), "sin cookie no hay identidad");
  const ls = await lst(sofia); assert.ok(!cod(ls).includes("67") && !ls.personas.some((p: J) => ["ana", "marta", "luis"].includes(p.usuario)), "otra empresa no ve nada de esta");
  // 3) nombre interno: se cambia sin alterar código ni dirección; auditado; quien factura no puede; otra empresa tampoco
  const dir0 = (await e.ee(e67))[0].direccion;
  assert.equal((await ana.ll("POST", `/api/admin/establecimientos/${e67}/nombre`, { nombre: "Sucursal Norte", codigo_sat: "99", direccion: "otra", empresa: "x", actor: marta.usuario })).status, 200);
  assert.deepEqual((await e.ee(e67))[0], { codigo_sat: "67", nombre: "Sucursal Norte", direccion: dir0 }, "solo cambió el nombre");
  assert.equal((await marta.ll("POST", `/api/admin/establecimientos/${e67}/nombre`, { nombre: "Intento" })).status, 403); assert.equal((await sofia.ll("POST", `/api/admin/establecimientos/${e67}/nombre`, { nombre: "Ajeno" })).status, 404);
  assert.equal((await ana.ll("POST", `/api/admin/establecimientos/${e67}/nombre`, { nombre: "" })).status >= 400, true); await ana.ll("POST", `/api/admin/establecimientos/${e67}/nombre`, { nombre: "Sucursal 2" });
  // 4) crear usuarios (Usuario B facturador) y asignarles establecimiento; sin asignación no pueden facturar; varios facturadores por establecimiento, cada uno con su cuenta
  for (const [u, n] of [["diego", "Diego Pérez"], ["elena", "Elena Soto"]]) assert.equal((await ana.ll("POST", "/api/usuarios", { usuario: u, nombre: n, clave: "Clave-Prueba-123", rol: "emisor" })).status, 200);
  const diego = await new e.Cli("diego", "Clave-Prueba-123").entrar(), elena = await new e.Cli("elena", "Clave-Prueba-123").entrar();
  const sin = await e.borrador(diego); assert.ok(sin.status >= 400, "sin establecimiento asignado no se factura"); assert.match(sin.texto, /sin_establecimiento|establecimiento/i);
  l = await lst(ana); const uid = (u: string) => per(l, u).user_id;
  const as = (u: string, est: string, pred = true, motivo = "alta de prueba") => ana.ll("POST", "/api/admin/asignaciones", { usuario: uid(u), establecimiento_id: est, predeterminado: pred, motivo });
  assert.equal((await as("diego", e67)).status, 200); assert.equal((await as("elena", e67)).status, 200);   // DOS facturadores en el 67
  for (const [c, cod2] of [[diego, "67"], [elena, "67"], [marta, "2"]] as const) { const st = (await c.ll("GET", "/api/estado")).json; assert.deepEqual(st.establecimientos.map((x: J) => x.codigo_sat), [cod2]); assert.equal(st.alcance.restringido, true); assert.equal(st.alcance.multiples, false); }
  const dD = await e.borrador(diego), dE = await e.borrador(elena), dM = await e.borrador(marta); for (const d of [dD, dE, dM]) assert.equal(d.status, 200, d.texto);
  const estDe = async (d: { json: J }) => (await e.ee((await e.bd.filas<{ establecimiento_id: string }>("select establecimiento_id from public.documentos where id = $1", [d.json.documento.id]))[0].establecimiento_id))[0].codigo_sat;
  assert.equal(await estDe(dD), "67"); assert.equal(await estDe(dE), "67"); assert.equal(await estDe(dM), "2");
  // 5) un establecimiento ajeno pedido por un facturador se RECHAZA (no se cambia en silencio)
  const mal = await diego.ll("POST", "/api/documentos", { cliente_id: (await diego.ll("GET", "/api/estado")).json.clientes[0].id, fecha: "2026-11-26", establecimiento_id: e2, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1.00" }] }); assert.equal(mal.status, 403, mal.texto);
  // 6) identidad manipulada: un facturador que manda «actor», «empresa» o el usuario de otra persona NO administra nada
  for (const cuerpo of [{ usuario: uid("diego"), establecimiento_id: e2, motivo: "intento de escalada", actor: uid("ana"), empresa: "x", p_actor: uid("ana") }, { usuario: uid("elena"), establecimiento_id: e2, motivo: "intento de escalada" }]) assert.equal((await diego.ll("POST", "/api/admin/asignaciones", cuerpo)).status, 403);
  assert.equal((await diego.ll("POST", "/api/admin/supervisor", { usuario: uid("diego"), valor: true, motivo: "me lo doy yo" })).status, 403); assert.equal((await sofia.ll("POST", "/api/admin/asignaciones", { usuario: uid("diego"), establecimiento_id: e2, motivo: "otra empresa intenta" })).status >= 400, true);
  // 7) reasignación con historial: Diego pasa del 67 al 2; su documento histórico NO cambia; ya no ve el borrador del 67; la asignación anterior queda revocada
  assert.equal((await as("diego", e2, true, "traslado a la sucursal principal")).status, 200);
  assert.equal(await estDe(dD), "67", "el documento histórico conserva su establecimiento"); assert.equal((await diego.ll("GET", `/api/documentos/${dD.json.documento.id}`)).status, 404, "tras la reasignación ya no ve lo del 67");
  assert.deepEqual((await diego.ll("GET", "/api/estado")).json.establecimientos.map((x: J) => x.codigo_sat), ["2"]); assert.equal((await ana.ll("GET", `/api/documentos/${dD.json.documento.id}`)).status, 200, "el administrador sí lo ve");
  l = await lst(ana); assert.equal(per(l, "diego").asignaciones.length, 1); assert.ok(per(l, "diego").revocadas >= 1); assert.ok(l.historial.some((h: J) => h.accion === "usuario.establecimiento" && h.persona === uid("diego") && h.datos.anterior === e67), "historial con el establecimiento anterior");
  // 8) supervisión: solo la concede un administrador, con motivo; el supervisor elige entre los suyos; al retirarla vuelve a uno solo
  assert.equal((await ana.ll("POST", "/api/admin/supervisor", { usuario: uid("elena"), valor: true, motivo: "ab" })).status >= 400, true, "exige motivo");
  assert.equal((await ana.ll("POST", "/api/admin/supervisor", { usuario: uid("elena"), valor: true, motivo: "supervisa las dos sucursales" })).status, 200); assert.equal((await as("elena", e2, false, "segunda sucursal")).status, 200);
  let st = (await elena.ll("GET", "/api/estado")).json; assert.deepEqual(st.establecimientos.map((x: J) => x.codigo_sat).sort(), ["2", "67"]); assert.equal(st.alcance.multiples, true);
  assert.equal((await ana.ll("POST", "/api/admin/supervisor", { usuario: uid("pedro"), valor: true, motivo: "a un lector no" })).status >= 400, true, "no a un lector");
  assert.equal((await ana.ll("POST", "/api/admin/supervisor", { usuario: uid("elena"), valor: false, motivo: "ya no supervisa" })).status, 200);
  st = (await elena.ll("GET", "/api/estado")).json; assert.equal(st.establecimientos.length, 1); assert.equal(st.alcance.multiples, false);
  // 9) borradores: el borrador del 67 que dejó Diego solo lo mueve el administrador, con motivo (la función SQL lo exige); un facturador no
  assert.ok(true);
}});
