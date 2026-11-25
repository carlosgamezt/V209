// Tipos de documento que la base permite certificar en Digifact TEST (migración 31, si está aplicada; si no, la lista queda vacía y solo FACT certifica).
// Es un dato de ESQUEMA (cambia solo al aplicar una migración), así que se reutiliza 60 s por base: antes se leía con dos consultas en cada vista de tipos y en cada preparación/certificación (cada una = un viaje a la base remota).
import type { BdDemo } from "./bd.ts";
const cache = new WeakMap<object, { hasta: number; p: Promise<string[]> }>();
export function tiposCertificablesTest(bd: BdDemo): Promise<string[]> {
  const t = Date.now(), c = cache.get(bd); if (c && c.hasta > t) return c.p;
  const p = (async () => {
    try {
      const [f] = await bd.filas<{ ok: boolean }>("select to_regprocedure('public.fel_tipos_certificacion_test()') is not null as ok"); if (!f?.ok) return [];
      const [x] = await bd.filas<{ t: string[] }>("select public.fel_tipos_certificacion_test() as t"); return x?.t ?? [];
    } catch { return []; }
  })();
  cache.set(bd, { hasta: t + 60_000, p }); return p;
}
