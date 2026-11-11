// Puerto hacia la base de datos: cada función SQL «fel_op_*» / «fel_sys_*» se invoca por nombre. Cada llamada es UNA transacción confirmada.
// Implementaciones: PostgreSQL directo (pruebas locales y trabajos del sistema; ver repo_pg.ts) y, más adelante, supabase-js `.rpc` en la Edge Function.
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** Error de la base de datos con su código «FEL_XXXX» (prefijo del mensaje de las funciones). */
export class ErrorBd extends Error {
  readonly codigo: string;
  constructor(mensaje: string, readonly sqlstate?: string) {
    super(mensaje); this.name = "ErrorBd";
    this.codigo = /^(FEL_[A-Z_]+)/.exec(mensaje)?.[1] ?? (sqlstate ? `SQL_${sqlstate}` : "BD");
  }
}
