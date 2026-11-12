// NEXA DE PRUEBA para el agente local: la base real en memoria (PGlite), el orquestador real, el plano de control del agente, el supervisor y las rutas de las personas de la
// demostración, con el canal «portal_playwright» (ambiente simulado) como canal de la empresa. Solo para pruebas locales: 127.0.0.1, sin credenciales ni red externa.
// Añade unas pocas rutas /prueba/* (SOLO aquí, nunca en la demostración): configurar el destino del simulador, listar órdenes y forzar el vencimiento de un arrendamiento.
// Uso: deno run -A nexa_prueba.ts --puerto=9700   (imprime «PRUEBA_LISTA {json}» cuando está lista)
import { crearBd } from "../../demo-facturacion/src/bd.ts";
import { sembrar } from "../../demo-facturacion/src/mundo_demo.ts";
import { crearApi } from "../../demo-facturacion/src/api.ts";
import { montarAgente } from "../../demo-facturacion/src/agente_demo.ts";
import { PREFIJO_AGENTE } from "../../proveedores/src/plano_control_agente.ts";
import { crearAutorizador, entregaPorHttp, destinoPermitido, firmarConcesion } from "../../proveedores/src/autorizacion_humana.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../../proveedores/src/portal_playwright.ts";
import { generarParClaves } from "../../proveedores/src/firma_agente.ts";
import { crearFirmanteRespuestas, firmarAnuncio, firmarRevocacion, type AnuncioClave, type Revocacion } from "../../proveedores/src/firma_respuesta.ts";
import { codificarVersion } from "../../proveedores/src/politica_agente.ts";

