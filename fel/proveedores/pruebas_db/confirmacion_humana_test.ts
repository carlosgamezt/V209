// AUTORIZACIÓN HUMANA de la confirmación contra la BASE REAL: vista previa informada por el agente, contraste con la instantánea, permisos, estados, revocación,
// vencimiento, aislamiento entre empresas y registro auditado con la identidad de la PERSONA. Diseño: fel/docs/agente-confirmacion-humana.md.
import assert from "node:assert/strict";
import { ErrorBd } from "../src/rpc.ts";
import { OrquestadorDb } from "../src/orquestador_db.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../src/portal_playwright.ts";
import { clave, conexion, documentoRevisado, nuevoMundo, parametros, type Mundo } from "./mundo.ts";

const cx = conexion();
const T = (n: string, f: () => Promise<void>) => Deno.test({ name: `confirmación humana: ${n}`, sanitizeOps: false, sanitizeResources: false, fn: f });
const b64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const H = (c: string) => c.repeat(64);
const codigo = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof ErrorBd ? e.codigo : `otro:${e}`; } };

async function equipo(nombre = "PC") {
  await parametros(cx, 0, 0, 0);
  const m = await nuevoMundo(cx);
  const canal = (await cx.sql.unsafe("select (public.fel_op_canal_configurar($1, $2, null, 'portal_playwright', 'simulado', true)).id as id", [m.propietario, m.empresa]))[0].id as string;
  const cod = (await cx.rpc("fel_op_agente_codigo_crear", { p_actor: m.propietario, p_empresa: m.empresa }) as { codigo: string }).codigo;
  const agente = (await cx.rpc("fel_sys_agente_vincular", { p_codigo: cod, p_clave_publica: b64(), p_nombre: nombre, p_version: "1.0.0" }) as { agente_id: string }).agente_id;
  return { m, canal, agente };
}
type Eq = Awaited<ReturnType<typeof equipo>>;
const orq = () => new OrquestadorDb(cx.rpc, new PortalPlaywrightProvider(puertoOrdenesRpc(cx.rpc)));
/** Orden reclamada por el agente y presentada (llenada). */
async function presentada(e: Eq) {
  const doc = await documentoRevisado(cx, e.m);
  const s = await orq().solicitar({ actor: e.m.propietario, empresa: e.m.empresa, documento: doc, clave: clave("hum"), canal: e.canal });
  const r = await cx.rpc("fel_sys_orden_reclamar", { p_agente: e.agente }) as { orden: string; token: number; instantanea: Record<string, any> };
  await cx.rpc("fel_sys_orden_progreso", { p_agente: e.agente, p_orden: r.orden, p_token: r.token, p_fase: "detenido_en_vista_previa" });
  return { doc, op: s.operacion.id, orden: r.orden, token: r.token, inst: r.instantanea };
}
/** Lo que mostraría el simulador para ESA instantánea. */
const resumenDe = (inst: Record<string, any>, o: Record<string, unknown> = {}) => ({
  tipo_documento: "FACT-SIM", receptor: { tipo_id: inst.cliente.tipo_identificacion, id: inst.cliente.numero_identificacion }, establecimiento: inst.establecimiento.codigo_sat,
  lineas: inst.lineas.map((l: { orden: number }) => ({ n: l.orden })), total: String(Number(inst.base_imponible).toFixed(2)), ...o,
});
const vista = (e: Eq, p: { orden: string; token: number }, resumen: unknown, hash = H("a")) => cx.rpc("fel_sys_orden_vista_previa", { p_agente: e.agente, p_orden: p.orden, p_token: p.token, p_resumen: resumen, p_hash: hash });
const autorizar = (m: Mundo, orden: string, actor = m.propietario, ttl = 300) => cx.rpc("fel_op_orden_confirmacion_autorizar", { p_actor: actor, p_empresa: m.empresa, p_orden: orden, p_ttl_seg: ttl });

