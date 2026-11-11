// Canal asistido con AGENTE LOCAL contra la BASE REAL: orquestador real (sin cambios) + adaptador portal_playwright + agente simulado que usa las funciones del plano de control.
// Cubre: flujo completo, doble clic, descarte, INCERTIDUMBRE tras presentar (sin reintento; conciliación manual de dos personas), caída entre enviar y vincular, aislamiento por empresa y revocación.
import assert from "node:assert/strict";
import { ErrorBd } from "../src/rpc.ts";
import { OrquestadorDb, ProcesoCaido } from "../src/orquestador_db.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../src/portal_playwright.ts";
import { cerrarOrdenes } from "../src/cierre_ordenes.ts";
import { clave, conexion, documentoRevisado, estadoDoc, nuevoMundo, operaciones, parametros, type Mundo } from "./mundo.ts";

const cx = conexion();
const T = (nombre: string, f: () => Promise<void>) => Deno.test({ name: `agente: ${nombre}`, sanitizeOps: false, sanitizeResources: false, fn: f });
const codigo = (e: unknown) => (e instanceof ErrorBd ? e.codigo : e instanceof ProcesoCaido ? "CAIDO" : "otro");
const b64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mundoConAgente() {
  await parametros(cx, 0, 0, 0);
  const m = await nuevoMundo(cx);
  const canal = (await cx.sql.unsafe("select (public.fel_op_canal_configurar($1, $2, null, 'portal_playwright', 'simulado', true)).id as id", [m.propietario, m.empresa]))[0].id as string;
  const agente = await vincular(m, "PC de la empresa");
  const orq = (ganchos?: ConstructorParameters<typeof OrquestadorDb>[2]) => new OrquestadorDb(cx.rpc, new PortalPlaywrightProvider(puertoOrdenesRpc(cx.rpc)), ganchos);
  return { m, canal, agente, orq, doc: await documentoRevisado(cx, m) };
}
async function vincular(m: Mundo, nombre: string): Promise<AgenteSim> {
  const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: m.propietario, p_empresa: m.empresa }) as { codigo: string }).codigo;
  const r = await cx.rpc("fel_sys_agente_vincular", { p_codigo: cod, p_clave_publica: b64(), p_nombre: nombre, p_version: "1.0.0" }) as { agente_id: string; empresa_id: string };
  return agenteSim(r.agente_id);
}
/** Agente simulado: usa EXACTAMENTE las mismas funciones del plano de control que usará el agente real. */
interface AgenteSim { id: string; reclamar(): Promise<{ orden: string; token: number; hash: string } | null>; progreso(o: string, t: number, fase: string): Promise<unknown>; resultado(o: string, t: number, tipo: string, d?: Record<string, string>): Promise<{ estado: string }> }
function agenteSim(id: string): AgenteSim {
  return {
    id,
    reclamar: async () => (await cx.rpc("fel_sys_orden_reclamar", { p_agente: id })) as never,
    progreso: (o, t, fase) => cx.rpc("fel_sys_orden_progreso", { p_agente: id, p_orden: o, p_token: t, p_fase: fase }),
    resultado: async (o, t, tipo, d = {}) => (await cx.rpc("fel_sys_orden_resultado", { p_agente: id, p_orden: o, p_token: t, p_tipo: tipo, p_serie: d.serie ?? null, p_numero: d.numero ?? null, p_autorizacion: d.autorizacion ?? null, p_detalle: d.detalle ?? null })) as { estado: string },
  };
}
const estadoOrden = async (op: string) => (await cx.sql.unsafe("select estado from public.ordenes_emision where operacion_id = $1", [op]))[0]?.estado as string | undefined;
const ordenesDe = async (doc: string) => Number((await cx.sql.unsafe("select count(*)::int as n from public.ordenes_emision where documento_id = $1", [doc]))[0].n);
const EMITIDO = { serie: "SIMA", numero: "00000001", autorizacion: "SIM-AGENTE-1" };

T("flujo completo: NEXA crea la orden → el agente llena y se detiene → la persona confirma → NEXA cierra como certificado SIMULADO", async () => {
  const { m, canal, agente, orq, doc } = await mundoConAgente();
  const s = await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(1), canal });
  assert.equal(s.operacion.estado, "iniciada"); assert.ok(s.operacion.orden_externa, "la operación espera al agente"); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "pendiente_certificacion");
  assert.equal(await estadoOrden(s.operacion.id), "pendiente");
  const r = (await agente.reclamar())!; assert.equal(r.token, 1);
  assert.equal(r.hash, (await cx.sql.unsafe("select public.fel_sys_hash_documento($1, $2) as h", [m.empresa, doc]))[0].h, "el agente recibe el hash calculado por la base");
  await agente.progreso(r.orden, r.token, "llenando"); await agente.progreso(r.orden, r.token, "detenido_en_vista_previa");
  assert.equal((await cerrarOrdenes(cx.rpc, orq())).certificadas, 0, "mientras la persona no confirme nada se cierra"); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "pendiente_certificacion");
  assert.equal((await agente.resultado(r.orden, r.token, "emitido_simulado", EMITIDO)).estado, "completada");
  const c = await cerrarOrdenes(cx.rpc, orq(), { empresaId: m.empresa }); assert.equal(c.certificadas, 1);
  const e = await estadoDoc(cx, doc); assert.equal(e.estado_fiscal, "certificado"); assert.match(String(e.autorizacion_sat), /^SIM-/);
  assert.equal((await cerrarOrdenes(cx.rpc, orq(), { empresaId: m.empresa })).certificadas, 0, "el cierre es idempotente");
  assert.equal((await operaciones(cx, doc)).length, 1);
});

