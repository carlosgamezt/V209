// Autoprueba con Chrome real contra una página de EJEMPLO local (tests/fixture). No toca ningún sistema real.
// Demuestra el mecanismo: observar, llenar, registrar tiempos, y —sobre todo— que NO se puede emitir ni enviar.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
const ejecutarAsync = (cmd, args, o) => promisify(execFile)(cmd, args, o).then((r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }), (e) => ({ status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) }));
import { chromium } from "../src/playwright.mjs";
import { crearRegistro } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";
import { bloquearEscrituras, conectar, tomarBloqueo } from "../src/conexion.mjs";
import { inventariar, borradorMapeo, construirInventario, fuenteConsola } from "../src/observar.mjs";
import { validarMapeo } from "../src/guardia.mjs";
import { crearMonitorSesion } from "../src/sesion.mjs";
import { crearProgreso } from "../src/progreso.mjs";
import { crearLibro, claveIdempotencia } from "../src/libro.mjs";
import { analizar } from "../src/analisis.mjs";
import { resolver } from "../src/localizar.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(AQUI, "fixture/formulario-generico.html")), htmlJsf = fs.readFileSync(path.join(AQUI, "fixture/jsf-simulado.html")), htmlAng = fs.readFileSync(path.join(AQUI, "fixture/angular-simulado.html"));
const mapeo = () => JSON.parse(fs.readFileSync(path.join(AQUI, "fixture/mapeo-fixture.json"), "utf8"));
const datos = () => JSON.parse(fs.readFileSync(path.join(AQUI, "../config/datos-ficticios.json"), "utf8"));
const base = (extra = {}) => ({ ...mapeo(), ...extra });

const posts = [];                       // todo POST que LLEGA al servidor (debe quedar vacío cuando la guardia está activa)
const servidor = http.createServer((req, res) => {
  if (req.method === "POST") { posts.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(200, { "content-type": "text/plain" }); return res.end("EMITIDO"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "sesion_demo=a; Path=/" }); res.end(req.url.startsWith("/jsf") ? htmlJsf : req.url.startsWith("/ang") ? htmlAng : html);
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const URL_BASE = `http://127.0.0.1:${servidor.address().port}/`;
const browser = await chromium.launch({ headless: true });

let fallos = 0, n = 0;
const caso = async (nombre, fn) => { n++; try { await fn(); console.log(`OK     ${nombre}`); } catch (e) { fallos++; console.log(`FALLO  ${nombre}\n       ${String(e.message ?? e).split("\n").slice(0, 4).join("\n       ")}`); } };
const silencio = () => {};
const nuevaPagina = async ({ guardia = true, politica = {} } = {}) => {
  const context = await browser.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: silencio });
  if (guardia) await bloquearEscrituras(context, politica, registro);
  const page = await context.newPage(); await page.goto(URL_BASE);
  return { context, page, registro };
};
const correr = async (planExtra, { datosX = datos(), respuesta = "si", guardia = true } = {}) => {
  const { context, page, registro } = await nuevaPagina({ guardia });
  const manuales = []; let t = 0;
  const r = await ejecutarPlan({ page, plan: base(planExtra), datos: datosX, registro, empresa: { alias: "empresa-prueba" }, local: true, reloj: () => (t += 10), esperarUsuario: async (q) => { manuales.push(q); return /empresa/.test(q) ? respuesta : ""; } });
  return { ...r, page, context, registro, manuales };
};

await caso("CONTROL NEGATIVO: sin guardia, el botón «Emitir» del formulario de ejemplo SÍ envía (la prueba de bloqueo es significativa)", async () => {
  posts.length = 0; const { context, page } = await nuevaPagina({ guardia: false });
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/emitir")), page.getByRole("button", { name: "Emitir documento" }).click()]);
  assert.deepEqual(posts, ["POST /emitir"]); await context.close(); posts.length = 0;
});

await caso("OBSERVAR: inventario real de la página, sin valores, marcando lo peligroso", async () => {
  const { context, page } = await nuevaPagina(); await page.getByLabel("Nombre del receptor").fill("DATO-SECRETO-NO-DEBE-SALIR");
  const inv = await inventariar(page);
  const por = (f) => inv.controles.find(f);
  const nit = por((c) => c.etiqueta === "NIT del receptor"); assert.ok(nit && nit.mejor?.estrategia === "etiqueta" && nit.mejor.unico);
  for (const t of ["Emitir documento", "Enviar", "Guardar borrador"]) assert.equal(por((c) => c.texto === t).clasificacion, "prohibido", t);
  assert.equal(por((c) => c.texto === "Emitir documento").envia_formulario, true);
  assert.equal(por((c) => c.texto === "Siguiente").clasificacion, "ambiguo");
  assert.equal(por((c) => c.texto === "Detalle").clasificacion, "ok");
  const obs = por((c) => c.etiqueta === "Observación"); assert.equal(obs.id_generado, true); assert.equal(obs.id, ""); assert.ok(obs.mejor);   // id autogenerado: no se usa
  assert.ok(!JSON.stringify(inv).includes("DATO-SECRETO-NO-DEBE-SALIR"), "el inventario no debe contener valores");
  const b = borradorMapeo(inv);
  assert.equal(inv.senales_sesion.campo_clave_visible, false, "con la sesión activa no hay campo de clave visible");
  assert.ok(b.pasos.filter((p) => p.localizador).every((p) => p.verificado === false && p.dato === null));
  assert.equal(validarMapeo(b).ok, false); assert.equal(posts.length, 0);
  await page.evaluate(() => window.__expirar("overlay"));   // pantalla de inicio de sesión: se detecta y la contraseña se omite del borrador
  const inv2 = await inventariar(page), b2 = borradorMapeo(inv2);
  assert.equal(inv2.senales_sesion.campo_clave_visible, true); assert.ok(b2.omitidos_por_riesgo.some((o) => /contraseña/.test(o.motivo)), "la contraseña se omite");
  assert.ok(!b2.pasos.some((p) => p.localizador?.valor === "Clave de acceso"), "nunca hay un paso que llene la clave");
  assert.ok(b2.sesion && b2.sesion.indicadores_sesion_activa.length === 0, "el borrador trae «sesion» vacío: nada inventado");
  await context.close();
});

