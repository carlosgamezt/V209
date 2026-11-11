// Flujo individual SIMULADO contra la BASE REAL de pruebas (migraciones reales) con el proveedor mock.
// Cubre: flujo completo, aislamiento, solicitudes simultáneas, reintentos y desconocidos, caídas antes y después de enviar, respuestas tardías,
// reinicio del proceso, conciliación manual verificable y prevención de certificaciones duplicadas.
import assert from "node:assert/strict";
import { MockProvider, type Escenario } from "../src/mock.ts";
import { ErrorBd } from "../src/rpc.ts";
import { OrquestadorDb, ProcesoCaido } from "../src/orquestador_db.ts";
import { clave, conexion, documentoRevisado, estadoDoc, nuevoMundo, operaciones, parametros } from "./mundo.ts";

const cx = conexion();
const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };
const T = (nombre: string, f: () => Promise<void>) => Deno.test({ name: nombre, sanitizeOps: false, sanitizeResources: false, fn: f });
const codigo = (e: unknown) => (e instanceof ErrorBd ? e.codigo : e instanceof ProcesoCaido ? "CAIDO" : "otro");
const reinicio = (m: MockProvider) => new OrquestadorDb(cx.rpc, m);   // «reinicio»: proceso nuevo, misma base y mismo proveedor (el servidor del proveedor sobrevive a nuestros reinicios)
async function preparar(esc: Escenario, opciones: { idempotenciaNativa?: boolean } = {}) {
  await parametros(cx, 0, 0, 0);
  const m = await nuevoMundo(cx), mock = new MockProvider({ escenarioPorDefecto: esc, idempotenciaNativa: false, ...opciones }), orq = reinicio(mock);
  const doc = await documentoRevisado(cx, m);
  return { m, mock, orq, doc, sol: (k: string, orqx = orq) => orqx.solicitar({ actor: m.propietario, empresa: m.empresa, documento: doc, clave: k, canal: m.canal }) };
}
const operacionesAbiertas = async (doc: string) => Number((await cx.sql.unsafe("select count(*)::int as n from public.operaciones_fiscales where documento_id = $1 and estado in ('iniciada','desconocida')", [doc]))[0].n);

T("flujo completo: borrador → validación → revisión → envío simulado → resultado → PDF/XML con hash", async () => {
  const { m, mock, orq, doc, sol } = await preparar("exito");
  assert.equal((await orq.validar(m.empresa, doc)).ok, true);
  const r = await sol(clave(1));
  assert.equal(r.reutilizada, false); assert.equal(r.operacion.estado, "confirmada_exitosa");
  const d = await estadoDoc(cx, doc);
  assert.equal(d.estado_fiscal, "certificado"); assert.match(String(d.autorizacion_sat), /^SIM-/); assert.equal(d.serie, "SIMA");
  assert.equal(mock.certificacionesDe(doc), 1); assert.equal(mock.llamadasEnviar.length, 1);
  const arts = await cx.sql.unsafe("select tipo, sha256, tamano, encode(sha256(contenido),'hex') as calc from public.artefactos_documento where documento_id = $1 order by tipo", [doc]);
  assert.deepEqual(arts.map((a) => a.tipo), ["pdf", "xml"]); for (const a of arts) assert.equal(a.sha256, a.calc);
  const ev = await cx.sql.unsafe("select tipo, resultado from public.eventos_proveedor where operacion_id = $1", [r.operacion.id]); assert.deepEqual(ev.map((e) => `${e.tipo}/${e.resultado}`), ["envio/certificado"]);
  // el estado certificado es inmutable y no se vuelve a certificar
  await assert.rejects(() => sol(clave(2)), (e) => ["FEL_REGLA"].includes(codigo(e)));
});

T("el proveedor rechaza el documento (validación) o lo rechaza confirmado: nada queda abierto y se puede corregir", async () => {
  const { orq, doc, m, mock, sol } = await preparar("rechazo");
  const r = await sol(clave(1)); assert.equal(r.operacion.estado, "confirmada_fallida"); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "rechazado");
  assert.equal(mock.certificacionesDe(doc), 0); assert.equal(await operacionesAbiertas(doc), 0);
  await cx.rpc("fel_op_documento_reabrir", { p_actor: m.emisor, p_empresa: m.empresa, p_doc: doc, p_version: (await estadoDoc(cx, doc)).version });
  assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "ninguno"); void orq;
});

