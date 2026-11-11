// TRANSPORTE REMOTO (8a) contra la BASE REAL: respuestas firmadas por NEXA y ligadas a cada petición, política de versiones, sondeo adaptativo del servidor, métricas por empresa,
// distribución de claves y aislamiento entre empresas. Todo local y simulado.
import assert from "node:assert/strict";
import { cabecerasFirmadas, generarParClaves, b64u } from "../src/firma_agente.ts";
import { crearPlanoControl, PREFIJO_AGENTE } from "../src/plano_control_agente.ts";
import { crearFirmanteRespuestas, firmarAnuncio, verificarRespuestaFirmada } from "../src/firma_respuesta.ts";
import { crearMetricas } from "../src/metricas_agente.ts";
import { OrquestadorDb } from "../src/orquestador_db.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../src/portal_playwright.ts";
import { codificarVersion } from "../src/politica_agente.ts";
import { ErrorBd } from "../src/rpc.ts";
import { clave, conexion, documentoRevisado, nuevoMundo, parametros, type Mundo } from "./mundo.ts";

const cx = conexion();
const T = (n: string, f: () => Promise<void>) => Deno.test({ name: `transporte remoto: ${n}`, sanitizeOps: false, sanitizeResources: false, fn: f });
const nexa = await generarParClaves(), nexa2 = await generarParClaves();
const anuncio = await firmarAnuncio({ kid: "k1", privada: nexa.privada }, { kid: "k2", publica: nexa2.publica, desde: "2020-01-01T00:00:00Z", hasta: null });
const firmante = crearFirmanteRespuestas({ kid: "k1", privada: nexa.privada, anuncios: [anuncio] });
const metricas = crearMetricas({ rpc: cx.rpc });
const plano = crearPlanoControl({ rpc: cx.rpc, firmante, metricas });
type Par = Awaited<ReturnType<typeof generarParClaves>>;
interface Equipo { id: string; par: Par; m: Mundo; canal: string }
const N = () => b64u(crypto.getRandomValues(new Uint8Array(18)));
const url = (op: string) => `http://127.0.0.1${PREFIJO_AGENTE}${op}`;
const poner = (k: string, v: number) => cx.sql.unsafe("update public.plataforma_parametros set valor = $2 where clave = $1", [k, v]);

interface Resp { status: number; json: Record<string, unknown>; headers: Headers; bytes: Uint8Array; nonce: string }
async function enviar(op: string, cuerpo: unknown, cab: Record<string, string>, metodo = "POST"): Promise<Resp> {
  const r = await plano(new Request(url(op), { method: metodo, headers: cab, body: metodo === "GET" ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }));
  const bytes = new Uint8Array(await r.arrayBuffer()); let json: Record<string, unknown> = {}; try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* sin JSON */ }
  return { status: r.status, json, headers: r.headers, bytes, nonce: cab["x-nonce"] ?? "-" };
}
async function firmada(e: Equipo, op: string, cuerpo: Record<string, unknown> = {}, o: { version?: string | null } = {}): Promise<Resp> {
  const conVersion = (op === "reclamar" || op === "latido") && o.version !== null ? { version: o.version ?? "1.0.0", ...cuerpo } : cuerpo;
  const t = JSON.stringify(conVersion), nonce = N();
  return enviar(op, t, await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: `${PREFIJO_AGENTE}${op}`, cuerpo: t, nonce }));
}
const autentica = (r: Resp, pub = nexa.publica) => verificarRespuestaFirmada(pub, { kid: r.headers.get("x-nexa-kid") ?? "", nonce: r.nonce, status: r.status, ts: r.headers.get("x-nexa-ts") ?? "", firma: r.headers.get("x-nexa-firma") ?? "", cuerpo: r.bytes });
async function equipo(m?: Mundo): Promise<Equipo> {
  await parametros(cx, 0, 0, 0);
  m ??= await nuevoMundo(cx);
  const canal = (await cx.sql.unsafe("select (public.fel_op_canal_configurar($1, $2, null, 'portal_playwright', 'simulado', true)).id as id", [m.propietario, m.empresa]))[0].id as string;
  const par = await generarParClaves(); const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: m.propietario, p_empresa: m.empresa }) as { codigo: string }).codigo;
  const t = JSON.stringify({ codigo: cod, clave_publica: par.publica, nombre: "PC", version: "1.0.0" }), nonce = N();
  const r = await enviar("vincular", t, { "content-type": "application/json", "x-nonce": nonce }); assert.equal(r.status, 200, JSON.stringify(r.json));
  return { id: r.json.agente_id as string, par, m, canal };
}
async function ordenPendiente(e: Equipo) {
  const doc = await documentoRevisado(cx, e.m);
  const orq = new OrquestadorDb(cx.rpc, new PortalPlaywrightProvider(puertoOrdenesRpc(cx.rpc)));
  const s = await orq.solicitar({ actor: e.m.propietario, empresa: e.m.empresa, documento: doc, clave: clave("tr"), canal: e.canal }); return { doc, op: s.operacion.id };
}
const codigo = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof ErrorBd ? e.codigo : `otro:${e}`; } };
const restaurar = async () => { await poner("agente_version_minima", 0); await poner("agente_version_recomendada", 0); await poner("agente_sondeo_activo_ms", 3000); await poner("agente_sondeo_reposo_ms", 30000); await poner("agente_actividad_reciente_seg", 300); };