T("doble clic / solicitudes simultáneas: una sola operación y UNA sola orden", async () => {
  const { m, canal, orq, doc } = await mundoConAgente();
  const k = clave("dc");
  const res = await Promise.allSettled([1, 2, 3, 4, 5].map(() => orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: k, canal })));
  assert.ok(res.every((x) => x.status === "fulfilled"), "con la misma clave todas reciben la misma operación: " + JSON.stringify(res.filter((x) => x.status === "rejected")));
  assert.equal((await operaciones(cx, doc)).length, 1); assert.equal(await ordenesDe(doc), 1);
  const otra = await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave("otra"), canal }).catch((e) => e);
  assert.equal(codigo(otra), "FEL_OPERACION_ABIERTA", "con otra clave tampoco se abre una segunda operación"); assert.equal(await ordenesDe(doc), 1);
});

T("claves distintas a la vez: una sola operación y una sola orden", async () => {
  const { m, canal, orq, doc } = await mundoConAgente();
  const res = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(i), canal })));
  for (const r of res) if (r.status === "rejected") assert.ok(["FEL_OPERACION_ABIERTA", "FEL_REGLA", "FEL_POR_VERIFICAR"].includes(codigo(r.reason)), String(r.reason));
  assert.ok(res.some((r) => r.status === "fulfilled")); assert.equal((await operaciones(cx, doc)).length, 1); assert.equal(await ordenesDe(doc), 1);
});

T("la persona descarta en el simulador: rechazo confirmado y se puede volver a intentar con una orden nueva", async () => {
  const { m, canal, agente, orq, doc } = await mundoConAgente();
  const s = await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(1), canal });
  const r = (await agente.reclamar())!; await agente.progreso(r.orden, r.token, "detenido_en_vista_previa");
  assert.equal((await agente.resultado(r.orden, r.token, "descartado")).estado, "descartada");
  assert.equal((await cerrarOrdenes(cx.rpc, orq())).rechazadas, 1); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "rechazado");
  const s2 = await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(2), canal });
  assert.notEqual(s2.operacion.id, s.operacion.id); assert.equal(await ordenesDe(doc), 2, "una orden por operación");
  const r2 = (await agente.reclamar())!; await agente.progreso(r2.orden, r2.token, "detenido_en_vista_previa"); await agente.resultado(r2.orden, r2.token, "emitido_simulado", { ...EMITIDO, autorizacion: "SIM-AGENTE-2" });
  await cerrarOrdenes(cx.rpc, orq()); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "certificado");
});

T("error ANTES de presentar ⇒ fallida (se prueba que nada salió) ⇒ rechazo; error DESPUÉS de presentar ⇒ incierta ⇒ por_verificar", async () => {
  const a = await mundoConAgente();
  const s = await a.orq().solicitar({ actor: a.m.propietario, empresa: a.m.empresa, documento: a.doc, clave: clave(1), canal: a.canal });
  const r = (await a.agente.reclamar())!; assert.equal((await a.agente.resultado(r.orden, r.token, "error", { detalle: "CAMPOS_OBLIGATORIOS" })).estado, "fallida");
  assert.equal((await cerrarOrdenes(cx.rpc, a.orq())).rechazadas, 1); assert.equal((await estadoDoc(cx, a.doc)).estado_fiscal, "rechazado"); void s;
  const b = await mundoConAgente();
  await b.orq().solicitar({ actor: b.m.propietario, empresa: b.m.empresa, documento: b.doc, clave: clave(2), canal: b.canal });
  const r2 = (await b.agente.reclamar())!; await b.agente.progreso(r2.orden, r2.token, "detenido_en_vista_previa");
  assert.equal((await b.agente.resultado(r2.orden, r2.token, "error", { detalle: "PAGINA_PERDIDA" })).estado, "incierta");
  assert.equal((await estadoDoc(cx, b.doc)).estado_fiscal, "por_verificar");
});

