// Separación estricta simulador ↔ real en el LADO DEL AGENTE: el agente solo habla con NEXA y con el simulador, y ambos deben ser LOCALES (loopback).
// El navegador solo puede abrir el origen exacto del simulador. SAT, certificadores y cualquier otro host quedan bloqueados (lista de nombres conocidos incluida
// como segunda barrera con mensaje claro). Diseño: fel/docs/agente-seguridad.md §2.
const BLOQUEADOS = ["sat.gob.gt", "digifact", "infile", "guatefacturas", "megaprint", "ecofactura", "certificador", "felplex", "dimexa", "tecnofacturas", "facturaelectronica", "agencia.sat", "portal.sat"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class ErrorRed extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
export const esLoopback = (host) => LOOPBACK.has(host);
export const nombreBloqueado = (host) => { const h = String(host).toLowerCase(); return BLOQUEADOS.some((b) => h.includes(b)); };

/** Valida una URL base local (NEXA o simulador). Lanza ErrorRed si no es http en loopback (sin credenciales en la URL, sin rutas ni parámetros). */
export function exigirBaseLocal(texto, que) {
  let u; try { u = new URL(texto); } catch { throw new ErrorRed("URL", `${que}: URL no válida`); }
  if (nombreBloqueado(u.hostname)) throw new ErrorRed("BLOQUEADO", `${que}: destino fiscal real bloqueado`);
  if (u.protocol !== "http:" || !esLoopback(u.hostname)) throw new ErrorRed("NO_LOCAL", `${que}: en esta fase solo se admite http en 127.0.0.1/localhost (sin conexiones reales)`);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new ErrorRed("URL", `${que}: la URL base no debe llevar credenciales, ruta ni parámetros`);
  return u.origin;
}
/** Regla para cada petición del navegador: solo el origen exacto del simulador. */
export const peticionPermitida = (urlTexto, origenSimulador) => { try { const u = new URL(urlTexto); return u.origin === origenSimulador && !nombreBloqueado(u.hostname); } catch { return false; } };

/** Valida la URL base de NEXA. `http` solo en loopback (desarrollo y pruebas). `https` en loopback, o en un host de la lista EXACTA `hostsPermitidos` (la fijará la configuración firmada del instalador):
 *  sin credenciales, sin ruta ni parámetros, sin IP literal ni puertos raros fuera de loopback, y nunca un nombre de SAT o de certificador. */
export function exigirBaseNexa(texto, { hostsPermitidos = [] } = {}) {
  let u; try { u = new URL(texto); } catch { throw new ErrorRed("URL", "NEXA: URL no válida"); }
  if (nombreBloqueado(u.hostname)) throw new ErrorRed("BLOQUEADO", "NEXA: destino fiscal real bloqueado");
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new ErrorRed("URL", "NEXA: la URL base no debe llevar credenciales, ruta ni parámetros");
  const local = esLoopback(u.hostname);
  if (u.protocol === "http:") { if (!local) throw new ErrorRed("NO_HTTPS", "NEXA: fuera de este equipo solo se admite https"); return u.origin; }
  if (u.protocol !== "https:") throw new ErrorRed("URL", "NEXA: esquema no admitido");
  if (local) return u.origin;
  const host = u.hostname.toLowerCase();
  if (/^[0-9.]+$/.test(host) || host.includes(":") || host.startsWith("[")) throw new ErrorRed("NO_PERMITIDO", "NEXA: no se admiten direcciones IP");
  if (u.port && u.port !== "443") throw new ErrorRed("NO_PERMITIDO", "NEXA: puerto no admitido");
  if (!hostsPermitidos.map((h) => String(h).toLowerCase()).includes(host)) throw new ErrorRed("NO_PERMITIDO", "NEXA: ese servidor no está en la lista de destinos autorizados");
  return u.origin;
}
