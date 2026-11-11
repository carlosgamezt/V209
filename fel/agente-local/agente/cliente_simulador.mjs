// Cliente de la superficie de CONTROL del simulador (crear sesión, leer estado/vista previa, consultar el libro, interrumpir). No existe ninguna llamada para confirmar:
// la confirmación exige una concesión de NEXA que el agente no tiene (fel/docs/agente-confirmacion-humana.md).
import { exigirBaseLocal } from "./seguridad_red.mjs";

export class ErrorSimulador extends Error { constructor(status, codigo, mensaje) { super(mensaje ?? codigo); this.status = status; this.codigo = codigo; } }

export function crearClienteSimulador({ base, token, empresa, fetchFn = fetch, timeoutMs = 8000 }) {
  const origen = exigirBaseLocal(base, "Simulador");
  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetchFn(origen + ruta, { method: metodo, headers: { "x-control-token": token, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) throw new ErrorSimulador(r.status, j?.error ?? "ERROR", j?.mensaje);
    return j;
  }
  const q = `empresa=${encodeURIComponent(empresa)}`;
  return {
    origen,
    crearSesion: (referencia) => llamar("POST", "/control/sesiones", { empresa, referencia }),
    sesion: (id) => llamar("GET", `/control/sesiones/${id}?${q}`),
    interrumpir: (id) => llamar("POST", `/control/sesiones/${id}/interrumpir?${q}`, {}),
    libro: (referencia) => llamar("GET", `/control/emisiones?${q}&referencia=${encodeURIComponent(referencia)}`),
  };
}
