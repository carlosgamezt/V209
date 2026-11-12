// Aritmética decimal exacta (autorización D1-A punto 2; regla [PRY-SIN-FLOTANTES]). Fuente de la regla: autorización D1-A (no es una regla fiscal).
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { digitosDecimal, esTextoDecimal, Racional } from "../src/decimal.ts";
const R = Racional.desdeTexto;

Deno.test("[PRY-SIN-FLOTANTES] 0.1 + 0.2 es exactamente 0.3 (en coma flotante no lo es)", () => {
  assert(0.1 + 0.2 !== 0.3); assertEquals(R("0.1").sumar(R("0.2")).aTextoExacto(), "0.3"); assert(R("0.1").sumar(R("0.2")).igual(R("0.3")));
});
Deno.test("[PRY-SIN-FLOTANTES] casos clásicos de coma flotante dan resultado exacto", () => {
  assertEquals(R("1.005").multiplicar(R("1000")).aTextoExacto(), "1005");
  assertEquals(R("4.35").multiplicar(R("100")).aTextoExacto(), "435"); // 4.35*100 = 434.99999999999994 en flotante
  assertEquals(R("1.15").multiplicar(R("100")).aTextoExacto(), "115");
  assertEquals(R("112").dividir(R("1.12")).aTextoExacto(), "100");
  assertEquals(R("100").multiplicar(R("0.12")).aTextoExacto(), "12");
  assertEquals(R("0.07").multiplicar(R("100")).aTextoExacto(), "7");
});
Deno.test("[PRY-SIN-FLOTANTES] los números JS se rechazan; solo texto decimal", () => {
  for (const v of [0.1, 1, NaN, Infinity, null, undefined, 10n, {}, []]) assertThrows(() => Racional.desdeTexto(v), Error, "texto decimal");
  assert(!esTextoDecimal(0.1) && esTextoDecimal("0.1"));
});
Deno.test("[PRY-SIN-FLOTANTES] textos no decimales se rechazan (exponente, espacios, vacío, coma, signos dobles, demasiado largo)", () => {
  for (const t of ["", " 1", "1 ", "1e3", "1E3", "0x10", "1,5", "--1", "+-1", ".", "1.2.3", "NaN", "Infinity", "١٢٣", "1".repeat(101)]) assertThrows(() => R(t), Error, undefined, t);
  assertEquals(R("+1.50").aTextoExacto(), "1.5"); assertEquals(R(".5").aTextoExacto(), "0.5"); assertEquals(R("5.").aTextoExacto(), "5"); assertEquals(R("-0.00").aTextoExacto(), "0");
});
Deno.test("[PRY-SIN-FLOTANTES] expansión no finita: texto exacto en fracción, nunca redondeo", () => {
  const t = R("1").dividir(R("3")); assert(!t.tieneExpansionFinita()); assertEquals(t.aTextoExacto(), "1/3");
  assert(t.multiplicar(R("3")).igual(R("1"))); assertEquals(R("100").dividir(R("1.12")).aTextoExacto(), "625/7");
  assertThrows(() => R("1").dividir(R("0")), Error, "cero");
});
Deno.test("[PRY-SIN-FLOTANTES] digitosDecimal cuenta dígitos canónicos (XSD totalDigits/fractionDigits)", () => {
  assertEquals(digitosDecimal("0012.3400"), { enteros: 2, decimales: 2, total: 4 }); assertEquals(digitosDecimal("0"), { enteros: 0, decimales: 0, total: 1 }); assertEquals(digitosDecimal("abc"), null);
});
// ---- propiedades contra una referencia independiente en BigInt (PRNG determinista)
function prng(semilla: number) { let s = semilla >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; }; }
function aTexto(n: bigint, esc: number): string { const neg = n < 0n, a = (neg ? -n : n).toString().padStart(esc + 1, "0"); return `${neg ? "-" : ""}${a.slice(0, a.length - esc)}${esc ? "." + a.slice(a.length - esc) : ""}`; }
Deno.test("[PRY-SIN-FLOTANTES] propiedades: suma, resta y producto coinciden con enteros escalados (2000 casos)", () => {
  const r = prng(20261112);
  for (let i = 0; i < 2000; i++) {
    const ea = r() % 9, eb = r() % 9, a = BigInt(r()) * BigInt(r() % 1000) * (r() % 2 ? 1n : -1n), b = BigInt(r()) * (r() % 2 ? 1n : -1n);
    const A = R(aTexto(a, ea)), B = R(aTexto(b, eb)), e = Math.max(ea, eb);
    const esc = (n: bigint, de: number) => n * 10n ** BigInt(e - de);
    assertEquals(A.sumar(B).aTextoExacto(), R(aTexto(esc(a, ea) + esc(b, eb), e)).aTextoExacto());
    assertEquals(A.restar(B).aTextoExacto(), R(aTexto(esc(a, ea) - esc(b, eb), e)).aTextoExacto());
    assertEquals(A.multiplicar(B).aTextoExacto(), R(aTexto(a * b, ea + eb)).aTextoExacto());
    assertEquals(A.comparar(B), esc(a, ea) < esc(b, eb) ? -1 : esc(a, ea) > esc(b, eb) ? 1 : 0);
    if (b !== 0n) assert(A.dividir(B).multiplicar(B).igual(A)); // (a/b)*b = a, exacto
  }
});
Deno.test("[PRY-SIN-FLOTANTES] suma de 10 000 importes de 0.1 es exactamente 1000", () => {
  assertEquals(Racional.suma(Array.from({ length: 10000 }, () => R("0.1"))).aTextoExacto(), "1000");
  let f = 0; for (let i = 0; i < 10000; i++) f += 0.1; assert(f !== 1000); // el flotante no lo logra
});
