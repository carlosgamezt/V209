// PLANO DE CONTROL del agente contra la BASE REAL: firma Ed25519, nonce, caducidad, aislamiento entre empresas, respuestas HTTP seguras
// y supervisor de vencimientos que actúa SIN que ningún agente haga solicitudes. Todo simulado: sin red externa, sin credenciales, sin canales reales.
import assert from "node:assert/strict";
import { cabecerasFirmadas, generarParClaves } from "../src/firma_agente.ts";
import { crearPlanoControl, PREFIJO_AGENTE, type EventoPlano } from "../src/plano_control_agente.ts";
import { crearSupervisor } from "../src/supervisor_ordenes.ts";
import { cerrarOrdenes } from "../src/cierre_ordenes.ts";
import { OrquestadorDb } from "../src/orquestador_db.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../src/portal_playwright.ts";
import { clave, conexion, documentoRevisado, estadoDoc, nuevoMundo, parametros, type Mundo } from "./mundo.ts";

const cx = conexion();
const eventos: EventoPlano[] = [];
const plano = crearPlanoControl({ rpc: cx.rpc, registrar: (e) => eventos.push(e) });
const T = (n: string, f: () => Promise<void>) => Deno.test({ name: `plano de control: ${n}`, sanitizeOps: false, sanitizeResources: false, fn: f });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Par = Awaited<ReturnType<typeof generarParClaves>>;
interface Equipo { id: string; par: Par; m: Mundo; canal: string }

const url = (op: string) => `http://127.0.0.1${PREFIJO_AGENTE}${op}`;
async function enviar(op: string, cuerpo: unknown, cab: Record<string, string> = { "content-type": "application/json" }, metodo = "POST"): Promise<{ status: number; json: Record<string, unknown>; headers: Headers; texto: string }> {
  const r = await plano(new Request(url(op), { method: metodo, headers: cab, body: metodo === "GET" ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }));
  const texto = await r.text(); let json: Record<string, unknown> = {}; try { json = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, json, headers: r.headers, texto };
}
/** Petición correctamente firmada por el equipo (con alteraciones opcionales). */
async function firmada(e: Equipo, op: string, cuerpo: Record<string, unknown> = {}, o: { ts?: string; nonce?: string; rutaFirmada?: string; cuerpoFirmado?: string } = {}) {
  const texto = JSON.stringify(cuerpo);
  const cab = await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: o.rutaFirmada ?? `${PREFIJO_AGENTE}${op}`, cuerpo: o.cuerpoFirmado ?? texto, ts: o.ts, nonce: o.nonce });
  return enviar(op, texto, cab);
}
async function nuevoEquipo(nombre = "PC de la empresa"): Promise<Equipo> {
  await parametros(cx, 0, 0, 0);
  const m = await nuevoMundo(cx);
  const canal = (await cx.sql.unsafe("select (public.fel_op_canal_configurar($1, $2, null, 'portal_playwright', 'simulado', true)).id as id", [m.propietario, m.empresa]))[0].id as string;
  const par = await generarParClaves();
  const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: m.propietario, p_empresa: m.empresa }) as { codigo: string }).codigo;
  const r = await enviar("vincular", { codigo: cod, clave_publica: par.publica, nombre, version: "1.0.0" });
  assert.equal(r.status, 200, r.texto);
  return { id: r.json.agente_id as string, par, m, canal };
}
const orqPortal = () => new OrquestadorDb(cx.rpc, new PortalPlaywrightProvider(puertoOrdenesRpc(cx.rpc)));
async function ordenPendiente(e: Equipo): Promise<{ doc: string; op: string }> {
  const doc = await documentoRevisado(cx, e.m);
  const s = await orqPortal().solicitar({ actor: e.m.propietario, empresa: e.m.empresa, documento: doc, clave: clave("pc"), canal: e.canal });
  return { doc, op: s.operacion.id };
}
const estadoOrden = async (op: string) => (await cx.sql.unsafe("select estado from public.ordenes_emision where operacion_id = $1", [op]))[0]?.estado as string | undefined;
const EMITIDO = { serie: "SIMA", numero: "00000001", autorizacion: "SIM-PLANO-1" };

