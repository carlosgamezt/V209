import assert from "node:assert/strict";
import { agruparEstablecimientos } from "../src/establecimientos_digifact.ts";
import type { FilaAcuse } from "../src/digifact_gt.ts";
const f = (o: Partial<FilaAcuse>): FilaAcuse => ({ autorizacion: "", serie: "A", numero: "1", tipoDte: "FACT", establecimiento: "1", nombreEstablecimiento: "", estadoAcuse: "ACEPTADO_SAT", fechaCertificacion: "", ...o } as FilaAcuse);
Deno.test("agrupa por establecimiento sin inventar códigos y elige una autorización aceptada de ejemplo", () => {
  const r = agruparEstablecimientos([f({ establecimiento: "2", nombreEstablecimiento: "Sucursal Dos", autorizacion: "U2", estadoAcuse: "RECHAZADO" }), f({ establecimiento: "2", autorizacion: "U2B" }), f({ establecimiento: "7", nombreEstablecimiento: "Siete", autorizacion: "U7", tipoDte: "NCRE" }), f({ establecimiento: "", autorizacion: "X" })]);
  assert.deepEqual(r.map((x) => x.codigo), ["2", "7"]); assert.equal(r[0].nombre, "Sucursal Dos"); assert.equal(r[0].filas, 2); assert.equal(r[0].aceptadas, 1); assert.equal(r[0].autorizacionEjemplo, "U2B"); assert.equal(r[1].tipoEjemplo, "NCRE");
  assert.deepEqual(agruparEstablecimientos([]), []);
});
