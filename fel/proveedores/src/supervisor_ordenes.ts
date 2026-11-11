// SUPERVISOR periódico de órdenes del agente: aplica los vencimientos (antes de presentar ⇒ vuelve a la cola; tras presentar ⇒ incierta y la operación pasa a por_verificar)
// y cierra las órdenes terminadas, SIN depender de que ningún agente haga solicitudes. Intervalo configurable, ciclos sin solapamiento, salud consultable y cierre ordenado.
import type { Rpc } from "./rpc.ts";

export interface SaludSupervisor { ok: boolean; en_marcha: boolean; intervalo_ms: number; ciclos: number; errores_consecutivos: number; vencidas_total: number; ultimo_ciclo_en: string | null; ultimo_error: string | null; atrasado: boolean }
export interface OpcionesSupervisor {
  rpc: Rpc;
  /** Cierre de órdenes terminadas (por ejemplo `() => cerrarOrdenes(rpc, orquestador)`). Opcional. */
  cerrar?: () => Promise<unknown>;
  intervaloMs?: number;
  ahora?: () => Date;
  registrar?: (e: { evento: string; detalle?: string }) => void;
}
export const INTERVALO_MIN_MS = 50, INTERVALO_MAX_MS = 3_600_000, INTERVALO_DEFECTO_MS = 15_000;
export function intervaloDesdeEntorno(valor: string | undefined | null): number {
  if (valor === undefined || valor === null || valor === "") return INTERVALO_DEFECTO_MS;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < INTERVALO_MIN_MS || n > INTERVALO_MAX_MS) throw new Error(`intervalo del supervisor no válido (${INTERVALO_MIN_MS}–${INTERVALO_MAX_MS} ms)`);
  return n;
}

export function crearSupervisor(o: OpcionesSupervisor) {
  const intervalo = o.intervaloMs ?? INTERVALO_DEFECTO_MS, ahora = o.ahora ?? (() => new Date());
  if (!Number.isInteger(intervalo) || intervalo < INTERVALO_MIN_MS || intervalo > INTERVALO_MAX_MS) throw new Error(`intervalo del supervisor no válido (${INTERVALO_MIN_MS}–${INTERVALO_MAX_MS} ms)`);
  let temporizador: ReturnType<typeof setInterval> | undefined, enMarcha = false, ciclo: Promise<void> | null = null, detenido = false;
  const s = { ciclos: 0, errores: 0, vencidas: 0, ultimo: null as Date | null, ultimoError: null as string | null };

  async function unCiclo(): Promise<void> {
    try {
      s.vencidas += Number(await o.rpc("fel_sys_ordenes_vencer", { p_empresa: null }) ?? 0);
      if (o.cerrar) await o.cerrar();
      s.errores = 0; s.ultimoError = null;
    } catch (e) { s.errores++; s.ultimoError = (e as { codigo?: string; name?: string }).codigo ?? (e as Error).name ?? "error"; o.registrar?.({ evento: "error", detalle: s.ultimoError }); }
    s.ciclos++; s.ultimo = ahora();
  }
  const tick = (): Promise<void> => { if (ciclo) return ciclo; ciclo = unCiclo().finally(() => { ciclo = null; }); return ciclo; };   // sin solapamiento

  return {
    /** Ejecuta un ciclo ahora (idempotente y seguro con varios supervisores gracias a SKIP LOCKED en la base). */
    tick,
    iniciar(): void { if (enMarcha || detenido) return; enMarcha = true; o.registrar?.({ evento: "iniciado", detalle: `${intervalo} ms` }); void tick(); temporizador = setInterval(() => { void tick(); }, intervalo); },
    /** Cierre ordenado: no empieza ciclos nuevos y espera (con límite) al que esté en curso. Idempotente. */
    async detener(esperaMaxMs = 5000): Promise<void> {
      if (temporizador !== undefined) clearInterval(temporizador); temporizador = undefined; enMarcha = false; detenido = true;
      if (ciclo) await Promise.race([ciclo, new Promise((r) => setTimeout(r, esperaMaxMs))]);
      o.registrar?.({ evento: "detenido" });
    },
    salud(): SaludSupervisor {
      const atrasado = enMarcha && (s.ultimo === null ? false : ahora().getTime() - s.ultimo.getTime() > intervalo * 3);   // tres intervalos sin ciclo ⇒ algo va mal
      return { ok: enMarcha && s.errores === 0 && !atrasado, en_marcha: enMarcha, intervalo_ms: intervalo, ciclos: s.ciclos, errores_consecutivos: s.errores, vencidas_total: s.vencidas, ultimo_ciclo_en: s.ultimo?.toISOString() ?? null, ultimo_error: s.ultimoError, atrasado };
    },
  };
}
