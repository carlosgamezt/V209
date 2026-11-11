// PANEL LOCAL del agente de NEXA FEL: lo que ve la persona al hacer doble clic en «Iniciar agente NEXA». Sin comandos ni conocimientos técnicos:
//   1) se abre una página local (127.0.0.1) con un solo paso: escribir el código que muestra NEXA;  2) después muestra en lenguaje sencillo qué está haciendo el agente;
//   3) botones «Pausar», «Reanudar» y «Cerrar el agente» (cierre ordenado). La confirmación de la factura NUNCA se hace aquí: la autoriza una persona en NEXA.
// Todo local y simulado en esta fase: solo 127.0.0.1, sin SAT, sin certificadores, sin credenciales. Diseño: fel/docs/agente-windows.md.
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { abrirAlmacen } from "../agente/almacen.mjs";
import { crearAgente, vincular } from "../agente/agente.mjs";
import { exigirBaseLocal, exigirBaseNexa } from "../agente/seguridad_red.mjs";
import { iniciarSimulador } from "../simulador/servidor.mjs";

const WEB = fileURLToPath(new URL("./web/", import.meta.url));
const CABECERAS = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const RE_CODIGO = /^[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}$/;

/** Frases en lenguaje sencillo para cada situación (nada de términos técnicos ni códigos internos). */
export const MENSAJES = {
  sin_vincular: "Este equipo todavía no está vinculado con tu empresa.",
  iniciando: "Iniciando…",
  esperando: "Conectado a NEXA. Esperando una factura para preparar.",
  trabajando: "Preparando una factura en la ventana del navegador…",
  vista_previa: "La factura está lista en la ventana. Revísala. Para emitirla, una persona autorizada debe aprobarla en NEXA y luego confirmar en la ventana.",
  pausado: "En pausa. No se prepararán facturas nuevas hasta que reanudes.",
  emitida: "Factura simulada emitida (sin valor fiscal). Ya puedes seguir.",
  descartada: "La factura no se emitió. Puedes volver a intentarlo desde NEXA.",
  incierta: "No se pudo confirmar con certeza el resultado de la última factura. NO la repitas: NEXA la marcó «por verificar» para que dos personas la revisen.",
  fallida: "No se pudo preparar la última factura; no se emitió nada. Revisa los datos en NEXA.",
  perdida: "NEXA ya no considera esta factura como tuya (se venció el tiempo). No se emitió nada desde aquí.",
  revocado: "Este equipo fue desvinculado en NEXA. El agente se detuvo.",
  error: "Ocurrió un problema. El agente seguirá intentándolo.",
  sin_conexion: "Sin conexión con NEXA. El agente reintentará solo; no se pierde nada.",
  respuesta_no_autenticada: "NEXA respondió, pero no se pudo comprobar que la respuesta sea auténtica. Por seguridad no se hace nada hasta poder comprobarlo.",
  actualizar: "Esta versión del agente ya no es compatible. Actualiza el agente para seguir recibiendo facturas.",
  cerrando: "Cerrando el agente de forma ordenada…",
  detenido: "El agente está detenido.",
};

