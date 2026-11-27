// W3 · PUERTO DE DATOS con DOS implementaciones durante la transición (arquitectura C):
//   · «pooler»  — hoy: el servidor llama a las funciones `fel_*` por SQL como `nexa_app` (identidad = token de `demo_sesiones`).
//   · «dataapi» — destino: el servidor reenvía el JWT de la persona a la Data API (PostgREST) y llama a `api.*`; la identidad la afirma Supabase Auth y la base solo la comprueba.
// El servidor NO conoce la diferencia: las rutas siguen llamando `bd.rpc("fel_op_x", {...})`. Con `dataapi`, las funciones que existen en `api` salen por la Data API con el JWT de la petición; las demás (pasos del sistema, protocolos del agente,
// auditoría) NO tienen equivalente en `api` y siguen por la conexión interna (nexa_sys en W5). Es decir: la compatibilidad NO puede eludir las restricciones nuevas, porque solo ENVÍA hacia el lado restringido:
//   1) sin JWT en la petición, una función de `api` se rechaza ANTES de salir (nunca se «degrada» a la ruta del token);
//   2) el nombre de la función se valida contra una lista cerrada (CON_ENVOLTORIO ∪ PLATAFORMA ∪ fel_adm_*), y el perfil de esquema es siempre `api`;
//   3) los parámetros de identidad (`p_sesion`, `p_actor`, `p_empresa` de empresa) se retiran, y si el servidor los envió con un valor distinto del de la sesión, se rechaza.
import type { BdDemo } from "./bd.ts";
import { ErrorBd, type Rpc } from "../../proveedores/src/rpc.ts";
import { CON_ENVOLTORIO, PLATAFORMA, ErrorIdentidad, contextoActual, destinoPlataforma, type ContextoPeticion } from "./identidad_sesion.ts";
import { LISTAS } from "./bd.ts";

const ADM_PLATAFORMA = new Set(["acceso_solicitar", "acceso_revocar", "datos_excepcionales_configuracion", "datos_excepcionales_documentos", "empresas_resumen"]);   // `fel_adm_*` de plataforma (M-N las publica con prefijo pla_)

/** Nombre de la función en el esquema `api` (misma regla que el generador de M-N), o null si no se publica en `api`. */
export function nombreApi(fn: string): string | null {
  if (PLATAFORMA.has(fn)) return "pla_" + destinoPlataforma(fn).slice("fel_pla_".length);
  if (fn === "fel_tipos_empresa") return "tipos_empresa";
  if (CON_ENVOLTORIO.has(fn)) return fn.replace(/^fel_op_/, "");
  const m = /^fel_adm_([a-z_0-9]+)$/.exec(fn); if (m) { if (ADM_PLATAFORMA.has(m[1])) return "pla_" + m[1]; return m[1] === "estado" ? "digifact_estado" : m[1]; }
  return null;
}

export interface OpcionesDataApi {
  /** Base de la Data API, p. ej. `https://<ref>.supabase.co` */ url: string;
  /** Llave pública del proyecto (anon/publishable): NO da acceso por sí sola; identifica el proyecto ante la pasarela. */ apikey: string;
  fetch?: typeof fetch;
}

/** Cliente de la Data API: `POST /rest/v1/rpc/<api.fn>` con `Authorization: Bearer <JWT de la persona>` y perfil de esquema `api`. No lleva ninguna credencial de base de datos. */
export function crearRpcDataApi(o: OpcionesDataApi, jwt: () => string | null | undefined): Rpc {
  const f = o.fetch ?? fetch;
  return async (nombre, args) => {
    if (!/^[a-z_0-9]+$/.test(nombre)) throw new Error("nombre de función no válido");
    const claves = Object.keys(args); if (!claves.every((k) => /^p_[a-z_0-9]+$/.test(k))) throw new Error("nombre de parámetro no válido");
    const t = jwt(); if (!t) throw new ErrorIdentidad("Sesión no válida");
    const r = await f(`${o.url.replace(/\/$/, "")}/rest/v1/rpc/${nombre}`, { method: "POST", headers: { "content-type": "application/json", apikey: o.apikey, authorization: `Bearer ${t}`, "content-profile": "api", "accept-profile": "api" }, body: JSON.stringify(args) });
    const txt = await r.text(); let j: unknown = null; if (txt) { try { j = JSON.parse(txt); } catch { j = txt; } }
    if (!r.ok) { const e = (j ?? {}) as { message?: string; code?: string }; const msg = e.message ?? `Data API ${r.status}`; if (r.status === 401 || r.status === 403 && !/^FEL_/.test(msg)) throw new ErrorIdentidad("Sesión no válida"); throw new ErrorBd(msg, e.code); }
    return j;
  };
}