T("vinculación por HTTP: código de un solo uso, ligado a la empresa del código; códigos inválidos, repetidos y entradas mal formadas se rechazan", async () => {
  const e = await nuevoEquipo();
  const [a] = await cx.sql.unsafe("select empresa_id, estado from public.agentes_locales where id = $1", [e.id]); assert.equal(a.empresa_id, e.m.empresa); assert.equal(a.estado, "activo");
  const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: e.m.propietario, p_empresa: e.m.empresa }) as { codigo: string }).codigo, par2 = await generarParClaves();
  assert.equal((await enviar("vincular", { codigo: "AAAA-BBBB-CCCC", clave_publica: par2.publica, nombre: "x" })).json.codigo, "FEL_CODIGO");
  assert.equal((await enviar("vincular", { codigo: cod, clave_publica: "corta", nombre: "x" })).status, 422);
  const ok = await enviar("vincular", { codigo: cod, clave_publica: par2.publica, nombre: "segundo equipo" }); assert.equal(ok.status, 200);
  const rep = await enviar("vincular", { codigo: cod, clave_publica: (await generarParClaves()).publica, nombre: "copia" }); assert.equal(rep.status, 403); assert.equal(rep.json.codigo, "FEL_CODIGO", "un código se usa una sola vez");
  assert.equal((await enviar("vincular", { clave_publica: par2.publica, nombre: "x" })).status, 422);
  assert.equal((await enviar("vincular", { codigo: 7, clave_publica: par2.publica, nombre: "x" })).status, 422);
});

