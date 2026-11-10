// Cálculo de importes de la Fase 1: ARITMÉTICA DECIMAL EXACTA (BigInt), sin redondeo, sin impuestos, sin fórmulas fiscales.
// Es la misma lógica que usa el servidor (fel-api/lib/calculo.ts); una prueba verifica que ambas den idéntico resultado.
// Solo sirve para la VISTA PREVIA NO CERTIFICADA: el servidor recalcula siempre y es quien manda.
const ESC = 20n;
const UNO = 10n ** ESC;

export function aInterno(t) {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(String(t))) throw new Error("Monto no válido");
  const [e, d = ""] = String(t).split(".");
  return BigInt(e) * UNO + BigInt(d.padEnd(Number(ESC), "0"));
}

export function aTexto(n) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const e = a / UNO;
  const d = (a % UNO).toString().padStart(Number(ESC), "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${e}${d ? "." + d : ""}`;
}

const mul = (a, b) => (a * b) / UNO;

export function calcular(lineas) {
  let sub = 0n, desc = 0n;
  const out = [];
  for (const l of lineas) {
    const cant = aInterno(l.cantidad), precio = aInterno(l.precio_unitario);
    if (cant <= 0n) throw new Error("La cantidad debe ser mayor que cero");
    const bruto = mul(cant, precio);
    let d = 0n;
    if (l.descuento_tipo === "monto") d = aInterno(l.descuento_valor);
    else if (l.descuento_tipo === "porcentaje") {
      const pct = aInterno(l.descuento_valor);
      if (pct > 100n * UNO) throw new Error("El porcentaje de descuento no puede superar 100");
      d = (bruto * pct) / (100n * UNO);
    } else if (l.descuento_tipo !== "ninguno") throw new Error("Tipo de descuento no válido");
    if (d > bruto) throw new Error("El descuento no puede superar el importe de la línea");
    out.push({ bruto: aTexto(bruto), descuento: aTexto(d), neto: aTexto(bruto - d) });
    sub += bruto; desc += d;
  }
  return {
    lineas: out, subtotal: aTexto(sub), descuento_total: aTexto(desc), base_imponible: aTexto(sub - desc),
    meta: { motor: "exacto-v1", oficial: false, redondeo: "ninguno",
      pendiente: ["impuestos", "total", "reglas_de_redondeo", "formulas_fiscales"],
      nota: "Vista previa NO certificada. Sin impuestos ni redondeo hasta contar con reglas verificadas." },
  };
}
