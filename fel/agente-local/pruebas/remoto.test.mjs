// TRANSPORTE REMOTO (8a) de extremo a extremo contra el NEXA REAL de prueba servido por HTTPS (Deno + base de datos): el agente solo confía en el certificado de prueba,
// verifica cada respuesta firmada, aprende claves rotadas, acata la política de versiones y el sondeo del servidor, informa métricas y resiste a un intermediario hostil
// (respuestas perdidas, alteradas, repetidas, sin firma o «revocados» inventados). Todo local y simulado.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirAlmacen } from "../agente/almacen.mjs";
import { crearAgente, vincular } from "../agente/agente.mjs";
import { crearTransporte } from "../agente/transporte.mjs";
import { arrancarNexa, arrancarSimulador, nuevaOrden, ordenDe, persona, pulsarConfirmar } from "./ayudas.mjs";

let nexa, sim, per; const dirs = [];
test.before(async () => { nexa = await arrancarNexa({ tls: true }); sim = await arrancarSimulador(nexa); per = persona(nexa); });
test.after(async () => { await sim?.detener(); await nexa?.parar(); for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const temp = () => { const d = mkdtempSync(join(tmpdir(), "nexa-rm-")); dirs.push(d); return d; };
const conLimite = (p, ms = 60000) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error("tiempo agotado")), ms))]);
const codigoNuevo = async () => (await nexa.api("ana", "POST", "/api/agentes/codigo", {})).json.codigo;
const CFG = { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 800, headless: true };
const metricasNexa = async () => (await nexa.api("ana", "GET", "/api/agentes/metricas?horas=24")).json;
const conPagina = () => { let res; const pagina = new Promise((r) => { res = r; }); return { pagina, punto: async (n, c) => { if (n === "despues_de_presentar") res(c.pagina); } }; };

