// PANEL y arranque del agente (la experiencia «doble clic»): seguridad del panel local, vinculación desde la página, estados en lenguaje sencillo, pausa, cierre ordenado
// (también con la vista previa abierta) y RECUPERACIÓN tras matar el proceso. Todo local y simulado; sin SAT ni credenciales.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { abrirAlmacen } from "../agente/almacen.mjs";
import { vincular } from "../agente/agente.mjs";
import { iniciarPanel, MENSAJES, abrirEnNavegador, leerConfiguracion } from "../lanzador/panel.mjs";
import { arrancarNexa, arrancarSimulador, esperar, nuevaOrden, ordenDe, persona, pulsarConfirmar, dormir } from "./ayudas.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const dirs = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "nexa-panel-")); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const PANEL = fileURLToPath(new URL("../lanzador/panel.mjs", import.meta.url));
const CFG = { agente: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 800, headless: true } };

/** Petición cruda al panel (permite fijar Host y Origin). */
const pedir = (puerto, metodo, ruta, { cuerpo, cab = {}, host } = {}) => new Promise((ok, ko) => {
  const t = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  const r = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { ...(t !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(t) } : {}), ...(host ? { host } : {}), ...cab } }, (res) => {
    const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => { const s = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(s); } catch { /* html */ } ok({ status: res.statusCode, json: j, texto: s, h: res.headers }); });
  }); r.on("error", ko); if (t !== undefined) r.write(t); r.end();
});

test("SEGURIDAD del panel: solo 127.0.0.1, ruta secreta, cabecera propia en las acciones, Host y Origin ajenos, tipos y tamaños; mensajes genéricos", async () => {
  const estado = temp(); const p = await iniciarPanel({ estado, config: { nexa: "http://127.0.0.1:9", simulador: { modo: "integrado" } }, agenteConfig: CFG.agente });
  try {
    const base = new URL(p.url).pathname; assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+\/p\/[A-Za-z0-9_-]{20,}\/$/);
    const r = await pedir(p.puerto, "GET", base); assert.equal(r.status, 200); assert.match(r.texto, /Agente NEXA FEL/); assert.equal(r.h["cache-control"], "no-store"); assert.match(r.h["content-security-policy"], /default-src 'none'/);
    assert.doesNotMatch(r.texto, /<script>[^<]/, "sin scripts en línea");
    assert.equal((await pedir(p.puerto, "GET", "/")).status, 404, "sin la ruta secreta no hay nada"); assert.equal((await pedir(p.puerto, "GET", "/p/otro/api/estado")).status, 404);
    assert.equal((await pedir(p.puerto, "GET", `${base}api/estado`, { host: "atacante.example" })).status, 421, "DNS rebinding");
    const post = (ruta, o) => pedir(p.puerto, "POST", `${base}api/${ruta}`, o);
    assert.equal((await post("vincular", { cuerpo: { codigo: "1A2B-3C4D-5E6F" } })).status, 403, "sin la cabecera del panel");
    assert.equal((await post("vincular", { cuerpo: { codigo: "1A2B-3C4D-5E6F" }, cab: { "x-panel": "1", origin: "http://atacante.example" } })).status, 403, "otro origen");
    assert.equal((await post("vincular", { cuerpo: "x=1", cab: { "x-panel": "1", "content-type": "text/plain" } })).status, 415);
    assert.equal((await post("vincular", { cuerpo: "{no json", cab: { "x-panel": "1" } })).status, 400);
    assert.equal((await post("vincular", { cuerpo: JSON.stringify({ codigo: "x".repeat(6000) }), cab: { "x-panel": "1" } })).status, 413);
    const mal = await post("vincular", { cuerpo: { codigo: "esto no es un código" }, cab: { "x-panel": "1" } }); assert.equal(mal.status, 400); assert.match(mal.json.mensaje, /12 letras y números/);
    const sinNexa = await post("vincular", { cuerpo: { codigo: "1A2B-3C4D-5E6F" }, cab: { "x-panel": "1" } }); assert.equal(sinNexa.status, 422); assert.ok(!/ECONN|fetch|at |\.mjs|127\.0\.0\.1:9/.test(sinNexa.texto), "sin detalles técnicos");
    assert.equal((await post("pausar", { cuerpo: {}, cab: { "x-panel": "1" } })).status, 404, "no hay agente que pausar si no está vinculado");
    const e = (await pedir(p.puerto, "GET", `${base}api/estado`)).json; assert.equal(e.vinculado, false); assert.equal(e.fase, "sin_vincular"); assert.equal(e.mensaje, MENSAJES.sin_vincular);
    assert.ok(!JSON.stringify(e).match(/token|clave|secret/i), "el estado no expone secretos");
  } finally { await p.cerrar(); }
});

