// Núcleo de la API: autenticación, autorización en CADA operación y manejo de errores.
// Recibe sus dependencias por parámetro para poder probarlo sin red.
import { ErrorFel } from "./lib/errores.ts";
import { evaluar, type Requisito } from "./lib/autorizacion.ts";
import { decodificarClaims } from "./lib/jwt.ts";
import type { Cuerpo } from "./lib/validacion.ts";

export interface Config {
  origenesPermitidos: string[];
  emisionRealPermitida: boolean;   // interruptor global; false en la Fase 1
  appUrl: string;
}

export interface Usuario { id: string; email: string }

export interface Deps {
  config: Config;
  getUser(token: string): Promise<Usuario | null>;              // valida el JWT con Supabase Auth
  esPlataforma(userId: string): Promise<boolean>;                // consulta plataforma_admins
  permisos(empresaId: string, userId: string): Promise<string[]>; // fel_permisos_efectivos (única fuente de verdad)
  // deno-lint-ignore no-explicit-any
  admin: any;                                                    // cliente con service_role (solo lo usan las acciones)
}

export interface Contexto extends Deps {
  usuario: Usuario;
  aal: string | undefined;
}

export interface Accion<P = unknown> {
  requisito: Requisito;
  validar(b: Cuerpo): P;
  empresaDe?(p: P): string;
  ejecutar(ctx: Contexto, p: P): Promise<unknown>;
}
export type Acciones = Record<string, Accion<any>>; // deno-lint-ignore-line no-explicit-any

const MAX_CUERPO = 64 * 1024;

function cabeceras(req: Request, cfg: Config): Record<string, string> {
  const origen = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origen && cfg.origenesPermitidos.includes(origen)) {
    h["Access-Control-Allow-Origin"] = origen;
    h["Access-Control-Allow-Headers"] = "authorization, content-type";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return h;
}

const respuesta = (req: Request, d: Deps, status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: cabeceras(req, d.config) });

export async function manejar(req: Request, deps: Deps, acciones: Acciones): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras(req, deps.config) });
  try {
    if (req.method !== "POST") throw new ErrorFel(405, "Método no permitido", "metodo");
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new ErrorFel(401, "Se requiere iniciar sesión", "sin_sesion");

    const texto = await req.text();
    if (texto.length > MAX_CUERPO) throw new ErrorFel(413, "La solicitud es demasiado grande", "cuerpo_grande");
    let cuerpo: Cuerpo;
    try { cuerpo = JSON.parse(texto || "{}"); } catch { throw new ErrorFel(400, "El cuerpo no es JSON válido", "json"); }
    if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) throw new ErrorFel(400, "El cuerpo debe ser un objeto", "json");

    const nombre = String(cuerpo.accion ?? "");
    const accion = Object.prototype.hasOwnProperty.call(acciones, nombre) ? acciones[nombre] : undefined;
    if (!accion) throw new ErrorFel(404, "Acción desconocida", "accion");

    const usuario = await deps.getUser(token);
    if (!usuario) throw new ErrorFel(401, "La sesión no es válida o venció", "sin_sesion");
    const aal = decodificarClaims(token).aal; // el token ya fue validado por Supabase Auth

    const params = accion.validar(cuerpo);

    // Autorización explícita en cada operación (aunque la acción use service_role después).
    const req_ = accion.requisito;
    const esPlataforma = req_.plataforma ? await deps.esPlataforma(usuario.id) : false;
    let permisos: string[] | null = null;
    if (req_.permiso) {
      const empresaId = accion.empresaDe?.(params);
      if (!empresaId) throw new ErrorFel(400, "Falta la empresa", "entrada_invalida");
      permisos = await deps.permisos(empresaId, usuario.id);
    }
    evaluar(req_, { esPlataforma, permisos, aal });

    const datos = await accion.ejecutar({ ...deps, usuario, aal }, params);
    return respuesta(req, deps, 200, { ok: true, datos });
  } catch (e) {
    if (e instanceof ErrorFel) return respuesta(req, deps, e.status, { ok: false, error: e.message, codigo: e.codigo });
    console.error("fel-api error no controlado:", e instanceof Error ? e.message : "desconocido");
    return respuesta(req, deps, 500, { ok: false, error: "Error interno", codigo: "interno" });
  }
}
