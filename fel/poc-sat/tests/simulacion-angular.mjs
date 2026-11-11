// Prueba controlada de llenado contra una página AngularJS SIMULADA (AngularJS 1.5.8 real, estructura tomada de los atributos observados).
// NO se conecta al portal de SAT, usa datos ficticios y no emite nada. Ejecuta el MAPEO PRELIMINAR (config/mapeo.sat-preliminar.json) tal cual.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { lanzar, lanzarPersistente, descripcionNavegador } from "./navegador.mjs";
const ejecutarAsync = (cmd, args, o, entrada) => new Promise((ok) => { const h = execFile(cmd, args, o, (e, stdout, stderr) => ok({ status: e ? (e.code ?? 1) : 0, stdout, stderr })); if (entrada != null) { h.stdin.write(entrada); h.stdin.end(); } });
import { crearRegistro } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";
import { bloquearEscrituras } from "../src/conexion.mjs";
import { validarMapeo, recortarPlan } from "../src/guardia.mjs";
import { crearMonitorSesion } from "../src/sesion.mjs";
import { crearProgreso } from "../src/progreso.mjs";
import { crearLibro } from "../src/libro.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ANGULAR = (() => { try { return createRequire(import.meta.url).resolve("angular/angular.min.js"); } catch { const alt = process.env.ANGULAR_JS; if (alt && fs.existsSync(alt)) return alt; throw new Error("Falta AngularJS 1.5.8 para la simulación: ejecuta «npm install» en fel/poc-sat (o define ANGULAR_JS=ruta/angular.min.js)"); } })();
const html = fs.readFileSync(path.join(AQUI, "fixture/sat-angular-simulado.html"));
const pre = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/mapeo.sat-preliminar.json"), "utf8"));
const datosBase = () => { const d = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/datos-ficticios-lineas.json"), "utf8")); d.documento = { tipo_dte: "Factura de prueba A", moneda: "GTQ-Quetzal" }; d.lineas[0].descuento = "10"; d.lineas[0].total_esperado = "241.00"; d.receptor.nombre_esperado = "CONSUMIDOR FINAL DE PRUEBA"; d.receptor.respuesta_consulta_cf = "CONSUMIDOR FINAL DE PRUEBA"; return d; };

const posts = [], lecturas = [];   // lecturas: OPTIONS y GET que llegan al servidor de consulta simulado
let PUERTO = 0;
const envoltorio = (src, red) => `${envoltorioBase(src + (red ? "?red=1" : ""))}`;
const envoltorioBase = (src) => `<!doctype html><meta charset="utf-8"><title>Menú simulado (NO es SAT)</title><p>Página de menú SIMULADA con el formulario en un iframe.</p><iframe src="${src}" style="width:1100px;height:900px"></iframe>`;
const servidor = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/menu/portada.jsf")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); { const qs = req.url.split("?")[1]; return res.end(envoltorioBase(`http://felav.c.sat.gob.gt:${PUERTO}/fel-web/privado/vistas/fel.jsf${qs ? "?" + qs : ""}`)); } }
  if (req.method === "GET" && req.url.startsWith("/menu/hostil")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(envoltorio(`http://evil.example.test:${PUERTO}/felav.c.sat.gob.gt/fel-web/privado/vistas/fel.jsf`)); }
  if (req.url.startsWith("/consulta/")) {
    lecturas.push(`${req.method} ${req.url.split("?")[0]}`); const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-prueba", "access-control-allow-methods": "GET" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    res.writeHead(200, { "content-type": "application/json", ...cors }); return res.end(JSON.stringify({ nombre: "CONSUMIDOR FINAL DE PRUEBA" }));
  }
  if (req.method === "POST") { posts.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  if (req.url === "/angular.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(fs.readFileSync(ANGULAR)); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html);
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
console.log(`Navegador de pruebas: ${descripcionNavegador()} · páginas locales y simuladas; no se contacta con SAT\n`);
PUERTO = servidor.address().port;
const URL_BASE = `http://127.0.0.1:${PUERTO}/`, browser = await lanzar({ headless: true });
// Navegador SOLO para las pruebas con los nombres reales de host: los resuelve a 127.0.0.1 y NO resuelve ningún otro nombre (jamás se contacta a SAT).
const browserHosts = await lanzar({ headless: true, args: ["--host-resolver-rules=MAP felav.c.sat.gob.gt 127.0.0.1, MAP farm3.sat.gob.gt 127.0.0.1, MAP evil.example.test 127.0.0.1, MAP consulta.example.test 127.0.0.1, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"] });

// Solo para comprobar que las pruebas no dependen de la velocidad del equipo: FEL_PRUEBAS_LENTAS=ms añade una pausa antes de cada paso (no cambia ninguna aserción).
const PAUSA = Number(process.env.FEL_PRUEBAS_LENTAS ?? 0), HOOKS_LENTITUD = PAUSA > 0 ? { antesDePaso: () => new Promise((r) => setTimeout(r, PAUSA)) } : {};
let fallos = 0, n = 0;
const caso = async (nombre, fn) => { n++; try { await fn(); console.log(`OK     ${nombre}`); } catch (e) { fallos++; console.log(`FALLO  ${nombre}\n       ${String(e.message ?? e).split("\n").slice(0, 5).join("\n       ")}`); } };
const L = (estrategia, valor, extra = {}) => ({ estrategia, valor, ...extra });
const paso = (id, tipo, localizador, dato, extra = {}) => ({ id, tipo, localizador, dato, verificado: true, ...extra });

/** Plan = pasos del mapeo preliminar (idénticos) + pasos que la simulación permite añadir (tipo de documento, moneda, blur, lectura, validación). */
function planSimulado({ conBlur = true, extraFinal = [], conMarco = false } = {}) {
  const m = structuredClone(pre); delete m.sesion;
  if (!conMarco) { m.dominios_permitidos = ["127.0.0.1"]; for (const p of m.pasos) if (p.localizador) delete p.localizador.marco; }
  const por = Object.fromEntries(m.pasos.filter((p) => p.localizador).map((p) => [p.id, { ...p, verificado: true }]));
  const pasos = [
    m.pasos[0],
    paso("s010-tipo-documento", "seleccionar", L("ng_model", "datosGenerales.tipoDte", { tag: "select" }), "documento.tipo_dte"),
    paso("s020-moneda", "seleccionar", L("ng_model", "datosGenerales.moneda", { tag: "select" }), "documento.moneda"),
    por["p010-receptor-radio-nit"], por["p020-receptor-nit"],
    ...(conBlur ? [por["p025-receptor-salir-nit"], por["p026-receptor-leer-respuesta"]] : []),
    por["p030-receptor-direccion"], por["p100-linea0-tipo"], por["p110-linea0-cantidad"], por["p120-linea0-descripcion"], por["p130-linea0-precio"], por["p140-linea0-descuento"],
    por["p150-linea0-leer-total"],
    paso("s110-sin-errores", "verificar_ausente", L("clase", "ng-invalid", { visible: true })),
    ...extraFinal, { id: "p999-detener", tipo: "detener" },
  ];
  if (conMarco) for (const p of pasos) if (p.localizador && !p.localizador.marco) p.localizador.marco = pre.pasos[1].localizador.marco;   // los pasos añadidos por la simulación usan el mismo marco real
  return { ...m, pasos };
}
const modelo = (page) => page.evaluate(() => { const s = angular.element(document.body).scope(); return { tipo: s.datosGenerales.tipoDte?.nombre, moneda: s.datosGenerales.moneda, id: s.datosGenerales.tipoIdentificacion, nit: s.datosGenerales.nitReceptor, nombre: s.resultadoNIT.nombre, dir: s.datosGenerales.direccionReceptor, lineas: JSON.parse(angular.toJson(s.detalleFactura)), vistaPrevia: s.vistaPrevia }; });
async function correr(plan, { datos = datosBase(), guardia = true, timeout = 2500, page: pg = null, url = URL_BASE } = {}) {
  const context = pg ? pg.context() : await browser.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} });
  if (guardia && !pg) await bloquearEscrituras(context, {}, registro);
  const page = pg ?? await context.newPage(); if (!pg) await page.goto(url);
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa: { alias: "empresa-prueba" }, local: true, timeout, hooks: HOOKS_LENTITUD, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  return { ...r, page, context, registro };
}
const hits = () => posts.length;

await caso("MAPEO: el plan de la simulación contiene los pasos del mapeo preliminar SIN modificar sus localizadores", async () => {
  const plan = planSimulado(), ids = pre.pasos.filter((p) => p.localizador).map((p) => p.id);
  const sinMarco = (l) => { const { marco, ...r } = l; return r; };
  for (const id of ids) assert.deepEqual(sinMarco(plan.pasos.find((p) => p.id === id).localizador), sinMarco(pre.pasos.find((p) => p.id === id).localizador), id);
  assert.ok(validarMapeo(plan, { local: true }).ok, validarMapeo(plan, { local: true }).errores.join("\n")); assert.equal(plan.pasos.at(-1).tipo, "detener");
});