T("HTTP seguro: método, ruta, tipo de contenido, tamaño y JSON; mensajes genéricos, sin trazas ni SQL, sin caché", async () => {
  const e = await nuevoEquipo();
  const g = await enviar("latido", {}, {}, "GET"); assert.equal(g.status, 405); assert.equal(g.headers.get("allow"), "POST");
  assert.equal((await enviar("inexistente", {})).status, 404);
  assert.equal((await plano(new Request("http://127.0.0.1/api/agente/v1/", { method: "POST" }))).status, 404);
  assert.equal((await enviar("latido", "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await enviar("latido", "{no es json", { "content-type": "application/json" })).status, 400);
  assert.equal((await enviar("latido", "[1,2]", { "content-type": "application/json" })).status, 400);
  const grande = await enviar("latido", JSON.stringify({ x: "a".repeat(70 * 1024) }), { "content-type": "application/json" }); assert.equal(grande.status, 413);
  const sinFirma = await enviar("latido", {}); assert.equal(sinFirma.status, 401);
  for (const r of [g, sinFirma, grande]) {
    assert.deepEqual(Object.keys(r.json).sort(), ["codigo", "mensaje", "ok"], "solo código y mensaje"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.doesNotMatch(r.texto, /stack|postgres|select |ERROR|at file|Deno|public\.|fel_sys|sqlstate/i);
  }
  // un fallo inesperado de la base responde 500 genérico, sin el mensaje interno
  const roto = crearPlanoControl({ rpc: () => Promise.reject(new Error("password=secreto host=db-interna")) });
  const ok = await firmadaCon(roto, e, "latido"); assert.equal(ok.status, 500); assert.equal(ok.json.codigo, "FEL_INTERNO"); assert.doesNotMatch(ok.texto, /secreto|db-interna/);
});
async function firmadaCon(manejador: (r: Request) => Promise<Response>, e: Equipo, op: string) {
  const cuerpo = "{}", cab = await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: `${PREFIJO_AGENTE}${op}`, cuerpo });
  const r = await manejador(new Request(url(op), { method: "POST", headers: cab, body: cuerpo })); const texto = await r.text(); return { status: r.status, json: JSON.parse(texto) as Record<string, unknown>, texto };
}

T("firma: válida ⇒ 200; alterar cuerpo, ruta, marca de tiempo o cabeceras ⇒ 401 uniforme; agente desconocido = firma inválida (sin oráculo)", async () => {
  const e = await nuevoEquipo();
  assert.equal((await firmada(e, "latido", { version: "1.0.1" })).status, 200);
  const alterado = await firmada(e, "latido", { version: "6.6.6" }, { cuerpoFirmado: JSON.stringify({ version: "1.0.1" }) }); assert.equal(alterado.status, 401); assert.equal(alterado.json.codigo, "FEL_FIRMA");
  assert.equal((await firmada(e, "reclamar", {}, { rutaFirmada: `${PREFIJO_AGENTE}latido` })).status, 401, "una firma de latido no sirve para reclamar");
  const cab = await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: `${PREFIJO_AGENTE}latido`, cuerpo: "{}", ts: new Date().toISOString() });
  assert.equal((await enviar("latido", "{}", { ...cab, "x-ts": new Date(Date.now() + 1000).toISOString() })).status, 401, "cambiar la marca de tiempo invalida la firma");
  for (const k of ["x-agente", "x-ts", "x-nonce", "x-firma"]) { const sin = { ...cab }; delete sin[k]; assert.equal((await enviar("latido", "{}", sin)).status, 401, `sin ${k}`); }
  for (const [k, v] of [["x-agente", "no-es-uuid"], ["x-ts", "ayer"], ["x-nonce", "corto"], ["x-firma", "xyz"]]) assert.equal((await enviar("latido", "{}", { ...cab, [k]: v })).status, 401, `${k} mal formada`);
  const otro = await generarParClaves(); const ajena = await cabecerasFirmadas({ agenteId: e.id, privada: otro.privada, ruta: `${PREFIJO_AGENTE}latido`, cuerpo: "{}" });
  const r1 = await enviar("latido", "{}", ajena);   // firma de OTRA clave sobre un agente real
  const desconocido = await cabecerasFirmadas({ agenteId: crypto.randomUUID(), privada: otro.privada, ruta: `${PREFIJO_AGENTE}latido`, cuerpo: "{}" });
  const r2 = await enviar("latido", "{}", desconocido);
  assert.equal(r1.status, 401); assert.equal(r2.status, 401); assert.equal(r1.texto, r2.texto, "agente desconocido y firma inválida reciben exactamente la misma respuesta");
});

T("nonce de un solo uso; la firma se verifica ANTES de consumirlo; marcas de tiempo vencidas o futuras se rechazan y el error de reloj queda visible", async () => {
  const e = await nuevoEquipo();
  const n = "nonce-unico-" + crypto.randomUUID().slice(0, 12);
  const mala = await cabecerasFirmadas({ agenteId: e.id, privada: (await generarParClaves()).privada, ruta: `${PREFIJO_AGENTE}latido`, cuerpo: "{}", nonce: n });
  assert.equal((await enviar("latido", "{}", mala)).status, 401);   // firma inválida: NO gasta el nonce
  assert.equal((await firmada(e, "latido", {}, { nonce: n })).status, 200, "el nonce no se quemó con la petición inválida");
  const rep = await firmada(e, "latido", {}, { nonce: n }); assert.equal(rep.status, 401); assert.equal(rep.json.codigo, "FEL_REPETICION");
  const concurrentes = await Promise.all(Array.from({ length: 6 }, () => firmada(e, "latido", {}, { nonce: "concurrente-" + n })));
  assert.equal(concurrentes.filter((r) => r.status === 200).length, 1, "con el mismo nonce a la vez, solo una petición pasa");
  const viejo = await firmada(e, "latido", {}, { ts: new Date(Date.now() - 5 * 60_000).toISOString() }); assert.equal(viejo.status, 401); assert.equal(viejo.json.codigo, "FEL_RELOJ");
  assert.equal((await firmada(e, "latido", {}, { ts: new Date(Date.now() + 5 * 60_000).toISOString() })).json.codigo, "FEL_RELOJ", "una marca del futuro también caduca");
  assert.equal((await cx.sql.unsafe("select error_codigo from public.agentes_locales where id = $1", [e.id]))[0].error_codigo, "RELOJ", "el desfase queda registrado como error del agente");
  assert.equal((await firmada(e, "latido", {})).status, 200); const l = await cx.rpc("fel_op_agentes_listar", { p_actor: e.m.propietario, p_empresa: e.m.empresa }) as { estado: string }[];
  assert.equal(l[0].estado, "conectado", "con un latido correcto el error de reloj desaparece");
});

T("flujo completo por HTTP firmado: reclamar → progreso → resultado; el cierre en NEXA certifica (simulado)", async () => {
  const e = await nuevoEquipo(); const { doc, op } = await ordenPendiente(e);
  const r = await firmada(e, "reclamar"); const o = r.json.orden as { orden: string; token: number; hash: string; ambiente: string }; assert.equal(r.status, 200); assert.equal(o.token, 1); assert.equal(o.ambiente, "simulado");
  assert.equal((await firmada(e, "progreso", { orden: o.orden, token: o.token, fase: "llenando" })).status, 200);
  assert.equal((await firmada(e, "progreso", { orden: o.orden, token: o.token, fase: "detenido_en_vista_previa" })).json.estado, "llenada");
  assert.equal((await firmada(e, "resultado", { orden: o.orden, token: o.token, tipo: "emitido_simulado", ...EMITIDO })).json.estado, "completada");
  assert.equal((await cerrarOrdenes(cx.rpc, orqPortal(), { empresaId: e.m.empresa })).certificadas, 1);
  const est = await estadoDoc(cx, doc); assert.equal(est.estado_fiscal, "certificado"); assert.match(String(est.autorizacion_sat), /^SIM-/); assert.equal(await estadoOrden(op), "completada");
});

T("validación de entradas y fencing: token, orden, fase y tipos; una autorización que no es SIM- no se acepta; respuestas tardías de un token viejo", async () => {
  const e = await nuevoEquipo(); await ordenPendiente(e);
  const o = (await firmada(e, "reclamar")).json.orden as { orden: string; token: number };
  for (const mal of [{ orden: "x", token: 1, fase: "llenando" }, { orden: o.orden, token: "1", fase: "llenando" }, { orden: o.orden, token: 0, fase: "llenando" }, { orden: o.orden, token: 1.5, fase: "llenando" }, { orden: o.orden, token: 1 }]) {
    assert.equal((await firmada(e, "progreso", mal)).status, 422, JSON.stringify(mal));
  }
  assert.equal((await firmada(e, "progreso", { orden: o.orden, token: 1, fase: "fase-rara" })).status, 422);
  assert.equal((await firmada(e, "latido", { version: "x".repeat(41) })).status, 422);
  const tok = await firmada(e, "progreso", { orden: o.orden, token: 99, fase: "llenando" }); assert.equal(tok.status, 409); assert.equal(tok.json.codigo, "FEL_FENCING");
  await firmada(e, "progreso", { orden: o.orden, token: o.token, fase: "detenido_en_vista_previa" });
  const real = await firmada(e, "resultado", { orden: o.orden, token: o.token, tipo: "emitido_simulado", serie: "A", numero: "1", autorizacion: "AUTORIZACION-REAL" }); assert.equal(real.status, 422, "sin prefijo SIM- se rechaza");
  assert.equal((await firmada(e, "resultado", { orden: o.orden, token: o.token, tipo: "emitido_simulado", ...EMITIDO })).status, 200);
  assert.equal((await firmada(e, "resultado", { orden: o.orden, token: o.token, tipo: "emitido_simulado", ...EMITIDO, autorizacion: "SIM-OTRA" })).status, 409, "no se emite dos veces");
});

T("aislamiento entre empresas: la empresa sale del agente, no del cuerpo; un equipo no ve ni toca órdenes ajenas; revocado ⇒ 403 solo con firma válida", async () => {
  const a = await nuevoEquipo("equipo A"), b = await nuevoEquipo("equipo B"); await ordenPendiente(a);
  assert.equal(((await firmada(b, "reclamar", { empresa_id: a.m.empresa })).json as { orden: unknown }).orden, null, "el cuerpo no puede cambiar la empresa: B no recibe la orden de A");
  const o = (await firmada(a, "reclamar")).json.orden as { orden: string; token: number };
  const cruzado = await firmada(b, "progreso", { orden: o.orden, token: o.token, fase: "llenando", empresa_id: a.m.empresa }); assert.equal(cruzado.status, 403); assert.equal(cruzado.json.codigo, "FEL_EMPRESA");
  assert.equal((await firmada(b, "resultado", { orden: o.orden, token: o.token, tipo: "descartado" })).json.codigo, "FEL_EMPRESA");
  assert.equal(await estadoOrden((await cx.sql.unsafe("select operacion_id from public.ordenes_emision where id = $1", [o.orden]))[0].operacion_id), "reclamada", "la orden de A no cambió");
  await cx.rpc("fel_op_agente_revocar", { p_actor: a.m.propietario, p_empresa: a.m.empresa, p_agente: a.id });
  const rev = await firmada(a, "latido"); assert.equal(rev.status, 403); assert.equal(rev.json.codigo, "FEL_REVOCADO");
  const cab = await cabecerasFirmadas({ agenteId: a.id, privada: (await generarParClaves()).privada, ruta: `${PREFIJO_AGENTE}latido`, cuerpo: "{}" });
  assert.equal((await enviar("latido", "{}", cab)).status, 401, "sin la clave privada nadie sabe que el equipo fue revocado");
});

T("registro de eventos del plano de control: sin firmas, nonces, tokens ni cuerpos", async () => {
  const e = await nuevoEquipo(); await firmada(e, "latido"); await firmada(e, "reclamar");
  assert.ok(eventos.length > 5); const texto = JSON.stringify(eventos);
  assert.doesNotMatch(texto, /x-firma|nonce|token|clave_publica|codigo_hash/i); for (const ev of eventos) assert.deepEqual(Object.keys(ev).filter((k) => !["op", "codigo", "status", "ms", "agente"].includes(k)), []);
});

T("SUPERVISOR: las órdenes vencidas cambian solas de estado aunque NINGÚN agente haga solicitudes", async () => {
  const e = await nuevoEquipo(); const orq = orqPortal();
  const a = await ordenPendiente(e);                                                   // orden presentada que vencerá ⇒ incierta
  const o = (await firmada(e, "reclamar")).json.orden as { orden: string; token: number };
  await firmada(e, "progreso", { orden: o.orden, token: o.token, fase: "detenido_en_vista_previa" });
  const e2 = await nuevoEquipo("otro"); const b = await ordenPendiente(e2);           // orden reclamada (sin presentar) que vencerá ⇒ vuelve a la cola
  await firmada(e2, "reclamar");
  await cx.sql.unsafe("update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where operacion_id = any($1::uuid[])", [[a.op, b.op]]);
  assert.equal(await estadoOrden(a.op), "llenada"); assert.equal(await estadoOrden(b.op), "reclamada");
  const solicitudesDelAgente = eventos.length;
  const s = crearSupervisor({ rpc: cx.rpc, cerrar: () => cerrarOrdenes(cx.rpc, orq), intervaloMs: 50 }); s.iniciar();
  const limite = Date.now() + 5000; while (Date.now() < limite && (await estadoOrden(a.op) !== "incierta" || await estadoOrden(b.op) !== "pendiente")) await dormir(50);
  await s.detener();
  assert.equal(eventos.length, solicitudesDelAgente, "ningún agente hizo solicitudes mientras tanto");
  assert.equal(await estadoOrden(a.op), "incierta"); assert.equal((await estadoDoc(cx, a.doc)).estado_fiscal, "por_verificar", "la operación pasó sola a por_verificar");
  assert.equal(await estadoOrden(b.op), "pendiente", "antes de presentar, vuelve sola a la cola"); assert.equal((await estadoDoc(cx, b.doc)).estado_fiscal, "pendiente_certificacion");
  assert.ok(s.salud().vencidas_total >= 2 && s.salud().ciclos >= 1);
  // una respuesta tardía del agente de A tampoco cierra nada
  assert.equal((await firmada(e, "resultado", { orden: o.orden, token: o.token, tipo: "emitido_simulado", ...EMITIDO })).status, 409);
  assert.equal((await estadoDoc(cx, a.doc)).estado_fiscal, "por_verificar");
});

T("cierre de conexión", async () => { await cx.cerrar(); });