test("el panel y el lanzador solo admiten NEXA y simulador locales (nada real)", async () => {
  for (const nexa of ["https://portal.sat.gob.gt", "https://api.digifact.com", "http://192.168.1.10:80", "https://nexa.example.com"]) await assert.rejects(iniciarPanel({ estado: temp(), config: { nexa, simulador: { modo: "integrado" } } }), /bloqueado|solo se admite|lista de destinos|no se admiten/i, nexa);
  await assert.rejects(iniciarPanel({ estado: temp(), config: { nexa: "http://127.0.0.1:9", simulador: { modo: "externo", url: "https://portal.sat.gob.gt", token: "t" } } }), /bloqueado|solo se admite|lista de destinos/i);
  const e = temp(); const c = leerConfiguracion(e, { FEL_AGENTE_NEXA: "http://127.0.0.1:1234" }); assert.equal(c.simulador.modo, "integrado"); assert.equal(c.nexa, "http://127.0.0.1:1234");
  const lanzados = []; abrirEnNavegador("http://127.0.0.1:1/p/x/", { plataforma: "win32", lanzar: (cmd, args, o) => { lanzados.push({ cmd, args, o }); return { on() {}, unref() {} }; } });
  assert.equal(lanzados[0].cmd, "rundll32"); assert.deepEqual(lanzados[0].args, ["url.dll,FileProtocolHandler", "http://127.0.0.1/p/x/".replace("127.0.0.1", "127.0.0.1:1")]); assert.equal(lanzados[0].o.windowsHide, true);
});

// ---------------------------------------------------------------- con NEXA de prueba
let nexa, per, sim;
test.before(async () => { nexa = await arrancarNexa(); per = persona(nexa); });
test.after(async () => { await sim?.detener(); await nexa?.parar(); });
const ctl = (u, tok, m, r) => fetch(u + r, { method: m, headers: { "x-control-token": tok, "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined }).then(async (x) => ({ status: x.status, json: await x.json() }));
const codigoNuevo = async () => (await nexa.api("ana", "POST", "/api/agentes/codigo", {})).json.codigo;
const conLimite = (p, ms = 60000) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error("tiempo agotado")), ms))]);

test("EXPERIENCIA DE INICIO: abrir el panel, escribir el código, ver el estado en lenguaje sencillo, emitir con autorización humana, pausar y cerrar en orden", async () => {
  const estado = temp(); let resolver; const pagina = new Promise((r) => { resolver = r; });
  const panel = await iniciarPanel({ estado, config: { nexa: nexa.base, clavesNexa: nexa.claves, simulador: { modo: "integrado", clave_nexa: nexa.info.clave_publica } }, agenteConfig: CFG.agente, ganchos: { punto: async (n, c) => { if (n === "despues_de_presentar") resolver(c.pagina); } } });
  await nexa.prueba("POST", "/prueba/config", { simulador: `${panel.simulador.url}/nexa/autorizaciones` });
  const nav = await chromium.launch(); const ctx = await nav.newContext({ locale: "es-GT" }); const ui = await ctx.newPage(); const errores = [];
  ui.on("pageerror", (e) => errores.push(e.message));
  try {
    await ui.goto(panel.url);
    await ui.waitForSelector("#paso-vincular:not([hidden])"); assert.ok(await ui.locator("#paso-estado").isHidden());
    assert.match(await ui.locator("body").innerText(), /SIMULADO · sin valor fiscal/); assert.match(await ui.locator("#paso-vincular").innerText(), /Generar código/);
    // código inválido: mensaje claro, sin tecnicismos
    await ui.fill("#codigo", "hola"); await ui.click("#btn-vincular"); await ui.waitForSelector("#error-vincular:not([hidden])"); assert.match(await ui.locator("#error-vincular").innerText(), /12 letras y números/);
    await ui.fill("#codigo", "AAAA-BBBB-CCCC"); await ui.click("#btn-vincular"); await esperar(async () => !(await ui.locator("#error-vincular").isHidden()) && /no es válido|ya se usó|venció/.test(await ui.locator("#error-vincular").innerText()), { que: "mensaje de código no válido" });
    // código bueno
    await ui.fill("#codigo", await codigoNuevo()); await ui.click("#btn-vincular");
    await ui.waitForSelector("#paso-estado:not([hidden])"); await esperar(async () => /Esperando una factura/.test(await ui.locator("#mensaje").innerText()), { que: "esperando una factura" });
    assert.ok(abrirAlmacen(estado).identidad().agente_id); assert.ok(!JSON.stringify(abrirAlmacen(estado).identidad()).includes("PRIVATE KEY"));
    // una factura: el agente la prepara y se detiene
    const { orden } = await nuevaOrden(nexa); const pag = await conLimite(pagina);
    await esperar(async () => /lista en la ventana/.test(await ui.locator("#mensaje").innerText()), { que: "vista previa lista" });
    assert.match(await ui.locator("#mensaje").innerText(), /una persona autorizada debe aprobarla en NEXA/);
    assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(pag)).resultado, "Emisión simulada registrada");
    await esperar(async () => /Factura simulada emitida/.test(await ui.locator("#eventos").innerText()), { que: "evento de emisión" });
    // pausa: no se preparan facturas nuevas
    await ui.click("#btn-pausar"); await esperar(async () => /En pausa/.test(await ui.locator("#mensaje").innerText()), { que: "pausa" }); assert.ok(await ui.locator("#btn-reanudar").isVisible());
    const o2 = await nuevaOrden(nexa); await dormir(600); assert.equal((await ordenDe(nexa, o2.orden)).estado, "pendiente", "en pausa no se reclama");
    await ui.click("#btn-reanudar"); await esperar(async () => (await ordenDe(nexa, o2.orden)).estado !== "pendiente", { que: "reanudado" });
    // cierre ordenado desde el botón (con una orden presentada: se cierra la sesión y se resuelve con el libro)
    await esperar(async () => (await ordenDe(nexa, o2.orden)).estado === "llenada", { que: "segunda vista previa" });
    await ui.click("#btn-cerrar"); await ui.waitForSelector("#paso-cerrado:not([hidden])"); await conLimite(panel.fin, 30000);
    assert.equal((await ordenDe(nexa, o2.orden)).estado, "descartada", "la orden presentada se resolvió con el libro: no se emitió nada");
  } finally { await nav.close(); await panel.cerrar(); }
  assert.deepEqual(errores, []); assert.ok(!existsSync(join(estado, "panel.json")), "al cerrar se borra la marca de instancia");
  assert.equal(abrirAlmacen(estado).diario(), null, "el diario quedó limpio");
});

