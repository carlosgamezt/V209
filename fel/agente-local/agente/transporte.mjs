// TRANSPORTE HTTP(S) del agente hacia NEXA. HTTPS con validación ESTRICTA: nunca se desactiva la verificación del certificado ni del nombre del servidor, TLS 1.2 como mínimo,
// sin redirecciones, con tiempo máximo y tope de tamaño de respuesta. `ca` solo se usa en pruebas (para confiar en un certificado de prueba); en producción se usa el almacén de confianza.
import http from "node:http";
import https from "node:https";

export class ErrorTransporte extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const MAX_RESPUESTA = 1 << 20;

export function crearTransporte({ ca, timeoutMs = 10_000 } = {}) {
  return {
    /** Devuelve { status, headers (minúsculas), cuerpo: Buffer }. Lanza ErrorTransporte ante cualquier fallo de red o de TLS (sin detalles del servidor). */
    enviar({ url, metodo = "POST", headers = {}, cuerpo = "" }) {
      return new Promise((ok, ko) => {
        let u; try { u = new URL(url); } catch { return ko(new ErrorTransporte("URL", "URL no válida")); }
        const seguro = u.protocol === "https:"; if (!seguro && u.protocol !== "http:") return ko(new ErrorTransporte("URL", "Esquema no admitido"));
        const datos = Buffer.from(cuerpo);
        const opciones = { method: metodo, hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || (seguro ? 443 : 80), path: u.pathname + u.search, headers: { ...headers, "content-length": datos.length }, agent: false, timeout: timeoutMs };
        if (seguro) Object.assign(opciones, { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(ca ? { ca } : {}) });   // validación de certificado y de nombre SIEMPRE activa
        const req = (seguro ? https : http).request(opciones, (res) => {
          const trozos = []; let n = 0;
          res.on("data", (c) => { n += c.length; if (n > MAX_RESPUESTA) { res.destroy(); ko(new ErrorTransporte("TAMANO", "Respuesta demasiado grande")); } else trozos.push(c); });
          res.on("end", () => ok({ status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), cuerpo: Buffer.concat(trozos) }));
          res.on("error", () => ko(new ErrorTransporte("RED", "Conexión interrumpida")));
          res.on("aborted", () => ko(new ErrorTransporte("RED", "Conexión interrumpida")));
        });
        req.on("timeout", () => { req.destroy(); ko(new ErrorTransporte("TIEMPO", "Tiempo de espera agotado")); });
        req.on("error", (e) => ko(new ErrorTransporte(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME/i.test(String(e.code)) ? "TLS" : "RED", /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME/i.test(String(e.code)) ? "No se pudo verificar el certificado del servidor" : "No se pudo conectar")));
        req.end(datos);
      });
    },
  };
}