T("aislamiento: un usuario o documento de otra empresa no puede operar ni ver nada ajeno", async () => {
  const a = await preparar("exito"), b = await nuevoMundo(cx); const docB = await documentoRevisado(cx, b);
  // empresa A intenta operar sobre el documento de B (con su propio canal y con el de B)
  await assert.rejects(() => a.orq.solicitar({ actor: a.m.propietario, empresa: a.m.empresa, documento: docB, clave: clave(1), canal: a.m.canal }), (e) => codigo(e) === "FEL_NO_ENCONTRADO");
  await assert.rejects(() => a.orq.solicitar({ actor: a.m.propietario, empresa: b.empresa, documento: docB, clave: clave(2), canal: b.canal }), (e) => codigo(e) === "FEL_NO_AUTORIZADO");
  await assert.rejects(() => a.orq.solicitar({ actor: b.propietario, empresa: a.m.empresa, documento: a.doc, clave: clave(3), canal: a.m.canal }), (e) => codigo(e) === "FEL_NO_AUTORIZADO");
  await assert.rejects(() => a.orq.solicitar({ actor: a.m.propietario, empresa: a.m.empresa, documento: a.doc, clave: clave(4), canal: b.canal }), (e) => ["FEL_REGLA"].includes(codigo(e)));   // canal de otra empresa
  assert.equal((await estadoDoc(cx, docB)).estado_fiscal, "ninguno"); assert.equal(a.mock.llamadasEnviar.length, 0, "nada llegó al proveedor");
  // el emisor no certifica; el lector tampoco
  for (const u of [a.m.emisor, a.m.lector]) await assert.rejects(() => a.orq.solicitar({ actor: u, empresa: a.m.empresa, documento: a.doc, clave: clave(5), canal: a.m.canal }), (e) => codigo(e) === "FEL_NO_AUTORIZADO");
  // una operación de A no es visible ni tocable desde B
  const r = await a.sol(clave(6)); await assert.rejects(() => cx.rpc("fel_sys_operacion", { p_empresa: b.empresa, p_op: r.operacion.id }), (e) => codigo(e) === "FEL_NO_ENCONTRADO");
  await assert.rejects(() => a.orq.conciliar(b.empresa, r.operacion.id), (e) => codigo(e) === "FEL_NO_ENCONTRADO");
});

T("solicitudes SIMULTÁNEAS: con la misma clave o con claves distintas se envía UNA sola vez y hay UNA sola certificación", async () => {
  for (const mismaClave of [true, false]) {
    const { mock, doc, sol } = await preparar("exito");
    const k = clave(1);
    const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => sol(mismaClave ? k : clave(i))));
    assert.equal(mock.llamadasEnviar.length, 1, `se envió ${mock.llamadasEnviar.length} veces (misma clave: ${mismaClave})`); assert.equal(mock.certificacionesDe(doc), 1);
    assert.equal((await operaciones(cx, doc)).length, 1, "una sola operación"); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "certificado");
    const ok = res.filter((r) => r.status === "fulfilled"), ko = res.filter((r) => r.status === "rejected");
    if (mismaClave) assert.equal(ko.length, 0, "con la misma clave todas reciben la misma operación"); else for (const r of ko) assert.ok(["FEL_OPERACION_ABIERTA", "FEL_REGLA", "FEL_POR_VERIFICAR"].includes(codigo((r as PromiseRejectedResult).reason)), String((r as PromiseRejectedResult).reason));
    assert.ok(ok.length >= 1);
  }
});