T("la vista previa se informa solo con la orden presentada, el token vigente y el agente de la orden; entradas mal formadas se rechazan", async () => {
  const e = await equipo(); const doc = await documentoRevisado(cx, e.m);
  await orq().solicitar({ actor: e.m.propietario, empresa: e.m.empresa, documento: doc, clave: clave("v1"), canal: e.canal });
  const r = await cx.rpc("fel_sys_orden_reclamar", { p_agente: e.agente }) as { orden: string; token: number; instantanea: Record<string, any> };
  assert.equal(await codigo(vista(e, r, resumenDe(r.instantanea))), "FEL_ESTADO", "reclamada pero aún no presentada");
  await cx.rpc("fel_sys_orden_progreso", { p_agente: e.agente, p_orden: r.orden, p_token: r.token, p_fase: "detenido_en_vista_previa" });
  assert.equal(await codigo(vista(e, { orden: r.orden, token: 99 }, resumenDe(r.instantanea))), "FEL_FENCING");
  for (const mal of [[null, H("a")], [[1], H("a")], ["texto", H("a")], [{ x: "y".repeat(21000) }, H("a")], [{}, "no-es-hash"], [{}, H("A")], [{}, null]] as const) assert.equal(await codigo(vista(e, r, mal[0], mal[1] as string)), "FEL_DATOS_INVALIDOS");
  const ajeno = await equipo("otra empresa");
  assert.equal(await codigo(cx.rpc("fel_sys_orden_vista_previa", { p_agente: ajeno.agente, p_orden: r.orden, p_token: r.token, p_resumen: {}, p_hash: H("a") })), "FEL_EMPRESA", "un agente de otra empresa no informa sobre órdenes ajenas");
  assert.equal(await codigo(vista(e, r, resumenDe(r.instantanea))), "OK");
});

T("la PERSONA autoriza: exige permiso, orden presentada, vigente, agente activo, vista previa informada y coincidente; una autorización vigente por orden; auditada con la persona", async () => {
  const e = await equipo(); const p = await presentada(e);
  assert.equal(await codigo(autorizar(e.m, p.orden)), "FEL_ESTADO", "el agente aún no informó la vista previa");
  assert.equal(await codigo(vista(e, p, resumenDe(p.inst))), "OK");
  for (const [rol, u] of [["lector", e.m.lector], ["emisor", e.m.emisor]] as const) assert.equal(await codigo(autorizar(e.m, p.orden, u)), "FEL_NO_AUTORIZADO", `${rol} no autoriza`);
  assert.equal(await codigo(autorizar(e.m, p.orden, e.m.propietario, 10)), "FEL_DATOS_INVALIDOS"); assert.equal(await codigo(autorizar(e.m, p.orden, e.m.propietario, 5000)), "FEL_DATOS_INVALIDOS");
  const a = await autorizar(e.m, p.orden) as { resumen_hash: string; usuario: string; jti: string; expira_en: string };
  assert.equal(a.resumen_hash, H("a")); assert.equal(a.usuario, e.m.propietario); assert.match(a.jti, /^[0-9a-f]{32}$/);
  assert.equal(await codigo(autorizar(e.m, p.orden, e.m.admin2)), "FEL_CONFLICTO", "ya hay una autorización vigente");
  const aud = await cx.sql.unsafe("select actor_user_id, origen from public.auditoria where accion = 'orden.confirmacion_autorizada' and entidad_id = $1", [p.orden]);
  assert.equal(aud.length, 1); assert.equal(aud[0].actor_user_id, e.m.propietario);
  const v = await cx.rpc("fel_op_orden_vista_previa", { p_actor: e.m.lector, p_empresa: e.m.empresa, p_orden: p.orden }) as { autorizada: boolean; hash: string };
  assert.equal(v.autorizada, true); assert.equal(v.hash, H("a"));
  assert.equal(await codigo(vista(e, p, resumenDe(p.inst), H("b"))), "FEL_CONFLICTO", "la vista previa autorizada ya no puede cambiar");
});

T("si la vista previa NO coincide con el documento (receptor, establecimiento, conceptos o total) NEXA no concede la autorización", async () => {
  const e = await equipo(); const p = await presentada(e);
  const casos: [string, Record<string, unknown>][] = [
    ["receptor", { receptor: { tipo_id: "NIT", id: "9999999-9" } }], ["establecimiento", { establecimiento: "77" }],
    ["conceptos", { lineas: [{ n: 1 }, { n: 2 }] }], ["total", { total: "999.00" }], ["total", { total: "20.97" }],
  ];
  for (const [campo, cambio] of casos) {
    await vista(e, p, resumenDe(p.inst, cambio), H("c"));
    const c = await codigo(autorizar(e.m, p.orden)); assert.equal(c, "FEL_REGLA", `${campo}: ${c}`);
  }
  assert.equal((await cx.sql.unsafe("select count(*)::int as n from public.ordenes_confirmaciones where orden_id = $1", [p.orden]))[0].n, 0, "no se concedió nada");
  await vista(e, p, resumenDe(p.inst, { total: "21.01" }), H("d"));   // diferencia de un centavo con un concepto: tolerancia de redondeo
  assert.equal(await codigo(autorizar(e.m, p.orden)), "OK");
});