T("TODA respuesta (incluidos los errores) va firmada por NEXA y ligada al nonce de la petición; el estado, el cuerpo o el nonce alterados no verifican", async () => {
  await restaurar(); const e = await equipo();
  const respuestas: [string, Resp][] = [];
  respuestas.push(["latido", await firmada(e, "latido")]); respuestas.push(["reclamar", await firmada(e, "reclamar")]);
  respuestas.push(["progreso inválido", await firmada(e, "progreso", { orden: crypto.randomUUID(), token: 1, fase: "llenando" })]);
  respuestas.push(["datos inválidos", await firmada(e, "progreso", { orden: "x", token: 1, fase: "llenando" })]);
  const n405 = N(); respuestas.push(["405", await enviar("latido", "", { "x-nonce": n405 }, "GET")]);
  const n404 = N(); respuestas.push(["404", await enviar("nadie", "{}", { "content-type": "application/json", "x-nonce": n404 })]);
  const n415 = N(); respuestas.push(["415", await enviar("latido", "x", { "content-type": "text/plain", "x-nonce": n415 })]);
  const n400 = N(); respuestas.push(["400", await enviar("latido", "{no json", { "content-type": "application/json", "x-nonce": n400 })]);
  const t = JSON.stringify({}), nonceMal = N(); respuestas.push(["401 firma inválida", await enviar("reclamar", t, { ...(await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: `${PREFIJO_AGENTE}reclamar`, cuerpo: "{\"otro\":1}", nonce: nonceMal })) })]);
  respuestas.push(["401 agente desconocido", await enviar("reclamar", t, { ...(await cabecerasFirmadas({ agenteId: crypto.randomUUID(), privada: e.par.privada, ruta: `${PREFIJO_AGENTE}reclamar`, cuerpo: t, nonce: N() })) })]);
  for (const [nombre, r] of respuestas) { assert.ok(r.headers.get("x-nexa-firma"), `${nombre}: sin firma`); assert.equal(await autentica(r), true, nombre); assert.equal(r.headers.get("x-nexa-kid"), "k1"); }
  const r = respuestas[1][1];
  assert.equal(await verificarRespuestaFirmada(nexa.publica, { kid: "k1", nonce: N(), status: r.status, ts: r.headers.get("x-nexa-ts")!, firma: r.headers.get("x-nexa-firma")!, cuerpo: r.bytes }), false, "otro nonce: respuesta repetida contra otra petición");
  assert.equal(await verificarRespuestaFirmada(nexa.publica, { kid: "k1", nonce: r.nonce, status: 403, ts: r.headers.get("x-nexa-ts")!, firma: r.headers.get("x-nexa-firma")!, cuerpo: r.bytes }), false, "estado alterado");
  assert.equal(await verificarRespuestaFirmada(nexa.publica, { kid: "k1", nonce: r.nonce, status: r.status, ts: r.headers.get("x-nexa-ts")!, firma: r.headers.get("x-nexa-firma")!, cuerpo: new TextEncoder().encode("{}") }), false, "cuerpo alterado");
  assert.equal(await autentica(r, nexa2.publica), false, "otra clave pública");
  // sin oráculo: agente desconocido y firma inválida reciben el mismo cuerpo
  assert.deepEqual(respuestas[8][1].json, respuestas[9][1].json); assert.equal(respuestas[8][1].status, 401);
  // un 403 de revocación también va firmado (solo así el agente puede confiar en él)
  await cx.rpc("fel_op_agente_revocar", { p_actor: e.m.propietario, p_empresa: e.m.empresa, p_agente: e.id });
  const rev = await firmada(e, "reclamar"); assert.equal(rev.status, 403); assert.equal(rev.json.codigo, "FEL_REVOCADO"); assert.equal(await autentica(rev), true);
});

