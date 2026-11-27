// Clientes y conceptos paginados EN EL SERVIDOR (R3): mismos filtros y mismas formas que la RPC `api.clientes_pagina` / `api.conceptos_pagina` (M-U) y que la interfaz; solo lectura, siempre acotado a la empresa; los valores viajan como parámetros.
import type { BdDemo } from "./bd.ts";

/** Por encima de este número de clientes activos, `/api/estado` entrega un conjunto de trabajo y los totales (con menos, todo como siempre). */
export const TOPE_CLIENTES_ESTADO = 500, TOPE_CONCEPTOS_ESTADO = 1000;
const TIPOS_CLIENTE = ["todos", "empresa", "persona", "cf"], TIPOS_CONCEPTO = ["todos", "bien", "servicio"];
const entero = (v: string | null, def: number) => { if (v === null || v.trim() === "") return def; const n = Number(v); return Number.isInteger(n) ? n : def; };
const escapar = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
export interface FiltrosCatalogo { q: string; tipo: string; frecuentes: boolean; inactivos: boolean; pagina: number; tam: number }
/** Lee y SANEA los parámetros de la URL; lo inválido se acota (nunca provoca error ni SQL). */
export function leerFiltrosCatalogo(p: URLSearchParams, tamPorOmision: number, tipos: string[]): FiltrosCatalogo {
  const tipo = p.get("tipo") ?? "todos";
  return { q: (p.get("q") ?? "").trim().slice(0, 60), tipo: tipos.includes(tipo) ? tipo : "todos", frecuentes: p.get("frecuentes") === "1" || p.get("frecuentes") === "true", inactivos: p.get("inactivos") === "1" || p.get("inactivos") === "true",
    pagina: Math.max(1, Math.min(entero(p.get("pagina"), 1), 100000)), tam: Math.max(1, Math.min(entero(p.get("tam"), tamPorOmision), 100)) };
}
export const filtrosClientes = (p: URLSearchParams) => leerFiltrosCatalogo(p, 5, TIPOS_CLIENTE), filtrosConceptos = (p: URLSearchParams) => leerFiltrosCatalogo(p, 50, TIPOS_CONCEPTO);

const WHERE_C = `c.empresa_id = $1 and ($2 or c.activo) and (not $3 or c.frecuente) and ($4::text is null or lower(c.numero_identificacion || ' ' || c.nombre) like $4)
  and case $5::text when 'empresa' then c.tipo_identificacion = 'NIT' when 'persona' then c.tipo_identificacion not in ('NIT', 'CF') when 'cf' then c.tipo_identificacion = 'CF' else true end`;
export async function paginarClientes(bd: BdDemo, empresa: string, f: FiltrosCatalogo) {
  const lk = f.q ? "%" + escapar(f.q.toLowerCase()) + "%" : null, a = [empresa, f.inactivos, f.frecuentes, lk, f.tipo];
  const [[tot], [cont]] = [await bd.filas<{ n: number }>(`select count(*)::int as n from public.clientes c where ${WHERE_C}`, a),
    await bd.filas<Record<string, number>>("select (count(*) filter (where activo))::int as registrados, (count(*) filter (where activo and frecuente))::int as frecuentes, (count(*) filter (where activo and tipo_identificacion = 'NIT'))::int as empresas, (count(*) filter (where activo and tipo_identificacion <> 'NIT'))::int as personas from public.clientes where empresa_id = $1", [empresa])];
  const paginas = Math.max(1, Math.ceil(tot.n / f.tam)), pagina = Math.min(f.pagina, paginas);
  const items = await bd.filas(`select c.id, c.tipo_identificacion, c.numero_identificacion, c.nombre, c.direccion, c.email, c.telefono, c.activo, c.version, c.frecuente, (select count(*)::int from public.documentos d where d.cliente_id = c.id and d.empresa_id = c.empresa_id) as facturas
    from public.clientes c where ${WHERE_C} order by c.nombre limit $6 offset $7`, [...a, f.tam, (pagina - 1) * f.tam]);
  return { items, total: tot.n, pagina, paginas, tam: f.tam, conteos: cont };
}
const WHERE_K = `c.empresa_id = $1 and ($2 or c.activo) and ($3::text = 'todos' or c.tipo = $3) and ($4::text is null or lower(c.codigo || ' ' || c.descripcion) like $4)`;
export async function paginarConceptos(bd: BdDemo, empresa: string, f: FiltrosCatalogo) {
  const lk = f.q ? "%" + escapar(f.q.toLowerCase()) + "%" : null, a = [empresa, f.inactivos, f.tipo, lk];
  const [tot] = await bd.filas<{ n: number }>(`select count(*)::int as n from public.conceptos c where ${WHERE_K}`, a);
  const paginas = Math.max(1, Math.ceil(tot.n / f.tam)), pagina = Math.min(f.pagina, paginas);
  const items = await bd.filas(`select c.id, c.codigo, c.descripcion, c.tipo, c.unidad_medida, c.precio_unitario::text as precio_unitario, c.activo, c.version from public.conceptos c where ${WHERE_K} order by c.descripcion limit $5 offset $6`, [...a, f.tam, (pagina - 1) * f.tam]);
  return { items, total: tot.n, pagina, paginas, tam: f.tam };
}
