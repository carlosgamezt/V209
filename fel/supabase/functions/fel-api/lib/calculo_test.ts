import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { aTexto, calcular } from "./calculo.ts";

const L = (cantidad: string, precio_unitario: string, descuento_tipo: "ninguno" | "monto" | "porcentaje" = "ninguno", descuento_valor = "0") =>
  ({ cantidad, precio_unitario, descuento_tipo, descuento_valor });

Deno.test("aritmética exacta: sin errores de coma flotante", () => {
  const r = calcular([L("3", "0.1"), L("0.1", "0.2")]);
  assertEquals(r.lineas[0].bruto, "0.3");   // en coma flotante daría 0.30000000000000004
  assertEquals(r.lineas[1].bruto, "0.02");
  assertEquals(r.subtotal, "0.32");
});

Deno.test("no redondea: conserva todos los decimales", () => {
  const r = calcular([L("1.333333", "1.333333")]);
  assertEquals(r.lineas[0].bruto, "1.777776888889");
  assertEquals(aTexto(0n), "0");
});

Deno.test("descuentos por monto y por porcentaje, exactos", () => {
  const r = calcular([L("2", "10.50", "porcentaje", "10"), L("1", "5", "monto", "1.25")]);
  assertEquals(r.lineas[0].descuento, "2.1");
  assertEquals(r.lineas[0].neto, "18.9");
  assertEquals(r.lineas[1].neto, "3.75");
  assertEquals([r.subtotal, r.descuento_total, r.base_imponible], ["26", "3.35", "22.65"]);
});

Deno.test("no calcula impuestos ni total y se declara no oficial", () => {
  const r = calcular([L("1", "100")]);
  assertEquals(r.meta.oficial, false);
  assertEquals((r.meta.pendiente as string[]).includes("impuestos"), true);
  assertEquals("total" in r, false);
  assertEquals("impuestos" in r, false);
});

Deno.test("rechaza descuentos y cantidades inválidos", () => {
  assertThrows(() => calcular([L("1", "5", "monto", "6")]));
  assertThrows(() => calcular([L("1", "5", "porcentaje", "100.000001")]));
  assertThrows(() => calcular([L("0", "5")]));
  assertThrows(() => calcular([L("1", "-5")]));
  assertThrows(() => calcular([L("1", "5", "otro" as never, "1")]));
});