T("resultados DESCONOCIDOS: por_verificar bloquea; ni la misma ni otra clave reenvían; el proveedor recibe un solo envío", async () => {
  for (const esc of ["timeout_antes", "timeout_despues", "corte_despues", "respuesta_ilegible", "codigo_desconocido_certificado", "codigo_desconocido_no_certificado", "timeout_indeterminado", "timeout_tardio", "limite_tasa", "caida"] as Escenario[]) {
    const { mock, doc, sol } = await preparar(esc); const k = clave(1);
    const r = await sol(k); assert.equal(r.operacion.estado, "desconocida", esc); assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "por_verificar", esc);
    await assert.rejects(() => sol(clave(2)), (e) => codigo(e) === "FEL_POR_VERIFICAR", esc);                  // otra clave: bloqueada
    const otra = await sol(k); assert.equal(otra.reutilizada, true, esc); assert.equal(otra.operacion.id, r.operacion.id);   // misma clave: misma operación
    assert.equal(mock.llamadasEnviar.length, 1, esc); assert.ok(mock.certificacionesDe(doc) <= 1, esc);
    // «marcar fallida» a mano NO libera nada
    await assert.rejects(async () => await cx.rpc("fel_op_operacion_resolver", { p_actor: (await nuevoMundoPropietario(doc)), p_empresa: await empresaDe(doc), p_op: r.operacion.id, p_exitosa: false, p_resolucion: "conciliacion_manual", p_evidencia: { nota: "ya no existe" }, p_serie: null, p_numero: null, p_autorizacion: null }), (e) => ["FEL_REGLA", "FEL_NO_AUTORIZADO"].includes(codigo(e)), esc);
    assert.equal((await estadoDoc(cx, doc)).estado_fiscal, "por_verificar", esc);
  }
});
async function empresaDe(doc: string) { return String((await cx.sql.unsafe("select empresa_id from public.documentos where id = $1", [doc]))[0].empresa_id); }
async function nuevoMundoPropietario(doc: string) { return String((await cx.sql.unsafe("select user_id from public.miembros where empresa_id = (select empresa_id from public.documentos where id = $1) and rol = 'propietario'", [doc]))[0].user_id); }

T("conciliación con el proveedor: certificado / no existe → se resuelve sola; indeterminado → sigue bloqueado", async () => {
  const a = await preparar("timeout_despues"); const ra = await a.sol(clave(1)); assert.equal(ra.operacion.estado, "desconocida");
  const ca = await a.orq.conciliar(a.m.empresa, ra.operacion.id); assert.deepEqual([ca.resultado, ca.aplicado], ["certificado", "certificado"]);
  assert.equal((await estadoDoc(cx, a.doc)).estado_fiscal, "certificado"); assert.equal(a.mock.certificacionesDe(a.doc), 1); assert.equal(a.mock.llamadasEnviar.length, 1);
  assert.equal(Number((await cx.sql.unsafe("select count(*)::int as n from public.artefactos_documento where documento_id = $1", [a.doc]))[0].n), 2, "los artefactos se guardan tras conciliar");
  const b = await preparar("timeout_antes"); const rb = await b.sol(clave(1)); const cb = await b.orq.conciliar(b.m.empresa, rb.operacion.id);
  assert.deepEqual([cb.resultado, cb.aplicado], ["no_existe_confirmado", "rechazado"]); assert.equal((await estadoDoc(cx, b.doc)).estado_fiscal, "rechazado");
  b.mock.fijarEscenario(b.doc, "exito"); const r2 = await b.sol(clave(2)); assert.equal(r2.operacion.estado, "confirmada_exitosa"); assert.equal(b.mock.certificacionesDe(b.doc), 1, "reintento seguro tras confirmar que no existía");
  const c = await preparar("timeout_indeterminado"); const rc = await c.sol(clave(1)); const cc = await c.orq.conciliar(c.m.empresa, rc.operacion.id);
  assert.deepEqual([cc.resultado, cc.aplicado], ["indeterminado", "sin_cambio"]); assert.equal((await estadoDoc(cx, c.doc)).estado_fiscal, "por_verificar");
  await assert.rejects(() => c.sol(clave(2)), (e) => codigo(e) === "FEL_POR_VERIFICAR");
});

