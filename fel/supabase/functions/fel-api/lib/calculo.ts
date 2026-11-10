// Motor de cálculo de la Fase 1.0: ARITMÉTICA DECIMAL EXACTA (BigInt), sin redondeo, sin impuestos y sin fórmulas fiscales.
// Solo calcula bruto, descuento y neto por línea y sus sumas. Impuestos, total y redondeo quedan PENDIENTES hasta que un régimen
// verificado (documentación + contador) los defina. Todo resultado se marca oficial:false: es una vista previa NO certificada.
import { ErrorFel } from "./errores.ts";

const ESC = 20n; // decimales internos: cantidad(6) × precio(6) × porcentaje(6) / 100 cabe sin perder nada
const UNO = 10n ** ESC;

export function aInterno(t: string): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(t)) throw new ErrorFel(400, "Monto no válido", "entrada_invalida");
  const [e, d = ""] = t.split(".");
  return BigInt(e) * UNO + BigInt(d.padEnd(Number(ESC), "0"));
}

export function aTexto(n: bigint): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const e = a / UNO;
  const d = (a % UNO).toString().padStart(Number(ESC), "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${e}${d ? "." + d : ""}`;
}

const mul = (a: bigint, b: bigint) => (a * b) / UNO; // exacto mientras los operandos tengan ≤ 6 decimales (se verifica en la entrada)

export interface LineaEntrada {
  cantidad: string; precio_unitario: string;
  descuento_tipo: "ninguno" | "monto" | "porcentaje"; descuento_valor: string;
}
export interface LineaCalculada { bruto: string; descuento: string; neto: string }
export interface Calculo {
  lineas: LineaCalculada[];
  subtotal: string; descuento_total: string; base_imponible: string;
  meta: Record<string, unknown>;
}

export function calcular(lineas: LineaEntrada[]): Calculo {
  let sub = 0n, desc = 0n;
  const out: LineaCalculada[] = [];
  for (const l of lineas) {
    const cant = aInterno(l.cantidad), precio = aInterno(l.precio_unitario);
    if (cant <= 0n) throw new ErrorFel(400, "La cantidad debe ser mayor que cero", "entrada_invalida");
    const bruto = mul(cant, precio);
    let d = 0n;
    if (l.descuento_tipo === "monto") d = aInterno(l.descuento_valor);
    else if (l.descuento_tipo === "porcentaje") {
      const pct = aInterno(l.descuento_valor);
      if (pct > 100n * UNO) throw new ErrorFel(400, "El porcentaje de descuento no puede superar 100", "entrada_invalida");
      d = (bruto * pct) / (100n * UNO);
      if ((bruto * pct) % (100n * UNO) !== 0n) throw new ErrorFel(500, "Pérdida de precisión en el descuento", "interno");
    } else if (l.descuento_tipo !== "ninguno") throw new ErrorFel(400, "Tipo de descuento no válido", "entrada_invalida");
    if (d > bruto) throw new ErrorFel(400, "El descuento no puede superar el importe de la línea", "entrada_invalida");
    out.push({ bruto: aTexto(bruto), descuento: aTexto(d), neto: aTexto(bruto - d) });
    sub += bruto; desc += d;
  }
  return {
    lineas: out, subtotal: aTexto(sub), descuento_total: aTexto(desc), base_imponible: aTexto(sub - desc),
    meta: {
      motor: "exacto-v1", oficial: false, redondeo: "ninguno",
      pendiente: ["impuestos", "total", "reglas_de_redondeo", "formulas_fiscales"],
      nota: "Vista previa NO certificada. Sin impuestos ni redondeo hasta contar con reglas verificadas.",
    },
  };
}