await caso("EJECUTAR: llena con datos ficticios, registra pasos/tiempos y SE DETIENE sin enviar nada", async () => {
  posts.length = 0; const r = await correr({});
  assert.equal(r.ok, true); assert.equal(r.detenido, true);
  await r.page.getByRole("tab", { name: "Detalle" }).click();   // (la prueba verifica el resultado; el ejecutor ya había hecho lo suyo)
  assert.equal(await r.page.getByLabel("Descripción").inputValue(), "SERVICIO DE PRUEBA - NO EMITIR");
  assert.equal(await r.page.getByLabel("Precio unitario").inputValue(), "125.50");
  assert.equal(await r.page.getByLabel("Tipo").inputValue(), "Servicio");
  const s = r.resumen; assert.equal(s.errores.length, 0); assert.equal(s.bloqueos_de_guardia.length, 0); assert.equal(s.emitio, false);
  assert.equal(s.manuales.n, 2, "identidad + sesión"); assert.ok(s.automaticos.n >= 8 && s.automaticos.ms > 0 && s.duracion_total_ms > 0);
  assert.equal(r.registro.eventos().filter((e) => e.evento === "paso").at(-1).tipo, "detener");
  assert.deepEqual(posts, [], "ningún POST llegó al servidor"); assert.ok(!JSON.stringify(r.registro.eventos()).includes("CLIENTE DE PRUEBA"), "el registro no guarda valores");
  await r.context.close();
});

await caso("HOSTIL: un clic a «Emitir» en el plan se rechaza ANTES de ejecutar nada", async () => {
  posts.length = 0; const p = base(); p.pasos.splice(1, 0, { id: "x", tipo: "clic_seguro", motivo: "abrir detalle", localizador: { estrategia: "texto", valor: "Emitir documento" }, verificado: true });
  const { context, page, registro } = await nuevaPagina();
  const r = await ejecutarPlan({ page, plan: p, datos: datos(), registro, local: true, esperarUsuario: async () => "si" });
  assert.equal(r.ok, false); assert.ok(r.errores_validacion.some((e) => /PROHIBIDO/.test(e))); assert.deepEqual(posts, []); assert.equal(await page.getByLabel("Nombre del receptor").inputValue(), ""); await context.close();
});
await caso("HOSTIL: un clic disfrazado (id «emi», motivo inocente) se rechaza al leer el control real", async () => {
  posts.length = 0; const r = await correr({ pasos: [{ id: "p0", tipo: "manual", instruccion: "x" }, { id: "x", tipo: "clic_seguro", motivo: "abrir detalle", localizador: { estrategia: "id", valor: "emi" }, verificado: true }, { id: "z", tipo: "detener" }] });
  assert.equal(r.ok, false); assert.equal(r.resumen.bloqueos_de_guardia.length, 1); assert.match(r.resumen.bloqueos_de_guardia[0].detalle, /RECHAZADO/); assert.deepEqual(posts, []); await r.context.close();
});
await caso("HOSTIL: un control ambiguo («Siguiente») exige aprobación humana en el paso", async () => {
  const paso = (extra = {}) => ({ pasos: [{ id: "p0", tipo: "manual", instruccion: "x" }, { id: "x", tipo: "clic_seguro", motivo: "avanzar", localizador: { estrategia: "id", valor: "sig" }, verificado: true, ...extra }, { id: "z", tipo: "detener" }] });
  const a = await correr(paso()); assert.equal(a.resumen.bloqueos_de_guardia.length, 1); await a.context.close();
  const b = await correr(paso({ ambiguo_aprobado: true })); assert.equal(b.ok, true); await b.context.close();
});
await caso("HOSTIL: un botón de enviar/guardar no se puede pulsar ni aprobándolo (palabras prohibidas)", async () => {
  for (const id of ["env", "bor"]) { const r = await correr({ pasos: [{ id: "p0", tipo: "manual", instruccion: "x" }, { id, tipo: "clic_seguro", motivo: "abrir detalle", localizador: { estrategia: "id", valor: id }, ambiguo_aprobado: true, permitir_envia_formulario: true, verificado: true }, { id: "z", tipo: "detener" }] }); assert.equal(r.resumen.bloqueos_de_guardia.length, 1, id); assert.deepEqual(posts, []); await r.context.close(); }
});
await caso("RED: aunque la página intente un POST (fetch o envío del formulario), la guardia lo bloquea y lo registra", async () => {
  posts.length = 0; const { context, page, registro } = await nuevaPagina();
  const r1 = await page.evaluate(() => fetch("/api/enviar", { method: "POST", body: "x" }).then(() => "llegó", () => "bloqueado")); assert.equal(r1, "bloqueado");
  await page.evaluate(() => document.getElementById("f").requestSubmit()).catch(() => {}); await page.waitForTimeout(300);
  assert.deepEqual(posts, []); const b = registro.eventos().filter((e) => e.evento === "solicitud_bloqueada"); assert.ok(b.length >= 2, `bloqueos registrados: ${b.length}`); await context.close();
});
await caso("HOSTIL: pestaña fuera de dominios_permitidos → se detiene sin llenar nada", async () => {
  const r = await correr({ dominios_permitidos: ["portal.ejemplo.gt"] }); assert.equal(r.ok, false); assert.ok(r.resumen.bloqueos_de_guardia.length >= 1); assert.equal(await r.page.getByLabel("Nombre del receptor").inputValue(), ""); await r.context.close();
});
await caso("IDENTIDAD: si la persona dice que la sesión NO es de la empresa, no se hace nada", async () => {
  const r = await correr({}, { respuesta: "no" }); assert.equal(r.ok, false); assert.equal(r.resumen.automaticos.n, 0); assert.equal(await r.page.getByLabel("Nombre del receptor").inputValue(), ""); await r.context.close();
});
await caso("DATOS: un NIT real no declarado impide la ejecución", async () => {
  const d = datos(); d.cliente.nit = "1234567-8"; const { context, page, registro } = await nuevaPagina();
  const r = await ejecutarPlan({ page, plan: base(), datos: d, registro, local: true, esperarUsuario: async () => "si" }); assert.equal(r.ok, false); assert.ok(r.errores_validacion.some((e) => /NIT/.test(e))); await context.close();
});
await caso("ERRORES: un localizador inexistente o ambiguo se registra como error y detiene la ejecución", async () => {
  const mal = (loc) => correr({ pasos: [{ id: "p0", tipo: "manual", instruccion: "x" }, { id: "x", tipo: "llenar", dato: "cliente.nombre", localizador: loc, verificado: true }, { id: "n", tipo: "llenar", dato: "cliente.nit", localizador: { estrategia: "etiqueta", valor: "NIT del receptor" }, verificado: true }, { id: "z", tipo: "detener" }] });
  const a = await mal({ estrategia: "etiqueta", valor: "No existe", exacto: true }); assert.equal(a.resumen.errores.length, 1); assert.match(a.resumen.errores[0].detalle, /ningún elemento/); assert.equal(await a.page.getByLabel("NIT del receptor").inputValue(), "", "no siguió ejecutando"); await a.context.close();
  const b = await mal({ estrategia: "rol", rol: "textbox", valor: "e", exacto: false }); assert.match(b.resumen.errores[0].detalle, /ambiguo/); await b.context.close();
});
await caso("MODO CDP: conecta a un Chrome local con puerto de depuración (el que abriría la persona) y rechaza endpoints remotos", async () => {
  const puerto = 9300 + Math.floor(Math.random() * 500), b2 = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${puerto}`] });
  try {
    await b2.newContext().then((c) => c.newPage()).then((p) => p.goto(URL_BASE));
    const c = await conectar({ alias: "empresa-prueba", modo: "cdp", cdp: `http://127.0.0.1:${puerto}` });
    assert.ok(c.context, "contexto por CDP"); await c.cerrar();
  } finally { await b2.close(); }
  await assert.rejects(() => conectar({ alias: "x", modo: "cdp", cdp: "http://192.168.0.9:9222" }), /local/);
  await assert.rejects(() => conectar({ alias: "x", modo: "perfil", perfil_dir: path.join(AQUI, "perfil-dentro-del-repo") }), /repositorio/);
});
await caso("MULTIEMPRESA: dos perfiles son sesiones separadas (la cookie de A no existe en B) y el bloqueo evita ejecuciones simultáneas", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-poc-")), A = await chromium.launchPersistentContext(path.join(tmp, "a"), { headless: true }), B = await chromium.launchPersistentContext(path.join(tmp, "b"), { headless: true });
  try {
    await (await A.newPage()).goto(URL_BASE); await (await B.newPage()).goto(URL_BASE);
    await A.addCookies([{ name: "solo_a", value: "1", url: URL_BASE }]);
    assert.ok((await A.cookies(URL_BASE)).some((c) => c.name === "solo_a")); assert.ok(!(await B.cookies(URL_BASE)).some((c) => c.name === "solo_a"));
  } finally { await A.close(); await B.close(); }
  const liberar = tomarBloqueo(path.join(tmp, "lock")); assert.ok(typeof liberar === "function"); liberar();
  const l2 = tomarBloqueo(path.join(tmp, "lock")); l2(); fs.rmSync(tmp, { recursive: true, force: true });
});

