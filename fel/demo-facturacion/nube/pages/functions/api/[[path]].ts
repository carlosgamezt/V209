// Cloudflare Pages Function: intermediario hacia la función de Supabase. Toda la lógica está en nube/proxy.ts (copiada aquí al construir).
import { reenviar, type EntornoProxy } from "../_proxy.ts";
// deno-lint-ignore no-explicit-any
export const onRequest = (ctx: { request: Request; env: any }) => reenviar(ctx.request, { FUNCION_URL: ctx.env.FUNCION_URL, PROXY_SECRETO: ctx.env.PROXY_SECRETO } as EntornoProxy);
