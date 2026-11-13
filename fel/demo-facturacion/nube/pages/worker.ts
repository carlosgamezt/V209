// Cloudflare Pages en «modo avanzado» (_worker.js): un solo archivo, sin carpeta «functions» (la subida directa del panel no la admite; con Wrangler también funciona).
// _routes.json hace que SOLO /api/* invoque este código; el resto lo sirve Pages como archivos estáticos (con las cabeceras de _headers) y no consume cuota de Functions.
import { reenviar, type EntornoProxy } from "../proxy.ts";
interface Entorno extends EntornoProxy { ASSETS: { fetch(r: Request): Promise<Response> } }
export default {
  fetch(req: Request, env: Entorno): Promise<Response> {
    return new URL(req.url).pathname.startsWith("/api/") ? reenviar(req, env) : env.ASSETS.fetch(req);
  },
};
