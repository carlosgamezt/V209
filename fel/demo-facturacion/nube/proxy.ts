// Intermediario de Cloudflare Pages: reenvía /api/* a la función de Supabase (nexa-demo) y NADA más. Es lógica pura (probada con Deno); el archivo de Pages solo la invoca.
//  · Añade el secreto compartido (la función rechaza todo lo que no lo traiga) y la identidad real del visitante: nombre público (Host) y IP (CF-Connecting-IP).
//  · Quita las cabeceras que el visitante pudiera falsificar con esos mismos nombres. No añade CORS (la protección contra falsificación entre sitios es la cabecera propia + SameSite=Strict).
//  · Solo métodos GET/POST; tope de tamaño; sin redirecciones; errores genéricos (sin direcciones internas).
export interface EntornoProxy { FUNCION_URL: string; PROXY_SECRETO: string }
const PROPIAS = ["x-nexa-proxy", "x-nexa-host", "x-nexa-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip", "authorization", "apikey"];
const MAX_CUERPO = 300_000;

export async function reenviar(req: Request, env: EntornoProxy, f: typeof fetch = fetch): Promise<Response> {
  const gen = (s: number, m: string) => new Response(JSON.stringify({ codigo: "no_disponible", mensaje: m }), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (!env.FUNCION_URL || (env.PROXY_SECRETO ?? "").length < 32) return gen(503, "Servicio no configurado");
  if (req.method !== "GET" && req.method !== "POST") return gen(405, "Método no permitido");
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return gen(404, "No encontrado");
  const largo = Number(req.headers.get("content-length") ?? 0); if (largo > MAX_CUERPO) return gen(413, "Solicitud demasiado grande");
  const cuerpo = req.method === "POST" ? await req.arrayBuffer() : undefined; if (cuerpo && cuerpo.byteLength > MAX_CUERPO) return gen(413, "Solicitud demasiado grande");
  const cab = new Headers(); for (const [k, v] of req.headers) if (!PROPIAS.includes(k.toLowerCase()) && !k.toLowerCase().startsWith("cf-") && k.toLowerCase() !== "host") cab.set(k, v);
  cab.set("x-nexa-proxy", env.PROXY_SECRETO); cab.set("x-nexa-host", url.hostname.toLowerCase()); cab.set("x-nexa-ip", req.headers.get("cf-connecting-ip") ?? "?");
  let r: Response;
  try { r = await f(env.FUNCION_URL.replace(/\/$/, "") + url.pathname + url.search, { method: req.method, headers: cab, body: cuerpo, redirect: "manual" }); }
  catch { return gen(502, "El servicio no responde. Inténtalo de nuevo."); }
  const sal = new Headers(r.headers); for (const k of ["x-nexa-proxy", "server", "x-powered-by", "sb-request-id", "sb-gateway-version", "x-sb-error-code", "x-deno-execution-id"]) sal.delete(k);
  for (const k of [...sal.keys()]) if (k.toLowerCase().startsWith("access-control-")) sal.delete(k);   // jamás CORS
  sal.set("cache-control", "no-store");
  return new Response(r.body, { status: r.status, headers: sal });
}