T("CAÍDA ANTES de marcar el envío: el reinicio PRUEBA que nada salió, libera y el reintento certifica una sola vez", async () => {
  const p = await preparar("exito"); const caida = new OrquestadorDb(cx.rpc, p.mock, { ganchos: { despuesDeSolicitar: () => { throw new ProcesoCaido("antes de marcar el envío"); } } });
  await assert.rejects(() => p.sol(clave(1), caida), (e) => e instanceof ProcesoCaido);
  assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "pendiente_certificacion"); assert.equal(p.mock.llamadasEnviar.length, 0);
  await assert.rejects(() => p.sol(clave(2)), (e) => codigo(e) === "FEL_OPERACION_ABIERTA");                  // mientras tanto, nada se reenvía
  const r = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal(r.liberadas_sin_envio, 1);
  const ops = await operaciones(cx, p.doc); assert.equal(ops[0].resolucion, "sistema_no_enviada"); assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "rechazado");
  const fin = await p.sol(clave(3)); assert.equal(fin.operacion.estado, "confirmada_exitosa"); assert.equal(p.mock.certificacionesDe(p.doc), 1); assert.equal(p.mock.llamadasEnviar.length, 1);
});

T("CAÍDA tras marcar el envío pero ANTES de que el proveedor reciba nada: desconocida → conciliación «no existe» → reintento seguro", async () => {
  const p = await preparar("exito"); const caida = new OrquestadorDb(cx.rpc, p.mock, { ganchos: { despuesDeMarcarEnvio: () => { throw new ProcesoCaido("tras marcar el envío"); } } });
  await assert.rejects(() => p.sol(clave(1), caida), (e) => e instanceof ProcesoCaido); assert.equal(p.mock.llamadasEnviar.length, 0);
  const r = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.deepEqual([r.marcadas_desconocidas, r.conciliadas, r.resueltas], [1, 1, 1]);
  assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "rechazado"); assert.equal(p.mock.certificacionesDe(p.doc), 0);
  const fin = await p.sol(clave(2)); assert.equal(fin.operacion.estado, "confirmada_exitosa"); assert.equal(p.mock.certificacionesDe(p.doc), 1);
});

T("CAÍDA DESPUÉS de que el proveedor certificó (antes de registrar la respuesta): el reinicio concilia, certifica y NO reenvía", async () => {
  const p = await preparar("exito"); const caida = new OrquestadorDb(cx.rpc, p.mock, { ganchos: { despuesDeEnviar: () => { throw new ProcesoCaido("tras enviar"); } } });
  await assert.rejects(() => p.sol(clave(1), caida), (e) => e instanceof ProcesoCaido);
  assert.equal(p.mock.certificacionesDe(p.doc), 1, "el servidor sí certificó"); assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "pendiente_certificacion");
  const r = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal(r.resueltas, 1);
  const d = await estadoDoc(cx, p.doc); assert.equal(d.estado_fiscal, "certificado"); assert.match(String(d.autorizacion_sat), /^SIM-/);
  assert.equal(p.mock.llamadasEnviar.length, 1, "no se reenvió"); assert.equal(p.mock.certificacionesDe(p.doc), 1);
  assert.equal(Number((await cx.sql.unsafe("select count(*)::int as n from public.artefactos_documento where documento_id = $1", [p.doc]))[0].n), 2);
});

T("CAÍDA tras registrar el resultado y ANTES de guardar PDF/XML: la recuperación completa los artefactos", async () => {
  const p = await preparar("exito"); const falla = new OrquestadorDb(cx.rpc, p.mock, { ganchos: { despuesDeEvento: () => { throw new ProcesoCaido("tras el evento"); } } });
  await assert.rejects(() => p.sol(clave(1), falla), (e) => e instanceof ProcesoCaido);
  await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "certificado");
  const n = async () => Number((await cx.sql.unsafe("select count(*)::int as n from public.artefactos_documento where documento_id = $1", [p.doc]))[0].n);
  assert.equal(await n(), 2); const otra = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal(otra.artefactos_completados, 0, "idempotente"); assert.equal(await n(), 2);
});

