// Autollenado del receptor en el NAVEGADOR (Nueva factura y Clientes): NIT ficticio del simulador, «Consultando NIT», sin consulta por tecla, cambios rápidos, sin coincidencia, error del proveedor,
// nombre escrito a mano conservado, y CONSUMIDOR FINAL (CF) con su tope. Servidor real en modo con inicio de sesión (Digifact apagado → simulador con datos FICTICIOS).
// Uso: node e2e_receptor.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
function arrancar() {
  const puerto = 9000 + Math.floor(Math.random() * 400);
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
const A = "10000011", NOM_A = "CONTRIBUYENTE DE PRUEBA UNO, S.A.", B = "10000038", NOM_B = "PERSONA DE PRUEBA TRES";
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    const nuevoCtx = async (w, h) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), locale: "es-GT" }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const ID = 'input[aria-label="Identificación del receptor"]', NOM = 'input[aria-label="Nombre del receptor"]', TIPO = 'select[aria-label="Tipo de identificación"]', EST = ".nit-estado";
    const teclear = async (p, sel, texto) => { await p.fill(sel, ""); await p.locator(sel).pressSequentially(texto, { delay: 40 }); };

    // ================= Nueva factura (390 px)
    const { p } = await nuevoCtx(390, 844); await entrar(p);
    const peticiones = []; p.on("request", (r) => { if (r.url().includes("/api/receptores/nit")) peticiones.push(JSON.parse(r.postData() || "{}").nit); });
    let demora = 700; await p.route("**/api/receptores/nit", async (r) => { await new Promise((x) => setTimeout(x, demora)); await r.continue(); });
    await p.goto(srv.url + "/#/nueva"); await p.waitForSelector('select[aria-label="Receptor"]'); await p.check('input[aria-label="Receptor nuevo"]'); await p.selectOption(TIPO, "NIT");
    // NIT válido: sin consulta por tecla, «Consultando NIT…» y nombre completado; la advertencia va aparte, no dentro del nombre
    await teclear(p, ID, A); assert.equal(peticiones.length, 0, "no consulta mientras se escribe"); await p.waitForSelector(`${EST}:has-text("Consultando NIT")`);
    await p.waitForFunction((s) => document.querySelector(s).value !== "", NOM); assert.equal(await p.inputValue(NOM), NOM_A); assert.deepEqual(peticiones, [A], "una sola consulta (sin una por tecla)");
    assert.match(await p.locator(EST).innerText(), /simulado.*no proviene de SAT/i); assert.doesNotMatch(await p.inputValue(NOM), /DEMO|simulad/i);
    await sinDesborde(p, "NIT consultado");
    // cambios rápidos: la respuesta de la primera consulta no pisa la del NIT final
    demora = 900; peticiones.length = 0; await teclear(p, ID, B); await p.waitForTimeout(700); await teclear(p, ID, A); await p.waitForTimeout(700); await teclear(p, ID, B);
    await p.waitForFunction(([s, v]) => document.querySelector(s).value === v, [NOM, NOM_B]); await p.waitForTimeout(1500); assert.equal(await p.inputValue(NOM), NOM_B, "gana el último NIT escrito");
    // sin coincidencia y error del proveedor: mensaje claro y entrada manual
    demora = 50; await teclear(p, ID, "99900025"); await p.waitForSelector(`${EST}:has-text("No se encontró este NIT")`); assert.equal(await p.inputValue(NOM), "", "no se inventa un nombre"); await p.fill(NOM, "Escrito a mano"); assert.equal(await p.inputValue(NOM), "Escrito a mano");
    await teclear(p, ID, "99900017"); await p.waitForSelector(`${EST}:has-text("No se pudo consultar")`); assert.equal(await p.inputValue(NOM), "Escrito a mano", "el error no toca lo escrito"); await sinDesborde(p, "error del proveedor");
    // nombre escrito a mano: nunca se sobrescribe
    await p.fill(ID, ""); await p.fill(NOM, "Nombre de la casa"); await teclear(p, ID, A); await p.waitForSelector(`${EST}:has-text("Se conservó el nombre")`); assert.equal(await p.inputValue(NOM), "Nombre de la casa");
    // CF: «c f», «Cf», «CF»: se normaliza, CONSUMIDOR FINAL, sin consulta
    peticiones.length = 0; for (const v of ["c f", "Cf", " cf ", "CF"]) { await p.fill(ID, v); await p.waitForTimeout(150); assert.equal(await p.inputValue(ID), "CF", `«${v}» se normaliza`); assert.equal(await p.inputValue(NOM), "CONSUMIDOR FINAL"); assert.equal(await p.inputValue(TIPO), "CF"); }
    assert.equal(await p.locator(NOM).evaluate((e) => e.readOnly), true, "el nombre de CF no se edita"); await p.waitForTimeout(900); assert.deepEqual(peticiones, [], "CF no consulta nada"); assert.match(await p.locator(EST).innerText(), /Consumidor final.*Q 2,500\.00/); await sinDesborde(p, "CF");
    // CF → NIT: sin datos del receptor anterior; y de vuelta a CF se restaura el nombre
    await teclear(p, ID, A); assert.equal(await p.inputValue(TIPO), "NIT"); await p.waitForFunction((s) => document.querySelector(s).value.startsWith("CONTRIBUYENTE"), NOM); assert.equal(await p.inputValue(NOM), NOM_A);
    await p.fill(ID, "cf"); assert.equal(await p.inputValue(NOM), "CONSUMIDOR FINAL"); await p.selectOption(TIPO, "NIT"); assert.equal(await p.inputValue(ID), ""); assert.equal(await p.inputValue(NOM), "", "de CF a NIT por el selector: campos vacíos");
    // CF en la factura: tope de Q2,500.00 (SAT) y guardado normalizado
    await p.fill(ID, "cf"); await p.selectOption('select[aria-label="Establecimiento"]', { index: 1 });
    await p.click("#agregar-item"); await p.fill('.hoja-item [aria-label="Descripción"]', "Servicio caro"); await p.fill('.hoja-item [aria-label="Precio unitario (Q)"]', "2500"); await p.click("#ed-guardar"); await p.waitForSelector(".hoja-item", { state: "detached" });
    await p.click("#guardar"); await p.waitForSelector(".validacion"); assert.match(await p.locator(".validacion").innerText(), /Consumidor final solo se admite en facturas menores a Q2,500\.00/); assert.match(p.url(), /#\/nueva$/, "no se guardó");
    await p.click('button.it[data-linea="1"]'); await p.fill('.hoja-item [aria-label="Precio unitario (Q)"]', "2499.99"); await p.click("#ed-guardar"); await p.waitForSelector(".hoja-item", { state: "detached" });
    await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); const id = p.url().split("/").pop();
    const det = await p.evaluate(async (i) => (await fetch(`/api/documentos/${i}`, { headers: { "x-demo": "1" } })).json(), id); assert.equal(det.documento.cliente_nombre, "CONSUMIDOR FINAL"); assert.equal(det.documento.cliente_numero, "CF");

    // ================= Clientes: autollenado, CF y sin botón manual
    await p.goto(srv.url + "/#/clientes"); await p.waitForSelector("#nuevo-cliente"); await p.click("#nuevo-cliente"); await p.waitForSelector(".modal");
    assert.equal(await p.locator("#consultar-nit").count(), 0, "el botón manual de consulta ya no existe");
    const IDC = 'input[aria-label="Identificación del cliente"]', NOMC = 'input[aria-label="Nombre del cliente"]';
    await teclear(p, IDC, A); await p.waitForFunction((s) => document.querySelector(s).value !== "", NOMC); assert.equal(await p.inputValue(NOMC), NOM_A); assert.match(await p.locator(".modal .nit-estado").innerText(), /simulado/i);
    await p.fill(IDC, "c f"); assert.equal(await p.inputValue(IDC), "CF"); assert.equal(await p.inputValue(NOMC), "CONSUMIDOR FINAL"); assert.equal(await p.locator("#guardar-cliente").isDisabled(), true, "CF no se registra como cliente"); assert.match(await p.locator(".modal .nit-estado").innerText(), /no se registra como cliente/);
    await teclear(p, IDC, B); assert.equal(await p.locator("#guardar-cliente").isDisabled(), false); await p.waitForFunction((s) => document.querySelector(s).value === "PERSONA DE PRUEBA TRES", NOMC); await p.keyboard.press("Escape");

    // ================= sin desbordes ni solapamientos en el bloque del receptor a 320 / 360 / 390 / 430 px
    for (const w of [320, 360, 390, 430]) {
      const { c, p: q } = await nuevoCtx(w, 800); await entrar(q); await q.goto(srv.url + "/#/nueva"); await q.waitForSelector('select[aria-label="Receptor"]'); await q.check('input[aria-label="Receptor nuevo"]'); await q.selectOption(TIPO, "NIT");
      await teclear(q, ID, A); await q.waitForFunction((s) => document.querySelector(s).value !== "", NOM); await sinDesborde(q, `${w}px con nombre autollenado`);
      const caja = await q.evaluate(([i, n, e]) => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { id: r(i), n: r(n), e: r(e) }; }, [ID, NOM, EST]);
      assert.ok(caja.id.b <= caja.e.t + 1 && caja.e.b <= caja.n.t + 1, `${w}px: identificación, mensaje y nombre en orden y sin solaparse`); assert.ok(caja.n.r <= w + 1 && caja.id.r <= w + 1, `${w}px: los campos caben`);
      await q.fill(ID, "cf"); await sinDesborde(q, `${w}px con CF`); await c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`RECEPTOR E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
