// EMULADOR de PostgREST para pruebas locales (NO es código de producción): reproduce lo que importa para la seguridad de la Data API —
//   · verifica la FIRMA del JWT (aquí HS256 con un secreto de prueba; la real usa las llaves asimétricas del proyecto) y su `exp`; sin firma válida → 401;
//   · fija el rol del JWT (`authenticated`/`anon`) y los claims en `request.jwt.claims` ANTES de ejecutar, dentro de una transacción (SET LOCAL);
//   · solo expone el esquema `api` (cualquier otro perfil o función fuera de `api` → 404/406), con parámetros por nombre;
//   · devuelve errores de la base como JSON `{code, message}` con el mismo estado que PostgREST (P0001 → 400; privilegios → 403/401).
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const llave = (secreto: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
/** Emite un JWT HS256 (solo pruebas: imita a Supabase Auth, que es quien tiene la llave en la realidad). */
export async function firmarJwt(claims: Record<string, unknown>, secreto: string): Promise<string> {
  const h = b64u(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))), p = b64u(new TextEncoder().encode(JSON.stringify(claims)));
  return `${h}.${p}.${b64u(await crypto.subtle.sign("HMAC", await llave(secreto), new TextEncoder().encode(`${h}.${p}`)))}`;
}
export async function verificar(jwt: string, secreto: string): Promise<Record<string, unknown> | null> {
  const [h, p, s] = jwt.split("."); if (!h || !p || !s) return null;
  try {
    if (JSON.parse(new TextDecoder().decode(deb64u(h))).alg !== "HS256") return null;   // jamás «none» ni otro algoritmo
    if (!await crypto.subtle.verify("HMAC", await llave(secreto), deb64u(s), new TextEncoder().encode(`${h}.${p}`))) return null;
    const c = JSON.parse(new TextDecoder().decode(deb64u(p))); if (typeof c.exp === "number" && c.exp * 1000 < Date.now()) return null; return c;
  } catch { return null; }
}
const json = (st: number, o: unknown) => new Response(o === undefined ? null : JSON.stringify(o), { status: st, headers: { "content-type": "application/json" } });
const literal = (v: unknown): unknown => v === null || v === undefined ? null : Array.isArray(v) && v.every((x) => x === null || typeof x !== "object") ? `{${v.map((x) => x === null ? "NULL" : `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}` : typeof v === "object" ? JSON.stringify(v) : v;

export function emularPostgrest(db: PGlite, o: { secreto: string; apikey: string }): { fetch: typeof fetch; llamadas: { fn: string; rol: string; sub: string | null }[] } {
  const llamadas: { fn: string; rol: string; sub: string | null }[] = [];
  const f = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(entrada, init); const url = new URL(req.url); const m = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
    if (!m || req.method !== "POST") return json(404, { code: "PGRST125", message: "Invalid path specified in request URL" });
    if (req.headers.get("apikey") !== o.apikey) return json(401, { message: "No API key found in request" });
    const perfil = req.headers.get("content-profile") ?? req.headers.get("accept-profile") ?? "api"; if (perfil !== "api") return json(406, { code: "PGRST106", message: `The schema must be one of the following: api` });
    let claims: Record<string, unknown> = { role: "anon" }; const au = req.headers.get("authorization");
    if (au && /^Bearer /.test(au)) { const c = await verificar(au.slice(7), o.secreto); if (!c) return json(401, { code: "PGRST301", message: "JWT invalid" }); claims = c; }
    const rol = claims.role === "authenticated" ? "authenticated" : "anon";
    let args: Record<string, unknown>; try { args = JSON.parse(await req.text() || "{}"); } catch { return json(400, { code: "PGRST102", message: "Empty or invalid json" }); }
    const claves = Object.keys(args); if (!claves.every((k) => /^[a-z_0-9]+$/.test(k))) return json(400, { code: "PGRST102", message: "bad argument name" });
    const existe = await db.query<{ retset: boolean }>("select p.proretset as retset from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname = $1 limit 1", [m[1]]);
    if (!existe.rows.length) return json(404, { code: "PGRST202", message: `Could not find the function api.${m[1]} in the schema cache` });
    llamadas.push({ fn: m[1], rol, sub: (claims.sub as string) ?? null });
    try {
      return await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]); await tx.query(`set local role ${rol}`);
        const lista = claves.map((k, i) => `${k} := $${i + 1}`).join(", ");
        const r = existe.rows[0].retset ? await tx.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from api.${m[1]}(${lista}) t`, claves.map((k) => literal(args[k])))
          : await tx.query(`select to_jsonb(api.${m[1]}(${lista})) as r`, claves.map((k) => literal(args[k])));
        return json(200, (r.rows[0] as { r?: unknown } | undefined)?.r ?? null);
      });
    } catch (e) {
      const err = e as { message?: string; code?: string }; const st = err.code === "42501" ? (rol === "anon" ? 401 : 403) : err.code === "42883" ? 404 : 400;   // 42883: ninguna firma coincide con los parámetros → PGRST202
      return json(st, { code: err.code ?? "XX000", message: err.message ?? String(e) });
    }
  };
  return { fetch: f as typeof fetch, llamadas };
}
