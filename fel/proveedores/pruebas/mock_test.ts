import assert from "node:assert/strict";
import { MockProvider, type Escenario } from "../src/mock.ts";
import { ErrorProveedor } from "../src/tipos.ts";
import type { OperacionRef, SolicitudCertificacion } from "../src/tipos.ts";
import { aEscalado, deEscalado, validarDocumento } from "../src/validacion.ts";
import { CTX, clave, documento } from "./datos.ts";
import { ejecutarSuiteContrato, type EscenarioContrato } from "./suite_contrato.ts";

const sol = (id: string, n: number, e?: Escenario): SolicitudCertificacion => ({ empresaId: "empresa-prueba-1", establecimientoId: "est-1", documentoId: id, operacionId: `op-${n}`, claveIdempotencia: clave(n), hashContenido: "b".repeat(64), instantanea: documento(id), ambiente: "simulado", ...(e ? {} : {}) });
const ref = (s: SolicitudCertificacion): OperacionRef => ({ empresaId: s.empresaId, documentoId: s.documentoId, operacionId: s.operacionId, claveIdempotencia: s.claveIdempotencia, ambiente: "simulado" });

// El mock debe pasar la suite de contrato que pasarán los adaptadores reales.
ejecutarSuiteContrato("mock", () => {
  const m = new MockProvider(); const mapa: Record<EscenarioContrato, Escenario> = { exito: "exito", rechazo: "rechazo", desconocido_certificado: "timeout_despues", desconocido_no_certificado: "timeout_antes", indeterminado: "timeout_indeterminado" };
  return { proveedor: m, preparar: (e, id) => m.fijarEscenario(id, mapa[e]), certificacionesDe: (id) => m.certificacionesDe(id) };
});

