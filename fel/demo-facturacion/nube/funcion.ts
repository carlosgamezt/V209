// Función de nube de la demostración (Supabase Edge Function «nexa-demo», Deno). Solo atiende /api/* y /salud, y SOLO si la petición trae el secreto del intermediario de Cloudflare:
// llamarla directamente por su dirección de Supabase no sirve de nada. Sin estado propio: todo (datos, sesiones, estado de los simuladores) vive en PostgreSQL, así que puede haber
// varias instancias y reinicios en cualquier momento. No siembra la base ni registra contraseñas (lo hace el aprovisionamiento una vez); nunca imprime credenciales.
import { crearBdPg, type BdDemo } from "../src/bd.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { PERSONAS } from "../src/mundo_practico.ts";
import { Sesiones } from "../src/sesiones.ts";
import { LimiteTasa } from "../src/limite.ts";
import { crearEndurecimiento } from "../src/endurecimiento.ts";
import { leerConfigPublicada } from "../src/publicado.ts";
import { crearApi } from "../src/api.ts";

const igualesSeguro = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const generico = (s: number, m: string) => new Response(JSON.stringify({ codigo: "no_disponible", mensaje: m }), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export interface EntornoFuncion { get(k: string): string | undefined }
export function crearManejador(env: EntornoFuncion, bdExterna?: BdDemo): (req: Request) => Promise<Response> {
  const secreto = env.get("FEL_PROXY_SECRETO") ?? "", url = env.get("FEL_DEMO_BD_URL");
  let listo: Promise<{ api: (r: Request) => Promise<Response>; endurecer: ReturnType<typeof crearEndurecimiento> }> | null = null;
  const iniciar = () => listo ??= (async () => {
    const cfg = leerConfigPublicada((k) => env.get(k), Object.keys(PERSONAS), { exigirClaves: false });
    const bd = bdExterna ?? crearBdPg(url!);
    const mundo = await prepararBase(bd, { sembrar: false });
    const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = null; sesiones.forzarSeguro = true;
    sesiones.auditar = async (evento, usuario, detalle = {}) => { try { const c = await sesiones.almacen.cuenta(usuario); await bd.filas("select public.fel_auditar($1, $2, $3, $4, $5, $6)", [c?.persona.empresa ?? null, c?.persona.id ?? null, `demo.${evento}`, "sesion", usuario, { ...detalle, existe: !!c }]); } catch { /* la auditoría no debe tumbar la petición */ } };
    const api = crearApi(bd, mundo, { sesiones, practico: true, mfa: new Map(Object.entries(cfg.semillas)) });
    const endurecer = crearEndurecimiento({ publicado: true, hosts: cfg.hosts, hostDe: (r) => (r.headers.get("x-nexa-host") ?? "").toLowerCase(), ipDe: (r) => r.headers.get("x-nexa-ip") ?? "?",
      limiteLogin: new LimiteTasa(Number(env.get("FEL_DEMO_LIMITE_LOGIN") ?? "10"), 60_000), limiteApi: new LimiteTasa(Number(env.get("FEL_DEMO_LIMITE_API") ?? "400"), 60_000) });
    return { api, endurecer };
  })();
  return async (req: Request): Promise<Response> => {
    if (secreto.length < 32 || (!url && !bdExterna)) return generico(503, "Servicio no configurado");
    if (!igualesSeguro(req.headers.get("x-nexa-proxy") ?? "", secreto)) return new Response("Prohibido", { status: 403 });
    const u = new URL(req.url), ruta = u.pathname.replace(/^\/nexa-demo(?=\/|$)/, "") || "/";   // Supabase antepone el nombre de la función
    if (ruta !== "/salud" && !ruta.startsWith("/api/")) return new Response("No encontrado", { status: 404 });
    let app; try { app = await iniciar(); } catch (e) { listo = null; console.error("inicio de la función:", (e as Error).message.slice(0, 200)); return generico(503, "Servicio no disponible"); }
    const interna = new Request(new URL(ruta + u.search, u.origin), req);
    const previo = app.endurecer.previo(interna); if (previo) return previo;
    return app.endurecer.asegurar(await app.api(interna));
  };
}
