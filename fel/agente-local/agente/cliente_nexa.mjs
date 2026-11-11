// Cliente del PLANO DE CONTROL de NEXA (/api/agente/v1/*). Toda petición va firmada con la clave del equipo y TODA respuesta debe venir firmada por NEXA y ligada a esa petición
// (nonce): si no se puede comprobar, no se obedece (ni órdenes ni «revocado»). La empresa la deduce NEXA de la identidad del agente (nunca se envía).
import { randomBytes } from "node:crypto";
import { cabecerasFirmadas, b64u } from "./firma.mjs";
import { ErrorRespuesta, verificarRespuesta } from "./confianza_nexa.mjs";
import { exigirBaseNexa } from "./seguridad_red.mjs";
import { crearMetricasCliente } from "./sondeo.mjs";
import { crearTransporte, ErrorTransporte } from "./transporte.mjs";

export class ErrorNexa extends Error {
  constructor(status, codigo, mensaje, extra = {}) { super(mensaje ?? codigo); this.status = status; this.codigo = codigo; Object.assign(this, extra); }
  get esRevocado() { return this.codigo === "FEL_REVOCADO"; }
  get esFencing() { return this.codigo === "FEL_FENCING" || this.codigo === "FEL_ESTADO" || this.codigo === "FEL_EMPRESA"; }
  get esVersion() { return this.codigo === "FEL_VERSION"; }
  /** Fallo de red / TLS / respuesta no autenticable: el agente reintenta con espera exponencial y NUNCA lo trata como instrucción de NEXA. */
  get esTransitorio() { return this.codigo === "FEL_RED" || this.codigo === "FEL_TLS" || this.codigo === "FEL_RESPUESTA_NO_AUTENTICA" || this.status >= 500 || this.status === 429 || this.status === 0; }
}
const PREFIJO = "/api/agente/v1/";

export function crearClienteNexa({ base, agenteId = null, privada = null, confianza, transporte, ca, hostsPermitidos = [], version = "0.0.0", ahora = () => new Date(), timeoutMs = 10_000, metricas = crearMetricasCliente() }) {
  if (!confianza) throw new Error("Falta la configuración de confianza en las respuestas de NEXA");
  const origen = exigirBaseNexa(base, { hostsPermitidos });
  const tp = transporte ?? crearTransporte({ ca, timeoutMs });

  async function enviar(op, cuerpoBase, firmar) {
    const nonce = b64u(randomBytes(18));
    const extra = firmar && (op === "reclamar" || op === "latido") ? { version, kids: confianza.kids(), ...(Object.keys(metricas.tomar()).length ? { metricas: metricas.tomar() } : {}) } : {};
    const snap = metricas.tomar(), texto = JSON.stringify({ ...cuerpoBase, ...extra });
    const headers = firmar ? cabecerasFirmadas({ agenteId, privada, ruta: PREFIJO + op, cuerpo: texto, nonce }) : { "content-type": "application/json", "x-nonce": nonce };
    metricas.peticion();
    let r;
    try { r = await tp.enviar({ url: origen + PREFIJO + op, metodo: "POST", headers, cuerpo: texto }); }
    catch (e) { metricas.fallo("errores_red"); throw new ErrorNexa(0, e instanceof ErrorTransporte && e.codigo === "TLS" ? "FEL_TLS" : "FEL_RED", e instanceof ErrorTransporte ? e.message : "Sin conexión"); }
    // 1) la respuesta debe estar firmada por NEXA y ligada a ESTA petición; si trae claves nuevas de NEXA (rotación) se aprenden y se vuelve a comprobar una vez
    let json = null; try { json = JSON.parse(r.cuerpo.toString("utf8")); } catch { /* se decide abajo */ }
    const comprobar = () => verificarRespuesta({ confianza, nonce, status: r.status, headers: r.headers, cuerpo: r.cuerpo, ahora });
    try {
      try { comprobar(); }
      catch (e) { if (e instanceof ErrorRespuesta && e.codigo === "CLAVE_DESCONOCIDA" && json && (json.claves_nexa || json.revocadas)) { confianza.procesarDistribucion(json); comprobar(); } else throw e; }
    } catch (e) {
      metricas.fallo("no_autenticas");
      throw new ErrorNexa(r.status, "FEL_RESPUESTA_NO_AUTENTICA", "No se pudo comprobar que la respuesta venga de NEXA", { causa: e instanceof ErrorRespuesta ? e.codigo : "ERROR" });
    }
    if (json && (json.claves_nexa || json.revocadas)) confianza.procesarDistribucion(json);   // respuesta AUTÉNTICA: se aprenden anuncios y revocaciones
    metricas.exito(); if (r.status < 500 && r.status !== 429) metricas.darPorInformado(snap);
    if (!json) throw new ErrorNexa(r.status, "FEL_RESPUESTA", "Respuesta ilegible");
    if (r.status !== 200 || json.ok === false) throw new ErrorNexa(r.status, json.codigo ?? "FEL_RESPUESTA", json.mensaje, { politica: json.politica, retryAfterMs: Number(json.retry_after_ms) || 0 });
    return json;
  }
  return {
    metricas, origen,
    vincular: ({ codigo, clavePublica, nombre, version: v }) => enviar("vincular", { codigo, clave_publica: clavePublica, nombre, version: v ?? version }, false),
    latido: (error) => enviar("latido", error ? { error } : {}, true),
    reclamar: () => enviar("reclamar", {}, true),
    progreso: (orden, token, fase) => enviar("progreso", { orden, token, fase }, true),
    vistaPrevia: (orden, token, resumen, hash) => enviar("vista_previa", { orden, token, resumen, hash }, true),
    resultado: (orden, token, r) => enviar("resultado", { orden, token, ...r }, true),
  };
}