T("sin firmante (compatibilidad) el plano responde igual pero sin cabeceras de firma", async () => {
  const sinFirma = crearPlanoControl({ rpc: cx.rpc }); const e = await equipo(); const t = JSON.stringify({ version: "1.0.0" });
  const r = await sinFirma(new Request(url("reclamar"), { method: "POST", headers: await cabecerasFirmadas({ agenteId: e.id, privada: e.par.privada, ruta: `${PREFIJO_AGENTE}reclamar`, cuerpo: t }), body: t }));
  assert.equal(r.status, 200); assert.equal(r.headers.get("x-nexa-firma"), null); await r.body?.cancel();
});

T("VERSIÓN MÍNIMA: bloquea órdenes nuevas (426 firmado) pero deja terminar las ya reclamadas; versión ilegible = 0.0.0; el latido avisa; vincular se bloquea ANTES de gastar el código", async () => {
  await restaurar(); const e = await equipo(); const o = await ordenPendiente(e);
  assert.equal((await firmada(e, "reclamar")).json.orden !== null, true, "sin mínimo se recibe la orden");   // queda reclamada por este agente
  const orden = ((await cx.sql.unsafe("select id, token from public.ordenes_emision where operacion_id = $1", [o.op]))[0]) as unknown as { id: string; token: number };
  const e2 = await equipo(), o2 = await ordenPendiente(e2);          // (se vincula con 1.0.0 ANTES de subir el mínimo)
  await poner("agente_version_minima", codificarVersion("1.0.1"));
  for (const v of ["1.0.0", "0.9.9", "abc", "1.0", ""] as const) { const r = await firmada(e2, "reclamar", {}, { version: v }); assert.equal(r.status, 426, v); assert.equal(r.json.codigo, "FEL_VERSION"); assert.equal((r.json.politica as { bloqueado: boolean }).bloqueado, true); assert.equal(await autentica(r), true); }
  const sinVersion = await firmada(e2, "reclamar", {}, { version: null }); assert.equal(sinVersion.status, 426, "un agente viejo que no informa versión queda bloqueado");
  assert.equal((await cx.sql.unsafe("select estado from public.ordenes_emision where operacion_id = $1", [o2.op]))[0].estado, "pendiente", "no se le dio ninguna orden");
  const lat = await firmada(e2, "latido"); assert.equal(lat.status, 200); assert.equal((lat.json.politica as { bloqueado: boolean }).bloqueado, true); assert.equal((lat.json.politica as { version_minima: number }).version_minima, 1_000_001);
  assert.equal((await firmada(e2, "reclamar", {}, { version: "1.0.1" })).json.orden !== null, true, "con la versión mínima sí recibe órdenes");
  // la orden que este agente (versión vieja) ya tenía puede terminar
  const r1 = await firmada(e, "progreso", { orden: orden.id, token: Number(orden.token), fase: "detenido_en_vista_previa" }); assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal((await firmada(e, "resultado", { orden: orden.id, token: Number(orden.token), tipo: "descartado", detalle: "x" })).status, 200);
  // vincular con versión vieja: se rechaza antes de consumir el código
  const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: e.m.propietario, p_empresa: e.m.empresa }) as { codigo: string }).codigo; const par = await generarParClaves();
  const vinc = (v: string) => { const t = JSON.stringify({ codigo: cod, clave_publica: par.publica, nombre: "PC", version: v }); return enviar("vincular", t, { "content-type": "application/json", "x-nonce": N() }); };
  const malo = await vinc("1.0.0"); assert.equal(malo.status, 426); assert.equal((await vinc("1.0.1")).status, 200, "el código no se había gastado");
  await restaurar();
});

