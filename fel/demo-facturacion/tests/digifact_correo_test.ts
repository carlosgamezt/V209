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
  assert.equal((await pedro.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: DEST, correo_ref: p.correoRef })).status, 403, "el lector no certifica");
  autorizar(p.referencia);
  const c = await ana.llamar("POST", R(id, "/certificar"), { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: DEST, correo_ref: p.correoRef });
  assert.equal(c.status, 200, c.texto); assert.equal(c.json.operacion.estado, "certificada"); assert.equal(nucs.length, 1);
  assert.deepEqual(nucs[0].Buyer.Contact, { EmailList: { Email: [DEST] } }, "el correo viaja SOLO en Buyer.Contact.EmailList"); assert.equal(nucs[0].Seller.Contact?.EmailList?.Email?.[0], facturaPrueba().emisor.correo, "el correo del emisor no se toca");
  assert.ok(!JSON.stringify(c.json).includes("prueba.nexa"), "la respuesta no incluye el correo completo");
  // lo que NEXA sabe: «solicitado»; nunca «entregado»
  const e = (await ana.llamar("GET", R(id, "/correo"))).json; assert.equal(e.solicitado, true); assert.equal(e.destinatario, "p***@ejemplo.com"); assert.equal(e.entrega, "sin_confirmacion"); assert.ok(typeof e.cuando === "string");
  assert.equal((await sofia.llamar("GET", R(id, "/correo"))).json.solicitado, false, "otra empresa no ve el registro");
  const aud = await bd.filas<{ accion: string; datos: J }>("select accion, datos from public.auditoria where entidad_id = $1 and accion like 'digifact_test.%'", [id]);
  assert.equal(aud.filter((x) => x.accion === "digifact_test.correo_solicitado").length, 1); assert.ok(!aud.some((x) => /entregad/i.test(x.accion)) && !JSON.stringify(aud).includes("prueba.nexa"), "sin «entregado» y sin el correo completo");
  // duplicados: repetir la certificación (aunque cambie el correo) no vuelve a enviar nada
  const base = { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true };
  const otra = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo: "otro@pruebas.example.org", correo_ref: p.correoRef });
  assert.equal(otra.status, 409, "otro correo con la huella de la preparación: se rechaza antes de tocar nada"); assert.equal(otra.json.codigo, "correo_distinto"); assert.equal(nucs.length, 1);
  const igual = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo: DEST, correo_ref: p.correoRef });   // doble clic o reintento del navegador: mismo correo y misma huella
  assert.equal(igual.json.reutilizada, true); assert.equal(nucs.length, 1, "una sola salida hacia Digifact"); assert.equal((await bd.filas("select 1 from public.auditoria where entidad_id = $1 and accion = 'digifact_test.correo_solicitado'", [id])).length, 1);
}});

