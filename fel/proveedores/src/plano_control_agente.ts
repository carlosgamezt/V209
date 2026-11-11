// PLANO DE CONTROL del agente local (lado NEXA): recibe las peticiones HTTP del agente y las traduce a las funciones SQL «fel_sys_agente_*» / «fel_sys_orden_*».
// Cada petición (salvo «vincular») se valida en este orden, y la empresa SIEMPRE sale del agente autenticado (nunca del cuerpo):
//   1) método, tipo de contenido y tamaño; 2) formato de cabeceras; 3) FIRMA Ed25519 con la clave pública del agente (antes de consumir nada);
//   4) agente activo, marca de tiempo (±60 s), nonce de un solo uso (SQL); 5) validación de empresa, estado de la operación/orden y token (SQL).
// Respuestas: códigos estables y mensajes genéricos; nunca trazas, SQL ni detalles internos. Diseño: fel/docs/agente-protocolo.md y agente-seguridad.md.
import { ErrorBd, type Rpc } from "./rpc.ts";
import { mensajeFirmado, sha256Hex, verificarFirma } from "./firma_agente.ts";
import type { FirmanteRespuestas } from "./firma_respuesta.ts";
import type { Metricas } from "./metricas_agente.ts";
import { acotarSondeo, versionBloqueada } from "./politica_agente.ts";

export const PREFIJO_AGENTE = "/api/agente/v1/";
const OPERACIONES = ["vincular", "latido", "reclamar", "progreso", "vista_previa", "resultado"] as const;
type Operacion = typeof OPERACIONES[number];
const MAX_CUERPO = 64 * 1024;

const MENSAJES: Record<string, [number, string]> = {
  FEL_FIRMA: [401, "Petición no autenticada."],
  FEL_RELOJ: [401, "El reloj del equipo difiere del servidor: activa la hora automática de Windows."],
  FEL_REPETICION: [401, "Petición repetida."],
  FEL_REVOCADO: [403, "Este equipo fue desvinculado de la empresa."],
  FEL_EMPRESA: [403, "La orden no pertenece a este equipo."],
  FEL_NO_AUTORIZADO: [403, "No autorizado."],
  FEL_CODIGO: [403, "Código de vinculación no válido, usado o vencido."],
  FEL_FENCING: [409, "La orden ya no te corresponde; no se hizo ningún cambio."],
  FEL_ESTADO: [409, "La orden no está en un estado que lo permita."],
  FEL_ORDEN_DUPLICADA: [409, "Ya existe una orden para esa operación."],
  FEL_CONFLICTO: [409, "La orden ya no admite ese cambio."],
  FEL_VERSION: [426, "Esta versión del agente ya no es compatible: actualízala para seguir recibiendo facturas."],
  FEL_DATOS_INVALIDOS: [422, "Datos no válidos."],
  FEL_LIMITE: [429, "Demasiados intentos; espera unos minutos."],
  FEL_METODO: [405, "Método no permitido."],
  FEL_RUTA: [404, "No encontrado."],
  FEL_TIPO: [415, "Solo se acepta JSON."],
  FEL_TAMANO: [413, "Cuerpo demasiado grande."],
  FEL_CUERPO: [400, "JSON no válido."],
  FEL_INTERNO: [500, "Error interno."],
};
const CABECERAS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
function responder(codigo: string | null, datos: Record<string, unknown> = {}, extra: Record<string, string> = {}): Response {
  if (codigo === null) return new Response(JSON.stringify({ ok: true, ...datos }), { status: 200, headers: CABECERAS });
  const [status, mensaje] = MENSAJES[codigo] ?? MENSAJES.FEL_INTERNO;
  return new Response(JSON.stringify({ ok: false, codigo: MENSAJES[codigo] ? codigo : "FEL_INTERNO", mensaje, ...datos }), { status, headers: { ...CABECERAS, ...extra } });
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const RE_NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const RE_FIRMA = /^[A-Za-z0-9_-]{86}$/;
type Obj = Record<string, unknown>;
const cadena = (x: unknown, max: number, opcional = false): string | null | undefined => {
  if (x === undefined || x === null) return opcional ? null : undefined;
  return typeof x === "string" && x.length <= max ? x : undefined;
};
const entero = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) && x >= 1 ? x : null);

