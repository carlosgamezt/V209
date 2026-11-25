// Pantalla posterior a la certificación en el NAVEGADOR: resultado compacto (total, serie, número, UUID, ambiente) y acciones de entrega, a 320/360/390/412/768/1440 px.
// Comprueba contenido, ambiente rotulado, descarga real de PDF carta y ticket, impresión, compartir (con el API nativa simulada y sin ella), correo (deshabilitado con motivo si el servidor
// no lo habilita), PERMISOS (el lector no ve «Nueva factura»), ausencia de desbordamientos y objetivos táctiles. Servidor real + PostgreSQL (PGlite); todo simulado y local.
// Uso: node e2e_emitido.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit)
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
    const ctxMovil = async (w, h = 844, movil = true) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: movil, acceptDownloads: true, ...(movil && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const certificado = (p, n) => p.evaluate(async (n) => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "100" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version });
      const c = await post(`/api/documentos/${d.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-e2e-emitido-${n}-${Date.now()}` });
      if (c.documento?.estado_fiscal !== "certificado") throw new Error("no se certificó: " + JSON.stringify(c).slice(0, 200));
      return { id: d.documento.id, doc: c.documento, borrador: (await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Borrador", cantidad: "1", precio_unitario: "10" }] })).documento.id };
    }, n);
    const IDS = ["emitido-correo-btn", "emitido-pdf", "emitido-imprimir", "emitido-ticket", "emitido-compartir", "emitido-nueva"];

    // ================= Ana (propietaria) a seis anchos
    const base = await ctxMovil(390); await entrar(base.p, "ana"); const cert = await certificado(base.p, "a");
    for (const w of [320, 360, 390, 412, 768, 1440]) {
      const { c, p } = await ctxMovil(w, w >= 768 ? 900 : 844, w < 768); await entrar(p, "ana"); await p.goto(`${srv.url}/#/f/${cert.id}`); await p.waitForSelector('[data-panel="emitido"]');
      const t = await p.locator('[data-panel="emitido"]').innerText();
      assert.match(t, /documento emitido/i); assert.match(t, /SIMULADO · sin valor fiscal/); assert.match(t, /Q\s?[\d,]+\.\d\d/); assert.match(t, /Serie/); assert.match(t, /Número fiscal/);
      const uuid = (await p.locator("#emitido-uuid").innerText()).trim(); assert.ok(uuid.length > 8 && uuid !== "—", `${w}: UUID visible (${uuid})`); assert.equal(uuid, cert.doc.autorizacion_sat, `${w}: el UUID mostrado es el del documento`);
      assert.equal((await p.locator("#emitido-uuid").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)), true, `${w}: el UUID no se corta`);
      for (const id of IDS) assert.equal(await p.locator("#" + id).count(), 1, `${w}: existe #${id}`); assert.equal(await p.locator("#emitido-volver").count(), 1);
      // geometría: todo dentro del ancho, sin solaparse, objetivos táctiles ≥ 40 px en teléfono
      const cajas = await p.evaluate((ids) => ids.map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; }), IDS);
      for (const x of cajas) { assert.ok(x.l >= -0.5 && x.r <= w + 0.5, `${w}: #${x.id} cabe en el ancho (${x.l}–${x.r})`); if (w < 768) assert.ok(x.h >= 40, `${w}: #${x.id} mide ≥ 40 px (${x.h})`); }
      for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) { const a = cajas[i], b = cajas[j]; assert.ok(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1, `${w}: #${a.id} y #${b.id} no se superponen`); }
      for (const id of IDS) { const txt = await p.locator("#" + id).evaluate((e) => e.scrollWidth <= e.clientWidth + 1); assert.ok(txt, `${w}: el texto de #${id} no se corta`); }
      await sinDesborde(p, `pantalla emitida ${w}px`); if (process.env.FEL_FOTOS) await p.screenshot({ path: path.join(process.env.FEL_FOTOS, `emitido-${w}.png`), fullPage: false });
      // sin API de compartir del navegador: deshabilitado y explica por qué (no simula nada)
      if (!(await p.evaluate(() => typeof navigator.share === "function"))) { assert.equal(await p.locator("#emitido-compartir").isDisabled(), true, `${w}: Compartir deshabilitado sin API nativa`); assert.ok((await p.locator("#emitido-compartir").getAttribute("title")).length > 5); }
      // correo: el servidor de esta prueba no lo habilita → deshabilitado con motivo (nunca finge enviar)
      await p.locator('#emitido-correo-btn:not([title="Comprobando…"])').waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
      if (await p.locator("#emitido-correo-btn").isDisabled()) { assert.match((await p.locator("#emitido-correo-btn").getAttribute("title")) ?? "", /no disponible|comprobar/i); await p.locator("#emitido-correo-nota").waitFor({ state: "attached" }); assert.match(await p.locator("#emitido-correo-nota").innerText(), /Correo no disponible: .+/, `${w}: la razón del correo bloqueado se ve en pantalla`); }
      if (w === 390) {
        // descargas reales: PDF carta y ticket
        for (const [id, fmt] of [["emitido-pdf", "CARTA"], ["emitido-ticket", "TICKET"]]) {
          const [d] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click("#" + id)]); assert.match(d.suggestedFilename(), new RegExp(fmt)); const ruta = await d.path(); const buf = require("fs").readFileSync(ruta); assert.equal(buf.slice(0, 5).toString(), "%PDF-", `${id}: es un PDF`); assert.ok(buf.length > 800);
        }
        // imprimir abre la vista previa para imprimir
        await p.click("#emitido-imprimir"); await p.waitForSelector(".previa-modal"); await p.keyboard.press("Escape");
        // el detalle fiscal sigue visible bajo la tarjeta (anular y conciliar no quedan ocultos)
        assert.equal(await p.locator("#anular").isVisible(), true, "«Anular» sigue accesible"); await sinDesborde(p, "detalle fiscal");
        // «Nueva factura» lleva a la captura
        await p.click("#emitido-nueva"); await p.waitForSelector("#guardar, #guardar-certificar");
        // un borrador NO muestra la tarjeta
        await p.goto(`${srv.url}/#/f/${cert.borrador}`); await p.waitForSelector(".doc-cab"); assert.equal(await p.locator('[data-panel="emitido"]').count(), 0, "un borrador no tiene pantalla de documento emitido");
      }
      await c.close();
    }
    // compartir con la API nativa (simulada): entrega un PDF real, sin descarga de respaldo
    { const { c, p } = await ctxMovil(390); await c.addInitScript(() => { window.__compartido = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__compartido.push({ n: d.files?.[0]?.name, tipo: d.files?.[0]?.type, tam: d.files?.[0]?.size }); }; });
      await entrar(p, "ana"); await p.goto(`${srv.url}/#/f/${cert.id}`); await p.waitForSelector('[data-panel="emitido"]'); assert.equal(await p.locator("#emitido-compartir").isDisabled(), false); await p.click("#emitido-compartir");
      for (let i = 0; i < 100 && (await p.evaluate(() => window.__compartido.length)) < 1; i++) await p.waitForTimeout(100);   // sondeo con evaluate (la CSP de CI prohíbe waitForFunction)
      assert.equal(await p.evaluate(() => window.__compartido.length), 1, "se llamó una vez a la API de compartir"); const r = await p.evaluate(() => window.__compartido[0]); assert.equal(r.tipo, "application/pdf"); assert.ok(r.tam > 800, "se compartió un PDF con contenido"); assert.match(r.n, /\.pdf$/); await c.close(); }

    // ================= permisos: el lector (pedro) ve el resultado pero no crea documentos; el emisor (marta) sí
    for (const [u, creaNueva] of [["pedro", false], ["marta", true]]) {
      const { c, p } = await ctxMovil(390); await entrar(p, u); await p.goto(`${srv.url}/#/f/${cert.id}`); await p.waitForSelector('[data-panel="emitido"]');
      assert.equal(await p.locator("#emitido-nueva").count(), creaNueva ? 1 : 0, `${u}: «Nueva factura» ${creaNueva ? "disponible" : "ausente"}`);
      assert.equal(await p.locator("#emitido-pdf").count(), 1, `${u}: puede descargar el PDF`); await sinDesborde(p, `emitido ${u}`); await c.close();
    }
    assert.deepEqual(errores, [], "sin errores de JavaScript en la página: " + errores.join(" | "));
    console.log("OK e2e_emitido: pantalla de documento emitido (320/360/390/412/768/1440 px), descargas PDF carta y ticket, imprimir, compartir con y sin API nativa, correo deshabilitado con motivo, permisos y sin desbordes");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
