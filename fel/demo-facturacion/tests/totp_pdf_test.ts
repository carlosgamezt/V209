import assert from "node:assert/strict";
import { base32, codigo, deBase32, semillaNueva, uriOtp, verificar } from "../src/totp.ts";
import { pdfDemo } from "../src/pdf_demo.ts";

Deno.test("TOTP: vectores de la RFC 6238 (SHA-1), base32 de ida y vuelta, ventana de ±1 paso y rechazo de entradas raras", async () => {
  const semilla = base32(new TextEncoder().encode("12345678901234567890"));   // semilla de los vectores oficiales
  assert.equal(await codigo(semilla, 59_000), "287082"); assert.equal(await codigo(semilla, 1_111_111_109_000), "081804"); assert.equal(await codigo(semilla, 2_000_000_000_000), "279037");
  assert.deepEqual(deBase32(base32(new Uint8Array([1, 2, 3, 250, 251]))), new Uint8Array([1, 2, 3, 250, 251]));
  const t = 1_700_000_000_000, c = await codigo(semilla, t);
  assert.equal(await verificar(semilla, c, t), true); assert.equal(await verificar(semilla, c, t + 30_000), true, "paso siguiente"); assert.equal(await verificar(semilla, c, t + 90_000), false, "vencido");
  for (const x of ["", "12345", "1234567", "abcdef", "28708 "]) assert.equal(await verificar(semilla, x, t), false);
  assert.match(uriOtp("maestro", semillaNueva()), /^otpauth:\/\/totp\/NEXA%20FEL%20demo:maestro\?secret=[A-Z2-7]+&issuer=/);
});
Deno.test("PDF de demostración: estructura válida, siempre marcado como NO FISCAL y con acentos y paréntesis escapados", () => {
  const pdf = pdfDemo({ empresa: "Empresa (Demo) S.A.", nit: "1-9", receptor: "Ñandú & Cía", receptorId: "NIT 123", fecha: "12/11/2026", numeroBorrador: "BR-0001", estado: "Borrador",
    lineas: [{ descripcion: "Asesoría técnica (mensual)", cantidad: "1.500000", precio: "10.5", neto: "15.75" }], subtotal: "15.75", descuento: "0", base: "15.75" });
  const t = new TextDecoder("latin1").decode(pdf);
  assert.ok(t.startsWith("%PDF-1.4") && t.trimEnd().endsWith("%%EOF")); assert.match(t, /DOCUMENTO NO FISCAL/); assert.match(t, /SIN VALOR FISCAL/); assert.match(t, /NO es una factura ni un DTE/);
  assert.match(t, /Asesor\\355a t\\351cnica \\\(mensual\\\)/, "acentos en WinAnsi y paréntesis escapados"); assert.match(t, /Q 15\.75/);
  const xref = Number(/startxref\n(\d+)/.exec(t)![1]); assert.ok(t.slice(xref).startsWith("xref"), "la tabla xref apunta bien");
  assert.equal(Number(/\/Length (\d+)/.exec(t)![1]), t.slice(t.indexOf("stream\n") + 7, t.indexOf("\nendstream")).length, "longitud del flujo correcta");
});

const base = { empresa: "Empresa (Demo) S.A.", nit: "1-9", receptor: "Ñandú & Cía", receptorId: "NIT 123", fecha: "12/11/2026", numeroBorrador: "BR-0001", estado: "Borrador", subtotal: "15.75", descuento: "0", base: "15.75" };
const una = [{ descripcion: "Asesoría técnica (mensual)", cantidad: "1.500000", precio: "10.5", neto: "15.75" }];
const caja = (pdf: Uint8Array) => { const t = new TextDecoder("latin1").decode(pdf); const m = /\/MediaBox \[0 0 (\d+) (\d+)\]/.exec(t)!; return { t, w: Number(m[1]), h: Number(m[2]) }; };
const valido = (t: string) => { assert.ok(t.startsWith("%PDF-1.4") && t.trimEnd().endsWith("%%EOF")); const xref = Number(/startxref\n(\d+)/.exec(t)![1]); assert.ok(t.slice(xref).startsWith("xref")); assert.equal(Number(/\/Length (\d+)/.exec(t)![1]), t.slice(t.indexOf("stream\n") + 7, t.indexOf("\nendstream")).length); };
Deno.test("PDF carta: 612×792, marcado SIN VALOR FISCAL; ticket de 80 mm: ancho fijo 226 y alto que crece con el contenido", () => {
  const c = caja(pdfDemo({ ...base, lineas: una, formato: "carta" })); assert.deepEqual([c.w, c.h], [612, 792]); valido(c.t); assert.match(c.t, /SIN VALOR FISCAL/); assert.match(c.t, /NO es una factura ni un DTE/);
  const t1 = caja(pdfDemo({ ...base, lineas: una, formato: "ticket" })), t20 = caja(pdfDemo({ ...base, lineas: Array.from({ length: 20 }, (_, i) => ({ descripcion: `Ítem número ${i + 1} con una descripción bastante larga que ocupa varias líneas del ticket`, cantidad: "2", precio: "10.00", neto: "20.00" })), formato: "ticket" }));
  assert.equal(t1.w, 226); assert.equal(t20.w, 226, "ancho fijo"); assert.ok(t20.h > t1.h + 400, `el alto crece con el contenido (${t1.h} → ${t20.h})`); valido(t1.t); valido(t20.t);
  assert.match(t1.t, /DOCUMENTO NO FISCAL/); assert.match(t1.t, /SIN VALOR FISCAL/); assert.match(t1.t, /NO es una factura ni un DTE/); assert.match(t1.t, /Q 15\.75/);
  assert.equal(caja(pdfDemo({ ...base, lineas: una })).w, 612, "carta por defecto");
});
Deno.test("PDF: simulado y de pruebas se rotulan; el oficial exige datos del certificador y rechaza autorizaciones simuladas", () => {
  for (const formato of ["carta", "ticket"] as const) {
    const s = caja(pdfDemo({ ...base, lineas: una, formato, serie: "SIM", numero: "7", autorizacion: "SIM-ABC-123", estado: "Certificado en SIMULACIÓN" })).t; assert.match(s, /SIN VALOR FISCAL/); assert.match(s, /Autorizaci\\363n simulada: SIM-ABC-123/);
    const p = caja(pdfDemo({ ...base, lineas: una, formato, modo: "prueba", serie: "A", numero: "9", autorizacion: "AAAA-BBBB" })).t; assert.match(p, /PRUEBAS/); assert.match(p, /SIN VALOR FISCAL/); assert.doesNotMatch(p, /simulada/);
    const sinDatos = { ...base, lineas: una, formato, modo: "oficial" as const };
    assert.throws(() => pdfDemo(sinDatos), /necesita serie, número, autorización e importes/); assert.throws(() => pdfDemo({ ...sinDatos, serie: "S", numero: "1", autorizacion: "SIM-X", total: "10" }), /simulada \(SIM-\) nunca/);
    const o = caja(pdfDemo({ ...sinDatos, serie: "S", numero: "1", autorizacion: "REAL-1", total: "17.64", impuestos: "1.89" })).t; assert.doesNotMatch(o, /NO FISCAL|SIN VALOR FISCAL|DEMOSTRA/); assert.match(o, /REAL-1/);
  }
});