/** Intermediario hostil entre el agente y NEXA: reenvía a NEXA (por HTTPS, confiando en el certificado de prueba) y luego pervierte la respuesta según el modo. */
async function intermediario() {
  const e = { modo: "pasar", guardada: null, reenviadas: 0 };
  const srv = http.createServer((req, res) => {
    const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => {
      const u = new URL(nexa.base); const cuerpo = Buffer.concat(c);
      const r2 = https.request({ hostname: u.hostname, port: u.port, path: req.url, method: req.method, ca: nexa.ca, agent: false, headers: { "content-type": req.headers["content-type"], "content-length": cuerpo.length, ...Object.fromEntries(["x-agente", "x-ts", "x-nonce", "x-firma"].filter((k) => req.headers[k]).map((k) => [k, req.headers[k]])) } }, (resp) => {
        const t = []; resp.on("data", (x) => t.push(x)); resp.on("end", () => {
          e.reenviadas++; const real = { status: resp.statusCode, headers: resp.headers, cuerpo: Buffer.concat(t) };
          if (!e.guardada) e.guardada = real;
          const enviar = (r, h = r.headers, b = r.cuerpo, st = r.status) => { res.writeHead(st, h); res.end(b); };
          switch (e.modo) {
            case "perder": return req.socket.destroy();                                                 // NEXA ejecutó la petición pero la respuesta nunca llega
            case "alterar": return enviar(real, Object.fromEntries(Object.entries(real.headers).filter(([k]) => k !== "content-length")), Buffer.from(real.cuerpo.toString().replace("{", "{ ")));   // un byte distinto
            case "repetir": return enviar(e.guardada);                                                   // se repite una respuesta válida ANTERIOR
            case "sin_firma": return enviar(real, Object.fromEntries(Object.entries(real.headers).filter(([k]) => !k.startsWith("x-nexa-"))));
            case "revocado_falso": return enviar(real, { "content-type": "application/json" }, Buffer.from(JSON.stringify({ ok: false, codigo: "FEL_REVOCADO", mensaje: "falso" })), 403);
            default: return enviar(real);
          }
        });
      }); r2.on("error", () => req.socket.destroy()); r2.end(cuerpo);
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { e, url: `http://127.0.0.1:${srv.address().port}`, cerrar: () => new Promise((ok) => { srv.close(ok); srv.closeAllConnections?.(); }) };
}
/** Agente nuevo vinculado A TRAVÉS de `base` (la identidad recuerda ese destino). */
async function agenteVia(base, { config = {}, ganchos, dormirFn, transporte } = {}) {
  const dir = temp(); await vincular({ nexa: base, codigo: await codigoNuevo(), estado: dir, ...nexa.opcionesAgente, transporte });
  return { dir, ag: crearAgente({ estado: dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos, dormir: dormirFn, transporte, ...nexa.opcionesAgente, config: { ...CFG, ...config } }) };
}

test("HTTPS de extremo a extremo: sin confiar en el certificado no se vincula ni se gasta el código; con la confianza correcta el flujo completo funciona y NEXA (Deno) firma lo que el agente (Node) verifica", async () => {
  const cod = await codigoNuevo(), d1 = temp();
  await assert.rejects(vincular({ nexa: nexa.base, codigo: cod, estado: d1, claves: nexa.claves }), (e) => e.codigo === "FEL_TLS");     // sin `ca`: el certificado de prueba no es de confianza
  assert.equal(abrirAlmacen(d1).identidad(), null, "no quedó identidad");
  const d2 = temp(); await vincular({ nexa: nexa.base, codigo: cod, estado: d2, ...nexa.opcionesAgente });                                   // el MISMO código sigue valiendo: nunca llegó a NEXA
  const g = conPagina(), ag = crearAgente({ estado: d2, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos: { punto: g.punto }, ...nexa.opcionesAgente, config: CFG });
  const { orden } = await nuevaOrden(nexa); const corrida = ag.ciclo(); const pag = await conLimite(g.pagina);
  assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(pag)).resultado, "Emisión simulada registrada");
  assert.equal((await conLimite(corrida)).estado, "emitida"); assert.equal((await ordenDe(nexa, orden)).estado, "completada");
  assert.ok(ag.politica && typeof ag.politica.siguiente_ms === "number", "el agente recibió la política firmada");
});

test("con un intermediario hostil: respuestas ALTERADAS, REPETIDAS, SIN FIRMA o «revocado» inventado se rechazan; el agente reintenta sin detenerse", async () => {
  const x = await intermediario();
  try {
    const { ag } = await agenteVia(x.url); assert.equal((await ag.ciclo()).estado, "sin_orden");           // una respuesta válida de verdad (será la que se repita)
    for (const modo of ["alterar", "sin_firma", "revocado_falso", "repetir"]) {
      x.e.modo = modo; const antes = ag.metricas().no_autenticas;
      await assert.rejects(ag.ciclo(), (e) => e.codigo === "FEL_RESPUESTA_NO_AUTENTICA" && e.esRevocado === false, modo);
      assert.equal(ag.metricas().no_autenticas, antes + 1, modo);
    }
    assert.notEqual(ag.estado, "detenido", "ninguna respuesta falsa detuvo al agente");
    x.e.modo = "pasar"; assert.equal((await ag.ciclo()).estado, "sin_orden", "con el camino limpio vuelve a funcionar");
  } finally { await x.cerrar(); }
});

test("RESPUESTA PERDIDA: NEXA entregó la orden pero la respuesta no llegó; el agente reintenta, recupera SU orden (token nuevo) y la procesa una sola vez", async () => {
  const x = await intermediario(); const g = conPagina();
  try {
    const { ag } = await agenteVia(x.url, { ganchos: { punto: g.punto } }); const { orden } = await nuevaOrden(nexa);
    x.e.modo = "perder"; await assert.rejects(ag.ciclo(), (e) => e.codigo === "FEL_RED");
    assert.equal((await ordenDe(nexa, orden)).estado, "reclamada", "NEXA ya la había reclamado para este agente"); assert.equal((await ordenDe(nexa, orden)).token, 1);
    x.e.modo = "pasar"; const corrida = ag.ciclo(); const pag = await conLimite(g.pagina);
    assert.equal((await ordenDe(nexa, orden)).token, 2, "el propio agente recupera su orden con un token nuevo (fencing)");
    assert.equal((await per.autorizar(orden)).status, 200); await pulsarConfirmar(pag); assert.equal((await conLimite(corrida)).estado, "emitida");
    const l = await fetch(`${sim.url}/control/emisiones?empresa=${nexa.info.empresa}&referencia=${orden}`, { headers: { "x-control-token": sim.tokenControl } }).then((r) => r.json()); assert.equal(l.length, 1, "una sola emisión");
  } finally { await x.cerrar(); }
});

test("VERSIÓN MÍNIMA de extremo a extremo: con el mínimo por encima de esta versión el agente no recibe órdenes (la orden sigue pendiente) y avisa; al bajar el mínimo trabaja", async () => {
  const { ag, dir } = await agenteVia(nexa.base); const { orden } = await nuevaOrden(nexa);
  await nexa.prueba("POST", "/prueba/politica", { version_minima: "9.0.0", version_recomendada: "9.1.0" });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await ag.ciclo()).estado, "actualizar");
    assert.equal(ag.bloqueado, true); assert.equal(ag.politica.version_recomendada, 9_001_000); assert.equal((await ordenDe(nexa, orden)).estado, "pendiente", "NEXA no le entregó nada");
    const a = await metricasNexa(); assert.ok(a.totales["error:FEL_VERSION"] >= 1, "el servidor contó los bloqueos");
  } finally { await nexa.prueba("POST", "/prueba/politica", { version_minima: "0.0.0", version_recomendada: "0.0.0" }); }
  const g = conPagina(); const ag2 = crearAgente({ estado: dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos: { punto: g.punto }, ...nexa.opcionesAgente, config: CFG });
  const corrida = ag2.ciclo(); const pag = await conLimite(g.pagina); assert.equal((await per.autorizar(orden)).status, 200); await pulsarConfirmar(pag); assert.equal((await conLimite(corrida)).estado, "emitida");
});