export async function iniciarPanel({ estado, config, log = () => {}, protector, chromium, agenteConfig = {}, abrir = false, ganchos, ca, transporte } = {}) {
  const almacen = abrirAlmacen(estado, { protector });
  const nexaBase = exigirBaseNexa(config.nexa, { hostsPermitidos: config.hostsNexa ?? [] });
  const claves = config.clavesNexa ?? [], hostsPermitidos = config.hostsNexa ?? [];
  let simulador = null, simUrl, simToken;
  if (config.simulador?.modo === "integrado") { simulador = await iniciarSimulador({ clavePublicaNexa: config.simulador.clave_nexa ?? null }); simUrl = simulador.url; simToken = simulador.tokenControl; }
  else { simUrl = exigirBaseLocal(config.simulador?.url, "Simulador"); simToken = config.simulador?.token; if (!simToken) throw new Error("Falta el token del simulador"); }

  const eventos = []; let fase = "sin_vincular", agente = null, cerrando = false, resolverFin;
  const nota = (tipo) => { eventos.push({ t: new Date().toISOString(), tipo, texto: MENSAJES[tipo] }); if (eventos.length > 30) eventos.shift(); };
  const FINALES = ["emitida", "descartada", "incierta", "fallida", "perdida", "revocado", "pausado", "actualizar", "sin_conexion", "respuesta_no_autenticada"];
  const alRegistrar = (tipo, detalle) => {
    log(tipo, detalle);
    if (tipo === "trabajando") { fase = "trabajando"; return; }
    if (tipo === "presentada") { fase = "vista_previa"; nota("vista_previa"); return; }
    if (tipo === "error") { fase = "error"; return; }
    if (tipo !== "ciclo") return;
    const k = detalle === "sin_orden" ? "esperando" : detalle;
    if (!MENSAJES[k] || ["sin_verificar", "limpiada", "detenido"].includes(k)) return;
    if (fase !== k) { fase = k; if (FINALES.includes(k)) nota(k); }
  };
  function arrancarAgente() {
    agente = crearAgente({ estado, simulador: simUrl, tokenSimulador: simToken, protector, chromium, ganchos, claves, ca, hostsPermitidos, transporte, log: alRegistrar, config: agenteConfig });
    fase = "esperando"; nota("esperando"); agente.ejecutar().then(() => { if (!cerrando) { fase = agente.estado === "detenido" ? "revocado" : fase; } });
  }
  if (almacen.identidad()) arrancarAgente(); else nota("sin_vincular");

  const token = randomBytes(18).toString("base64url"); let puerto = 0;
  const responder = (res, st, cuerpo, tipo = "application/json; charset=utf-8") => { res.writeHead(st, { ...CABECERAS, "content-type": tipo }); res.end(typeof cuerpo === "string" || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo)); };
  const leerJson = (req) => new Promise((ok, ko) => {
    if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) return ko(Object.assign(new Error("tipo"), { st: 415 }));
    let n = 0; const t = []; req.on("data", (c) => { n += c.length; if (n > 4096) { ko(Object.assign(new Error("tamano"), { st: 413 })); } else t.push(c); });
    req.on("end", () => { try { ok(JSON.parse(Buffer.concat(t).toString("utf8") || "{}")); } catch { ko(Object.assign(new Error("json"), { st: 400 })); } });
  });
  const vista = () => ({ vinculado: !!almacen.identidad(), fase, mensaje: MENSAJES[fase], estado_agente: agente?.estado ?? null, agente_id: almacen.identidad()?.agente_id ?? null, eventos: eventos.slice(-12), version: "1.0.0", modo_simulador: config.simulador?.modo ?? "externo", conexion: agente?.metricas() ?? null });

  const servidor = http.createServer(async (req, res) => {
    try {
      const h = req.headers.host; if (h !== `127.0.0.1:${puerto}` && h !== `localhost:${puerto}`) return responder(res, 421, { error: "host" });
      const url = new URL(req.url, `http://127.0.0.1:${puerto}`), pre = `/p/${token}`;
      if (url.pathname !== pre && !url.pathname.startsWith(pre + "/")) return responder(res, 404, { error: "no_encontrado" });
      const ruta = url.pathname.slice(pre.length) || "/";
      if (req.method === "GET" && ruta === "/") return responder(res, 200, await readFile(WEB + "panel.html"), "text/html; charset=utf-8");
      if (req.method === "GET" && (ruta === "/panel.css" || ruta === "/panel.js")) return responder(res, 200, await readFile(WEB + ruta.slice(1)), ruta.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      if (req.method === "GET" && ruta === "/api/estado") return responder(res, 200, vista());
      if (req.method === "POST" && ruta.startsWith("/api/")) {
        if (req.headers["x-panel"] !== "1" || (req.headers.origin !== undefined && req.headers.origin !== `http://127.0.0.1:${puerto}` && req.headers.origin !== `http://localhost:${puerto}`)) return responder(res, 403, { error: "no_autorizado" });
        const b = await leerJson(req);
        if (ruta === "/api/vincular") {
          if (almacen.identidad()) return responder(res, 409, { error: "ya_vinculado", mensaje: "Este equipo ya está vinculado." });
          const codigo = String(b.codigo ?? "").trim().toUpperCase(); if (!RE_CODIGO.test(codigo)) return responder(res, 400, { error: "codigo", mensaje: "Revisa el código: son 12 letras y números, por ejemplo 1A2B-3C4D-5E6F." });
          try { await vincular({ nexa: nexaBase, codigo: codigo.replace(/-/g, "").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3"), estado, nombre: String(b.nombre ?? "Equipo de la empresa").slice(0, 80), protector, claves, ca, hostsPermitidos, transporte }); }
          catch (e) { return responder(res, 422, { error: "vinculacion", mensaje: /Código|Codigo|FEL_CODIGO/i.test(String(e.codigo ?? e.message)) ? "Ese código no es válido, ya se usó o venció. Pide uno nuevo en NEXA." : "No se pudo vincular. Revisa el código e inténtalo de nuevo." }); }
          arrancarAgente(); return responder(res, 200, vista());
        }
        if (ruta === "/api/pausar" && agente) { agente.pausar(); fase = "pausado"; nota("pausado"); return responder(res, 200, vista()); }
        if (ruta === "/api/reanudar" && agente) { agente.reanudar(); fase = "esperando"; nota("esperando"); return responder(res, 200, vista()); }
        if (ruta === "/api/cerrar") { responder(res, 200, { ok: true, mensaje: MENSAJES.cerrando }); void cerrar(); return; }
        return responder(res, 404, { error: "no_encontrado" });
      }
      return responder(res, 404, { error: "no_encontrado" });
    } catch (e) { return responder(res, e.st ?? 500, { error: "solicitud" }); }   // mensajes genéricos: nunca trazas
  });
  await new Promise((ok, ko) => { servidor.once("error", ko); servidor.listen(Number(config.puertoPanel ?? 0), "127.0.0.1", ok); });
  puerto = servidor.address().port;
  const urlPanel = `http://127.0.0.1:${puerto}/p/${token}/`;
  const fin = new Promise((r) => { resolverFin = r; });

  /** Cierre ordenado: el agente resuelve la orden en curso (cierra su sesión y consulta el libro), se cierra Chromium y después el panel y el simulador integrado. */
  async function cerrar() {
    if (cerrando) return fin; cerrando = true; fase = "cerrando";
    try { await agente?.detener(); } catch (e) { log("error", String(e?.message ?? e)); }
    await simulador?.detener(); await new Promise((ok) => { servidor.close(() => ok()); servidor.closeAllConnections?.(); });
    try { rmSync(join(estado, "panel.json"), { force: true }); } catch { /* ya no existe */ }
    resolverFin(); return fin;
  }
  writeFileSync(join(estado, "panel.json"), JSON.stringify({ pid: process.pid, url: urlPanel }), { mode: 0o600 });
  if (abrir) abrirEnNavegador(urlPanel);
  return { url: urlPanel, puerto, token, cerrar, fin, agente: () => agente, simulador, estado: vista };
}

/** Abre la página en el navegador predeterminado del sistema (doble clic = todo listo). */
export function abrirEnNavegador(url, { plataforma = process.platform, lanzar = spawn } = {}) {
  const [cmd, args] = plataforma === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : plataforma === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { const p = lanzar(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }); p.on?.("error", () => {}); p.unref?.(); } catch { /* sin navegador: la URL queda impresa */ }
}

/** Lee la configuración del equipo: archivo «configuracion.json» de la carpeta de estado (lo dejará el instalador) y variables de entorno para desarrollo y pruebas. */
export function leerConfiguracion(estado, env = process.env) {
  let archivo = {}; try { archivo = JSON.parse(readFileSync(join(estado, "configuracion.json"), "utf8")); } catch { /* sin archivo */ }
  return {
    nexa: env.FEL_AGENTE_NEXA ?? archivo.nexa,
    simulador: env.FEL_SIM_URL ? { modo: "externo", url: env.FEL_SIM_URL, token: env.FEL_SIM_TOKEN } : (archivo.simulador ?? { modo: "integrado", clave_nexa: env.FEL_SIM_CLAVE_NEXA ?? archivo.clave_nexa ?? null }),
    puertoPanel: Number(env.FEL_AGENTE_PUERTO_PANEL ?? archivo.puertoPanel ?? 0),
    clavesNexa: env.FEL_AGENTE_CLAVES_NEXA ? JSON.parse(env.FEL_AGENTE_CLAVES_NEXA) : (archivo.claves_nexa ?? []),
    hostsNexa: env.FEL_AGENTE_HOSTS_NEXA ? env.FEL_AGENTE_HOSTS_NEXA.split(",").map((h) => h.trim()).filter(Boolean) : (archivo.hosts_nexa ?? []),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mayor = Number(process.versions.node.split(".")[0]);
  if (mayor < 22) { console.error(`Se necesita Node.js 22 o más reciente (este equipo tiene la versión ${process.versions.node}). Instala la versión actual desde nodejs.org y vuelve a abrir el agente.`); process.exit(1); }
  const estado = process.env.FEL_AGENTE_ESTADO ?? join(homedir(), ".nexa-fel-agente");
  try {
    abrirAlmacen(estado);
    // una sola instancia: si ya hay un panel abierto, se vuelve a mostrar en lugar de iniciar otro agente
    const previo = (() => { try { return JSON.parse(readFileSync(join(estado, "panel.json"), "utf8")); } catch { return null; } })();
    if (previo && (() => { try { process.kill(previo.pid, 0); return true; } catch { return false; } })()) { console.log("El agente ya está abierto: se muestra su ventana."); abrirEnNavegador(previo.url); process.exit(0); }
    const config = leerConfiguracion(estado);
    if (!config.nexa) { console.error("Falta la dirección de NEXA (configuracion.json o FEL_AGENTE_NEXA). Pide al administrador la instalación completa."); process.exit(1); }
    const p = await iniciarPanel({ estado, config, abrir: process.env.FEL_AGENTE_NO_ABRIR !== "1", log: (k, m) => { if (process.env.FEL_AGENTE_DEPURAR === "1") console.log(`[${k}] ${m}`); } });
    console.log(`PANEL_LISTO ${JSON.stringify({ url: p.url })}`);
    console.log(`Agente NEXA en marcha. Si no se abrió solo, entra a: ${p.url}`);
    for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(s, () => { void p.cerrar(); });
    await p.fin; process.exit(0);
  } catch (e) { console.error(`No se pudo iniciar el agente: ${e.message}`); process.exit(1); }
}
