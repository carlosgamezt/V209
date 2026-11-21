// Correo de la factura enviado por DIGIFACT al certificar (Buyer.Contact.EmailList), a través de la API REAL de la demostración (mismo proceso, PostgreSQL en memoria).
// Cliente de Digifact REAL con transporte SIMULADO: nada sale a la red ni usa credenciales. NEXA solo indica el destinatario; no envía correo y el módulo propio (Resend) no interviene.
// Uso: deno test -A tests/digifact_correo_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { crearPoliticaCorreoDigifactDesdeEntorno } from "../src/digifact_correo_entorno.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", HUELLA = "0123456789abcdef", DEST = "prueba.nexa@ejemplo.com";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

async function montar(env: Record<string, string>) {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const nucs: J[] = []; let autorizada: string | null = null;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { nucs.push(JSON.parse(p.cuerpo!)); return ok({ code: "1", message: "Procesado Correctamente", authNumber: AUT, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: btoa("<x/>"), responseData3: btoa("%PDF-1.4") }); }
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => autorizada,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const pol = crearPoliticaCorreoDigifactDesdeEntorno((k) => env[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc, digifactCorreo: pol.politica });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT"), es = est.establecimientos[0];
  const crear = async (clave: string) => {
    const d = await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Supervisión de obra", cantidad: "2", precio_unitario: "500" }], fecha: new Date().toISOString().slice(0, 10) });
    assert.equal((await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200, clave); return d.json.documento.id as string;
  };
  return { bd, Cli, ana, nucs, autorizar: (r: string) => { autorizada = r; }, crear, pol };
}
const R = (id: string, x: string) => `/api/documentos/${id}/digifact${x}`;
const ENV_ON = { FEL_DIGIFACT_CORREO: "habilitado", FEL_DIGIFACT_CORREO_EMPRESA: EMPRESA, FEL_DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, @pruebas.example.org` };

Deno.test({ name: "correo por Digifact: apagado por defecto — sin el interruptor no se puede pedir, y certificar sin pedirlo no cambia nada", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { ana, nucs, autorizar, crear, pol } = await montar({}); assert.equal(pol.politica, undefined, "sin FEL_DIGIFACT_CORREO no existe la política");
  assert.equal((await ana.llamar("GET", "/api/digifact/estado")).json.correoDigifact.habilitado, false);
  const id = await crear("a");
  for (const accion of ["validar", "preparar"]) { const r = await ana.llamar("POST", R(id, `/${accion}`), { enviar_correo: true, correo: DEST }); assert.equal(r.status, 403, accion); assert.equal(r.json.codigo, "correo_no_habilitado"); }
  assert.equal(nucs.length, 0, "no salió nada hacia Digifact");
  // sin pedir el correo, el flujo de siempre funciona y el NUC enviado no lleva Buyer.Contact
  const p = (await ana.llamar("POST", R(id, "/preparar"), {})).json; assert.equal(p.correoSolicitado, null); autorizar(p.referencia);
  const c = await ana.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, correo: DEST });   // «correo» sin «enviar_correo» se ignora
  assert.equal(c.status, 200, c.texto); assert.equal(c.json.operacion.estado, "certificada"); assert.equal(nucs.length, 1); assert.equal(nucs[0].Buyer.Contact, undefined, "sin la casilla no viaja ningún correo");
  assert.equal((await ana.llamar("GET", R(id, "/correo"))).json.solicitado, false);
}});

Deno.test({ name: "correo por Digifact: habilitado — lista cerrada de destinatarios, una sola empresa, correo solo en Buyer.Contact y «solicitado» (nunca «entregado»); sin duplicados ni cambios fiscales", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, ana, nucs, autorizar, crear } = await montar(ENV_ON); const sofia = await new Cli("sofia").entrar(), pedro = await new Cli("pedro").entrar();
  assert.equal((await ana.llamar("GET", "/api/digifact/estado")).json.correoDigifact.habilitado, true); assert.equal((await sofia.llamar("GET", "/api/digifact/estado")).json.correoDigifact.habilitado, false, "otra empresa: no");
  const id = await crear("b");
  // destinatarios: fuera de la lista y direcciones inválidas se rechazan ANTES de tocar nada
  const ajeno = await ana.llamar("POST", R(id, "/preparar"), { enviar_correo: true, correo: "cliente@dominio-externo.com" }); assert.equal(ajeno.status, 403); assert.equal(ajeno.json.codigo, "destinatario_no_autorizado");
  for (const mal of ["no-es-correo", "", "a@b", "<s>@pruebas.example.org", "uno@pruebas.example.org,dos@pruebas.example.org", "x".repeat(45) + "@pruebas.example.org"]) { const r = await ana.llamar("POST", R(id, "/validar"), { enviar_correo: true, correo: mal }); assert.equal(r.status, 400, mal.slice(0, 20)); assert.equal(r.json.codigo, "correo_invalido"); }
  assert.equal((await sofia.llamar("POST", R(id, "/preparar"), { enviar_correo: true, correo: DEST })).status, 403, "otra empresa: no habilitado para ella");
  assert.equal(nucs.length, 0);
  // flujo permitido: validar → preparar (eco enmascarado) → certificar con el MISMO correo
  const v = await ana.llamar("POST", R(id, "/validar"), { enviar_correo: true, correo: DEST }); assert.equal(v.status, 200); assert.equal(v.json.ok, true);
  const p = (await ana.llamar("POST", R(id, "/preparar"), { enviar_correo: true, correo: DEST })).json; assert.equal(p.correoSolicitado, "p***@ejemplo.com"); assert.ok(!JSON.stringify(p).includes("prueba.nexa"), "el correo completo no se devuelve");
  assert.equal((await pedro.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: DEST })).status, 403, "el lector no certifica");
  autorizar(p.referencia);
  const c = await ana.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: DEST });
  assert.equal(c.status, 200, c.texto); assert.equal(c.json.operacion.estado, "certificada"); assert.equal(nucs.length, 1);
  assert.deepEqual(nucs[0].Buyer.Contact, { EmailList: { Email: [DEST] } }, "el correo viaja SOLO en Buyer.Contact.EmailList"); assert.equal(nucs[0].Seller.Contact?.EmailList?.Email?.[0], facturaPrueba().emisor.correo, "el correo del emisor no se toca");
  assert.ok(!JSON.stringify(c.json).includes("prueba.nexa"), "la respuesta no incluye el correo completo");
  // lo que NEXA sabe: «solicitado»; nunca «entregado»
  const e = (await ana.llamar("GET", R(id, "/correo"))).json; assert.equal(e.solicitado, true); assert.equal(e.destinatario, "p***@ejemplo.com"); assert.equal(e.entrega, "sin_confirmacion"); assert.ok(typeof e.cuando === "string");
  assert.equal((await sofia.llamar("GET", R(id, "/correo"))).json.solicitado, false, "otra empresa no ve el registro");
  const aud = await bd.filas<{ accion: string; datos: J }>("select accion, datos from public.auditoria where entidad_id = $1 and accion like 'digifact_test.%'", [id]);
  assert.equal(aud.filter((x) => x.accion === "digifact_test.correo_solicitado").length, 1); assert.ok(!aud.some((x) => /entregad/i.test(x.accion)) && !JSON.stringify(aud).includes("prueba.nexa"), "sin «entregado» y sin el correo completo");
  // duplicados: repetir la certificación (aunque cambie el correo) no vuelve a enviar nada
  const otra = await ana.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: "otro@pruebas.example.org" });
  assert.equal(otra.json.reutilizada, true); assert.equal(nucs.length, 1, "una sola salida hacia Digifact"); assert.equal((await bd.filas("select 1 from public.auditoria where entidad_id = $1 and accion = 'digifact_test.correo_solicitado'", [id])).length, 1);
}});

Deno.test("correo por Digifact: configuración del entorno — falla cerrado y explica sin mostrar valores", () => {
  const cr = (env: Record<string, string>) => crearPoliticaCorreoDigifactDesdeEntorno((k) => env[k]);
  assert.equal(cr({}).politica, undefined); assert.equal(cr({ FEL_DIGIFACT_CORREO: "si" }).politica, undefined);
  assert.ok(cr(ENV_ON).politica);
  for (const quitar of ["FEL_DIGIFACT_CORREO_EMPRESA", "FEL_DIGIFACT_CORREO_DESTINATARIOS"]) { const e = { ...ENV_ON } as Record<string, string>; delete e[quitar]; const r = cr(e); assert.equal(r.politica, undefined, quitar); assert.ok(!r.motivo.includes(DEST) && !r.motivo.includes(EMPRESA)); }
  assert.equal(cr({ ...ENV_ON, FEL_DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, basura` }).politica, undefined, "un elemento inválido invalida la lista"); assert.equal(cr({ ...ENV_ON, FEL_DIGIFACT_CORREO_EMPRESA: "no-es-uuid" }).politica, undefined);
  const p = cr(ENV_ON).politica!; assert.equal(p.evaluar(DEST).ok, true); assert.equal(p.evaluar("alguien@pruebas.example.org").ok, true); assert.equal(p.evaluar("alguien@otro.example.org").ok, false);
});
