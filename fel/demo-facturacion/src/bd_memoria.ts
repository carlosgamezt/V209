// Base de datos en MEMORIA de la demostración local: PostgreSQL real (PGlite, WebAssembly) con las MISMAS migraciones del proyecto. Nada se guarda en disco; al reiniciar vuelve a los datos de ejemplo.
import { creadorSql } from "./usuarios_auth.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { fileURLToPath } from "node:url";
import { ErrorBd, type Rpc } from "../../proveedores/src/rpc.ts";
import { LISTAS, type BdDemo } from "./bd.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));   // carpeta «fel/» (válido también en Windows)

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
  return { tipo: "pglite", crearUsuario: (id, email) => creadorSql(async (sql, params = []) => { await db.query(sql, params); }).crear(id, email), db, rpc, filas: async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows, ejecutar: async (sql: string, params: unknown[] = []) => { await db.query(sql, params); }, cerrar: async () => { try { await db.close(); } catch { /* ya cerrada */ } } };
}
