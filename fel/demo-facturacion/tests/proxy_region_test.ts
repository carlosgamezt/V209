// El intermediario de Cloudflare indica a Supabase en qué REGIÓN correr la función (la de la base de datos) solo si es una región conocida; si Supabase la rechaza (400) reintenta UNA vez sin indicarla.
import assert from "node:assert/strict";
import { reenviar } from "../nube/proxy.ts";
const env = (r?: string) => ({ FUNCION_URL: "https://f.example/functions/v1/nexa-demo", PROXY_SECRETO: "x".repeat(40), ...(r ? { FUNCION_REGION: r } : {}) });
const pedir = () => new Request("https://demo.example/api/estado", { method: "GET" });

Deno.test("proxy: con región válida envía x-region; sin ella o con una desconocida no la envía", async () => {
  const vistas: (string | null)[] = []; const f = (async (_u: string, i: RequestInit) => { vistas.push(new Headers(i.headers).get("x-region")); return new Response("{}"); }) as unknown as typeof fetch;
  await reenviar(pedir(), env("us-west-2"), f); await reenviar(pedir(), env(), f); await reenviar(pedir(), env("marte-norte-9"), f); await reenviar(pedir(), env("us-west-2; drop"), f);
  assert.deepEqual(vistas, ["us-west-2", null, null, null]);
});

Deno.test("proxy: si Supabase rechaza la región (400) se reintenta una vez sin ella y se devuelve esa respuesta", async () => {
  const vistas: (string | null)[] = []; const f = (async (_u: string, i: RequestInit) => { const r = new Headers(i.headers).get("x-region"); vistas.push(r); return r ? new Response("{}", { status: 400 }) : new Response('{"ok":true}', { status: 200 }); }) as unknown as typeof fetch;
  const r = await reenviar(pedir(), env("us-west-2"), f); assert.equal(r.status, 200); assert.deepEqual(vistas, ["us-west-2", null]);
});
