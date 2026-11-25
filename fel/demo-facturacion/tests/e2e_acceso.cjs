// Acceso anticipado (DEMO): rótulo DEMO, navegación móvil «4 + Más», botón «Reportar un problema» y precio Q0.00 (aceptado solo en DEMO, con aviso; los negativos se rechazan).
// Servidor propio en modo de pruebas (sin credenciales, sin red externa). Uso: node e2e_acceso.cjs   (FEL_DEMO_URL para usar un servidor ya iniciado)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
const { esperarNueva, elegirReceptor, receptorNuevo, elegirTipo, tipoActual, ID: ID_RECEPTOR } = require("./ayudas_nueva.cjs");
const { puertoLibre } = require("./puerto_libre.cjs");
async function arrancar() {
  if (process.env.FEL_DEMO_URL) return Promise.resolve({ url: process.env.FEL_DEMO_URL, parar() {} });
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "0" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
(async () => {
  const srv = await arrancar(), errores = [], nav = await chromium.launch();
  try {
    const nuevo = async (vp, permisos = []) => { const c = await nav.newContext({ viewport: vp, permissions: permisos, locale: "es-GT" }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`)); return p; };

    // ---- móvil: rótulo DEMO, 4 accesos + «Más», reporte
    const m = await nuevo({ width: 390, height: 844 }, ["clipboard-read", "clipboard-write"]);
    await m.goto(srv.url + "/#/nueva"); await m.waitForSelector(".banda-simulado");
    const banda = await m.locator(".banda-simulado").innerText();
    assert.match(banda, /SIMULADO - SIN VALOR FISCAL/); assert.equal(await m.locator(".banda-simulado").evaluate((e) => e.getBoundingClientRect().height <= 24), true, "la franja de simulación es de una sola línea (≈22 px)");
    await m.click("#menu-cuenta"); assert.match(await m.locator(".menu-cuenta").innerText(), /DEMO · datos NO persistentes/, "rótulo DEMO en el menú de la cuenta, según la base real (memoria)"); await m.click("#menu-cuenta"); assert.equal(await m.locator(".menu-cuenta").isHidden(), true);
    assert.equal(await m.locator(".nav-movil > a").count(), 4, "cuatro accesos principales + «Más»");
    assert.equal(await m.locator("#nav-mas").isVisible(), true);
    assert.equal(await m.locator(".hoja-mas").isHidden(), true); await m.click("#nav-mas"); assert.equal(await m.locator(".hoja-mas").isVisible(), true);
    const itemsMas = await m.locator(".hoja-mas .nv").allInnerTexts(); for (const t of ["Conceptos", "Usuarios", "Plan y consumo", "Configuración", "Reportar un problema"]) assert.ok(itemsMas.some((x) => x.includes(t)), `«Más» incluye ${t}`);
    const caja = await m.locator("#nav-mas").boundingBox(); assert.ok(caja.height >= 44, "objetivo táctil de 44 px");
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "sin desborde horizontal");
    await m.click("#reportar-problema-mas"); await m.waitForSelector("#toasts >> text=Datos del problema copiados");
    const txt = await m.evaluate(() => navigator.clipboard.readText());
    assert.match(txt, /REPORTE NEXA FEL \(DEMO\)/); assert.match(txt, /versión: demo-ea1/); assert.match(txt, /pantalla: #\/nueva/); assert.match(txt, /persona\/rol: Ana Torres/); assert.match(txt, /ventana: 390x844/);
    assert.doesNotMatch(txt, /Servicio|NIT|@|\d{7,}/, "el reporte no lleva datos de facturas ni clientes");
    await m.click("#nav-mas"); await m.locator(".hoja-mas a", { hasText: "Configuración" }).click(); await m.waitForURL(/#\/config/);
    assert.equal(await m.locator(".nv-mas.act").count(), 1, "«Más» queda marcado cuando la sección activa está dentro");

    // ---- PC: pie con el botón de reporte y rótulo
    const pc = await nuevo({ width: 1280, height: 800 }); await pc.goto(srv.url + "/#/"); await pc.waitForSelector("#reportar-problema");
    assert.equal(await pc.locator(".nav-movil").isHidden(), true, "sin barra móvil en PC"); assert.match(await pc.locator(".pie-demo").innerText(), /demo-ea1/);

    // ---- precio Q0.00 con aviso; negativo rechazado
    await pc.goto(srv.url + "/#/nueva"); await esperarNueva(pc);
    await elegirReceptor(pc); await pc.selectOption('select[aria-label="Establecimiento"]', { index: 1 });
    const editar = async (pg, fila, precio) => { await pg.click(fila === null ? "#agregar-item" : `button.it[data-linea="${fila}"]`); await pg.waitForSelector(".hoja-item"); if (fila === null) await pg.fill('.hoja-item [aria-label="Descripción"]', "Cortesía de prueba"); await pg.fill('.hoja-item [aria-label="Precio unitario (Q)"]', precio); await pg.click("#ed-guardar"); };
    assert.equal(await pc.locator("#aviso-precio-cero").count(), 0, "sin aviso mientras el precio no es cero");
    await editar(pc, null, "0.00"); await pc.waitForSelector(".hoja-item", { state: "detached" }); await pc.waitForSelector("#aviso-precio-cero");
    assert.match(await pc.locator("#aviso-precio-cero").innerText(), /Q0\.00.*línea 1.*solo en esta DEMO.*No es válido para certificar/s);
    await editar(pc, 1, "25.50"); await pc.waitForSelector("#aviso-precio-cero", { state: "detached" });
    await editar(pc, 1, "-5"); await pc.waitForSelector(".hoja-item .err:has-text('el precio debe ser un número')"); await pc.click("#ed-cancelar"); await pc.waitForSelector(".hoja-item", { state: "detached" }); assert.equal(await pc.locator("#aviso-precio-cero").count(), 0, "el negativo no recibe el aviso de DEMO: se rechaza");
    await editar(pc, 1, "0"); await pc.waitForSelector(".hoja-item", { state: "detached" }); await pc.waitForSelector("#aviso-precio-cero");
    await pc.getByRole("button", { name: /Guardar borrador/ }).click(); await pc.waitForSelector("#toasts >> text=/guardad/i");   // en DEMO se puede guardar con Q0.00
    // ---- responsive en 3 tamaños (móvil pequeño, móvil grande, escritorio): sin desborde, objetivos táctiles, barra de acciones sin texto cortado, botón flotante «Agregar ítem», teclado virtual
    for (const [nom, vp] of [["móvil pequeño 360", { width: 360, height: 640 }], ["móvil grande 412", { width: 412, height: 915 }], ["escritorio 1280", { width: 1280, height: 800 }]]) {
      const r = await nav.newContext({ viewport: vp, hasTouch: vp.width < 900, isMobile: vp.width < 900 }); await r.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort()); const q = await r.newPage(); q.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
      const movil = vp.width < 900;
      for (const ruta of ["/", "/panel", "/clientes", "/conceptos", "/config", "/usuarios", "/plan", "/nueva"]) {
        await q.goto(srv.url + "/#" + ruta); await q.waitForTimeout(500);
        const g = await q.evaluate(() => { const vis = (e) => { const c = getComputedStyle(e), b = e.getBoundingClientRect(); return c.display !== "none" && c.visibility !== "hidden" && b.width > 0 && b.height > 0; };
          const els = [...document.querySelectorAll("button,a.nv,a.btn,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea")].filter(vis).filter((e) => !e.matches('select[aria-label="Persona de la demostración"]'));   // el selector de personas solo existe en el modo de pruebas
          return { desborde: document.documentElement.scrollWidth > innerWidth + 1, chicos: innerWidth < 900 ? els.filter((e) => e.getBoundingClientRect().height < 40).map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 30)) : [], fuente: innerWidth < 900 ? els.filter((e) => /INPUT|SELECT|TEXTAREA/.test(e.tagName) && parseFloat(getComputedStyle(e).fontSize) < 16).length : 0 }; });
        assert.equal(g.desborde, false, `${nom} ${ruta}: desborde horizontal`); assert.deepEqual(g.chicos, [], `${nom} ${ruta}: objetivos táctiles menores de 40 px: ${g.chicos.join(" | ")}`); assert.equal(g.fuente, 0, `${nom} ${ruta}: campos con fuente menor de 16 px (el navegador haría zoom)`);
      }
      await q.goto(srv.url + "/#/nueva"); await esperarNueva(q); await elegirReceptor(q); await q.selectOption('select[aria-label="Establecimiento"]', { index: 1 });
      assert.equal(await q.locator("#fab-agregar").count(), 0, `${nom}: ya no hay botón flotante «+»`);
      await q.click("#agregar-item"); await q.waitForSelector(".hoja-item");
      assert.deepEqual(await q.locator('.hoja-item input[aria-label^="Cantidad"],.hoja-item input[aria-label^="Precio"]').evaluateAll((l) => l.map((e) => e.getAttribute("inputmode"))), ["decimal", "decimal"], `${nom}: teclado numérico en cantidad y precio`);
      const hoja = await q.locator(".hoja-item").boundingBox(); assert.ok(hoja.x >= 0 && hoja.x + hoja.width <= vp.width + 1 && hoja.y >= 0 && hoja.y + hoja.height <= vp.height + 1, `${nom}: la hoja de edición cabe en la pantalla`);
      // captura rápida: 5 ítems seguidos con «Agregar y otro» y Intro
      for (let i = 1; i <= 4; i++) { await q.fill('.hoja-item [aria-label="Descripción"]', `Ítem ${i}`); await q.keyboard.press("Enter"); await q.keyboard.press("Enter"); await q.keyboard.type("10"); await q.keyboard.press("Enter"); }
      await q.fill('.hoja-item [aria-label="Descripción"]', "Ítem 5"); await q.fill('.hoja-item [aria-label="Precio unitario (Q)"]', "10"); await q.click("#ed-guardar"); await q.waitForSelector(".hoja-item", { state: "detached" });
      assert.equal(await q.locator("button.it").count(), 5, `${nom}: cinco ítems capturados seguidos`);
      if (movil) {
        await q.setViewportSize({ width: vp.width, height: 330 });   // teclado virtual abierto (≈ mitad de la pantalla)
        await q.click("#agregar-item"); await q.waitForSelector(".hoja-item"); await q.locator('.hoja-item [aria-label="Precio unitario (Q)"]').click(); await q.waitForTimeout(300);
        const visible = await q.evaluate(() => { const b = document.activeElement.getBoundingClientRect(), pie = document.querySelector(".hoja-item .modal-pie").getBoundingClientRect(); return b.top >= 0 && b.bottom <= pie.top + 1; }); assert.equal(visible, true, `${nom}: con teclado virtual el campo activo no queda tapado por los botones de la hoja`);
        await q.click("#ed-cancelar"); await q.setViewportSize(vp);
        // la barra de acciones no se superpone con la navegación inferior ni consigo misma; el menú «Más acciones» cabe en la pantalla
        await q.evaluate(() => window.scrollTo(0, 0)); await q.waitForTimeout(150);
        const caj = await q.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { barra: r(".barra-acciones"), nav: r(".nav-movil"), prim: r(".barra-acciones > .btn"), mas: r("#mas-acciones") }; });
        assert.ok(caj.barra.b <= caj.nav.t + 1, `${nom}: la barra de acciones queda sobre la navegación inferior (${caj.barra.b} ≤ ${caj.nav.t})`); assert.ok(caj.prim.r <= caj.mas.l + 1 || caj.mas.r <= caj.prim.l + 1 || caj.prim.b <= caj.mas.t + 1 || caj.mas.b <= caj.prim.t + 1, `${nom}: la acción principal y «Más acciones» no se superponen`);
        await q.click("#mas-acciones"); const mn = await q.locator(".menu-mas").boundingBox(); assert.ok(mn.x >= 0 && mn.x + mn.width <= vp.width + 1 && mn.y >= 0, `${nom}: el menú «Más acciones» cabe en la pantalla`); await q.keyboard.press("Escape");
      }
      await r.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log("ACCESO ANTICIPADO E2E OK");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
