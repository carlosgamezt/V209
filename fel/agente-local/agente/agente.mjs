// AGENTE LOCAL de NEXA FEL (Node.js 22 + Playwright). Fase 4 · commit 6: solo habla con el simulador local; ninguna conexión fiscal real.
// Uso:
//   node agente.mjs vincular  --nexa http://127.0.0.1:8787 --codigo XXXX-XXXX-XXXX [--estado carpeta] [--nombre "PC de la empresa"]
//   node agente.mjs ejecutar  --nexa http://127.0.0.1:8787 --simulador http://127.0.0.1:PUERTO [--estado carpeta] [--visible]   (token del simulador en FEL_SIM_TOKEN)
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { abrirAlmacen } from "./almacen.mjs";
import { crearClienteNexa, ErrorNexa } from "./cliente_nexa.mjs";
import { CLAVES_NEXA_INCRUSTADAS, crearConfianza } from "./confianza_nexa.mjs";
import { crearMetricasCliente, esperaAdaptativa } from "./sondeo.mjs";
import { crearClienteSimulador } from "./cliente_simulador.mjs";
import { crearEjecutor } from "./ejecutor.mjs";
import { claveDesdePem, generarPar } from "./firma.mjs";
import { abrirNavegador } from "./navegador.mjs";

export const VERSION = "1.0.0";
const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));
/** `ciclosMs`: si se indica, intervalo FIJO entre ciclos (pruebas); por defecto el agente usa el sondeo adaptativo que indica NEXA. */
export const CONFIG_POR_DEFECTO = { sondeoMs: 1000, renovarMs: 30_000, esperaMaxMs: 15 * 60_000, maxFallosSimulador: 5, ciclosMs: null, demoraCierreMs: 4000, headless: true, majorChromium: Number(process.env.FEL_AGENTE_CHROMIUM_MAJOR ?? 131) };   // 0 solo para desarrollo con otro Chromium; en CI se exige 131

/** Confianza en las respuestas de NEXA: claves incrustadas + las de la configuración (desarrollo/pruebas) + las anunciadas y aprendidas (guardadas en la carpeta del agente). */
export function abrirConfianza(almacen, claves = [], ahora) {
  return crearConfianza({ incrustadas: [...CLAVES_NEXA_INCRUSTADAS, ...claves], persistencia: almacen.persistencia("claves_nexa.json"), ahora });
}

/** Vincula el equipo con una empresa: genera el par Ed25519 (la privada no sale del equipo) y canjea el código de un solo uso. La respuesta de NEXA se verifica ANTES de aceptar nada. */
export async function vincular({ nexa: base, codigo, estado, nombre = "Equipo de la empresa", protector, claves, ca, hostsPermitidos, transporte, ahora }) {
  const almacen = abrirAlmacen(estado, { protector });
  if (almacen.identidad()) throw new Error("Este equipo ya está vinculado. Pide a un administrador que lo revoque en NEXA antes de vincularlo otra vez.");
  const par = generarPar(), confianza = abrirConfianza(almacen, claves, ahora);
  const r = await crearClienteNexa({ base, confianza, ca, hostsPermitidos, transporte, version: VERSION, ahora }).vincular({ codigo, clavePublica: par.publica, nombre, version: VERSION });
  almacen.guardarIdentidad({ nexa: base, agente_id: r.agente_id, empresa_id: r.empresa_id ?? null, clave_publica: par.publica, clavePem: par.privadaPem, vinculado: new Date().toISOString() });
  return { agente_id: r.agente_id };
}

