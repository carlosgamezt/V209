// Métricas del plano de control: contadores por agente y hora, en memoria, que se vuelcan a la base por lotes (una escritura por lote, nunca por petición).
// Solo cuentan peticiones, estados y códigos de error: ni contenido, ni claves, ni datos de facturas. Sirven para estimar los costos reales (invocaciones) con datos.
import type { Rpc } from "./rpc.ts";

export interface Metricas {
  /** Cuenta `n` ocurrencias de `clave` para el agente (o «-» si aún no se sabe quién es). */
  sumar(agente: string | undefined, clave: string, n?: number): void;
  /** Vuelca a la base lo acumulado; ante un fallo conserva los contadores para el siguiente intento. Devuelve cuántas entradas se escribieron. */
  vaciar(): Promise<number>;
  pendientes(): number;
}
const RE_CLAVE = /^[a-z_]+(:[A-Za-z0-9_.-]{1,40}){0,2}$/;
export function crearMetricas(o: { rpc: Rpc; ahora?: () => Date }): Metricas {
  const ahora = o.ahora ?? (() => new Date());
  let acum = new Map<string, number>();            // «hora|agente|clave» → n
  return {
    sumar(agente, clave, n = 1) {
      if (!agente || !RE_CLAVE.test(clave) || clave.length > 80 || !Number.isSafeInteger(n) || n < 1) return;   // sin agente identificado no se guarda (la base exige agente y empresa)
      const k = `${ahora().toISOString().slice(0, 13)}:00:00Z|${agente}|${clave}`; acum.set(k, (acum.get(k) ?? 0) + n);
    },
    pendientes: () => acum.size,
    async vaciar() {
      if (acum.size === 0) return 0;
      const lote = acum; acum = new Map();
      const datos = [...lote].map(([k, n]) => { const [hora, agente, clave] = k.split("|"); return { hora, agente, clave, n }; });
      try { return Number(await o.rpc("fel_sys_agente_metricas_guardar", { p_datos: datos })); }
      catch { for (const [k, n] of lote) acum.set(k, (acum.get(k) ?? 0) + n); return 0; }   // no se pierden: se reintentan
    },
  };
}
