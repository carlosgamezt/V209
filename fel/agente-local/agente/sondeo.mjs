// SONDEO ADAPTATIVO y espera exponencial con variación aleatoria (para no saturar a NEXA cuando muchos equipos reintentan a la vez).
//  · Con conexión: se obedece la indicación del servidor (`siguiente_ms`), acotada a [1 s, 120 s], con ±20 % de variación para desincronizar a los equipos.
//  · Tras fallos: 1 s · 2^(fallos-1) hasta 60 s, con variación «mitad fija + mitad aleatoria» (nunca por debajo de la mitad del tope), y respetando una pausa mínima del servidor (`retryAfterMs`).
export const SONDEO = { minMs: 1000, maxMs: 120_000, porDefectoMs: 15_000, backoffBaseMs: 1000, backoffMaxMs: 60_000, variacion: 0.2 };
const acotar = (n, a, b) => Math.min(b, Math.max(a, n));

export function esperaAdaptativa({ hintMs, fallosSeguidos = 0, retryAfterMs = 0, aleatorio = Math.random } = {}) {
  if (fallosSeguidos > 0) {
    const tope = Math.min(SONDEO.backoffMaxMs, SONDEO.backoffBaseMs * 2 ** Math.min(fallosSeguidos - 1, 16));
    const espera = tope / 2 + aleatorio() * (tope / 2);
    return Math.round(Math.max(espera, acotar(Number(retryAfterMs) || 0, 0, SONDEO.maxMs)));
  }
  const base = acotar(typeof hintMs === "number" && Number.isFinite(hintMs) ? hintMs : SONDEO.porDefectoMs, SONDEO.minMs, SONDEO.maxMs);
  const f = 1 + (aleatorio() * 2 - 1) * SONDEO.variacion;
  return Math.round(acotar(base * f, SONDEO.minMs, SONDEO.maxMs));
}

/** Contadores del lado del agente (peticiones, errores de red, respuestas no autenticadas, reconexiones). Se informan a NEXA como DELTAS en la siguiente consulta correcta. */
export function crearMetricasCliente() {
  const t = { peticiones: 0, errores_red: 0, no_autenticas: 0, reconexiones: 0 }, enviado = { ...t }; let fallando = false;
  return {
    peticion: () => { t.peticiones++; },
    fallo: (tipo = "errores_red") => { t[tipo]++; fallando = true; },
    exito: () => { if (fallando) { t.reconexiones++; fallando = false; } },
    totales: () => ({ ...t }),
    /** Lo pendiente de informar (solo contadores > 0). `darPorInformado(snap)` lo da por informado. */
    tomar: () => { const d = {}; for (const k of Object.keys(t)) if (t[k] - enviado[k] > 0) d[k] = t[k] - enviado[k]; return d; },
    darPorInformado: (snap) => { for (const [k, v] of Object.entries(snap)) enviado[k] += v; },
    get conectado() { return !fallando; },
  };
}