// ======================================================================= SESIÓN SAT
const planSes = (sesionExtra = {}) => {
  const m = mapeo(); m.sesion = { campo_clave_visible: true, indicadores_sesion_activa: [{ localizador: { estrategia: "rol", rol: "tab", valor: "Datos del receptor" }, verificado: true }], intervalo_ms: 1000, espera_max_ms: 20000, ...sesionExtra };
  const i = m.pasos.findIndex((p) => p.id === "p030-abrir-detalle");
  m.pasos.splice(i + 1, 0, { id: "p035-agregar-linea", tipo: "clic_seguro", motivo: "agregar una línea al detalle", localizador: { estrategia: "id", valor: "agr" }, ambiguo_aprobado: true, verificado: true });
  return m;
};
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "fel-ses-"));
const lineas = (page) => page.locator("#lineas .linea").count();
/** Ejecuta con monitor de sesión, checkpoint y libro. «pagina» permite reutilizar la misma pestaña (reanudación). sleepHook simula a la persona. */
async function correrSesion({ plan = planSes(), pagina = null, hooks = {}, sleepHook = null, responder = null, reanudar = false, dir = tmpDir(), timeout = 1500, reloj = null, conIndicadores = true } = {}) {
  const base = pagina ?? await nuevaPagina(), registro = pagina ? crearRegistro({ empresa: "empresa-prueba", salida: silencio }) : base.registro;
  let t = 0; const rl = reloj ?? (() => (t += 5)), adv = (ms) => { t += ms; };
  const sesion = crearMonitorSesion({ config: plan.sesion, dominios: plan.dominios_permitidos, reloj: rl, sleep: async (ms) => { adv(ms); await sleepHook?.(base.page, ms); }, salida: silencio });
  const progreso = crearProgreso({ dir, plan, datos: datos() }), libro = crearLibro({ dir });
  const preguntas = [];
  const r = await ejecutarPlan({ page: base.page, plan, datos: datos(), registro, empresa: { alias: "empresa-prueba" }, local: true, reloj: rl, timeout, sesion, progreso, libro, reanudar, hooks, salida: silencio,
    esperarUsuario: async (q) => { preguntas.push(q); return responder ? responder(q, base.page) : /empresa/.test(q) ? "si" : ""; } });
  return { ...r, ...base, registro, progreso, libro, dir, preguntas };
}
const ev = (page) => page.evaluate(() => window.__ev || 0);

await caso("SESIÓN 1: SAT cierra la sesión a mitad → se pausa SIN tocar nada, la persona entra, se verifica, se reconcilia y se reanuda sin duplicar", async () => {
  posts.length = 0; const pagina = await nuevaPagina(), violaciones = []; let expirado = false, ev0 = null, esperas = 0;
  const r = await correrSesion({ pagina,
    hooks: { antesDeEjecutar: async (p) => { if (p.id === "p050-desc" && !expirado) { expirado = true; ev0 = await ev(pagina.page); await pagina.page.evaluate(() => window.__expirar("overlay")); } } },
    sleepHook: async (page) => { esperas++; if ((await ev(page)) !== ev0) violaciones.push(`interacción durante la espera #${esperas}`); if (esperas === 3) await page.evaluate(() => window.__iniciarSesion()); } });
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.deepEqual(violaciones, [], "durante la espera no hubo clics, teclas ni escritura"); assert.ok(esperas >= 3, "se esperó consultando de forma pasiva");
  const s = r.resumen; assert.equal(s.interrupciones_de_sesion, 1); assert.equal(s.errores.length, 0); assert.ok(s.fases.autenticacion.ms > 0 && s.fases.llenado.ms > 0 && s.fases.espera.ms >= 0, JSON.stringify(s.fases));
  const est = r.registro.eventos().filter((e) => e.evento === "sesion_sat").map((e) => e.estado); assert.deepEqual(est.slice(-2), ["requiere_login", "activa"]);
  assert.ok(r.registro.eventos().some((e) => e.id === "p050-desc" && e.resultado === "sesion"), "el intento fallido quedó marcado como pérdida de sesión, no como error");
  assert.match(r.registro.eventos().find((e) => e.id === "p-reconciliar").detalle, /sin cambios/);
  assert.equal(await lineas(r.page), 1, "el clic «Agregar línea» NO se repitió"); assert.equal(await r.page.getByLabel("Descripción").inputValue(), "SERVICIO DE PRUEBA - NO EMITIR");
  assert.deepEqual(posts, []); const todo = JSON.stringify(r.registro.eventos()) + fs.readFileSync(r.progreso.archivo, "utf8");
  for (const prohibido of ["SERVICIO DE PRUEBA", "CLIENTE DE PRUEBA", "sesion_demo", "Clave", "125.50"]) assert.ok(!todo.includes(prohibido), `el registro/progreso no debe contener «${prohibido}»`);
  assert.equal(r.progreso.snapshot().estado, "detenido"); assert.equal(r.progreso.snapshot().pausas_por_sesion, 1); await r.context.close();
});

