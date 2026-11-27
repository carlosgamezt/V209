// Función de nube de la demostración (Supabase Edge Function «nexa-demo», Deno). Solo atiende /api/* y /salud, y SOLO si la petición trae el secreto del intermediario de Cloudflare:
// llamarla directamente por su dirección de Supabase no sirve de nada. Sin estado propio: todo (datos, sesiones, estado de los simuladores) vive en PostgreSQL, así que puede haber
// varias instancias y reinicios en cualquier momento. No siembra la base ni registra contraseñas (lo hace el aprovisionamiento una vez); nunca imprime credenciales.
import type { BdDemo } from "../src/bd.ts";
import { bdDeEntorno } from "./bd_entorno.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { PERSONAS } from "../src/mundo_practico.ts";
import { Sesiones } from "../src/sesiones.ts";
import { LimiteTasa } from "../src/limite.ts";
import { LimiteTasaPg } from "../src/limite_pg.ts";
import { crearEndurecimiento } from "../src/endurecimiento.ts";
import { leerConfigPublicada } from "../src/publicado.ts";
import { crearApi } from "../src/api.ts";
import { lectorDeAlcanceBd } from "../src/alcance_establecimientos.ts";
import { adminDeBd } from "../src/admin_establecimientos.ts";
import { crearVerificadorJwt } from "../src/verificador_jwt.ts";
import { conIdentidadDeSesion } from "../src/identidad_sesion.ts";
import { crearDigifactParaBd } from "../src/digifact_entorno.ts";
import { crearConsultorNitDesdeEntorno } from "../src/digifact_nit_entorno.ts";
import { crearConsultorCuiDesdeEntorno } from "../src/digifact_cui_entorno.ts";
import { crearCorreoDesdeEntorno } from "../src/correo/entorno.ts";
import { crearPoliticaCorreoDigifactDesdeEntorno } from "../src/digifact_correo_entorno.ts";
import { conMedicion, envolverBd, fetchMedido, marcar } from "../src/medicion.ts";