await caso("1-5 FLUJO COMPLETO: tipo de documento y moneda, receptor, línea 0, modelos AngularJS actualizados, total leído, sin errores; se detiene sin enviar nada", async () => {
  posts.length = 0; const r = await correr(planSimulado());
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.equal(r.detenido, true); assert.equal(r.resumen.emitio, false);
  const m = await modelo(r.page), d0 = m.lineas[0];
  assert.deepEqual([m.tipo, m.moneda, m.id, m.nit, m.nombre, m.dir], ["Factura de prueba A", "GTQ-Quetzal", "NIT", "CF", "CONSUMIDOR FINAL DE PRUEBA", "CIUDAD DE PRUEBA"], JSON.stringify(m));
  assert.deepEqual([d0.BienOServicio, d0.Cantidad, d0.Descripcion, d0.PrecioUnitario, d0.Descuento, d0.Total], ["Servicio", "2", "SERVICIO DE PRUEBA UNO - NO EMITIR", "125.50", "10", "241.00"], "modelos de la línea 0");
  assert.equal(await r.page.locator('input[name="Total0"]').inputValue(), "241.00"); assert.equal(await r.page.locator('input[name="Cantidad0"]').evaluate((e) => e.classList.contains("ng-dirty")), true, "AngularJS marcó el campo como modificado (ng-dirty)");
  assert.equal(await r.page.locator(".ng-invalid:visible").count(), 0, "ningún campo visible inválido"); assert.equal(m.vistaPrevia, false);
  const s = r.resumen; assert.equal(s.errores.length, 0); assert.equal(s.bloqueos_de_guardia.length, 0); assert.ok(s.fases.llenado.ms > 0); assert.deepEqual(posts, [], "ninguna petición de escritura llegó al servidor");
  assert.ok(r.registro.eventos().some((e) => e.id === "p150-linea0-leer-total" && /coincide/.test(e.detalle)) && r.registro.eventos().some((e) => e.id === "s110-sin-errores" && e.resultado === "ok"));
  await r.context.close();
});

await caso("LECTURA ASÍNCRONA (determinista): el total llega al modelo con un retraso EXPLÍCITO; con espera la lectura reintenta y pasa; sin espera falla, sea cual sea la velocidad del equipo", async () => {
  // El retraso lo fija la página (?retardo=ms), no la velocidad de la máquina ni del navegador.
  const conEspera = planSimulado({ conBlur: false }); conEspera.pasos.find((p) => p.id === "p150-linea0-leer-total").espera_ms = 12000;
  const r = await correr(conEspera, { url: URL_BASE + "?retardo=4000" }); assert.equal(r.ok, true, JSON.stringify(r.resumen.errores));
  const lectura = r.registro.eventos().find((e) => e.evento === "paso" && e.id === "p150-linea0-leer-total");
  assert.ok(lectura.resultado === "ok" && lectura.ms >= 300, `la lectura tuvo que ESPERAR al modelo asíncrono (tardó ${lectura.ms} ms)`);
  assert.equal(await r.page.locator('input[name="Total0"]').inputValue(), "241.00");
  const sinEspera = planSimulado({ conBlur: false }); sinEspera.pasos.find((p) => p.id === "p150-linea0-leer-total").espera_ms = 0;   // sin reintento: la primera lectura llega antes que el modelo
  const r2 = await correr(sinEspera, { url: URL_BASE + "?retardo=6000" });
  assert.equal(r2.ok, false, "con el modelo retrasado y sin tiempo de espera la lectura del total calculado de forma asíncrona falla (por eso leer reintenta)"); assert.match(r2.resumen.errores[0]?.detalle ?? "", /no coincide/);
  assert.equal(r2.resumen.errores[0].id, "p150-linea0-leer-total");
  await r.context.close(); await r2.context.close();
});

await caso("TIEMPOS DE LA CONSULTA: al llenar el campo siguiente el NIT pierde el foco solo; sin salir_del_campo el nombre aún no existe cuando se lee justo después", async () => {
  const sinBlur = planSimulado({ conBlur: false }); sinBlur.pasos.splice(sinBlur.pasos.findIndex((p) => p.id === "p020-receptor-nit") + 1, 0, paso("s040-leer-nombre", "leer", L("ng_model", "resultadoNIT.nombre", { tag: "input", visible: true }), "receptor.nombre_esperado", { espera_ms: 0 }));
  const r = await correr(sinBlur); assert.equal(r.ok, false, "leer el nombre justo después de escribir el NIT, sin blur ni espera, falla"); assert.equal(r.resumen.errores[0].id, "s040-leer-nombre"); await r.context.close();
  const r1 = await correr(planSimulado({ conBlur: false })); assert.equal((await modelo(r1.page)).nombre, "CONSUMIDOR FINAL DE PRUEBA", "si no se lee enseguida, la consulta ocurre al pasar al campo siguiente"); await r1.context.close();
  const r2 = await correr(planSimulado()); assert.equal(r2.ok, true); await r2.context.close();
});

await caso("6 VALIDACIÓN: una cantidad inválida se detecta (mensaje visible y campos ng-invalid) y detiene la ejecución", async () => {
  const d = datosBase(); d.lineas[0].cantidad = "abc";
  const r = await correr(planSimulado(), { datos: d });
  if (process.env.DEBUG_SIM) console.log(JSON.stringify([r.ok, r.estado, r.resumen.errores, r.resumen.bloqueos_de_guardia, r.registro.eventos().filter((e) => e.evento === "paso").map((e) => [e.id, e.resultado, e.detalle])]));
  assert.equal(r.ok, false); assert.equal(r.estado, "interrumpido");
  const falla = r.resumen.errores.find((e) => e.id === "p150-linea0-leer-total" || e.id === "s110-sin-errores"); assert.ok(falla, JSON.stringify(r.resumen.errores));
  assert.equal(await r.page.getByText("Cantidad no válida").isVisible(), true, "el mensaje de validación de la página es visible"); assert.equal(await r.page.locator('input[name="Cantidad0"]').evaluate((e) => e.classList.contains("ng-invalid")), true);
  assert.deepEqual(posts.filter((x) => /emitir|vista|guardar/.test(x)), []); await r.context.close();
  // el paso verificar_ausente por sí solo reporta cuántos campos inválidos hay
  const solo = planSimulado(); solo.pasos = solo.pasos.filter((p) => !/p150|p999/.test(p.id)); solo.pasos.push({ id: "p999-detener", tipo: "detener" });
  const r2 = await correr(solo, { datos: d }); if (process.env.DEBUG_SIM) console.log("R2", JSON.stringify([r2.ok, r2.resumen.errores, solo.pasos.map((p) => p.id), await r2.page.locator(".ng-invalid:visible").count()])); assert.match(r2.resumen.errores[0].detalle, /error(es)? de validación/); await r2.context.close();
});
await caso("6 VALIDACIÓN: descuento mayor que el subtotal → mensaje de error y total vacío; esperar_visible puede exigir el mensaje", async () => {
  const d = datosBase(); d.lineas[0].descuento = "999";
  const plan = planSimulado(); plan.pasos = plan.pasos.filter((p) => !/p150|s110|p999/.test(p.id));
  plan.pasos.push({ id: "s120-esperar-mensaje", tipo: "esperar_visible", localizador: L("texto", "El descuento supera el subtotal", { exacto: true }), verificado: true }, { id: "p999-detener", tipo: "detener" });
  const r = await correr(plan, { datos: d }); assert.equal(r.ok, true, JSON.stringify(r.resumen.errores)); assert.equal(await r.page.locator('input[name="Total0"]').inputValue(), "", "total vacío ante descuento inválido"); await r.context.close();
});

