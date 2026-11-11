// RPC sobre PostgreSQL directo (driver postgres.js). Para pruebas locales y trabajos del sistema; NO se usa en el navegador.
import postgres from "npm:postgres@3.4.5";
import { ErrorBd, type Rpc } from "./rpc.ts";

export interface ConexionPg { rpc: Rpc; sql: ReturnType<typeof postgres>; cerrar(): Promise<void> }

/** Funciones que devuelven varias filas (conjuntos): se devuelven siempre como lista. */
const DEVUELVEN_LISTA = new Set(["fel_sys_operaciones_pendientes", "fel_sys_fallidas_manuales_recientes", "fel_sys_artefactos_faltantes", "fel_sys_ordenes_para_cerrar", "fel_op_agentes_listar"]);

export function conectarPg(opciones: { host: string; port: number; user: string; password?: string; database: string }): ConexionPg {
  const destino = opciones.host.startsWith("/") ? { path: `${opciones.host}/.s.PGSQL.${opciones.port}` } : { host: opciones.host, port: opciones.port };   // socket de Unix o TCP
  const sql = postgres({ ...destino, username: opciones.user, password: opciones.password, database: opciones.database, max: 12, onnotice: () => {}, idle_timeout: 5, connect_timeout: 10 });
  const rpc: Rpc = async (fn, args) => {
    if (!/^[a-z_0-9]+$/.test(fn)) throw new Error("nombre de función no válido");
    const claves = Object.keys(args);
    if (!claves.every((k) => /^p_[a-z_0-9]+$/.test(k))) throw new Error("nombre de parámetro no válido");
    const consulta = `select * from public.${fn}(${claves.map((k, i) => `${k} := $${i + 1}`).join(", ")})`;
    // deno-lint-ignore no-explicit-any
    const valores: any[] = claves.map((k) => { const v = args[k]; return v instanceof Uint8Array ? v : v !== null && typeof v === "object" ? sql.json(v as never) : v; });
    try {
      const filas = await sql.unsafe(consulta, valores);
      if (DEVUELVEN_LISTA.has(fn)) return [...filas];
      if (filas.length === 0) return null;
      const primera = filas[0] as Record<string, unknown>, columnas = Object.keys(primera);
      return columnas.length === 1 && columnas[0] === fn ? (primera[fn] ?? null) : primera;   // escalar o fila compuesta
    } catch (e) {
      const err = e as { message?: string; code?: string };
      throw new ErrorBd(err.message ?? String(e), err.code);
    }
  };
  return { rpc, sql, cerrar: () => sql.end({ timeout: 5 }) };
}