await caso("SESIÓN 2: si el portal pierde TODO al reiniciar la sesión, no se repiten clics: se exige reinicio manual", async () => {
  const pagina = await nuevaPagina(); let hecho = false;
  const r = await correrSesion({ pagina, hooks: { antesDeEjecutar: async (p) => { if (p.id === "p050-desc" && !hecho) { hecho = true; await pagina.page.evaluate(() => window.__expirar("reset")); } } },
    sleepHook: async (page) => { await page.evaluate(() => window.__iniciarSesion()); } });
  assert.equal(r.ok, false); assert.equal(r.estado, "requiere_reinicio_manual"); assert.match(r.resumen.bloqueos_de_guardia.at(-1).detalle, /REINICIO MANUAL/);
  assert.equal(await lineas(r.page), 0, "no se volvió a pulsar «Agregar línea»"); assert.equal(await r.page.getByLabel("NIT del receptor").inputValue(), "", "no se re-llenó sobre un formulario a medias");
  assert.equal(r.progreso.snapshot().estado, "requiere_reinicio_manual"); assert.equal(r.libro.estado(claveIdempotencia("empresa-prueba", datos())), "preparado", "no figura como detenido ni emitido"); await r.context.close();
});

await caso("SESIÓN 3: si el portal pierde solo campos posteriores al último clic, se vuelven a llenar (solo campos) y no se duplica nada", async () => {
  const pagina = await nuevaPagina(); let hecho = false;
  const r = await correrSesion({ pagina, hooks: { antesDeEjecutar: async (p) => { if (p.id === "p080-leer-precio" && !hecho) { hecho = true; await pagina.page.evaluate(() => { window.__expirar("overlay"); window.__resetDetalle(); }); } } },
    sleepHook: async (page) => { await page.evaluate(() => window.__iniciarSesion()); } });
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.match(r.registro.eventos().find((e) => e.id === "p-reconciliar").detalle, /se volverán a llenar/);
  assert.equal(await lineas(r.page), 1); assert.equal(await r.page.getByLabel("Precio unitario").inputValue(), "125.50"); assert.equal(await r.page.getByLabel("Tipo").inputValue(), "Servicio"); await r.context.close();
});

await caso("SESIÓN 4: un paso NO repetible (clic) interrumpido por el cierre de sesión no se reintenta: decisión manual", async () => {
  posts.length = 0; const pagina = await nuevaPagina(); let hecho = false;
  const r = await correrSesion({ pagina, hooks: { antesDeEjecutar: async (p) => { if (p.id === "p035-agregar-linea" && !hecho) { hecho = true; await pagina.page.evaluate(() => window.__expirar("overlay")); } } },
    sleepHook: async (page) => { await page.evaluate(() => window.__iniciarSesion()); } });
  assert.equal(r.ok, false); assert.equal(r.estado, "requiere_decision_manual"); assert.equal(await lineas(r.page), 0, "no se reintentó el clic"); assert.deepEqual(posts, []); await r.context.close();
});

await caso("SESIÓN 5: sin indicadores confirmados, solo se reanuda tras confirmación humana Y sin señales de login (un «si» con el login aún visible no basta)", async () => {
  const pagina = await nuevaPagina(); let hecho = false, llamadas = 0;
  const plan = planSes(); plan.sesion.indicadores_sesion_activa = [];
  const r = await correrSesion({ pagina, plan, hooks: { antesDeEjecutar: async (p) => { if (p.id === "p050-desc" && !hecho) { hecho = true; await pagina.page.evaluate(() => window.__expirar("overlay")); } } },
    responder: async (q, page) => { if (/empresa/.test(q)) return "si"; if (/Inicia sesión|iniciaste sesión/.test(q)) { llamadas++; if (llamadas === 2) await page.evaluate(() => window.__iniciarSesion()); return "si"; } return ""; } });
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.ok(llamadas >= 2, `la primera confirmación con el login visible no reanudó (llamadas: ${llamadas})`);
  assert.ok(r.registro.eventos().some((e) => e.evento === "sesion_sat" && e.estado === "activa" && e.via === "manual")); await r.context.close();
});

await caso("SESIÓN 6: si nadie inicia sesión, se agota la espera: no se reanuda, no se emite, el progreso queda guardado", async () => {
  const pagina = await nuevaPagina(); let hecho = false, t = 0;
  const r = await correrSesion({ pagina, plan: planSes({ espera_max_ms: 5000 }), reloj: () => (t += 5), hooks: { antesDeEjecutar: async (p) => { if (p.id === "p050-desc" && !hecho) { hecho = true; await pagina.page.evaluate(() => window.__expirar("overlay")); } } } });
  assert.equal(r.ok, false); assert.equal(r.estado, "interrumpido"); assert.equal(await pagina.page.getByLabel("Cantidad").inputValue().catch(() => ""), ""); assert.deepEqual(posts, []);
  assert.deepEqual(r.progreso.snapshot().completados.map((x) => x.id).slice(0, 2), ["p000-sesion", "p010-nit"]); await r.context.close();
});

await caso("SESIÓN 7: reanudar tras una interrupción continúa donde quedó (sin repetir clics) y solo con la sesión verificada", async () => {
  const pagina = await nuevaPagina(), dir = tmpDir(); let cortado = false;
  const r1 = await correrSesion({ pagina, dir, hooks: { antesDePaso: async (p) => { if (p.id === "p060-cant" && !cortado) { cortado = true; throw new Error("INTERRUPCIÓN SIMULADA (cierre del proceso)"); } } } });
  assert.equal(r1.ok, false); assert.equal(r1.progreso.snapshot().estado, "interrumpido"); assert.equal(await lineas(pagina.page), 1);
  const r2 = await correrSesion({ pagina, dir, reanudar: true });
  assert.equal(r2.ok, true, JSON.stringify(r2.resumen.errores) + JSON.stringify(r2.resumen.bloqueos_de_guardia)); assert.equal(await lineas(pagina.page), 1, "al reanudar no se repitió el clic");
  assert.equal(await pagina.page.getByLabel("Precio unitario").inputValue(), "125.50"); assert.ok(r2.registro.eventos().some((e) => e.id === "p-reconciliar" && /sin cambios/.test(e.detalle)));
  assert.equal(r2.registro.eventos().filter((e) => e.evento === "paso" && e.id === "p035-agregar-linea").length, 0, "el paso del clic no se volvió a ejecutar");
  assert.equal(r2.progreso.snapshot().reanudaciones, 1); await pagina.context.close();
});
await caso("SESIÓN 8: reanudar con la sesión ya cerrada espera el inicio de sesión ANTES de tocar nada", async () => {
  const pagina = await nuevaPagina(), dir = tmpDir(); let cortado = false, esperas = 0, ev0 = null;
  await correrSesion({ pagina, dir, hooks: { antesDePaso: async (p) => { if (p.id === "p060-cant" && !cortado) { cortado = true; throw new Error("INTERRUPCIÓN"); } } } });
  await pagina.page.evaluate(() => window.__expirar("overlay")); ev0 = await ev(pagina.page); const violaciones = [];
  const r = await correrSesion({ pagina, dir, reanudar: true, sleepHook: async (page) => { esperas++; if ((await ev(page)) !== ev0) violaciones.push(esperas); if (esperas === 2) await page.evaluate(() => window.__iniciarSesion()); } });
  assert.equal(r.ok, true); assert.deepEqual(violaciones, []); assert.ok(esperas >= 2); assert.equal(await lineas(pagina.page), 1); await pagina.context.close();
});