await caso("7 BLOQUEO ABSOLUTO: Vista Previa, Guardar y Emitir no se pueden pulsar aunque el plan «aprobe» ambigüedades o envíos de formulario", async () => {
  posts.length = 0;
  for (const [id, quien] of [["vp", "Vista Previa (ng-click validarInformacion)"], ["gb", "Guardar borrador (ng-click guardarBorrador)"], ["el0", "Eliminar item (title + eliminarItem)"]]) {
    const plan = planSimulado(); plan.pasos.splice(-1, 0, { id: "x-" + id, tipo: "clic_seguro", motivo: "abrir sección", localizador: L("id", id), ambiguo_aprobado: true, permitir_envia_formulario: true, verificado: true });
    const r = await correr(plan); assert.equal(r.ok, false, quien); assert.equal(r.resumen.bloqueos_de_guardia.length, 1, quien); assert.match(r.resumen.bloqueos_de_guardia[0].detalle, /RECHAZADO/, quien);
    assert.equal((await modelo(r.page)).vistaPrevia, false, "la vista previa nunca se abrió"); assert.equal((await modelo(r.page)).lineas.length, 1, "no se eliminó la línea"); await r.context.close();
  }
  assert.deepEqual(posts, [], "ningún POST llegó al servidor");
  // el botón Emitir (solo existe tras la vista previa) tampoco se puede pulsar
  const plan = planSimulado(); plan.pasos.splice(-1, 0, { id: "x-emi", tipo: "clic_seguro", motivo: "abrir sección", localizador: L("id", "emi"), ambiguo_aprobado: true, verificado: true });
  const r = await correr(plan); assert.equal(r.resumen.bloqueos_de_guardia.length, 1); await r.context.close();
  // y los localizadores por texto prohibido ni siquiera pasan la validación del plan
  for (const v of ["Vista Previa", "Guardar borrador", "Emitir", "Eliminar item"]) { const p2 = planSimulado(); p2.pasos.splice(-1, 0, { id: "x", tipo: "clic_seguro", motivo: "abrir sección", localizador: L("texto", v), verificado: true }); assert.equal(validarMapeo(p2, { local: true }).ok, false, v); }
});
await caso("7 ACCIONES AMBIGUAS: «Editar impuestos» y «Agregar item» exigen aprobación humana; con ella solo agregan una línea (clic no repetible, se cuenta)", async () => {
  const clic = (id, aprobado) => { const plan = planSimulado(); plan.pasos.splice(-1, 0, { id: "x-" + id, tipo: "clic_seguro", motivo: "abrir sección", localizador: L("id", id), ...(aprobado ? { ambiguo_aprobado: true } : {}), verificado: true }); return plan; };
  for (const id of ["imp0", "agr"]) { const r = await correr(clic(id, false)); assert.equal(r.resumen.bloqueos_de_guardia.length, 1, id); await r.context.close(); }
  const r = await correr(clic("agr", true)); assert.equal(r.ok, true, JSON.stringify(r.resumen.errores)); assert.equal(await r.page.locator('input[name^="Cantidad"]').count(), 2, "una línea más (conteo 1 → 2)"); await r.context.close();
});
await caso("7 RED: aunque la página intente enviar (clic desde fuera del ejecutor), la guardia aborta el POST y la vista previa no se abre; SIN guardia sí se enviaría (control negativo)", async () => {
  posts.length = 0; const ctx = await browser.newContext(), reg = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(ctx, {}, reg); const pg = await ctx.newPage(); await pg.goto(URL_BASE);
  await pg.evaluate(() => document.getElementById("vp").click()); await pg.evaluate(() => document.getElementById("gb").click()); await pg.waitForTimeout(400);
  assert.deepEqual(posts, [], "cero POST"); assert.equal((await modelo(pg)).vistaPrevia, false, "no se abrió la vista previa ni aparece Emitir"); assert.ok(reg.eventos().filter((e) => e.evento === "solicitud_bloqueada").length >= 2); await ctx.close();
  const libre = await browser.newContext(), pl = await libre.newPage(); await pl.goto(URL_BASE); await pl.evaluate(() => document.getElementById("vp").click()); await pl.waitForTimeout(400);
  assert.deepEqual(posts, ["POST /api/vista-previa"], "control negativo: sin guardia el envío llega al servidor"); assert.equal((await modelo(pl)).vistaPrevia, true); await libre.close(); posts.length = 0;
});
await caso("PRIVACIDAD: el registro de la ejecución no contiene valores de campos ni del receptor", async () => {
  const r = await correr(planSimulado()), txt = JSON.stringify(r.registro.eventos());
  for (const x of ["SERVICIO DE PRUEBA", "CIUDAD DE PRUEBA", "CONSUMIDOR FINAL", "125.50", "241.00"]) assert.ok(!txt.includes(x), `el registro no debe contener «${x}»`); await r.context.close();
});

