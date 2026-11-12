// Validación estructural y de cardinalidad. Fuente de cada regla: XSD/GT_Documento-0.2.1.xsd (SAT) — ver la ubicación en src/reglas.ts.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { validarEstructura } from "../src/estructura.ts";
import { clon, dteBase, rec } from "./ayudas.ts";
// deno-lint-ignore no-explicit-any
type D = any;
const reglas = (d: unknown) => validarEstructura(d, rec.esquema).filter((v) => v.severidad === "error").map((v) => v.regla);
const con = (f: (d: D) => void) => { const d: D = clon(dteBase()); f(d); return d; };

Deno.test("[ESQ-RAIZ] XSD 0.2.1 DatosEmision: el ejemplo válido no tiene violaciones y faltan-elementos se detectan", () => {
  assertEquals(reglas(dteBase()), []);
  for (const k of ["DatosGenerales", "Emisor", "Receptor", "Items", "Totales"]) assert(reglas(con((d) => delete d[k])).includes("ESQ-RAIZ"), k);
  for (const x of [null, undefined, 5, "x", [], true]) assertEquals(reglas(x), ["ESQ-RAIZ"]);
});
Deno.test("[ESQ-TIPO] XSD 0.2.1 DatosGenerales/@Tipo: fuera de la enumeración", () => {
  assert(reglas(con((d) => d.DatosGenerales.Tipo = "XXXX")).includes("ESQ-TIPO")); assert(reglas(con((d) => delete d.DatosGenerales.Tipo)).includes("ESQ-TIPO"));
  for (const t of rec.esquema.tiposDte) assert(!reglas(con((d) => d.DatosGenerales.Tipo = t)).includes("ESQ-TIPO"), t);
});
Deno.test("[ESQ-FECHA-EMISION] XSD 0.2.1: xs:dateTime con calendario real; zona distinta de -06:00 es aviso", () => {
  for (const f of ["2026-02-30T10:00:00-06:00", "2026-13-01T10:00:00-06:00", "2026-11-12T25:00:00-06:00", "2026-11-12", "ayer", "", "2026-11-12T10:00:00+99:00"]) assert(reglas(con((d) => d.DatosGenerales.FechaHoraEmision = f)).includes("ESQ-FECHA-EMISION"), f);
  assertEquals(reglas(con((d) => d.DatosGenerales.FechaHoraEmision = "2028-02-29T10:00:00-06:00")), []); // bisiesto
  assert(reglas(con((d) => d.DatosGenerales.FechaHoraEmision = "2027-02-29T10:00:00-06:00")).includes("ESQ-FECHA-EMISION"));
  const av = validarEstructura(con((d) => d.DatosGenerales.FechaHoraEmision = "2026-11-12T10:00:00Z"), rec.esquema).filter((v) => v.severidad === "aviso"); assertEquals(av.length, 1);
});
Deno.test("[ESQ-MONEDA] XSD 0.2.1 @CodigoMoneda", () => { assert(reglas(con((d) => d.DatosGenerales.CodigoMoneda = "XYZ")).includes("ESQ-MONEDA")); assertEquals(reglas(con((d) => d.DatosGenerales.CodigoMoneda = "USD")), []); });
Deno.test("[ESQ-NUMERO-ACCESO] XSD 0.2.1: entero entre 100000000 y 999999999", () => {
  for (const v of [99999999, 1000000000, 1.5, "123456789", -1]) assert(reglas(con((d) => d.DatosGenerales.NumeroAcceso = v)).includes("ESQ-NUMERO-ACCESO"), String(v));
  for (const v of [100000000, 999999999]) assertEquals(reglas(con((d) => d.DatosGenerales.NumeroAcceso = v)), []);
});
Deno.test("[ESQ-MARCAS] XSD 0.2.1: marcas «SI», «Residencial», dispositivo y personería", () => {
  for (const [k, v] of [["Exp", "NO"], ["EmisionUbicacionTemporal", "si"], ["Espectaculo", true], ["Servicio", "Comercial"], ["Dispositivo", "PC"], ["TipoPersoneria", -1]] as const) assert(reglas(con((d) => d.DatosGenerales[k] = v)).includes("ESQ-MARCAS"), k);
  assertEquals(reglas(con((d) => { d.DatosGenerales.Exp = "SI"; d.DatosGenerales.Dispositivo = "APP"; d.DatosGenerales.TipoPersoneria = 1; })), []);
});
Deno.test("[ESQ-EMISOR-NIT] XSD 0.2.1 NITEmisor: patrón y máximo 13", () => {
  for (const v of ["", "0123", "12 34", "ABC", "12345678901234", 1234567, null]) assert(reglas(con((d) => d.Emisor.NITEmisor = v)).includes("ESQ-EMISOR-NIT"), String(v));
  for (const v of ["1234567", "123456K", "12"]) assertEquals(reglas(con((d) => d.Emisor.NITEmisor = v)), []);
});
Deno.test("[ESQ-EMISOR-TEXTOS] XSD 0.2.1: nombre 1–400 y comercial 1–255", () => {
  for (const [k, n] of [["NombreEmisor", 400], ["NombreComercial", 255]] as const) { assertEquals(reglas(con((d) => d.Emisor[k] = "a".repeat(n))), []); for (const v of ["", "a".repeat(n + 1), 5]) assert(reglas(con((d) => d.Emisor[k] = v)).includes("ESQ-EMISOR-TEXTOS"), k); }
});
Deno.test("[ESQ-EMISOR-ESTABLECIMIENTO] XSD 0.2.1: entero entre 1 y 9999", () => {
  for (const v of [0, 10000, 1.5, "1", -3]) assert(reglas(con((d) => d.Emisor.CodigoEstablecimiento = v)).includes("ESQ-EMISOR-ESTABLECIMIENTO"), String(v));
  for (const v of [1, 9999]) assertEquals(reglas(con((d) => d.Emisor.CodigoEstablecimiento = v)), []);
});
Deno.test("[ESQ-EMISOR-AFILIACION] XSD 0.2.1: afiliación IVA, omiso GEN/PEQ, clasificación 1674", () => {
  assert(reglas(con((d) => d.Emisor.AfiliacionIVA = "ZZZ")).includes("ESQ-EMISOR-AFILIACION")); assert(reglas(con((d) => d.Emisor.AfiliacionOmiso = "X")).includes("ESQ-EMISOR-AFILIACION")); assert(reglas(con((d) => d.Emisor.ClasificacionEmisor = 1)).includes("ESQ-EMISOR-AFILIACION"));
  assertEquals(reglas(con((d) => { d.Emisor.AfiliacionOmiso = "PEQ"; d.Emisor.ClasificacionEmisor = 1674; })), []);
});
Deno.test("[ESQ-CORREO] XSD 0.2.1 TipoCorreoElectronico", () => {
  for (const [k, p] of [["CorreoEmisor", "Emisor"], ["CorreoReceptor", "Receptor"]] as const) { assert(reglas(con((d) => d[p][k] = "no-es-correo")).includes("ESQ-CORREO"), k); assertEquals(reglas(con((d) => d[p][k] = "ab@cd.com")), []); }
});
Deno.test("[ESQ-DIRECCION-EMISOR] XSD 0.2.1: la dirección del emisor es obligatoria con sus límites", () => {
  assert(reglas(con((d) => delete d.Emisor.DireccionEmisor)).includes("ESQ-DIRECCION-EMISOR"));
  for (const [k, v] of [["Direccion", ""], ["Direccion", "a".repeat(201)], ["CodigoPostal", "1001"], ["Municipio", ""], ["Departamento", "a".repeat(101)], ["Pais", "ZZ"]] as const) assert(reglas(con((d) => d.Emisor.DireccionEmisor[k] = v)).includes("ESQ-DIRECCION-EMISOR"), k);
});
Deno.test("[ESQ-RECEPTOR-ID] XSD 0.2.1 IDReceptor: patrón y 1–18", () => {
  for (const v of ["", "a b", "A".repeat(19), 12]) assert(reglas(con((d) => d.Receptor.IDReceptor = v)).includes("ESQ-RECEPTOR-ID"), String(v));
  for (const v of ["CF", "1234567", "ABC123"]) assertEquals(reglas(con((d) => d.Receptor.IDReceptor = v)), []);
});
Deno.test("[ESQ-RECEPTOR-TEXTOS] XSD 0.2.1: nombre, tipo especial, destino de la venta, dirección", () => {
  for (const f of [(d: D) => d.Receptor.NombreReceptor = "", (d: D) => d.Receptor.TipoEspecial = "XX", (d: D) => d.Receptor.DestinodelaVenta = "9", (d: D) => d.Receptor.DireccionReceptor = { Direccion: "" }, (d: D) => d.Receptor.DireccionReceptor = 5, (d: D) => d.Receptor.DireccionReceptor = { Direccion: "x", Pais: "ZZ" }]) assert(reglas(con(f)).includes("ESQ-RECEPTOR-TEXTOS"));
  assertEquals(reglas(con((d) => { d.Receptor.TipoEspecial = "CUI"; d.Receptor.DireccionReceptor = { Direccion: "Ciudad", Pais: "GT" }; })), []);
});
Deno.test("[ESQ-FRASES-CARDINALIDAD] XSD 0.2.1: si existe Frases, entre 1 y 100", () => {
  assert(reglas(con((d) => d.Frases = [])).includes("ESQ-FRASES-CARDINALIDAD")); assert(reglas(con((d) => d.Frases = Array.from({ length: 101 }, () => ({ TipoFrase: 1, CodigoEscenario: 1 })))).includes("ESQ-FRASES-CARDINALIDAD"));
  assert(reglas(con((d) => d.Frases = "x")).includes("ESQ-FRASES-CARDINALIDAD")); assertEquals(reglas(con((d) => delete d.Frases)), []);
});
Deno.test("[ESQ-FRASE-CAMPOS] XSD 0.2.1: tipo 1–12, escenario 1–99, resolución 4–50, fecha válida", () => {
  for (const f of [(x: D) => x.TipoFrase = 0, (x: D) => x.TipoFrase = 13, (x: D) => x.CodigoEscenario = 0, (x: D) => x.CodigoEscenario = 100, (x: D) => x.NumeroResolucion = "abc", (x: D) => x.NumeroResolucion = "a".repeat(51), (x: D) => x.FechaResolucion = "2026-02-30", (x: D) => x.FechaResolucion = "12/11/2026"]) assert(reglas(con((d) => f(d.Frases[0]))).includes("ESQ-FRASE-CAMPOS"));
  assertEquals(reglas(con((d) => { d.Frases[0].NumeroResolucion = "ABCD"; d.Frases[0].FechaResolucion = "2028-02-29"; })), []);
});
Deno.test("[ESQ-ITEMS-CARDINALIDAD] XSD 0.2.1: entre 1 y 9999 ítems", () => {
  assert(reglas(con((d) => d.Items = [])).includes("ESQ-ITEMS-CARDINALIDAD")); assert(reglas(con((d) => d.Items = "x")).includes("ESQ-ITEMS-CARDINALIDAD"));
  assert(reglas(con((d) => d.Items = Array.from({ length: 10000 }, () => d.Items[0]))).includes("ESQ-ITEMS-CARDINALIDAD"));
});
Deno.test("[ESQ-ITEM-CAMPOS] XSD 0.2.1: línea, B/S, producto, unidad, descripción, observaciones, afecto", () => {
  for (const f of [(i: D) => i.NumeroLinea = 0, (i: D) => i.NumeroLinea = 10000, (i: D) => i.BienOServicio = "X", (i: D) => i.CodigoProducto = "ZZZ", (i: D) => i.UnidadMedida = "ABCD", (i: D) => i.Descripcion = "", (i: D) => i.Descripcion = "a".repeat(10001), (i: D) => i.Observaciones = "a".repeat(51), (i: D) => i.Afecto = "SI"]) assert(reglas(con((d) => f(d.Items[0]))).includes("ESQ-ITEM-CAMPOS"));
  assert(reglas(con((d) => d.Items = [5])).includes("ESQ-ITEM-CAMPOS"));
});
Deno.test("[ESQ-ITEM-IMPORTES] XSD 0.2.1 NumeroNDecimales: negativo, >10 decimales, >22 dígitos, no decimal, faltante", () => {
  for (const v of ["-1", "1.12345678901", "12345678901234567890123", "1e3", "", "abc", "1,5"]) assert(reglas(con((d) => d.Items[0].Precio = v)).includes("ESQ-ITEM-IMPORTES"), v);
  for (const k of ["Cantidad", "PrecioUnitario", "Precio", "Total"]) assert(reglas(con((d) => delete d.Items[0][k])).includes("ESQ-ITEM-IMPORTES"), k);
  for (const k of ["Descuento", "OtrosDescuento", "Idp"]) assert(reglas(con((d) => d.Items[0][k] = "-0.5")).includes("ESQ-ITEM-IMPORTES"), k);
  assertEquals(reglas(con((d) => d.Items[0].Cantidad = "0.1234567890")), []); // 10 decimales: límite
  assertEquals(reglas(con((d) => d.Items[0].Cantidad = "1234567890123.123456789")), []); // 22 dígitos: límite
});
Deno.test("[PRY-SIN-FLOTANTES] un importe numérico (number) se rechaza en cualquier casilla", () => {
  for (const f of [(d: D) => d.Items[0].Precio = 112, (d: D) => d.Items[0].Impuestos[0].MontoImpuesto = 12.5, (d: D) => d.Totales.GranTotal = 112.0, (d: D) => d.Totales.TotalImpuestos[0].TotalMontoImpuesto = 0.1]) assert(reglas(con(f)).includes("PRY-SIN-FLOTANTES"));
});
Deno.test("[ESQ-IMPUESTOS-CARDINALIDAD] XSD 0.2.1: 1 o 2 impuestos por ítem", () => {
  assert(reglas(con((d) => d.Items[0].Impuestos = [])).includes("ESQ-IMPUESTOS-CARDINALIDAD"));
  assert(reglas(con((d) => d.Items[0].Impuestos = Array.from({ length: 3 }, () => d.Items[0].Impuestos[0]))).includes("ESQ-IMPUESTOS-CARDINALIDAD"));
});
Deno.test("[ESQ-IMPUESTO-CAMPOS] XSD 0.2.1: nombre, unidad gravable, MontoImpuesto obligatorio", () => {
  for (const f of [(i: D) => i.NombreCorto = "XYZ", (i: D) => i.CodigoUnidadGravable = 0, (i: D) => i.CodigoUnidadGravable = 10000000, (i: D) => delete i.MontoImpuesto, (i: D) => i.MontoGravable = "-1", (i: D) => i.CantidadUnidadesGravables = "x"]) assert(reglas(con((d) => f(d.Items[0].Impuestos[0]))).includes("ESQ-IMPUESTO-CAMPOS"));
});
Deno.test("[ESQ-TOTALES] XSD 0.2.1: GranTotal obligatorio y 1–20 totales por impuesto con nombre válido", () => {
  for (const f of [(d: D) => delete d.Totales.GranTotal, (d: D) => d.Totales.TotalImpuestos = [], (d: D) => d.Totales.TotalImpuestos = Array.from({ length: 21 }, () => ({ NombreCorto: "IVA", TotalMontoImpuesto: "1" })), (d: D) => d.Totales.TotalImpuestos[0].NombreCorto = "XYZ", (d: D) => delete d.Totales.TotalImpuestos[0].TotalMontoImpuesto, (d: D) => d.Totales = 5]) assert(reglas(con(f)).includes("ESQ-TOTALES"));
});
Deno.test("[ESQ-RAIZ] entrada hostil (prototipos, tipos erróneos) no lanza excepciones", () => {
  for (const x of [{ DatosGenerales: 5, Emisor: [], Receptor: null, Items: {}, Totales: "x" }, JSON.parse('{"__proto__":{"a":1},"Items":[null,[],1]}'), Object.create(null)]) validarEstructura(x, rec.esquema);
});