T("SONDEO ADAPTATIVO decidido por NEXA: activo con órdenes en curso o recientes, reposo si no; límites seguros aunque el parámetro sea absurdo", async () => {
  await restaurar(); await poner("agente_sondeo_activo_ms", 2500); await poner("agente_sondeo_reposo_ms", 45000); await poner("agente_actividad_reciente_seg", 0);
  const e = await equipo(); const reposo = await firmada(e, "reclamar"); assert.equal((reposo.json.politica as { siguiente_ms: number }).siguiente_ms, 45000);
  const o = await ordenPendiente(e); const lat = await firmada(e, "latido"); assert.equal((lat.json.politica as { siguiente_ms: number }).siguiente_ms, 2500, "hay una orden pendiente: la empresa está activa");
  const con = await firmada(e, "reclamar"); assert.ok(con.json.orden, "recibe la orden"); assert.equal((con.json.politica as { siguiente_ms: number }).siguiente_ms, 2000, "con una orden en curso vuelve pronto");
  const ord = (await cx.sql.unsafe("select id, token from public.ordenes_emision where operacion_id = $1", [o.op]))[0] as unknown as { id: string; token: number };
  const p1 = await firmada(e, "progreso", { orden: ord.id, token: Number(ord.token), fase: "detenido_en_vista_previa" }); assert.equal(p1.status, 200, JSON.stringify(p1.json));
  const p2 = await firmada(e, "resultado", { orden: ord.id, token: Number(ord.token), tipo: "descartado", detalle: "x" }); assert.equal(p2.status, 200, JSON.stringify(p2.json));
  await cx.rpc("fel_sys_ordenes_vencer", { p_empresa: e.m.empresa });
  assert.equal(((await firmada(e, "latido")).json.politica as { siguiente_ms: number }).siguiente_ms, 45000, "sin órdenes abiertas y sin actividad reciente: reposo");
  await poner("agente_sondeo_reposo_ms", 5); assert.equal(((await firmada(e, "latido")).json.politica as { siguiente_ms: number }).siguiente_ms, 1000, "mínimo 1 s");
  await poner("agente_sondeo_reposo_ms", 999_999_999); assert.equal(((await firmada(e, "latido")).json.politica as { siguiente_ms: number }).siguiente_ms, 120_000, "máximo 2 min");
  await restaurar();
});