export function crearAgente({ estado, simulador, tokenSimulador, config = {}, chromium, log = () => {}, dormir = dormirReal, reloj, ganchos, protector, claves, ca, hostsPermitidos, transporte, aleatorio = Math.random, ahora }) {
  const cfg = { ...CONFIG_POR_DEFECTO, ...config }, almacen = abrirAlmacen(estado, { protector }), id = almacen.cargarIdentidad();
  if (!id) throw new Error("El equipo no está vinculado: usa «vincular» con el código que genera NEXA.");
  const confianza = abrirConfianza(almacen, claves, ahora), metricas = crearMetricasCliente();
  const nexa = crearClienteNexa({ base: id.nexa, agenteId: id.agente_id, privada: claveDesdePem(id.clavePem), confianza, ca, hostsPermitidos, transporte, version: VERSION, ahora, metricas });
  const { clavePem: _clave, ...identidadPublica } = id; id.clavePem = "";   // la clave en claro no se conserva más de lo necesario
  const empresa = id.empresa_id;
  if (!empresa) throw new Error("La identidad del equipo no incluye la empresa (vuelve a vincularlo).");
  const sim = crearClienteSimulador({ base: simulador, token: tokenSimulador, empresa });
  const pw = chromium ?? createRequire(import.meta.url)("playwright").chromium;
  const ejecutor = crearEjecutor({ nexa, sim, almacen, config: cfg, log, dormir, reloj, ganchos, cierreSolicitado: () => detenido,
    abrirNavegador: (o) => abrirNavegador({ chromium: pw, perfil: almacen.perfil, headless: cfg.headless, majorEsperado: cfg.majorChromium, ...o }) });
  let detenido = false, pausado = false, bloqueado = false, fin = null, estadoActual = "iniciando", hintMs = null, politica = null, fallos = 0;

  /** Toma la política de NEXA: cuándo volver a consultar y si esta versión está bloqueada. */
  function aplicarPolitica(p) {
    if (!p || typeof p !== "object") return;
    politica = p; if (typeof p.siguiente_ms === "number") hintMs = p.siguiente_ms;
    bloqueado = p.bloqueado === true;
  }

  /** Un ciclo: recuperación (si quedó algo) → UNA petición (reclamar, que hace de latido; o solo latido en pausa/bloqueo) → procesar. Devuelve lo que pasó. */
  async function ciclo() {
    const rec = await ejecutor.recuperar(); if (rec && rec.estado !== "limpiada") return rec;
    const soloLatido = pausado || detenido || bloqueado; let r;
    try { r = soloLatido ? await nexa.latido() : await nexa.reclamar(); }
    catch (e) {
      if (e instanceof ErrorNexa && e.esRevocado) { detenido = true; return { estado: "revocado" }; }
      if (e instanceof ErrorNexa && e.esVersion) { aplicarPolitica({ ...(e.politica ?? {}), bloqueado: true }); return { estado: "actualizar" }; }
      throw e;
    }
    aplicarPolitica(r.politica);
    if (soloLatido) return { estado: bloqueado ? "actualizar" : pausado ? "pausado" : "detenido" };      // en pausa/bloqueo/cierre NO se reclaman órdenes nuevas
    if (!r.orden) return { estado: "sin_orden" };
    estadoActual = "procesando"; log("trabajando", r.orden.orden);
    return ejecutor.procesar(r.orden);
  }
  const espera = (errorReciente) => cfg.ciclosMs ? cfg.ciclosMs : esperaAdaptativa({ hintMs, fallosSeguidos: fallos, retryAfterMs: errorReciente?.retryAfterMs ?? 0, aleatorio });
  /** Bucle del agente. Devuelve cuando se pide el cierre o el equipo queda revocado; la orden en curso se resuelve antes de salir (ver «cierreSolicitado»). */
  function ejecutar() {
    fin ??= (async () => {
      while (!detenido) {
        let err = null;
        try { const r = await ciclo(); fallos = 0; estadoActual = r.estado; log("ciclo", r.estado); if (r.estado === "revocado") break; }
        catch (e) { err = e; fallos++; estadoActual = e instanceof ErrorNexa && e.esTransitorio ? (e.codigo === "FEL_RESPUESTA_NO_AUTENTICA" ? "respuesta_no_autenticada" : "sin_conexion") : "error"; log("error", String(e?.message ?? e)); log("ciclo", estadoActual); }
        if (!detenido) await dormir(espera(err));
      }
      estadoActual = "detenido";
    })();
    return fin;
  }
  return {
    ciclo, ejecutar, ejecutor, identidad: identidadPublica,
    pausar: () => { pausado = true; }, reanudar: () => { pausado = false; },
    /** Cierre ordenado: no reclama más, resuelve la orden en curso con el libro y espera a que el bucle termine. */
    async detener() { detenido = true; if (fin) await fin; },
    get estado() { return pausado && !detenido ? "pausado" : estadoActual; },
    get politica() { return politica; }, get bloqueado() { return bloqueado; }, metricas: () => metricas.totales(), confianza,
  };
}

// ---- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), cmd = args[0], opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const estado = opt("estado", join(process.env.FEL_AGENTE_ESTADO ?? join(homedir(), ".nexa-fel-agente")));
  const claves = process.env.FEL_AGENTE_CLAVES_NEXA ? JSON.parse(process.env.FEL_AGENTE_CLAVES_NEXA) : [], hostsPermitidos = (process.env.FEL_AGENTE_HOSTS_NEXA ?? "").split(",").map((h) => h.trim()).filter(Boolean);   // solo desarrollo; el instalador (8c) las incrustará
  try {
    if (cmd === "vincular") { const r = await vincular({ nexa: opt("nexa"), codigo: opt("codigo"), estado, nombre: opt("nombre"), claves, hostsPermitidos }); console.log(`Vinculado. Agente ${r.agente_id}`); }
    else if (cmd === "ejecutar") {
      const a = crearAgente({ estado, simulador: opt("simulador"), tokenSimulador: process.env.FEL_SIM_TOKEN, config: { headless: !args.includes("--visible") }, claves, hostsPermitidos, log: (k, m) => console.log(`[${new Date().toISOString()}] ${k}: ${m}`) });
      for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(s, () => { a.detener(); });
      await a.ejecutar();
    } else { console.error("Uso: agente.mjs vincular|ejecutar (ver el encabezado del archivo)"); process.exit(2); }
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}