/** Misma forma de resultado que la conexión directa: listas conocidas → lista; el resto → primera fila (o el valor). */
function comoPooler(nombrePooler: string, j: unknown): unknown {
  if (LISTAS.has(nombrePooler)) return Array.isArray(j) ? j : j == null ? [] : [j];
  if (Array.isArray(j)) return j.length === 0 ? null : j[0];
  return j ?? null;
}

/**
 * Devuelve una base cuyo `rpc` usa la Data API para lo que existe en `api` y delega el resto en `bd` (la conexión interna, ya envuelta por la identidad de sesión si hace falta).
 * `contexto()` entrega la petición en curso (con `jwt`). Los accesos SQL directos (`filas`, `ejecutar`, `lote`) NO cambian aquí: pasan a RPC/RLS en W4.
 */
/** Lecturas del piloto W4 (M-O): RPC SECURITY INVOKER; la RLS y la empresa de la sesión deciden las filas. */
export const LECTURAS_API: ReadonlySet<string> = new Set(["clientes_listar", "conceptos_listar", "establecimientos_listar", "estado_catalogos", "documentos_listar", "documento_detalle", "panel_resumen", "reporte_documentos", "artefacto_descargar", "clientes_pagina", "conceptos_pagina", "plan_resumen", "reporte_consumos", "usuarios_resumen", "pla_lectura_resumen", "pla_lectura_planes", "pla_lectura_plan_empresa", "pla_lectura_bolson", "pla_lectura_conciliaciones", "pla_lectura_verificacion"]);

export function conDataApi(bd: BdDemo, o: OpcionesDataApi, contexto: () => ContextoPeticion | undefined = contextoActual): BdDemo {
  const cliente = crearRpcDataApi(o, () => contexto()?.jwt);
  return { ...bd, lecturaApi: async (nombre: string, args: Record<string, unknown> = {}) => { if (!LECTURAS_API.has(nombre)) throw new Error(`lectura no permitida: ${nombre}`); if (!contexto()?.jwt) throw new ErrorIdentidad("Sesión no válida"); return await cliente(nombre, args); }, rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    const dest = nombreApi(fn); if (!dest) return bd.rpc(fn, args);
    const c = contexto(); if (!c?.jwt) throw new ErrorIdentidad("Sesión no válida");
    const { p_sesion: _s, p_actor, p_empresa, ...resto } = args as Record<string, unknown>;
    if (c.actor && p_actor !== undefined && p_actor !== c.actor) throw new ErrorIdentidad("La persona de la llamada no es la de la sesión", "identidad_distinta");
    const objetivo = dest.startsWith("pla_");   // en plataforma `p_empresa` es la empresa OBJETIVO y se conserva; en empresa es la propia y la fija la base
    if (!objetivo && c.empresa && p_empresa !== undefined && p_empresa !== c.empresa) throw new ErrorIdentidad("La empresa de la llamada no es la de la sesión", "identidad_distinta");
    return comoPooler(fn, await cliente(dest, objetivo && p_empresa !== undefined ? { p_empresa, ...resto } : resto));
  } } as BdDemo;
}

/** Interruptor: `FEL_DATOS=dataapi` (con `FEL_DATA_API_URL` y `FEL_DATA_API_KEY`, la llave PÚBLICA) activa la Data API; cualquier otro valor deja el pooler. */
export function elegirDatos(bd: BdDemo, env: (k: string) => string | undefined, contexto?: () => ContextoPeticion | undefined): { modo: "pooler" | "dataapi"; bd: BdDemo } {
  if (env("FEL_DATOS") !== "dataapi") return { modo: "pooler", bd };
  const url = env("FEL_DATA_API_URL"), apikey = env("FEL_DATA_API_KEY");
  if (!url || !apikey) throw new Error("FEL_DATOS=dataapi exige FEL_DATA_API_URL y FEL_DATA_API_KEY (llave pública)");
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(url)) throw new Error("FEL_DATA_API_URL debe ser https (o local)");
  return { modo: "dataapi", bd: conDataApi(bd, { url, apikey }, contexto) };
}