test("CIERRE ORDENADO con la vista previa abierta (señal de cierre): la sesión se cierra, el libro queda vacío, la orden se descarta y Chromium se cierra", async () => {
  sim = await arrancarSimulador(nexa); const estado = temp(); let resolver; const pagina = new Promise((r) => { resolver = r; });
  const cod = await codigoNuevo(); await vincular({ nexa: nexa.base, codigo: cod, estado, ...nexa.opcionesAgente });
  const panel = await iniciarPanel({ estado, config: { nexa: nexa.base, clavesNexa: nexa.claves, simulador: { modo: "externo", url: sim.url, token: sim.tokenControl } }, agenteConfig: CFG.agente, ganchos: { punto: async (n, c) => { if (n === "despues_de_presentar") resolver(c.pagina); } } });
  const { orden } = await nuevaOrden(nexa); const pag = await conLimite(pagina);
  let cerrada = false; pag.on("close", () => { cerrada = true; });
  assert.equal((await ordenDe(nexa, orden)).estado, "llenada");
  await panel.cerrar(); await conLimite(panel.fin, 30000);
  assert.equal((await ordenDe(nexa, orden)).estado, "descartada"); assert.equal(cerrada, true, "Chromium se cerró");
  const l = await ctl(sim.url, sim.tokenControl, "GET", `/control/emisiones?empresa=${nexa.info.empresa}&referencia=${orden}`); assert.equal(l.json.length, 0);
  assert.equal(abrirAlmacen(estado).diario(), null);
  await esperar(async () => (await nexa.ordenes()).find((x) => x.id === orden).estado_fiscal !== "pendiente_certificacion", { que: "la operación se cierra como rechazo confirmado" });
});

