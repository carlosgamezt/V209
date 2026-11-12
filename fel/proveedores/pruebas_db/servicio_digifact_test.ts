// Servicio Digifact SIMULADO contra la BASE REAL: certificación con cobertura (bolsón + monedero), rechazos, resultados desconocidos, anulación simulada.
import assert from "node:assert/strict";
import { DigifactProvider } from "../src/digifact.ts";
import { DigifactSimulador } from "../src/digifact_simulador.ts";
import { OrquestadorDb } from "../src/orquestador_db.ts";
import { ErrorBd } from "../src/rpc.ts";
import { ServicioDigifact } from "../src/servicio_digifact.ts";
import { clave, conexion, documentoRevisado, estadoDoc, nuevoMundo, parametros, type Mundo } from "./mundo.ts";

const cx = conexion();
const CTX = { ambiente: "simulado" as const, ahora: () => new Date() };
const T = (n: string, f: () => Promise<void>) => Deno.test({ name: n, sanitizeOps: false, sanitizeResources: false, fn: f });
const uno = async (sql: string, p: unknown[] = []) => (await cx.sql.unsafe(sql, p as never))[0] as Record<string, unknown>;
const num = async (sql: string, p: unknown[] = []) => Number((await uno(sql, p)).n);

let maestro = "", plan = "";
async function base() {
  await parametros(cx, 0, 0, 0);
  if (!maestro) {
    maestro = crypto.randomUUID();
    await cx.sql.unsafe("insert into auth.users (id, email) values ($1, $2)", [maestro, `maestro-${maestro.slice(0, 8)}@fel.test`]);
    await cx.sql.unsafe("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [maestro]);
    await cx.sql.unsafe("insert into public.plataforma_admins (user_id) values ($1)", [maestro]);
    let cta = (await uno("select public.fel_sys_bolson_cuenta_simulada('digifact') as c")).c as string | null;
    if (!cta) cta = (await uno("select (public.fel_admin_bolson_cuenta_crear($1, 'digifact', 'simulado', $2)).id as c", [maestro, `SIM-${maestro.slice(0, 8)}`])).c as string;
    await cx.sql.unsafe("select public.fel_admin_bolson_lote_registrar($1, $2, 100000, 0, $3)", [maestro, cta, `LOTE-${maestro.slice(0, 8)}`]);
    plan = `prepago_t${Date.now()}`;
    await cx.sql.unsafe("select public.fel_admin_plan_crear($1, $2, 'Prepago de prueba', 'prepago')", [maestro, plan]);
  }
}
async function mundoDigifact(saldo: number | null) {
  await base();
  const m = await nuevoMundo(cx);
  const canal = (await uno("select (public.fel_op_canal_configurar($1, $2, null, 'digifact', 'simulado', true)).id as id", [m.propietario, m.empresa])).id as string;
  const v = (await uno("select (public.fel_admin_plan_version_crear($1, $2, current_date - 1, 0, 0, false, 0, $3::jsonb)).id as id", [maestro, plan,
    cx.sql.json([{ evento: "certificacion", precio: "2.5", cargable: true }, { evento: "anulacion", precio: "0", cargable: false }] as never)])).id as string;
  await cx.sql.unsafe("select public.fel_admin_contrato_asignar($1, $2, $3, current_date - 1)", [maestro, m.empresa, v]);
  if (saldo) await cx.sql.unsafe("select public.fel_admin_pago_simulado_registrar($1, $2, $3::numeric, 'PAGO-TEST', $4)", [maestro, m.empresa, saldo, clave("pago")]);
  const sim = new DigifactSimulador({ ahora: CTX.ahora }), prov = new DigifactProvider(sim.transporte, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" });
  const srv = new ServicioDigifact(cx.rpc, prov, CTX), doc = await documentoRevisado(cx, m);
  const cert = (k: string, d = doc) => srv.certificar({ actor: m.propietario, empresa: m.empresa, documento: d, clave: k, canal });
  return { m, canal, sim, prov, srv, doc, cert };
}
const consumos = async (m: Mundo, evento: string) => await cx.sql.unsafe("select estado, unidades_consumidas::text as u from public.consumos where empresa_id = $1 and evento_tipo = $2 order by reservado_en", [m.empresa, evento]);
const cargos = async (m: Mundo) => await cx.sql.unsafe("select monto::text as monto from public.cargos where empresa_id = $1", [m.empresa]);
const monedero = async (m: Mundo) => await uno("select consumido::text as consumido, reservado::text as reservado, (recargado + ajustado - consumido - reservado - reembolsado + sobregiro)::text as disponible from public.monedero_saldos where empresa_id = $1", [m.empresa]);
const saldosOk = async () => assert.equal(await num("select count(*)::int as n from public.fel_sys_verificar_saldos() where not ok") + await num("select count(*)::int as n from public.fel_sys_verificar_monederos() where not ok"), 0);

T("éxito: certifica, consume el bolsón simulado, cobra 2,5 una sola vez y no repite al reintentar con la misma clave", async () => {
  const x = await mundoDigifact(10), k = clave(1);
  const r = await x.cert(k);
  assert.equal(r.operacion.estado, "confirmada_exitosa"); assert.equal(x.sim.certificacionesDe(x.doc), 1);
  assert.equal((await estadoDoc(cx, x.doc)).estado_fiscal, "certificado"); assert.match(String((await estadoDoc(cx, x.doc)).autorizacion_sat), /^SIM-/);
  assert.deepEqual((await consumos(x.m, "certificacion")).map((c) => [c.estado, c.u]), [["confirmado", "1.000000"]]);
  assert.deepEqual((await cargos(x.m)).map((c) => c.monto), ["2.500000"]);
  assert.deepEqual(await monedero(x.m), { consumido: "2.500000", reservado: "0.000000", disponible: "7.500000" });
  const r2 = await x.cert(k); assert.equal(r2.reutilizada, true);
  assert.equal(x.sim.certificacionesDe(x.doc), 1); assert.equal((await cargos(x.m)).length, 1); assert.equal((await consumos(x.m, "certificacion")).length, 1);
  await saldosOk();
});

T("sin saldo: nada se envía al proveedor, no queda consumo ni cargo, el documento se puede reintentar tras recargar", async () => {
  const x = await mundoDigifact(null);
  const r = await x.cert(clave(1));
  assert.equal(r.operacion.estado, "confirmada_fallida"); assert.equal(x.sim.certificacionesDe(x.doc), 0); assert.equal(x.sim.llamadas.filter((l) => l.ruta === "/api/certificar").length, 0, "el proveedor no recibió nada");
  assert.equal((await consumos(x.m, "certificacion")).length, 0); assert.equal((await cargos(x.m)).length, 0);
  assert.match(String((await uno("select motivo from public.eventos_proveedor where operacion_id = $1 order by id desc limit 1", [r.operacion.id])).motivo), /COBERTURA_FEL_SIN_SALDO/);
  await cx.sql.unsafe("select public.fel_admin_pago_simulado_registrar($1, $2, 5, 'PAGO-RECARGA', $3)", [maestro, x.m.empresa, clave("pago2")]);
  const r2 = await x.cert(clave(2)); assert.equal(r2.operacion.estado, "confirmada_exitosa"); assert.equal(x.sim.certificacionesDe(x.doc), 1);
  await saldosOk();
});

T("rechazo confirmado del proveedor: el consumo se confirma por prudencia pero NO se cobra al cliente; el monedero queda intacto", async () => {
  const x = await mundoDigifact(10); x.sim.fijarEscenario(x.doc, "rechazo");
  const r = await x.cert(clave(1));
  assert.equal(r.operacion.estado, "confirmada_fallida");
  assert.deepEqual((await consumos(x.m, "certificacion")).map((c) => c.estado), ["confirmado"]); assert.equal((await cargos(x.m)).length, 0);
  assert.deepEqual(await monedero(x.m), { consumido: "0.000000", reservado: "0.000000", disponible: "10.000000" });
  await saldosOk();
});

T("resultado desconocido: la reserva sigue retenida (ni el tiempo ni otra clave la liberan); al conciliar como certificado se confirma y se cobra", async () => {
  const x = await mundoDigifact(10); x.sim.fijarEscenario(x.doc, "timeout_despues");
  const r = await x.cert(clave(1));
  assert.equal(r.operacion.estado, "desconocida");
  assert.deepEqual((await consumos(x.m, "certificacion")).map((c) => c.estado), ["reservado"]); assert.equal((await cargos(x.m)).length, 0);
  assert.deepEqual(await monedero(x.m), { consumido: "0.000000", reservado: "2.500000", disponible: "7.500000" });
  await assert.rejects(() => x.cert(clave(2)), (e) => e instanceof ErrorBd);   // otra clave sobre un documento por verificar: bloqueado
  assert.equal(x.sim.certificacionesDe(x.doc), 1, "no se envió dos veces");
  assert.equal((await x.srv.cerrarCobertura(x.m.empresa, String(r.operacion.id)) as { estado: string }).estado, "reservado", "operación aún abierta: no se toca");
  const c = await new OrquestadorDb(cx.rpc, x.prov, { ambiente: "simulado" }).conciliar(x.m.empresa, String(r.operacion.id));
  assert.ok(c); assert.equal((await uno("select estado from public.operaciones_fiscales where id = $1", [r.operacion.id])).estado, "confirmada_exitosa");
  await x.srv.cerrarCobertura(x.m.empresa, String(r.operacion.id));
  assert.deepEqual((await consumos(x.m, "certificacion")).map((c) => c.estado), ["confirmado"]); assert.deepEqual((await cargos(x.m)).map((c) => c.monto), ["2.500000"]);
  await x.srv.cerrarCobertura(x.m.empresa, String(r.operacion.id)); assert.equal((await cargos(x.m)).length, 1, "repetir no cobra dos veces");
  await saldosOk();
});

async function certificado() {
  const x = await mundoDigifact(10); const k = clave("c"); const r = await x.cert(k); assert.equal(r.operacion.estado, "confirmada_exitosa");
  const aut = String((await estadoDoc(cx, x.doc)).autorizacion_sat);
  const anular = (kk: string, motivo = "Error en los datos del receptor") => x.srv.anular({ actor: x.m.propietario, empresa: x.m.empresa, documento: x.doc, clave: kk, motivo, canal: x.canal, certificacion: { clave: k, autorizacion: aut } });
  return { ...x, k, aut, anular };
}

T("anulación simulada: éxito (el documento queda anulado, no se cobra), repetición idempotente y sin certificación no se anula", async () => {
  const x = await certificado(), ka = clave("a");
  const r = await x.anular(ka); assert.equal(r.estado, "confirmada_exitosa");
  assert.equal((await estadoDoc(cx, x.doc)).estado_fiscal, "anulado");
  assert.deepEqual((await consumos(x.m, "anulacion")).map((c) => c.estado), ["confirmado"]); assert.equal((await cargos(x.m)).length, 1, "solo el cargo de la certificación");
  const r2 = await x.anular(ka); assert.equal(r2.reutilizada, true); assert.equal((await consumos(x.m, "anulacion")).length, 1);
  await assert.rejects(() => x.anular(clave("b")), (e) => e instanceof ErrorBd);
  const y = await mundoDigifact(10);   // documento sin certificar
  await assert.rejects(() => y.srv.anular({ actor: y.m.propietario, empresa: y.m.empresa, documento: y.doc, clave: clave("z"), motivo: "No debería poder", canal: y.canal, certificacion: { clave: "x", autorizacion: "x" } }), (e) => e instanceof ErrorBd && e.codigo === "FEL_REGLA");
  await saldosOk();
});

T("anulación rechazada por el proveedor: el documento vuelve a «certificado»; desconocida: se concilia y se cierra solo si el proveedor lo garantiza", async () => {
  const x = await certificado(); x.sim.fijarEscenarioAnulacion(x.doc, "rechazo");
  const r = await x.anular(clave(1)); assert.equal(r.estado, "confirmada_fallida"); assert.equal((await estadoDoc(cx, x.doc)).estado_fiscal, "certificado");
  const y = await certificado(); y.sim.fijarEscenarioAnulacion(y.doc, "timeout_despues");
  const ky = clave(2), r2 = await y.anular(ky); assert.equal(r2.estado, "desconocida"); assert.deepEqual((await consumos(y.m, "anulacion")).map((c) => c.estado), ["reservado"]);
  const c = await y.srv.conciliarAnulacion({ empresa: y.m.empresa, operacion: String(r2.operacion.id), documento: y.doc, clave: ky, certificacion: { clave: y.k, autorizacion: y.aut }, motivo: "Error en los datos del receptor" });
  assert.equal(c.resultado, "anulado"); assert.equal(c.estado, "confirmada_exitosa"); assert.equal((await estadoDoc(cx, y.doc)).estado_fiscal, "anulado");
  assert.deepEqual((await consumos(y.m, "anulacion")).map((c2) => c2.estado), ["confirmado"]);
  const z = await certificado(); z.sim.fijarEscenarioAnulacion(z.doc, "indeterminado");
  const kz = clave(3), r3 = await z.anular(kz); assert.equal(r3.estado, "desconocida");
  const c3 = await z.srv.conciliarAnulacion({ empresa: z.m.empresa, operacion: String(r3.operacion.id), documento: z.doc, clave: kz, certificacion: { clave: z.k, autorizacion: z.aut }, motivo: "Error en los datos del receptor" });
  assert.equal(c3.resultado, "indeterminado"); assert.equal(c3.estado, "desconocida", "indeterminado nunca se cierra");
  await saldosOk();
});
