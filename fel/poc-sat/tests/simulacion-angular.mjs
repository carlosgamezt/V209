// Prueba controlada de llenado contra una página AngularJS SIMULADA (AngularJS 1.5.8 real, estructura tomada de los atributos observados).
// NO se conecta al portal de SAT, usa datos ficticios y no emite nada. Ejecuta el MAPEO PRELIMINAR (config/mapeo.sat-preliminar.json) tal cual.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "../src/playwright.mjs";
import { crearRegistro } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";
import { bloquearEscrituras } from "../src/conexion.mjs";
import { validarMapeo } from "../src/guardia.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ANGULAR = (() => { try { return createRequire(import.meta.url).resolve("angular/angular.min.js"); } catch { const alt = process.env.ANGULAR_JS; if (alt && fs.existsSync(alt)) return alt; throw new Error("Falta AngularJS 1.5.8 para la simulación: ejecuta «npm install» en fel/poc-sat (o define ANGULAR_JS=ruta/angular.min.js)"); } })();
const html = fs.readFileSync(path.join(AQUI, "fixture/sat-angular-simulado.html"));
const pre = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/mapeo.sat-preliminar.json"), "utf8"));
const datosBase = () => { const d = JSON.parse(fs.readFileSync(path.join(AQUI, "../config/datos-ficticios-lineas.json"), "utf8")); d.documento = { tipo_dte: "Factura de prueba A", moneda: "GTQ-Quetzal" }; d.lineas[0].descuento = "10"; d.lineas[0].total_esperado = "241.00"; d.receptor.nombre_esperado = "CONSUMIDOR FINAL DE PRUEBA"; return d; };

