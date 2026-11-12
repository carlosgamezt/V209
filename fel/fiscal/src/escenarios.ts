// BLOQUEO DE ESCENARIOS (ESC-BLOQUEO). En D1-A NINGÚN escenario fiscal está aprobado para calcular ni certificar: calcular/certificar LANZA `EscenarioNoAprobado`
// (nunca devuelve un resultado «aparentemente válido»). `evaluarAprobacion` solo explica qué puntos V1–V12 bloquean; su veredicto es siempre «no aprobado».
import { EscenarioNoAprobado } from "./error.ts";
import { PUNTOS_BLOQUEADOS } from "./reglas.ts";

/** Puntos bloqueados que aplican al DTE (los generales V1–V4 siempre). Entrada no confiable: tolera cualquier forma. */
export function evaluarAprobacion(dte: unknown): { aprobado: false; escenario: string; bloqueos: string[] } {
  const b = new Set<string>(["V1", "V2", "V3", "V4"]);
  // deno-lint-ignore no-explicit-any
  const d = (dte ?? {}) as any, tipo = String(d?.DatosGenerales?.Tipo ?? "(desconocido)");
  if (tipo !== "FACT") b.add("V6");
  if (tipo === "NCRE" || tipo === "NDEB") b.add("V9");
  if (d?.DatosGenerales?.Exp === "SI") b.add("V10");
  if (Array.isArray(d?.Frases) && d.Frases.some((f: { TipoFrase?: number }) => f?.TipoFrase === 1 || f?.TipoFrase === 2)) b.add("V8");
  const items = Array.isArray(d?.Items) ? d.Items : [];
  if (items.some((it: { Impuestos?: { NombreCorto?: string }[] }) => Array.isArray(it?.Impuestos) && it.Impuestos.some((i) => i?.NombreCorto !== "IVA"))) b.add("V11");
  const id = String(d?.Receptor?.IDReceptor ?? ""); if (id === "CF" || id === "") b.add("V5"); b.add("V7");
  if (tipo === "NABN" || tipo === "RANT") b.add("V12");
  return { aprobado: false, escenario: tipo, bloqueos: [...b].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))) };
}
function rechazar(operacion: string, dte: unknown): never {
  const a = evaluarAprobacion(dte);
  throw new EscenarioNoAprobado(`${operacion} rechazado: ningún escenario fiscal está aprobado en D1-A (puntos bloqueados: ${a.bloqueos.map((p) => `${p} ${PUNTOS_BLOQUEADOS[p].descripcion}`).join("; ")})`, a.escenario, a.bloqueos);
}
/** Calcular importes de un DTE: NO habilitado en D1-A (V1/V2). Siempre lanza. */
export function calcularDte(dte: unknown, _opciones?: unknown): never { return rechazar("Cálculo", dte); }
/** Certificar un DTE: NO habilitado en D1-A. Siempre lanza. */
export function certificarDte(dte: unknown, _opciones?: unknown): never { return rechazar("Certificación", dte); }
/** Preparar un DTE para certificar (firmar/serializar para el certificador): NO habilitado en D1-A. Siempre lanza. */
export function prepararCertificacionDte(dte: unknown, _opciones?: unknown): never { return rechazar("Preparación para certificación", dte); }
