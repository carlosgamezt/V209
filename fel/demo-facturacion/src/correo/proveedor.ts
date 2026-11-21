// Proveedor de correo de NEXA FEL: una interfaz mínima que el resto del sistema usa, y dos implementaciones.
//   · ResendCorreo: envío real por la API de Resend (https://resend.com/docs/api-reference/emails/send-email). Solo desde el SERVIDOR; la clave es un secreto del servidor.
//   · CorreoSimulado: no sale nada a la red; guarda en memoria lo que «habría enviado» (para pruebas y para ensayar la pantalla sin enviar correos reales).
// Cambiar de proveedor = escribir otra clase con la misma interfaz; el servicio de envío no cambia.
// Reglas de seguridad de este archivo: la clave nunca se registra ni se devuelve, los mensajes de error del proveedor NO se reenvían tal cual (pueden citar datos), y todo tiene tiempo máximo.

export interface Adjunto { nombre: string; mime: string; contenido: Uint8Array }
export interface MensajeCorreo {
  de: string; para: string; asunto: string; html: string; texto: string; adjuntos: Adjunto[];
  /** Clave de idempotencia: el proveedor no envía dos veces el mismo mensaje con la misma clave (protege los reintentos tras un corte). */
  clave: string;
  /** Etiquetas internas (sin datos personales) para localizar el envío en el panel del proveedor. */
  etiquetas?: Record<string, string>;
}
/** aceptado: el proveedor devolvió un identificador (NO es prueba de entrega) · rechazado: el proveedor rechazó la solicitud (no se reintenta igual) · fallido: error de red, de tiempo o del proveedor (resultado incierto). */
export type ResultadoEnvio =
  | { estado: "aceptado"; mensajeId: string }
  | { estado: "rechazado"; codigo: string }
  | { estado: "fallido"; codigo: string };
export interface ProveedorCorreo { readonly nombre: "resend" | "simulado"; enviar(m: MensajeCorreo): Promise<ResultadoEnvio> }

export const TIEMPO_MAXIMO_CORREO_MS = 20_000;
/** Resend admite hasta 40 MB por correo; aquí un tope mucho menor: una factura ocupa decenas de KB. */
export const TAMANO_MAXIMO_ADJUNTOS = 10 * 1024 * 1024;

function aBase64(b: Uint8Array): string {
  let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Quita todo salvo letras, dígitos y unos pocos signos: lo que se registra o guarda de un error ajeno nunca puede arrastrar texto libre. */
const codigoSeguro = (s: unknown, defecto: string) => { const t = String(s ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50); return t || defecto; };

export interface OpcionesResend { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string; tiempoMaximoMs?: number }
export class ResendCorreo implements ProveedorCorreo {
  readonly nombre = "resend" as const;
  readonly #clave: string; readonly #fetch: typeof fetch; readonly #base: string; readonly #ms: number;
  constructor(o: OpcionesResend) {
    if (!/^re_[A-Za-z0-9_\-]{10,200}$/.test(o.apiKey)) throw new Error("clave de Resend con formato no válido");   // sin mostrar la clave
    this.#clave = o.apiKey; this.#fetch = o.fetchImpl ?? fetch; this.#base = (o.baseUrl ?? "https://api.resend.com").replace(/\/+$/, ""); this.#ms = o.tiempoMaximoMs ?? TIEMPO_MAXIMO_CORREO_MS;
  }
  async enviar(m: MensajeCorreo): Promise<ResultadoEnvio> {
    const total = m.adjuntos.reduce((a, x) => a + x.contenido.length, 0);
    if (total > TAMANO_MAXIMO_ADJUNTOS) return { estado: "rechazado", codigo: "adjuntos_demasiado_grandes" };
    const cuerpo = {
      from: m.de, to: [m.para], subject: m.asunto, html: m.html, text: m.texto,
      attachments: m.adjuntos.map((x) => ({ filename: x.nombre, content: aBase64(x.contenido) })),
      ...(m.etiquetas ? { tags: Object.entries(m.etiquetas).filter(([k, v]) => /^[A-Za-z0-9_-]{1,256}$/.test(k) && /^[A-Za-z0-9_-]{1,256}$/.test(v)).map(([name, value]) => ({ name, value })) } : {}),
    };
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), this.#ms);
    try {
      const r = await this.#fetch(`${this.#base}/emails`, { method: "POST", signal: ctl.signal,
        headers: { authorization: `Bearer ${this.#clave}`, "content-type": "application/json", "idempotency-key": m.clave, "user-agent": "nexa-fel/1" }, body: JSON.stringify(cuerpo) });
      let j: Record<string, unknown> = {}; try { j = await r.json() as Record<string, unknown>; } catch { /* respuesta sin cuerpo JSON */ }
      if (r.status >= 200 && r.status < 300) {
        const id = typeof j.id === "string" && /^[A-Za-z0-9_\-]{1,120}$/.test(j.id) ? j.id : null;
        return id ? { estado: "aceptado", mensajeId: id } : { estado: "fallido", codigo: "respuesta_sin_identificador" };   // 2xx sin identificador: no se puede afirmar nada
      }
      // 4xx de validación/dirección/permisos: el proveedor rechazó ESTA solicitud. 409 (misma clave en curso) y 429/5xx: incierto o transitorio → fallido.
      if (r.status === 429 || r.status === 409 || r.status >= 500) return { estado: "fallido", codigo: `http_${r.status}` };
      return { estado: "rechazado", codigo: codigoSeguro(j.name, `http_${r.status}`) };
    } catch (e) {
      return { estado: "fallido", codigo: (e as Error)?.name === "AbortError" ? "tiempo_agotado" : "red" };
    } finally { clearTimeout(t); }
  }
}

/** No envía nada: registra lo que se habría enviado. Permite fallar a propósito (para probar los errores) con `siguiente`. */
export class CorreoSimulado implements ProveedorCorreo {
  readonly nombre = "simulado" as const;
  readonly enviados: MensajeCorreo[] = [];
  /** Resultado forzado del próximo envío (se consume). */
  siguiente: ResultadoEnvio | null = null;
  #claves = new Map<string, ResultadoEnvio>();
  enviar(m: MensajeCorreo): Promise<ResultadoEnvio> {
    const previo = this.#claves.get(m.clave); if (previo) return Promise.resolve(previo);   // igual que el proveedor real: la misma clave no se envía dos veces
    const r: ResultadoEnvio = this.siguiente ?? { estado: "aceptado", mensajeId: `sim_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}` }; this.siguiente = null;
    if (r.estado === "aceptado") { this.enviados.push(m); this.#claves.set(m.clave, r); }
    return Promise.resolve(r);
  }
}