Deno.test("mock: tabla de escenarios → resultado del cliente y verdad del servidor", async () => {
  const tabla: [Escenario, string, number, string][] = [
    ["exito", "certificado", 1, "certificado"], ["rechazo", "rechazado_confirmado", 0, "no_existe_confirmado"],
    ["timeout_antes", "desconocido", 0, "no_existe_confirmado"], ["timeout_despues", "desconocido", 1, "certificado"], ["corte_despues", "desconocido", 1, "certificado"],
    ["respuesta_ilegible", "desconocido", 1, "certificado"], ["codigo_desconocido_certificado", "desconocido", 1, "certificado"], ["codigo_desconocido_no_certificado", "desconocido", 0, "no_existe_confirmado"],
    ["timeout_indeterminado", "desconocido", 0, "indeterminado"], ["timeout_tardio", "desconocido", 0, "indeterminado"], ["limite_tasa", "desconocido", 0, "no_existe_confirmado"], ["caida", "desconocido", 0, "no_existe_confirmado"],
    ["accion_humana", "requiere_accion_humana", 0, "indeterminado"],
  ];
  for (const [esc, cliente, servidor, conciliacion] of tabla) {
    const m = new MockProvider({ escenarioPorDefecto: esc }); const s = sol("d1", 1); const r = await m.enviar(s, CTX);
    assert.equal(r.tipo, cliente, esc); assert.equal(m.certificacionesDe("d1"), servidor, esc); assert.equal((await m.conciliar(ref(s), CTX)).tipo, conciliacion, esc);
  }
});
Deno.test("mock: motivos de lo desconocido y respuesta tardía", async () => {
  const motivo = async (e: Escenario) => { const r = await new MockProvider({ escenarioPorDefecto: e }).enviar(sol("d1", 1), CTX); return r.tipo === "desconocido" ? r.motivo : r.tipo; };
  assert.equal(await motivo("timeout_antes"), "timeout"); assert.equal(await motivo("corte_despues"), "corte"); assert.equal(await motivo("respuesta_ilegible"), "respuesta_ilegible");
  assert.equal(await motivo("codigo_desconocido_certificado"), "codigo_no_mapeado"); assert.equal(await motivo("caida"), "limite_o_caida"); assert.equal(await motivo("limite_tasa"), "limite_o_caida");
  const m = new MockProvider({ escenarioPorDefecto: "timeout_tardio" }); const s = sol("d1", 1); await m.enviar(s, CTX);
  assert.equal(m.certificacionesDe("d1"), 0); await m.liberarTardios(CTX); assert.equal(m.certificacionesDe("d1"), 1, "el servidor certifica DESPUÉS"); assert.equal((await m.conciliar(ref(s), CTX)).tipo, "certificado");
});
Deno.test("mock: acción humana — la orden queda abierta hasta que la persona termina", async () => {
  const m = new MockProvider({ escenarioPorDefecto: "accion_humana" }); const s = sol("d1", 1); const r = await m.enviar(s, CTX);
  assert.equal(r.tipo, "requiere_accion_humana"); if (r.tipo !== "requiere_accion_humana") return;
  assert.equal((await m.conciliar(ref(s), CTX)).tipo, "indeterminado"); const f = await m.completarAccionHumana(r.ordenId, CTX); assert.equal(f.tipo, "certificado"); assert.equal(m.certificacionesDe("d1"), 1);
  await assert.rejects(() => m.completarAccionHumana(r.ordenId, CTX), ErrorProveedor);
});
Deno.test("mock: si el «servidor» no deduplica, reenviar la misma referencia crea OTRA certificación (por eso el orquestador nunca reenvía)", async () => {
  const sin = new MockProvider({ idempotenciaNativa: false }); const s = sol("d1", 1); await sin.enviar(s, CTX); await sin.enviar(s, CTX); assert.equal(sin.certificacionesDe("d1"), 2);
  const con = new MockProvider({ idempotenciaNativa: true }); await con.enviar(s, CTX); const r2 = await con.enviar(s, CTX); assert.equal(con.certificacionesDe("d1"), 1); assert.equal(r2.tipo, "certificado");
});
Deno.test("mock: determinista y marcado como SIMULADO sin valor fiscal (XML y PDF)", async () => {
  const a = new MockProvider(), b = new MockProvider(); const ra = await a.enviar(sol("d1", 1), CTX), rb = await b.enviar(sol("d1", 1), CTX);
  assert.deepEqual(ra, rb, "misma entrada, misma salida (sin azar ni reloj)");
  if (ra.tipo !== "certificado") throw new Error("se esperaba certificado");
  assert.match(ra.serie, /^SIM/); assert.match(ra.autorizacion, /^SIM-/); assert.equal(ra.fechaCertificacion, "2026-01-01T12:00:00.000Z");
  const xml = new TextDecoder().decode(ra.artefactos.find((x) => x.tipo === "xml")!.contenido), pdf = new TextDecoder().decode(ra.artefactos.find((x) => x.tipo === "pdf")!.contenido);
  assert.match(xml, /SIMULADO - SIN VALOR FISCAL/); assert.match(pdf, /^%PDF-1\.4/); assert.match(pdf, /SIMULADO - SIN VALOR FISCAL/);
  assert.equal((await a.obtenerArtefactos(ref(sol("d1", 1)), CTX)).length, 2);
});
Deno.test("mock: solo funciona en el ambiente «simulado»", async () => {
  const m = new MockProvider();
  for (const amb of ["pruebas", "produccion"] as const) { const c = { ...CTX, ambiente: amb }; await assert.rejects(() => m.enviar({ ...sol("d1", 1), ambiente: amb }, c), ErrorProveedor); await assert.rejects(() => m.validar(documento("d1"), c), ErrorProveedor); await assert.rejects(() => m.conciliar(ref(sol("d1", 1)), c), ErrorProveedor); }
  assert.deepEqual(m.capacidades.ambientes, ["simulado"]); assert.equal(m.llamadasEnviar.length, 0, "ningún intento llegó al servidor simulado");
});
Deno.test("validación estructural: errores concretos y aritmética decimal exacta", () => {
  assert.equal(validarDocumento(documento("d1")).ok, true);
  const codigos = (cambios: Parameters<typeof documento>[1]) => validarDocumento(documento("d1", cambios)).errores.map((e) => e.codigo);
  assert.ok(codigos({ lineas: [] }).includes("SIN_LINEAS")); assert.ok(codigos({ total: "250.000000" }).includes("TOTAL_NO_COINCIDE")); assert.ok(codigos({ fechaEmision: "01/01/2026" }).includes("FECHA"));
  assert.ok(codigos({ receptor: { tipoId: "CF", id: "123" } }).includes("RECEPTOR_CF")); assert.ok(codigos({ receptor: { tipoId: "NIT", id: " " } }).includes("RECEPTOR"));
  const l = documento("d1").lineas[0]; assert.ok(codigos({ lineas: [{ ...l, cantidad: "0" }] }).includes("LINEA_CANTIDAD")); assert.ok(codigos({ lineas: [{ ...l, cantidad: "abc" }] }).includes("LINEA_CANTIDAD"));
  assert.ok(codigos({ lineas: [{ ...l, descuento: "999" }], total: "0.000000" }).includes("LINEA_DESCUENTO_MAYOR")); assert.ok(codigos({ moneda: "USD" as unknown as "GTQ" }).includes("MONEDA"));
  assert.equal(deEscalado(aEscalado("0.1")! + aEscalado("0.2")!), "0.300000", "0.1 + 0.2 = 0.3 exacto (sin float)"); assert.equal(aEscalado("1,5"), null); assert.equal(aEscalado("-1"), null);
});
