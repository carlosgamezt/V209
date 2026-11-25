// Medición de tiempos por petición (solo NÚMEROS, nunca datos): cuántas consultas a la base y cuánto tardaron, cuánto esperó cada llamada a Digifact y cuánto duró todo dentro de la función.
// Se devuelve en la cabecera estándar «Server-Timing»; sirve para ubicar con evidencia dónde se va el tiempo (base, Digifact, arranque) sin adivinar. No contiene ni recibe ningún valor del negocio.
import { AsyncLocalStorage } from "node:async_hooks";
import type { BdDemo } from "./bd.ts";

interface Cuenta { dbMs: number; dbN: number; marcas: Record<string, number>; }
const als = new AsyncLocalStorage<Cuenta>();

/** Suma `ms` a la marca `nombre` de la petición en curso (si no hay petición en curso, no hace nada). */
export function marcar(nombre: string, ms: number): void { const c = als.getStore(); if (c) c.marcas[nombre] = (c.marcas[nombre] ?? 0) + ms; }

/** Envuelve la base: cuenta y cronometra cada llamada de nivel superior (una transacción cuenta como una). */
export function envolverBd<T extends BdDemo>(bd: T): T {
  const medir = (v: (...a: unknown[]) => Promise<unknown>, t: unknown) => async (...a: unknown[]) => {
    const c = als.getStore(), t0 = performance.now();
    try { return await v.apply(t, a); } finally { if (c) { c.dbN++; c.dbMs += performance.now() - t0; } }
  };
  return new Proxy(bd, { get(t, k) { const v = (t as unknown as Record<string, unknown>)[k as string]; return ["filas", "ejecutar", "rpc", "transaccion", "lote"].includes(String(k)) && typeof v === "function" ? medir(v as (...a: unknown[]) => Promise<unknown>, t) : v; } });
}

/** `fetch` que cronometra las llamadas a Digifact por tipo (inicio de sesión, envío del documento, otras). No registra direcciones completas, cabeceras ni cuerpos. */
export function fetchMedido(f: typeof fetch = fetch): typeof fetch {
  return (async (entrada: Request | URL | string, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada), t0 = performance.now();
    try { return await f(entrada as never, init); }
    finally { marcar(url.includes("get_token") ? "dfx_token" : url.includes("transform") ? "dfx_envio" : "dfx_otro", performance.now() - t0); }
  }) as typeof fetch;
}

/** Ejecuta la atención de una petición midiendo todo y agrega la cabecera Server-Timing a la respuesta. */
export async function conMedicion(atender: () => Promise<Response>): Promise<Response> {
  const c: Cuenta = { dbMs: 0, dbN: 0, marcas: {} }, t0 = performance.now();
  const r = await als.run(c, atender), total = performance.now() - t0;
  const partes = [`fn;dur=${total.toFixed(0)}`, `db;dur=${c.dbMs.toFixed(0)};desc="${c.dbN} consultas"`, ...Object.entries(c.marcas).map(([k, v]) => `${k};dur=${v.toFixed(0)}`)];
  try { const h = new Headers(r.headers); h.set("server-timing", partes.join(", ")); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); } catch { return r; }
}
