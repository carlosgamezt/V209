// Envoltura de BdDemo con el cerrojo de acceso directo (ver proveedores/src/acceso_directo.ts): `filas`, `ejecutar`, `lote` y `transaccion` rechazan SQL que nombre tablas fuera de la lista; `rpc` pasa sin cambios.
import type { BdDemo } from "./bd.ts";
import { validarSql } from "../../proveedores/src/acceso_directo.ts";

export function acotarBd(bd: BdDemo, permitidas: ReadonlySet<string>, etiqueta: string): BdDemo {
  const v = (sql: string) => validarSql(sql, permitidas, etiqueta);
  return { ...bd,
    filas: (async (sql: string, p?: unknown[]) => { v(sql); return await bd.filas(sql, p); }) as BdDemo["filas"],
    ejecutar: async (sql: string, p?: unknown[]) => { v(sql); await bd.ejecutar(sql, p); },
    lote: bd.lote ? async (qs: [string, unknown[]?][]) => { for (const [q] of qs) v(q); return await bd.lote!(qs); } : undefined,
    transaccion: bd.transaccion ? (async (fn: Parameters<NonNullable<BdDemo["transaccion"]>>[0]) => await bd.transaccion!((tx) => fn({ filas: (async (sql: string, p?: unknown[]) => { v(sql); return await tx.filas(sql, p); }) as BdDemo["filas"], ejecutar: async (sql: string, p?: unknown[]) => { v(sql); await tx.ejecutar(sql, p); } }))) as BdDemo["transaccion"] : undefined,
  } as BdDemo;
}
