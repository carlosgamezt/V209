import assert from "node:assert/strict";
import { MockProvider, type Escenario } from "../src/mock.ts";
import { ErrorOrquestador, OrquestadorReferencia } from "../src/orquestador_referencia.ts";
import type { EmissionProvider, ResultadoEnvio } from "../src/tipos.ts";
import { clave, documento } from "./datos.ts";

async function listo(escenario: Escenario, opciones: { idempotenciaNativa?: boolean } = {}) {
  const m = new MockProvider({ escenarioPorDefecto: escenario, ...opciones }), o = new OrquestadorReferencia(m);
  o.crearBorrador(documento("d1")); await o.revisar("d1"); return { m, o };
}
const codigo = (e: unknown) => (e instanceof ErrorOrquestador ? e.codigo : "otro");

Deno.test("flujo feliz: borrador → validación → revisión → solicitud → certificado → PDF/XML", async () => {
  const m = new MockProvider(), o = new OrquestadorReferencia(m); o.crearBorrador(documento("d1"));
  assert.equal((await o.validar("d1")).ok, true); await o.revisar("d1"); assert.equal(o.documento("d1").estadoPreparacion, "revisado");
  const r = await o.solicitarCertificacion("d1", clave(1)); assert.deepEqual([r.estadoOperacion, r.estadoFiscal, r.reutilizada], ["confirmada_exitosa", "certificado", false]);
  const d = o.documento("d1"); assert.match(d.datosFiscales!.autorizacion, /^SIM-/); const art = await o.obtenerArtefactos("d1"); assert.deepEqual(art.map((a) => a.tipo).sort(), ["pdf", "xml"]);
  assert.equal(m.certificacionesDe("d1"), 1); assert.equal(o.enviosAlProveedor, 1);
});
Deno.test("validación: un documento inválido no se puede revisar ni, por tanto, certificar", async () => {
  const o = new OrquestadorReferencia(new MockProvider()); o.crearBorrador(documento("d1", { total: "1.000000" }));
  await assert.rejects(() => o.revisar("d1"), (e) => codigo(e) === "VALIDACION"); await assert.rejects(() => o.solicitarCertificacion("d1", clave(1)), (e) => codigo(e) === "ESTADO_INVALIDO");
});
Deno.test("borrador sin revisar y claves inválidas no envían nada", async () => {
  const m = new MockProvider(), o = new OrquestadorReferencia(m); o.crearBorrador(documento("d1"));
  await assert.rejects(() => o.solicitarCertificacion("d1", clave(1)), (e) => codigo(e) === "ESTADO_INVALIDO"); await o.revisar("d1");
  await assert.rejects(() => o.solicitarCertificacion("d1", "corta"), (e) => codigo(e) === "CLAVE_INVALIDA"); assert.equal(m.llamadasEnviar.length, 0);
});
Deno.test("resultados desconocidos → por_verificar; sin reintentos; nada nuevo hasta conciliar", async () => {
  for (const esc of ["timeout_antes", "timeout_despues", "corte_despues", "respuesta_ilegible", "codigo_desconocido_certificado", "codigo_desconocido_no_certificado", "timeout_indeterminado", "timeout_tardio", "limite_tasa", "caida"] as Escenario[]) {
    const { m, o } = await listo(esc, { idempotenciaNativa: false }); const r = await o.solicitarCertificacion("d1", clave(1));
    assert.deepEqual([r.estadoOperacion, r.estadoFiscal], ["desconocida", "por_verificar"], esc);
    await assert.rejects(() => o.solicitarCertificacion("d1", clave(2)), (e) => codigo(e) === "POR_VERIFICAR", esc);   // otra clave: bloqueada
    const mismo = await o.solicitarCertificacion("d1", clave(1)); assert.equal(mismo.reutilizada, true, esc);          // misma clave: la misma operación, sin reenviar
    assert.equal(o.enviosAlProveedor, 1, esc); assert.ok(m.certificacionesDe("d1") <= 1, esc);
  }
});
Deno.test("conciliación: el proveedor confirma certificado / no existe / indeterminado", async () => {
  const a = await listo("timeout_despues", { idempotenciaNativa: false }); await a.o.solicitarCertificacion("d1", clave(1));
  assert.equal((await a.o.conciliar("d1")).tipo, "certificado"); assert.equal(a.o.documento("d1").estadoFiscal, "certificado"); assert.equal(a.m.certificacionesDe("d1"), 1);
  const b = await listo("timeout_antes", { idempotenciaNativa: false }); await b.o.solicitarCertificacion("d1", clave(1));
  assert.equal((await b.o.conciliar("d1")).tipo, "rechazado"); assert.equal(b.o.documento("d1").estadoFiscal, "rechazado");
  const c = await listo("timeout_indeterminado"); await c.o.solicitarCertificacion("d1", clave(1));
  assert.equal((await c.o.conciliar("d1")).tipo, "indeterminado"); assert.equal(c.o.documento("d1").estadoFiscal, "por_verificar"); await assert.rejects(() => c.o.solicitarCertificacion("d1", clave(2)), (e) => codigo(e) === "POR_VERIFICAR");
});
Deno.test("tras un rechazo/no-existe confirmado: volver a borrador, revisar y reintentar con OTRA clave (y la clave vieja no se reutiliza para otro contenido)", async () => {
  const { m, o } = await listo("timeout_antes", { idempotenciaNativa: false }); await o.solicitarCertificacion("d1", clave(1)); await o.conciliar("d1");
  await assert.rejects(() => o.solicitarCertificacion("d1", clave(2)), (e) => codigo(e) === "ESTADO_INVALIDO");   // hay que volver a borrador y revisar
  o.volverABorrador("d1"); o.editarBorrador("d1", documento("d1", { fechaEmision: "2026-01-02" })); await o.revisar("d1");
  await assert.rejects(() => o.solicitarCertificacion("d1", clave(1)), (e) => codigo(e) === "CLAVE_CON_OTRO_CONTENIDO");
  m.fijarEscenario("d1", "exito"); const r = await o.solicitarCertificacion("d1", clave(2)); assert.equal(r.estadoFiscal, "certificado"); assert.equal(m.certificacionesDe("d1"), 1); assert.equal(o.enviosAlProveedor, 2);
});
Deno.test("doble envío concurrente (misma clave y distinta clave): un solo envío y una sola certificación", async () => {
  const { m, o } = await listo("exito", { idempotenciaNativa: false });
  const [a, b] = await Promise.all([o.solicitarCertificacion("d1", clave(1)), o.solicitarCertificacion("d1", clave(1))]);
  assert.equal(a.operacionId, b.operacionId); assert.equal([a, b].filter((x) => x.reutilizada).length, 1); assert.equal(o.enviosAlProveedor, 1); assert.equal(m.certificacionesDe("d1"), 1);
  const x = await listo("exito", { idempotenciaNativa: false });
  const res = await Promise.allSettled([x.o.solicitarCertificacion("d1", clave(1)), x.o.solicitarCertificacion("d1", clave(2))]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1); assert.equal(res.filter((r) => r.status === "rejected" && codigo(r.reason) === "OPERACION_ABIERTA").length, 1); assert.equal(x.m.certificacionesDe("d1"), 1);
});
Deno.test("un DTE certificado es inmutable y no se vuelve a certificar", async () => {
  const { m, o } = await listo("exito"); await o.solicitarCertificacion("d1", clave(1)); const antes = structuredClone(o.documento("d1").datosFiscales);
  await assert.rejects(() => o.solicitarCertificacion("d1", clave(2)), (e) => codigo(e) === "ESTADO_INVALIDO");
  assert.throws(() => o.editarBorrador("d1", documento("d1")), (e) => codigo(e) === "ESTADO_INVALIDO"); assert.throws(() => o.volverABorrador("d1"), (e) => codigo(e) === "ESTADO_INVALIDO");
  assert.deepEqual(o.documento("d1").datosFiscales, antes); assert.equal(m.certificacionesDe("d1"), 1); assert.equal(o.operacionesDe("d1")[0].estado, "confirmada_exitosa");
});
Deno.test("resolución manual: exige evidencia y datos fiscales; no reabre lo confirmado", async () => {
  const { o } = await listo("timeout_indeterminado"); await o.solicitarCertificacion("d1", clave(1));
  await assert.rejects(() => o.conciliar("d1", { resultado: "fallida", evidencia: "  " }), (e) => codigo(e) === "EVIDENCIA_REQUERIDA");
  await assert.rejects(() => o.conciliar("d1", { resultado: "certificado", evidencia: "captura del portal" }), (e) => codigo(e) === "EVIDENCIA_REQUERIDA");
  assert.equal((await o.conciliar("d1", { resultado: "certificado", evidencia: "captura del portal", datos: { serie: "SIM-A", numero: "00000001", autorizacion: "SIM-MANUAL-1", fechaCertificacion: "2026-01-01T12:00:00Z" } })).tipo, "certificado");
  assert.equal(o.operacionesDe("d1")[0].resolucion, "conciliacion_manual"); await assert.rejects(() => o.conciliar("d1"), (e) => codigo(e) === "SIN_OPERACION");
});
Deno.test("respuestas sospechosas no se toman por éxito: datos fiscales incompletos y autorización repetida en otro documento", async () => {
  const falso: EmissionProvider = { capacidades: { ...new MockProvider().capacidades }, validar: async () => ({ ok: true, errores: [] }), conciliar: async () => ({ tipo: "indeterminado", motivo: "x" }), obtenerArtefactos: async () => [], salud: async () => ({ ok: true, detalle: "" }),
    enviar: async (s) => (s.documentoId === "d3" ? { tipo: "certificado", serie: "A", numero: "1", autorizacion: "REPETIDA", fechaCertificacion: "2026-01-01T00:00:00Z", artefactos: [] } : s.documentoId === "d1" ? { tipo: "certificado", serie: "", numero: "1", autorizacion: "X", fechaCertificacion: "t", artefactos: [] } : { tipo: "certificado", serie: "A", numero: "2", autorizacion: "REPETIDA", fechaCertificacion: "2026-01-01T00:00:00Z", artefactos: [] }) as ResultadoEnvio };
  const o = new OrquestadorReferencia(falso);
  for (const id of ["d1", "d2", "d3"]) { o.crearBorrador(documento(id)); await o.revisar(id); }
  assert.equal((await o.solicitarCertificacion("d1", clave(1))).estadoFiscal, "por_verificar");   // serie vacía
  assert.equal((await o.solicitarCertificacion("d3", clave(3))).estadoFiscal, "certificado");
  assert.equal((await o.solicitarCertificacion("d2", clave(2))).estadoFiscal, "por_verificar");   // misma autorización en otro documento
});
Deno.test("excepción del adaptador y tiempo agotado → desconocido (nunca éxito, nunca fallo)", async () => {
  const base = new MockProvider();
  const lanza: EmissionProvider = { ...base, capacidades: base.capacidades, validar: (d, c) => base.validar(d, c), conciliar: (r, c) => base.conciliar(r, c), obtenerArtefactos: (r, c) => base.obtenerArtefactos(r, c), salud: (c) => base.salud(c), enviar: () => Promise.reject(new Error("boom")) };
  const lento: EmissionProvider = { ...lanza, capacidades: { ...base.capacidades, tiempoMaximoMs: 20 }, enviar: () => new Promise(() => {}) };
  for (const [prov, motivo] of [[lanza, "excepcion_del_adaptador"], [lento, "timeout"]] as const) {
    const o = new OrquestadorReferencia(prov); o.crearBorrador(documento("d1")); await o.revisar("d1"); const r = await o.solicitarCertificacion("d1", clave(1));
    assert.deepEqual([r.estadoOperacion, r.estadoFiscal], ["desconocida", "por_verificar"]); assert.equal(o.operacion(r.operacionId).motivoDesconocido, motivo);
  }
});
Deno.test("canal asistido: la orden queda abierta (nada nuevo mientras tanto) y se cierra con el resultado leído", async () => {
  const { m, o } = await listo("accion_humana"); const r = await o.solicitarCertificacion("d1", clave(1));
  assert.deepEqual([r.estadoOperacion, r.estadoFiscal], ["iniciada", "pendiente_certificacion"]); const ordenId = o.operacion(r.operacionId).ordenId!;
  await assert.rejects(() => o.solicitarCertificacion("d1", clave(2)), (e) => codigo(e) === "OPERACION_ABIERTA"); assert.equal((await o.conciliar("d1")).tipo, "indeterminado");
  const fin = await m.completarAccionHumana(ordenId, { ambiente: "simulado", ahora: () => new Date("2026-01-01T12:00:00Z") }); o.resolverAccionHumana(r.operacionId, fin);
  assert.equal(o.documento("d1").estadoFiscal, "certificado"); assert.equal(m.certificacionesDe("d1"), 1); assert.throws(() => o.resolverAccionHumana(r.operacionId, fin), (e) => codigo(e) === "SIN_OPERACION");
});
Deno.test("revisión congela el contenido: un documento revisado no se edita; para cambiarlo hay que volver a borrador y revisar de nuevo (nuevo hash); lo enviado coincide con lo revisado", async () => {
  const { m, o } = await listo("exito"); const hash1 = o.documento("d1").hash;
  assert.throws(() => o.editarBorrador("d1", documento("d1", { fechaEmision: "2026-02-02" })), (e) => codigo(e) === "ESTADO_INVALIDO");
  o.volverABorrador("d1"); assert.equal(o.documento("d1").hash, undefined); await assert.rejects(() => o.solicitarCertificacion("d1", clave(1)), (e) => codigo(e) === "ESTADO_INVALIDO");
  o.editarBorrador("d1", documento("d1", { fechaEmision: "2026-02-02" })); const hash2 = await o.revisar("d1"); assert.notEqual(hash1, hash2);
  await o.solicitarCertificacion("d1", clave(1)); assert.equal(m.servidor[0].hashContenido, hash2);
});
Deno.test("RIESGO DOCUMENTADO: si una persona declara «fallida» a mano un envío que el proveedor procesa DESPUÉS, el reintento puede duplicar; la auditoría de fallidas lo detecta", async () => {
  const { m, o } = await listo("timeout_tardio", { idempotenciaNativa: false }); await o.solicitarCertificacion("d1", clave(1));
  await o.conciliar("d1", { resultado: "fallida", evidencia: "error humano: parecía que no existía" });   // el servidor aún no había procesado
  assert.equal(o.documento("d1").estadoFiscal, "rechazado"); await m.liberarTardios({ ambiente: "simulado", ahora: () => new Date("2026-01-01T12:00:00Z") });
  assert.equal(m.certificacionesDe("d1"), 1, "el servidor certificó después de la declaración manual");
  const huerfanas = await o.auditarFallidas("d1"); assert.equal(huerfanas.length, 1, "la auditoría detecta la certificación huérfana"); assert.equal(huerfanas[0].resolucion, "conciliacion_manual");
  // Sin la auditoría (y con un servidor que no deduplica) un reintento tras volver a borrador duplicaría: por eso la Fase 2 exige espera mínima, segunda aprobación y auditoría previa al reintento.
  o.volverABorrador("d1"); await o.revisar("d1"); m.fijarEscenario("d1", "exito"); await o.solicitarCertificacion("d1", clave(2)); assert.equal(m.certificacionesDe("d1"), 2, "duplicado: es exactamente lo que hay que impedir con las salvaguardas de la Fase 2");
});
