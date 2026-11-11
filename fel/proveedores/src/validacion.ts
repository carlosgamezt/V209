// Validación ESTRUCTURAL local. NO contiene reglas fiscales (NIT oficial, tasas, plazos): esas nacen sin verificar y se versionan aparte.
import type { DocumentoCongelado, ErrorValidacion, ResultadoValidacion } from "./tipos.ts";

const ESCALA = 1_000_000n; // seis decimales
/** Decimal en texto → entero escalado; null si no es un decimal sin signo con punto. */
export function aEscalado(t: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(t.trim());
  if (!m) return null;
  return BigInt(m[1]) * ESCALA + BigInt((m[2] ?? "").padEnd(6, "0"));
}
export function deEscalado(n: bigint): string {
  const neg = n < 0n; const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / ESCALA}.${(a % ESCALA).toString().padStart(6, "0")}`;
}
/** Producto cantidad × precio con redondeo hacia abajo a la escala (la regla fiscal de redondeo NO está verificada: se compara en igualdad exacta a seis decimales). */
export function totalLinea(l: { cantidad: string; precioUnitario: string; descuento: string }): bigint | null {
  const c = aEscalado(l.cantidad), p = aEscalado(l.precioUnitario), d = aEscalado(l.descuento);
  if (c === null || p === null || d === null) return null;
  return (c * p) / ESCALA - d;
}

export function validarDocumento(doc: DocumentoCongelado): ResultadoValidacion {
  const e: ErrorValidacion[] = []; const add = (codigo: string, campo: string, mensaje: string) => e.push({ codigo, campo, mensaje });
  if (!doc.id) add("FALTA_ID", "id", "El documento no tiene id");
  if (!doc.empresaId) add("FALTA_EMPRESA", "empresaId", "Falta la empresa");
  if (!doc.establecimientoId) add("FALTA_ESTABLECIMIENTO", "establecimientoId", "Falta el establecimiento");
  if (!doc.tipoDte) add("FALTA_TIPO_DTE", "tipoDte", "Falta el tipo de DTE");
  if (doc.moneda !== "GTQ") add("MONEDA", "moneda", "Solo GTQ");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.fechaEmision) || Number.isNaN(Date.parse(doc.fechaEmision))) add("FECHA", "fechaEmision", "Fecha no válida (AAAA-MM-DD)");
  if (!doc.receptor?.id || !doc.receptor.id.trim()) add("RECEPTOR", "receptor.id", "Falta el identificador del receptor");
  else if (doc.receptor.tipoId === "CF" && doc.receptor.id.trim().toUpperCase() !== "CF") add("RECEPTOR_CF", "receptor.id", "Consumidor final debe ser CF");
  if (!doc.lineas?.length) add("SIN_LINEAS", "lineas", "Debe haber al menos una línea");
  let suma = 0n, sumaValida = true;
  for (const [i, l] of (doc.lineas ?? []).entries()) {
    const c = aEscalado(l.cantidad), p = aEscalado(l.precioUnitario), d = aEscalado(l.descuento);
    if (!l.descripcion?.trim()) add("LINEA_DESCRIPCION", `lineas.${i}.descripcion`, "Falta la descripción");
    if (c === null || c <= 0n) { add("LINEA_CANTIDAD", `lineas.${i}.cantidad`, "Cantidad no válida (mayor que cero)"); sumaValida = false; }
    if (p === null) { add("LINEA_PRECIO", `lineas.${i}.precioUnitario`, "Precio no válido"); sumaValida = false; }
    if (d === null) { add("LINEA_DESCUENTO", `lineas.${i}.descuento`, "Descuento no válido"); sumaValida = false; }
    if (c !== null && p !== null && d !== null) {
      if (d > (c * p) / ESCALA) { add("LINEA_DESCUENTO_MAYOR", `lineas.${i}.descuento`, "El descuento supera el subtotal"); sumaValida = false; }
      else suma += totalLinea(l)!;
    }
  }
  const t = aEscalado(doc.total);
  if (t === null) add("TOTAL", "total", "Total no válido");
  else if (sumaValida && t !== suma) add("TOTAL_NO_COINCIDE", "total", `El total declarado (${doc.total}) no coincide con las líneas (${deEscalado(suma)})`);
  return { ok: e.length === 0, errores: e };
}