T("RESPUESTA TARDÍA: el proveedor certifica después; mientras no se sepa, bloquea; al conciliar, certifica sin duplicar", async () => {
  const p = await preparar("timeout_tardio"); const r = await p.sol(clave(1)); assert.equal(r.operacion.estado, "desconocida");
  const c1 = await p.orq.conciliar(p.m.empresa, r.operacion.id); assert.deepEqual([c1.resultado, c1.aplicado], ["indeterminado", "sin_cambio"]);
  await assert.rejects(() => p.sol(clave(2)), (e) => codigo(e) === "FEL_POR_VERIFICAR");
  await p.mock.liberarTardios(CTX); assert.equal(p.mock.certificacionesDe(p.doc), 1);
  const c2 = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal(c2.resueltas, 1);
  assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "certificado"); assert.equal(p.mock.llamadasEnviar.length, 1); assert.equal(p.mock.certificacionesDe(p.doc), 1);
});

T("conciliación MANUAL verificable: condiciones, dos personas, ventana de espera, auditoría posterior y alerta si el proveedor certifica tarde", async () => {
  const p = await preparar("timeout_tardio"); const r = await p.sol(clave(1)); const op = r.operacion.id;
  const evidencia = () => ({ fuente: "portal_sat_consulta", referencia: "consulta-manual-001", fecha_consulta: new Date().toISOString(), conclusion: "no_figura" });
  const proponer = () => cx.rpc("fel_op_conciliacion_proponer", { p_actor: p.m.propietario, p_empresa: p.m.empresa, p_op: op, p_tipo: "manual_fallida", p_evidencia: evidencia(), p_datos: null }) as Promise<{ id: string }>;
  // 1) sin que el proveedor haya sido consultado y dicho «indeterminado», no se puede ni proponer
  await assert.rejects(proponer, (e) => codigo(e) === "FEL_REGLA");
  await p.orq.conciliar(p.m.empresa, op);   // indeterminado (hay una solicitud en proceso)
  // 2) espera mínima desde el envío
  await parametros(cx, 120, 1440, 0); await assert.rejects(proponer, (e) => codigo(e) === "FEL_ESPERA_TARDIA");
  await parametros(cx, 0, 0, 0);
  const c = await proponer(); assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "por_verificar", "una propuesta no libera");
  await assert.rejects(() => p.sol(clave(2)), (e) => codigo(e) === "FEL_POR_VERIFICAR");
  // 3) la aprueba OTRA persona con permiso
  await assert.rejects(() => cx.rpc("fel_op_conciliacion_decidir", { p_actor: p.m.propietario, p_empresa: p.m.empresa, p_conciliacion: c.id, p_aprobar: true, p_nota: "yo mismo" }), (e) => codigo(e) === "FEL_REGLA");
  await assert.rejects(() => cx.rpc("fel_op_conciliacion_decidir", { p_actor: p.m.emisor, p_empresa: p.m.empresa, p_conciliacion: c.id, p_aprobar: true, p_nota: "sin permiso" }), (e) => codigo(e) === "FEL_NO_AUTORIZADO");
  await cx.rpc("fel_op_conciliacion_decidir", { p_actor: p.m.admin2, p_empresa: p.m.empresa, p_conciliacion: c.id, p_aprobar: true, p_nota: "segunda persona verifica" });
  assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "rechazado");
  // 4) reintento: exige espera de respuestas tardías Y comprobación posterior del proveedor
  await parametros(cx, 0, 0, 0);
  await assert.rejects(() => p.sol(clave(3)), (e) => codigo(e) === "FEL_AUDITORIA_PENDIENTE");
  const a1 = await p.orq.auditarFallidas(); assert.equal(a1.alertas, 0);   // el proveedor sigue sin certificar: queda la comprobación posterior
  // 5) RESPUESTA TARDÍA tras la conciliación manual: el proveedor certifica → alerta bloqueante, nunca un segundo envío
  await p.mock.liberarTardios(CTX); assert.equal(p.mock.certificacionesDe(p.doc), 1);
  const a2 = await p.orq.auditarFallidas(); assert.equal(a2.alertas, 1);
  await assert.rejects(() => p.sol(clave(4)), (e) => codigo(e) === "FEL_ALERTA_ABIERTA");
  assert.equal(p.mock.llamadasEnviar.length, 1, "jamás se reenvió"); assert.equal(p.mock.certificacionesDe(p.doc), 1);
  assert.equal(Number((await cx.sql.unsafe("select count(*)::int as n from public.alertas_fiscales where documento_id = $1 and resuelta_en is null", [p.doc]))[0].n), 1);
});

