// Endurecimiento HTTP común de la demostración publicada: lo usan el servidor Deno (contenedor) y la función de nube (Supabase Edge Function detrás de Cloudflare).
//  · /salud sin datos · nombre (Host) permitido · solo HTTPS · robots · límites por IP · cabeceras estrictas (HSTS, sin indexación, sin permisos de dispositivo).
import { LimiteTasa } from "./limite.ts";

export interface OpcionesEndurecimiento {
  publicado: boolean; hosts: string[]; lan?: boolean;
  limiteLogin?: LimiteTasa; limiteApi?: LimiteTasa;
  /** Nombre público con el que el visitante llegó (por defecto, la cabecera Host; detrás de un proxy, el que este reenvía). */
  hostDe?: (req: Request) => string;
  /** IP del visitante (solo es de fiar detrás de un proxy propio o de la plataforma, que sobrescribe estas cabeceras). */
  ipDe?: (req: Request) => string;
}
const json = (x: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export function crearEndurecimiento(o: OpcionesEndurecimiento) {
  const hostDe = o.hostDe ?? ((req: Request) => (req.headers.get("host") ?? "").split(":")[0].toLowerCase());
  const ipDe = o.ipDe ?? ((req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?");
  const limiteLogin = o.limiteLogin ?? new LimiteTasa(10, 60_000), limiteApi = o.limiteApi ?? new LimiteTasa(400, 60_000);
  /** Cabeceras de seguridad (solo en modo publicado). */
  function asegurar(r: Response): Response {
    if (!o.publicado) return r;
    const h = new Headers(r.headers); h.set("x-robots-tag", "noindex, nofollow, noarchive"); h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    h.set("cross-origin-opener-policy", "same-origin"); h.set("cross-origin-resource-policy", "same-origin"); h.set("x-frame-options", "DENY"); h.set("strict-transport-security", "max-age=63072000; includeSubDomains");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
  /** Comprobaciones previas: devuelve una respuesta si la petición no debe llegar a la aplicación; nulo si puede seguir. */
  function previo(req: Request): Response | null {
    const url = new URL(req.url);
    if (url.pathname === "/salud") return asegurar(json({ ok: true }));   // comprobación de estado para la plataforma: sin datos y sin sesión
    const host = hostDe(req);
    const permitido = o.publicado ? o.hosts.includes(host) : host === "127.0.0.1" || host === "localhost" || (!!o.lan && (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || o.hosts.includes(host)));
    if (!permitido) return new Response("Host no permitido", { status: 403 });   // contra DNS rebinding
    if (!o.publicado) return null;
    if (req.headers.get("x-forwarded-proto") === "http") return asegurar(new Response(null, { status: 308, headers: { location: `https://${host}${url.pathname}${url.search}` } }));   // solo HTTPS
    if (url.pathname === "/robots.txt") return asegurar(new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }));
    const login = url.pathname === "/api/sesion/entrar", l = (login ? limiteLogin : limiteApi).permitir(`${login ? "login" : "api"}:${ipDe(req)}`);
    if (!l.ok) return asegurar(json({ codigo: "limite", mensaje: "Demasiadas solicitudes. Espera un momento." }, 429, { "retry-after": String(l.reintentarEnS) }));
    return null;
  }
  return { asegurar, previo };
}
