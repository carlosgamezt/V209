// Certificador B SIMULADO: pasa la MISMA suite de contrato que Mock y Digifact (prueba de que un certificador nuevo se incorpora sin tocar el orquestador) + anulación, consumos y registro.
import assert from "node:assert/strict";
import { CertificadorBSimulado } from "../src/certificador_b.ts";
import { registroSimulado } from "../src/registro.ts";
import type { Escenario } from "../src/mock.ts";
import { CTX, clave, documento } from "./datos.ts";
import { ejecutarSuiteContrato, type EscenarioContrato } from "./suite_contrato.ts";
import type { SolicitudCertificacion } from "../src/tipos.ts";
import type { SolicitudAnulacion } from "../src/digifact.ts";

ejecutarSuiteContrato("certificador-b-simulado", () => {
  const b = new CertificadorBSimulado(); const mapa: Record<EscenarioContrato, Escenario> = { exito: "exito", rechazo: "rechazo", desconocido_certificado: "timeout_despues", desconocido_no_certificado: "timeout_antes", indeterminado: "timeout_indeterminado" };
  return { proveedor: b, preparar: (e, id) => b.fijarEscenario(id, mapa[e]), certificacionesDe: (id) => b.base_certificacionesDe(id) };
});

const sol = (id: string, n: number): SolicitudCertificacion => ({ empresaId: "e1", establecimientoId: "est-1", documentoId: id, operacionId: `op-${n}`, claveIdempotencia: clave(n), hashContenido: "b".repeat(64), instantanea: documento(id), ambiente: "simulado" });
Deno.test("certificador B: anulación (éxito, rechazo, desconocida y conciliación), consumos y consumo ajeno; solo simulado", async () => {
  const b = new CertificadorBSimulado(10), s = sol("d1", 1); const r = await b.enviar(s, CTX); assert.equal(r.tipo, "certificado"); assert.equal(b.saldo, 9);
  const an = (n: number, docId = "d1"): SolicitudAnulacion => ({ empresaId: "e1", documentoId: docId, operacionId: `anu-${n}`, claveIdempotencia: clave(100 + n), referenciaCertificacion: s.claveIdempotencia, autorizacion: r.tipo === "certificado" ? r.autorizacion : "", motivo: "Error en los datos", ambiente: "simulado" });
  b.fijarEscenarioAnulacion("d1", "rechazo"); assert.equal((await b.anular(an(1), CTX)).tipo, "rechazado_confirmado");
  b.fijarEscenarioAnulacion("d1", "timeout_antes"); assert.equal((await b.anular(an(2), CTX)).tipo, "desconocido"); assert.equal((await b.conciliarAnulacion(an(2), CTX)).tipo, "no_anulado_confirmado");
  b.fijarEscenarioAnulacion("d1", "timeout_despues"); assert.equal((await b.anular(an(3), CTX)).tipo, "desconocido"); assert.equal((await b.conciliarAnulacion(an(3), CTX)).tipo, "anulado");
  b.inyectarConsumoAjeno("AJENO-1"); const lin = await b.obtenerConsumos("2026-01-01", "2026-12-31", CTX);
  assert.deepEqual(lin.map((l) => l.evento).sort(), ["AJENO", "ANULACION", "CERTIFICACION"]); assert.equal(b.saldo, 7, "certificación + anulación + consumo ajeno");
  assert.ok(b.omitirUltimoConsumo()); assert.ok(!(await b.obtenerConsumos("a", "b", CTX)).some((l) => l.evento === "CERTIFICACION"), "el reporte omite lo pedido");
  await assert.rejects(() => b.obtenerConsumos("a", "b", { ...CTX, ambiente: "pruebas" }), /simulado/); await assert.rejects(() => b.anular(an(4), { ...CTX, ambiente: "produccion" }), /simulado/);
  assert.equal((await b.anular({ ...an(5), referenciaCertificacion: "no-existe" }, CTX)).tipo, "rechazado_confirmado");
});
Deno.test("registro: solo certificadores simulados, sin duplicados; los descriptores alimentan las pantallas", () => {
  const reg = registroSimulado(async () => null); assert.deepEqual(reg.ids().sort(), ["certificador_b", "digifact"]); assert.ok(reg.tiene("digifact") && !reg.tiene("mock") && !reg.tiene(undefined));
  for (const d of reg.listar()) { assert.equal(d.simulado, true); assert.match(d.nombre, /simulado/i); assert.ok(d.escenarios.some((e) => e.id === "exito") && d.escenariosAnulacion.length > 0); assert.equal(d.proveedor.capacidades.id, d.id); }
  assert.throws(() => reg.registrar(reg.obtener("digifact")!), /duplicado/); assert.throws(() => reg.registrar({ ...reg.obtener("digifact")!, id: "real", simulado: false as never }), /SIMULADOS/);
});
