import assert from "node:assert/strict";
import { aMicro, construirNuc, deMicro, NucInvalido, validarFactura } from "../src/nuc_gt.ts";
import { facturaPrueba } from "./digifact_gt_fixture.ts";
import esquemaOficial from "../digifact/NUCSchema.gt.json" with { type: "json" };
import ejemploCf from "../digifact/ejemplos/NUC_1_FACT_CF.json" with { type: "json" };
import ejemploCui from "../digifact/ejemplos/NUC_1_FACT_CUI.json" with { type: "json" };

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

Deno.test("NUC: el validador reconoce los DOS ejemplos JSON oficiales de Digifact (prueba del propio validador)", () => {
  for (const [n, j] of [["NUC_1_FACT_CF.json", ejemploCf], ["NUC_1_FACT_CUI.json", ejemploCui]] as const) assert.deepEqual(contraEsquema(j), [], n);
  assert.ok(contraEsquema({ Version: "1.00" }).length > 0, "un documento incompleto debe fallar");
});

Deno.test("NUC: la factura de prueba produce un documento que respeta el esquema oficial y los nombres exactos de la documentación", () => {
  const n = construirNuc(facturaPrueba()) as Record<string, any>;
  assert.deepEqual(contraEsquema(n), []);
  assert.equal(n.Version, "1.00"); assert.equal(n.CountryCode, "GT");
  assert.deepEqual(n.Header, { DocType: "FACT", IssuedDateTime: "2026-11-14T10:30:00-06:00", Currency: "GTQ" });
  assert.equal(n.Seller.TaxID, "5888492");
  assert.deepEqual(n.Seller.TaxIDAdditionalInfo, [{ Name: "AfiliacionIVA", Data: null, Value: "GEN" }]);
  // la errata «AdditionlInfo» (sin «a») es la del esquema oficial y es obligatoria
  assert.deepEqual(n.Seller.AdditionlInfo, [{ Name: "TipoFrase", Data: "1", Value: "1" }, { Name: "Escenario", Data: "1", Value: "2" }]);
  assert.equal(n.Seller.BranchInfo.Code, "2"); assert.equal(n.Seller.BranchInfo.AddressInfo.Country, "GT");
  assert.deepEqual(n.Buyer.TaxID, "CF");
  assert.equal(n.Items[0].Qty, "1.000000"); assert.equal(n.Items[0].Price, "100.000000"); assert.equal(n.Items[0].Totals.TotalItem, "100.000000");
  assert.equal(n.Items[0].Taxes.Tax[0].Description, "IVA");
  assert.equal(n.Totals.GrandTotal.InvoiceTotal, "100.000000"); assert.equal(n.Totals.TotalTaxes.TotalTax[0].Amount, "10.714286");
  // AdditionalDocumentInfo es obligatorio siempre y su Code es nuestra referencia interna (GUID de 36)
  const a = n.AdditionalDocumentInfo.AdditionalInfo[0];
  assert.equal(a.Type, "ADENDA"); assert.equal(a.Code.length, 36);
  assert.deepEqual(a.AditionalInfo, [{ Name: "VALIDAR_REFERENCIA_INTERNA", Data: null, Value: "NO_VALIDAR" }]);
  assert.equal((construirNuc(facturaPrueba({ validarReferenciaInterna: true })) as any).AdditionalDocumentInfo.AdditionalInfo[0].AditionalInfo[0].Value, "VALIDAR");
});

Deno.test("NUC: CUI lleva TaxIDType; descuento y correo solo aparecen cuando existen", () => {
  const f = facturaPrueba({ receptor: { tipoId: "CUI", id: "3730617490101", nombre: "PERSONA DE PRUEBA" } });
  const n = construirNuc(f) as any;
  assert.equal(n.Buyer.TaxIDType, "CUI"); assert.equal(n.Buyer.AddressInfo, undefined); assert.equal(n.Seller.Contact, undefined); assert.equal(n.Items[0].Discounts, undefined);
  const g = facturaPrueba(); g.emisor.correo = "correo@ejemplo.com"; g.items[0].descuento = "10"; g.items[0].totalItem = "90"; g.items[0].impuestos = [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "80.357143", monto: "9.642857" }];
  const m = construirNuc(g) as any;
  assert.deepEqual(m.Seller.Contact, { EmailList: { Email: ["correo@ejemplo.com"] } }); assert.deepEqual(m.Items[0].Discounts, { Discount: [{ Amount: "10.000000" }] }); assert.equal(m.Totals.GrandTotal.InvoiceTotal, "90.000000");
});

