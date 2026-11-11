// Pruebas del simulador FEL en un NAVEGADOR REAL (Chromium vía Playwright): formulario, validaciones, vista previa, confirmación solo humana, interrupciones y duplicados.
// Sin credenciales y sin red externa: toda petición a un host que no sea 127.0.0.1 se aborta y se cuenta (debe ser cero).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { iniciarSimulador } from "../simulador/servidor.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

let sim, nav; const externas = [];
test.before(async () => { sim = await iniciarSimulador({ demoraLentoMs: 100 }); nav = await chromium.launch(); });
test.after(async () => { await nav?.close(); await sim?.detener(); });

const control = async (metodo, ruta, cuerpo) => {
  const r = await fetch(sim.url + ruta, { method: metodo, headers: { "x-control-token": sim.tokenControl, "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, json: await r.json() };
};
async function abrir(o = {}) {
  const s = (await control("POST", "/control/sesiones", { empresa: "emp-a", referencia: "ref-00000001", ...o })).json;
  const ctx = await nav.newContext({ locale: "es-GT" }); const p = await ctx.newPage(); const errores = [];
  await ctx.route((u) => !["127.0.0.1", "localhost"].includes(u.hostname), (r) => { externas.push(r.request().url()); r.abort(); });
  p.on("pageerror", (e) => errores.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await p.goto(s.url); return { s, p, ctx, errores };
}
async function llenar(p, o = {}) {
  await p.selectOption("#tipo_documento", "FACT-SIM"); await p.fill("#fecha", "2026-11-11"); await p.fill("#establecimiento_codigo", "1");
  await p.selectOption("#receptor_tipo", "NIT"); await p.fill("#receptor_id", "1234567-8"); await p.fill("#receptor_nombre", o.nombre ?? "Cliente de prueba");
  const l = p.locator(".linea").first();
  await l.locator('[data-k="tipo"]').selectOption("Servicio"); await l.locator('[data-k="descripcion"]').fill(o.descripcion ?? "Asesoría");
  await l.locator('[data-k="cantidad"]').fill("2"); await l.locator('[data-k="precio_unitario"]').fill("10.50"); await l.locator('[data-k="descuento"]').fill("1");
}
const estado = async (s) => (await control("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).json.estado;
const libro = async (ref, empresa = "emp-a") => (await control("GET", `/control/emisiones?empresa=${empresa}&referencia=${ref}`)).json;
const eventos = async (s) => (await control("GET", `/control/eventos?empresa=emp-a&sesion=${s.id}`)).json.map((e) => e.evento);

test("formulario: campos obligatorios vacíos muestran los errores y NO pasan a la vista previa", async () => {
  const { p, s, ctx, errores } = await abrir({ referencia: "ref-00000101" });
  await p.click("#btn-previa");
  await p.waitForSelector("#errores:not([hidden])");
  const t = await p.locator("#errores").innerText();
  for (const m of ["Elige el tipo de documento", "Indica una fecha válida", "código del establecimiento", "tipo de identificación del receptor", "Concepto 1: elige Bien o Servicio", "Concepto 1: escribe la descripción", "Concepto 1: la cantidad"]) assert.match(t, new RegExp(m), m);
  assert.ok(await p.locator("#fecha.invalido").count() === 1, "el campo erróneo se marca");
  assert.ok(await p.locator("#seccion-previa").isHidden()); assert.equal(await estado(s), "abierta");
  assert.deepEqual(errores.filter((e) => !/status of 422/.test(e)), [], "sin errores de consola (salvo el 422 esperado de la validación)"); await ctx.close();
});

test("agregar y quitar conceptos; el total de la vista previa se calcula con decimales exactos", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000102" });
  await llenar(p); await p.click("#btn-agregar");
  const l2 = p.locator(".linea").nth(1);
  await l2.locator('[data-k="tipo"]').selectOption("Bien"); await l2.locator('[data-k="descripcion"]').fill("Café"); await l2.locator('[data-k="cantidad"]').fill("3"); await l2.locator('[data-k="precio_unitario"]').fill("0.10");
  await p.click("#btn-agregar"); await p.locator(".linea").nth(2).getByRole("button", { name: "Quitar" }).click(); assert.equal(await p.locator(".linea").count(), 2);
  await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  assert.equal(await p.locator("#previa-subtotal").innerText(), "21.30"); assert.equal(await p.locator("#previa-descuentos").innerText(), "1.00"); assert.equal(await p.locator("#previa-total").innerText(), "20.30");
  assert.equal(await p.locator("#previa-tabla tbody tr").count(), 2);
  assert.match(await p.locator("#seccion-previa").innerText(), /SIMULADO - SIN VALOR FISCAL/);
  assert.equal(await estado(s), "previsualizada"); assert.equal((await libro("ref-00000102")).length, 0, "la vista previa no emite");
  await ctx.close();
});

test("flujo humano completo: vista previa → clic de la persona en «Confirmar» → una emisión simulada", async () => {
  const { p, s, ctx, errores } = await abrir({ referencia: "ref-00000103" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  await p.click("#btn-confirmar"); await p.waitForSelector("#seccion-resultado:not([hidden])");
  assert.equal(await p.locator("#resultado-titulo").innerText(), "Emisión simulada registrada");
  assert.match(await p.locator("#resultado-detalle").innerText(), /SIM-.*SIMULADO - SIN VALOR FISCAL/);
  assert.equal(await estado(s), "confirmada"); assert.equal((await libro("ref-00000103")).length, 1);
  assert.deepEqual(await eventos(s), ["sesion_creada", "formulario_abierto", "vista_previa", "confirmacion_solicitada", "emision_registrada"]);
  assert.deepEqual(errores, []); await ctx.close();
});

test("un agente que llena el formulario y se detiene en la vista previa NO emite: la sesión queda esperando a la persona", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000104" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");   // el «agente» se detiene aquí
  await p.waitForTimeout(300);
  assert.equal(await estado(s), "previsualizada"); assert.equal((await libro("ref-00000104")).length, 0);
  assert.ok(await p.locator("#btn-confirmar").isEnabled(), "el botón espera a una persona");
  assert.equal((await libro("ref-00000104")).length, 0); await ctx.close();
});

test("interrupción mientras la persona mira la vista previa: al confirmar se le avisa, no se emite y la sesión es definitiva", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000105" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  assert.equal((await control("POST", `/control/sesiones/${s.id}/interrumpir?empresa=emp-a`, {})).json.estado, "interrumpida");
  await p.click("#btn-confirmar"); await p.waitForSelector("#errores:not([hidden])");
  assert.match(await p.locator("#errores").innerText(), /primero debe verse la vista previa/i);
  assert.equal((await libro("ref-00000105")).length, 0); assert.equal(await estado(s), "interrumpida"); await ctx.close();
});

test("doble clic en «Confirmar»: una sola emisión", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000106" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  await p.dblclick("#btn-confirmar"); await p.waitForSelector("#seccion-resultado:not([hidden])");
  assert.equal((await libro("ref-00000106")).length, 1); assert.equal(await estado(s), "confirmada"); await ctx.close();
});

test("«Volver a editar» invalida la vista previa; «Descartar» termina sin emitir", async () => {
  const a = await abrir({ referencia: "ref-00000107" });
  await llenar(a.p); await a.p.click("#btn-previa"); await a.p.waitForSelector("#seccion-previa:not([hidden])");
  await a.p.click("#btn-editar"); await a.p.waitForSelector("#seccion-edicion:not([hidden])"); assert.equal(await estado(a.s), "abierta");
  await a.p.click("#btn-previa"); await a.p.waitForSelector("#seccion-previa:not([hidden])");
  await a.p.click("#btn-descartar"); await a.p.waitForSelector("#seccion-resultado:not([hidden])");
  assert.equal(await a.p.locator("#resultado-titulo").innerText(), "Operación descartada"); assert.equal(await estado(a.s), "descartada"); assert.equal((await libro("ref-00000107")).length, 0);
  await a.ctx.close();
});

test("caída del servidor tras registrar: la página avisa «NO repita» y el libro permite comprobar que sí se emitió", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000108", fallo: "corte_tras_confirmar" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  await p.click("#btn-confirmar"); await p.waitForSelector("#seccion-resultado:not([hidden])");
  // Chromium puede reintentar solo un POST cuyo socket se cortó: entonces recibe «ya confirmada»; en ambos casos la página dice que NO se repita.
  assert.match(await p.locator("#resultado-titulo").innerText(), /Conexión interrumpida|ya estaba confirmada/); assert.match(await p.locator("#resultado-detalle").innerText(), /NO repita/);
  assert.equal((await libro("ref-00000108")).length, 1, "resultado incierto para quien mira la pantalla, pero el libro lo tiene");
  assert.ok((await eventos(s)).includes("error_inyectado")); await ctx.close();
});

test("error del servidor antes de registrar: la página muestra el error, no se emite y no se puede reintentar sobre la misma sesión", async () => {
  const { p, s, ctx } = await abrir({ referencia: "ref-00000109", fallo: "error_antes" });
  await llenar(p); await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  await p.click("#btn-confirmar"); await p.waitForSelector("#errores:not([hidden])");
  assert.match(await p.locator("#errores").innerText(), /Error del servidor simulado/); assert.equal(await estado(s), "error"); assert.equal((await libro("ref-00000109")).length, 0);
  assert.ok(await p.locator("#btn-confirmar").isDisabled()); await ctx.close();
});

test("operación duplicada: dos sesiones con la misma referencia ⇒ dos emisiones y la segunda queda señalada como duplicada", async () => {
  for (let i = 0; i < 2; i++) {
    const { p, ctx } = await abrir({ empresa: "emp-dup", referencia: "ref-00000110" }); await llenar(p);
    await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])"); await p.click("#btn-confirmar"); await p.waitForSelector("#seccion-resultado:not([hidden])"); await ctx.close();
  }
  assert.equal((await libro("ref-00000110", "emp-dup")).length, 2);
  const ev = (await control("GET", "/control/eventos?empresa=emp-dup")).json; assert.equal(ev.filter((e) => e.evento === "emision_duplicada_de_referencia").length, 1);
  assert.equal((await libro("ref-00000110", "emp-a")).length, 0, "otra empresa no ve ese libro");
});

test("el contenido escrito por el usuario se muestra como texto (sin ejecutar HTML) y ninguna petición sale de 127.0.0.1", async () => {
  const { p, s, ctx, errores } = await abrir({ referencia: "ref-00000111" });
  await llenar(p, { nombre: "<img src=x onerror=window.__xss=1>", descripcion: "<script>window.__xss=1</script>" });
  await p.click("#btn-previa"); await p.waitForSelector("#seccion-previa:not([hidden])");
  assert.match(await p.locator("#previa-datos").innerText(), /<img src=x onerror=window.__xss=1>/);
  assert.equal(await p.evaluate(() => window.__xss), undefined); assert.equal(await p.locator("#previa-datos img").count(), 0);
  assert.deepEqual(errores, []); assert.deepEqual(externas, [], "el simulador no contacta ningún host externo"); assert.equal(await estado(s), "previsualizada"); await ctx.close();
});
