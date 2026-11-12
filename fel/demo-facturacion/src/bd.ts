// Base de datos de la DEMOSTRACIÓN: PostgreSQL real (PGlite, WebAssembly) en memoria con las MISMAS migraciones que el proyecto.
// Nada se guarda en disco ni sale a la red. Al reiniciar el servidor vuelve a los datos de ejemplo.
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { fileURLToPath } from "node:url";
import { ErrorBd, type Rpc } from "../../proveedores/src/rpc.ts";
import { conectarPgUrl, valorPg } from "../../proveedores/src/repo_pg.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));   // carpeta «fel/» (válido también en Windows)
const LISTAS = new Set(["fel_sys_operaciones_pendientes", "fel_sys_fallidas_manuales_recientes", "fel_sys_artefactos_faltantes", "fel_sys_ordenes_para_cerrar", "fel_op_agentes_listar", "fel_op_miembros_listar"]);

export interface BdDemo {
  tipo: "pglite" | "pg"; rpc: Rpc; filas: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Ejecuta una sentencia sin devolver filas. */ ejecutar: (sql: string, params?: unknown[]) => Promise<void>; cerrar: () => Promise<void>;
  db?: PGlite;   // solo en modo memoria
}

/** Base REAL (p. ej. Supabase/PostgreSQL): el esquema lo aplican las migraciones del proyecto; aquí solo se conecta. Los datos persisten entre reinicios. */
export function crearBdPg(url: string): BdDemo {
  const c = conectarPgUrl(url, LISTAS);
  return { tipo: "pg", rpc: c.rpc, filas: async <T,>(sql: string, params: unknown[] = []) => [...await c.sql.unsafe(sql, params.map((v) => valorPg(c.sql, v)))] as unknown as T[],
    ejecutar: async (sql: string, params: unknown[] = []) => { await c.sql.unsafe(sql, params.map((v) => valorPg(c.sql, v))); }, cerrar: () => c.cerrar() };
}

export async function crearBd(): Promise<BdDemo> {
  const db = new PGlite();
  await db.exec(await Deno.readTextFile(`${RAIZ}tools/shim_supabase.sql`));
  const archivos = [...Deno.readDirSync(`${RAIZ}supabase/migrations`)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of archivos) await db.exec(await Deno.readTextFile(`${RAIZ}supabase/migrations/${f}`));
  const rpc: Rpc = async (fn, args) => {
    if (!/^[a-z_0-9]+$/.test(fn)) throw new Error("nombre de función no válido");
    const claves = Object.keys(args);
    if (!claves.every((k) => /^p_[a-z_0-9]+$/.test(k))) throw new Error("nombre de parámetro no válido");
    try {
      const r = await db.query<Record<string, unknown>>(`select * from public.${fn}(${claves.map((k, i) => `${k} := $${i + 1}`).join(", ")})`, claves.map((k) => args[k]));
      if (LISTAS.has(fn)) return r.rows;
      if (r.rows.length === 0) return null;
      const primera = r.rows[0], columnas = Object.keys(primera);
      return columnas.length === 1 && columnas[0] === fn ? (primera[fn] ?? null) : primera;
    } catch (e) { const x = e as { message?: string; code?: string }; throw new ErrorBd(x.message ?? String(e), x.code); }
  };
  return { tipo: "pglite", db, rpc, filas: async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows, ejecutar: async (sql: string, params: unknown[] = []) => { await db.query(sql, params); }, cerrar: async () => { try { await db.close(); } catch { /* ya cerrada */ } } };
}