await caso("ANTI-DUPLICADOS: el libro bloquea una nueva ejecución si el documento figura como emisión solicitada/desconocida/emitida, hasta conciliar a mano", async () => {
  const dir = tmpDir(), clave = claveIdempotencia("empresa-prueba", datos()), libro = crearLibro({ dir });
  assert.equal(clave, claveIdempotencia("empresa-prueba", datos()), "la clave es estable"); assert.notEqual(clave, claveIdempotencia("empresa-b", datos()));
  for (const estado of ["emision_solicitada", "emision_desconocida", "emitido", "emitido_manual"]) {
    libro.registrar(clave, estado); const { context, page, registro } = await nuevaPagina();
    const r = await ejecutarPlan({ page, plan: base(), datos: datos(), registro, local: true, libro, esperarUsuario: async () => "si", empresa: { alias: "empresa-prueba" } });
    assert.equal(r.ok, false, estado); assert.match(r.errores_validacion[0], /concilia/); assert.equal(await page.getByLabel("Nombre del receptor").inputValue(), "", "no se tocó nada"); await context.close();
  }
  libro.registrar(clave, "descartado", "comprobado en el portal: no existe");
  const { context, page, registro } = await nuevaPagina(); const r = await ejecutarPlan({ page, plan: base(), datos: datos(), registro, local: true, libro, esperarUsuario: async () => "si", empresa: { alias: "empresa-prueba" } });
  assert.equal(r.ok, true); assert.equal(libro.estado(clave), "detenido_antes_de_emitir"); assert.throws(() => libro.registrar(clave, "emitir"), /no válido`?|estado/); await context.close();
});

await caso("CREDENCIALES: un paso que intente llenar un campo de contraseña se rechaza (la persona se autentica en el portal oficial)", async () => {
  const pagina = await nuevaPagina(); await pagina.page.evaluate(() => window.__expirar("overlay"));
  const plan = base({ pasos: [{ id: "p0", tipo: "manual", instruccion: "x" }, { id: "x", tipo: "llenar", dato: "cliente.nombre", localizador: { estrategia: "etiqueta", valor: "Clave de acceso" }, verificado: true }, { id: "z", tipo: "detener" }] });
  const r = await ejecutarPlan({ page: pagina.page, plan, datos: datos(), registro: pagina.registro, local: true, esperarUsuario: async () => "si", empresa: { alias: "empresa-prueba" } });
  assert.equal(r.ok, false); assert.match(r.resumen.bloqueos_de_guardia[0].detalle, /credenciales/); assert.equal(await pagina.page.getByLabel("Clave de acceso").inputValue(), ""); await pagina.context.close();
});

await caso("MEDIR-SESIÓN (comando real): detecta el momento en que el portal pide iniciar sesión, sin interactuar", async () => {
  const puerto = 9950 + Math.floor(Math.random() * 40), b4 = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${puerto}`] }), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-med-"));
  const empresa = path.join(tmp, "e.json"), mapa = path.join(tmp, "m.json"); fs.writeFileSync(empresa, JSON.stringify({ alias: "empresa-med", modo: "cdp", cdp: `http://127.0.0.1:${puerto}` })); fs.writeFileSync(mapa, JSON.stringify(planSes()));
  try {
    const pg = await (await b4.newContext()).newPage(); await pg.goto(URL_BASE); const antes = await ev(pg);
    setTimeout(() => pg.evaluate(() => window.__expirar("overlay")).catch(() => {}), 2500);
    const m = await ejecutarAsync(process.execPath, [path.join(AQUI, "../bin/medir-sesion.mjs"), `--empresa=${empresa}`, `--mapeo=${mapa}`, "--solo-local", "--intervalo=1", "--max-min=0.4"], { encoding: "utf8", timeout: 60000 });
    assert.equal(m.status, 0, m.stderr + m.stdout); assert.match(m.stdout, /pidió iniciar sesión a los/); assert.equal(await ev(pg), antes, "la medición no produjo ninguna interacción en la página");
    const f = fs.readdirSync(path.join(AQUI, "../registros/empresa-med")).find((x) => x.startsWith("medicion-sesion")); const j = JSON.parse(fs.readFileSync(path.join(AQUI, "../registros/empresa-med", f), "utf8"));
    assert.ok(j.primer_login_detectado_ms >= 2000 && j.primer_login_detectado_ms < 12000, String(j.primer_login_detectado_ms)); assert.match(j.nota, /NO confirmada/);
  } finally { await b4.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(AQUI, "../registros"), { recursive: true, force: true }); }
});

