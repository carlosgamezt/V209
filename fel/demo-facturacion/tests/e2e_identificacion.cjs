// Identificación del receptor en el NAVEGADOR (360, 390, 412 y 1100 px, táctil en teléfonos): CF (nombre editable, identificación fija), NIT, CUI y EXTRANJERO/pasaporte («Otro»): ninguna identificación se convierte en otra, el pasaporte no se confunde con un CUI y,
// si no hay consulta, el nombre se escribe a mano sin inventar nada. Servidor real + PostgreSQL (PGlite), simulado y local. Uso: node tests/e2e_identificacion.cjs

const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva, tipoActual, elegirTipo, escribirNombre, ID, NOMBRE } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó:\n" + s)); }, 120000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); hijo.on("exit", (c) => { if (c) mal(new Error(`servidor terminó ${c}:\n${s}`)); }); });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    for (const [w, h] of [[360, 740], [390, 844], [412, 915], [1100, 800]]) {
      const donde = `${w}px`, c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`));
      const consultas = []; p.on("request", (r) => { if (/\/api\/receptores\//.test(r.url())) consultas.push(r.url().replace(srv.url, "")); });
      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
      const toque = (sel) => (w < 900 ? p.tap(sel) : p.click(sel)), nueva = async () => { await p.goto(srv.url + "/#/"); await p.waitForSelector(".cab-demo"); await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); consultas.length = 0; };
      const sinDesborde = async (d) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desborde horizontal en ${d}: ${a} > ${v}`); };

      // ---- CF: nombre predeterminado, se escribe encima al tocar, vacío = predeterminado, la identificación es fija y nunca pasa a NIT/CUI
      await nueva(); await elegirTipo(p, "CF"); const nom = p.locator(NOMBRE);
      assert.match((await nom.inputValue()).toUpperCase(), /CONSUMIDOR FINAL/, `${donde}: CF → «Consumidor Final»`); assert.equal(await p.locator(ID).evaluate((e) => e.readOnly), true, `${donde}: la identificación CF es fija`);
      await toque(NOMBRE); await p.keyboard.type("Ana Gómez"); assert.equal(await nom.inputValue(), "Ana Gómez", `${donde}: lo escrito reemplaza el texto anterior, sin borrar a mano`);
      await p.locator(ID).click({ force: true }).catch(() => {}); await p.keyboard.type("123456"); assert.equal(await p.inputValue(ID), "CF", `${donde}: escribir en la identificación de CF no cambia nada`); assert.equal(await tipoActual(p), "CF");
      await toque(NOMBRE); await p.keyboard.press("Control+A"); await p.keyboard.press("Delete"); await p.locator("body").click({ position: { x: 5, y: 5 } }); assert.match((await nom.inputValue()).toUpperCase(), /CONSUMIDOR FINAL/, `${donde}: vacío vuelve a «Consumidor Final»`); assert.equal(await tipoActual(p), "CF");
      assert.deepEqual(consultas, [], `${donde}: CF no consulta nada`); await sinDesborde(`CF ${donde}`);

      // ---- EXTRANJERO / pasaporte («Otro»): sin consulta automática; el nombre se escribe a mano; 13 dígitos NO lo vuelven CUI
      await nueva(); await elegirTipo(p, "EXT"); assert.equal(await tipoActual(p), "EXT");
      await p.fill(ID, "AB1234567"); await p.waitForTimeout(700); assert.equal(await tipoActual(p), "EXT", `${donde}: el pasaporte sigue siendo «Otro»`); assert.equal(await p.inputValue(ID), "AB1234567");
      await p.waitForSelector(NOMBRE, { state: "visible" }); assert.equal(await p.inputValue(NOMBRE), "", `${donde}: no se inventa un nombre para el pasaporte`); await escribirNombre(p, "Persona Extranjera de Prueba"); assert.equal(await p.inputValue(NOMBRE), "Persona Extranjera de Prueba");
      await p.fill(ID, "2000000000101"); await p.waitForTimeout(900); assert.equal(await tipoActual(p), "EXT", `${donde}: 13 dígitos en «Otro» NO se convierten en CUI`); assert.deepEqual(consultas, [], `${donde}: «Otro» nunca consulta NIT ni CUI`);
      await sinDesborde(`EXT ${donde}`);

      // ---- NIT: 13 dígitos sugieren elegir CUI pero NO cambian el tipo; un NIT sin consulta real deja escribir el nombre y lo dice claro
      await nueva(); await elegirTipo(p, "NIT"); await p.fill(ID, "2000000000101"); await p.waitForTimeout(900); assert.equal(await tipoActual(p), "NIT", `${donde}: 13 dígitos en NIT NO cambian el tipo solos`);
      assert.match(await p.locator(".nit-estado").first().innerText().catch(() => ""), /CUI/, `${donde}: se sugiere elegir CUI`);
      await p.fill(ID, "99900025"); await p.waitForSelector(".nit-estado:has-text('no está habilitada'), .nit-estado:has-text('No se pudo')", { timeout: 8000 }); assert.equal(await p.inputValue(NOMBRE), "", `${donde}: NIT sin consulta: no se inventa un nombre`); await escribirNombre(p, "Escrito a mano"); assert.equal(await p.inputValue(NOMBRE), "Escrito a mano");
      // ---- CUI: 13 dígitos, sin consulta real → mensaje claro y nombre manual; el CUI no pasa a otro tipo
      await nueva(); await elegirTipo(p, "CUI"); await p.fill(ID, "2000000000101"); await p.locator(ID).press("Enter"); await p.waitForSelector(".nit-estado:has-text('no está habilitada')", { timeout: 8000 }); assert.equal(await tipoActual(p), "CUI"); assert.equal(await p.inputValue(NOMBRE), "", `${donde}: CUI sin consulta: no se inventa un nombre`);
      await c.close();
    }
    assert.deepEqual(errores, [], "sin errores de JavaScript: " + errores.join(" | "));
    console.log("OK e2e_identificacion: CF (nombre editable, identificación fija), pasaporte/«Otro» manual sin confundirse con CUI, NIT y CUI sin consulta real con mensaje claro y nombre manual (360, 390, 412 y 1100 px)");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
