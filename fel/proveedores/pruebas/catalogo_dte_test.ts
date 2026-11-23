import assert from "node:assert/strict";
import { CATALOGO_DTE, esCodigoDte, habilitadoParaEmpresa, puedeCertificar, tipoDte, tiposDeEmpresa, tiposElegibles, validarReglasTipo, type ReferenciaOrigen } from "../src/catalogo_dte.ts";

const ORIGEN: ReferenciaOrigen = { documentoId: "d1", tipo: "FACT", autorizacion: "62496FB5-75B4-4C75-83FA-DFBEF92DE92D", fechaEmision: "2026-11-01", serie: "62496FB5", numero: "1974750325", total: "100.000000", receptorId: "77454820" };
const campos = (r: { campo: string }[]) => r.map((x) => x.campo);

Deno.test("catálogo: códigos únicos, todos los del catálogo doctype de Digifact GT representados y nombres no vacíos", () => {
  const codigos = CATALOGO_DTE.map((t) => t.codigo); assert.equal(new Set(codigos).size, codigos.length);
  // catálogo `doctype` de Digifact GT (17 valores); Digifact publica la cambiaria como «FACM», la SAT y el resto del manual como «FCAM»
  for (const d of ["FACT", "FACM", "FPEQ", "FCAP", "FESP", "NABN", "RDON", "RECI", "NDEB", "NCRE", "FEPE", "FARP", "FCRP", "FPEC", "FCPC", "CIVA", "CAIS"]) assert.ok(CATALOGO_DTE.some((t) => t.codigo === d || t.codigoDigifact === d), `falta ${d}`);
  for (const t of CATALOGO_DTE) { assert.ok(t.nombre.length > 2 && t.corto.length > 2 && t.tituloDocumento.length > 2 && t.fuentes.length > 0, t.codigo); }
});
Deno.test("catálogo: NO se habilita un tipo por figurar en Digifact — solo FACT certifica; los demás dicen qué falta", () => {
  assert.deepEqual(CATALOGO_DTE.filter((t) => t.certificacionHabilitada).map((t) => t.codigo), ["FACT"]);
  assert.deepEqual(CATALOGO_DTE.filter((t) => t.disponibilidad === "implementado").map((t) => t.codigo), ["FACT"]);
  assert.deepEqual(tiposElegibles().map((t) => t.codigo).sort(), ["FACT", "NCRE", "NDEB", "RECI"]);
  for (const t of CATALOGO_DTE) {
    assert.equal(puedeCertificar(t.codigo), t.codigo === "FACT", t.codigo);
    if (t.disponibilidad !== "implementado") assert.ok((t.motivoPendiente ?? "").length > 20, `${t.codigo} debe explicar por qué no certifica`);
    if (t.disponibilidad === "implementado") assert.ok(t.certificacionHabilitada && t.regimen.verificado);
    if (t.certificacionHabilitada) assert.equal(t.disponibilidad, "implementado");
  }
  assert.equal(puedeCertificar("XXXX"), false);
});
Deno.test("catálogo: cada tipo declara código SAT, régimen, campos, complementos y estado; las notas exigen origen FACT", () => {
  for (const c of ["NCRE", "NDEB"]) { const t = tipoDte(c)!; assert.equal(t.requiereOrigen, true); assert.deepEqual(t.origenesPermitidos, ["FACT"]); assert.deepEqual(t.complementos, [c]); assert.ok(t.camposObligatorios.includes("documento_origen") && t.camposObligatorios.includes("motivo_ajuste")); assert.equal(t.regimen.verificado, false); assert.equal(t.disponibilidad, "en_pruebas"); }
  assert.deepEqual(tipoDte("RECI")!.camposObligatorios, ["tipo_recibo"]); assert.equal(tipoDte("RECI")!.requiereOrigen, false);
  assert.equal(tipoDte("FCAM")!.codigoDigifact, "FACM"); assert.equal(tipoDte("FCAM")!.disponibilidad, "pendiente");
  assert.equal(tipoDte("FPEQ")!.disponibilidad, "pendiente"); assert.deepEqual(tipoDte("FPEQ")!.regimen.afiliaciones, ["PEQ"]);
  assert.equal(esCodigoDte("NCRE"), true); assert.equal(esCodigoDte("ncre"), false); assert.equal(esCodigoDte(5), false);
});
Deno.test("empresa: FACT siempre; NCRE/NDEB/RECI solo si la empresa los habilitó; los pendientes jamás; el recibo exige su base legal", () => {
  const vacia = { habilitados: [] };
  assert.equal(habilitadoParaEmpresa("FACT", vacia).ok, true);
  for (const c of ["NCRE", "NDEB", "RECI"]) assert.equal(habilitadoParaEmpresa(c, vacia).ok, false, c);
  assert.equal(habilitadoParaEmpresa("NCRE", { habilitados: [{ tipo: "NCRE" }] }).ok, true);
  assert.equal(habilitadoParaEmpresa("RECI", { habilitados: [{ tipo: "RECI" }] }).ok, false);
  assert.equal(habilitadoParaEmpresa("RECI", { habilitados: [{ tipo: "RECI", baseHabilitacion: "  " }] }).ok, false);
  assert.equal(habilitadoParaEmpresa("RECI", { habilitados: [{ tipo: "RECI", baseHabilitacion: "Resolución X de la SAT" }] }).ok, true);
  for (const c of ["FCAM", "FPEQ", "FCAP", "FESP", "CAIS"]) assert.equal(habilitadoParaEmpresa(c, { habilitados: [{ tipo: c, baseHabilitacion: "x" }] }).ok, false, `${c} no se habilita aunque la empresa lo pida`);
  assert.equal(habilitadoParaEmpresa("ZZZZ", vacia).ok, false);
});
Deno.test("empresa: el tipo predeterminado se resuelve con lo configurado solo si sigue habilitado; si no, Factura", () => {
  assert.equal(tiposDeEmpresa({ habilitados: [] }).predeterminado, "FACT");
  const b = { habilitados: [{ tipo: "NCRE" }], predeterminado: "NCRE" }; assert.equal(tiposDeEmpresa(b).predeterminado, "NCRE"); assert.deepEqual(tiposDeEmpresa(b).tipos.map((t) => t.codigo), ["FACT", "NCRE"]);
  assert.equal(tiposDeEmpresa({ habilitados: [], predeterminado: "RECI" }).predeterminado, "FACT", "recibo sin habilitar → Factura");
  assert.equal(tiposDeEmpresa({ habilitados: [], predeterminado: "FPEQ" }).predeterminado, "FACT", "pendiente → Factura");
  assert.equal(tiposDeEmpresa({ habilitados: [{ tipo: "RECI" }], predeterminado: "RECI" }).predeterminado, "FACT", "recibo sin base legal → Factura");
});
Deno.test("reglas por tipo: FACT no lleva origen, motivo ni tipo de recibo", () => {
  assert.deepEqual(validarReglasTipo({ tipo: "FACT", fechaEmision: "2026-11-14" }), []);
  assert.deepEqual(campos(validarReglasTipo({ tipo: "FACT", fechaEmision: "2026-11-14", origen: ORIGEN, motivoAjuste: "x", tipoRecibo: "Colegio" })).sort(), ["documento_origen", "motivo_ajuste", "tipo_recibo"]);
  assert.deepEqual(campos(validarReglasTipo({ tipo: "FACT", fechaEmision: "2026-11-14", esConsumidorFinal: true })), []);
  assert.deepEqual(campos(validarReglasTipo({ tipo: "FCAM", fechaEmision: "2026-11-14" })), [], "las reglas de campos no deciden la disponibilidad; eso lo hace el catálogo");
  assert.equal(campos(validarReglasTipo({ tipo: "NOPE", fechaEmision: "2026-11-14" }))[0], "tipo");
});
Deno.test("reglas por tipo: nota de crédito/débito — origen obligatorio, solo FACT, autorización SAT, fecha, mismo receptor, motivo", () => {
  const ok = { tipo: "NCRE", fechaEmision: "2026-11-14T10:30:00-06:00", receptorId: "77454820", origen: ORIGEN, motivoAjuste: "Devolución de mercadería" };
  assert.deepEqual(validarReglasTipo(ok), []); assert.deepEqual(validarReglasTipo({ ...ok, tipo: "NDEB" }), []);
  assert.deepEqual(campos(validarReglasTipo({ ...ok, origen: null })), ["documento_origen"]);
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, tipo: "NCRE" } })).includes("documento_origen"), "una nota no puede referenciar otra nota");
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, tipo: "RECI" } })).includes("documento_origen"), "ni un recibo");
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, autorizacion: "no-certificado" } })).includes("documento_origen.autorizacion"));
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, autorizacion: "" } })).includes("documento_origen.autorizacion"));
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, fechaEmision: "2026-12-01" } })).includes("documento_origen.fechaEmision"), "la nota no puede ser anterior al origen");
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, fechaEmision: "2026-02-31" } })).includes("documento_origen.fechaEmision"), "fecha inexistente");
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, serie: "" } })).includes("documento_origen.serie"));
  assert.ok(campos(validarReglasTipo({ ...ok, origen: { ...ORIGEN, numero: "9".repeat(21) } })).includes("documento_origen.numero"));
  assert.ok(campos(validarReglasTipo({ ...ok, receptorId: "99999999" })).includes("receptor"), "mismo receptor que el origen");
  for (const m of [null, "", "  ", "ab", "x".repeat(51)]) assert.ok(campos(validarReglasTipo({ ...ok, motivoAjuste: m })).includes("motivo_ajuste"), String(m));
  assert.ok(campos(validarReglasTipo({ ...ok, tipoRecibo: "Colegio" })).includes("tipo_recibo"), "una nota no lleva tipo de recibo");
});
Deno.test("reglas por tipo: recibo — exige su tipo, no admite origen ni consumidor final", () => {
  const ok = { tipo: "RECI", fechaEmision: "2026-11-14", tipoRecibo: "Colegio" };
  assert.deepEqual(validarReglasTipo(ok), []);
  for (const t of ["Universidad", "Inmobiliaria"]) assert.deepEqual(validarReglasTipo({ ...ok, tipoRecibo: t }), []);
  for (const t of [null, "", "Banco", "colegio"]) assert.deepEqual(campos(validarReglasTipo({ ...ok, tipoRecibo: t })), ["tipo_recibo"], String(t));
  assert.ok(campos(validarReglasTipo({ ...ok, origen: ORIGEN })).includes("documento_origen"), "un recibo no sustituye ni referencia una factura");
  assert.ok(campos(validarReglasTipo({ ...ok, esConsumidorFinal: true })).includes("receptor"));
});
