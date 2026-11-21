// Envío de facturas por CORREO en el NAVEGADOR (teléfono): panel del detalle, envío manual, historial con estados reales, reenvío con confirmación escrita, rol de lector, factura anulada,
// módulo apagado (sin FEL_CORREO la tarjeta no aparece) y distribución a 320 / 360 / 390 / 430 px. Servidor real + PostgreSQL (PGlite), correo SIMULADO: no sale nada a la red.
// Uso: node e2e_correo.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
function arrancar(env = {}) {
  const puerto = 9300 + Math.floor(Math.random() * 400);
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1", ...env } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
(async () => {
  const srv = await arrancar({ FEL_CORREO: "simulado" }), srvSin = await arrancar(), srvAuto = await arrancar({ FEL_CORREO: "simulado", FEL_CORREO_AUTOMATICO: "habilitado" }), nav = await motor.launch(), errores = [];
  try {
    const ctxMovil = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: true, ...(NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u, url = srv.url) => { await p.goto(url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const certificado = (p, n) => p.evaluate(async (n) => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "100" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version });
      const c = await post(`/api/documentos/${d.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-e2e-correo-${n}-${Date.now()}` });
      if (c.documento?.estado_fiscal !== "certificado") throw new Error("no se certificó: " + JSON.stringify(c).slice(0, 200));
      return d.documento.id;
    }, n);
    const toast = (p, t) => p.waitForSelector(`#toasts >> text=${t}`, { timeout: 8000 });
    const PANEL = '[data-panel="correo"]';

    // ================= Ana (propietaria) a 390 px: enviar, ver el historial, reenviar con confirmación
    const { p } = await ctxMovil(390); await entrar(p, "ana");
    const idA = await certificado(p, "a"), idB = await certificado(p, "b");
    await p.goto(`${srv.url}/#/f/${idA}`); await p.waitForSelector(PANEL, { state: "visible" });
    const entrada = p.locator("#correo-destinatario"); assert.match(await entrada.inputValue(), /@/, "el correo guardado del receptor viene prellenado");
    assert.match(await p.locator(PANEL).innerText(), /DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL/, "el rótulo de prueba se anuncia en la tarjeta"); assert.match(await p.locator(PANEL).innerText(), /Todavía no se ha enviado/);
    // dirección inválida: el botón no se habilita
    const bueno = await entrada.inputValue(); await entrada.fill("no-es-correo"); assert.equal(await p.locator("#correo-enviar").isDisabled(), true, "dirección inválida: deshabilitado"); await entrada.fill(bueno); assert.equal(await p.locator("#correo-enviar").isDisabled(), false);
    // objetivos táctiles
    for (const sel of ["#correo-destinatario", "#correo-enviar"]) { const b = await p.locator(sel).boundingBox(); assert.ok(b.height >= 40, `${sel} ≥ 40 px (${b.height})`); assert.ok(b.x >= 0 && b.x + b.width <= 390 + 0.5, `${sel} dentro del ancho`); }
    await sinDesborde(p, "tarjeta de correo");
    await p.click("#correo-enviar"); await toast(p, "aceptado por el proveedor");
    await p.waitForSelector('.correo-fila[data-estado="aceptado"]'); const t1 = await p.locator(PANEL).innerText(); assert.match(t1, /Aceptado por el proveedor/); assert.match(t1, /Manual/); assert.ok(t1.includes(bueno), "el historial muestra el destinatario");
    assert.ok(!/Entregado/.test(t1), "no se afirma entrega que nadie confirmó"); assert.equal(await p.locator("#correo-enviar").count(), 0, "ya enviado: el botón pasa a «Reenviar»"); await p.waitForSelector("#correo-reenviar");
    // reenvío: exige escribir REENVIAR
    await p.click("#correo-reenviar"); await p.waitForSelector("#correo-reenviar-ok"); assert.equal(await p.locator("#correo-reenviar-ok").isDisabled(), true);
    await p.fill("#correo-palabra", "reenviar"); assert.equal(await p.locator("#correo-reenviar-ok").isDisabled(), true, "la palabra se escribe exacta"); await p.click("#correo-reenviar-cancelar");
    assert.equal(await p.locator(".correo-fila").count(), 1, "cancelar no envía nada");
    await p.click("#correo-reenviar"); await p.fill("#correo-palabra", "REENVIAR"); await p.click("#correo-reenviar-ok"); await p.waitForSelector(".correo-fila:nth-child(2)"); assert.equal(await p.locator(".correo-fila").count(), 2);   // sin waitForFunction: la política de seguridad de la página (script-src 'self') prohíbe eval
    assert.match(await p.locator(PANEL).innerText(), /Reenvío/); await sinDesborde(p, "historial de correo");
    // recargar: el historial persiste
    await p.reload(); await p.waitForSelector(".correo-fila"); assert.equal(await p.locator(".correo-fila").count(), 2);

    // ================= anulada: no se ofrece enviar; el historial sigue visible
    await p.goto(`${srv.url}/#/f/${idB}`); await p.waitForSelector(PANEL, { state: "visible" }); assert.equal(await p.locator("#correo-enviar").count(), 1);
    await p.evaluate(async (id) => { await fetch(`/api/documentos/${id}/anular`, { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ confirmacion: "ANULAR", motivo: "Anulación de prueba del correo", clave: "clave-anula-e2e-correo-b" }) }); }, idB);
    await p.reload(); await p.waitForSelector(PANEL, { state: "visible" }); assert.equal(await p.locator("#correo-enviar").count(), 0, "factura anulada: sin botón de envío"); assert.match(await p.locator(PANEL).innerText(), /anulada/i);

    // ================= el lector (pedro) ve el historial pero no puede enviar
    const lec = await ctxMovil(390); await entrar(lec.p, "pedro"); await lec.p.goto(`${srv.url}/#/f/${idA}`); await lec.p.waitForSelector(PANEL, { state: "visible" });
    assert.equal(await lec.p.locator("#correo-enviar").count() + await lec.p.locator("#correo-reenviar").count(), 0, "el lector no tiene botones"); assert.match(await lec.p.locator(PANEL).innerText(), /Tu rol no puede enviar/); assert.equal(await lec.p.locator(".correo-fila").count(), 2);

    // ================= servidor sin correo configurado: la tarjeta no aparece
    const sin = await ctxMovil(390); await entrar(sin.p, "ana", srvSin.url); const idS = await certificado(sin.p, "s"); await sin.p.goto(`${srvSin.url}/#/f/${idS}`); await sin.p.waitForSelector(".doc-cab"); await sin.p.waitForTimeout(800);
    assert.equal(await sin.p.locator(PANEL).isVisible(), false, "sin FEL_CORREO la tarjeta de correo no se muestra");


    // ================= envío AUTOMÁTICO: la casilla solo existe si el servidor lo habilita; apagada por defecto; al certificar con la casilla se envía y queda en el historial
    const borrador = (p) => p.evaluate(async () => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "300" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version }); return d.documento.id;
    });
    { const idN = await borrador(p); await p.goto(`${srv.url}/#/f/${idN}`); await p.waitForSelector("#enviar"); await p.waitForTimeout(600); assert.equal(await p.locator("#correo-auto").isVisible(), false, "sin FEL_CORREO_AUTOMATICO no hay casilla"); }
    const au = await ctxMovil(390); await entrar(au.p, "ana", srvAuto.url); const idU = await borrador(au.p); await au.p.goto(`${srvAuto.url}/#/f/${idU}`); await au.p.waitForSelector("#enviar");
    await au.p.waitForSelector("#correo-auto", { state: "visible" }); assert.equal(await au.p.locator("#correo-auto").isChecked(), false, "la casilla viene apagada"); const cb = await au.p.locator(".correo-auto").boundingBox(); assert.ok(cb.height >= 40, "casilla ≥ 40 px");
    await au.p.check("#correo-auto"); await au.p.click("#enviar"); await toast(au.p, "Certificado"); await toast(au.p, "Correo de la factura aceptado");
    await au.p.waitForSelector('.correo-fila[data-estado="aceptado"]'); assert.match(await au.p.locator(PANEL).innerText(), /Automático/); await sinDesborde(au.p, "certificar con correo automático");

    // ================= distribución a 320 / 360 / 390 / 430 px
    for (const w of [320, 360, 390, 430]) {
      const m = await ctxMovil(w, 740); await entrar(m.p, "ana"); await m.p.goto(`${srv.url}/#/f/${idA}`); await m.p.waitForSelector(".correo-fila");
      await sinDesborde(m.p, `${w}px detalle con correo`); const caja = await m.p.locator(PANEL).boundingBox(); assert.ok(caja.x >= 0 && caja.x + caja.width <= w + 0.5, `${w}px: la tarjeta cabe`);
      const b = await m.p.locator("#correo-reenviar").boundingBox(); assert.ok(b.height >= 40 && b.x + b.width <= w + 0.5, `${w}px: botón ≥ 40 px y dentro`);
      await m.p.click("#correo-reenviar"); const d = await m.p.locator(".modal").boundingBox(); assert.ok(d.x >= -0.5 && d.x + d.width <= w + 0.5, `${w}px: el diálogo cabe`); await sinDesborde(m.p, `${w}px diálogo de reenvío`); await m.p.click("#correo-reenviar-cancelar"); await m.c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`CORREO E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); srvSin.parar(); srvAuto.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
