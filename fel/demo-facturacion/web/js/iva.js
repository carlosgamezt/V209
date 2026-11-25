// IVA 12 % INCLUIDO en el precio, para la vista previa y el PDF local. Es la MISMA política y el mismo redondeo que usa el servidor al armar el documento para Digifact
// (emisor de régimen general: por línea, 6 decimales, mitad hacia arriba; gravable + IVA = total). Es una estimación: el importe definitivo de un documento certificado lo fija el certificador.
const MICRO = 1_000_000n;
const aMicro = (t) => { const [e, d = ""] = String(t).split("."); return BigInt(e || "0") * MICRO + BigInt(d.padEnd(6, "0").slice(0, 6)); };
/** Redondea microquetzales a centavos (mitad hacia arriba) y devuelve «123.45». */
const aCentavos = (m) => { const c = (m + 5_000n) / 10_000n; return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`; };

/** A partir de los netos de cada línea (texto decimal), devuelve { total, iva, gravable } ya redondeados a 2 decimales para mostrar. */
export function ivaIncluido(netos) {
  let total = 0n, iva = 0n;
  for (const n of netos) { const m = aMicro(n); total += m; iva += (m * 12n + 56n) / 112n; }
  return { total: aCentavos(total), iva: aCentavos(iva), gravable: aCentavos(total - iva), ivaMicro: iva, totalMicro: total };
}