const posts = [];
const servidor = http.createServer((req, res) => {
  if (req.method === "POST") { posts.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  if (req.url === "/angular.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(fs.readFileSync(ANGULAR)); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html);
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const URL_BASE = `http://127.0.0.1:${servidor.address().port}/`, browser = await chromium.launch({ headless: true });

let fallos = 0, n = 0;
const caso = async (nombre, fn) => { n++; try { await fn(); console.log(`OK     ${nombre}`); } catch (e) { fallos++; console.log(`FALLO  ${nombre}\n       ${String(e.message ?? e).split("\n").slice(0, 5).join("\n       ")}`); } };
const L = (estrategia, valor, extra = {}) => ({ estrategia, valor, ...extra });
const paso = (id, tipo, localizador, dato, extra = {}) => ({ id, tipo, localizador, dato, verificado: true, ...extra });

/** Plan = pasos del mapeo preliminar (idénticos) + pasos que la simulación permite añadir (tipo de documento, moneda, blur, lectura, validación). */
function planSimulado({ conBlur = true, extraFinal = [] } = {}) {
  const m = structuredClone(pre); m.dominios_permitidos = ["127.0.0.1"]; delete m.sesion;
  const por = Object.fromEntries(m.pasos.filter((p) => p.localizador).map((p) => [p.id, { ...p, verificado: true }]));
  const pasos = [
    m.pasos[0],
    paso("s010-tipo-documento", "seleccionar", L("ng_model", "datosGenerales.tipoDte", { tag: "select" }), "documento.tipo_dte"),
    paso("s020-moneda", "seleccionar", L("ng_model", "datosGenerales.moneda", { tag: "select" }), "documento.moneda"),
    por["p010-receptor-radio-nit"], por["p020-receptor-nit"],
    ...(conBlur ? [paso("s030-salir-nit", "salir_del_campo", L("ng_model", "datosGenerales.nitReceptor", { tag: "input", visible: true })),
                   paso("s040-leer-nombre", "leer", L("ng_model", "resultadoNIT.nombre", { tag: "input", visible: true }), "receptor.nombre_esperado")] : []),
    por["p030-receptor-direccion"], por["p100-linea0-tipo"], por["p110-linea0-cantidad"], por["p120-linea0-descripcion"], por["p130-linea0-precio"], por["p140-linea0-descuento"],
    paso("s100-leer-total", "leer", L("nombre", "Total0", { tag: "input" }), "lineas.0.total_esperado", { espera_ms: 2000 }),
    paso("s110-sin-errores", "verificar_ausente", L("clase", "ng-invalid", { visible: true })),
    ...extraFinal, { id: "p999-detener", tipo: "detener" },
  ];
  return { ...m, pasos };
}
const modelo = (page) => page.evaluate(() => { const s = angular.element(document.body).scope(); return { tipo: s.datosGenerales.tipoDte?.nombre, moneda: s.datosGenerales.moneda, id: s.datosGenerales.tipoIdentificacion, nit: s.datosGenerales.nitReceptor, nombre: s.resultadoNIT.nombre, dir: s.datosGenerales.direccionReceptor, lineas: JSON.parse(angular.toJson(s.detalleFactura)), vistaPrevia: s.vistaPrevia }; });
async function correr(plan, { datos = datosBase(), guardia = true, timeout = 2500, page: pg = null } = {}) {
  const context = pg ? pg.context() : await browser.newContext(), registro = crearRegistro({ empresa: "empresa-prueba", salida: () => {} });
  if (guardia && !pg) await bloquearEscrituras(context, {}, registro);
  const page = pg ?? await context.newPage(); if (!pg) await page.goto(URL_BASE);
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa: { alias: "empresa-prueba" }, local: true, timeout, esperarUsuario: async (q) => (/empresa/.test(q) ? "si" : ""), salida: () => {} });
  return { ...r, page, context, registro };
}
const hits = () => posts.length;

await caso("MAPEO: el plan de la simulación contiene los pasos del mapeo preliminar SIN modificar sus localizadores", async () => {
  const plan = planSimulado(), ids = pre.pasos.filter((p) => p.localizador).map((p) => p.id);
  for (const id of ids) assert.deepEqual(plan.pasos.find((p) => p.id === id).localizador, pre.pasos.find((p) => p.id === id).localizador, id);
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
  assert.ok(r.registro.eventos().some((e) => e.id === "s100-leer-total" && /coincide/.test(e.detalle)) && r.registro.eventos().some((e) => e.id === "s110-sin-errores" && e.resultado === "ok"));
  await r.context.close();
});

await caso("LECTURA ASÍNCRONA: con debounce de AngularJS el total se actualiza tarde y la lectura reintenta hasta que coincide", async () => {
  const r = await correr(planSimulado({ conBlur: false })); assert.equal(r.ok, true, JSON.stringify(r.resumen.errores));
  const rapida = planSimulado({ conBlur: false }); rapida.pasos.find((p) => p.id === "s100-leer-total").espera_ms = 0;   // sin reintento: la primera lectura llega antes que el modelo
  const r2 = await correr(rapida); assert.equal(r2.ok, false, "sin tiempo de espera la lectura del total calculado de forma asíncrona falla (por eso leer reintenta)"); assert.match(r2.resumen.errores[0]?.detalle ?? "", /no coincide/);
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
  const falla = r.resumen.errores.find((e) => e.id === "s100-leer-total" || e.id === "s110-sin-errores"); assert.ok(falla, JSON.stringify(r.resumen.errores));
  assert.equal(await r.page.getByText("Cantidad no válida").isVisible(), true, "el mensaje de validación de la página es visible"); assert.equal(await r.page.locator('input[name="Cantidad0"]').evaluate((e) => e.classList.contains("ng-invalid")), true);
  assert.deepEqual(posts.filter((x) => /emitir|vista|guardar/.test(x)), []); await r.context.close();
  // el paso verificar_ausente por sí solo reporta cuántos campos inválidos hay
  const solo = planSimulado(); solo.pasos = solo.pasos.filter((p) => !/s100|p999/.test(p.id)); solo.pasos.push({ id: "p999-detener", tipo: "detener" });
  const r2 = await correr(solo, { datos: d }); if (process.env.DEBUG_SIM) console.log("R2", JSON.stringify([r2.ok, r2.resumen.errores, solo.pasos.map((p) => p.id), await r2.page.locator(".ng-invalid:visible").count()])); assert.match(r2.resumen.errores[0].detalle, /error(es)? de validación/); await r2.context.close();
});
await caso("6 VALIDACIÓN: descuento mayor que el subtotal → mensaje de error y total vacío; esperar_visible puede exigir el mensaje", async () => {
  const d = datosBase(); d.lineas[0].descuento = "999";
  const plan = planSimulado(); plan.pasos = plan.pasos.filter((p) => !/s100|s110|p999/.test(p.id));
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

await browser.close(); servidor.close();
console.log(`\n${n - fallos}/${n} casos OK${posts.length ? ` — POST residuales: ${posts.join(", ")}` : ""}`);
process.exit(fallos ? 1 : 0);
