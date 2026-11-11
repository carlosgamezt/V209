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