Deno.test("correo por Digifact: configuración del entorno — falla cerrado y explica sin mostrar valores", () => {
  const cr = (env: Record<string, string>) => crearPoliticaCorreoDigifactDesdeEntorno((k) => env[k]);
  assert.equal(cr({}).politica, undefined); assert.equal(cr({ FEL_DIGIFACT_CORREO: "si" }).politica, undefined);
  assert.ok(cr(ENV_ON).politica);
  for (const quitar of ["FEL_DIGIFACT_CORREO_EMPRESA", "FEL_DIGIFACT_CORREO_DESTINATARIOS"]) { const e = { ...ENV_ON } as Record<string, string>; delete e[quitar]; const r = cr(e); assert.equal(r.politica, undefined, quitar); assert.ok(!r.motivo.includes(DEST) && !r.motivo.includes(EMPRESA)); }
  assert.equal(cr({ ...ENV_ON, FEL_DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, basura` }).politica, undefined, "un elemento inválido invalida la lista"); assert.equal(cr({ ...ENV_ON, FEL_DIGIFACT_CORREO_EMPRESA: "no-es-uuid" }).politica, undefined);
  const p = cr(ENV_ON).politica!; assert.equal(p.evaluar(DEST).ok, true); assert.equal(p.evaluar("alguien@pruebas.example.org").ok, true); assert.equal(p.evaluar("alguien@otro.example.org").ok, false);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// ETAPA 1 · el correo del RECEPTOR sale del cliente (clientes.email) de la propia empresa, se puede editar, se valida de nuevo en el servidor y queda atado a la preparación
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const poner = async (bd: Awaited<ReturnType<typeof montar>>["bd"], clienteId: string, email: string | null) => { await bd.filas("update public.clientes set email = $2 where id = $1", [clienteId, email]); };
const DEST_URL = (id: string) => `/api/documentos/${id}/digifact/destinatario`;

Deno.test({ name: "correo del receptor: se recupera de clientes.email (con correo, sin correo, no válido, Consumidor Final) y solo para quien puede certificar con el envío habilitado", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli, ana, crear } = await montar(ENV_ON); const pedro = await new Cli("pedro").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT");
  const id = await crear("dest");
  await poner(bd, cli.id, "cliente.uno@pruebas.example.org");
  let r = await ana.llamar("GET", DEST_URL(id)); assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.json, { clienteId: cli.id, consumidorFinal: false, correo: "cliente.uno@pruebas.example.org", registradoNoValido: false }, "con correo: se ofrece tal cual (y solo estos campos)");
  await poner(bd, cli.id, null); r = await ana.llamar("GET", DEST_URL(id)); assert.deepEqual(r.json, { clienteId: cli.id, consumidorFinal: false, correo: null, registradoNoValido: false }, "sin correo: queda vacío");
  await poner(bd, cli.id, "   "); r = await ana.llamar("GET", DEST_URL(id)); assert.equal(r.json.correo, null); assert.equal(r.json.registradoNoValido, false, "solo espacios = sin correo");
  for (const malo of ["no es correo", "a@b", "uno@pruebas.example.org, dos@pruebas.example.org", "x".repeat(45) + "@pruebas.example.org", "<s>@pruebas.example.org"]) {
    await poner(bd, cli.id, malo); r = await ana.llamar("GET", DEST_URL(id)); assert.equal(r.json.correo, null, `no se ofrece «${malo.slice(0, 20)}»`); assert.equal(r.json.registradoNoValido, true, malo.slice(0, 20));
  }
  await poner(bd, cli.id, "  Con.Espacios@Pruebas.Example.org  "); r = await ana.llamar("GET", DEST_URL(id)); assert.equal(r.json.correo, "Con.Espacios@Pruebas.Example.org", "se recorta; las mayúsculas se respetan (la lista de destinatarios no distingue)");
  // Consumidor Final: el correo es opcional (sin cliente con correo, el campo queda vacío y no se exige nada)
  const cf = est.clientes.find((c: J) => c.tipo_identificacion === "CF");
  if (cf) { await poner(bd, cf.id, null); const d = await ana.llamar("POST", "/api/documentos", { cliente_id: cf.id, establecimiento_id: est.establecimientos[0].id, lineas: [{ descripcion: "Venta de mostrador", cantidad: "1", precio_unitario: "50" }], fecha: new Date().toISOString().slice(0, 10) });
    assert.equal(d.status, 200, d.texto); const x = await ana.llamar("GET", DEST_URL(d.json.documento.id)); assert.deepEqual(x.json, { clienteId: cf.id, consumidorFinal: true, correo: null, registradoNoValido: false }, "Consumidor Final: opcional y vacío"); }
  else assert.fail("el catálogo de la demostración debe traer Consumidor Final");
  // permisos y habilitación: el lector no ve el correo del cliente; sin el interruptor no existe la ruta útil; un documento inexistente no existe
  assert.equal((await pedro.llamar("GET", DEST_URL(id))).status, 403, "el lector no puede elegir el envío por correo, así que no recibe el correo del cliente");
  assert.equal((await ana.llamar("GET", DEST_URL("00000000-0000-0000-0000-00000000dead"))).status, 404);
  const apagado = await montar({}); const idA = await apagado.crear("off"); const x = await apagado.ana.llamar("GET", DEST_URL(idA)); assert.equal(x.status, 403); assert.equal(x.json.codigo, "correo_no_habilitado"); assert.ok(!x.texto.includes("@"), "apagado: ni un correo");
}});

Deno.test({ name: "correo del receptor: aislamiento entre empresas — solo se lee el cliente de la empresa de la sesión y nunca el de otra", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { EMPRESA2 } = await import("../src/mundo_practico.ts");
  // 1) el interruptor rige para UNA empresa: la otra no puede ni consultar el correo de sus propios clientes
  const m1 = await montar(ENV_ON); const id1 = await m1.crear("a1"); const sofia1 = await new m1.Cli("sofia").entrar();
  const est = (await m1.ana.llamar("GET", "/api/estado")).json; await poner(m1.bd, est.clientes.find((c: J) => c.tipo_identificacion === "NIT").id, "secreto.de.ana@pruebas.example.org");
  const a = await sofia1.llamar("GET", DEST_URL(id1)); assert.equal(a.status, 403); assert.ok(!a.texto.includes("secreto.de.ana"), "otra empresa: no habilitado y sin filtrar nada");
  // 2) aunque se habilite para la empresa de Sofía, un documento de Ana no existe para ella: ni el correo ni el id del cliente se filtran
  const m2 = await montar({ ...ENV_ON, FEL_DIGIFACT_CORREO_EMPRESA: EMPRESA2 }); const id2 = await m2.crear("a2"); const sofia2 = await new m2.Cli("sofia").entrar();
  const est2 = (await m2.ana.llamar("GET", "/api/estado")).json; await poner(m2.bd, est2.clientes.find((c: J) => c.tipo_identificacion === "NIT").id, "secreto.de.ana@pruebas.example.org");
  const b = await sofia2.llamar("GET", DEST_URL(id2)); assert.equal(b.status, 404, b.texto); assert.ok(!b.texto.includes("secreto.de.ana") && !b.texto.includes(est2.clientes[0].id), "no se filtra el correo ni el cliente de otra empresa");
  assert.equal((await m2.ana.llamar("GET", DEST_URL(id2))).status, 403, "y Ana, de la otra empresa, tampoco está habilitada");
  // 3) el cliente se busca con la empresa del DOCUMENTO: un cliente de otra empresa no puede aparecer como destinatario aunque el documento lo apuntara
  const ajeno = await m2.bd.filas<{ id: string }>("select id from public.clientes where empresa_id = $1 limit 1", [EMPRESA2]); await poner(m2.bd, ajeno[0].id, "ajeno@pruebas.example.org");
  assert.ok(!(await sofia2.llamar("GET", DEST_URL(id2))).texto.includes("ajeno@"), "el correo de un cliente de Sofía no se mezcla en un documento de Ana");
}});

Deno.test({ name: "correo del receptor: el destinatario queda ATADO a la preparación — cambiar el correo del cliente, el del navegador o repetir no altera a quién se envía; sin duplicados y sin correos completos en la auditoría", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, ana, nucs, autorizar, crear } = await montar(ENV_ON);
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT"), E1 = "uno@pruebas.example.org", E2 = "dos@pruebas.example.org";
  await poner(bd, cli.id, E1); const id = await crear("atado"), id2 = await crear("atado2");
  const p = (await ana.llamar("POST", R(id, "/preparar"), { enviar_correo: true, correo: E1 })).json; assert.match(p.correoRef, /^[0-9a-f]{16}$/, "la preparación devuelve solo una huella del destinatario"); assert.ok(!JSON.stringify(p).includes("uno@"), "ni el correo completo");
  const q = (await ana.llamar("POST", R(id2, "/preparar"), { enviar_correo: true, correo: E1 })).json; assert.notEqual(q.correoRef, p.correoRef, "la huella depende de la operación");
  const base = { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true };
  autorizar(p.referencia);
  // lo que NO puede pasar: certificar con otro correo, sin huella, con una huella ajena o alterada, o sin preparar con correo
  const sinRef = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo: E1 }); assert.equal(sinRef.status, 400); assert.equal(sinRef.json.codigo, "correo_sin_preparacion");
  for (const [correo, ref] of [[E2, p.correoRef], [E1, q.correoRef], [E1, "0".repeat(16)], [E1, p.correoRef.toUpperCase()], [E1.toUpperCase().replace("PRUEBAS.EXAMPLE.ORG", "otro.example.org"), p.correoRef]] as const) {
    const r = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo, correo_ref: ref }); assert.ok([403, 409].includes(r.status), `${correo}/${ref}: ${r.status}`); }
  assert.equal(nucs.length, 0, "nada salió hacia Digifact con un destinatario distinto del preparado");
  // el correo del cliente cambia DESPUÉS de preparar: el destinatario de la operación sigue siendo el preparado
  await poner(bd, cli.id, E2);
  const c = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo: E1, correo_ref: p.correoRef }); assert.equal(c.status, 200, c.texto); assert.equal(nucs.length, 1);
  assert.deepEqual(nucs[0].Buyer.Contact, { EmailList: { Email: [E1] } }, "se envió al correo preparado, no al nuevo del cliente");
  assert.equal(JSON.stringify(nucs[0]).includes(E2), false, "el correo nuevo del cliente no aparece en el NUC");
  // repetir: no se vuelve a enviar nada
  const rep = await ana.llamar("POST", R(id, "/certificar"), { ...base, correo: E1, correo_ref: p.correoRef }); assert.equal(rep.json.reutilizada, true); assert.equal(nucs.length, 1);
  // sin pedir el correo: certifica normal y el NUC no lleva Buyer.Contact (el correo del cliente nunca se agrega por su cuenta)
  const r2 = (await ana.llamar("POST", R(id2, "/preparar"), {})).json; assert.equal(r2.correoRef, undefined); autorizar(r2.referencia);
  const c2 = await ana.llamar("POST", R(id2, "/certificar"), { operacionId: r2.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: r2.referencia, huellaEmisor: r2.huellaEmisor }); assert.equal(c2.status, 200, c2.texto);
  assert.equal(nucs.length, 2); assert.equal(nucs[1].Buyer.Contact, undefined, "con la casilla apagada no viaja ningún correo aunque el cliente tenga uno");
  // auditoría y respuestas: solo correos enmascarados
  const aud = JSON.stringify(await bd.filas("select accion, datos from public.auditoria where accion like 'digifact_test.%'"));
  for (const x of ["uno@pruebas", "dos@pruebas", "E1", E1, E2]) if (x.includes("@")) assert.ok(!aud.includes(x), `la auditoría no guarda «${x.slice(0, 5)}…»`);
  assert.ok(aud.includes("u***@pruebas.example.org"), "sí el correo enmascarado");
}});
