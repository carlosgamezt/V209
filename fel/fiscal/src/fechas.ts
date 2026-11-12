// REGLA DE FECHAS RCP301 (catalogoMensajes-0.3.0): la fecha de emisión no puede ser posterior al último día del mes de la fecha de certificación. Se evalúa en hora de Guatemala (UTC−06:00).
// NO se implementa el plazo de emisión de INF300 (el texto oficial dice «tres» y «cinco» días en el mismo mensaje: discrepancia documentada, V-fechas pendiente).
import { analizarFechaHora } from "./estructura.ts";
import type { Violacion } from "./modelo.ts";

const GT_MIN = -360;
function instante(t: string, zonaPorDefectoMin: number): number | null {
  const f = analizarFechaHora(t); if (!f) return null;
  let off = zonaPorDefectoMin; if (f.zona === "Z") off = 0; else if (f.zona) { const s = f.zona[0] === "-" ? -1 : 1, [h, m] = f.zona.slice(1).split(":").map(Number); off = s * (h * 60 + m); }
  return Date.UTC(f.a, f.m - 1, f.d, f.hh, f.mm, f.ss) - off * 60000;
}
/** Año y mes en hora de Guatemala de un instante. */
const mesGt = (ms: number) => { const d = new Date(ms + GT_MIN * 60000); return { a: d.getUTCFullYear(), m: d.getUTCMonth() }; };

export function validarFechaCertificacion(fechaEmision: string, fechaCertificacion: string): Violacion[] {
  const e = instante(fechaEmision, GT_MIN), c = instante(fechaCertificacion, GT_MIN);
  if (e === null || c === null) return [{ regla: "FEC-MES-CERTIFICACION", severidad: "error", ruta: "FechaHoraEmision", mensaje: "Fecha de emisión o de certificación no válida" }];
  const { a, m } = mesGt(c), finDelMes = Date.UTC(a, m + 1, 1) - GT_MIN * 60000; // primer instante del mes siguiente (hora GT)
  if (e >= finDelMes) return [{ regla: "FEC-MES-CERTIFICACION", severidad: "error", ruta: "DatosGenerales/FechaHoraEmision", mensaje: "La fecha de emisión es posterior al último día del mes de la fecha de certificación", encontrado: fechaEmision, esperado: `≤ último día de ${a}-${String(m + 1).padStart(2, "0")}` }];
  return [];
}