T("MÉTRICAS: se cuentan por agente y hora, se vuelcan por lotes, solo las ve la persona con permiso de SU empresa; los contadores del cliente se acotan; un fallo al volcar no pierde datos", async () => {
  await restaurar(); const a = await equipo(), b = await equipo();
  await firmada(a, "reclamar"); await firmada(a, "reclamar"); await firmada(a, "latido", { metricas: { reconexiones: 2, errores_red: 3, no_autenticas: 1, peticiones: 7, malo: 5, reconexiones_x: 1 } });
  await firmada(a, "latido", { metricas: { reconexiones: -1, errores_red: 1.5, no_autenticas: "9", peticiones: 5_000_000 } });   // valores no válidos: se ignoran
  await firmada(b, "reclamar");
  assert.ok(metricas.pendientes() > 0); assert.ok((await metricas.vaciar()) > 0); assert.equal(metricas.pendientes(), 0);
  const ma = await cx.rpc("fel_op_agente_metricas", { p_actor: a.m.lector, p_empresa: a.m.empresa, p_horas: 24 }) as { totales: Record<string, number>; peticiones: number; agentes: number; proyeccion_30_dias: number };
  assert.equal(ma.totales["peticion:reclamar"], 2); assert.equal(ma.totales["peticion:latido"], 2); assert.equal(ma.totales["estado:reclamar:200"], 2);
  assert.equal(ma.totales["cliente_reconexiones"], 2); assert.equal(ma.totales["cliente_errores_red"], 3); assert.equal(ma.totales["cliente_no_autenticas"], 1); assert.equal(ma.totales["cliente_peticiones"], 7);
  assert.ok(!Object.keys(ma.totales).some((k) => /malo|_x$/.test(k)), "claves no previstas se descartan"); assert.equal(ma.totales["peticion:vincular"], 1); assert.equal(ma.peticiones, 5, "vincular + 2 reclamar + 2 latido"); assert.equal(ma.agentes, 1); assert.equal(ma.proyeccion_30_dias, 5 / 24 * 720);
  const mb = await cx.rpc("fel_op_agente_metricas", { p_actor: b.m.lector, p_empresa: b.m.empresa, p_horas: 24 }) as { peticiones: number }; assert.equal(mb.peticiones, 2, "cada empresa ve solo lo suyo (vincular + reclamar)");
  assert.equal(await codigo(cx.rpc("fel_op_agente_metricas", { p_actor: b.m.lector, p_empresa: a.m.empresa, p_horas: 24 })), "FEL_NO_AUTORIZADO", "una persona de otra empresa no lee métricas ajenas");
  assert.equal(await codigo(cx.rpc("fel_op_agente_metricas", { p_actor: a.m.lector, p_empresa: a.m.empresa, p_horas: 0 })), "FEL_DATOS_INVALIDOS"); assert.equal(await codigo(cx.rpc("fel_op_agente_metricas", { p_actor: a.m.lector, p_empresa: a.m.empresa, p_horas: 9999 })), "FEL_DATOS_INVALIDOS");
  // volcado fallido: los contadores se conservan
  let falla = true; const rpcRota = ((f: string, a2: Record<string, unknown>) => (falla ? Promise.reject(new Error("caída")) : cx.rpc(f, a2))) as typeof cx.rpc;
  const m2 = crearMetricas({ rpc: rpcRota }); m2.sumar(a.id, "peticion:reclamar", 5); assert.equal(await m2.vaciar(), 0); assert.equal(m2.pendientes(), 1, "no se perdió"); falla = false; assert.equal(await m2.vaciar(), 1); assert.equal(m2.pendientes(), 0);
  // entradas inválidas se ignoran; sin agente no se guarda
  m2.sumar(undefined, "peticion:x"); m2.sumar(a.id, "CLAVE MALA"); m2.sumar(a.id, "peticion:x", -3); m2.sumar(a.id, "peticion:x".padEnd(100, "x")); assert.equal(m2.pendientes(), 0);
});

T("DISTRIBUCIÓN de claves: NEXA anuncia solo lo que el agente declara no conocer; la respuesta anunciante va firmada", async () => {
  await restaurar(); const e = await equipo();
  const sin = await firmada(e, "reclamar", { kids: ["k1"] }); const claves = sin.json.claves_nexa as { kid: string }[]; assert.deepEqual(claves.map((c) => c.kid), ["k2"]); assert.equal(await autentica(sin), true);
  const con = await firmada(e, "reclamar", { kids: ["k1", "k2"] }); assert.deepEqual(con.json.claves_nexa, []);
  const raros = await firmada(e, "reclamar", { kids: [1, null, { x: 1 }, "k".repeat(100)] }); assert.equal(raros.status, 200, "entradas raras no rompen nada");
});

T("AISLAMIENTO entre empresas: un agente jamás recibe órdenes de otra empresa y las métricas/políticas no cruzan datos", async () => {
  await restaurar(); const a = await equipo(), b = await equipo(); const oa = await ordenPendiente(a);
  const rb = await firmada(b, "reclamar"); assert.equal(rb.json.orden, null, "B no ve la orden de A"); assert.ok(!JSON.stringify(rb.json).includes(a.m.empresa));
  const ra = await firmada(a, "reclamar"); assert.ok(ra.json.orden); const ord = (await cx.sql.unsafe("select id, token from public.ordenes_emision where operacion_id = $1", [oa.op]))[0] as unknown as { id: string; token: number };
  const intr = await firmada(b, "progreso", { orden: ord.id, token: Number(ord.token), fase: "detenido_en_vista_previa" }); assert.equal(intr.status, 403); assert.equal(intr.json.codigo, "FEL_EMPRESA"); assert.equal(await autentica(intr), true);
});

T("cierre de conexión", async () => { await cx.cerrar(); });