T("canal asistido (futuro Playwright): la operación queda abierta; el reinicio no la toca; la persona termina y se cierra con el resultado leído", async () => {
  const p = await preparar("accion_humana"); const r = await p.sol(clave(1));
  assert.equal(r.operacion.estado, "iniciada"); assert.ok(r.operacion.orden_externa); assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "pendiente_certificacion");
  await assert.rejects(() => p.sol(clave(2)), (e) => codigo(e) === "FEL_OPERACION_ABIERTA");
  const rec = await reinicio(p.mock).recuperar({ umbralMin: 0 }); assert.equal(rec.esperando_humano, 1); assert.equal((await operaciones(cx, p.doc))[0].estado, "iniciada");
  const c = await p.orq.conciliar(p.m.empresa, r.operacion.id); assert.equal(c.aplicado, "sin_cambio");
  const fin = await p.mock.completarAccionHumana(String(r.operacion.orden_externa), CTX); await p.orq.resolverAccionHumana(p.m.empresa, r.operacion.id, fin);
  assert.equal((await estadoDoc(cx, p.doc)).estado_fiscal, "certificado"); assert.equal(p.mock.certificacionesDe(p.doc), 1); assert.equal(p.mock.llamadasEnviar.length, 1);
});

T("respuesta sospechosa del proveedor (autorización repetida en otro documento): no se toma por éxito", async () => {
  const a = await preparar("exito"), ra = await a.sol(clave(1)); assert.equal(ra.operacion.estado, "confirmada_exitosa");
  const b = await preparar("exito"); const d = await estadoDoc(cx, a.doc);
  // el proveedor «repite» una autorización ya usada en la misma empresa
  const falso = Object.assign(Object.create(b.mock), { enviar: async (s: { documentoId: string }) => ({ tipo: "certificado", serie: String(d.serie), numero: "00000077", autorizacion: String(d.autorizacion_sat), fechaCertificacion: new Date().toISOString(), artefactos: [] }) });
  const doc2 = await documentoRevisado(cx, a.m);
  const o2 = new OrquestadorDb(cx.rpc, falso as unknown as MockProvider);
  const r2 = await o2.solicitar({ actor: a.m.propietario, empresa: a.m.empresa, documento: doc2, clave: clave(9), canal: a.m.canal });
  assert.equal(r2.operacion.estado, "desconocida"); assert.equal((await estadoDoc(cx, doc2)).estado_fiscal, "por_verificar");
});

T("ventana de respuestas tardías: tras una conciliación manual «fallida» no se reintenta hasta que vence la espera", async () => {
  const p = await preparar("timeout_indeterminado"); const r = await p.sol(clave(1)); await p.orq.conciliar(p.m.empresa, r.operacion.id);
  await parametros(cx, 0, 1440, 0);   // espera mínima 0, ventana tardía de un día
  const c = await cx.rpc("fel_op_conciliacion_proponer", { p_actor: p.m.propietario, p_empresa: p.m.empresa, p_op: r.operacion.id, p_tipo: "manual_fallida", p_evidencia: { fuente: "portal_sat_consulta", referencia: "consulta-ventana-1", fecha_consulta: new Date().toISOString(), conclusion: "no_figura" }, p_datos: null }) as { id: string };
  await cx.rpc("fel_op_conciliacion_decidir", { p_actor: p.m.admin2, p_empresa: p.m.empresa, p_conciliacion: c.id, p_aprobar: true, p_nota: "segunda persona" });
  await p.orq.auditarFallidas();   // la comprobación posterior existe, pero la ventana de espera aún no venció
  await assert.rejects(() => p.sol(clave(2)), (e) => codigo(e) === "FEL_ESPERA_TARDIA"); assert.equal(p.mock.llamadasEnviar.length, 1);
  await cx.sql.unsafe("select 1");   // (la espera real son 24 h: aquí solo se comprueba que bloquea)
  await parametros(cx, 0, 0, 0);
});

T("cierre de la conexión", async () => { await cx.cerrar(); });
