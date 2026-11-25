// Fecha de emisión de un DTE: UNA sola implementación de la regla, usada por el servidor (API, validación y certificación) y publicada al navegador por la API (el navegador no decide qué día es hoy).
//
// REGLA (investigación del propietario; PENDIENTE de confirmar con el texto oficial vigente de la SAT y de Digifact, incluida su fecha de entrada en vigor y sus excepciones):
//   la fecha de emisión puede ser anterior a la de certificación hasta FECHA_EMISION_MAX_DIAS días calendario; nunca futura. La fecha de CERTIFICACIÓN la asigna el certificador y NO se puede escribir aquí.
// El plazo es una constante ÚNICA: si el texto oficial dijera otra cosa, se cambia en este archivo y todo el flujo lo sigue.
// Todo se calcula en la zona horaria de Guatemala (America/Guatemala, UTC-6 todo el año, sin horario de verano), nunca con UTC.

export const FECHA_EMISION_MAX_DIAS = 5;
export const ZONA_GT = "America/Guatemala";
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha real del calendario (AAAA-MM-DD)? Rechaza 2026-02-31, 2026-13-01, etc. */
export function fechaReal(s: string): boolean {
  if (!FECHA_ISO.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const PARTES = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_GT, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function partes(ahora: Date): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of PARTES.formatToParts(ahora)) if (p.type !== "literal") o[p.type] = p.value;
  return o;
}

/** El día de hoy en Guatemala (AAAA-MM-DD) para el instante dado. A las 20:00 en Guatemala, UTC ya marca el día siguiente: esto NO. */
export function hoyGt(ahora: Date): string { const p = partes(ahora); return `${p.year}-${p.month}-${p.day}`; }
/** La hora local de Guatemala (hh:mm:ss). */
export function horaGt(ahora: Date): string { const p = partes(ahora); return `${p.hour}:${p.minute}:${p.second}`; }

/** Suma (o resta) días calendario a una fecha AAAA-MM-DD; maneja cambios de mes y de año. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10);
}
/** Días calendario entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000); }

export interface VentanaEmision { hoy: string; minima: string; maxDias: number }
/** La ventana de fechas de emisión permitidas AHORA: de «minima» a «hoy», ambas inclusive. */
export function ventanaEmision(ahora: Date, maxDias = FECHA_EMISION_MAX_DIAS): VentanaEmision {
  const hoy = hoyGt(ahora); return { hoy, minima: sumarDias(hoy, -maxDias), maxDias };
}

export type ResultadoFecha =
  | { ok: true; fecha: string; diasAtras: number; mesAnterior: boolean }
  | { ok: false; codigo: "formato" | "inexistente" | "futura" | "antigua"; mensaje: string };

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Valida una fecha de emisión contra el reloj del SERVIDOR. Nunca corrige ni sustituye la fecha: solo la acepta o la rechaza con el motivo. */
export function validarFechaEmision(f: unknown, ahora: Date, maxDias = FECHA_EMISION_MAX_DIAS): ResultadoFecha {
  if (typeof f !== "string" || !FECHA_ISO.test(f)) return { ok: false, codigo: "formato", mensaje: "La fecha de emisión debe tener el formato AAAA-MM-DD." };
  if (!fechaReal(f)) return { ok: false, codigo: "inexistente", mensaje: "La fecha de emisión no existe en el calendario." };
  const v = ventanaEmision(ahora, maxDias);
  if (f > v.hoy) return { ok: false, codigo: "futura", mensaje: `La fecha de emisión no puede ser futura (hoy es ${dmy(v.hoy)} en Guatemala).` };
  if (f < v.minima) return { ok: false, codigo: "antigua", mensaje: `La fecha de emisión no puede ser anterior al ${dmy(v.minima)}: se admiten hasta ${maxDias} días calendario atrás (hoy es ${dmy(v.hoy)}).` };
  return { ok: true, fecha: f, diasAtras: diasEntre(f, v.hoy), mesAnterior: f.slice(0, 7) !== v.hoy.slice(0, 7) };
}

/** El valor de Header.IssuedDateTime (ISO 8601 con el desfase de Guatemala): la FECHA elegida con la hora local actual de Guatemala. Para hoy es la hora actual (nunca futura); para una fecha anterior, la misma hora del día. */
export function fechaHoraEmisionGt(fecha: string, ahora: Date): string { return `${fecha}T${horaGt(ahora)}-06:00`; }
