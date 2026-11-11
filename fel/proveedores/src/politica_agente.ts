// Política de versiones del agente: codificación numérica (para guardarla como parámetro) y comparación. Una versión ilegible cuenta como 0.0.0 (= bloqueada si hay mínimo).
export const RE_VERSION = /^(\d{1,4})\.(\d{1,3})\.(\d{1,3})(?:[-+][0-9A-Za-z.-]{1,20})?$/;
export function codificarVersion(v: unknown): number {
  const m = typeof v === "string" ? RE_VERSION.exec(v) : null;
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : 0;
}
export const decodificarVersion = (n: number): string => `${Math.floor(n / 1_000_000)}.${Math.floor((n % 1_000_000) / 1_000)}.${n % 1_000}`;
/** ¿La versión del agente está por debajo del mínimo? (mínimo 0 ⇒ nunca). */
export const versionBloqueada = (version: unknown, minima: number): boolean => minima > 0 && codificarVersion(version) < minima;
export const SONDEO_MIN_MS = 1000, SONDEO_MAX_MS = 120_000;
export const acotarSondeo = (ms: unknown): number => { const n = typeof ms === "number" && Number.isFinite(ms) ? ms : 15_000; return Math.min(SONDEO_MAX_MS, Math.max(SONDEO_MIN_MS, Math.round(n))); };