// ======================================================================= IFRAME con los nombres de host reales (resueltos a localhost, jamás a SAT)
async function correrIframe(plan, { url = "menu/portada.jsf", datos = datosBase(), guardia = true, timeout = 2500 } = {}) {
  const context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} });
  if (guardia) await bloquearEscrituras(context, {}, registro);
  const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/${url}`); await page.frameLocator("iframe").locator("body").waitFor();
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa: { alias: "empresa-prueba" }, local: false, timeout, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  return { ...r, page, context, registro, frame: page.frames().find((f) => f.url().includes("/fel-web/")) };
}
const modeloF = (f) => f.evaluate(() => { const s = angular.element(document.body).scope(); return { tipo: s.datosGenerales.tipoDte?.nombre, moneda: s.datosGenerales.moneda, id: s.datosGenerales.tipoIdentificacion, nit: s.datosGenerales.nitReceptor, nombre: s.resultadoNIT.nombre, lineas: JSON.parse(angular.toJson(s.detalleFactura)), vistaPrevia: s.vistaPrevia }; });

await caso("IFRAME: el mapeo REAL (hosts y marco de SAT, sin tocar) ejecuta el flujo dentro del iframe; la validación es la de producción (no local)", async () => {
  posts.length = 0; const plan = planSimulado({ conMarco: true });
  assert.deepEqual(plan.dominios_permitidos, ["felav.c.sat.gob.gt", "farm3.sat.gob.gt"]); assert.ok(validarMapeo(plan).ok, validarMapeo(plan).errores.join("\n"));
  const r = await correrIframe(plan);
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.ok(r.frame, "el formulario está en un marco distinto del de la página");
  const m = await modeloF(r.frame); assert.deepEqual([m.tipo, m.moneda, m.id, m.nit, m.nombre, m.lineas[0].Cantidad, m.lineas[0].Total], ["Factura de prueba A", "GTQ-Quetzal", "NIT", "CF", "CONSUMIDOR FINAL DE PRUEBA", "2", "241.00"]);
  assert.deepEqual(posts, []); await r.context.close();
});
await caso("IFRAME HOSTIL: un marco de otro host cuya URL contiene el texto esperado NO se acepta (el host del marco debe estar en dominios_permitidos)", async () => {
  posts.length = 0; const r = await correrIframe(planSimulado({ conMarco: true }), { url: "menu/hostil" });
  assert.equal(r.ok, false); assert.ok(r.resumen.bloqueos_de_guardia.some((b) => /no está en dominios_permitidos/.test(b.detalle)), JSON.stringify(r.resumen.bloqueos_de_guardia));
  assert.equal(await r.frame?.locator('input[name="Cantidad0"]').inputValue().catch(() => ""), "", "no se escribió nada en el marco hostil"); assert.deepEqual(posts, []); await r.context.close();
});
await caso("IFRAME AUSENTE: si no existe el marco indicado, se detiene sin tocar la página del menú", async () => {
  const plan = planSimulado({ conMarco: true }); for (const p of plan.pasos) if (p.localizador) p.localizador.marco = { url_contiene: "felav.c.sat.gob.gt/no-existe/xx" };
  const r = await correrIframe(plan); assert.equal(r.ok, false); assert.match(r.resumen.errores[0].detalle, /no se encontró el marco/); await r.context.close();
});
await caso("IFRAME + RED: un clic desde dentro del iframe sobre Vista Previa/Guardar no envía nada (la guardia de red es del contexto); sin guardia sí envía", async () => {
  posts.length = 0; const ctx = await browserHosts.newContext(), reg = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(ctx, {}, reg);
  const pg = await ctx.newPage(); await pg.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await pg.frameLocator("iframe").locator("#vp").waitFor();
  const f = pg.frames().find((x) => x.url().includes("/fel-web/")); await f.evaluate(() => { document.getElementById("vp").click(); document.getElementById("gb").click(); }); await pg.waitForTimeout(400);
  assert.deepEqual(posts, []); assert.equal((await modeloF(f)).vistaPrevia, false); assert.ok(reg.eventos().filter((e) => e.evento === "solicitud_bloqueada").length >= 2); await ctx.close();
  const libre = await browserHosts.newContext(), pl = await libre.newPage(); await pl.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await pl.frameLocator("iframe").locator("#vp").waitFor();
  await pl.frames().find((x) => x.url().includes("/fel-web/")).evaluate(() => document.getElementById("vp").click()); await pl.waitForTimeout(400); assert.deepEqual(posts, ["POST /api/vista-previa"], "control negativo"); await libre.close(); posts.length = 0;
});
await caso("IFRAME + BLOQUEO: los clics a Vista Previa / Guardar / Eliminar dentro del iframe se rechazan aunque el plan apruebe ambigüedades", async () => {
  posts.length = 0;
  for (const id of ["vp", "gb", "el0"]) { const plan = planSimulado({ conMarco: true }); plan.pasos.splice(-1, 0, { id: "x-" + id, tipo: "clic_seguro", motivo: "abrir sección", localizador: { ...L("id", id), marco: pre.pasos[1].localizador.marco }, ambiguo_aprobado: true, permitir_envia_formulario: true, verificado: true });
    const r = await correrIframe(plan); assert.equal(r.resumen.bloqueos_de_guardia.length, 1, id); assert.equal((await modeloF(r.frame)).vistaPrevia, false); await r.context.close(); }
  assert.deepEqual(posts, []);
});

await caso("GET ENTRE DOMINIOS (como felav → felav02): se BLOQUEA por defecto; solo pasa con una regla permitir_get revisada; con ella el preflight lo responde Playwright y el registro solo guarda método+host+ruta", async () => {
  const plan = planSimulado({ conMarco: true }), politicaBase = { dominios: plan.dominios_permitidos };
  const ejecutar = async (politica, quitarLectura = false) => {
    posts.length = 0; lecturas.length = 0; const p = structuredClone(plan); if (quitarLectura) p.pasos = p.pasos.filter((x) => x.id !== "p026-receptor-leer-respuesta");
    const context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} }); await bloquearEscrituras(context, politica, registro);
    const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf?red=1`); await page.frameLocator("iframe").locator("body").waitFor();
    const r = await ejecutarPlan({ page, plan: p, datos: datosBase(), registro, empresa: { alias: "empresa-prueba" }, local: false, timeout: 2500, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
    return { ...r, registro, context, page };
  };
  // 1) sin regla: el XHR a otro dominio se bloquea, el servidor no lo ve y el nombre no aparece (la prueba lo detecta)
  const a = await ejecutar(politicaBase); assert.equal(a.ok, false, "sin autorización del dominio el campo del nombre no se llena"); assert.equal(lecturas.length, 0, "el GET no llegó al servidor");
  assert.ok(a.resumen.solicitudes_bloqueadas.some((x) => /GET consulta\.example\.test\/consulta\/receptor\/CF/.test(x)), JSON.stringify(a.resumen.solicitudes_bloqueadas)); assert.deepEqual(a.resumen.lecturas_xhr, []); await a.context.close();
  // 2) con una regla explícita (host + ruta + motivo + revisado) pasa
  const regla = { host: "consulta.example.test", ruta_prefijo: "/consulta/receptor/", motivo: "ruta de lectura revisada en la prueba", revisado: true };
  assert.ok(validarMapeo({ ...plan, permitir_get: [regla] }).ok);
  const b = await ejecutar({ ...politicaBase, permitir_get: [regla] }); assert.equal(b.ok, true, JSON.stringify(b.resumen.errores) + JSON.stringify(b.resumen.bloqueos_de_guardia));
  assert.ok(lecturas.includes("GET /consulta/receptor/CF")); assert.ok(!lecturas.includes("OPTIONS /consulta/receptor/CF"), "HALLAZGO: con la interceptación activa Playwright responde el preflight por su cuenta; al servidor solo llega el GET");
  assert.deepEqual(b.resumen.lecturas_xhr, ["GET consulta.example.test/consulta/receptor/CF"]); assert.deepEqual(posts, []);
  const txt = JSON.stringify(b.registro.eventos()); assert.ok(!txt.includes("X-Prueba") && !txt.includes("CONSUMIDOR FINAL DE PRUEBA"), "no se registran cabeceras ni cuerpos"); await b.context.close();
  // 3) una regla para un prefijo distinto no autoriza esta ruta
  const c = await ejecutar({ ...politicaBase, permitir_get: [{ ...regla, ruta_prefijo: "/consulta/otra/" }] }); assert.equal(c.ok, false); assert.equal(lecturas.length, 0); await c.context.close();
});
await caso("GET SENSIBLES: una lectura dinámica con ruta de emisión/guardado se bloquea y se registra; una ruta con un NIT largo se registra enmascarada", async () => {
  lecturas.length = 0; const context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(context, {}, registro);
  const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await page.frameLocator("iframe").locator("body").waitFor();
  const f = page.frames().find((x) => x.url().includes("/fel-web/")), base = `http://consulta.example.test:${PUERTO}`;
  const probar = (ruta) => f.evaluate(async (u) => { try { await fetch(u, { method: "GET" }); return "llegó"; } catch { return "bloqueado"; } }, base + ruta);
  for (const ruta of ["/consulta/emitir/documento", "/consulta/guardar/borrador", "/consulta/certificar", "/consulta/anular/1", "/consulta/Firma/x"]) assert.equal(await probar(ruta), "bloqueado", ruta);
  assert.equal(await probar("/consulta/receptor/1234567890"), "llegó");
  assert.ok(lecturas.every((l) => !/emitir|guardar|certificar|anular|firma/i.test(l) || l.startsWith("OPTIONS")), `ningún GET sensible llegó al servidor: ${lecturas}`);
  const res = registro.resumen({}); assert.deepEqual(res.lecturas_xhr, ["GET consulta.example.test/consulta/receptor/:id"], "el NIT largo sale enmascarado"); assert.ok(res.solicitudes_bloqueadas.length >= 5); await context.close();
});
await caso("SOLO COMPROBAR: resuelve y comprueba todos los localizadores del mapeo SIN escribir, elegir, marcar, salir de campos ni pulsar nada", async () => {
  posts.length = 0; const { context, page, registro } = await (async () => { const c = await browser.newContext(), reg = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(c, {}, reg); const p = await c.newPage(); await p.goto(URL_BASE); return { context: c, page: p, registro: reg }; })();
  const plan = planSimulado({ extraFinal: [{ id: "x-clic", tipo: "clic_seguro", motivo: "abrir sección", localizador: L("id", "agr"), ambiguo_aprobado: true, verificado: true }] });
  const antes = await modelo(page), r = await ejecutarPlan({ page, plan, datos: datosBase(), registro, empresa: { alias: "empresa-prueba" }, local: true, soloComprobar: true, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.deepEqual(await modelo(page), antes, "el modelo de AngularJS no cambió");
  assert.equal(await page.locator('input[name="Cantidad0"]').inputValue(), ""); assert.equal(await page.locator('input[name^="Cantidad"]').count(), 1, "no se pulsó «Agregar item»");
  const det = registro.eventos().filter((e) => e.evento === "paso").map((e) => e.detalle).join("|"); assert.match(det, /comprobado sin escribir/); assert.match(det, /NO se pulsa/); assert.deepEqual(posts, []);
  const mal = planSimulado(); mal.pasos.find((p) => p.id === "p110-linea0-cantidad").localizador = L("nombre", "NoExiste9", { tag: "input" });   // y detecta localizadores rotos sin tocar nada
  const r2 = await ejecutarPlan({ page, plan: mal, datos: datosBase(), registro: crearRegistro({ empresa: "x", salida: () => {} }), empresa: { alias: "e" }, local: true, soloComprobar: true, esperarUsuario: async () => "si", salida: () => {}, timeout: 600 });
  assert.equal(r2.ok, false); assert.match(r2.resumen.errores[0].detalle, /ningún elemento/); await context.close();
});

// ======================================================================= ETAPA 1 (solo comprobar): ensayo con el mapeo REAL, sin tocar, contra la simulación en iframe
async function etapa1Iframe({ hooksDe = () => ({}) } = {}) {
  const plan = structuredClone(pre), datos = datosBase();   // el mapeo REAL tal cual (verificado:false) y los dominios reales
  const context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} });
  await bloquearEscrituras(context, { permitir_post: [], permitir_get: [], dominios: plan.dominios_permitidos }, registro);
  const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await page.frameLocator("iframe").locator("body").waitFor();
  const frame = () => page.frames().find((f) => f.url().includes("/fel-web/")), sesion = crearMonitorSesion({ config: plan.sesion, dominios: plan.dominios_permitidos, salida: () => {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fel-e1-")), preguntas = [], t0 = Date.now();
  const detenerSi = () => { const b = registro.eventos().find((e) => e.evento === "solicitud_bloqueada"); return b ? `solicitud bloqueada durante la comprobación (${b.metodo} ${b.host}${b.ruta}): ${b.razon}` : null; };
  const antes = await modeloF(frame());
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa: { alias: "empresa-prueba" }, local: false, soloComprobar: true, sesion, progreso: crearProgreso({ dir, plan, datos }), libro: crearLibro({ dir }), detenerSi, hooks: hooksDe(frame), timeout: 2500,
    esperarUsuario: async (q) => { preguntas.push(q); return /empresa/.test(q) ? "si" : ""; }, salida: () => {} });
  return { ...r, page, context, registro, frame, dir, preguntas, antes, ms: Date.now() - t0 };
}
const sinCambios = async (r) => { const f = r.frame(); assert.deepEqual(await modeloF(f), r.antes, "el modelo de AngularJS no cambió"); assert.equal(await f.locator(".ng-dirty").count(), 0, "ningún campo fue modificado (ng-dirty)"); assert.equal(await f.locator('input[name="Cantidad0"]').inputValue(), ""); assert.equal(await f.locator('input[name^="Cantidad"]').count(), 1); };

