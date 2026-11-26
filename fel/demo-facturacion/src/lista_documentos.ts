// Historial de documentos con PAGINACIÓN Y FILTROS EN EL SERVIDOR: la pantalla pide solo una página (25 por omisión) en vez de todos los documentos.
// Solo lectura, siempre acotado a la empresa del que pregunta; todos los valores viajan como parámetros (nunca concatenados).
import { leerLote } from "./lote.ts";
import type { BdDemo } from "./bd.ts";

export const TAM_POR_OMISION = 25, TAM_MAXIMO = 100;
export type Categoria = "todos" | "emitidos" | "borradores" | "anulados" | "pendientes";
export interface FiltrosLista { categoria: Categoria; q: string; tipo: string; estado: string; desde: string; hasta: string; nit: string; pagina: number; tam: number; /** Alcance de establecimientos de la persona (solo si está restringida): el filtro se aplica en SQL. */ establecimientos?: string[] }

const CATEGORIAS: Categoria[] = ["todos", "emitidos", "borradores", "anulados", "pendientes"];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS_FISCALES = ["ninguno", "pendiente_certificacion", "por_verificar", "certificado", "rechazado", "anulacion_solicitada", "anulado"];
const ESTADOS_PREPARACION = ["borrador", "revisado"];
// Emitidos = certificados; borradores = sin vida fiscal; anulados = anulados. «Pendientes» (certificar, conciliar, verificar, anulación solicitada, rechazados o con alerta abierta)
// se ofrece aparte para que nunca queden ocultos; puede solaparse con las otras categorías (un certificado con alerta abierta está en ambas).
const CAT_SQL: Record<Exclude<Categoria, "todos">, string> = {
  emitidos: "d.estado_fiscal = 'certificado'",
  borradores: "d.estado_fiscal = 'ninguno'",
  anulados: "d.estado_fiscal = 'anulado'",
  pendientes: "(d.estado_fiscal in ('pendiente_certificacion','por_verificar','anulacion_solicitada','rechazado') or exists (select 1 from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null))",
};

/** Lee y SANEA los parámetros de la URL; lo inválido se ignora o se acota (nunca provoca error ni SQL). */
export function leerFiltros(p: URLSearchParams): FiltrosLista {
  const cat = (p.get("categoria") ?? "todos") as Categoria;
  const entero = (v: string | null, def: number) => { if (v === null || v.trim() === "") return def; const n = Number(v); return Number.isInteger(n) ? n : def; };
  const fecha = (v: string | null) => (v && RE_FECHA.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");
  const estado = p.get("estado") ?? "";
  return {
    categoria: CATEGORIAS.includes(cat) ? cat : "todos",
    q: (p.get("q") ?? "").trim().slice(0, 60),
    tipo: /^[A-Z]{4}$/.test(p.get("tipo") ?? "") ? p.get("tipo")! : "",
    estado: ESTADOS_FISCALES.includes(estado) || ESTADOS_PREPARACION.includes(estado) ? estado : "",
    desde: fecha(p.get("desde")), hasta: fecha(p.get("hasta")),
    nit: (p.get("nit") ?? "").trim().toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, 30),
    pagina: Math.max(1, Math.min(entero(p.get("pagina"), 1), 100000)),
    tam: Math.max(1, Math.min(entero(p.get("tam"), TAM_POR_OMISION), TAM_MAXIMO)),
  };
}

const escapar = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

