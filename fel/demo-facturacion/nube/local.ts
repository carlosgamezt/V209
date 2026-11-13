// Simulación LOCAL de la cadena de la nube, para probar de punta a punta antes de publicar (no es lo que se despliega):
//   navegador → [página estática construida + intermediario de Pages] → función de Supabase (código construido) → PostgreSQL real.
// Uso: construir primero (deno run -A nube/construir.ts) y luego
//   FEL_DEMO_BD_URL=… FEL_DEMO_CLAVES=… FEL_DEMO_MFA_SEMILLAS=… FEL_DEMO_HOSTS=nexa-demo.localhost FEL_PROXY_SECRETO=… deno run -A nube/local.ts --puerto=8790
import { fromFileUrl, join } from "jsr:@std/path@1";

const SALIDA = join(fromFileUrl(new URL("../..", import.meta.url)), "dist", "nube");
const { crearManejador } = await import(join(SALIDA, "funcion", "supabase", "functions", "nexa-demo", "codigo", "demo-facturacion", "nube", "funcion.ts"));   // el código CONSTRUIDO, no el de origen
const puerto = Number(Deno.args.find((a) => a.startsWith("--puerto="))?.slice(9) ?? "8790");
const funcion = crearManejador({ get: (k: string) => Deno.env.get(k) });
// el intermediario REAL, el _worker.js construido, ejecutado aquí; su «fetch» saliente hacia Supabase se redirige a la función en memoria
const trabajador = (await import(join(SALIDA, "pagina", "_worker.js"))).default;
const fetchReal = globalThis.fetch;
globalThis.fetch = ((i: RequestInfo | URL, o?: RequestInit) => String(i instanceof Request ? i.url : i).startsWith("http://funcion.local/") ? funcion(new Request(String(i), o)) : fetchReal(i, o)) as typeof fetch;
const TIPOS: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", png: "image/png", webmanifest: "application/manifest+json", txt: "text/plain" };
// _headers de Cloudflare Pages (formato simple: ruta y líneas con sangría)
const reglas: { ruta: string; cab: [string, string][] }[] = []; for (const l of (await Deno.readTextFile(join(SALIDA, "pagina", "_headers"))).split("\n")) { if (/^\S/.test(l)) reglas.push({ ruta: l.trim(), cab: [] }); else if (l.trim() && reglas.length) { const i = l.indexOf(":"); reglas.at(-1)!.cab.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]); } }

async function estatico(rutaPedida: string): Promise<Response> {
  const ruta = rutaPedida === "/" ? "/index.html" : rutaPedida;
  if (ruta.includes("..")) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await Deno.readFile(join(SALIDA, "pagina", ruta)); const h = new Headers({ "content-type": TIPOS[ruta.split(".").pop()!] ?? "application/octet-stream" });
    for (const r of reglas) if (r.ruta === "/*" || r.ruta === ruta) for (const [k, v] of r.cab) h.set(k, v);
    return new Response(datos, { headers: h });
  } catch { return new Response("No encontrado", { status: 404 }); }
}

Deno.serve({ port: puerto, hostname: "127.0.0.1", onListen: ({ port }) => console.log(`  Cadena de nube local en http://nexa-demo.localhost:${port}/ (página estática + intermediario + función + base)`) }, async (req) => {
  const u = new URL(req.url);
  const activos = { fetch: (r: Request) => estatico(new URL(r.url).pathname) };
  if (u.pathname.startsWith("/api/")) return await trabajador.fetch(new Request(Object.assign(new URL(req.url), { hostname: (Deno.env.get("FEL_DEMO_HOSTS") ?? "").split(",")[0] || u.hostname }).toString(), req), { FUNCION_URL: "http://funcion.local/nexa-demo", PROXY_SECRETO: Deno.env.get("FEL_PROXY_SECRETO") ?? "", ASSETS: activos });
  return await estatico(u.pathname);
});
