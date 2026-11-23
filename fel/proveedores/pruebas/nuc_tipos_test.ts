import assert from "node:assert/strict";
import { construirNuc, NucInvalido, validarFactura, type FacturaGt } from "../src/nuc_gt.ts";
import { facturaPrueba } from "./digifact_gt_fixture.ts";
import esquemaOficial from "../digifact/NUCSchema.gt.json" with { type: "json" };
import ejemploNcre from "../digifact/ejemplos/NUC_4_NCRE.json" with { type: "json" };
import ejemploCf from "../digifact/ejemplos/NUC_1_FACT_CF.json" with { type: "json" };

/* Validador mínimo del JSON Schema draft-04 OFICIAL de Digifact (solo las palabras clave que ese esquema usa: type, required, properties, items, minItems, maxItems, minimum, maximum, format). */
// deno-lint-ignore no-explicit-any
type Esq = any;
function tipoDe(v: unknown): string { return v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v; }
function validarEsquema(v: unknown, e: Esq, ruta: string, errs: string[]) {
  if (e.type) {
    const t = tipoDe(v), ok = ([] as string[]).concat(e.type).some((x) => x === t || (x === "number" && t === "integer"));
    if (!ok) { errs.push(`${ruta}: tipo ${t}, se esperaba ${JSON.stringify(e.type)}`); return; }
  }
  if (v === null || v === undefined) return;
  if (typeof v === "string" && e.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) errs.push(`${ruta}: fecha-hora no válida`);
  if (typeof v === "number") { if (e.minimum !== undefined && v < e.minimum) errs.push(`${ruta}: menor que el mínimo`); if (e.maximum !== undefined && v > e.maximum) errs.push(`${ruta}: mayor que el máximo`); }
  if (Array.isArray(v)) {
    if (e.minItems !== undefined && v.length < e.minItems) errs.push(`${ruta}: menos de ${e.minItems} elementos`);
    if (e.maxItems !== undefined && v.length > e.maxItems) errs.push(`${ruta}: más de ${e.maxItems} elementos`);
    if (e.items) v.forEach((x, i) => validarEsquema(x, e.items, `${ruta}[${i}]`, errs));
  } else if (typeof v === "object") {
    for (const r of e.required ?? []) if (!(r in (v as object))) errs.push(`${ruta}.${r}: obligatorio`);
    for (const [k, sub] of Object.entries(e.properties ?? {})) if (k in (v as object)) validarEsquema((v as Record<string, unknown>)[k], sub, `${ruta}.${k}`, errs);
  }
}
const esquema: Esq = esquemaOficial;
const contraEsquema = (j: unknown) => { const e: string[] = []; validarEsquema(j, esquema, "NUC", e); return e; };

const ORIGEN = { tipo: "FACT", autorizacion: "62496FB5-75B4-4C75-83FA-DFBEF92DE92D", fechaEmision: "2026-11-01", serie: "62496FB5", numero: "1974750325", receptorId: "CF" };
const nota = (tipo: "NCRE" | "NDEB", extra: Partial<FacturaGt> = {}) => facturaPrueba({ tipoDoc: tipo, origen: ORIGEN, motivoAjuste: "Devolución de mercadería", ...extra });
const NIT_RECEPTOR = { tipoId: "NIT" as const, id: "77454820", nombre: "RECEPTOR DE PRUEBA" };
const recibo = (extra: Partial<FacturaGt> = {}) => facturaPrueba({ tipoDoc: "RECI", tipoRecibo: "Colegio", receptor: NIT_RECEPTOR, ...extra });
const campos = (f: FacturaGt) => validarFactura(f).map((e) => e.campo);