const igualesSeguro = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const generico = (s: number, m: string) => new Response(JSON.stringify({ codigo: "no_disponible", mensaje: m }), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export interface EntornoFuncion { get(k: string): string | undefined }
export function crearManejador(env: EntornoFuncion, bdExterna?: BdDemo): (req: Request) => Promise<Response> {
  const secreto = env.get("FEL_PROXY_SECRETO") ?? "", url = env.get("FEL_DEMO_BD_URL");
  let listo: Promise<{ api: (r: Request) => Promise<Response>; endurecer: ReturnType<typeof crearEndurecimiento>; bd: BdDemo }> | null = null;
  const iniciar = () => listo ??= (async () => {
    const cfg = leerConfigPublicada((k) => env.get(k), Object.keys(PERSONAS), { exigirClaves: false });
    const t0Inicio = performance.now();
    const bd = envolverBd(bdExterna ?? bdDeEntorno((k) => env.get(k)));   // cuenta y cronometra las consultas (solo números)
    const identidadSesion = env.get("FEL_IDENTIDAD_SESION") === "1", IDENTIDAD_SESION = identidadSesion;   // APAGADO por defecto: exige M-I y M-J aplicadas (R2 · F1-F3)
    const bdApp = identidadSesion ? conIdentidadDeSesion(bd) : bd;   // los servicios (Digifact, correo) usan la MISMA capa de identidad: sus auditorías las firma la sesión de la petición
    const mundo = await prepararBase(bd, { sembrar: false });
    const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = null; sesiones.forzarSeguro = true;
    sesiones.auditar = async (evento, usuario, detalle = {}) => { try { const c = await sesiones.almacen.cuenta(usuario); if (IDENTIDAD_SESION) await bd.rpc("fel_aud_acceso", { p_evento: evento, p_usuario: usuario, p_datos: JSON.stringify(detalle) }); else await bd.filas("select public.fel_auditar($1, $2, $3, $4, $5, $6)", [c?.persona.empresa ?? null, c?.persona.id ?? null, `demo.${evento}`, "sesion", usuario, { ...detalle, existe: !!c }]); } catch { /* la auditoría no debe tumbar la petición */ } };
    const digifact = await crearDigifactParaBd((k) => env.get(k), bdApp, fetchMedido());   // sin FEL_DIGIFACT_* no existe; sin la tabla de la migración 29 prepara y valida pero NO envía nada real
    console.log(`Digifact TEST: ${digifact.motivo}${digifact.servicio ? (digifact.almacenPersistente ? " · almacén persistente" : " · sin almacén persistente: no envía") : ""}`);   // nunca valores
    const nit = crearConsultorNitDesdeEntorno((k) => env.get(k));   // independiente de la certificación: solo sabe consultar NIT y solo para UNA empresa; sin FEL_DIGIFACT_NIT no existe
    const cui = crearConsultorCuiDesdeEntorno((k) => env.get(k));   // independiente de NIT y de la certificación; sin FEL_DIGIFACT_CUI no existe
    console.log(`Consulta de CUI: ${cui.consultor ? "Digifact TEST habilitado para una empresa" : "simulador"}`);   // nunca valores, CUI ni nombres
    console.log(`Consulta de NIT: ${nit.consultor ? "Digifact TEST habilitado para una empresa" : "simulador"}`);   // nunca valores, NIT ni nombres
    const correoDg = crearPoliticaCorreoDigifactDesdeEntorno((k) => env.get(k));   // correo de la factura por DIGIFACT al certificar: independiente de la certificación, NIT y CUI; sin FEL_DIGIFACT_CORREO no existe
    console.log(`Correo por Digifact: ${correoDg.politica ? "habilitado para una empresa y destinatarios de prueba" : "apagado"}`);   // nunca valores
    const correo = crearCorreoDesdeEntorno((k) => env.get(k), bdApp);   // sin FEL_CORREO no existe; con «habilitado» exige remitente, lista de destinatarios de prueba y RESEND_API_KEY
    console.log(`Correo: ${correo.motivo}`);   // nunca valores
    const estabPorUsuario = env.get("FEL_ESTABLECIMIENTO_POR_USUARIO") === "1";   // APAGADO por defecto: exige M-F, M-G y M-H aplicadas (propuestas, NO están en supabase/migrations)
    // W5 (APAGADO por defecto): la Data API con el JWT de la persona. Exige FEL_IDENTIDAD_SESION=1 (transición), la URL pública del proyecto, su llave PÚBLICA y el JWKS (ES256/RS256) para VERIFICAR la firma en cada petición.
    const datosApi = env.get("FEL_DATOS") === "dataapi" ? (() => {
      const url = env.get("FEL_DATA_API_URL"), apikey = env.get("FEL_DATA_API_KEY"), jwks = env.get("FEL_JWKS_URL"); if (!url || !apikey || !jwks) throw new Error("FEL_DATOS=dataapi exige FEL_DATA_API_URL, FEL_DATA_API_KEY (llave pública) y FEL_JWKS_URL");
      const verificarJwt = crearVerificadorJwt({ jwks: async () => await (await fetch(jwks)).json(), emisor: env.get("FEL_JWT_EMISOR") || undefined, audiencia: "authenticated" });
      return { datosApi: { url, apikey }, verificarJwt, jwtDe: (r: Request) => /^Bearer (\S+)$/.exec(r.headers.get("x-usuario-jwt") ?? "")?.[1] ?? null };   // el JWT de la persona viaja en x-usuario-jwt (Authorization lo usa la pasarela de la función)
    })() : {};
    const api = crearApi(bd, mundo, { ...datosApi, identidadSesion, ...(estabPorUsuario ? { alcance: lectorDeAlcanceBd(bd, Sesiones.idDeCookie), adminEst: adminDeBd(bd) } : {}), sesiones, practico: true, mfa: new Map(Object.entries(cfg.semillas)), digifact: digifact.servicio, digifactNit: nit.consultor, digifactCui: cui.consultor, digifactCorreo: correoDg.politica, correo: correo.servicio });
    const endurecer = crearEndurecimiento({ publicado: true, hosts: cfg.hosts, hostDe: (r) => (r.headers.get("x-nexa-host") ?? "").toLowerCase(), ipDe: (r) => r.headers.get("x-nexa-ip") ?? "?",
      limiteLogin: new LimiteTasaPg(bd, Number(env.get("FEL_DEMO_LIMITE_LOGIN") ?? "10"), 60_000),   // compartido entre instancias (PostgreSQL); el general por IP queda por instancia y Cloudflare añade el suyo
      limiteApi: new LimiteTasa(Number(env.get("FEL_DEMO_LIMITE_API") ?? "400"), 60_000) });
    marcar("arranque", performance.now() - t0Inicio);   // solo la primera petición de una instancia nueva paga este tiempo
    return { api, endurecer, bd };
  })();
  const atender = async (req: Request): Promise<Response> => {
    if (secreto.length < 32 || (!url && !bdExterna)) return generico(503, "Servicio no configurado");
    if (!igualesSeguro(req.headers.get("x-nexa-proxy") ?? "", secreto)) return new Response("Prohibido", { status: 403 });
    const u = new URL(req.url), ruta = u.pathname.replace(/^\/nexa-demo(?=\/|$)/, "") || "/";   // Supabase antepone el nombre de la función
    if (ruta !== "/salud" && !ruta.startsWith("/api/")) return new Response("No encontrado", { status: 404 });
    let app; try { app = await iniciar(); } catch (e) { listo = null; console.error("inicio de la función:", (e as Error).message.slice(0, 200)); return generico(503, "Servicio no disponible"); }
    const interna = new Request(new URL(ruta + u.search, u.origin), req);
    const previo = await app.endurecer.previo(interna); if (previo) return previo;
    if (ruta === "/api/diag/latencia" && req.method === "GET") {   // diagnóstico de rendimiento: SOLO números y nombres de región (nunca direcciones, usuarios ni contraseñas)
      const rtt: number[] = []; for (let i = 0; i < 4; i++) { const t0 = performance.now(); await app.bd.filas("select 1"); rtt.push(Math.round(performance.now() - t0)); }
      const bdUrl = env.get("FEL_DEMO_BD_URL") ?? "", reg = /aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com/.exec(bdUrl)?.[1] ?? (/db\.[a-z0-9]+\.supabase\.co/.test(bdUrl) ? "conexion-directa" : "desconocida"), puerto = /:(\d{4,5})\//.exec(bdUrl)?.[1] ?? "?";
      return new Response(JSON.stringify({ selectUnoMs: rtt, regionFuncion: Deno.env.get("SB_REGION") ?? Deno.env.get("DENO_REGION") ?? "desconocida", regionBd: reg, puertoBd: puerto }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    return app.endurecer.asegurar(await app.api(interna));
  };
  return (req: Request) => conMedicion(() => atender(req));
}
