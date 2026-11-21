// Autollenado del receptor en el NAVEGADOR (Nueva factura y Clientes): NIT ficticio del simulador, «Consultando NIT», sin consulta por tecla, cambios rápidos, sin coincidencia, error del proveedor,
// nombre escrito a mano conservado, y CONSUMIDOR FINAL (CF) con su tope. Servidor real en modo con inicio de sesión (Digifact apagado → simulador con datos FICTICIOS).
// Uso: node e2e_receptor.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const { esperarNueva, elegirTipo, tipoActual, escribirNombre } = require("./ayudas_nueva.cjs");
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
const A = "10000011", NOM_A = "CONTRIBUYENTE DE PRUEBA UNO, S.A.", B = "10000038", NOM_B = "PERSONA DE PRUEBA TRES";
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    const nuevoCtx = async (w, h) => { const c = await nav.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), locale: "es-GT" }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const ID = 'input[aria-label="Identificación del receptor"]', NOM = '[aria-label="Nombre del receptor"]', TIPO = 'select[aria-label="Tipo de identificación"]', EST = ".nit-estado";
    const esperarValor = async (p, sel, ok, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await p.inputValue(sel); if (ok(v)) return v; if (Date.now() - t0 > ms) throw new Error(`valor de ${sel} no llegó: «${v}»`); await p.waitForTimeout(100); } };   // sin waitForFunction: la CSP de la página (script-src 'self') prohíbe eval
    const ETQ = async (p) => (await p.locator(".nit-etiqueta:not([hidden])").allInnerTexts()).map((t) => t.trim()); const teclear = async (p, sel, texto) => { await p.fill(sel, ""); await p.locator(sel).pressSequentially(texto, { delay: 40 }); };

    // ================= Nueva factura (390 px)
    const { p } = await nuevoCtx(390, 844); await entrar(p);
    const peticiones = []; p.on("request", (r) => { if (r.url().includes("/api/receptores/nit")) peticiones.push(JSON.parse(r.postData() || "{}").nit); });
    let demora = 700; await p.route("**/api/receptores/nit", async (r) => { await new Promise((x) => setTimeout(x, demora)); await r.continue(); });
    await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirTipo(p, "NIT");
    // NIT válido: sin consulta por tecla, «Consultando NIT…» y nombre completado; la advertencia va aparte, no dentro del nombre
    await teclear(p, ID, A); assert.equal(peticiones.length, 0, "no consulta mientras se escribe"); await p.waitForSelector(`${EST}:has-text("Consultando NIT")`, { timeout: 8000 }).catch(async (e) => { console.log("DIAGNÓSTICO autollenado:", JSON.stringify({ navegador: NAV, id: await p.inputValue(ID), tipo: await tipoActual(p), estado: await p.locator(EST).allInnerTexts(), peticiones, errores })); throw e; });
    await esperarValor(p, NOM, (v) => v !== ""); assert.equal(await p.inputValue(NOM), NOM_A); assert.deepEqual(peticiones, [A], "una sola consulta (sin una por tecla)");
    assert.match(await p.locator(EST).innerText(), /simulados.*no provienen de SAT/i); assert.deepEqual(await ETQ(p), ["Datos simulados"], "etiqueta de origen: datos simulados"); assert.doesNotMatch(await p.inputValue(NOM), /DEMO|simulad/i);
    await sinDesborde(p, "NIT consultado");
    // cambios rápidos: la respuesta de la primera consulta no pisa la del NIT final
    demora = 900; peticiones.length = 0; await teclear(p, ID, B); await p.waitForTimeout(700); await teclear(p, ID, A); await p.waitForTimeout(700); await teclear(p, ID, B);
    await esperarValor(p, NOM, (v) => v === NOM_B); await p.waitForTimeout(1500); assert.equal(await p.inputValue(NOM), NOM_B, "gana el último NIT escrito");
    // sin coincidencia y error del proveedor: mensaje claro y entrada manual
    demora = 50; await teclear(p, ID, "99900025"); await p.waitForSelector(`${EST}:has-text("No se encontró este NIT")`); assert.equal(await p.inputValue(NOM), "", "no se inventa un nombre"); await escribirNombre(p, "Escrito a mano"); assert.equal(await p.inputValue(NOM), "Escrito a mano"); assert.deepEqual(await ETQ(p), ["Ingreso manual"], "etiqueta de origen: ingreso manual");
    await teclear(p, ID, "99900017"); await p.waitForSelector(`${EST}:has-text("No se pudo consultar")`); assert.equal(await p.inputValue(NOM), "Escrito a mano", "el error no toca lo escrito"); await sinDesborde(p, "error del proveedor");
    // nombre escrito a mano: nunca se sobrescribe
    await p.fill(ID, ""); await escribirNombre(p, "Nombre de la casa"); await teclear(p, ID, A); await p.waitForSelector(`${EST}:has-text("Se conservó el nombre")`); assert.equal(await p.inputValue(NOM), "Nombre de la casa");
    // CF: «c f», «Cf», «CF»: se normaliza, CONSUMIDOR FINAL, sin consulta
    peticiones.length = 0; for (const v of ["c f", "Cf", " cf ", "CF"]) { await p.fill(ID, v); await p.waitForTimeout(150); assert.equal(await p.inputValue(ID), "CF", `«${v}» se normaliza`); assert.equal(await p.inputValue(NOM), "CONSUMIDOR FINAL"); assert.deepEqual(await ETQ(p), ["Consumidor final"], "etiqueta de origen: consumidor final"); assert.equal(await tipoActual(p), "CF"); }
    assert.equal(await p.locator(NOM).evaluate((e) => e.readOnly), true, "el nombre de CF no se edita"); await p.waitForTimeout(900); assert.deepEqual(peticiones, [], "CF no consulta nada"); assert.match(await p.locator(EST).innerText(), /Consumidor final.*Q 2,500\.00/); await sinDesborde(p, "CF");
    // CF → NIT: sin datos del receptor anterior; y de vuelta a CF se restaura el nombre
    await teclear(p, ID, A); assert.equal(await tipoActual(p), "NIT"); await esperarValor(p, NOM, (v) => v.startsWith("CONTRIBUYENTE")); assert.equal(await p.inputValue(NOM), NOM_A);
    await p.fill(ID, "cf"); assert.equal(await p.inputValue(NOM), "CONSUMIDOR FINAL"); await elegirTipo(p, "NIT"); assert.equal(await p.inputValue(ID), ""); assert.equal(await p.inputValue(NOM), "", "de CF a NIT por el selector: campos vacíos");
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
    await teclear(p, IDC, A); await esperarValor(p, NOMC, (v) => v !== ""); assert.equal(await p.inputValue(NOMC), NOM_A); assert.match(await p.locator(".modal .nit-estado").innerText(), /simulados/i);
    await p.fill(IDC, "c f"); assert.equal(await p.inputValue(IDC), "CF"); assert.equal(await p.inputValue(NOMC), "CONSUMIDOR FINAL"); assert.equal(await p.locator("#guardar-cliente").isDisabled(), true, "CF no se registra como cliente"); assert.match(await p.locator(".modal .nit-estado").innerText(), /no se registra como cliente/);
    await teclear(p, IDC, B); assert.equal(await p.locator("#guardar-cliente").isDisabled(), false); await esperarValor(p, NOMC, (v) => v === "PERSONA DE PRUEBA TRES"); await p.keyboard.press("Escape");

    // ================= CUI: solo al confirmar (Enter o salir del campo), una consulta, sin cambiar la consulta NIT
    const C1 = "1000000000101", NOM_C1 = "PERSONA FICTICIA DE PRUEBA CUI UNO", C2 = "1000000010101", NOM_C2 = "PERSONA FICTICIA DE PRUEBA CUI DOS", C_ERR = "9990000000101";
    await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirTipo(p, "CUI");
    const pCui = []; const alPedir = (r) => { if (r.url().includes("/api/receptores/cui")) pCui.push(JSON.parse(r.postData() || "{}").cui); }; p.on("request", alPedir); peticiones.length = 0; demora = 50;
    assert.equal(await p.locator(ID).getAttribute("inputmode"), "numeric", "CUI: teclado numérico"); assert.equal(await p.locator(ID).getAttribute("enterkeyhint"), "next");
    await teclear(p, ID, C1); await p.waitForTimeout(1200); assert.equal(pCui.length, 0, "el CUI no se consulta mientras se escribe ni por pausa");
    await p.locator(ID).press("Enter"); await esperarValor(p, NOM, (v) => v !== ""); assert.equal(await p.inputValue(NOM), NOM_C1); assert.deepEqual(pCui, [C1], "una sola consulta al confirmar");
    assert.deepEqual(await ETQ(p), ["Datos simulados"]); assert.match(await p.locator(EST).innerText(), /simulados.*no provienen de SAT/i); assert.doesNotMatch(await p.inputValue(NOM), /DEMO|simulad/i); await sinDesborde(p, "CUI consultado");
    await p.locator(NOM).evaluate((e) => e === document.activeElement || (e.focus(), true)); assert.equal(await p.evaluate((s) => document.activeElement === document.querySelector(s), NOM), true, "Enter deja el foco en el nombre");
    // salir del campo también confirma; el nombre escrito a mano no se pisa
    pCui.length = 0; await escribirNombre(p, ""); await teclear(p, ID, C2); await p.locator(NOM).click(); await esperarValor(p, NOM, (v) => v !== ""); assert.equal(await p.inputValue(NOM), NOM_C2); assert.deepEqual(pCui, [C2]);
    pCui.length = 0; await escribirNombre(p, "Nombre de la casa"); await teclear(p, ID, C1); await p.locator(ID).press("Enter"); await p.waitForSelector(`${EST}:has-text("Se conservó el nombre")`); assert.equal(await p.inputValue(NOM), "Nombre de la casa");
    // CUI inválido: validación local, sin consulta; sin coincidencia y error del proveedor: ingreso manual
    pCui.length = 0; await escribirNombre(p, ""); await teclear(p, ID, "12345"); await p.locator(ID).press("Enter"); await p.waitForSelector(`${EST}:has-text("13 dígitos")`); assert.deepEqual(pCui, [], "un CUI inválido no se consulta");
    await teclear(p, ID, "9990000010101"); await p.locator(ID).press("Enter"); await p.waitForSelector(`${EST}:has-text("No se encontró este CUI")`); assert.equal(await p.inputValue(NOM), "", "no se inventa un nombre");
    await escribirNombre(p, "Escrito a mano"); assert.deepEqual(await ETQ(p), ["Ingreso manual"]);
    await teclear(p, ID, C_ERR); await p.locator(ID).press("Enter"); await p.waitForSelector(`${EST}:has-text("No se pudo consultar")`); assert.equal(await p.inputValue(NOM), "Escrito a mano", "el error no toca lo escrito"); await sinDesborde(p, "error del CUI");
    assert.deepEqual(peticiones, [], "ninguna consulta de NIT por usar CUI"); p.off("request", alPedir);
    // Clientes: CUI al salir del campo, teclado numérico y 13 dígitos al guardar
    await p.goto(srv.url + "/#/clientes"); await p.waitForSelector("#nuevo-cliente"); await p.click("#nuevo-cliente"); await p.waitForSelector(".modal"); await p.selectOption(`.modal ${TIPO}`, "CUI");
    assert.equal(await p.locator(`.modal ${IDC}`).getAttribute("inputmode"), "numeric"); await teclear(p, IDC, C2); await p.locator(`.modal ${NOMC}`).click(); await esperarValor(p, NOMC, (v) => v !== ""); assert.equal(await p.inputValue(NOMC), NOM_C2); assert.match(await p.locator(".modal .nit-estado").innerText(), /simulados/i);
    await p.keyboard.press("Escape");

    // ================= sin desbordes ni solapamientos en el bloque del receptor a 320 / 360 / 390 / 430 px
    for (const w of [320, 360, 390, 430]) {
      const { c, p: q } = await nuevoCtx(w, 800); await entrar(q); await q.goto(srv.url + "/#/nueva"); await esperarNueva(q); await elegirTipo(q, "NIT");
      await teclear(q, ID, A); await esperarValor(q, NOM, (v) => v !== ""); await sinDesborde(q, `${w}px con nombre autollenado`);
      const caja = await q.evaluate(([i, n, e]) => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { id: r(i), n: r(n), e: r(e) }; }, [ID, ".rc-card .rc-l1", EST]);   // el nombre confirmado se ve como texto: se mide la fila del nombre
      assert.ok(caja.id.b <= caja.n.t + 1 && caja.n.b <= caja.e.t + 1, `${w}px: identificación, nombre y mensaje en orden y sin solaparse`); assert.ok(caja.n.r <= w + 1 && caja.id.r <= w + 1, `${w}px: los campos caben`);
      await q.fill(ID, "cf"); await sinDesborde(q, `${w}px con CF`);
      await elegirTipo(q, "CUI"); await teclear(q, ID, C1); await q.locator(ID).press("Enter"); await esperarValor(q, NOM, (v) => v !== ""); await sinDesborde(q, `${w}px con CUI autollenado`); await c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`RECEPTOR E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
