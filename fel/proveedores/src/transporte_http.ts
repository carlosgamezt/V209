// Transporte HTTP GENÉRICO para los adaptadores de certificadores (hoy solo se usa con el simulador local; el de Digifact real lo usará cuando exista su documentación).
// No sabe nada del contrato de ningún certificador: solo hace lo que TODO transporte seguro debe hacer:
//  · HTTPS obligatorio (HTTP solo hacia 127.0.0.1/localhost, para pruebas) · sin redirecciones automáticas · tiempo máximo por petición (lanza «TiempoAgotado», nunca inventa una respuesta)
//  · tope de tamaño de respuesta · un solo intento (jamás reintenta) · los errores NO incluyen cabeceras, cuerpo ni la dirección completa (nada sensible llega a los registros).
import type { PeticionHttp, RespuestaHttp, Transporte } from "./digifact.ts";

export interface OpcionesTransporteHttp {
  /** Dirección base (p. ej. la que entregue el certificador). Sin barra final. */
  baseUrl: string; tiempoMaximoMs?: number; maxBytesRespuesta?: number;
  /** Cabeceras que van en toda petición (p. ej. un identificador de cliente); NUNCA se escriben en registros. */
  cabecerasFijas?: Record<string, string>;
  fetchImpl?: typeof fetch;
}
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function crearTransporteHttp(o: OpcionesTransporteHttp): Transporte {
  const base = new URL(o.baseUrl);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && LOCAL.has(base.hostname))) throw new Error("El transporte exige HTTPS (HTTP solo hacia el equipo local en pruebas)");
  if (base.username || base.password) throw new Error("La dirección base no debe llevar usuario ni contraseña");
  const raiz = base.origin + base.pathname.replace(/\/$/, "");
  const tope = o.maxBytesRespuesta ?? 5_000_000, tiempo = o.tiempoMaximoMs ?? 10_000, f = o.fetchImpl ?? fetch;
  return async (p: PeticionHttp): Promise<RespuestaHttp> => {
    if (!p.ruta.startsWith("/")) throw new Error("La ruta debe comenzar con /");
    const ctl = new AbortController(); const reloj = setTimeout(() => ctl.abort(), tiempo);
    try {
      const r = await f(raiz + p.ruta, { method: p.metodo, headers: { ...(o.cabecerasFijas ?? {}), ...p.cabeceras }, body: p.metodo === "GET" ? undefined : p.cuerpo, redirect: "manual", signal: ctl.signal });
      const largo = Number(r.headers.get("content-length") ?? 0); if (largo > tope) { await r.body?.cancel(); throw new Error("respuesta demasiado grande"); }
      const lector = r.body?.getReader(); const trozos: Uint8Array[] = []; let total = 0;
      if (lector) for (;;) { const { done, value } = await lector.read(); if (done) break; total += value.length; if (total > tope) { await lector.cancel(); throw new Error("respuesta demasiado grande"); } trozos.push(value); }
      const todo = new Uint8Array(total); let pos = 0; for (const t of trozos) { todo.set(t, pos); pos += t.length; }
      return { estado: r.status, cuerpo: new TextDecoder().decode(todo) };
    } catch (e) {
      if (ctl.signal.aborted) { const err = new Error("tiempo agotado"); err.name = "TiempoAgotado"; throw err; }
      const err = new Error(e instanceof Error && e.message === "respuesta demasiado grande" ? "respuesta demasiado grande" : "fallo de red"); err.name = "CorteDeRed"; throw err;   // sin detalle: puede contener la dirección o datos
    } finally { clearTimeout(reloj); }
  };
}