// ======================================================================= FASE 2: observación de un formulario JSF (simulado)
await caso("OBSERVAR JSF (simulado): ids autogenerados, componentes personalizados, AJAX y marcos se detectan; no se extrae ningún valor ni el ViewState", async () => {
  posts.length = 0; const { context, page } = await nuevaPagina(); await page.goto(URL_BASE + "jsf");
  await page.getByLabel("Nombre del receptor").fill("DATO-SECRETO-NO-DEBE-SALIR");
  const inv = await inventariar(page), cod = (c) => inv.obstaculos.find((o) => o.codigo === c);
  for (const c of ["ids_autogenerados", "componentes_personalizados", "envio_ajax", "jsf_detectado", "marcos", "campos_ocultos_accesibles", "botones_que_envian"]) assert.ok(cod(c), `falta el obstáculo ${c}: ${inv.obstaculos.map((o) => o.codigo)}`);
  assert.equal(cod("componentes_personalizados").severidad, "alta"); assert.ok(inv.marcos.some((m) => m.frameworks?.includes("jsf") && m.frameworks.includes("primefaces")));
  const nit = inv.controles.find((c) => c.etiqueta === "NIT del receptor"); assert.equal(nit.id_generado, true); assert.equal(nit.id, ""); assert.equal(nit.mejor.estrategia, "etiqueta", "no se usa el id j_idt…");
  assert.ok(/span#formulario:nit\.ui-autocomplete/.test(nit.dom) && nit.clases.includes("ui-autocomplete-input"), nit.dom);
  const calc = inv.controles.find((c) => c.texto === "Calcular"), emi = inv.controles.find((c) => c.texto === "Emitir factura"), cer = inv.controles.find((c) => c.texto === "Cerrar sesión");
  assert.equal(calc.ajax, true); assert.equal(emi.clasificacion, "prohibido"); assert.equal(cer.clasificacion, "prohibido", "cerrar sesión nunca se pulsa"); assert.equal(calc.envia_formulario, true);
  assert.equal(inv.controles.find((c) => c.etiqueta === "Precio unitario").ajax, true, "el campo que dispara AJAX al cambiar se marca");
  assert.equal(inv.formularios[0].accion_ruta, "/menu/portada.jsf", "la acción del formulario sale sin ;jsessionid ni parámetros"); assert.equal(inv.formularios[0].metodo, "post");
  assert.ok(inv.controles.some((c) => c.marco > 0 && c.etiqueta === "Campo en marco" && c.candidatos[0].marco), "controles del iframe con su marco");
  const txt = JSON.stringify(inv); for (const x of ["DATO-SECRETO-NO-DEBE-SALIR", "SECRETO-VIEWSTATE", "jsessionid", "ABCDEF0123456789", "sesion_demo"]) assert.ok(!txt.includes(x), `la observación no debe contener «${x}»`);
  const b = borradorMapeo(inv); assert.ok(!b.pasos.some((p) => p.localizador?.estrategia === "id" && /j_idt/.test(p.localizador.valor)), "el borrador no usa ids j_idt");
  assert.ok(!b.pasos.some((p) => ["Emitir factura", "Cerrar sesión", "Calcular"].includes(p.localizador?.valor)), "el borrador no incluye botones");
  assert.equal(validarMapeo(b).ok, false); assert.deepEqual(posts, []); await context.close();
});
await caso("OBSERVAR por consola: el fragmento pegado en Chrome produce el mismo inventario, es de solo lectura y está sincronizado con el código", async () => {
  const { context, page } = await nuevaPagina(); await page.goto(URL_BASE + "jsf;jsessionid=QQQQQQQQQQQQQQQQQQQQQQ?x=SECRETO-QUERY"); const fuente = fuenteConsola();
  assert.equal(fs.readFileSync(path.join(AQUI, "../consola/observar-consola.js"), "utf8"), fuente, "consola/observar-consola.js desactualizado: ejecuta node bin/generar-consola.mjs");
  const huella = (await import("node:crypto")).createHash("sha256").update(fuente).digest("hex");
  assert.ok(fs.readFileSync(path.join(AQUI, "../../docs/fase-2-observacion-portal-real.md"), "utf8").includes(huella), `la guía debe citar la huella vigente del fragmento: ${huella}`);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\.click\s*\(|\.submit\s*\(|\.value\s*=|setAttribute|dispatchEvent|\.focus\s*\(|localStorage|sessionStorage|document\.cookie|WebSocket|eval\s*\(|new Function/.test(fuente), false, "el fragmento debe ser de solo lectura");
  let json = null; page.on("console", (m) => { if (m.text().startsWith("{")) json = m.text(); });
  const antes = await page.evaluate(() => document.documentElement.outerHTML.length), r = await page.evaluate(fuente);
  assert.ok(r.controles >= 8 && r.marcos_sin_inspeccionar === 1);
  const ayuda = JSON.parse(json).frames[0].r.controles.find((c) => c.texto === "Ayuda"); assert.equal(ayuda.href, "/ayuda/inicio", "el href sale sin ;jsessionid ni ?token"); assert.equal(await page.evaluate(() => document.documentElement.outerHTML.length), antes, "la página no cambió");
  for (const x of ["jsessionid", "QQQQ", "ZZZZ", "SECRETO", "juan.prueba", "1234567890", "ejemplo.test"]) assert.ok(!json.includes(x), `el JSON crudo de la consola no debe contener «${x}»`);
  assert.ok(json.includes("[REDACTADO]"), "se redactan los textos con correo o número largo");
  const raw = JSON.parse(json), viaConsola = construirInventario({ pagina: raw.pagina, frames: raw.frames, origen: "consola" }), directo = await inventariar(page);
  assert.equal(viaConsola.controles.length, directo.controles.filter((c) => c.marco === 0).length, "mismos controles del documento superior");
  assert.deepEqual(viaConsola.obstaculos.map((o) => o.codigo).filter((c) => c !== "marcos"), directo.obstaculos.map((o) => o.codigo).filter((c) => !["marcos"].includes(c)).filter((c) => viaConsola.obstaculos.some((o) => o.codigo === c)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-imp-")), ent = path.join(tmp, "consola.json"); fs.writeFileSync(ent, json);
  const cli = spawnSync(process.execPath, [path.join(AQUI, "../bin/importar-observacion.mjs"), `--entrada=${ent}`, "--alias=empresa-imp"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout); assert.match(cli.stdout, /Posibles obstáculos/); assert.match(cli.stdout, /componentes_personalizados/); assert.match(cli.stdout, /marcos_sin_inspeccionar_en_consola/);
  const mal = spawnSync(process.execPath, [path.join(AQUI, "../bin/importar-observacion.mjs"), `--entrada=${path.join(tmp, "no-existe.json")}`], { encoding: "utf8" }); assert.notEqual(mal.status, 0);
  fs.rmSync(path.join(AQUI, "../observaciones"), { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); await context.close();
});
await caso("COMPARAR: detecta los campos que aparecen al abrir una sección a mano (campos dinámicos)", async () => {
  const { context, page } = await nuevaPagina(); const a = await inventariar(page); await page.getByRole("tab", { name: "Detalle" }).click(); const b = await inventariar(page);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-cmp-")); fs.writeFileSync(path.join(tmp, "a.json"), JSON.stringify(a)); fs.writeFileSync(path.join(tmp, "b.json"), JSON.stringify(b));
  const c = spawnSync(process.execPath, [path.join(AQUI, "../bin/comparar.mjs"), path.join(tmp, "a.json"), path.join(tmp, "b.json")], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr); assert.match(c.stdout, /~ Descripción: oculto → visible/); assert.match(c.stdout, /~ Nombre del receptor: visible → oculto/); fs.rmSync(tmp, { recursive: true, force: true }); await context.close();
});

// ======================================================================= SEGUNDA OBSERVACIÓN (AngularJS simulado)
await caso("SEGUNDA OBSERVACIÓN (Angular simulado): ng-model, ayuda adyacente, comprobación de selectores CSS; solo lectura y sin datos personales", async () => {
  const { context, page } = await nuevaPagina(); await page.goto(URL_BASE + "ang");
  const cfgMapeo = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/mapeo.sat-preliminar.json"), "utf8")), css = [...cfgMapeo.comprobar_css, "input[name=\"Cantidad0\"]"];
  const fuente = fuenteConsola({ extendido: true, css });
  assert.equal(fs.readFileSync(path.join(AQUI, "../consola/observar-consola-2.js"), "utf8"), fuenteConsola({ extendido: true, css: cfgMapeo.comprobar_css }), "consola/observar-consola-2.js desactualizado: ejecuta node bin/generar-consola.mjs");
  const huella2 = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(AQUI, "../consola/observar-consola-2.js"), "utf8")).digest("hex");
  assert.ok(fs.readFileSync(path.join(AQUI, "../../docs/fase-2-analisis-observacion-1.md"), "utf8").includes(huella2), `la guía debe citar la huella del fragmento 2: ${huella2}`);
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\.click\s*\(|\.submit\s*\(|\.value\s*=|setAttribute|dispatchEvent|\.focus\s*\(|localStorage|sessionStorage|document\.cookie|WebSocket|eval\s*\(|new Function|createElement|innerHTML\s*=/.test(fuente), false, "el fragmento 2 debe ser de solo lectura");
  assert.throws(() => fuenteConsola({ extendido: true, css: ["a; fetch('/x')"] }), /no permitido/); assert.throws(() => fuenteConsola({ extendido: true, css: ["div > eval(1)"] }), /no permitido/);
  let json = null; page.on("console", (m) => { if (m.text().startsWith("{")) json = m.text(); });
  const antes = await page.evaluate(() => document.documentElement.outerHTML.length), r = await page.evaluate(fuente);
  assert.equal(await page.evaluate(() => document.documentElement.outerHTML.length), antes, "la página no cambió"); assert.ok(r.comprobaciones >= 20);
  for (const x of ["juan.prueba", "ejemplo.test"]) assert.ok(!json.includes(x), `el JSON no debe contener «${x}»`);
  const raw = JSON.parse(json), inv = construirInventario({ pagina: raw.pagina, frames: raw.frames, origen: "consola" });
  assert.equal(raw.frames[0].r.extra.extras.length, raw.frames[0].r.controles.length, "extras alineados con los controles"); assert.equal(inv.angular, "1.8.2");
  const nit = inv.controles.find((c) => c.ng?.model === "doc.receptor.nit"); assert.ok(nit); assert.equal(nit.ayuda, "NIT del Receptor"); assert.ok(nit.candidatos.some((k) => k.estrategia === "ng_model" && k.unico), "candidato ng_model único"); assert.equal(nit.mejor.estrategia, "ng_model");
  assert.equal(nit.leyenda, "Receptor"); assert.ok(inv.controles.find((c) => c.ng?.click === "eliminar($index)")); assert.equal(inv.controles.find((c) => c.ng?.repeat).ng.repeat, "item in doc.items");
  const radios = inv.controles.filter((c) => c.type === "radio"); assert.ok(radios.every((c) => c.candidatos.find((k) => k.estrategia === "nombre").estable === false), "name numérico = inestable"); assert.equal(radios[0].mejor.estrategia, "etiqueta");
  assert.deepEqual(inv.controles.find((c) => c.nombre === "BienOServicio0").opciones, ["Seleccione", "Bien", "Servicio"]);
  const desc = inv.controles.filter((c) => c.nombre === "Descripcion0"); assert.equal(desc.length, 2); assert.ok(desc.every((c) => c.mejor?.estrategia === "nombre" && c.mejor.unico), "nombre + tag desambigua input/select");
  const cmp = (q) => inv.comprobaciones.find((c) => c.css === q); assert.deepEqual([cmp('input[name="Cantidad0"]').total, cmp('input[name^="Cantidad"]').total, cmp('button[title="NIT del Receptor"]').total, cmp('select[name="Descripcion0"]').visibles, cmp('input[type="radio"]').total], [1, 1, 1, 0, 2]);
  assert.ok(inv.secciones.some((x) => x.tag === "legend" && x.texto === "Receptor"));
  // los localizadores nombre+tag y ng_model resuelven a UN elemento en la página
  for (const l of [{ estrategia: "nombre", valor: "Descripcion0", tag: "input" }, { estrategia: "nombre", valor: "Descripcion0", tag: "select" }, { estrategia: "ng_model", valor: "doc.receptor.nit", tag: "input" }]) await resolver(page, l, { timeout: 500 });
  await assert.rejects(() => resolver(page, { estrategia: "nombre", valor: "Descripcion0" }, { timeout: 300 }), /ambiguo/);
  const a = analizar(inv, { subsecciones_datos_generales: [], stems_linea: { BienOServicio: ["articulos", "tipo"], Cantidad: ["cantidades", "cantidad"], Descripcion: ["descripciones", "descripción"], PrecioUnitario: ["precios", "precio"], Total: ["totales", "total"] } });
  assert.ok(a.filas.some((f) => f.funcion === "cantidad" && f.estabilidad === "estable_ng_model"), JSON.stringify(a.por_estabilidad)); assert.ok(a.filas.some((f) => /Vista Previa/.test(f.funcion) && /BLOQUEADA/.test(f.accion)), "Vista Previa bloqueada");
  assert.ok(a.filas.some((f) => /Eliminar item/.test(f.funcion) && /BLOQUEADA/.test(f.accion)) && a.filas.some((f) => /Editar impuestos/.test(f.funcion) && /BLOQUEADA/.test(f.accion)));
  await context.close();
});

await caso("TERCERA observación (fragmento 3): sin texto de opciones salvo lista permitida, ng-model completo, solo lectura; fragmento 2 intacto", async () => {
  const { context, page } = await nuevaPagina(); await page.goto(URL_BASE + "ang");
  const cfg = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/mapeo.sat-preliminar.json"), "utf8")), css = cfg.comprobar_css;
  const f3 = fuenteConsola({ extendido: true, css, version: 3, permitidas: [] }), disco3 = fs.readFileSync(path.join(AQUI, "../consola/observar-consola-3.js"), "utf8");
  assert.equal(disco3, f3, "consola/observar-consola-3.js desactualizado: ejecuta node bin/generar-consola.mjs");
  const h = (x) => createHash("sha256").update(x).digest("hex"), doc = fs.readFileSync(path.join(AQUI, "../../docs/fase-2-informe-sat-2a.md"), "utf8");
  assert.ok(doc.includes(h(disco3)), `el informe debe citar la huella del fragmento 3: ${h(disco3)}`);
  assert.ok(fs.readFileSync(path.join(AQUI, "../../docs/fase-2-sat-2d-preparacion.md"), "utf8").includes(h(disco3)), "la guía de sat-2d debe citar la huella vigente del fragmento 3");
  assert.equal(h(fs.readFileSync(path.join(AQUI, "../consola/observar-consola-2.js"), "utf8")), "3f953dc0597b08da9b47a829483f204251b5f912da5e78c256b1cd29195c998e", "el fragmento 2 revisado no debe cambiar");
  assert.equal(h(fs.readFileSync(path.join(AQUI, "../consola/observar-consola.js"), "utf8")), "368a6a5dc32760fe1b85be87cdcc9c051c7c28966f4c32e3c61971eacea483a1", "el fragmento 1 revisado no debe cambiar");
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\.click\s*\(|\.submit\s*\(|\.value\s*=|setAttribute|dispatchEvent|\.focus\s*\(|localStorage|sessionStorage|document\.cookie|WebSocket|eval\s*\(|new Function|createElement|innerHTML\s*=/.test(f3), false);
  assert.throws(() => fuenteConsola({ extendido: true, css, version: 3, permitidas: ["a; fetch(1)"] }), /no permitido/);
  let json = null; page.on("console", (m) => { if (m.text().startsWith("{")) json = m.text(); });
  const antes = await page.evaluate(() => document.documentElement.outerHTML.length); await page.evaluate(f3); assert.equal(await page.evaluate(() => document.documentElement.outerHTML.length), antes);
  const raw = JSON.parse(json), ex = raw.frames[0].r.extra.extras, ctl = raw.frames[0].r.controles;
  assert.equal(raw.version, 3); assert.ok(ex.every((e) => !("opciones" in e)), "ningún texto de opciones"); assert.equal(ex[ctl.findIndex((c) => c.nombre === "BienOServicio0")].opciones_n, 3, "solo el conteo");
  assert.ok(!json.includes("Servicio\"") || !json.includes("\"Bien\""), "no aparece el texto de las opciones");
  assert.ok(!json.includes("RECEPTOR DE PRUEBA LARGO"), "los literales de texto largos de ng-* se sustituyen por …"); assert.ok(json.includes("…") && json.includes("'FACT'"), "los códigos cortos se conservan");
  const largo = ex.find((e) => e.ng.model.startsWith("complementoNotasDC.")).ng.model; assert.ok(largo.length > 80 && largo.endsWith("DeDoscientosCaracteres"), "ng-model completo");
  const f3p = fuenteConsola({ extendido: true, css: [], version: 3, permitidas: ["item.tipo"] }); json = null; await page.evaluate(f3p);
  const ex2 = JSON.parse(json).frames[0].r.extra.extras; assert.deepEqual(ex2.find((e) => e.ng.model === "item.tipo").opciones, ["Seleccione", "Bien", "Servicio"], "con lista permitida sí");
  await context.close();
});

await caso("AUTORIZACIÓN POR ETAPA: ejecutar con el mapeo REAL se niega sin autorización explícita (y no intenta conectarse); la etapa 1 no autoriza el llenado", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-aut-")), empresa = path.join(tmp, "e.json"); fs.writeFileSync(empresa, JSON.stringify({ alias: "empresa-aut", modo: "cdp", cdp: "http://127.0.0.1:9" }));
  const cmd = (extra, env) => spawnSync(process.execPath, [path.join(AQUI, "../bin/ejecutar.mjs"), `--empresa=${empresa}`, `--mapeo=${path.join(AQUI, "../config/mapeo.sat-preliminar.json")}`, `--datos=${path.join(AQUI, "../config/datos-ficticios-lineas.json")}`, ...extra], { encoding: "utf8", env: { ...process.env, FEL_AUTORIZACION_SAT: "", FEL_ETAPA_AUTORIZADA: "", ...env }, timeout: 30000 });
  try {
    for (const [extra, env, etiqueta] of [[["--solo-comprobar"], {}, "sin variables"], [["--solo-comprobar"], { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2" }, "etapa equivocada"], [[], { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa1" }, "llenar con la autorización de la etapa 1"]]) {
      const r = cmd(extra, env); assert.equal(r.status, 2, `${etiqueta}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, /Se niega a correr/, etiqueta); assert.doesNotMatch(r.stderr + r.stdout, /ECONNREFUSED|connectOverCDP/, `${etiqueta}: no debe intentar conectarse`);
    }
    assert.match(cmd(["--solo-comprobar"], {}).stderr, /FEL_AUTORIZACION_SAT/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(AQUI, "../registros"), { recursive: true, force: true }); }
});

await caso("COMANDOS REALES: bin/observar.mjs y bin/ejecutar.mjs contra un Chrome con puerto de depuración (sesión «ya iniciada»)", async () => {
  const puerto = 9800 + Math.floor(Math.random() * 150), b3 = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${puerto}`] }), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-cli-"));
  const empresa = path.join(tmp, "empresa.json"), mapa = path.join(tmp, "mapeo.json"), env = { ...process.env, FEL_POC_DEBUG: "" };
  fs.writeFileSync(empresa, JSON.stringify({ alias: "empresa-cli", modo: "cdp", cdp: `http://127.0.0.1:${puerto}`, identidad: { confirmacion_manual: true } })); fs.writeFileSync(mapa, JSON.stringify(mapeo()));
  try {
    const pg = await (await b3.newContext()).newPage(); await pg.goto(URL_BASE); posts.length = 0;
    const o = spawnSync(process.execPath, [path.join(AQUI, "../bin/observar.mjs"), `--empresa=${empresa}`], { encoding: "utf8", env, timeout: 60000 });
    assert.equal(o.status, 0, o.stderr + o.stdout); assert.match(o.stdout, /con riesgo de emisión: [1-9]/); assert.match(o.stdout, /Emitir documento/);
    const e = spawnSync(process.execPath, [path.join(AQUI, "../bin/ejecutar.mjs"), `--empresa=${empresa}`, `--mapeo=${mapa}`, `--datos=${path.join(AQUI, "../config/datos-ficticios.json")}`, "--solo-local"], { encoding: "utf8", input: "si\n\n", env, timeout: 60000 });
    assert.equal(e.status, 0, e.stderr + e.stdout); assert.match(e.stdout, /Detenido antes de emitir: SÍ · emitió: NO/); assert.match(e.stdout, /manuales: 2/);
    assert.equal(await pg.getByLabel("Nombre del receptor").inputValue(), "CLIENTE DE PRUEBA FEL"); assert.deepEqual(posts, []);
    const rechaza = spawnSync(process.execPath, [path.join(AQUI, "../bin/ejecutar.mjs"), `--empresa=${empresa}`, `--mapeo=${mapa}`, `--datos=${path.join(AQUI, "../config/datos-ficticios.json")}`], { encoding: "utf8", env, timeout: 60000 });
    assert.equal(rechaza.status, 2, "sin --solo-local el mapeo de ejemplo (host local, no verificado) se rechaza"); assert.match(rechaza.stderr, /Se niega a correr/);
  } finally { await b3.close(); fs.rmSync(tmp, { recursive: true, force: true }); for (const d of ["registros", "observaciones"]) fs.rmSync(path.join(AQUI, "..", d), { recursive: true, force: true }); }
});

await browser.close(); servidor.close();
console.log(`\n${n - fallos}/${n} casos OK${posts.length ? ` — ATENCIÓN: llegaron POST al servidor: ${posts.join(", ")}` : ""}`);
process.exit(fallos ? 1 : 0);
