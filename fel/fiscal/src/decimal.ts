// ARITMÉTICA DECIMAL EXACTA para importes: números racionales con enteros de precisión arbitraria (bigint). Nunca se usa `number` (coma flotante) para importes: los valores entran y salen
// como TEXTO decimal. No existe ningún redondeo en este módulo: cualquier política de redondeo debe venir de una fuente verificada (punto V2) y no está implementada en D1-A.
import { ErrorFiscal } from "./error.ts";

const mcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
/** Forma léxica de xs:decimal (la que usa el XSD): signo opcional, dígitos con punto opcional; sin exponente, sin separadores, sin «NaN». */
const RE_DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/;
export const MAX_LARGO_DECIMAL = 100;

export class Racional {
  readonly n: bigint; readonly d: bigint;
  private constructor(n: bigint, d: bigint) {
    if (d === 0n) throw new ErrorFiscal("DIVISION_POR_CERO", "División por cero");
    if (d < 0n) { n = -n; d = -d; }
    const g = mcd(n, d) || 1n; this.n = n / g; this.d = d / g;
  }
  static de(n: bigint, d: bigint = 1n): Racional { return new Racional(n, d); }
  /** Convierte un texto decimal (xs:decimal) en un racional EXACTO. Rechaza todo lo que no sea una cadena decimal (números JS, exponentes, vacíos, textos no numéricos). */
  static desdeTexto(t: unknown): Racional {
    if (typeof t !== "string") throw new ErrorFiscal("DECIMAL_NO_ES_TEXTO", "Los importes deben ser texto decimal, nunca números de coma flotante");
    if (t.length === 0 || t.length > MAX_LARGO_DECIMAL) throw new ErrorFiscal("DECIMAL_INVALIDO", "Texto decimal vacío o demasiado largo");
    const m = RE_DECIMAL.exec(t); if (!m) throw new ErrorFiscal("DECIMAL_INVALIDO", "Texto decimal no válido");
    const entera = m[2] ?? "0", frac = m[3] ?? m[4] ?? "", signo = m[1] === "-" ? -1n : 1n;
    return new Racional(signo * BigInt(entera + frac), 10n ** BigInt(frac.length));
  }
  static readonly CERO = new Racional(0n, 1n);
  static readonly UNO = new Racional(1n, 1n);
  sumar(o: Racional): Racional { return new Racional(this.n * o.d + o.n * this.d, this.d * o.d); }
  restar(o: Racional): Racional { return new Racional(this.n * o.d - o.n * this.d, this.d * o.d); }
  multiplicar(o: Racional): Racional { return new Racional(this.n * o.n, this.d * o.d); }
  dividir(o: Racional): Racional { if (o.n === 0n) throw new ErrorFiscal("DIVISION_POR_CERO", "División por cero"); return new Racional(this.n * o.d, this.d * o.n); }
  negar(): Racional { return new Racional(-this.n, this.d); }
  abs(): Racional { return this.n < 0n ? this.negar() : this; }
  comparar(o: Racional): -1 | 0 | 1 { const a = this.n * o.d, b = o.n * this.d; return a < b ? -1 : a > b ? 1 : 0; }
  igual(o: Racional): boolean { return this.comparar(o) === 0; }
  menorOIgual(o: Racional): boolean { return this.comparar(o) <= 0; }
  mayor(o: Racional): boolean { return this.comparar(o) > 0; }
  esCero(): boolean { return this.n === 0n; }
  esNegativo(): boolean { return this.n < 0n; }
  /** ¿Tiene expansión decimal finita? (el denominador solo tiene los factores 2 y 5) */
  tieneExpansionFinita(): boolean { let d = this.d; while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n; return d === 1n; }
  /** Texto EXACTO: decimal si la expansión es finita; si no, la fracción «n/d». Nunca redondea. */
  aTextoExacto(): string {
    if (!this.tieneExpansionFinita()) return `${this.n}/${this.d}`;
    let a = 0n, b = 0n, d = this.d; while (d % 2n === 0n) { d /= 2n; a++; } while (d % 5n === 0n) { d /= 5n; b++; }
    const escala = a > b ? a : b, num = (this.n < 0n ? -this.n : this.n) * (10n ** escala / this.d);
    const s = num.toString().padStart(Number(escala) + 1, "0"), ent = s.slice(0, s.length - Number(escala)), frac = s.slice(s.length - Number(escala)).replace(/0+$/, "");
    return `${this.n < 0n ? "-" : ""}${ent}${frac ? "." + frac : ""}`;
  }
  static suma(xs: Iterable<Racional>): Racional { let r = Racional.CERO; for (const x of xs) r = r.sumar(x); return r; }
}

/** Dígitos de un xs:decimal en forma canónica: [enteros significativos, decimales sin ceros finales] (para los límites totalDigits / fractionDigits del XSD). */
export function digitosDecimal(t: string): { enteros: number; decimales: number; total: number } | null {
  const m = RE_DECIMAL.exec(t); if (!m) return null;
  const ent = (m[2] ?? "0").replace(/^0+/, ""), frac = (m[3] ?? m[4] ?? "").replace(/0+$/, "");
  return { enteros: ent.length, decimales: frac.length, total: Math.max(1, ent.length + frac.length) };
}
export const esTextoDecimal = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length <= MAX_LARGO_DECIMAL && RE_DECIMAL.test(t);
