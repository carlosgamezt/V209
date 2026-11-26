// Resumen de los ESTABLECIMIENTOS que aparecen en el reporte de acuses de Digifact TEST (SOLO LECTURA): código, nombre, cantidad, estados y UNA autorización de ejemplo por establecimiento
// (sirve de fuente para «datos-emisor»). No incluye datos de compradores, importes ni credenciales.
import type { FilaAcuse } from "./digifact_gt.ts";
export interface ResumenEstablecimiento { codigo: string; nombre: string; filas: number; aceptadas: number; tipos: string[]; estados: string[]; autorizacionEjemplo: string | null; tipoEjemplo: string | null }
export function agruparEstablecimientos(filas: FilaAcuse[]): ResumenEstablecimiento[] {
  const m = new Map<string, ResumenEstablecimiento & { _t: Set<string>; _e: Set<string> }>();
  for (const f of filas) {
    const k = String(f.establecimiento ?? "").trim(); if (!k) continue;
    const r = m.get(k) ?? { codigo: k, nombre: "", filas: 0, aceptadas: 0, tipos: [], estados: [], autorizacionEjemplo: null, tipoEjemplo: null, _t: new Set<string>(), _e: new Set<string>() };
    r.filas++; if (f.nombreEstablecimiento && !r.nombre) r.nombre = f.nombreEstablecimiento; r._t.add(f.tipoDte); r._e.add(f.estadoAcuse);
    if (f.estadoAcuse === "ACEPTADO_SAT") { r.aceptadas++; if (!r.autorizacionEjemplo && f.autorizacion) { r.autorizacionEjemplo = f.autorizacion; r.tipoEjemplo = f.tipoDte; } }
    m.set(k, r);
  }
  return [...m.values()].map(({ _t, _e, ...r }) => ({ ...r, tipos: [..._t].sort(), estados: [..._e].sort() })).sort((a, b) => Number(a.codigo) - Number(b.codigo) || a.codigo.localeCompare(b.codigo));
}
