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
