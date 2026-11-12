// Frases, fechas, catálogo de unidades gravables. Fuentes: Catalogos/CatalogoFrases-0.6.0.json, catalogoUnidadesGravables-0.1.4.json y textos de catalogoMensajes-0.3.0.json (SAT).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { tipoFraseExento, validarFrases } from "../src/frases.ts";
import { validarFechaCertificacion } from "../src/fechas.ts";
import { verificarAritmetica } from "../src/aritmetica.ts";
import { clon, dteBase, rec, TOL } from "./ayudas.ts";
// deno-lint-ignore no-explicit-any
type D = any;
const con = (f: (d: D) => void): D => { const d: D = clon(dteBase()); f(d); return d; };
const fr = (d: D) => validarFrases(d, rec).map((v) => v.regla);
const exento = [...rec.frases.get(4)!.escenarios.keys()][0];

Deno.test("[FRA-CATALOGO] CatalogoFrases-0.6.0 / RCP320: el ejemplo válido pasa; tipo o escenario inexistente se rechaza", () => {
  assertEquals(fr(dteBase()), []);
  assert(rec.frases.get(1)!.escenarios.has(1));
  assertEquals(fr(con((d) => d.Frases = [{ TipoFrase: 1, CodigoEscenario: 99 }])), ["FRA-CATALOGO"]);
  assertEquals(fr(con((d) => d.Frases = [{ TipoFrase: 12, CodigoEscenario: 99 }])), ["FRA-CATALOGO"]);
  for (const [t, tipo] of rec.frases) for (const e of tipo.escenarios.keys()) assertEquals(fr(con((d) => { d.Frases = [{ TipoFrase: t, CodigoEscenario: e }]; })).filter((r) => r === "FRA-CATALOGO"), []);
});
Deno.test("[FRA-CATALOGO] el tipo «exento o no afecto al IVA» se identifica por nombre oficial y es el 4", () => { assertEquals(tipoFraseExento(rec), 4); });
Deno.test("[FRA-UNICA] catalogoMensajes-0.3.0 RCP487: no se repite el tipo de frase salvo en RANT", () => {
  const dup = [{ TipoFrase: 1, CodigoEscenario: 1 }, { TipoFrase: 1, CodigoEscenario: 2 }];
  assert(fr(con((d) => d.Frases = dup)).includes("FRA-UNICA")); assert(!fr(con((d) => { d.DatosGenerales.Tipo = "RANT"; d.Frases = dup; })).includes("FRA-UNICA"));
  assert(!fr(con((d) => d.Frases = [{ TipoFrase: 1, CodigoEscenario: 1 }, { TipoFrase: 2, CodigoEscenario: 1 }])).includes("FRA-UNICA"));
});
Deno.test("[FRA-EXENTO-ITEMS-SIN-IVA] catalogoMensajes-0.3.0 RCP325: FACT/FCAM sin exportación con ítem sin IVA exige la frase de exento", () => {
  const sinIva = (d: D) => { delete d.Items[0].Impuestos; delete d.Totales.TotalImpuestos; d.Items[0].Total = "112"; };
  assert(fr(con(sinIva)).includes("FRA-EXENTO-ITEMS-SIN-IVA"));
  assert(!fr(con((d) => { sinIva(d); d.Frases.push({ TipoFrase: 4, CodigoEscenario: exento }); })).includes("FRA-EXENTO-ITEMS-SIN-IVA"));
  assert(fr(con((d) => { sinIva(d); d.DatosGenerales.Tipo = "FCAM"; })).includes("FRA-EXENTO-ITEMS-SIN-IVA"));
  assert(!fr(con((d) => { sinIva(d); d.DatosGenerales.Tipo = "FPEQ"; })).includes("FRA-EXENTO-ITEMS-SIN-IVA")); // otros tipos: la regla oficial no los menciona
  assert(!fr(con((d) => { sinIva(d); d.DatosGenerales.Exp = "SI"; })).includes("FRA-EXENTO-ITEMS-SIN-IVA")); // con exportación aplica RCP323
  assert(!fr(dteBase()).includes("FRA-EXENTO-ITEMS-SIN-IVA"));
});
Deno.test("[FRA-EXENTO-EXPORTACION] catalogoMensajes-0.3.0 RCP323: con exportación se exige la frase de exento", () => {
  for (const t of ["FACT", "FCAM", "FACP", "NDEB", "NCRE"]) assert(fr(con((d) => { d.DatosGenerales.Tipo = t; d.DatosGenerales.Exp = "SI"; })).includes("FRA-EXENTO-EXPORTACION"), t);
  assert(!fr(con((d) => { d.DatosGenerales.Exp = "SI"; d.Frases.push({ TipoFrase: 4, CodigoEscenario: exento }); })).includes("FRA-EXENTO-EXPORTACION"));
  assert(!fr(con((d) => { d.DatosGenerales.Tipo = "NABN"; d.DatosGenerales.Exp = "SI"; })).includes("FRA-EXENTO-EXPORTACION"));
});
Deno.test("[FRA-ESCENARIOS-9] catalogoMensajes-0.3.0 RCP112 cláusulas 1 y 2: escenarios 15, 16 y 17 de la frase 9", () => {
  for (const e of [15, 16, 17]) assert(rec.frases.get(9)!.escenarios.has(e), `escenario ${e} existe en el catálogo`);
  const f9 = (tipo: string, e: number) => fr(con((d) => { d.DatosGenerales.Tipo = tipo; d.Frases = [{ TipoFrase: 9, CodigoEscenario: e }]; }));
  for (const t of ["FACT", "FCAM", "FPEQ", "FCAP"]) assert(!f9(t, 15).includes("FRA-ESCENARIOS-9"), t);
  for (const t of ["NCRE", "NABN", "RECI"]) assert(f9(t, 15).includes("FRA-ESCENARIOS-9"), t);
  for (const e of [16, 17]) { assert(f9("FACT", e).includes("FRA-ESCENARIOS-9")); assert(!f9("NABN", e).includes("FRA-ESCENARIOS-9")); }
});
Deno.test("[FEC-MES-CERTIFICACION] catalogoMensajes-0.3.0 RCP301: no posterior al último día del mes de certificación (hora de Guatemala)", () => {
  const v = (e: string, c: string) => validarFechaCertificacion(e, c).length;
  assertEquals(v("2026-11-30T23:59:59-06:00", "2026-11-12T10:00:00-06:00"), 0);       // último segundo del mes
  assertEquals(v("2026-12-01T00:00:00-06:00", "2026-11-12T10:00:00-06:00"), 1);       // primer instante del mes siguiente
  assertEquals(v("2026-12-01T00:00:00-06:00", "2026-12-01T03:00:00Z"), 1);            // cert = 30-nov 21:00 GT: sigue noviembre
  assertEquals(v("2026-12-01T00:00:00-06:00", "2026-12-01T06:00:00Z"), 0);            // cert = 1-dic 00:00 GT
  assertEquals(v("2026-12-01T05:59:59Z", "2026-11-15T00:00:00-06:00"), 0);            // 30-nov 23:59:59 GT
  assertEquals(v("2026-12-01T06:00:00Z", "2026-11-15T00:00:00-06:00"), 1);            // 1-dic 00:00 GT
  assertEquals(v("2020-01-01T00:00:00-06:00", "2026-11-12T10:00:00-06:00"), 0);       // meses anteriores: esta regla no los limita (INF300 no se implementa)
  assertEquals(v("2026-12-31T10:00:00-06:00", "2026-12-15T10:00:00-06:00"), 0);       // fin de año
  assertEquals(v("2027-01-01T00:00:00-06:00", "2026-12-31T23:00:00-06:00"), 1);
  assertEquals(v("2028-03-01T00:00:00-06:00", "2028-02-29T12:00:00-06:00"), 1);       // bisiesto
  assertEquals(v("2028-02-29T23:00:00-06:00", "2028-02-01T12:00:00-06:00"), 0);
  assertEquals(v("no-es-fecha", "2026-11-12T10:00:00-06:00"), 1); assertEquals(v("2026-11-12T10:00:00-06:00", "2026-13-01T00:00:00Z"), 1);
});
const ar = (d: D, t = TOL) => verificarAritmetica(d, rec, { tolerancia: t });
Deno.test("[CAT-UG-EXISTE] catalogoUnidadesGravables-0.1.4: la unidad gravable debe existir en el catálogo del impuesto", () => {
  assertEquals(ar(dteBase()).violaciones, []);
  const r = ar(con((d) => d.Items[0].Impuestos[0].CodigoUnidadGravable = 5)); assert(r.violaciones.some((v) => v.regla === "CAT-UG-EXISTE"));
});
Deno.test("[CAT-UG-CASILLA] catalogoUnidadesGravables-0.1.4: la casilla usada depende del impuesto (operaSobreCasilla)", () => {
  assert(ar(con((d) => delete d.Items[0].Impuestos[0].MontoGravable)).violaciones.some((v) => v.regla === "CAT-UG-CASILLA"));
  assert(ar(con((d) => d.Items[0].Impuestos[0].CantidadUnidadesGravables = "1")).violaciones.some((v) => v.regla === "CAT-UG-CASILLA"));
  // PETROLEO opera sobre CantidadUnidadesGravables: presentar MontoGravable es error, y el impuesto queda NO verificable
  const p = ar(con((d) => { d.Items[0].Impuestos = [{ NombreCorto: "PETROLEO", CodigoUnidadGravable: 1, MontoGravable: "1", MontoImpuesto: "1" }]; }));
  assert(p.violaciones.some((v) => v.regla === "CAT-UG-CASILLA")); assert(p.noVerificable.some((n) => n.puntos.includes("V11")));
});