function donde(f: FiltrosLista, empresa: string, conTipos: boolean, conCategoria: boolean): { sql: string; args: unknown[] } {
  const args: unknown[] = [empresa]; const w = ["d.empresa_id = $1"]; const add = (v: unknown) => { args.push(v); return `$${args.length}`; };
  if (conCategoria && f.categoria !== "todos") w.push(CAT_SQL[f.categoria]);
  if (f.establecimientos) w.push(`d.establecimiento_id = any(${add(f.establecimientos)}::uuid[])`);
  if (f.tipo && conTipos) w.push(`d.tipo_dte = ${add(f.tipo)}`); else if (f.tipo && f.tipo !== "FACT") w.push("false");   // sin la migración 30 todo es FACT
  if (f.estado) w.push(ESTADOS_PREPARACION.includes(f.estado) ? `(d.estado_preparacion = ${add(f.estado)} and d.estado_fiscal = 'ninguno')` : `d.estado_fiscal = ${add(f.estado)}`);
  if (f.desde) w.push(`d.fecha_emision_prevista >= ${add(f.desde)}::date`);
  if (f.hasta) w.push(`d.fecha_emision_prevista <= ${add(f.hasta)}::date`);
  if (f.nit) w.push(`c.numero_identificacion like ${add(escapar(f.nit) + "%")}`);
  if (f.q) {
    const br = /^BR-?0*(\d{1,9})$/i.exec(f.q); const like = add("%" + escapar(f.q.toLowerCase()) + "%");
    const partes = [`lower(c.nombre) like ${like}`, `lower(coalesce(d.serie, '')) like ${like}`, `lower(coalesce(d.numero_fiscal, '')) like ${like}`, `lower(coalesce(d.autorizacion_sat, '')) like ${like}`];
    if (br) partes.push(`d.numero_borrador = ${add(Number(br[1]))}`);
    w.push("(" + partes.join(" or ") + ")");
  }
  return { sql: w.join(" and "), args };
}

const JOINS = "from public.documentos d left join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id";

export async function listarDocumentos(bd: BdDemo, empresa: string, f: FiltrosLista, conTipos: boolean) {
  const w = donde(f, empresa, conTipos, true), wc = donde(f, empresa, conTipos, false);
  // las tres lecturas (total, conteos por categoría y la página pedida) salen en UN solo viaje a la base; solo si la página pedida no existe (más allá de la última) se vuelve a leer la última
  const itemsSql = `select d.id, d.numero_borrador, ${conTipos ? "d.tipo_dte, d.documento_origen_id, d.referencia_origen->>'serie' as origen_serie, d.referencia_origen->>'numero' as origen_numero, " : ""}d.estado_preparacion, d.estado_fiscal, d.fecha_emision_prevista, d.base_imponible::text as base_imponible, d.total::text as total, d.serie, d.numero_fiscal, d.autorizacion_sat, d.version, d.actualizado_en, c.nombre as cliente_nombre, c.numero_identificacion as cliente_nit, e.nombre as establecimiento_nombre, (select count(*)::int from public.alertas_fiscales a where a.documento_id = d.id and a.resuelta_en is null) as alertas, uo.proveedor as canal_id, pe.nombre as canal_nombre, uo.ambiente as canal_ambiente, uo.estado as operacion_estado ${JOINS} left join lateral (select o.proveedor, o.ambiente, o.estado from public.operaciones_fiscales o where o.documento_id = d.id and o.tipo = 'certificacion' order by o.iniciada_en desc, o.id desc limit 1) uo on true left join public.proveedores_emision pe on pe.id = uo.proveedor left join public.establecimientos e on e.id = d.establecimiento_id and e.empresa_id = d.empresa_id where ${w.sql} order by d.numero_borrador desc limit $${w.args.length + 1} offset $${w.args.length + 2}`;
  const argsDe = (pg: number) => [...w.args, f.tam, (pg - 1) * f.tam];
  const [[tot0], [cuentas0], items0] = await leerLote(bd, [[`select count(*)::int as n ${JOINS} where ${w.sql}`, w.args], [`select count(*) filter (where ${CAT_SQL.emitidos})::int as emitidos, count(*) filter (where ${CAT_SQL.borradores})::int as borradores, count(*) filter (where ${CAT_SQL.anulados})::int as anulados, count(*) filter (where ${CAT_SQL.pendientes})::int as pendientes ${JOINS} where ${wc.sql}`, wc.args], [itemsSql, argsDe(f.pagina)]]) as [{ n: number }[], Record<string, number>[], Record<string, unknown>[]];
  const tot = tot0, cuentas = cuentas0;
  const paginas = Math.max(1, Math.ceil(tot.n / f.tam)), pagina = Math.min(f.pagina, paginas);
  const items = pagina === f.pagina ? items0 : await bd.filas(itemsSql, argsDe(pagina));
  return { items, total: tot.n, pagina, paginas, tam: f.tam, conteos: { emitidos: cuentas.emitidos, borradores: cuentas.borradores, anulados: cuentas.anulados, pendientes: cuentas.pendientes } };
}