Deno.test("NUC por tipo: el ejemplo oficial NCRE de Digifact respeta el esquema (prueba del validador) y es la referencia de la estructura", () => {
  assert.deepEqual(contraEsquema(ejemploNcre), []);
});
Deno.test("NUC por tipo: FACT NO cambia — sin complementos, una sola entrada en AdditionalInfo (la adenda) y sin campos de otros tipos", () => {
  const n = construirNuc(facturaPrueba()) as any;
  assert.equal(n.Header.DocType, "FACT"); assert.equal(n.AdditionalDocumentInfo.AdditionalInfo.length, 1); assert.equal(n.AdditionalDocumentInfo.AdditionalInfo[0].Type, "ADENDA");
  assert.deepEqual(n.AdditionalDocumentInfo.AdditionalInfo[0].AditionalInfo.map((x: any) => x.Name), ["VALIDAR_REFERENCIA_INTERNA"]);
  assert.deepEqual(contraEsquema(n), []);
  // misma forma que el ejemplo oficial de FACT: mismas claves de primer nivel
  for (const k of Object.keys(n)) assert.ok(k in ejemploCf, `clave ${k} fuera del ejemplo oficial`);
});
Deno.test("NUC por tipo: NCRE produce el complemento del ejemplo oficial (mismos nombres, mismo orden) y respeta el esquema", () => {
  const n = construirNuc(nota("NCRE")) as any, ej = (ejemploNcre as any).AdditionalDocumentInfo.AdditionalInfo[0];
  assert.deepEqual(contraEsquema(n), []); assert.equal(n.Header.DocType, "NCRE");
  const c = n.AdditionalDocumentInfo.AdditionalInfo[0];
  assert.equal(c.Code, "NCRE"); assert.equal(c.Type, "COMPLEMENTO"); assert.deepEqual(c.AditionalInfo.map((x: any) => x.Name), ej.AditionalInfo.map((x: any) => x.Name));
  assert.deepEqual(c.AditionalInfo.map((x: any) => x.Data), ej.AditionalInfo.map((x: any) => x.Data));
  assert.deepEqual(Object.fromEntries(c.AditionalInfo.map((x: any) => [x.Name, x.Value])), { NumeroAutorizacionDocumentoOrigen: ORIGEN.autorizacion, FechaEmisionDocumentoOrigen: "2026-11-01", MotivoAjuste: "Devolución de mercadería", NumeroDocumentoOrigen: "1974750325", SerieDocumentoOrigen: "62496FB5" });
  // la adenda sigue detrás del complemento y conserva la referencia interna
  assert.equal(n.AdditionalDocumentInfo.AdditionalInfo.length, 2); assert.equal(n.AdditionalDocumentInfo.AdditionalInfo[1].Type, "ADENDA"); assert.equal(n.AdditionalDocumentInfo.AdditionalInfo[1].Code.length, 36);
  assert.deepEqual(Object.keys(c).sort(), Object.keys(ej).filter((k) => k !== "AditionalData").sort());
});
Deno.test("NUC por tipo: NDEB usa el mismo complemento con su propio código", () => {
  const n = construirNuc(nota("NDEB")) as any; assert.equal(n.Header.DocType, "NDEB"); assert.equal(n.AdditionalDocumentInfo.AdditionalInfo[0].Code, "NDEB"); assert.deepEqual(contraEsquema(n), []);
});
Deno.test("NUC por tipo: una nota NO es una factura con otro nombre — sin origen, motivo, referencia válida o con otro tipo de origen se rechaza", () => {
  for (const t of ["NCRE", "NDEB"] as const) {
    assert.ok(campos(facturaPrueba({ tipoDoc: t })).includes("documento_origen"), `${t} sin origen`);
    assert.ok(campos(facturaPrueba({ tipoDoc: t, origen: ORIGEN })).includes("motivo_ajuste"), `${t} sin motivo`);
    assert.ok(campos(nota(t, { origen: { ...ORIGEN, tipo: "NCRE" } })).includes("documento_origen"), "nota sobre nota");
    assert.ok(campos(nota(t, { origen: { ...ORIGEN, autorizacion: "123" } })).includes("documento_origen.autorizacion"));
    assert.ok(campos(nota(t, { origen: { ...ORIGEN, fechaEmision: "2026-11-20" } })).includes("documento_origen.fechaEmision"), "nota anterior al origen");
    assert.ok(campos(nota(t, { receptor: { tipoId: "NIT", id: "77454820", nombre: "OTRO RECEPTOR" } })).includes("receptor"), "otro receptor");
    assert.throws(() => construirNuc(facturaPrueba({ tipoDoc: t })), NucInvalido);
  }
  assert.deepEqual(campos(nota("NCRE")), []); assert.deepEqual(campos(nota("NDEB")), []);
  // la nota hereda los importes con el mismo control aritmético que una factura
  assert.ok(campos(nota("NCRE", { items: [{ ...facturaPrueba().items[0], totalItem: "99" }] })).includes("items[0].totalItem"));
  // no se puede añadir un origen a una factura ni a un recibo
  assert.ok(campos(facturaPrueba({ origen: ORIGEN })).includes("documento_origen")); assert.ok(campos(recibo({ origen: ORIGEN })).includes("documento_origen"));
});
Deno.test("NUC por tipo: RECI lleva su tipo en la adenda, no tiene complemento fiscal y no se confunde con FACT", () => {
  const n = construirNuc(recibo()) as any; assert.equal(n.Header.DocType, "RECI"); assert.deepEqual(contraEsquema(n), []);
  const ad = n.AdditionalDocumentInfo.AdditionalInfo; assert.equal(ad.length, 1); assert.equal(ad[0].Type, "ADENDA");
  assert.deepEqual(ad[0].AditionalInfo, [{ Name: "VALIDAR_REFERENCIA_INTERNA", Data: null, Value: "NO_VALIDAR" }, { Name: "Tipo", Data: null, Value: "Colegio" }]);
  for (const t of ["Universidad", "Inmobiliaria"]) assert.deepEqual(campos(recibo({ tipoRecibo: t })), []);
  for (const t of [undefined, "", "Banco"]) assert.ok(campos(recibo({ tipoRecibo: t as string })).includes("tipo_recibo"), String(t));
  assert.ok(campos(facturaPrueba({ tipoRecibo: "Colegio" })).includes("tipo_recibo"), "una factura no lleva tipo de recibo");
  assert.ok(campos(recibo({ receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" } })).includes("receptor"), "un recibo no se emite a CF");
});
Deno.test("NUC por tipo: los tipos pendientes (cambiaria, pequeño contribuyente, especial…) se rechazan aunque Digifact los liste", () => {
  for (const t of ["FCAM", "FACM", "FPEQ", "FCAP", "FESP", "NABN", "RDON", "FEPE", "FARP", "CIVA", "CAIS", "XXXX"]) {
    assert.ok(campos(facturaPrueba({ tipoDoc: t as never })).includes("tipoDoc"), t); assert.throws(() => construirNuc(facturaPrueba({ tipoDoc: t as never })), NucInvalido);
  }
});
Deno.test("NUC por tipo: la frase tipo 1 sigue siendo obligatoria en FACT; los tipos en pruebas no la exigen hasta verificar V4", () => {
  const sinFrase = (f: FacturaGt): FacturaGt => ({ ...f, emisor: { ...f.emisor, frases: [] } });
  assert.ok(campos(sinFrase(facturaPrueba())).includes("emisor.frases"));
  assert.ok(!campos(sinFrase(nota("NCRE"))).includes("emisor.frases")); assert.ok(!campos(sinFrase(recibo())).includes("emisor.frases"));
});
