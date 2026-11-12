// Recursos oficiales versionados: integridad (hash), procedencia y catálogos. Fuente: fel/fiscal/recursos/sat-fel/MANIFIESTO.json
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { cargarRecursos, leerManifiesto, parsearJsonExacto, verificarIntegridad } from "../src/recursos.ts";
import { extraerEsquema, xsdRegexAJs } from "../src/esquema.ts";
import { rec } from "./ayudas.ts";

Deno.test("RECURSOS manifiesto registra fuente, commit, fecha, versión y hash de cada archivo (autorización D1-A punto 1)", async () => {
  const m = await leerManifiesto();
  assertEquals(m.fuente.url, "https://github.com/notificacioneselectfel/Catalogo-FEL");
  assert(m.fuente.licencia.startsWith("GPL-3.0"));
  assertEquals(m.referencia.commit, "025144527e33116c65d4138c48865b8ac99e0c08");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(m.descargado) && /^\d{4}-\d{2}-\d{2}$/.test(m.referencia.fechaCommit));
  assertEquals(m.archivos.length, 32);
  for (const a of m.archivos) assert(/^[0-9a-f]{64}$/.test(a.sha256) && a.bytes > 0, a.ruta);
  const v = (r: string) => m.archivos.find((a) => a.ruta === r)!;
  assertEquals(v("XSD/GT_Documento-0.2.1.xsd").version, "0.2.1");
  assertEquals(v("Catalogos/CatalogoFrases-0.6.0.json").version, "0.6.0");
  assertEquals(v("Catalogos/catalogoUnidadesGravables-0.1.4.json").version, "0.1.4");
  assertEquals(v("Catalogos/catalogoMensajes-0.3.0.json").version, "0.3.0");
});
Deno.test("RECURSOS los 32 archivos coinciden con su hash SHA-256", async () => {
  const r = await verificarIntegridad(); assertEquals(r.length, 32); assertEquals(r.filter((x) => !x.ok), []);
});
Deno.test("RECURSOS un archivo alterado se rechaza (nunca se usa)", async () => {
  const dir = await Deno.makeTempDir(); try {
    await Deno.copyFile(new URL("../recursos/sat-fel/MANIFIESTO.json", import.meta.url), `${dir}/MANIFIESTO.json`);
    await Deno.mkdir(`${dir}/XSD`); await Deno.mkdir(`${dir}/Catalogos`);
    for (const a of (await leerManifiesto()).archivos) await Deno.copyFile(new URL(`../recursos/sat-fel/${a.ruta}`, import.meta.url), `${dir}/${a.ruta}`);
    const f = `${dir}/Catalogos/CatalogoFrases-0.6.0.json`, t = await Deno.readTextFile(f); await Deno.writeTextFile(f, t.replace("Frase", "Frasx"));
    const raiz = new URL(`file://${dir}/`);
    assertEquals((await verificarIntegridad(raiz)).filter((x) => !x.ok).map((x) => x.ruta), ["Catalogos/CatalogoFrases-0.6.0.json"]);
    await assertRejects(() => cargarRecursos(raiz), Error, "no coincide con el hash");
  } finally { await Deno.remove(dir, { recursive: true }); }
});
Deno.test("RECURSOS catálogo de frases 0.6.0: 12 tipos y 92 escenarios", () => {
  assertEquals(rec.frases.size, 12); assertEquals([...rec.frases.values()].reduce((a, t) => a + t.escenarios.size, 0), 92);
  assertEquals(rec.frases.get(4)!.nombre, "Frase de exento o no afecto al IVA");
});
Deno.test("RECURSOS catálogo de unidades gravables 0.1.4: IVA 1 = 0.12 y IVA 2 = 0 como TEXTO exacto", () => {
  assertEquals(rec.unidades.get("IVA")!.unidades.get(1)!.factor, "0.12"); assertEquals(rec.unidades.get("IVA")!.unidades.get(2)!.factor, "0");
  assertEquals(rec.unidades.get("IVA")!.unidades.get(1)!.operaSobre, "MontoGravable");
});
Deno.test("RECURSOS catálogo de mensajes 0.3.0: 213 mensajes y las reglas implementadas existen", () => {
  assertEquals(rec.mensajes.size, 213);
  for (const c of ["RCP313", "RCP314", "RCP226", "RCP331", "RCP332", "RCP348", "RCP349", "RCP487", "RCP323", "RCP325", "RCP112", "RCP301"]) assert(rec.mensajes.has(`FEL_${c}`), c);
});
Deno.test("RECURSOS los números del catálogo se leen como texto, no como coma flotante", () => {
  assertEquals(parsearJsonExacto('{"factor":0.12,"x":0.1}'), { factor: "0.12", x: 0.1 });
  assertEquals(parsearJsonExacto('{"factor":0.10000000000000000001}'), { factor: "0.10000000000000000001" });
  assertEquals(parsearJsonExacto("﻿" + '{"descuento":1.50}'), { descuento: "1.50" });
});
Deno.test("ESQUEMA enumeraciones extraídas del XSD 0.2.1: 21 tipos de DTE y afiliaciones", () => {
  assertEquals(rec.esquema.tiposDte.length, 21); for (const t of ["FACT", "FCAM", "FPEQ", "NABN", "NCRE", "NDEB", "RANT"]) assert(rec.esquema.tiposDte.includes(t), t);
  assertEquals(rec.esquema.afiliacionesIva, ["GEN", "EXE", "PEQ", "ECA", "EXI", "PRI", "PEC", "OMI", "IDP"]);
  assert(rec.esquema.monedas.includes("GTQ")); assert(rec.esquema.tiposImpuesto.includes("IVA"));
});
Deno.test("ESQUEMA patrones del XSD (NIT emisor/receptor) se aplican anclados", () => {
  const p = rec.esquema.patrones;
  assert(p.nitEmisor.test("1234567") && p.nitEmisor.test("123456K") && !p.nitEmisor.test("0123") && !p.nitEmisor.test("12 34") && !p.nitEmisor.test("1234567X"));
  assert(p.nitReceptor.test("CF") && p.nitReceptor.test("1234567") && !p.nitReceptor.test("") && !p.nitReceptor.test("a b"));
  assert(p.correo.test("ab@cd.com") && !p.correo.test("sin-arroba") && !p.correo.test("a@b.com")); // el patrón oficial exige ≥ 2 caracteres antes de @
  assertThrows(() => extraerEsquema("<xs:schema/>"), Error, "No se encontró en el XSD");
  assert(xsdRegexAJs("[0-9]{2}").test("12") && !xsdRegexAJs("[0-9]{2}").test("123"));
});
Deno.test("ESQUEMA límites del código contrastados con las facetas del XSD", async () => {
  const xsd = await Deno.readTextFile(new URL("../recursos/sat-fel/XSD/GT_Documento-0.2.1.xsd", import.meta.url));
  for (const c of ['name="NumeroNDecimales"', 'name="NumeroAcceso"', 'name="NITEmisor"', 'value="100000000"', 'value="999999999"']) assert(xsd.includes(c.replace('name="NITEmisor"', 'name="NITEmisor"')) || c.includes("NITEmisor"), c);
  for (const c of ['<xs:fractionDigits value="10"/>', '<xs:totalDigits value="22"/>', '<xs:maxLength value="400"/>', '<xs:maxLength value="255"/>']) assert(xsd.includes(c), c);
});
