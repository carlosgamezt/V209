import type { Contexto, DocumentoCongelado } from "../src/tipos.ts";
export const CTX: Contexto = { ambiente: "simulado", ahora: () => new Date("2026-01-01T12:00:00Z") };
/** Documento FICTICIO (datos inventados; nada real). */
export function documento(id: string, cambios: Partial<DocumentoCongelado> = {}): DocumentoCongelado {
  return {
    id, empresaId: "empresa-prueba-1", establecimientoId: "est-1", tipoDte: "SIM", moneda: "GTQ", fechaEmision: "2026-01-01",
    receptor: { tipoId: "CF", id: "CF", nombre: "RECEPTOR DE PRUEBA" },
    lineas: [{ tipo: "Servicio", descripcion: "SERVICIO DE PRUEBA - NO EMITIR", cantidad: "2", precioUnitario: "125.50", descuento: "0" }],
    total: "251.000000", ...cambios,
  };
}
export const clave = (n: number | string) => `clave-de-prueba-${String(n).padStart(6, "0")}`;
/** PRNG determinista (mulberry32) para las pruebas de propiedades. */
export function prng(semilla: number) { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
