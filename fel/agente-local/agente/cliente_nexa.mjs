// Cliente del PLANO DE CONTROL de NEXA (/api/agente/v1/*). Toda petición va firmada; la empresa la deduce NEXA de la identidad del agente (nunca se envía).
import { cabecerasFirmadas } from "./firma.mjs";
import { exigirBaseLocal } from "./seguridad_red.mjs";

export class ErrorNexa extends Error {
  constructor(status, codigo, mensaje) { super(mensaje ?? codigo); this.status = status; this.codigo = codigo; }
  get esRevocado() { return this.codigo === "FEL_REVOCADO"; }
  get esFencing() { return this.codigo === "FEL_FENCING" || this.codigo === "FEL_ESTADO" || this.codigo === "FEL_EMPRESA"; }
}
const PREFIJO = "/api/agente/v1/";

export function crearClienteNexa({ base, agenteId = null, privada = null, fetchFn = fetch, timeoutMs = 10_000 }) {
  const origen = exigirBaseLocal(base, "NEXA");
  async function enviar(op, cuerpo, firmar) {
    const texto = JSON.stringify(cuerpo ?? {});
    const cab = firmar ? cabecerasFirmadas({ agenteId, privada, ruta: PREFIJO + op, cuerpo: texto }) : { "content-type": "application/json" };
    const r = await fetchFn(origen + PREFIJO + op, { method: "POST", headers: cab, body: texto, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok || !j || j.ok === false) throw new ErrorNexa(r.status, j?.codigo ?? "FEL_RESPUESTA", j?.mensaje);
    return j;
  }
  return {
    vincular: ({ codigo, clavePublica, nombre, version }) => enviar("vincular", { codigo, clave_publica: clavePublica, nombre, version }, false),
    latido: (version, error) => enviar("latido", { version, ...(error ? { error } : {}) }, true),
    reclamar: () => enviar("reclamar", {}, true),
    progreso: (orden, token, fase) => enviar("progreso", { orden, token, fase }, true),
    vistaPrevia: (orden, token, resumen, hash) => enviar("vista_previa", { orden, token, resumen, hash }, true),
    resultado: (orden, token, r) => enviar("resultado", { orden, token, ...r }, true),
  };
}