// ---------------------------------------------------------------- proceso real: arranque, vinculación por la página y recuperación tras matarlo
function lanzarProceso(estado, simulador, extra = {}) {
  const hijo = spawn(process.execPath, [PANEL], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_AGENTE_ESTADO: estado, FEL_AGENTE_NEXA: nexa.base, FEL_SIM_URL: simulador.url, FEL_SIM_TOKEN: simulador.tokenControl, FEL_AGENTE_NO_ABRIR: "1", FEL_AGENTE_CLAVES_NEXA: JSON.stringify(nexa.claves), FEL_AGENTE_CHROMIUM_MAJOR: process.env.FEL_AGENTE_CHROMIUM_MAJOR ?? "131", ...extra } });
  let salida = ""; const listo = new Promise((ok, ko) => {
    const t = setTimeout(() => { hijo.kill(); ko(new Error("el panel no arrancó:\n" + salida)); }, 60000);
    const leer = (d) => { salida += d; const m = /PANEL_LISTO (\{.*\})/.exec(salida); if (m) { clearTimeout(t); ok(JSON.parse(m[1]).url); } };
    hijo.stdout.on("data", leer); hijo.stderr.on("data", leer); hijo.on("exit", (c) => { clearTimeout(t); ko(new Error(`el panel terminó (${c}) antes de estar listo:\n${salida}`)); });
  });
  const salio = new Promise((r) => hijo.once("exit", (codigo, senal) => r({ codigo, senal })));
  listo.catch(() => {});
  return { hijo, listo, salio, salida: () => salida };
}
const accion = (url, ruta, c = {}) => fetch(new URL(`api/${ruta}`, url), { method: "POST", headers: { "content-type": "application/json", "x-panel": "1" }, body: JSON.stringify(c) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const estadoPanel = (url) => fetch(new URL("api/estado", url)).then((r) => r.json());

test("PROCESO REAL: arranca con doble clic (sin comandos), se vincula desde la página, se mata el proceso con una orden presentada y al volver RECUPERA con el libro sin repetir; después sigue trabajando y cierra con código 0", async () => {
  sim = sim ?? await arrancarSimulador(nexa); const estado = temp(); const vivos = [];
  try {
  const p1 = lanzarProceso(estado, sim); vivos.push(p1); const url1 = await p1.listo;
  assert.equal((await estadoPanel(url1)).vinculado, false);
  assert.equal((await accion(url1, "vincular", { codigo: await codigoNuevo() })).status, 200);
  await esperar(async () => (await estadoPanel(url1)).fase === "esperando", { que: "esperando una factura" });
  const { orden } = await nuevaOrden(nexa); await esperar(async () => (await ordenDe(nexa, orden))?.estado === "llenada", { ms: 60000, que: "vista previa presentada" });
  const sesionesAntes = (await ctl(sim.url, sim.tokenControl, "GET", `/control/eventos?empresa=${nexa.info.empresa}`)).json.filter((e) => e.evento === "sesion_creada").length;
  assert.ok(abrirAlmacen(estado).diario()?.fase === "presentada", "el diario guarda lo presentado");
  p1.hijo.kill("SIGKILL"); await p1.salio;                                            // «caída»: el proceso desaparece con la vista previa abierta
  assert.equal((await ordenDe(nexa, orden)).estado, "llenada", "NEXA aún no sabe nada");
  const p2 = lanzarProceso(estado, sim); vivos.push(p2); const url2 = await p2.listo;                 // el usuario vuelve a hacer doble clic
  await esperar(async () => (await ordenDe(nexa, orden)).estado === "descartada", { ms: 60000, que: "recuperación: orden descartada con prueba del libro" });
  const l = await ctl(sim.url, sim.tokenControl, "GET", `/control/emisiones?empresa=${nexa.info.empresa}&referencia=${orden}`); assert.equal(l.json.length, 0, "no se emitió nada");
  assert.equal((await ctl(sim.url, sim.tokenControl, "GET", `/control/eventos?empresa=${nexa.info.empresa}`)).json.filter((e) => e.evento === "sesion_creada").length, sesionesAntes, "no se repitió la operación");
  // el agente descarta la orden y DESPUÉS vacía su diario: se espera a que lo termine (antes se leía en medio y fallaba de forma intermitente)
  await esperar(async () => abrirAlmacen(estado).diario() === null, { ms: 20000, que: "diario vaciado tras la recuperación" });
  assert.equal(abrirAlmacen(estado).diario(), null);
  // sigue trabajando con el mismo perfil de Chromium (el bloqueo del perfil no quedó colgado)
  const o2 = await nuevaOrden(nexa); await esperar(async () => (await ordenDe(nexa, o2.orden))?.estado === "llenada", { ms: 60000, que: "segunda factura tras recuperar" });
  assert.equal((await accion(url2, "cerrar")).status, 200); const fin = await conLimite(p2.salio, 40000);
  assert.equal(fin.codigo, 0, `salida limpia:\n${p2.salida()}`); assert.equal((await ordenDe(nexa, o2.orden)).estado, "descartada"); assert.equal(abrirAlmacen(estado).diario(), null);
  assert.ok(!existsSync(join(estado, "panel.json")), "marca de instancia borrada");
  } finally { for (const p of vivos) { try { p.hijo.kill("SIGKILL"); } catch { /* ya terminó */ } } }
});

test("una sola instancia: abrir el agente dos veces vuelve a mostrar el panel en lugar de iniciar otro agente", async () => {
  sim = sim ?? await arrancarSimulador(nexa); const estado = temp(); const p1 = lanzarProceso(estado, sim); const url1 = await p1.listo;
  const p2 = lanzarProceso(estado, sim); const r2 = await conLimite(p2.salio, 30000); assert.equal(r2.codigo, 0); assert.match(p2.salida(), /ya está abierto/i);
  assert.equal((await estadoPanel(url1)).fase, "sin_vincular", "el primero sigue en marcha");
  await accion(url1, "cerrar"); assert.equal((await conLimite(p1.salio, 30000)).codigo, 0);
});
