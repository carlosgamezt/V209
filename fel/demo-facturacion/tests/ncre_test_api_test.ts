// NCRE en Digifact TEST por la API REAL con la PROPUESTA de la migración 31 aplicada SOLO en la base de prueba en memoria (jamás en nexa-demo ni en ninguna base persistente): comprueba que, con esa
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

async function entorno(conMigracion31: boolean) {
  if (conMigracion31) Deno.env.set("FEL_PROPUESTA_31", "1"); else Deno.env.delete("FEL_PROPUESTA_31");   // la propuesta se aplica SOLO a la base en memoria de esta prueba
  const bd = await crearBd(); Deno.env.delete("FEL_PROPUESTA_31"); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = []; let envios = 0;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; return ok({ code: "1", message: "Procesado Correctamente", authNumber: AUT_NOTA, batch: "BDE0DEC2", serial: "5", enrolledTimeStamp: "2026-11-25T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" }); }
    if (p.ruta.startsWith("/GetDocument")) return ok({ RESPONSE: [] });
    if (p.ruta.startsWith("/Shared")) return ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] });
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
  const ana = await new Cli("ana").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], es = est.establecimientos[0];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const nuevo = async (extra: J = {}, precio = "100") => { const r = await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: precio }], fecha: hoy, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.documento as J; };
  const revisar = async (d: J) => { const x = (await ana.llamar("GET", `/api/documentos/${d.id}`)).json.documento; assert.equal((await ana.llamar("POST", `/api/documentos/${d.id}/estado`, { estado: "revisado", version: x.version })).status, 200); };
  const certificarFalso = async (id: string) => {
    await bd.ejecutar("select set_config('fel.op_fiscal', 'on', false)");
    await bd.ejecutar("update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = $1", [id]);
    await bd.ejecutar("update public.documentos set estado_fiscal = 'certificado', serie = '62496FB5', numero_fiscal = '1974750325', autorizacion_sat = $2, certificacion_verificada_en = now() where id = $1", [id, AUT_ORIGEN]);
    await bd.ejecutar("select set_config('fel.op_fiscal', 'off', false)");
  };
  for (const t of ["NCRE", "NDEB"]) assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: t, habilitado: true })).status, 200);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "RECI", habilitado: true, base_habilitacion: "Base de prueba (no es una resolución real)" })).status, 200);
  const origen = await nuevo(); await revisar(origen); await certificarFalso(origen.id);
  const nota = await nuevo({ tipo_dte: "NCRE", documento_origen_id: origen.id, motivo_ajuste: "Devolución de mercadería" }, "20"); await revisar(nota);
  const ndeb = await nuevo({ tipo_dte: "NDEB", documento_origen_id: origen.id, motivo_ajuste: "Cargo adicional por flete" }, "20"); await revisar(ndeb);
  const reci = await nuevo({ tipo_dte: "RECI", tipo_recibo: "Colegio" }, "20"); await revisar(reci);
  return { ana, bd, llamadas, envios: () => envios, nota, ndeb, reci, origen };
}

Deno.test({ name: "SIN la migración 31 (estado actual): la NCRE sigue bloqueada, no sale nada a Digifact y la pantalla no ofrece certificarla", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(false);
  const tipos = (await e.ana.llamar("GET", "/api/tipos-documento")).json.tipos as J[]; assert.equal(tipos.find((t) => t.codigo === "NCRE")!.certificacion_test, false); assert.equal(tipos.find((t) => t.codigo === "FACT")!.certificacion_test, true);
  const p = await e.ana.llamar("POST", `/api/documentos/${e.nota.id}/digifact/preparar`, {}); assert.equal(p.status, 422); assert.equal(p.json.codigo, "tipo_no_habilitado"); assert.equal(e.llamadas.length, 0);
} });

