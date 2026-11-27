// CERROJO DE ACCESO DIRECTO A TABLAS (cierre de R3). Un servicio o una ruta que atiende a una persona no debe leer ni escribir tablas de datos de empresa con SQL propio: lo hace por funciones (RPC con identidad verificada o `fel_sys_*` del nivel sistema).
// `acotarFilas` envuelve la función de consultas y RECHAZA, antes de enviarla a la base, toda sentencia que nombre una tabla de `public` fuera de la lista cerrada que se le entrega. Así la garantía no depende de revisar el código a mano:
// una consulta nueva sobre `documentos` o `clientes` falla en las pruebas y en ejecución con un error claro. Es una defensa en profundidad del servidor; la defensa real sigue siendo la base (privilegios, RLS y funciones).
export class ErrorAccesoDirecto extends Error { constructor(readonly tablas: string[], etiqueta: string) { super(`FEL_NO_AUTORIZADO: acceso directo a datos no permitido en ${etiqueta}: ${tablas.join(", ")}`); this.name = "ErrorAccesoDirecto"; } }

/** Tablas que una sentencia SQL nombra en `from`, `join`, `into`, `update` o `delete from` (solo esquema `public` o sin esquema; no cuenta funciones, subconsultas, catálogos del sistema ni literales). */
export function tablasDe(sql: string): string[] {
  const limpio = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, "").replace(/\bfor\s+update(?:\s+of\s+[a-z_0-9, ]+)?(?:\s+skip\s+locked|\s+nowait)?/gi, " ").replace(/\bdo\s+update\b/gi, " ").replace(/\bis\s+(?:not\s+)?distinct\s+from\b/gi, " ");
  const t = new Set<string>();
  for (const m of limpio.matchAll(/\b(?:from|join|into|update)\s+(?:only\s+)?(?:(\w+)\.)?([a-z_]\w*)(?![\w(.])/gi)) {
    const esquema = (m[1] ?? "public").toLowerCase(), nombre = m[2].toLowerCase();
    if (esquema !== "public" || /^(pg_|select$|lateral$|values$|only$|set$)/.test(nombre)) continue; t.add(nombre);
  }
  return [...t];
}
export type Filas = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export function validarSql(sql: string, permitidas: ReadonlySet<string>, etiqueta: string): void {
  const fuera = tablasDe(sql).filter((x) => !permitidas.has(x)); if (fuera.length) throw new ErrorAccesoDirecto(fuera, etiqueta);
}
export function acotarFilas(filas: Filas, permitidas: ReadonlySet<string>, etiqueta: string): Filas { return (async (sql: string, params?: unknown[]) => { validarSql(sql, permitidas, etiqueta); return await filas(sql, params); }) as Filas; }

/** Tablas PROPIAS de los servicios del sistema (Digifact, correo, límites): lo único que los servicios leen con SQL; todo lo demás, por `fel_sys_*`. */
export const TABLAS_SERVICIO: ReadonlySet<string> = new Set(["digifact_operaciones", "digifact_artefactos", "envios_correo", "demo_limites"]);
/** Catálogos globales sin datos de empresa que una ruta puede leer directamente. */
export const TABLAS_CATALOGO: ReadonlySet<string> = new Set(["regimenes_fiscales", "proveedores_emision", "permisos_catalogo", "rol_permisos", "evento_tipos", "plataforma_parametros"]);