const arg = (n: string, d: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const PUERTO = Number(arg("puerto", "9700"));
const bd = await crearBd();
const mundo = await sembrar(bd);
const ana = "00000000-0000-0000-0000-00000000a001";
const canalPortal = (await bd.filas<{ id: string }>("select (public.fel_op_canal_configurar($1, $2, null, 'portal_playwright', 'simulado', true)).id as id", [ana, mundo.empresa]))[0].id;
const mundoPortal = { ...mundo, canal: canalPortal };                                // las certificaciones de esta empresa de prueba van por el canal asistido
// Claves de NEXA para firmar respuestas: k1 (activa) y r0 (reserva, solo firma revocaciones) van INCRUSTADAS en el agente de prueba; k2 se anuncia (firmada por k1) y puede pasar a ser la activa.
const claveK1 = await generarParClaves(), claveR0 = await generarParClaves(), claveK2 = await generarParClaves();
const anuncioK2: AnuncioClave = await firmarAnuncio({ kid: "k1", privada: claveK1.privada }, { kid: "k2", publica: claveK2.publica, desde: "2020-01-01T00:00:00Z", hasta: null });
let anuncios: AnuncioClave[] = [], revocadas: Revocacion[] = [], activa: "k1" | "k2" = "k1";
const firmantes = () => ({ k1: crearFirmanteRespuestas({ kid: "k1", privada: claveK1.privada, anuncios, revocadas }), k2: crearFirmanteRespuestas({ kid: "k2", privada: claveK2.privada, anuncios, revocadas }) });
const firmante = { get kid() { return activa; }, cabeceras: (n: string, st: number, c: Uint8Array) => firmantes()[activa].cabeceras(n, st, c), distribucion: (k: string[]) => firmantes()[activa].distribucion(k) };
const agente = montarAgente(bd, { intervaloMs: Number(Deno.env.get("FEL_AGENTE_SUPERVISOR_MS") ?? "100"), silencio: true, firmante });
const par = await generarParClaves();
let destino: string | null = null;
const autorizador = crearAutorizador({
  rpc: bd.rpc, privada: par.privada, clavePublica: par.publica,
  entregar: (t) => { if (!destino) throw new Error("FEL_DESTINO: no hay simulador configurado"); return entregaPorHttp(destino)(t); },
});
const api = crearApi(bd, mundoPortal, { supervisor: agente.supervisor, autorizador, metricas: agente.metricas, proveedor: new PortalPlaywrightProvider(puertoOrdenesRpc(bd.rpc)) });
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const TLS = Deno.args.includes("--tls");
const AQUI = new URL("./certificados/", import.meta.url);
const tls = TLS ? { cert: await Deno.readTextFile(new URL("localhost.crt", AQUI)), key: await Deno.readTextFile(new URL("localhost.key", AQUI)) } : {};
const servidor = Deno.serve({ hostname: "127.0.0.1", port: PUERTO, ...tls, onListen: ({ port }) => {
  console.log(`PRUEBA_LISTA ${JSON.stringify({ puerto: port, tls: TLS, claves_nexa: [{ kid: "k1", publica: claveK1.publica, desde: "2020-01-01T00:00:00Z", hasta: null }, { kid: "r0", publica: claveR0.publica, desde: "2020-01-01T00:00:00Z", hasta: null }], clave_publica: par.publica, empresa: mundo.empresa, canal: canalPortal, establecimientos: mundo.establecimientos })}`);
} }, async (req) => {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return new Response("Host no permitido", { status: 403 });
  const url = new URL(req.url);
  if (url.pathname.startsWith(PREFIJO_AGENTE)) return agente.plano(req);
  if (url.pathname === "/prueba/config" && req.method === "POST") {
    const b = await req.json() as { simulador?: string };
    if (!b.simulador || !destinoPermitido(b.simulador)) return json({ ok: false, mensaje: "destino no permitido" }, 400);
    destino = b.simulador; return json({ ok: true });
  }
  if (url.pathname === "/prueba/rotar" && req.method === "POST") {   // rotación: k2 pasa a firmar y se anuncia (firmada por k1) en las respuestas
    const b = await req.json() as { activar: "k1" | "k2"; anunciar?: boolean }; activa = b.activar; anuncios = b.anunciar ? [anuncioK2] : []; return json({ ok: true, activa });
  }
  if (url.pathname === "/prueba/revocar-clave" && req.method === "POST") {   // revocación de una clave de respuestas, firmada con la reserva incrustada (r0)
    const b = await req.json() as { kid: string }; revocadas = [...revocadas, await firmarRevocacion({ kid: "r0", privada: claveR0.privada }, b.kid)]; return json({ ok: true });
  }
  if (url.pathname === "/prueba/politica" && req.method === "POST") {   // política de versiones y sondeo (parámetros de plataforma)
    const b = await req.json() as { version_minima?: string; version_recomendada?: string; activo_ms?: number; reposo_ms?: number; actividad_reciente_seg?: number };
    const poner = (k: string, v: number) => bd.filas("update public.plataforma_parametros set valor = $2 where clave = $1", [k, v]);
    if (b.version_minima !== undefined) await poner("agente_version_minima", codificarVersion(b.version_minima));
    if (b.version_recomendada !== undefined) await poner("agente_version_recomendada", codificarVersion(b.version_recomendada));
    if (b.activo_ms !== undefined) await poner("agente_sondeo_activo_ms", b.activo_ms); if (b.reposo_ms !== undefined) await poner("agente_sondeo_reposo_ms", b.reposo_ms);
    if (b.actividad_reciente_seg !== undefined) await poner("agente_actividad_reciente_seg", b.actividad_reciente_seg);
    return json({ ok: true });
  }
  if (url.pathname === "/prueba/ordenes" && req.method === "GET") return json(await bd.filas("select o.id, o.estado, o.token, o.agente_id, o.documento_id, o.operacion_id, o.vista_previa_hash, o.serie, o.numero, o.autorizacion, o.intentos, f.estado as op_estado, d.estado_fiscal from public.ordenes_emision o join public.operaciones_fiscales f on f.id = o.operacion_id join public.documentos d on d.id = o.documento_id order by o.creada_en"));
  if (url.pathname === "/prueba/vencer" && req.method === "POST") {
    const b = await req.json() as { orden: string };
    await bd.filas("update public.ordenes_emision set lease_hasta = clock_timestamp() - interval '1 second' where id = $1", [b.orden]); return json({ ok: true });
  }
  if (url.pathname === "/prueba/concesion" && req.method === "POST") {   // SOLO pruebas: una concesión firmada por NEXA para un caso concreto (duplicados, desajustes…)
    const b = await req.json() as { empresa: string; orden: string; resumen_hash: string; expira_seg?: number };
    const ahora = Date.now(); return json({ token: await firmarConcesion(par.privada, { v: 1, empresa: b.empresa, orden: b.orden, resumen_hash: b.resumen_hash, usuario: "00000000-0000-0000-0000-00000000a001", emitida: new Date(ahora).toISOString(), expira: new Date(ahora + (b.expira_seg ?? 300) * 1000).toISOString(), jti: crypto.randomUUID().replaceAll("-", "") }) });
  }
  if (url.pathname === "/prueba/auditoria" && req.method === "GET") return json(await bd.filas("select accion, entidad_id, actor_user_id, origen, datos from public.auditoria where accion like 'orden.%' or accion like 'agente.%' order by id"));
  if (url.pathname.startsWith("/api/")) return api(req);
  return new Response("No encontrado", { status: 404 });
});
agente.supervisor.iniciar();
let cerrando = false;
async function cierre() { if (cerrando) return; cerrando = true; await agente.supervisor.detener(); await servidor.shutdown(); await bd.cerrar(); Deno.exit(0); }
for (const s of ["SIGINT", "SIGTERM"] as const) { try { Deno.addSignalListener(s, () => { void cierre(); }); } catch { /* sin señal */ } }
await servidor.finished;
