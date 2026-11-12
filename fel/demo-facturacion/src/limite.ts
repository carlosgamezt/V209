// Límite de peticiones por clave (IP) con ventana fija; en memoria (una sola instancia). Responde cuánto esperar.
export class LimiteTasa {
  private m = new Map<string, { n: number; hasta: number }>();
  constructor(private max: number, private ventanaMs: number, private ahora: () => number = () => Date.now()) {}
  permitir(clave: string): { ok: boolean; reintentarEnS: number } {
    const t = this.ahora(); if (this.m.size > 5000) for (const [k, v] of this.m) if (v.hasta <= t) this.m.delete(k);
    const e = this.m.get(clave); if (!e || e.hasta <= t) { this.m.set(clave, { n: 1, hasta: t + this.ventanaMs }); return { ok: true, reintentarEnS: 0 }; }
    e.n++; return e.n <= this.max ? { ok: true, reintentarEnS: 0 } : { ok: false, reintentarEnS: Math.max(1, Math.ceil((e.hasta - t) / 1000)) };
  }
}
