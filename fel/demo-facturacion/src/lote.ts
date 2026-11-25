// Lecturas independientes en UN viaje a la base (ver BdDemo.lote). Si el lote no responde en 6 s o falla la conexión, esa base deja de usarlo (cae a consultas una tras otra, que siempre funcionan) para no colgar la petición.
import type { BdDemo } from "./bd.ts";
const deshabilitado = new WeakSet<object>();
const conTiempo = <T>(p: Promise<T>, ms: number) => new Promise<T>((ok, mal) => { const t = setTimeout(() => mal(new Error("lote_sin_respuesta")), ms); p.then((x) => { clearTimeout(t); ok(x); }, (e) => { clearTimeout(t); mal(e); }); });
export async function leerLote(bd: BdDemo, qs: [string, unknown[]?][]): Promise<Record<string, unknown>[][]> {
  if (bd.lote && !deshabilitado.has(bd)) {
    try { return await conTiempo(bd.lote(qs), 6000); }
    catch (e) { const m = String((e as Error)?.message ?? e), c = (e as { code?: string })?.code ?? ""; if (m === "lote_sin_respuesta" || /^(CONNECTION|CONNECT_TIMEOUT|08|57P)/.test(c) || /reserve|connection/i.test(m)) { deshabilitado.add(bd); console.error("lote de consultas deshabilitado en esta instancia:", m.slice(0, 80)); } else throw e; }
  }
  const out: Record<string, unknown>[][] = []; for (const [q, p] of qs) out.push(await bd.filas(q, p ?? [])); return out;
}