await caso("ETAPA 1 · ENSAYO: el plan REAL (mapeo sin tocar, hosts y marco de SAT) en solo-comprobar: todo comprobado, nada escrito, ninguna petición bloqueada ni de escritura, sin progreso ni libro", async () => {
  posts.length = 0; const r = await etapa1Iframe();
  assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); await sinCambios(r);
  const det = r.registro.eventos().filter((e) => e.evento === "paso").map((e) => `${e.id}:${e.detalle}`).join("\n");
  for (const id of ["p010-receptor-radio-nit", "p020-receptor-nit", "p025-receptor-salir-nit", "p030-receptor-direccion", "p100-linea0-tipo", "p110-linea0-cantidad", "p120-linea0-descripcion", "p130-linea0-precio", "p140-linea0-descuento", "p150-linea0-leer-total"]) assert.match(det, new RegExp(`${id}:(comprobado|clasificado)`), id);
  assert.match(det, /p026-receptor-leer-respuesta:no comprobable en frío/, "el nombre aparece tras escribir CF: en frío no se puede comprobar y se dice");
  assert.ok(!/elegida|llenado|marcad[ao]\b|se salió/.test(det.replace(/sin (elegir|marcar|salir|escribir)[^|\n]*/g, "")), "ningún detalle indica una acción real");
  assert.deepEqual(r.resumen.solicitudes_bloqueadas, []); assert.deepEqual(r.resumen.lecturas_xhr, []); assert.deepEqual(posts, []); assert.equal(r.resumen.emitio, false); assert.equal(r.resumen.errores.length, 0);
  assert.deepEqual(r.preguntas.map((q) => /empresa/.test(q) ? "identidad" : "manual"), ["identidad", "manual"], "solo la confirmación de identidad y la apertura manual del formulario");
  assert.deepEqual(fs.readdirSync(r.dir), [], "no se escribió progreso ni libro"); assert.ok(r.registro.eventos().some((e) => e.evento === "sesion_sat" && e.estado === "activa"), "sesión comprobada como activa por el indicador de pestaña");
  const txt = JSON.stringify(r.registro.eventos()); for (const x of ["SERVICIO DE PRUEBA", "CIUDAD DE PRUEBA", "RECEPTOR DE PRUEBA", "125.50", "251.00", "Consumidor Final"]) assert.ok(!txt.includes(x), `el registro no debe contener «${x}»`);
  await r.context.close();
});
await caso("ETAPA 1 · SESIÓN PERDIDA: la comprobación SE DETIENE (no espera ni reanuda) y no pide nada al usuario", async () => {
  const r = await etapa1Iframe({ hooksDe: (frame) => ({ antesDeEjecutar: async (p) => { if (p.id === "p110-linea0-cantidad") await frame().evaluate(() => window.__expirar("overlay")); } }) });
  assert.equal(r.ok, false); assert.equal(r.estado, "sesion_perdida"); assert.ok(r.ms < 6000, `se detuvo enseguida (${r.ms} ms), sin esperar el inicio de sesión`);
  assert.ok(r.registro.eventos().some((e) => e.id === "p-sesion" && e.resultado === "bloqueado"), "queda registrado"); assert.equal(r.preguntas.length, 2, "no pidió nada más (ni «escribe si cuando termines»)");
  assert.equal(r.resumen.fases.autenticacion?.ms ?? 0, 0); assert.deepEqual(fs.readdirSync(r.dir), []); assert.equal(await r.frame().locator(".ng-dirty").count(), 0); await r.context.close();
});
await caso("ETAPA 1 · SIN SESIÓN AL EMPEZAR: se detiene antes de comprobar ningún localizador", async () => {
  const plan = structuredClone(pre), context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(context, { dominios: plan.dominios_permitidos }, registro);
  const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await page.frameLocator("iframe").locator("body").waitFor();
  const f = page.frames().find((x) => x.url().includes("/fel-web/")); await f.evaluate(() => window.__expirar("overlay"));
  const rr = await ejecutarPlan({ page, plan, datos: datosBase(), registro, empresa: { alias: "x" }, local: false, soloComprobar: true, sesion: crearMonitorSesion({ config: plan.sesion, dominios: plan.dominios_permitidos, salida: () => {} }), esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  assert.equal(rr.ok, false); assert.equal(rr.estado, "sesion_perdida"); assert.equal(rr.resumen.pasos <= 3, true, "ningún localizador se comprobó"); await context.close();
});
await caso("ETAPA 1 · PETICIÓN INESPERADA: si el portal intenta escribir (POST) durante la comprobación, la guardia la aborta y la comprobación SE DETIENE", async () => {
  posts.length = 0; const r = await etapa1Iframe({ hooksDe: (frame) => ({ antesDePaso: async (p) => { if (p.id === "p100-linea0-tipo") { await frame().evaluate(() => { fetch("/api/guardar", { method: "POST", body: "x" }).catch(() => {}); }); await new Promise((ok) => setTimeout(ok, 300)); } } }) });
  assert.equal(r.ok, false); assert.equal(r.estado, "detenido_por_alerta"); assert.match(r.resumen.bloqueos_de_guardia.at(-1).detalle, /POST/); assert.deepEqual(posts, [], "el POST no llegó al servidor");
  assert.ok(!r.registro.eventos().some((e) => e.id === "p110-linea0-cantidad"), "no se comprobó nada después de la alerta"); await r.context.close();
});
await caso("ETAPA 1 · DIÁLOGO INESPERADO: un aviso del portal detiene la comprobación (se descarta, nunca se acepta)", async () => {
  const r = await etapa1Iframe({ hooksDe: (frame) => ({ antesDePaso: async (p) => { if (p.id === "p100-linea0-tipo") { await frame().evaluate(() => { setTimeout(() => alert("aviso"), 20); }); await new Promise((ok) => setTimeout(ok, 400)); } } }) });
  assert.equal(r.ok, false); assert.equal(r.estado, "detenido_por_alerta"); assert.ok(r.registro.eventos().some((e) => e.evento === "nota" && /diálogo alert descartado/.test(e.texto))); await r.context.close();
});
await caso("ETAPA 1 · LOCALIZADOR AUSENTE O AMBIGUO: se detiene en el primero, sin tocar nada", async () => {
  const mk = async (loc) => { const plan = structuredClone(pre); plan.pasos.find((p) => p.id === "p110-linea0-cantidad").localizador = { ...loc, marco: pre.pasos[1].localizador.marco };
    const context = await browserHosts.newContext(), registro = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(context, { dominios: plan.dominios_permitidos }, registro);
    const page = await context.newPage(); await page.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await page.frameLocator("iframe").locator("body").waitFor();
    const r = await ejecutarPlan({ page, plan, datos: datosBase(), registro, empresa: { alias: "x" }, local: false, soloComprobar: true, timeout: 700, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} }); return { r, registro, context, page }; };
  const a = await mk({ estrategia: "nombre", valor: "NoExiste0", tag: "input" }); assert.equal(a.r.ok, false); assert.match(a.r.resumen.errores[0].detalle, /ningún elemento/); assert.ok(!a.registro.eventos().some((e) => e.id === "p120-linea0-descripcion"), "no siguió"); await a.context.close();
  const b = await mk({ estrategia: "nombre", valor: "Descripcion0" });   // sin tag: coincide con el input y con el select ocultos assert.match(b.r.resumen.errores[0].detalle, /ambiguo/); await b.context.close();
});
await caso("ETAPA 1 · ENSAYO GENERAL DEL COMANDO EXACTO: node bin/ejecutar.mjs … --solo-comprobar con el mapeo real, la autorización por entorno y un Chrome con puerto de depuración local (sesión «ya iniciada» simulada)", async () => {
  posts.length = 0; const puerto = 9700 + Math.floor(Math.random() * 90), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-cli1-")), perfil = path.join(tmp, "perfil");
  const ctx = await lanzarPersistente(perfil, { headless: true, args: [`--remote-debugging-port=${puerto}`, "--host-resolver-rules=MAP felav.c.sat.gob.gt 127.0.0.1, MAP farm3.sat.gob.gt 127.0.0.1, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"] });
  const empresa = path.join(tmp, "empresa.local.json"); fs.writeFileSync(empresa, JSON.stringify({ alias: "empresa-e1", modo: "cdp", cdp: `http://127.0.0.1:${puerto}`, identidad: { confirmacion_manual: true } }));
  try {
    const pg = ctx.pages()[0] ?? await ctx.newPage(); await pg.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf`); await pg.frameLocator("iframe").locator("body").waitFor();
    const fr = () => pg.frames().find((f) => f.url().includes("/fel-web/")), antes = await modeloF(fr());
    const env = { ...process.env, FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa1" }, cwd = path.join(AQUI, "..");
    const r = await ejecutarAsync(process.execPath, ["bin/ejecutar.mjs", `--empresa=${empresa}`, "--mapeo=config/mapeo.sat-preliminar.json", "--datos=config/datos-ficticios-lineas.json", "--solo-comprobar"], { cwd, env, timeout: 90000 }, "si\n\n");
    if (process.env.FEL_MOSTRAR_SALIDA) console.log("----- SALIDA DEL ENSAYO -----\n" + r.stdout + "-----------------------------");
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /COMPROBACIÓN \(solo lectura\)/); assert.match(r.stdout, /no comprobable en frío/); assert.match(r.stdout, /emitió: NO/); assert.doesNotMatch(r.stdout, /ERROR|BLOQUEO|SESIÓN /);
    assert.deepEqual(await modeloF(fr()), antes, "el modelo no cambió"); assert.equal(await fr().locator(".ng-dirty").count(), 0); assert.deepEqual(posts, []);
    const dirReg = path.join(cwd, "registros", "empresa-e1"), archivos = fs.readdirSync(dirReg).sort(); assert.ok(archivos.some((x) => x.endsWith(".jsonl")) && archivos.some((x) => x.endsWith(".resumen.json")), archivos.join(","));
    assert.ok(!archivos.some((x) => /progreso|libro/.test(x)), `no deja progreso ni libro: ${archivos}`);
    const res = JSON.parse(fs.readFileSync(path.join(dirReg, archivos.find((x) => x.endsWith(".resumen.json"))), "utf8")); assert.equal(res.errores.length, 0); assert.deepEqual(res.solicitudes_bloqueadas, []); assert.equal(res.emitio, false);
    const todo = archivos.map((x) => fs.readFileSync(path.join(dirReg, x), "utf8")).join("\n"); for (const x of ["PRUEBA", "125.50", "251.00", "Consumidor Final", "cookie", "token"]) assert.ok(!todo.includes(x), `el registro no debe contener «${x}»`);
    // y sin la autorización por etapa el mismo comando se niega
    const sin = await ejecutarAsync(process.execPath, ["bin/ejecutar.mjs", `--empresa=${empresa}`, "--mapeo=config/mapeo.sat-preliminar.json", "--datos=config/datos-ficticios-lineas.json", "--solo-comprobar"], { cwd, env: { ...process.env, FEL_AUTORIZACION_SAT: "", FEL_ETAPA_AUTORIZADA: "" }, timeout: 30000 }, "");
    assert.equal(sin.status, 2); assert.match(sin.stderr, /Se niega a correr/);
  } finally { await ctx.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(AQUI, "..", "registros"), { recursive: true, force: true }); }
});


// ───────────────────────── ETAPA 2 (llenado controlado) · SOLO SIMULACIÓN LOCAL ─────────────────────────
const e2 = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/mapeo.sat-etapa2.json"), "utf8"));
/** Plan de Etapa 2 adaptado a la página local: mismos pasos y localizadores; solo cambian dominio/marco y las confirmaciones humanas (que en la realidad pone la persona). */
function planE2(hasta = "p150-linea0-leer-total", tocar = (m) => m) {
  let m = structuredClone(e2); delete m.sesion; m.dominios_permitidos = ["127.0.0.1"];
  for (const p of m.pasos) { if (p.localizador) delete p.localizador.marco; if (p.verificado === false) p.verificado = true; }
  if (hasta) m = recortarPlan(m, hasta); return tocar(m);
}
async function correrE2(plan, { url = URL_BASE + "?radio=nit", datos = datosBase(), politica = { dominios: ["127.0.0.1"] }, sesion = null, timeout = 2500 } = {}) {
  const context = await browser.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} });
  await bloquearEscrituras(context, politica, registro); const page = await context.newPage(); await page.goto(url);
  const detenerSi = () => { const b = registro.eventos().find((e) => e.evento === "solicitud_bloqueada"); return b ? `solicitud bloqueada (${b.metodo} ${b.host}${b.ruta})` : null; };
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa: { alias: "empresa-prueba" }, local: true, estricto: true, detenerSi, sesion, timeout, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  return { ...r, page, context, registro };
}
const estadoBotones = (page) => page.evaluate(() => { const s = angular.element(document.body).scope(); return { vistaPrevia: s.vistaPrevia, modal: s.modalImpuestos, lineas: s.detalleFactura.length, radioClics: s.registroRadio ?? 0, id: s.datosGenerales.tipoIdentificacion, nit: s.datosGenerales.nitReceptor }; });

await caso("ETAPA 2 · TRAMO 2A FELIZ: verifica el radio sin pulsarlo, escribe solo campos permitidos, lee el total (comparación numérica) y se detiene sin tocar nada más", async () => {
  posts.length = 0; const plan = planE2(); assert.ok(validarMapeo(plan, { local: true, etapa2: true }).ok, validarMapeo(plan, { local: true, etapa2: true }).errores.join("\n"));
  const r = await correrE2(plan, {}); assert.equal(r.ok, true, JSON.stringify(r.resumen.errores) + JSON.stringify(r.resumen.bloqueos_de_guardia)); assert.equal(r.detenido, true); assert.equal(r.resumen.emitio, false);
  const m = await modelo(r.page), b = await estadoBotones(r.page), d0 = m.lineas[0];
  assert.deepEqual([d0.BienOServicio, d0.Cantidad, d0.Descripcion, d0.PrecioUnitario, d0.Total], ["Servicio", "2", "SERVICIO DE PRUEBA UNO - NO EMITIR", "125.50", "241.00"]); assert.equal(m.dir, "CIUDAD DE PRUEBA");
  assert.equal(b.radioClics, 0, "el radio NIT NO se pulsó (su ng-change no se ejecutó)"); assert.equal(b.nit, "", "el NIT no se escribe en el tramo 2A"); assert.deepEqual([b.vistaPrevia, b.modal, b.lineas], [false, false, 1]); assert.deepEqual(posts, []);
  await r.context.close();
});
await caso("ETAPA 2 · RADIO NO MARCADO: verificar_marcado falla y NO lo pulsa (no ejecuta su manejador); no se escribe nada después", async () => {
  const r = await correrE2(planE2(), { url: URL_BASE }); assert.equal(r.ok, false); assert.equal(r.resumen.errores[0].id, "p010-receptor-radio-nit"); const b = await estadoBotones(r.page), m = await modelo(r.page);
  assert.deepEqual([b.radioClics, b.id], [0, null]); assert.equal(m.dir, "", "no se escribió ningún campo tras el fallo"); assert.equal(m.lineas[0].Cantidad, ""); await r.context.close();
});
await caso("ETAPA 2 · FORMATOS DEL TOTAL: coma decimal sin declarar → se detiene; con decimal=«,» pasa; total sin decimales → numérico lo acepta solo dentro de la tolerancia", async () => {
  const a = await correrE2(planE2(), { url: URL_BASE + "?radio=nit&formato=coma" }); assert.equal(a.ok, false); assert.equal(a.resumen.errores[0].id, "p150-linea0-leer-total"); await a.context.close();
  const b = await correrE2(planE2("p150-linea0-leer-total", (m) => { const p = m.pasos.find((x) => x.id === "p150-linea0-leer-total"); p.decimal = ","; return m; }), { url: URL_BASE + "?radio=nit&formato=coma" }); assert.equal(b.ok, true, JSON.stringify(b.resumen.errores)); await b.context.close();
  const c = await correrE2(planE2(), { url: URL_BASE + "?radio=nit&formato=entero" }); assert.equal(c.ok, true, "241 == 241.00 numéricamente"); await c.context.close();
  const d = datosBase(); d.lineas[0].total_esperado = "241.50"; const e = await correrE2(planE2(), { datos: d, url: URL_BASE + "?radio=nit&formato=entero" }); assert.equal(e.ok, false, "241 ≠ 241.50"); await e.context.close();
});
await caso("ETAPA 2 · GUARDADO AUTOMÁTICO INESPERADO: si el portal envía un POST al cambiar un campo, la guardia lo aborta y la ejecución SE DETIENE en el campo siguiente", async () => {
  posts.length = 0; const r = await correrE2(planE2(), { url: URL_BASE + "?radio=nit&autosave=1" }); assert.equal(r.ok, false); assert.equal(r.estado, "detenido_por_alerta", r.estado);
  assert.ok(r.resumen.solicitudes_bloqueadas.some((x) => /POST .*autoguardado/.test(x)), JSON.stringify(r.resumen.solicitudes_bloqueadas)); assert.deepEqual(posts, [], "el POST nunca llegó al servidor");
  const ids = r.registro.eventos().filter((e) => e.evento === "paso").map((e) => e.id); assert.ok(!ids.includes("p150-linea0-leer-total"), "no siguió hasta el final"); await r.context.close();
});
await caso("ETAPA 2 · DIÁLOGO INESPERADO: un aviso del portal detiene la ejecución (se descarta, nunca se acepta)", async () => {
  const r = await correrE2(planE2(), { url: URL_BASE + "?radio=nit&alerta=1" }); assert.equal(r.ok, false); assert.equal(r.estado, "detenido_por_alerta"); assert.match(JSON.stringify(r.resumen), /diálogo/); await r.context.close();
});
await caso("ETAPA 2 · SESIÓN CADUCADA: se detiene (sesion_perdida) y NO espera ni reanuda", async () => {
  const context = await browser.newContext(), registro = crearRegistro({ empresa: "x", salida: () => {} }); await bloquearEscrituras(context, { dominios: ["127.0.0.1"] }, registro); const page = await context.newPage(); await page.goto(URL_BASE + "?radio=nit");
  const plan = planE2(); plan.sesion = { indicadores_sesion_activa: [{ localizador: { estrategia: "rol", rol: "tab", valor: "Datos Generales" }, verificado: true }], intervalo_ms: 1000, espera_max_ms: 60000 };
  const sesion = crearMonitorSesion({ config: plan.sesion, dominios: plan.dominios_permitidos, salida: () => {} });
  let expirada = false; const hooks = { antesDeEjecutar: async (p) => { if (p.id === "p110-linea0-cantidad" && !expirada) { expirada = true; await page.evaluate(() => window.__expirar()); } } };
  const t0 = Date.now(), r = await ejecutarPlan({ page, plan, datos: datosBase(), registro, empresa: { alias: "x" }, local: true, estricto: true, sesion, hooks, timeout: 2500, esperarUsuario: async () => "si", salida: () => {}, detenerSi: () => null });
  if (process.env.DEBUG_SIM) console.log("SES", JSON.stringify(r).slice(0, 900)); assert.equal(r.ok, false); assert.equal(r.estado, "sesion_perdida", r.estado); assert.ok(Date.now() - t0 < 30000, "no esperó a que volviera la sesión");
  assert.ok(!registro.eventos().some((e) => e.id === "p150-linea0-leer-total"), "no continuó"); await context.close();
});
await caso("ETAPA 2 · GET A DOMINIO NO LISTADO: bloqueado y detiene; solo pasa con una regla permitir_get aprobada y fechada (host exacto + ruta)", async () => {
  // La página con red=1 consulta al host «consulta.example.test» al salir del NIT: lo ejercitamos añadiendo salida del campo solo en la copia de prueba.
  const conNit = (m) => { const i = m.pasos.findIndex((x) => x.id === "p030-receptor-direccion"); m.pasos.splice(i, 0, { ...structuredClone(e2.pasos.find((x) => x.id === "p020-receptor-nit")), verificado: true }, { ...structuredClone(e2.pasos.find((x) => x.id === "p025-receptor-salir-nit")), verificado: true }); for (const p of m.pasos) if (p.localizador) delete p.localizador.marco; return m; };
  const sinRegla = await correrE2(planE2("p150-linea0-leer-total", conNit), { url: URL_BASE + "?radio=nit&red=1" }); if (process.env.DEBUG_SIM) console.log("GET", JSON.stringify([sinRegla.ok, sinRegla.estado, sinRegla.resumen.errores, sinRegla.resumen.solicitudes_bloqueadas])); assert.equal(sinRegla.ok, false); assert.ok(sinRegla.resumen.solicitudes_bloqueadas.some((x) => /GET consulta\.example\.test\/consulta\/receptor\/CF/.test(x)), JSON.stringify(sinRegla.resumen.solicitudes_bloqueadas)); await sinRegla.context.close();
  const politica = { dominios: ["127.0.0.1"], permitir_get: [{ host: "consulta.example.test", ruta_prefijo: "/consulta/receptor/", motivo: "prueba local", revisado: true }] };
  lecturas.length = 0; const conRegla = await correrE2(planE2("p150-linea0-leer-total", (m) => { const x = conNit(m); x.permitir_get = politica.permitir_get.map((r) => ({ ...r, aprobado_por: "prueba", fecha: "2026-01-01" })); return x; }), { url: URL_BASE + "?radio=nit&red=1", politica }); if (process.env.DEBUG_SIM) console.log("CR", JSON.stringify(conRegla).slice(0, 900)); assert.equal(conRegla.ok, true, JSON.stringify(conRegla.resumen.errores) + JSON.stringify(conRegla.resumen.solicitudes_bloqueadas)); assert.deepEqual(conRegla.resumen.solicitudes_bloqueadas, []); assert.ok(conRegla.resumen.lecturas_xhr.some((x) => /GET consulta\.example\.test\/consulta\/receptor\/CF/.test(x)), "la lectura aprobada se registra"); await conRegla.context.close();
});
await caso("ETAPA 2 · LOCALIZADOR AMBIGUO: si el campo coincide con dos elementos, se detiene sin escribir", async () => {
  const plan = planE2("p150-linea0-leer-total", (m) => { const p = m.pasos.find((x) => x.id === "p120-linea0-descripcion"); p.localizador = { estrategia: "nombre", valor: "Descripcion0" }; return m; });   // sin tag: input + select oculto
  const r = await correrE2(plan, {}); assert.equal(r.ok, false); assert.match(r.resumen.errores[0].detalle, /ambiguo/); assert.equal((await modelo(r.page)).lineas[0].Descripcion, ""); await r.context.close();
});
await caso("ETAPA 2 · INALCANZABLES: ningún paso del mapa real puede pulsar Vista Previa, Guardar, Emitir, Agregar/Eliminar, impuestos ni cambiar moneda; y un mapa que lo pida se rechaza", async () => {
  const plan = planE2(null); assert.ok(!plan.pasos.some((p) => ["clic_seguro", "marcar"].includes(p.tipo)), "el mapa de Etapa 2 no contiene clics ni marcar");
  const permitidos = new Set(["nitReceptor", "direccionReceptor", "BienOServicio0", "Cantidad0", "Descripcion0", "PrecioUnitario0", "Descuento0", "OtrosDescuento0"]);
  for (const p of plan.pasos.filter((x) => ["llenar", "seleccionar"].includes(x.tipo))) assert.ok(permitidos.has(String(p.localizador.valor).split(".").pop()), `campo fuera de la lista cerrada: ${p.id}`);
  const malos = [["clic_seguro", { estrategia: "texto", valor: "Vista Previa" }], ["marcar", { estrategia: "etiqueta", valor: "CUI" }], ["seleccionar", { estrategia: "ng_model", valor: "datosGenerales.moneda", tag: "select" }], ["llenar", { estrategia: "ng_model", valor: "datosGenerales.fechaEmision" }]];
  for (const [tipo, loc] of malos) { const m = planE2(null); m.pasos.splice(1, 0, { id: "x-malo", tipo, localizador: loc, dato: "documento.moneda", verificado: true }); assert.equal(validarMapeo(m, { local: true, etapa2: true }).ok, false, `${tipo} ${loc.valor} debería rechazarse`); }
  const conPost = planE2(null); conPost.permitir_post = [{ host: "127.0.0.1", ruta_prefijo: "/api/", motivo: "x", revisado: true }]; assert.equal(validarMapeo(conPost, { local: true, etapa2: true }).ok, false, "permitir_post debe estar vacío");
  const sinAprob = planE2(null); sinAprob.permitir_get = [{ host: "consulta.example.test", ruta_prefijo: "/c/", motivo: "x", revisado: true }]; assert.equal(validarMapeo(sinAprob, { local: true, etapa2: true }).ok, false, "permitir_get sin aprobado_por/fecha se rechaza");
  // y a nivel de página: tras el llenado real, los botones sensibles siguen sin haberse tocado y su POST se habría abortado
  posts.length = 0; const r = await correrE2(planE2(), {}); const b = await estadoBotones(r.page); assert.deepEqual([b.vistaPrevia, b.modal, b.lineas], [false, false, 1]); assert.deepEqual(posts, []); await r.context.close();
});
await caso("ETAPA 2 · MAPA REAL SIN CONFIRMAR: tal como se entrega, no arranca (indicador de sesión y p026 sin verificar) y el tramo 2B exige además la decisión humana", async () => {
  const v = validarMapeo(e2, { etapa2: true }); assert.equal(v.ok, false); assert.ok(v.errores.some((x) => /indicadores_sesion_activa/.test(x)) && v.errores.some((x) => /p026/.test(x)), v.errores.join("\n"));
  const a = validarMapeo(recortarPlan(e2, "p150-linea0-leer-total"), { etapa2: true }); assert.ok(a.errores.some((x) => /indicadores_sesion_activa/.test(x)) && !a.errores.some((x) => /p026/.test(x)), a.errores.join("\n"));
  assert.deepEqual(e2.permitir_post, []); assert.deepEqual(e2.permitir_get, []);
});


// ───────── ETAPA 2 · EXTREMO A EXTREMO CON EL COMANDO REAL (bin/ejecutar.mjs + Chrome por CDP + nombres reales de host resueltos a localhost) ─────────
const ENV_E2 = { FEL_AUTORIZACION_SAT: "si", FEL_ETAPA_AUTORIZADA: "etapa2", FEL_CONDICIONES_USO_REVISADAS: "si", FEL_EMPRESA_CONFIRMADA: "empresa-e2" };
const modeloIf = (f) => f.evaluate(() => { const s = angular.element(document.body).scope(); return { id: s.datosGenerales.tipoIdentificacion, nit: s.datosGenerales.nitReceptor, dir: s.datosGenerales.direccionReceptor, vp: s.vistaPrevia, modal: s.modalImpuestos, radio: s.registroRadio ?? 0, lineas: JSON.parse(angular.toJson(s.detalleFactura)) }; });
/** Copia LOCAL del mapa real con SOLO la confirmación humana del indicador de sesión (lo que haría la persona); `tocar` permite variantes negativas. */
async function cliE2({ query = "?radio=nit", hasta = "p150-linea0-leer-total", env = ENV_E2, tocar = (m) => m, extra = [], datosTocar = null } = {}) {
  const puerto = 9800 + Math.floor(Math.random() * 90), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fel-cli2-")), cwd = path.join(AQUI, "..");
  const ctx = await lanzarPersistente(path.join(tmp, "perfil"), { headless: true, args: [`--remote-debugging-port=${puerto}`, "--host-resolver-rules=MAP felav.c.sat.gob.gt 127.0.0.1, MAP farm3.sat.gob.gt 127.0.0.1, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"] });
  const empresa = path.join(tmp, "empresa.local.json"), mapa = path.join(tmp, "mapeo.etapa2.local.json"), datos = path.join(tmp, "datos.json");
  fs.writeFileSync(empresa, JSON.stringify({ alias: "empresa-e2", modo: "cdp", cdp: `http://127.0.0.1:${puerto}`, identidad: { confirmacion_manual: true } }));
  const m = structuredClone(e2); m.sesion.indicadores_sesion_activa[0].verificado = true; fs.writeFileSync(mapa, JSON.stringify(tocar(m)));
  const d = JSON.parse(fs.readFileSync(path.join(cwd, "config/datos-ficticios-lineas.json"), "utf8")); fs.writeFileSync(datos, JSON.stringify(datosTocar ? datosTocar(d) : d));
  const pg = ctx.pages()[0] ?? await ctx.newPage(); await pg.goto(`http://farm3.sat.gob.gt:${PUERTO}/menu/portada.jsf${query}`); await pg.frameLocator("iframe").locator("body").waitFor();
  const fr = () => pg.frames().find((f) => f.url().includes("/fel-web/"));
  const r = await ejecutarAsync(process.execPath, ["bin/ejecutar.mjs", `--empresa=${empresa}`, `--mapeo=${mapa}`, `--datos=${datos}`, ...(hasta ? [`--hasta=${hasta}`] : []), ...extra], { cwd, env: { ...process.env, ...env }, timeout: 120000 }, "si\n\n\n\n");
  const dirReg = path.join(cwd, "registros", "empresa-e2"), archivos = fs.existsSync(dirReg) ? fs.readdirSync(dirReg).sort() : [];
  const resumenArch = archivos.find((x) => x.endsWith(".resumen.json")), resumen = resumenArch ? JSON.parse(fs.readFileSync(path.join(dirReg, resumenArch), "utf8")) : null;
  const registros = archivos.map((x) => fs.readFileSync(path.join(dirReg, x), "utf8")).join("\n");
  const limpiar = async () => { await ctx.close().catch(() => {}); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(cwd, "registros"), { recursive: true, force: true }); };
  return { r, fr, pg, resumen, registros, archivos, limpiar, salida: r.stdout + r.stderr };
}
const SIN_VALORES = ["PRUEBA", "125.50", "251.00", "Consumidor Final", "cookie", "token", "CIUDAD"];

await caso("ETAPA 2 · E2E COMANDO REAL (tramo 2A): llena una línea por el iframe, lee el total, termina «detenido» con código 0; sin POST, sin progreso, sin valores en el registro, sin Vista Previa/Guardar/Emitir", async () => {
  posts.length = 0; const c = await cliE2();
  try {
    if (process.env.FEL_MOSTRAR_SALIDA) console.log("----- SALIDA E2E -----\n" + c.salida + "----------------------");
    assert.equal(c.r.status, 0, c.salida); assert.match(c.salida, /ETAPA 2 · LLENADO CONTROLADO/); assert.match(c.salida, /ESTRICTO/); assert.match(c.salida, /emitió: NO/);
    const m = await modeloIf(c.fr()), d0 = m.lineas[0];
    assert.deepEqual([d0.BienOServicio, d0.Cantidad, d0.Descripcion, d0.PrecioUnitario, d0.Total, m.dir, m.nit, m.radio, m.vp, m.modal, m.lineas.length], ["Servicio", "2", "SERVICIO DE PRUEBA UNO - NO EMITIR", "125.50", "251.00", "CIUDAD DE PRUEBA", "", 0, false, false, 1], JSON.stringify(m));
    assert.deepEqual(posts, []); assert.ok(!c.archivos.some((x) => /progreso/.test(x)), c.archivos.join(","));
    assert.ok(c.resumen && c.resumen.errores.length === 0 && c.resumen.solicitudes_bloqueadas.length === 0 && c.resumen.emitio === false && c.resumen.estado_final === "detenido", JSON.stringify(c.resumen));
    for (const x of SIN_VALORES) assert.ok(!c.registros.includes(x), `el registro no debe contener «${x}»`);
  } finally { await c.limpiar(); }
});
await caso("ETAPA 2 · E2E RECHAZOS DEL COMANDO: sin variables, con la autorización de la Etapa 1, sin revisar condiciones de uso, con otra empresa confirmada y con --reanudar → se niega (código 2) y NO toca la página", async () => {
  const casos = [[{ FEL_AUTORIZACION_SAT: "", FEL_ETAPA_AUTORIZADA: "", FEL_CONDICIONES_USO_REVISADAS: "", FEL_EMPRESA_CONFIRMADA: "" }, /Se niega a correr/], [{ FEL_ETAPA_AUTORIZADA: "etapa1" }, /Se niega a correr/], [{ FEL_CONDICIONES_USO_REVISADAS: "" }, /Se niega a correr/], [{ FEL_EMPRESA_CONFIRMADA: "otra-empresa" }, /Se niega a correr/]];
  for (const [env, re] of casos) { const c = await cliE2({ env: { ...ENV_E2, ...env } }); try { assert.equal(c.r.status, 2, c.salida); assert.match(c.salida, re); assert.equal((await modeloIf(c.fr())).lineas[0].Cantidad, "", "no se escribió nada"); } finally { await c.limpiar(); } }
  const c = await cliE2({ extra: ["--reanudar"] }); try { assert.equal(c.r.status, 2, c.salida); assert.match(c.salida, /no admite --reanudar/); assert.equal((await modeloIf(c.fr())).lineas[0].Cantidad, ""); } finally { await c.limpiar(); }
  const m = await cliE2({ tocar: (x) => { x.pasos.splice(1, 0, { id: "x-vp", tipo: "clic_seguro", localizador: { estrategia: "texto", valor: "Vista Previa" }, verificado: true }); return x; } });
  try { assert.equal(m.r.status, 2, m.salida); assert.match(m.salida, /Se niega a correr \(mapeo\)/); assert.equal((await modeloIf(m.fr())).vp, false); } finally { await m.limpiar(); }
});
await caso("ETAPA 2 · E2E ANOMALÍAS: autoguardado, diálogo, sesión perdida, campo ambiguo y radio sin marcar detienen el comando de inmediato (código ≠ 0), sin seguir llenando y sin que llegue ningún POST", async () => {
  const esc = [
    ["AUTOGUARDADO", "?radio=nit&autosave=1", (x) => x, /solicitud bloqueada|detenido_por_alerta|POST/i, "p150-linea0-leer-total"],
    ["DIÁLOGO", "?radio=nit&alerta=1", (x) => x, /diálogo/i, "p150-linea0-leer-total"],
    ["SESIÓN PERDIDA", "?radio=nit&expirar=1", (x) => x, /sesión|sesion/i, "p150-linea0-leer-total"],
    ["CAMPO AMBIGUO", "?radio=nit", (x) => { x.pasos.find((p) => p.id === "p120-linea0-descripcion").localizador = { estrategia: "nombre", valor: "Descripcion0", marco: x.pasos.find((p) => p.id === "p110-linea0-cantidad").localizador.marco }; return x; }, /ambiguo/i, "p130-linea0-precio"],
    ["RADIO SIN MARCAR", "?x=1", (x) => x, /marcado|radio/i, "p030-receptor-direccion"],
  ];
  for (const [nombre, query, tocar, re, noDebeLlegarA] of esc) {
    posts.length = 0; const c = await cliE2({ query, tocar });
    try {
      assert.notEqual(c.r.status, 0, `${nombre}: debe fallar\n${c.salida}`); assert.notEqual(c.r.status, 2, `${nombre}: no es un rechazo previo, es una detención en ejecución\n${c.salida}`); assert.match(c.salida.replace(/^.*ESTRICTO.*$/m, ""), re, `${nombre}\n${c.salida}`); const esperado = { AUTOGUARDADO: "detenido_por_alerta", "DIÁLOGO": "detenido_por_alerta", "SESIÓN PERDIDA": "sesion_perdida", "CAMPO AMBIGUO": "interrumpido", "RADIO SIN MARCAR": "interrumpido" }[nombre]; assert.equal(c.resumen?.estado_final, esperado, `${nombre}: estado final`); if (nombre === "AUTOGUARDADO") assert.deepEqual(c.resumen.solicitudes_bloqueadas, ["POST felav.c.sat.gob.gt/api/autoguardado"]); if (nombre === "CAMPO AMBIGUO") assert.equal(c.resumen.errores[0].id, "p120-linea0-descripcion"); if (nombre === "RADIO SIN MARCAR") assert.equal(c.resumen.errores[0].id, "p010-receptor-radio-nit");
      assert.deepEqual(posts, [], `${nombre}: ningún POST`); const m = await modeloIf(c.fr()); assert.deepEqual([m.vp, m.modal, m.lineas.length], [false, false, 1], `${nombre}: sin Vista Previa/impuestos/líneas nuevas`);
      const ids = c.registros.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((e) => e.evento === "paso").map((e) => e.id);
      assert.ok(!ids.includes(noDebeLlegarA), `${nombre}: no debió llegar a ${noDebeLlegarA} (pasos: ${ids.join(",")})`);
      assert.ok(!ids.includes("p999-detener"), `${nombre}: no debió terminar con normalidad`);
      for (const x of SIN_VALORES) assert.ok(!c.registros.includes(x), `${nombre}: el registro no debe contener «${x}»`);
    } finally { await c.limpiar(); }
  }
});
await caso("ETAPA 2 · E2E TRAMO 2B EN SIMULACIÓN: sin regla permitir_get la consulta del CF se bloquea y detiene; el mapa sin confirmar p026 se niega aunque haya autorización", async () => {
  // p026 sin confirmar (tal como se entrega) → el comando se niega antes de tocar la página
  const a = await cliE2({ hasta: null, query: "?radio=nit&red=1" }); try { assert.equal(a.r.status, 2, a.salida); assert.match(a.salida, /p026/); assert.equal((await modeloIf(a.fr())).nit, ""); } finally { await a.limpiar(); }
  // confirmado por la persona en su copia local, pero SIN regla para el GET a otro dominio → se bloquea y se detiene (en la simulación esa consulta apunta a un host simulado)
  const b = await cliE2({ hasta: null, query: "?radio=nit&red=1", tocar: (x) => { x.pasos.find((p) => p.id === "p026-receptor-leer-respuesta").verificado = true; return x; } });
  try { assert.notEqual(b.r.status, 0, b.salida); assert.match(b.salida, /solicitud bloqueada|detenido_por_alerta/i, b.salida); assert.ok(/consulta\.example\.test/.test(b.salida), "la consulta no listada aparece como bloqueada"); } finally { await b.limpiar(); }
});


await caso("AUDITORÍA · AUTOGUARDADO TARDÍO (temporizador que dispara DESPUÉS del último paso): la guardia sigue activa, lo bloquea y el comando lo señala (código 1)", async () => {
  posts.length = 0; const c = await cliE2({ query: "?radio=nit&tardio=7000" });
  try {
    if (process.env.DEBUG_SIM) console.log("TARDIO salida", c.r.status, c.resumen?.estado_final, JSON.stringify(c.resumen?.solicitudes_bloqueadas));
    await new Promise((r) => setTimeout(r, 9000));
    if (process.env.DEBUG_SIM) console.log("TARDIO posts tras 9 s:", JSON.stringify(posts));
    assert.notEqual(c.r.status, 0, "el comando debe señalar la alerta tardía"); assert.match(c.salida, /ALERTA TARDÍA/); assert.match(c.salida, /autoguardado-tardio/);
    assert.deepEqual(posts, [], "ningún POST tardío debe llegar al servidor");
  } finally { await c.limpiar(); }
});

await browser.close(); await browserHosts.close(); servidor.close();
console.log(`\n${n - fallos}/${n} casos OK${posts.length ? ` — POST residuales: ${posts.join(", ")}` : ""}`);
process.exit(fallos ? 1 : 0);
