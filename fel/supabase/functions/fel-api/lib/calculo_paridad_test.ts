// El cálculo de la vista previa en la interfaz (JavaScript) y el del servidor (TypeScript) deben dar resultados idénticos.
import { assertEquals } from "jsr:@std/assert@1";
import { calcular as servidor } from "./calculo.ts";
// @ts-ignore: módulo JavaScript de la interfaz, sin tipos
import { calcular as interfaz } from "../../../../app/js/calculo.js";

type L = { cantidad: string; precio_unitario: string; descuento_tipo: "ninguno" | "monto" | "porcentaje"; descuento_valor: string };
const casos: L[][] = [
  [{ cantidad: "3", precio_unitario: "0.1", descuento_tipo: "ninguno", descuento_valor: "0" }],
  [{ cantidad: "1.333333", precio_unitario: "1.333333", descuento_tipo: "ninguno", descuento_valor: "0" }],
  [{ cantidad: "2", precio_unitario: "10.50", descuento_tipo: "porcentaje", descuento_valor: "10" }, { cantidad: "1", precio_unitario: "5", descuento_tipo: "monto", descuento_valor: "1.25" }],
  [{ cantidad: "0.000001", precio_unitario: "999999999999", descuento_tipo: "porcentaje", descuento_valor: "33.333333" }],
  [],
];

Deno.test("paridad interfaz/servidor: mismos importes en todos los casos", () => {
  for (const c of casos) assertEquals(interfaz(c), servidor(c));
});

Deno.test("paridad: ambos rechazan lo mismo", () => {
  const malos: L[][] = [
    [{ cantidad: "0", precio_unitario: "5", descuento_tipo: "ninguno", descuento_valor: "0" }],
    [{ cantidad: "1", precio_unitario: "5", descuento_tipo: "monto", descuento_valor: "6" }],
    [{ cantidad: "1", precio_unitario: "5", descuento_tipo: "porcentaje", descuento_valor: "100.000001" }],
    [{ cantidad: "1", precio_unitario: "-5", descuento_tipo: "ninguno", descuento_valor: "0" }],
  ];
  for (const m of malos) {
    let a = false, b = false;
    try { interfaz(m); } catch { a = true; }
    try { servidor(m); } catch { b = true; }
    assertEquals([a, b], [true, true]);
  }
});