export interface EventoPlano { op: string; codigo: string; status: number; ms: number; agente?: string }
export interface OpcionesPlano {
  rpc: Rpc; registrar?: (e: EventoPlano) => void;
  /** Si se entrega, TODAS las respuestas llevan la firma de NEXA ligada al nonce de la petición (x-nexa-kid / x-nexa-ts / x-nexa-firma). */
  firmante?: FirmanteRespuestas;
  /** Contadores de uso por agente y hora (se vuelcan a la base por lotes con `metricas.vaciar()`). */
  metricas?: Metricas;
}
const CLAVES_CLIENTE = ["reconexiones", "errores_red", "no_autenticas", "peticiones"] as const;

/** Devuelve el manejador de las peticiones «/api/agente/v1/*». No depende del servidor HTTP: recibe y devuelve Request/Response estándar. */
export function crearPlanoControl(op: OpcionesPlano): (req: Request) => Promise<Response> {
  const { rpc } = op;
  const sql = async <T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> => await rpc(fn, args) as T;
  /** Política que se comunica al agente: versiones, si está bloqueado y cuándo volver a consultar (límites seguros). */
  const politicaPublica = (pol: Obj, version: unknown, forzarMs?: number) => ({ politica: {
    version_minima: Number(pol.version_minima), version_recomendada: Number(pol.version_recomendada), bloqueado: versionBloqueada(version, Number(pol.version_minima)),
    siguiente_ms: acotarSondeo(forzarMs ?? Number(pol.siguiente_ms)) } });
  /** Claves nuevas/revocadas que el agente aún no conoce (según los kid que declara). */
  const distribucion = (kids: unknown) => op.firmante ? op.firmante.distribucion(Array.isArray(kids) ? kids.filter((k): k is string => typeof k === "string" && k.length <= 64).slice(0, 20) : []) : {};
  /** Contadores que informa el propio agente (reconexiones, errores de red…): solo enteros acotados. */
  const contarCliente = (agente: string, m: unknown) => {
    if (!op.metricas || m === null || typeof m !== "object") return;
    for (const k of CLAVES_CLIENTE) { const n = (m as Obj)[k]; if (typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 1_000_000) op.metricas.sumar(agente, `cliente_${k}`, n); }
  };

  async function leerCuerpo(req: Request): Promise<{ bytes: Uint8Array } | Response> {
    const largo = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(largo) && largo > MAX_CUERPO) return responder("FEL_TAMANO");
    const lector = req.body?.getReader(); const partes: Uint8Array[] = []; let total = 0;
    if (lector) for (;;) { const { done, value } = await lector.read(); if (done) break; total += value.length; if (total > MAX_CUERPO) { await lector.cancel().catch(() => {}); return responder("FEL_TAMANO"); } partes.push(value); }
    const bytes = new Uint8Array(total); let o = 0; for (const p of partes) { bytes.set(p, o); o += p.length; }
    return { bytes };
  }

  async function ejecutar(operacion: Operacion, agente: string, b: Obj): Promise<Response> {
    switch (operacion) {
      case "latido": {
        const version = cadena(b.version, 40, true), error = cadena(b.error, 40, true);
        if (version === undefined || error === undefined) return responder("FEL_DATOS_INVALIDOS");
        contarCliente(agente, b.metricas);
        const estado = await sql<Obj>("fel_sys_agente_latido", { p_agente: agente, p_version: version, p_error: error });
        const pol = await sql<Obj>("fel_sys_agente_politica", { p_agente: agente });
        return responder(null, { ...estado, ...politicaPublica(pol, version), ...distribucion(b.kids) });
      }
      case "reclamar": {   // también hace de latido: una sola petición por ciclo (cada invocación cuesta)
        const version = cadena(b.version, 40, true);
        if (version === undefined) return responder("FEL_DATOS_INVALIDOS");
        contarCliente(agente, b.metricas);
        await sql<Obj>("fel_sys_agente_latido", { p_agente: agente, p_version: version, p_error: cadena(b.error, 40, true) ?? null });
        const pol = await sql<Obj>("fel_sys_agente_politica", { p_agente: agente });
        if (versionBloqueada(version, Number(pol.version_minima))) return responder("FEL_VERSION", { ...politicaPublica(pol, version), ...distribucion(b.kids) });   // sin órdenes nuevas; las ya reclamadas pueden terminar
        const r = await sql<Obj | null>("fel_sys_orden_reclamar", { p_agente: agente });
        return responder(null, { orden: r ?? null, ...politicaPublica(pol, version, r ? 2000 : undefined), ...distribucion(b.kids) });
      }
      case "progreso": {
        const orden = typeof b.orden === "string" && RE_UUID.test(b.orden) ? b.orden : null, token = entero(b.token), fase = cadena(b.fase, 40);
        if (!orden || !token || !fase) return responder("FEL_DATOS_INVALIDOS");
        return responder(null, await sql<Obj>("fel_sys_orden_progreso", { p_agente: agente, p_orden: orden, p_token: token, p_fase: fase }));
      }
      case "vista_previa": {   // el agente informa lo que el simulador REALMENTE muestra; NEXA lo contrasta y una PERSONA decide (fel/docs/agente-confirmacion-humana.md)
        const orden = typeof b.orden === "string" && RE_UUID.test(b.orden) ? b.orden : null, token = entero(b.token), hash = cadena(b.hash, 64);
        const resumen = b.resumen !== null && typeof b.resumen === "object" && !Array.isArray(b.resumen) ? b.resumen : null;
        if (!orden || !token || !hash || !resumen) return responder("FEL_DATOS_INVALIDOS");
        return responder(null, await sql<Obj>("fel_sys_orden_vista_previa", { p_agente: agente, p_orden: orden, p_token: token, p_resumen: resumen, p_hash: hash }));
      }
      case "resultado": {
        const orden = typeof b.orden === "string" && RE_UUID.test(b.orden) ? b.orden : null, token = entero(b.token), tipo = cadena(b.tipo, 40);
        const serie = cadena(b.serie, 40, true), numero = cadena(b.numero, 40, true), autorizacion = cadena(b.autorizacion, 80, true), detalle = cadena(b.detalle, 60, true);
        if (!orden || !token || !tipo || serie === undefined || numero === undefined || autorizacion === undefined || detalle === undefined) return responder("FEL_DATOS_INVALIDOS");
        return responder(null, await sql<Obj>("fel_sys_orden_resultado", { p_agente: agente, p_orden: orden, p_token: token, p_tipo: tipo, p_serie: serie, p_numero: numero, p_autorizacion: autorizacion, p_detalle: detalle }));
      }
      default: return responder("FEL_RUTA");
    }
  }

  async function manejar(req: Request): Promise<{ resp: Response; op: string; agente?: string }> {
    const url = new URL(req.url);
    const nombre = url.pathname.startsWith(PREFIJO_AGENTE) ? url.pathname.slice(PREFIJO_AGENTE.length) : "";
    const operacion = (OPERACIONES as readonly string[]).includes(nombre) ? nombre as Operacion : null;
    if (!operacion) return { resp: responder("FEL_RUTA"), op: "desconocida" };
    if (req.method !== "POST") return { resp: responder("FEL_METODO", {}, { allow: "POST" }), op: operacion };
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { resp: responder("FEL_TIPO"), op: operacion };
    const leido = await leerCuerpo(req); if (leido instanceof Response) return { resp: leido, op: operacion };
    let cuerpo: Obj;
    try { const o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(leido.bytes) || "{}"); if (o === null || typeof o !== "object" || Array.isArray(o)) throw 0; cuerpo = o as Obj; }
    catch { return { resp: responder("FEL_CUERPO"), op: operacion }; }

    if (operacion === "vincular") {   // sin firma: el código de un solo uso es la credencial
      const codigo = cadena(cuerpo.codigo, 20), clave = cadena(cuerpo.clave_publica, 64), nombreAg = cadena(cuerpo.nombre, 80), version = cadena(cuerpo.version, 40, true);
      if (!codigo || !clave || !nombreAg || version === undefined) return { resp: responder("FEL_DATOS_INVALIDOS"), op: operacion };
      const polV = await sql<Obj>("fel_sys_agente_politica", { p_agente: null });
      if (versionBloqueada(version, Number(polV.version_minima))) return { resp: responder("FEL_VERSION", politicaPublica(polV, version)), op: operacion };   // antes de gastar el código
      const r = await sql<Obj>("fel_sys_agente_vincular", { p_codigo: codigo, p_clave_publica: clave, p_nombre: nombreAg, p_version: version });
      if (typeof r.error === "string") return { resp: responder(r.error), op: operacion };
      return { resp: responder(null, { agente_id: r.agente_id, empresa_id: r.empresa_id, empresa: r.empresa, ...politicaPublica(polV, version), ...distribucion([]) }), op: operacion, agente: String(r.agente_id) };
    }

    // ---- autenticación: formato → firma → (agente activo, reloj, nonce) → acción
    const h = req.headers, agente = h.get("x-agente") ?? "", ts = h.get("x-ts") ?? "", nonce = h.get("x-nonce") ?? "", firma = h.get("x-firma") ?? "";
    if (!RE_UUID.test(agente) || !RE_TS.test(ts) || !RE_NONCE.test(nonce) || !RE_FIRMA.test(firma)) return { resp: responder("FEL_FIRMA"), op: operacion };
    const k = await sql<{ clave_publica: string; estado: string } | null>("fel_sys_agente_clave", { p_agente: agente.toLowerCase() });
    // agente desconocido y firma inválida reciben la MISMA respuesta (sin oráculo de existencia)
    const valida = k ? await verificarFirma(k.clave_publica, mensajeFirmado("POST", url.pathname, ts, nonce, await sha256Hex(leido.bytes)), firma) : false;
    if (!k || !valida) return { resp: responder("FEL_FIRMA"), op: operacion };
    if (k.estado !== "activo") return { resp: responder("FEL_REVOCADO"), op: operacion, agente };   // solo quien posee la clave privada llega aquí
    const auth = await sql<{ ok: boolean; error?: string; max_seg?: number }>("fel_sys_agente_autenticar", { p_agente: agente.toLowerCase(), p_ts: ts, p_nonce: nonce });
    if (!auth.ok) return { resp: responder(auth.error ?? "FEL_FIRMA", auth.max_seg ? { max_seg: auth.max_seg } : {}), op: operacion, agente };
    return { resp: await ejecutar(operacion, agente.toLowerCase(), cuerpo), op: operacion, agente };
  }

  return async (req: Request): Promise<Response> => {
    const t0 = performance.now(); let resultado: { resp: Response; op: string; agente?: string };
    try { resultado = await manejar(req); }
    catch (e) {
      const codigo = e instanceof ErrorBd && MENSAJES[e.codigo] ? e.codigo : "FEL_INTERNO";
      resultado = { resp: responder(codigo), op: "error" };
      if (codigo === "FEL_INTERNO") console.error("plano de control del agente: error interno", e instanceof ErrorBd ? e.codigo : (e as Error)?.name);   // sin mensaje ni datos
    }
    let codigo = "ok"; if (resultado.resp.status !== 200) { try { codigo = (await resultado.resp.clone().json()).codigo ?? "error"; } catch { codigo = "error"; } }
    const ms = Math.round(performance.now() - t0);
    op.registrar?.({ op: resultado.op, codigo, status: resultado.resp.status, ms, agente: resultado.agente });
    if (op.metricas && resultado.agente) {
      op.metricas.sumar(resultado.agente, `peticion:${resultado.op.replace(/[^a-z_]/g, "_")}`);
      op.metricas.sumar(resultado.agente, `estado:${resultado.op.replace(/[^a-z_]/g, "_")}:${resultado.resp.status}`);
      if (codigo !== "ok" && /^[A-Z_]{3,30}$/.test(codigo)) op.metricas.sumar(resultado.agente, `error:${codigo}`);
    }
    return await firmar(req, resultado.resp);
  };

  /** Firma la respuesta con la clave de NEXA, ligada al nonce de ESTA petición (si no vino uno válido, «-»). */
  async function firmar(req: Request, resp: Response): Promise<Response> {
    if (!op.firmante) return resp;
    const nonce = req.headers.get("x-nonce") ?? ""; const bytes = new Uint8Array(await resp.arrayBuffer());
    const cab = new Headers(resp.headers); for (const [k, v] of Object.entries(await op.firmante.cabeceras(RE_NONCE.test(nonce) ? nonce : "-", resp.status, bytes))) cab.set(k, v);
    return new Response(bytes, { status: resp.status, headers: cab });
  }
}
