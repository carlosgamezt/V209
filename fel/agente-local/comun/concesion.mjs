// Verificación (solo verificación) de la CONCESIÓN de confirmación firmada por NEXA. Formato: ver fel/proveedores/src/autorizacion_humana.ts.
// Usa node:crypto; la clave pública de NEXA se entrega al simulador por configuración. El agente NO usa este módulo para firmar: no tiene la clave privada.
import { createPublicKey, verify } from "node:crypto";

export const DOMINIO_CONCESION = "nexa-confirmacion-v1";
const PREFIJO_DER_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const RE_B64U = /^[A-Za-z0-9_-]+$/;
const deB64u = (s) => (RE_B64U.test(s) ? Buffer.from(s, "base64url") : null);

export function claveDesdeRaw(b64u) {
  const raw = typeof b64u === "string" ? deB64u(b64u) : null;
  if (!raw || raw.length !== 32) throw new Error("clave pública Ed25519 no válida (32 bytes en base64url)");
  return createPublicKey({ key: Buffer.concat([PREFIJO_DER_ED25519, raw]), format: "der", type: "spki" });
}

/** Devuelve la concesión si la firma y el formato son válidos y no caducó; null ante CUALQUIER problema. */
export function crearVerificador(clavePublicaB64u) {
  const clave = claveDesdeRaw(clavePublicaB64u);
  return (token, ahora = new Date()) => {
    try {
      if (typeof token !== "string" || token.length > 4096) return null;
      const partes = token.split("."); if (partes.length !== 2) return null;
      const [cuerpo, firma] = partes, f = deB64u(firma), b = deB64u(cuerpo);
      if (!f || f.length !== 64 || !b) return null;
      if (!verify(null, Buffer.from(`${DOMINIO_CONCESION}\n${cuerpo}`), clave, f)) return null;
      const c = JSON.parse(b.toString("utf8"));
      const ok = c && c.v === 1 && ["empresa", "orden", "resumen_hash", "usuario", "emitida", "expira", "jti"].every((k) => typeof c[k] === "string")
        && /^[0-9a-f]{64}$/.test(c.resumen_hash) && /^[A-Za-z0-9_-]{16,64}$/.test(c.jti) && Date.parse(c.expira) > ahora.getTime();
      return ok ? c : null;
    } catch { return null; }
  };
}