T("no se concede con la orden vencida, con el agente revocado, con la operación cerrada ni en otro estado", async () => {
  const e1 = await equipo(); const p1 = await presentada(e1); await vista(e1, p1, resumenDe(p1.inst));
  await cx.sql.unsafe("update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id = $1", [p1.orden]);
  assert.equal(await codigo(autorizar(e1.m, p1.orden)), "FEL_ESTADO", "vencida");
  await cx.rpc("fel_sys_ordenes_vencer", { p_empresa: e1.m.empresa });
  assert.equal(await codigo(autorizar(e1.m, p1.orden)), "FEL_ESTADO", "incierta");
  const e2 = await equipo(); const p2 = await presentada(e2); await vista(e2, p2, resumenDe(p2.inst));
  await cx.rpc("fel_op_agente_revocar", { p_actor: e2.m.propietario, p_empresa: e2.m.empresa, p_agente: e2.agente });
  assert.equal(await codigo(autorizar(e2.m, p2.orden)), "FEL_ESTADO", "revocar el agente expira su orden (presentada ⇒ incierta) y ya no se autoriza");
  assert.equal((await cx.sql.unsafe("select estado from public.ordenes_emision where id = $1", [p2.orden]))[0].estado, "incierta");
  assert.equal(((await cx.sql.unsafe("select estado_fiscal from public.documentos where id = $1", [p2.doc]))[0]).estado_fiscal, "por_verificar");
  const e3 = await equipo(); const p3 = await presentada(e3); await vista(e3, p3, resumenDe(p3.inst));
  await cx.rpc("fel_sys_orden_resultado", { p_agente: e3.agente, p_orden: p3.orden, p_token: p3.token, p_tipo: "descartado", p_serie: null, p_numero: null, p_autorizacion: null, p_detalle: "x" });
  assert.equal(await codigo(autorizar(e3.m, p3.orden)), "FEL_ESTADO", "descartada");
});

T("una autorización caducada permite autorizar de nuevo (nueva concesión); la anterior queda registrada y no se borra", async () => {
  const e = await equipo(); const p = await presentada(e); await vista(e, p, resumenDe(p.inst));
  const a1 = await autorizar(e.m, p.orden) as { jti: string };
  await cx.sql.unsafe("alter table public.ordenes_confirmaciones disable trigger ordenes_confirmaciones_solo_insertar");
  await cx.sql.unsafe("update public.ordenes_confirmaciones set expira_en = clock_timestamp() - interval '1 second' where orden_id = $1", [p.orden]);
  await cx.sql.unsafe("alter table public.ordenes_confirmaciones enable trigger ordenes_confirmaciones_solo_insertar");
  const a2 = await autorizar(e.m, p.orden) as { jti: string }; assert.notEqual(a1.jti, a2.jti);
  assert.equal((await cx.sql.unsafe("select count(*)::int as n from public.ordenes_confirmaciones where orden_id = $1", [p.orden]))[0].n, 2);
  await assert.rejects(cx.sql.unsafe("update public.ordenes_confirmaciones set jti = repeat($1, 20) where orden_id = $2", ["x", p.orden]), /FEL_APPEND_ONLY/, "tabla de solo inserción");
});

T("AISLAMIENTO entre empresas: la persona de otra empresa no ve ni autoriza la orden; las funciones no son invocables por usuarios", async () => {
  const a = await equipo("A"), b = await equipo("B"); const p = await presentada(a); await vista(a, p, resumenDe(p.inst));
  assert.equal(await codigo(autorizar(b.m, p.orden, b.m.propietario)), "FEL_NO_ENCONTRADO");
  assert.equal(await codigo(cx.rpc("fel_op_orden_vista_previa", { p_actor: b.m.propietario, p_empresa: b.m.empresa, p_orden: p.orden })), "FEL_NO_ENCONTRADO");
  assert.equal(await codigo(cx.rpc("fel_op_orden_confirmacion_autorizar", { p_actor: b.m.propietario, p_empresa: a.m.empresa, p_orden: p.orden, p_ttl_seg: 300 })), "FEL_NO_AUTORIZADO", "tampoco indicando la empresa ajena");
  assert.equal(await codigo(autorizar(a.m, p.orden, b.m.propietario)), "FEL_NO_AUTORIZADO", "ni una persona de B en la empresa A");
  assert.equal((await cx.sql.unsafe("select count(*)::int as n from public.ordenes_confirmaciones where orden_id = $1", [p.orden]))[0].n, 0);
});

T("cierre de conexión", async () => { await cx.cerrar(); });
