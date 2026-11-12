// Límite de peticiones COMPARTIDO entre instancias: contador por clave y ventana fija en PostgreSQL (tabla demo_limites, migración 0A00). Mismo contrato que LimiteTasa, pero asíncrono.
// Un incremento atómico por petición (insert … on conflict do update): todas las instancias ven el mismo conteo. Si la base no responde, la petición falla (no se abre la puerta por error).
import type { BdDemo } from "./bd.ts";

export class LimiteTasaPg {
  constructor(private bd: BdDemo, private max: number, private ventanaMs: number, private ahora: () => number = () => Date.now()) {}
  async permitir(clave: string): Promise<{ ok: boolean; reintentarEnS: number }> {
    const t = this.ahora(), ventana = Math.floor(t / this.ventanaMs), fin = (ventana + 1) * this.ventanaMs;
    const [f] = await this.bd.filas<{ n: number }>("insert into public.demo_limites (clave, ventana, n, expira) values ($1, $2, 1, $3) on conflict (clave, ventana) do update set n = public.demo_limites.n + 1 returning n", [clave.slice(0, 200), ventana, new Date(fin + 60_000)]);
    if (Math.random() < 0.02) void this.bd.ejecutar("delete from public.demo_limites where expira < now()").catch(() => {});   // purga ocasional de ventanas vencidas
    return Number(f.n) <= this.max ? { ok: true, reintentarEnS: 0 } : { ok: false, reintentarEnS: Math.max(1, Math.ceil((fin - t) / 1000)) };
  }
}