Deno.test({ name: "CON la propuesta de la migración 31 (solo en la base de prueba): la NCRE se prepara y certifica UNA vez con su origen y motivo; NDEB y RECI siguen bloqueados; sin confirmaciones no se envía", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(true);
  const tipos = (await e.ana.llamar("GET", "/api/tipos-documento")).json.tipos as J[];
  assert.equal(tipos.find((t) => t.codigo === "NCRE")!.certificacion_test, true, "la pantalla recibe que NCRE certifica en TEST"); assert.equal(tipos.find((t) => t.codigo === "NCRE")!.certificacion_habilitada, false, "pero NO «de verdad»");
  for (const t of ["NDEB", "RECI"]) assert.equal(tipos.find((x) => x.codigo === t)!.certificacion_test, false, `${t} sigue sin certificar`);
  // NDEB y RECI: bloqueados, sin operación ni red
  for (const d of [e.ndeb, e.reci]) { const x = await e.ana.llamar("POST", `/api/documentos/${d.id}/digifact/preparar`, {}); assert.equal(x.status, 422, d.tipo_dte); assert.equal(x.json.codigo, "tipo_no_habilitado"); }
  assert.equal(e.llamadas.length, 0, "nada salió");
  // NCRE: preparar no envía; confirmaciones incompletas no envían; la correcta envía UNA vez
  const p = await e.ana.llamar("POST", `/api/documentos/${e.nota.id}/digifact/preparar`, {}); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(e.envios(), 0, "preparar no envía");
  const base = { operacionId: p.json.operacionId ?? p.json.id, referencia: p.json.referencia, huellaEmisor: p.json.huellaEmisor };
  const mala = await e.ana.llamar("POST", `/api/documentos/${e.nota.id}/digifact/certificar`, { ...base, confirmacion: "certificar-test" }); assert.ok(mala.status >= 400 || mala.json.error); assert.equal(e.envios(), 0);
  const c = await e.ana.llamar("POST", `/api/documentos/${e.nota.id}/digifact/certificar`, { ...base, confirmacion: "CERTIFICAR-TEST" }); assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.operacion.estado, "certificada"); assert.equal(e.envios(), 1);
  const envio = e.llamadas.find((l) => l.ruta.startsWith("/v2/transform/nuc_json"))!.cuerpo!; assert.ok(envio.includes("NCRE") && envio.includes(AUT_ORIGEN) && envio.includes("62496FB5") && envio.includes("Devolución de mercadería"), "la nota enviada lleva su tipo, el origen y el motivo");
  const otra = await e.ana.llamar("POST", `/api/documentos/${e.nota.id}/digifact/certificar`, { ...base, confirmacion: "CERTIFICAR-TEST" }); assert.equal(otra.json.reutilizada, true); assert.equal(e.envios(), 1, "certificar otra vez no reenvía");
  // el origen y la nota quedan intactos en su tipo
  const dn = (await e.ana.llamar("GET", `/api/documentos/${e.nota.id}`)).json.documento; assert.equal(dn.tipo_dte, "NCRE");
  const dorig = (await e.ana.llamar("GET", `/api/documentos/${e.origen.id}`)).json.documento; assert.equal(dorig.estado_fiscal, "certificado"); assert.equal(dorig.tipo_dte, "FACT");
} });

Deno.test({ name: "receptor CF con nombre escrito («Juan Pérez»): la identificación sigue siendo CF y el DTE enviado a Digifact lleva ese nombre (y «CONSUMIDOR FINAL» por omisión)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(false);
  const est = (await e.ana.llamar("GET", "/api/estado")).json, es = est.establecimientos[0], hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  for (const [nombre, esperado] of [["Juan Pérez", "Juan Pérez"], ["", "CONSUMIDOR FINAL"]] as const) {
    const r = await e.ana.llamar("POST", "/api/documentos", { establecimiento_id: es.id, fecha: hoy, lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "50" }], cliente_nuevo: { tipo_identificacion: "CF", numero_identificacion: "CF", nombre } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); const d = r.json.documento;
    assert.equal((await e.ana.llamar("POST", `/api/documentos/${d.id}/estado`, { estado: "revisado", version: d.version })).status, 200);
    const antes = e.llamadas.length;
    const p = await e.ana.llamar("POST", `/api/documentos/${d.id}/digifact/preparar`, {}); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(p.json.receptor.nombre, esperado, "el resumen de la preparación muestra el nombre");
    const c = await e.ana.llamar("POST", `/api/documentos/${d.id}/digifact/certificar`, { operacionId: p.json.operacionId ?? p.json.id, confirmacion: "CERTIFICAR-TEST", referencia: p.json.referencia, huellaEmisor: p.json.huellaEmisor }); assert.equal(c.status, 200, JSON.stringify(c.json));
    const cuerpo = e.llamadas.slice(antes).find((l) => l.ruta.startsWith("/v2/transform/nuc_json"))!.cuerpo!;
    const comprador = JSON.stringify(JSON.parse(cuerpo).Buyer ?? JSON.parse(cuerpo));
    assert.ok(comprador.includes(esperado), `el DTE lleva el nombre «${esperado}»`); assert.ok(/"CF"/.test(comprador), "con identificación CF");
  }
} });