test("SONDEO ADAPTATIVO de extremo a extremo: el agente espera lo que NEXA indica (activo si hubo órdenes recientes, reposo si no) con variación aleatoria", async () => {
  await nexa.prueba("POST", "/prueba/politica", { activo_ms: 2500, reposo_ms: 40000, actividad_reciente_seg: 3600 });
  try {
    const medir = async () => { const esperas = []; const { ag } = await agenteVia(nexa.base, { config: { ciclosMs: null }, dormirFn: async (ms) => { esperas.push(ms); if (esperas.length >= 3) ag.detener(); } }); ag.pausar(); await ag.ejecutar(); return esperas; };
    const activo = await medir(); assert.ok(activo.every((m) => m >= 2000 && m <= 3000), `con actividad reciente ≈ 2,5 s ±20 %: ${activo}`);
    await nexa.prueba("POST", "/prueba/politica", { actividad_reciente_seg: 0 });
    const reposo = await medir(); assert.ok(reposo.every((m) => m >= 32000 && m <= 48000), `en reposo ≈ 40 s ±20 %: ${reposo}`);
    assert.ok(new Set([...activo, ...reposo]).size > 3, "con variación aleatoria");
  } finally { await nexa.prueba("POST", "/prueba/politica", { activo_ms: 3000, reposo_ms: 30000, actividad_reciente_seg: 300 }); }
});

test("MÉTRICAS de extremo a extremo: las peticiones, los errores y las reconexiones del agente quedan registrados por empresa para estimar costos", async () => {
  // caída simulada de la red: el transporte falla dos veces y luego funciona
  const real = crearTransporte({ ca: nexa.ca }); let fallos = 0; const transporte = { enviar: (o) => (o.url.endsWith("/reclamar") && fallos++ < 2 ? Promise.reject(Object.assign(new Error("x"), { codigo: "RED" })) : real.enviar(o)) };
  const { ag } = await agenteVia(nexa.base, { transporte });
  await assert.rejects(ag.ciclo()); await assert.rejects(ag.ciclo()); await ag.ciclo(); await ag.ciclo();
  assert.deepEqual(ag.metricas(), { peticiones: 4, errores_red: 2, no_autenticas: 0, reconexiones: 1 });
  const m = await metricasNexa();
  assert.ok(m.totales["peticion:reclamar"] >= 2 && m.totales["cliente_errores_red"] >= 2 && m.totales["cliente_reconexiones"] >= 1, JSON.stringify(m.totales));
  assert.ok(m.peticiones >= 3 && m.proyeccion_30_dias > 0 && Array.isArray(m.serie));
  assert.equal((await nexa.api("pedro", "GET", "/api/agentes/metricas?horas=24")).status, 200, "el lector con permiso de canales las ve");
  assert.equal((await nexa.api("ana", "GET", "/api/agentes/metricas?horas=0")).status, 400);
});

test("REVOCACIÓN firmada de extremo a extremo: un equipo revocado recibe un 403 FIRMADO, se detiene y no recibe ni toca órdenes", async () => {
  const { ag } = await agenteVia(nexa.base); const { orden } = await nuevaOrden(nexa);
  assert.equal((await nexa.api("ana", "POST", "/api/agentes/revocar", { agente: ag.identidad.agente_id })).status, 200);
  assert.equal((await ag.ciclo()).estado, "revocado"); assert.equal((await ordenDe(nexa, orden)).estado, "pendiente");
});

// (ÚLTIMA: deja revocada la clave k1 del NEXA de prueba, por eso ninguna prueba puede ir después)
test("ROTACIÓN de claves de NEXA de extremo a extremo: NEXA pasa a firmar con k2 (anunciada por k1) y luego revoca k1; el agente sigue funcionando y lo recuerda tras reiniciar", async () => {
  const { ag, dir } = await agenteVia(nexa.base); await ag.ciclo(); assert.deepEqual(ag.confianza.kids().sort(), ["k1", "r0"]);
  await nexa.prueba("POST", "/prueba/rotar", { activar: "k2", anunciar: true });
  try {
    await ag.ciclo(); assert.deepEqual(ag.confianza.kids().sort(), ["k1", "k2", "r0"], "aprendió k2 del anuncio firmado por k1");
    await nexa.prueba("POST", "/prueba/revocar-clave", { kid: "k1" });
    await ag.ciclo(); assert.deepEqual(ag.confianza.kids().sort(), ["k2", "r0"], "k1 quedó revocada con la clave de reserva incrustada");
    // el agente reiniciado conserva lo aprendido (sin necesidad de volver a recibir los anuncios)
    await nexa.prueba("POST", "/prueba/rotar", { activar: "k2", anunciar: false });
    const nuevo = crearAgente({ estado: dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ...nexa.opcionesAgente, config: CFG }); assert.deepEqual(nuevo.confianza.kids().sort(), ["k2", "r0"]); await nuevo.ciclo();
  } finally { /* sin restaurar: k1 queda revocada a propósito */ }
});

