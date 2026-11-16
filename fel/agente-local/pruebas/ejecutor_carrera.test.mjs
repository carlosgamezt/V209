// Carrera entre la lectura de la SESIÓN y la del LIBRO del simulador (dos peticiones distintas): una discrepancia de una sola lectura es transitoria y no debe dar por INCIERTA una emisión que sí se confirmó.
// Pruebas deterministas con dependencias falsas (sin navegador ni red). Lo que sigue siendo incierto sigue siéndolo: discrepancia persistente y duplicados.
import test from "node:test";
import assert from "node:assert/strict";
import { crearEjecutor, esDiscrepanciaTransitoria, LECTURAS_INCOHERENTES_PARA_INCIERTA } from "../agente/ejecutor.mjs";

const EM = { sesion: "s1", serie: "SIMA", numero: 1, autorizacion: "SIM-1" };
const PREVIA = { id: "s1", estado: "previsualizada", hash: "h".repeat(64), resumen: { total: "10" } }, CONF = { ...PREVIA, estado: "confirmada" };
const orden = { orden: "o1", token: "t1", ambiente: "simulado", instantanea: { cliente: { tipo_identificacion: "CF" }, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "10" }] } };

/** `lecturas`: una entrada por sondeo de espera → [sesión, libro]. Tras agotarlas, repite la última. */
function montar(lecturas) {
  const registro = { resultados: [], interrupciones: 0, lecturasSesion: 0 }; let primera = true;
  const lectura = () => lecturas[Math.min(Math.max(registro.lecturasSesion - 2, 0), lecturas.length - 1)];   // sondeo k = lecturasSesion - 1; en cada sondeo la sesión se pide antes que el libro (Promise.all)
  const sim = {
    origen: "http://sim", crearSesion: async () => ({ id: "s1", url: "http://sim/s1" }), interrumpir: async () => { registro.interrupciones++; },
    libro: async () => { if (primera) { primera = false; return []; } return lectura()[1]; },    // la 1.ª consulta es la de «operación duplicada»
    sesion: async () => { registro.lecturasSesion++; return registro.lecturasSesion === 1 ? PREVIA : lectura()[0]; },
  };
  const nexa = { progreso: async () => {}, vistaPrevia: async () => {}, resultado: async (_o, _t, r) => { registro.resultados.push(r); } };
  const almacen = { guardarDiario: () => {}, borrarDiario: () => {} };
  const ej = crearEjecutor({ nexa, sim, almacen, config: { sondeoMs: 0, renovarMs: 1e9, esperaMaxMs: 1e9, demoraCierreMs: 0, maxFallosSimulador: 5 }, dormir: async () => {},
    abrirNavegador: async () => ({ pagina: {}, llenarYPrevisualizar: async () => {}, cerrar: async () => {} }) });
  return { ej, registro };
}

test("la discrepancia transitoria se reconoce solo para los dos motivos de lectura no atómica; los duplicados nunca son transitorios", () => {
  assert.equal(LECTURAS_INCOHERENTES_PARA_INCIERTA, 2);
  assert.equal(esDiscrepanciaTransitoria({ tipo: "incierta", motivo: "emision_sin_sesion_confirmada" }), true);
  assert.equal(esDiscrepanciaTransitoria({ tipo: "incierta", motivo: "libro_no_coincide" }), true);
  assert.equal(esDiscrepanciaTransitoria({ tipo: "incierta", motivo: "libro_con_duplicados" }), false);
  assert.equal(esDiscrepanciaTransitoria({ tipo: "emitida" }), false); assert.equal(esDiscrepanciaTransitoria(null), false);
});

test("CARRERA: la sesión se lee antes de confirmar y el libro después → una lectura incoherente; la siguiente coincide y el resultado es EMITIDA", async () => {
  const { ej, registro } = montar([[PREVIA, [EM]], [CONF, [EM]]]);
  const r = await ej.procesar(orden);
  assert.equal(r.estado, "emitida"); assert.equal(registro.resultados.length, 1); assert.equal(registro.resultados[0].tipo, "emitido_simulado"); assert.equal(registro.interrupciones, 0, "no se interrumpió una sesión que sí se confirmó");
});

test("la carrera inversa (libro vacío leído antes, sesión ya confirmada después) también se resuelve como EMITIDA", async () => {
  const { ej, registro } = montar([[CONF, []], [CONF, [EM]]]);
  assert.equal((await ej.procesar(orden)).estado, "emitida"); assert.equal(registro.resultados[0].tipo, "emitido_simulado");
});

test("una discrepancia PERSISTENTE sigue siendo INCIERTA (se interrumpe la sesión y se informa error a NEXA): la validación no se debilita", async () => {
  const { ej, registro } = montar([[PREVIA, [EM]]]);       // el libro tiene la emisión pero la sesión nunca figura confirmada
  const r = await ej.procesar(orden);
  assert.equal(r.estado, "incierta"); assert.equal(r.motivo, "emision_sin_sesion_confirmada"); assert.equal(registro.resultados[0].tipo, "error"); assert.ok(registro.interrupciones >= 1);
});

test("duplicados en el libro: INCIERTA en la primera lectura, sin repetir lecturas", async () => {
  const { ej, registro } = montar([[CONF, [EM, { ...EM, numero: 2 }]], [CONF, [EM]]]);
  const r = await ej.procesar(orden);
  assert.equal(r.estado, "incierta"); assert.equal(r.motivo, "libro_con_duplicados"); assert.equal(registro.lecturasSesion, 2, "una lectura de preparación + un solo sondeo");
});
