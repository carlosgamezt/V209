// Base de datos de la DEMOSTRACIÓN: PostgreSQL real (PGlite, WebAssembly) en memoria con las MISMAS migraciones que el proyecto.
// Nada se guarda en disco ni sale a la red. Al reiniciar el servidor vuelve a los datos de ejemplo.
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { ErrorBd, type Rpc } from "../../proveedores/src/rpc.ts";
import { conectarPgUrl, valorPg } from "../../proveedores/src/repo_pg.ts";
import { creadorSql, type CreadorUsuarios } from "./usuarios_auth.ts";

export const LISTAS = new Set(["fel_sys_operaciones_pendientes", "fel_sys_fallidas_manuales_recientes", "fel_sys_artefactos_faltantes", "fel_sys_ordenes_para_cerrar", "fel_op_agentes_listar", "fel_op_miembros_listar"]);

export interface BdDemo {
  tipo: "pglite" | "pg"; rpc: Rpc; filas: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Ejecuta una sentencia sin devolver filas. */ ejecutar: (sql: string, params?: unknown[]) => Promise<void>; cerrar: () => Promise<void>;
  /** Solo PostgreSQL real: ejecuta `fn` dentro de una transacción (con una conexión propia). */
  transaccion?: <T>(fn: (tx: { filas: BdDemo["filas"]; ejecutar: BdDemo["ejecutar"] }) => Promise<T>) => Promise<T>;
  /** Alta de un usuario en Supabase Auth (en local, fila en auth.users; en un proyecto hospedado, la API de administración). */
  crearUsuario: (id: string, email: string) => Promise<void>;
  db?: PGlite;   // solo en modo memoria
}

/** Base REAL (p. ej. Supabase/PostgreSQL): el esquema lo aplican las migraciones del proyecto; aquí solo se conecta. Los datos persisten entre reinicios. */
export function crearBdPg(url: string, o: { usuarios?: CreadorUsuarios } = {}): BdDemo {
  const c = conectarPgUrl(url, LISTAS);
  const ejecutarSql = async (sql: string, params: unknown[] = []) => { await c.sql.unsafe(sql, params.map((v) => valorPg(c.sql, v))); };
  return { tipo: "pg", crearUsuario: (id, email) => (o.usuarios ?? creadorSql(ejecutarSql)).crear(id, email), rpc: c.rpc, filas: async <T,>(sql: string, params: unknown[] = []) => [...await c.sql.unsafe(sql, params.map((v) => valorPg(c.sql, v)))] as unknown as T[],
    ejecutar: async (sql: string, params: unknown[] = []) => { await c.sql.unsafe(sql, params.map((v) => valorPg(c.sql, v))); }, cerrar: () => c.cerrar(),
    // deno-lint-ignore no-explicit-any
    transaccion: <T,>(fn: (tx: any) => Promise<T>) => c.sql.begin(async (q) => await fn({ filas: async (sql: string, params: unknown[] = []) => [...await q.unsafe(sql, params.map((v) => valorPg(c.sql, v)) as never)], ejecutar: async (sql: string, params: unknown[] = []) => { await q.unsafe(sql, params.map((v) => valorPg(c.sql, v)) as never); } })) as Promise<T> };
}