Deno.test("NUC: decimales exactos (sin float), hasta 6 decimales", () => {
  assert.equal(aMicro("0.1"), 100000n); assert.equal(aMicro("12.345678"), 12345678n); assert.equal(aMicro("1.2345678"), null); assert.equal(aMicro("-1"), null); assert.equal(aMicro("1e3"), null); assert.equal(aMicro("abc"), null);
  assert.equal(deMicro(aMicro("0.1")! + aMicro("0.2")!), "0.300000");   // con float daría 0.30000000000000004
  const f = facturaPrueba(); f.items[0].cantidad = "3"; f.items[0].precioUnitario = "0.1"; f.items[0].totalItem = "0.3"; f.items[0].impuestos = [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "0.267857", monto: "0.032143" }];
  assert.deepEqual(validarFactura(f), []);
});

Deno.test("NUC: rechaza lo que ya se sabe incorrecto y reporta TODOS los errores a la vez", () => {
  const cam = (mut: (f: ReturnType<typeof facturaPrueba>) => void) => { const f = facturaPrueba(); mut(f); return validarFactura(f).map((e) => e.campo); };
  assert.ok(cam((f) => { f.emisor.nit = "5888-492"; }).includes("emisor.nit"));
  assert.ok(cam((f) => { f.emisor.frases = []; }).includes("emisor.frases"));
  assert.ok(cam((f) => { f.emisor.afiliacionIva = "XXX" as never; }).includes("emisor.afiliacionIva"));
  assert.ok(cam((f) => { f.fechaEmision = "2026-11-14"; }).includes("fechaEmision"));
  assert.ok(cam((f) => { f.referenciaInterna = "corta"; }).includes("referenciaInterna"));
  assert.ok(cam((f) => { f.tipoDoc = "NCRE" as never; }).includes("tipoDoc"));
  assert.ok(cam((f) => { f.items = []; }).includes("items"));
  assert.ok(cam((f) => { f.emisor.establecimiento.direccion.codigoPostal = ""; }).includes("emisor.establecimiento.direccion.codigoPostal"));
  assert.ok(cam((f) => { f.receptor = { tipoId: "CUI", id: "123", nombre: "X Y" }; }).includes("receptor.id"));
  assert.ok(cam((f) => { f.receptor.nombre = ""; }).includes("receptor.nombre"));
  assert.ok(cam((f) => { f.items[0].cantidad = "1.1234567"; }).includes("items[0].cantidad"));
  assert.ok(cam((f) => { f.items[0].cantidad = "0"; }).includes("items[0].cantidad"));
  assert.ok(cam((f) => { f.items[0].totalItem = "99"; }).includes("items[0].totalItem"), "el total del ítem debe ser cantidad × precio − descuento");
  assert.ok(cam((f) => { f.items[0].impuestos[0].monto = "5"; }).includes("items[0].impuestos[0]"), "gravable + IVA debe sumar el total");
  assert.ok(cam((f) => { f.items[0].impuestos = []; }).includes("items[0].impuestos"));
  assert.ok(cam((f) => { f.items[0].impuestos[0].nombre = "PETROLEO" as never; }).includes("items[0].impuestos[0].nombre"));
  const f = facturaPrueba(); f.emisor.nit = "x"; f.items[0].descripcion = ""; f.fechaEmision = "mal";
  assert.throws(() => construirNuc(f), (e: unknown) => e instanceof NucInvalido && e.errores.length >= 3);
});
