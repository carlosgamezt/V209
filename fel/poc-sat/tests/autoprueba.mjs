// Autoprueba con Chrome real contra una página de EJEMPLO local (tests/fixture). No toca ningún sistema real.
// Demuestra el mecanismo: observar, llenar, registrar tiempos, y —sobre todo— que NO se puede emitir ni enviar.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "../src/playwright.mjs";
import { crearRegistro } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";
import { bloquearEscrituras, conectar, tomarBloqueo } from "../src/conexion.mjs";
import { inventariar, borradorMapeo } from "../src/observar.mjs";
import { validarMapeo } from "../src/guardia.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(AQUI, "fixture/formulario-generico.html"));
const mapeo = () => JSON.parse(fs.readFileSync(path.join(AQUI, "fixture/mapeo-fixture.json"), "utf8"));
const datos = () => JSON.parse(fs.readFileSync(path.join(AQUI, "../config/datos-ficticios.json"), "utf8"));
const base = (extra = {}) => ({ ...mapeo(), ...extra });

const posts = [];                       // todo POST que LLEGA al servidor (debe quedar vacío cuando la guardia está activa)
const servidor = http.createServer((req, res) => {
  if (req.method === "POST") { posts.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(200, { "content-type": "text/plain" }); return res.end("EMITIDO"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "sesion_demo=a; Path=/" }); res.end(html);
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
  assert.ok(b.omitidos_por_riesgo.some((o) => /contraseña/.test(o.motivo)), "la contraseña se omite");
  assert.ok(b.pasos.filter((p) => p.localizador).every((p) => p.verificado === false && p.dato === null));
  assert.equal(validarMapeo(b).ok, false); assert.equal(posts.length, 0); await context.close();
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
