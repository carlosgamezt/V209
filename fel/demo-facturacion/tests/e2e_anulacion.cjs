// Anulación SIMULADA en el NAVEGADOR (teléfono): confirmación reforzada (motivo + palabra ANULAR), cancelar sin efecto, rechazada, pendiente de conciliación, anulada con la marca «ANULADO»
// en la vista previa (carta y ticket) y en el PDF, permisos (el lector no puede) y distribución a 320 / 360 / 390 / 430 px. Servidor real + PostgreSQL (PGlite), todo simulado y local.
// Uso: node e2e_anulacion.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    const ctxMovil = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: true, ...(NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const toast = (p, t) => p.waitForSelector(`#toasts >> text=${t}`, { timeout: 8000 }).catch(async (e) => { throw new Error(`no apareció el aviso «${t}». Avisos: «${await p.locator("#toasts").innerText()}» · error en pantalla: «${await p.locator(".area-msg").innerText().catch(() => "")}»\n${e.message}`); });
    // documento certificado en SIMULACIÓN creado por la API con la sesión del navegador (así no se depende de la pantalla de captura)
    const certificado = (p, n) => p.evaluate(async (n) => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "100" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version });
      const c = await post(`/api/documentos/${d.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-e2e-anulacion-${n}-${Date.now()}` });
      if (c.documento?.estado_fiscal !== "certificado") throw new Error("no se certificó: " + JSON.stringify(c).slice(0, 200));
      return d.documento.id;
    }, n);
    const SEL = 'select[aria-label="Respuesta del proveedor simulado a la anulación"]', MOT = 'textarea[aria-label="Motivo de la anulación"]', PAL = 'input[aria-label="Escribe ANULAR para confirmar"]';
    const abrirDialogo = async (p) => { await p.waitForSelector("#anular"); await p.click("#anular"); await p.waitForSelector(".anu-dialogo"); };
    // Al cancelar o cerrar el diálogo la pantalla recarga el documento, y hasta que termina ignora nuevos toques en «Anular» (evita acciones dobles). Se espera esa recarga antes de volver a pulsar.
    const cerrarDialogo = async (p, cerrar) => {
      const recarga = p.waitForResponse((r) => r.request().method() === "GET" && /\/api\/documentos\/[0-9a-f-]{36}$/.test(r.url()), { timeout: 15000 });
      await cerrar(); await p.waitForSelector(".anu-dialogo", { state: "detached" }); await recarga;
      await p.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))); await p.waitForSelector("#anular");
    };
    const anuladas = (p, id) => p.evaluate(async (id) => (await (await fetch(`/api/documentos/${id}`, { headers: { "x-demo": "1" } })).json()).operaciones.filter((o) => o.tipo === "anulacion").length, id);

    // ================= Ana (propietaria) a 390 px
    const { p } = await ctxMovil(390); await entrar(p, "ana");
    const peticiones = []; p.on("request", (r) => { if (r.method() === "POST" && /\/anular$/.test(r.url())) peticiones.push(r.url()); });
    const idA = await certificado(p, "a"), idB = await certificado(p, "b"), idC = await certificado(p, "c");

    // --- confirmación reforzada: el botón solo se habilita con motivo Y la palabra exacta
    await p.goto(`${srv.url}/#/f/${idA}`); await abrirDialogo(p);
    const ok = p.locator("#anular-confirmar"); assert.equal(await ok.isDisabled(), true, "al abrir: deshabilitado");
    assert.match(await p.locator(".anu-ficha").innerText(), /Receptor[\s\S]*Total[\s\S]*Autorización/, "resumen del documento"); assert.match(await p.locator(".anu-aviso").innerText(), /definitiva/i);
    await p.fill(MOT, "Error en los datos del receptor"); assert.equal(await ok.isDisabled(), true, "solo motivo: deshabilitado");
    await p.fill(PAL, "anular"); assert.equal(await ok.isDisabled(), true, "palabra en minúsculas: deshabilitado"); await p.fill(PAL, "ANULA"); assert.equal(await ok.isDisabled(), true);
    await p.fill(MOT, "no"); await p.fill(PAL, "ANULAR"); assert.equal(await ok.isDisabled(), true, "motivo demasiado corto: deshabilitado"); await p.fill(MOT, "Error en los datos del receptor"); assert.equal(await ok.isDisabled(), false, "motivo y palabra: habilitado");
    const caja = await p.locator(".anu-dialogo").boundingBox(), bOk = await ok.boundingBox(); assert.ok(caja.x >= 0 && caja.x + caja.width <= 390 + 1, "el diálogo cabe en el ancho"); assert.ok(bOk.y + bOk.height <= 844, "el botón confirmar queda dentro de la pantalla"); assert.ok(bOk.height >= 40, `objetivo táctil ≥ 40 px (${bOk.height})`);
    await sinDesborde(p, "diálogo de anulación");
    // cancelar y cerrar con Escape no anulan nada ni envían nada
    await cerrarDialogo(p, () => p.click("#anular-cancelar")); await abrirDialogo(p); await p.fill(MOT, "Motivo escrito"); await p.fill(PAL, "ANULAR"); await cerrarDialogo(p, () => p.keyboard.press("Escape"));
    await p.waitForTimeout(300); assert.equal(peticiones.length, 0, "cancelar no envía ninguna petición"); assert.equal(await anuladas(p, idA), 0); assert.match(await p.locator(".doc-cab").innerText(), /Certificado/);
    await abrirDialogo(p); assert.equal(await p.inputValue(MOT), "", "el diálogo nuevo empieza vacío"); await cerrarDialogo(p, () => p.click("#anular-cancelar"));

    // --- rechazada por el proveedor: mensaje claro, sigue certificado y se puede reintentar
    await p.selectOption(SEL, "rechazo"); await abrirDialogo(p); await p.fill(MOT, "Intento que el proveedor rechaza"); await p.fill(PAL, "ANULAR"); await p.click("#anular-confirmar");
    await toast(p, "rechazó la anulación"); await p.waitForSelector("#anular"); assert.match(await p.locator(".doc-cab").innerText(), /Certificado/); assert.equal(peticiones.length, 1);
    // --- pendiente de conciliación: sin respuesta utilizable
    await p.selectOption(SEL, "indeterminado"); await abrirDialogo(p); await p.fill(MOT, "El proveedor no responde"); await p.fill(PAL, "ANULAR"); await p.click("#anular-confirmar");
    await toast(p, "pendiente de conciliación"); await p.waitForSelector('[data-panel="anulacion-desconocida"]'); assert.equal(await p.locator("#anular").count(), 0, "mientras hay una anulación pendiente no se ofrece otra");
    assert.match(await p.locator(".doc-cab").innerText(), /Anulación solicitada/i); assert.match(await p.locator(".aviso").first().innerText(), /pendiente de conciliar/i); await sinDesborde(p, "anulación pendiente");

    // --- anulada: banner, tarjeta con el motivo y marca ANULADO en la vista previa (carta y ticket) y en el PDF
    await p.goto(`${srv.url}/#/f/${idB}`); await abrirDialogo(p); await p.fill(MOT, "Factura emitida por error"); await p.fill(PAL, "ANULAR"); await p.press(PAL, "Enter");
    await toast(p, "Documento anulado (simulación)"); await p.waitForSelector('[data-panel="documento-anulado"]'); assert.match(await p.locator('[data-panel="documento-anulado"]').innerText(), /Factura emitida por error/);
    assert.match(await p.locator(".doc-cab").innerText(), /Anulado/); assert.match(await p.locator(".aviso").first().innerText(), /ANULADO/); assert.equal(await p.locator("#anular").count(), 0, "un documento anulado no se vuelve a anular");
    await p.click("#ver-previa"); await p.waitForSelector(".previa-modal .papel");
    for (const f of ["carta", "ticket"]) {
      if (f === "ticket") await p.locator(".previa-modal .seg-op", { hasText: "Ticket 80 mm" }).click();
      await p.waitForSelector(`.previa-modal .papel[data-formato="${f}"] [data-anulacion="anulado"]`); assert.equal(await p.locator(`.previa-modal .papel[data-formato="${f}"] .sello-anu`).isVisible(), true, `${f}: sello visible`);
      assert.match(await p.locator(`.previa-modal .papel[data-formato="${f}"]`).innerText(), /DOCUMENTO ANULADO/); await sinDesborde(p, `vista previa ${f} anulada`);
    }
    const pdf = await p.evaluate(async (id) => { const r = await Promise.all(["carta", "ticket"].map(async (f) => { const x = await fetch(`/api/documentos/${id}/pdf-demo?formato=${f}`, { headers: { "x-demo": "1" } }); return [x.status, new TextDecoder("latin1").decode(await x.arrayBuffer())]; })); return r.map(([s, t]) => [s, t.includes("ANULADO"), t.includes("SIN VALOR FISCAL")]); }, idB);
    assert.deepEqual(pdf, [[200, true, true], [200, true, true]], "PDF carta y ticket con ANULADO y el rótulo de no fiscal"); await p.keyboard.press("Escape");
    // un documento NO anulado no lleva la marca
    await p.goto(`${srv.url}/#/f/${idC}`); await p.click("#ver-previa"); await p.waitForSelector(".previa-modal .papel"); assert.equal(await p.locator(".previa-modal [data-anulacion]").count(), 0, "sin marca antes de anular"); await p.keyboard.press("Escape");

    // ================= el lector (pedro) ve el panel pero no puede anular
    const lec = await ctxMovil(390); await entrar(lec.p, "pedro"); await lec.p.goto(`${srv.url}/#/f/${idC}`); await lec.p.waitForSelector("#anular");
    assert.equal(await lec.p.locator("#anular").isDisabled(), true, "el lector no puede anular"); assert.match(await lec.p.locator('[data-panel="anulacion"]').innerText(), /Tu rol no puede anular/);
    // aislamiento: otra empresa (sofia) no ve el documento ni puede anularlo
    const otra = await ctxMovil(390); await entrar(otra.p, "sofia");
    const aj = await otra.p.evaluate(async (id) => { const H = { "x-demo": "1", "content-type": "application/json" }; const g = await fetch(`/api/documentos/${id}`, { headers: H }); const a = await fetch(`/api/documentos/${id}/anular`, { method: "POST", headers: H, body: JSON.stringify({ confirmacion: "ANULAR", motivo: "Intento ajeno", clave: "clave-ajena-e2e-0000001" }) }); return [g.status, a.status]; }, idC);
    assert.ok(aj[0] === 404 && aj[1] >= 400, `otra empresa: ${aj}`); assert.equal(await anuladas(p, idC), 0);

    // ================= distribución del diálogo y de la vista previa anulada a 320 / 360 / 390 / 430 px
    for (const w of [320, 360, 390, 430]) {
      const m = await ctxMovil(w, 740); await entrar(m.p, "ana");
      await m.p.goto(`${srv.url}/#/f/${idC}`); await abrirDialogo(m.p); await m.p.fill(MOT, "Motivo de prueba larga ".repeat(6)); await m.p.fill(PAL, "ANULAR");
      const c = await m.p.locator(".anu-dialogo").boundingBox(), b = await m.p.locator("#anular-confirmar").boundingBox(), cancel = await m.p.locator("#anular-cancelar").boundingBox();
      assert.ok(c.x >= -0.5 && c.x + c.width <= w + 0.5, `${w}px: el diálogo cabe en el ancho`); assert.ok(b.x >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= 740, `${w}px: confirmar visible`); assert.ok(cancel.x >= 0 && cancel.x + cancel.width <= w + 0.5, `${w}px: cancelar visible`);
      assert.ok(b.height >= 40 && cancel.height >= 40, `${w}px: botones ≥ 40 px`); await sinDesborde(m.p, `${w}px diálogo`); await m.p.click("#anular-cancelar");
      await m.p.goto(`${srv.url}/#/f/${idB}`); await m.p.click("#ver-previa"); await m.p.waitForSelector(".previa-modal [data-anulacion]"); await sinDesborde(m.p, `${w}px vista previa anulada`); await m.c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`ANULACIÓN E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
