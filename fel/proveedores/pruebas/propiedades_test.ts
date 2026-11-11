// PRUEBA DE PROPIEDADES: secuencias aleatorias (semilla fija) de acciones sobre varios documentos y escenarios, con un «servidor» que NO deduplica.
// Invariantes que deben cumplirse SIEMPRE, paso a paso.
import assert from "node:assert/strict";
import { MockProvider, type Escenario } from "../src/mock.ts";
import { ErrorOrquestador, OrquestadorReferencia } from "../src/orquestador_referencia.ts";
import { CTX, clave, documento, prng } from "./datos.ts";

const ESCENARIOS: Escenario[] = ["exito", "rechazo", "timeout_antes", "timeout_despues", "corte_despues", "respuesta_ilegible", "codigo_desconocido_certificado", "codigo_desconocido_no_certificado", "timeout_indeterminado", "timeout_tardio", "limite_tasa", "caida", "accion_humana"];
const DOCS = ["d1", "d2", "d3"];

async function verificar(o: OrquestadorReferencia, m: MockProvider, enviosPorClave: Map<string, number>, paso: string) {
  for (const id of DOCS) {
    const d = o.documento(id), ops = o.operacionesDe(id);
    assert.ok(m.certificacionesDe(id) <= 1, `${paso}: más de una certificación en el servidor para ${id}`);
    assert.ok(ops.filter((x) => x.estado === "iniciada" || x.estado === "desconocida").length <= 1, `${paso}: más de una operación abierta en ${id}`);
    const exitosas = ops.filter((x) => x.estado === "confirmada_exitosa");
    if (d.estadoFiscal === "certificado") { assert.equal(exitosas.length, 1, `${paso}: certificado sin exactamente una operación exitosa`); assert.ok(d.datosFiscales && d.datosFiscales.serie && d.datosFiscales.numero && d.datosFiscales.autorizacion, `${paso}: certificado sin datos fiscales`); }
    else { assert.equal(exitosas.length, 0, `${paso}: operación exitosa con documento no certificado`); assert.equal(d.datosFiscales, undefined, `${paso}: datos fiscales sin certificado`); }
    if (d.estadoFiscal === "por_verificar") assert.equal(ops.filter((x) => x.estado === "desconocida").length, 1, `${paso}: por_verificar sin operación desconocida`);
    if (d.estadoFiscal === "pendiente_certificacion") assert.equal(ops.filter((x) => x.estado === "iniciada").length, 1, `${paso}: pendiente sin operación iniciada`);
    if (d.estadoFiscal === "ninguno") assert.equal(ops.filter((x) => x.estado !== "confirmada_fallida").length, 0, `${paso}: sin vida fiscal pero con operaciones vivas`);
  }
  for (const [k, n] of enviosPorClave) assert.ok(n <= 1, `${paso}: la clave ${k} se envió ${n} veces`);
  const auts = DOCS.map((id) => o.documento(id).datosFiscales?.autorizacion).filter(Boolean); assert.equal(new Set(auts).size, auts.length, `${paso}: autorizaciones repetidas`);
}

Deno.test("propiedades: con un servidor que no deduplica, nunca hay más de una certificación por documento ni un envío repetido por clave (400 secuencias × 30 acciones)", async () => {
  let acciones = 0, certificados = 0, desconocidos = 0, conciliados = 0;
  for (let semilla = 1; semilla <= 400; semilla++) {
    const r = prng(semilla), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const m = new MockProvider({ idempotenciaNativa: false }), o = new OrquestadorReferencia(m);
    for (const id of DOCS) { o.crearBorrador(documento(id)); m.fijarEscenario(id, pick(ESCENARIOS)); await o.revisar(id); }
    let n = 0; const ordenes = new Map<string, string>();
    for (let paso = 0; paso < 30; paso++) {
      const id = pick(DOCS), accion = Math.floor(r() * 9); acciones++;
      try {
        if (accion <= 2) { const res = await Promise.all(Array.from({ length: 1 + Math.floor(r() * 2) }, () => o.solicitarCertificacion(id, clave(Math.floor(r() * 4) + 1)).catch((e) => { if (!(e instanceof ErrorOrquestador)) throw e; return null; }))); void res; }
        else if (accion === 3) { const c = await o.conciliar(id); if (c.tipo !== "indeterminado") conciliados++; }
        else if (accion === 4) { if (m.certificacionesDe(id) === 0 && m.pendientesDe(id) === 0) await o.conciliar(id, { resultado: "fallida", evidencia: "revisión manual: no figura en el proveedor" }); }   // la persona solo declara fallido lo que de verdad no existe NI puede aparecer después
        else if (accion === 5) { o.volverABorrador(id); await o.revisar(id); }
        else if (accion === 6) { m.fijarEscenario(id, pick(ESCENARIOS)); }
        else if (accion === 7) { await m.liberarTardios(CTX); }
        else if (accion === 8) { const d = o.documento(id); for (const op of o.operacionesDe(id)) if (op.estado === "iniciada" && op.ordenId && !ordenes.has(op.id)) { ordenes.set(op.id, op.ordenId); const fin = await m.completarAccionHumana(op.ordenId, CTX); o.resolverAccionHumana(op.id, fin); } void d; }
      } catch (e) { if (!(e instanceof ErrorOrquestador)) throw e; }   // rechazos legítimos del orquestador (estado, clave, etc.)
      const envios = new Map<string, number>(); for (const l of m.llamadasEnviar) envios.set(l.referencia + "|" + l.documentoId, (envios.get(l.referencia + "|" + l.documentoId) ?? 0) + 1);
      await verificar(o, m, envios, `semilla ${semilla}, paso ${paso}`); n++;
    }
    for (const id of DOCS) { const f = o.documento(id).estadoFiscal; if (f === "certificado") certificados++; if (f === "por_verificar") desconocidos++; }
    assert.equal(n, 30);
  }
  assert.ok(acciones === 12000 && certificados > 100 && desconocidos > 50 && conciliados > 50, `la prueba debe ejercitar todos los caminos: ${JSON.stringify({ acciones, certificados, desconocidos, conciliados })}`);
});
