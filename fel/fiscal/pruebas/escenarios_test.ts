// Bloqueo de escenarios no aprobados (condición obligatoria de D1-A, regla [ESC-BLOQUEO]; fuente: autorización D1-A). El motor NUNCA devuelve un resultado «aparentemente válido».
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { calcularDte, certificarDte, evaluarAprobacion, prepararCertificacionDte } from "../src/escenarios.ts";
import { EscenarioNoAprobado } from "../src/error.ts";
import { validarDte } from "../src/validar.ts";
import { PUNTOS_BLOQUEADOS } from "../src/reglas.ts";
import { clon, dteBase, rec, TOL } from "./ayudas.ts";
// deno-lint-ignore no-explicit-any
type D = any;
const con = (f: (d: D) => void): D => { const d: D = clon(dteBase()); f(d); return d; };

Deno.test("[ESC-BLOQUEO] calcular, certificar y preparar SIEMPRE lanzan EscenarioNoAprobado, incluso con un FACT perfecto con IVA 12 %", () => {
  for (const f of [calcularDte, certificarDte, prepararCertificacionDte]) {
    const e = assertThrows(() => f(dteBase()), EscenarioNoAprobado); assertEquals(e.codigo, "ESCENARIO_NO_APROBADO"); assert(e.bloqueos.includes("V1") && e.bloqueos.includes("V2"));
  }
});
Deno.test("[ESC-BLOQUEO] lanzan para cualquier entrada: tipos, exportación, retenciones, otros impuestos, notas, null y basura", () => {
  const casos: unknown[] = [null, undefined, 5, "x", [], {}, Object.create(null), dteBase(),
    con((d) => d.DatosGenerales.Tipo = "NCRE"), con((d) => d.DatosGenerales.Tipo = "NDEB"), con((d) => d.DatosGenerales.Tipo = "FPEQ"), con((d) => d.DatosGenerales.Exp = "SI"),
    con((d) => d.Frases = [{ TipoFrase: 2, CodigoEscenario: 1 }]), con((d) => d.Items[0].Impuestos[0].NombreCorto = "PETROLEO"), con((d) => d.DatosGenerales.Tipo = "NABN")];
  for (const c of casos) for (const f of [calcularDte, certificarDte, prepararCertificacionDte]) assertThrows(() => f(c), EscenarioNoAprobado);
});
Deno.test("[ESC-BLOQUEO] el motor no expone ninguna función que devuelva importes calculados o un DTE «certificable»", async () => {
  const mod = await import("../mod.ts"); const nombres = Object.keys(mod);
  assertEquals(nombres.filter((n) => /^(calcular|certificar|preparar|firmar|emitir|redondear)/i.test(n)).sort(), ["calcularDte", "certificarDte", "prepararCertificacionDte"]);
  for (const n of ["calcularDte", "certificarDte", "prepararCertificacionDte"]) assertThrows(() => (mod as D)[n](dteBase()), EscenarioNoAprobado);
});
Deno.test("[ESC-BLOQUEO] evaluarAprobacion nunca aprueba y explica los puntos V1–V12 que bloquean", () => {
  const e = (d: unknown) => evaluarAprobacion(d);
  assertEquals(e(dteBase()).aprobado, false);
  assertEquals(e(dteBase()).bloqueos, ["V1", "V2", "V3", "V4", "V5", "V7", "V8"]); // FACT a consumidor final con IVA y frase de retención ISR
  assert(e(con((d) => d.DatosGenerales.Tipo = "NCRE")).bloqueos.includes("V9")); assert(e(con((d) => d.DatosGenerales.Tipo = "FCAM")).bloqueos.includes("V6"));
  assert(e(con((d) => d.DatosGenerales.Exp = "SI")).bloqueos.includes("V10")); assert(e(con((d) => d.Frases = [{ TipoFrase: 1, CodigoEscenario: 1 }])).bloqueos.includes("V8"));
  assert(e(con((d) => d.Items[0].Impuestos[0].NombreCorto = "BOMBEROS")).bloqueos.includes("V11")); assert(e(con((d) => d.DatosGenerales.Tipo = "NABN")).bloqueos.includes("V12"));
  for (const x of [null, undefined, 5, [], { Items: 5 }]) { const r = e(x); assertEquals(r.aprobado, false); assert(r.bloqueos.length >= 4); }
  for (const p of Object.keys(PUNTOS_BLOQUEADOS)) assertEquals(PUNTOS_BLOQUEADOS[p].estado, "bloqueado");
  assertEquals(Object.keys(PUNTOS_BLOQUEADOS), Array.from({ length: 12 }, (_, i) => `V${i + 1}`));
});
Deno.test("[ESC-BLOQUEO] validarDte: aprobadoParaCertificar es SIEMPRE false aunque no haya violaciones", () => {
  const r = validarDte(dteBase(), rec, { tolerancia: TOL, fechaCertificacion: "2026-11-12T12:00:00-06:00" });
  assertEquals(r.estructuraValida, true); assertEquals(r.violaciones, []); assertEquals(r.aritmetica, "verificada"); assertEquals(r.fechas, "verificada");
  assertEquals(r.aprobadoParaCertificar, false); assert(r.bloqueos.length >= 4);
  assertEquals(r.recursos.commit, "025144527e33116c65d4138c48865b8ac99e0c08");
});
Deno.test("[ESC-BLOQUEO] validarDte: lo no verificable aparece como «parcial» y estructura inválida omite aritmética y fechas (no se inventa un resultado)", () => {
  const p = validarDte(con((d) => d.Items[0].OtrosDescuento = "1"), rec, { tolerancia: TOL }); assertEquals(p.aritmetica, "parcial"); assert(p.noVerificable.length > 0); assertEquals(p.fechas, "omitida"); assertEquals(p.aprobadoParaCertificar, false);
  const m = validarDte(con((d) => d.Items = []), rec, { tolerancia: TOL, fechaCertificacion: "2026-11-12T12:00:00-06:00" }); assertEquals(m.estructuraValida, false); assertEquals(m.aritmetica, "omitida"); assertEquals(m.fechas, "omitida"); assertEquals(m.aprobadoParaCertificar, false);
  const h = validarDte(null, rec, { tolerancia: TOL }); assertEquals(h.estructuraValida, false); assertEquals(h.aprobadoParaCertificar, false);
});
Deno.test("[ESC-BLOQUEO] validarDte: la tolerancia es obligatoria aunque la estructura sea inválida", () => {
  // deno-lint-ignore no-explicit-any
  assertThrows(() => validarDte(dteBase(), rec, {} as any), Error, "obligatorio"); assertThrows(() => validarDte(null, rec, { tolerancia: "x" }), Error);
  // deno-lint-ignore no-explicit-any
  assertThrows(() => validarDte(dteBase(), rec, undefined as any), Error);
});
Deno.test("[FEC-MES-CERTIFICACION] validarDte integra RCP301 solo si se entrega la fecha de certificación (no se asume «ahora»)", () => {
  assertEquals(validarDte(dteBase(), rec, { tolerancia: TOL }).fechas, "omitida");
  const r = validarDte(con((d) => d.DatosGenerales.FechaHoraEmision = "2026-12-05T10:00:00-06:00"), rec, { tolerancia: TOL, fechaCertificacion: "2026-11-12T12:00:00-06:00" });
  assertEquals(r.violaciones.map((v) => v.regla), ["FEC-MES-CERTIFICACION"]);
});
