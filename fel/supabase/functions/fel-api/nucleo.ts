// Núcleo de la API: autenticación, autorización en CADA operación y manejo de errores.
// Recibe sus dependencias por parámetro para poder probarlo sin red.
import { ErrorFel } from "./lib/errores.ts";
import { evaluar, type Requisito } from "./lib/autorizacion.ts";
import { decodificarClaims, eventosAuth } from "./lib/jwt.ts";
import type { Cuerpo } from "./lib/validacion.ts";
import { claveLimite, hashCorto, LIMITE_IP, LIMITES, type Cubeta, type ReglaLimite } from "./lib/limites.ts";

export interface Config {
  origenesPermitidos: string[];
  emisionRealPermitida: boolean;   // interruptor global; false en la Fase 1
  appUrl: string;
}

export interface Usuario { id: string; email: string }

export interface Deps {
  config: Config;
  getUser(token: string): Promise<Usuario | null>;              // valida el JWT con Supabase Auth
  sesionRevocadaDesde(userId: string): Promise<number | null>;   // marca de revocación de sesiones (segundos Unix)
  estadoCuenta(userId: string): Promise<"activa" | "bloqueada" | "sin_perfil">; // un JWT vigente NO basta: se exige perfil activo
  limitar(clave: string, ventanaSeg: number, max: number): Promise<{ permitido: boolean; reintentarEn: number }>; // contador compartido en la base de datos
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
  permiteSinPerfil?: boolean; // SOLO aceptar_invitacion: una cuenta sin perfil puede ejecutarla (la base exige invitación vigente)
  limite: string;           // categoría de límite de peticiones (ver lib/limites.ts)
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
    h["Access-Control-Expose-Headers"] = "Retry-After";
  }
  return h;
}

const respuesta = (req: Request, d: Deps, status: number, cuerpo: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cabeceras(req, d.config), ...extra } });

// Consume una cubeta del limitador. 429 si se agotó; si el limitador falla, "cerrado" rechaza (503) y "abierto" deja pasar.
async function consumir(d: Deps, regla: Pick<ReglaLimite, "falla">, c: Cubeta, id: string, categoria: string): Promise<void> {
  let r: { permitido: boolean; reintentarEn: number };
  try {
    r = await d.limitar(claveLimite(c.ambito, id, categoria, c.ventanaSeg), c.ventanaSeg, c.max);
  } catch (e) {
    if (regla.falla === "abierto") return;
    throw e instanceof ErrorFel ? e : new ErrorFel(503, "Servicio no disponible temporalmente", "limitador");
  }
  if (!r.permitido) {
    throw new ErrorFel(429, "Demasiadas solicitudes; espera un momento e intenta de nuevo", "limite_excedido", r.reintentarEn);
  }
}

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

    const regla = Object.prototype.hasOwnProperty.call(LIMITES, accion.limite) ? LIMITES[accion.limite] : undefined;
    if (!regla) throw new Error(`La acción ${nombre} no declara una categoría de límite válida`);

    // Límite previo a la autenticación (por origen, solo hash de la IP): frena el abuso de peticiones con tokens falsos.
    const origen = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "desconocido").split(",")[0].trim();
    await consumir(deps, { falla: "cerrado" }, LIMITE_IP, await hashCorto(origen), "ip");

    const usuario = await deps.getUser(token);
    if (!usuario) throw new ErrorFel(401, "La sesión no es válida o venció", "sin_sesion");
    const claims = decodificarClaims(token); // el token ya fue validado por Supabase Auth (ver lib/deps.ts)
    const aal = claims.aal === "aal1" || claims.aal === "aal2" ? claims.aal : undefined; // solo valores exactos
    const eventos = eventosAuth(claims);

    // Sesión revocada (p. ej. tras una recuperación de MFA): el token debe contener una autenticación POSTERIOR a la marca.
    // Renovar un token viejo no crea autenticaciones nuevas, así que no sirve para saltarse la revocación.
    // Comparación ESTRICTA y con margen de reloj: un evento en el mismo segundo que la marca es ambiguo y se rechaza.
    // "desde" ya incluye el margen de reloj (la base de datos suma 5 s a la marca). TODOS los eventos deben ser posteriores: se mira el MÁS antiguo.
    const desde = await deps.sesionRevocadaDesde(usuario.id);
    const ahoraS = Math.floor(Date.now() / 1000);
    if (desde !== null && (eventos.primero === null || eventos.primero <= desde || (eventos.ultimo ?? 0) > ahoraS + 300)) {
      throw new ErrorFel(401, "Tu sesión fue revocada; inicia sesión de nuevo", "sesion_revocada");
    }

    // Un JWT vigente NO basta. Cuenta bloqueada: ninguna acción. Cuenta sin perfil: solo la aceptación de una invitación vigente.
    const cuenta = await deps.estadoCuenta(usuario.id);
    if (cuenta === "bloqueada") throw new ErrorFel(403, "La cuenta está desactivada", "cuenta_desactivada");
    if (cuenta === "sin_perfil" && !accion.permiteSinPerfil) {
      throw new ErrorFel(403, "Tu cuenta todavía no tiene acceso a NEXA FEL; necesitas una invitación vigente", "sin_perfil");
    }

    const params = accion.validar(cuerpo);

    // Límites por usuario (antes de autorizar, para limitar también el sondeo de permisos).
    for (const c of regla.cubetas.filter((c) => c.ambito === "usuario")) await consumir(deps, regla, c, usuario.id, accion.limite);

    // Autorización explícita en cada operación (aunque la acción use service_role después).
    const req_ = accion.requisito;
    const esPlataforma = req_.plataforma ? await deps.esPlataforma(usuario.id) : false;
    let permisos: string[] | null = null;
    if (req_.permiso) {
      const empresaId = accion.empresaDe?.(params);
      if (!empresaId) throw new ErrorFel(400, "Falta la empresa", "entrada_invalida");
      permisos = await deps.permisos(empresaId, usuario.id);
    }
    evaluar(req_, { esPlataforma, permisos, aal, totpEn: eventos.totp });

    // Límites por empresa: SOLO después de autorizar, para que nadie agote el cupo de una empresa ajena enviando su id.
    const empresaLimite = accion.empresaDe?.(params);
    if (empresaLimite) {
      for (const c of regla.cubetas.filter((c) => c.ambito === "empresa")) await consumir(deps, regla, c, empresaLimite, accion.limite);
    }

    const datos = await accion.ejecutar({ ...deps, usuario, aal }, params);
    return respuesta(req, deps, 200, { ok: true, datos });
  } catch (e) {
    if (e instanceof ErrorFel) {
      const extra: Record<string, string> = e.reintentarEn ? { "Retry-After": String(e.reintentarEn) } : {};
      return respuesta(req, deps, e.status, { ok: false, error: e.message, codigo: e.codigo }, extra);
    }
    console.error("fel-api error no controlado:", e instanceof Error ? e.message : "desconocido");
    return respuesta(req, deps, 500, { ok: false, error: "Error interno", codigo: "interno" });
  }
}
