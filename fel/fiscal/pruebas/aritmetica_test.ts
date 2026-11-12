// Verificación aritmética (no cálculo). Fuente de cada regla: textos de Catalogos/catalogoMensajes-0.3.0.json (SAT) citados en el nombre. Tolerancia: parámetro obligatorio (V2).
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { exigirTolerancia, verificarAritmetica } from "../src/aritmetica.ts";
import { clon, dteBase, rec, TOL } from "./ayudas.ts";
// deno-lint-ignore no-explicit-any
type D = any;
const con = (f: (d: D) => void): D => { const d: D = clon(dteBase()); f(d); return d; };
const ar = (d: D, t = TOL) => verificarAritmetica(d, rec, { tolerancia: t });
const reglas = (d: D, t = TOL) => ar(d, t).violaciones.map((v) => v.regla);

Deno.test("[ARI-PRECIO] RCP313: Precio = Cantidad × PrecioUnitario", () => {
  assertEquals(reglas(dteBase()), []);
  assert(reglas(con((d) => d.Items[0].Precio = "113")).includes("ARI-PRECIO"));
  assertEquals(reglas(con((d) => { d.Items[0].Cantidad = "3"; d.Items[0].PrecioUnitario = "0.1"; d.Items[0].Precio = "0.3"; d.Items[0].Descuento = "0"; d.Items[0].Impuestos[0].MontoGravable = "0.267857142857"; d.Items[0].Impuestos[0].MontoImpuesto = "0.032142857143"; d.Items[0].Total = "0.3"; d.Totales.TotalImpuestos[0].TotalMontoImpuesto = "0.032142857143"; d.Totales.GranTotal = "0.3"; }), "0.000000000001"), []); // 3×0.1 exacto
});
Deno.test("[ARI-DESCUENTO] RCP314: Descuento no mayor que Precio", () => {
  assert(reglas(con((d) => d.Items[0].Descuento = "112.01")).includes("ARI-DESCUENTO"));
  assert(!reglas(con((d) => d.Items[0].Descuento = "112")).includes("ARI-DESCUENTO")); // igual al precio: permitido
});
Deno.test("[ARI-IVA-BASE] RCP226: MontoGravable = (Precio − Descuento − OtrosDescuento) / 1.12 con unidad gravable 1", () => {
  assert(reglas(con((d) => d.Items[0].Impuestos[0].MontoGravable = "99")).includes("ARI-IVA-BASE"));
  assertEquals(reglas(con((d) => { d.Items[0].Descuento = "11.2"; d.Items[0].Impuestos[0].MontoGravable = "90"; d.Items[0].Impuestos[0].MontoImpuesto = "10.8"; d.Items[0].Total = "100.8"; d.Totales.TotalImpuestos[0].TotalMontoImpuesto = "10.8"; d.Totales.GranTotal = "100.8"; })), []);
});
Deno.test("[ARI-IVA-BASE] cociente no terminante: 100/1.12 = 625/7; con tolerancia 0 se informa la fracción exacta, nunca un redondeo", () => {
  const d = con((d) => { Object.assign(d.Items[0], { Cantidad: "1", PrecioUnitario: "100", Precio: "100", Total: "100" }); d.Items[0].Impuestos[0].MontoGravable = "89.29"; d.Items[0].Impuestos[0].MontoImpuesto = "10.71"; d.Totales.TotalImpuestos[0].TotalMontoImpuesto = "10.71"; d.Totales.GranTotal = "100"; });
  assertEquals(reglas(d, "0.01"), []); // |89.29 − 89.2857…| < 0.01
  const v = ar(d, "0").violaciones.find((x) => x.regla === "ARI-IVA-BASE")!; assertEquals(v.esperado, "625/7");
});
Deno.test("[ARI-IVA-IMPUESTO] RCP331: MontoImpuesto = MontoGravable × 0.12 (factor leído del catálogo 0.1.4)", () => {
  assert(reglas(con((d) => d.Items[0].Impuestos[0].MontoImpuesto = "13")).includes("ARI-IVA-IMPUESTO"));
  const v = ar(con((d) => d.Items[0].Impuestos[0].MontoImpuesto = "13")).violaciones.find((x) => x.regla === "ARI-IVA-IMPUESTO")!; assertEquals([v.esperado, v.encontrado], ["12", "13"]);
});
Deno.test("[ARI-TOTAL-ITEM] RCP348: Total = Precio − Descuento (el IVA no se suma: ya está incluido)", () => {
  assert(reglas(con((d) => d.Items[0].Total = "124")).includes("ARI-TOTAL-ITEM")); // sumar el IVA otra vez es error
  assert(reglas(con((d) => d.Items[0].Total = "111")).includes("ARI-TOTAL-ITEM"));
  assertEquals(reglas(con((d) => { d.Items[0].Descuento = "12"; d.Items[0].Impuestos[0].MontoGravable = "89.285714285714"; d.Items[0].Total = "100"; d.Totales.GranTotal = "100"; }), "0.01").filter((r) => r === "ARI-TOTAL-ITEM"), []);
});
Deno.test("[ARI-TOTAL-IMPUESTO] RCP332: TotalMontoImpuesto = suma de MontoImpuesto del IVA", () => {
  assert(reglas(con((d) => d.Totales.TotalImpuestos[0].TotalMontoImpuesto = "13")).includes("ARI-TOTAL-IMPUESTO"));
  const dos = con((d) => { d.Items.push(clon(d.Items[0])); d.Items[1].NumeroLinea = 2; d.Totales.TotalImpuestos[0].TotalMontoImpuesto = "24"; d.Totales.GranTotal = "224"; });
  assertEquals(reglas(dos), []); dos.Totales.TotalImpuestos[0].TotalMontoImpuesto = "12"; assert(reglas(dos).includes("ARI-TOTAL-IMPUESTO"));
});
Deno.test("[ARI-GRAN-TOTAL] RCP349: GranTotal = suma de los Total", () => {
  assert(reglas(con((d) => d.Totales.GranTotal = "113")).includes("ARI-GRAN-TOTAL"));
  assertEquals(Racional_suma_10(), []);
});
function Racional_suma_10() { const d: D = clon(dteBase()); d.Items = Array.from({ length: 10 }, (_, i) => { const x = clon(dteBase().Items[0]); x.NumeroLinea = i + 1; x.Cantidad = "1"; x.PrecioUnitario = "0.1"; x.Precio = "0.1"; x.Descuento = "0"; x.Total = "0.1"; x.Impuestos = undefined; delete x.Impuestos; return x; }); d.Totales = { GranTotal: "1" }; return verificarAritmetica(d, rec, { tolerancia: "0" }).violaciones.filter((v) => v.regla === "ARI-GRAN-TOTAL"); }

