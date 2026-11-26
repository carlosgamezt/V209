// PANEL «Establecimientos» (etapa 1D) en el NAVEGADOR, teléfono 390 px y computadora 1100 px, con el servidor REAL de la demostración en modo local de establecimientos (FEL_DEMO_ESTABLECIMIENTOS=1: PostgreSQL en memoria + M-D…M-H,
// códigos 2 «Sucursal Principal» y 67 «Sucursal 2», sesiones guardadas en la base). Comprueba: el administrador ve y renombra establecimientos, asigna personas con motivo, concede supervisión; el facturador ve su establecimiento FIJO y BLOQUEADO
// en Nueva factura; el supervisor elige entre los suyos; quien factura no ve el panel. Uso: node tests/e2e_establecimientos_admin.cjs
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1", FEL_DEMO_ESTABLECIMIENTOS: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó:\n" + s)); }, 180000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); hijo.on("exit", (c) => { if (c) mal(new Error("salió " + c + "\n" + s)); }); });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = []; let diegoCreado = false;
  try {
    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const donde = `${w}px`, nuevoCtx = async () => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); return c; };
      const entrar = async (usuario, clave = "demo1234") => { const c = await nuevoCtx(), p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${donde}/${usuario}: ${e.message}`)); await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", usuario).catch(async () => { await p.fill("#login-usuario", usuario); }); await p.fill("#login-clave", clave); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); return { c, p }; };
      const sinDesborde = async (p, d) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desborde horizontal en ${d}: ${a} > ${v}`); };
      const ruidoSolo = async (p) => { await p.waitForSelector("#guardar-formulario"); };
      // ---- administradora
      const ana = await entrar("ana"), pa = ana.p;
      await pa.goto(srv.url + "/#/establecimientos"); await pa.waitForSelector('[data-panel="est-lista"]');
      assert.ok(await pa.locator('[data-establecimiento="2"]').innerText().then((t) => /Sucursal Principal/.test(t)), `${donde}: el 2 se llama Sucursal Principal`); assert.ok(await pa.locator('[data-establecimiento="67"]').innerText().then((t) => /Sucursal 2/.test(t)));
      await sinDesborde(pa, `${donde} panel`);
      // renombrar el 67 (el código NO se toca)
      await pa.click('[data-editar-establecimiento="67"]'); await pa.fill('input[aria-label="Nombre interno"]', "Sucursal Norte"); await pa.click("#guardar-formulario"); await pa.waitForFunction(() => /67 · Sucursal Norte/.test(document.querySelector('[data-establecimiento="67"]')?.innerText ?? ""));
      await pa.click('[data-editar-establecimiento="67"]'); await pa.fill('input[aria-label="Nombre interno"]', "Sucursal 2"); await pa.click("#guardar-formulario"); await pa.waitForFunction(() => /67 · Sucursal 2/.test(document.querySelector('[data-establecimiento="67"]')?.innerText ?? ""));
      // crear a Diego (facturador) con la pantalla de usuarios y asignarlo al 67 desde el panel (usuario nuevo solo la primera vez)
      const usuario = `diego${w}`, api = (m, r, b) => pa.evaluate(async ([m, r, b]) => { const x = await fetch(r, { method: m, headers: { "x-demo": "1", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { s: x.status, t: await x.text() }; }, [m, r, b]);
      assert.equal((await api("POST", "/api/usuarios", { usuario, nombre: `Diego ${w}`, clave: "Clave-Prueba-123", rol: "emisor" })).s, 200); diegoCreado = true;
      await pa.reload(); await pa.waitForSelector(`[data-persona-fila="${usuario}"]`);
      const selD = pa.locator(`select[data-persona="${usuario}"]`); assert.equal(await selD.inputValue(), "", `${donde}: sin asignar al inicio`);
      await selD.selectOption({ label: "67 · Sucursal 2" }); await pa.fill('input[aria-label="Motivo"]', "Alta en la sucursal 2"); await pa.click("#guardar-formulario");
      await pa.waitForFunction((u) => { const s = document.querySelector(`select[data-persona="${u}"]`); return s && s.selectedOptions[0]?.textContent.startsWith("67"); }, usuario);
      await sinDesborde(pa, `${donde} personas`);
      // ---- facturador (Diego): su establecimiento aparece solo y BLOQUEADO; no ve el panel
      const di = await entrar(usuario, "Clave-Prueba-123"), pd = di.p;
      await pd.goto(srv.url + "/#/nueva"); await esperarNueva(pd);
      const selEst = pd.locator('select[aria-label="Establecimiento"]');
      assert.equal(await selEst.isDisabled(), true, `${donde}: bloqueado`); assert.match((await pd.locator("#establecimiento-vista").innerText()).trim(), /^67/); assert.equal(await selEst.locator("option").evaluateAll((l) => l.filter((o) => o.value).length), 1);
      assert.equal(await pd.locator('nav a[href="#/establecimientos"], a[href="#/establecimientos"]').count(), 0, `${donde}: el facturador no ve el panel`);
      await pd.goto(srv.url + "/#/establecimientos"); await pd.waitForTimeout(400); assert.equal(await pd.locator('[data-panel="est-lista"]').count(), 0, `${donde}: sin panel para el facturador`);
      // ---- supervisión: se concede con motivo, se agrega el 2 y Diego puede elegir entre los DOS
      await pa.locator(`input[data-supervisor="${usuario}"]`).check({ force: true }).catch(() => {}); await ruidoSolo(pa); await pa.fill('input[aria-label="Motivo"]', "Supervisa las dos sucursales"); await pa.click("#guardar-formulario");
      await pa.waitForSelector(`select[aria-label="Agregar establecimiento a Diego ${w}"]`); await pa.locator(`select[aria-label="Agregar establecimiento a Diego ${w}"]`).selectOption({ label: "2 · Sucursal Principal" }); await pa.fill('input[aria-label="Motivo"]', "Segunda sucursal"); await pa.click("#guardar-formulario");
      await pa.waitForFunction((u) => document.querySelector(`[data-persona-fila="${u}"]`)?.innerText.includes("2 · Sucursal Principal"), usuario);
      await pd.goto(srv.url + "/#/"); await pd.goto(srv.url + "/#/nueva"); await pd.reload(); await esperarNueva(pd);
      assert.equal(await pd.locator('select[aria-label="Establecimiento"]').isDisabled(), false, `${donde}: el supervisor puede elegir`); assert.equal(await pd.locator('select[aria-label="Establecimiento"] option').evaluateAll((l) => l.filter((o) => o.value).length), 2);
      // historial visible
      await pa.locator('[data-panel="est-historial"] summary').click(); assert.ok((await pa.locator('[data-panel="est-historial"]').innerText()).includes("Supervisión"), `${donde}: el historial muestra la supervisión`);
      // ---- marta (facturadora del 2): fijo y bloqueado
      const ma = await entrar("marta"), pm = ma.p; await pm.goto(srv.url + "/#/nueva"); await esperarNueva(pm);
      assert.equal(await pm.locator('select[aria-label="Establecimiento"]').isDisabled(), true); assert.match((await pm.locator("#establecimiento-vista").innerText()).trim(), /^2/);
      console.log(`OK ${donde}: panel, nombre interno, asignación, supervisión y bloqueo`);
      for (const x of [ana, di, ma]) await x.c.close();
    }
    assert.ok(diegoCreado); assert.deepEqual(errores, [], "errores de página: " + errores.join(" | "));
    console.log("OK panel de establecimientos (UI)");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