T("INCERTIDUMBRE tras presentar: el agente cae con la vista previa abierta ⇒ incierta ⇒ por_verificar, SIN reintento; se resuelve con conciliación manual de dos personas", async () => {
  const { m, canal, agente, orq, doc } = await mundoConAgente();
  const s = await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(1), canal });
  const r = (await agente.reclamar())!; await agente.progreso(r.orden, r.token, "detenido_en_vista_previa");
  await cx.sql.unsafe("update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id = $1", [r.orden]);   // el agente murió: el arrendamiento vence
  const c = await cerrarOrdenes(cx.rpc, orq(), { empresaId: m.empresa }); assert.equal(c.vencidas, 1);
  assert.equal(await estadoOrden(s.operacion.id), "incierta"); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "por_verificar");
  assert.equal(await agente.reclamar(), null, "no se reasigna");
  assert.equal(codigo(await orq().solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(2), canal }).catch((e) => e)), "FEL_POR_VERIFICAR", "ni con otra clave");
  const rec = await orq().recuperar({ umbralMin: 0, empresaId: m.empresa }); assert.equal(rec.liberadas_sin_envio, 0, "la recuperación tampoco la libera");
  assert.equal(await ordenesDe(doc), 1); assert.equal((await operaciones(cx, doc)).length, 1);
  assert.equal(codigo(await agente.resultado(r.orden, r.token, "emitido_simulado", EMITIDO).catch((e) => e)), "FEL_ESTADO", "una respuesta tardía del agente no cierra nada");
  const con = await orq().conciliar(m.empresa, s.operacion.id); assert.equal(con.resultado, "indeterminado"); assert.equal(con.aplicado, "sin_cambio");   // el canal no puede decidir
  const prop = await cx.rpc("fel_op_conciliacion_proponer", { p_actor: m.propietario, p_empresa: m.empresa, p_op: s.operacion.id, p_tipo: "manual_fallida",
    p_evidencia: { fuente: "documento_fisico", referencia: "revision-visual-agente", fecha_consulta: new Date().toISOString(), conclusion: "no_figura" }, p_datos: null }) as { id: string };
  await cx.rpc("fel_op_conciliacion_decidir", { p_actor: m.admin2, p_empresa: m.empresa, p_conciliacion: prop.id, p_aprobar: true, p_nota: "segunda persona verifica" });
  assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "rechazado");
});

T("caída entre ENVIAR y vincular la orden: queda por verificar, la orden se cancela y nunca se entrega al agente", async () => {
  const { m, canal, agente, orq, doc } = await mundoConAgente();
  const caida = await orq({ ganchos: { despuesDeEnviar: () => { throw new ProcesoCaido("tras crear la orden"); } } }).solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: clave(1), canal }).catch((e) => e);
  assert.equal(codigo(caida), "CAIDO"); assert.equal(await ordenesDe(doc), 1);
  assert.equal(await agente.reclamar(), null, "una orden sin vincular a su operación no se entrega");
  const rec = await orq().recuperar({ umbralMin: 0, empresaId: m.empresa }); assert.equal(rec.marcadas_desconocidas, 1);
  assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "por_verificar");
  assert.equal(await agente.reclamar(), null); assert.equal(await estadoOrden((await operaciones(cx, doc))[0].id as string), "cancelada", "la orden de una operación ya no abierta se cancela");
  assert.equal(await ordenesDe(doc), 1, "no se creó ninguna orden más");
});

T("aislamiento: un agente solo ve y actúa sobre las órdenes de SU empresa; un agente revocado no puede nada", async () => {
  const a = await mundoConAgente(), b = await mundoConAgente();
  await a.orq().solicitar({ actor: a.m.propietario, empresa: a.m.empresa, documento: a.doc, clave: clave(1), canal: a.canal });
  assert.equal(await b.agente.reclamar(), null, "el agente de B no recibe órdenes de A");
  const r = (await a.agente.reclamar())!;
  assert.equal(codigo(await b.agente.progreso(r.orden, r.token, "llenando").catch((e) => e)), "FEL_EMPRESA");
  assert.equal(codigo(await b.agente.resultado(r.orden, r.token, "descartado").catch((e) => e)), "FEL_EMPRESA");
  const intruso = await vincular(a.m, "segundo equipo de A");
  assert.equal(codigo(await intruso.progreso(r.orden, r.token, "llenando").catch((e) => e)), "FEL_FENCING", "otro agente de la misma empresa tampoco");
  await cx.rpc("fel_op_agente_revocar", { p_actor: a.m.propietario, p_empresa: a.m.empresa, p_agente: a.agente.id });
  assert.equal(codigo(await a.agente.reclamar().catch((e) => e)), "FEL_REVOCADO"); assert.equal(codigo(await a.agente.progreso(r.orden, r.token, "llenando").catch((e) => e)), "FEL_REVOCADO");
  assert.equal(await estadoOrden((await operaciones(cx, a.doc))[0].id as string), "pendiente", "al revocar antes de presentar, la orden vuelve a la cola");
  assert.ok(await intruso.reclamar(), "otro agente de la empresa puede tomarla");
});

T("cierre de conexión", async () => { await cx.cerrar(); });