Deno.test("[ARI-TOTAL-ITEM] tolerancia: la diferencia igual a la tolerancia pasa; mayor falla; con 0 es exacta", () => {
  const t = (v: string, tol: string) => reglas(con((d) => { d.Items[0].Total = v; d.Totales.GranTotal = v; }), tol).filter((r) => r === "ARI-TOTAL-ITEM").length;
  assertEquals(t("112.01", "0.01"), 0); assertEquals(t("112.02", "0.01"), 1); assertEquals(t("111.99", "0.01"), 0); assertEquals(t("112.00", "0"), 0); assertEquals(t("112.01", "0"), 1);
});
Deno.test("[ESC-BLOQUEO] la tolerancia es obligatoria y sin valor predeterminado: ausente, nula, numérica, negativa o no decimal → error", () => {
  for (const t of [undefined, null, 0.01, 0, -1, "-0.01", "abc", "", "1e-2", "0,01"]) assertThrows(() => exigirTolerancia(t), Error, undefined, String(t));
  // deno-lint-ignore no-explicit-any
  assertThrows(() => verificarAritmetica(dteBase(), rec, {} as any), Error, "obligatorio");
  // deno-lint-ignore no-explicit-any
  assertThrows(() => verificarAritmetica(dteBase(), rec, undefined as any), Error);
  assertEquals(exigirTolerancia("0").esCero(), true);
});
Deno.test("[ESC-BLOQUEO] lo no respaldado por fuente oficial se informa «noVerificable», nunca como correcto", () => {
  const nv = (f: (d: D) => void) => ar(con(f)).noVerificable;
  assert(nv((d) => d.Items[0].Impuestos[0].CodigoUnidadGravable = 2).some((n) => n.regla === "ARI-IVA-BASE" && n.puntos.includes("V1")));       // IVA 0 %
  assert(nv((d) => d.Items[0].OtrosDescuento = "1").some((n) => n.regla === "ARI-IVA-BASE"));                                                       // RCP226 vs SEC500
  assert(nv((d) => d.Items[0].Impuestos = [{ NombreCorto: "BOMBEROS", CodigoUnidadGravable: 1, MontoGravable: "1", MontoImpuesto: "0.02" }]).some((n) => n.puntos.includes("V11")));
  assert(nv((d) => d.Items[0].Idp = "1").some((n) => n.regla === "ARI-TOTAL-ITEM"));
  assert(nv((d) => delete d.Totales.TotalImpuestos).some((n) => n.regla === "ARI-TOTAL-IMPUESTO"));
  assert(nv((d) => d.Totales.TotalImpuestos.push({ NombreCorto: "PETROLEO", TotalMontoImpuesto: "1" })).some((n) => n.regla === "ARI-TOTAL-IMPUESTO"));
  assertEquals(nv(() => {}), []); // el caso totalmente respaldado: nada pendiente
});
Deno.test("[ESC-BLOQUEO] un impuesto no verificable impide dar por correcto el Total del ítem", () => {
  const d = con((x) => { x.Items[0].Impuestos = [{ NombreCorto: "BOMBEROS", CodigoUnidadGravable: 1, MontoGravable: "100", MontoImpuesto: "2" }]; x.Items[0].Total = "999"; });
  const r = ar(d); assert(!r.violaciones.some((v) => v.regla === "ARI-TOTAL-ITEM")); assert(r.noVerificable.some((n) => n.regla === "ARI-TOTAL-ITEM"));
});
