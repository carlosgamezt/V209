// Rediseño móvil de «Nueva factura», etapas 1 y 2: marco (encabezado de 48 px, franja de simulación de una línea, menú de la cuenta, navegación de 56 px) y receptor inteligente
// (tipo NIT · CUI · CF · Otro, clientes Existentes frente a Nuevos, autollenado por el servidor sin cambios), «Vista previa» junto al título, «Marcar revisado» sin certificar y distribución a 320 / 360 / 390 / 430 px
// con importes grandes. Servidor real + PostgreSQL (PGlite), todo simulado y local.
// Uso: node e2e_rediseno.cjs [carpeta-de-capturas]   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const { esperarNueva, elegirTipo, tipoActual, elegirReceptor, escribirNombre, ID, NOMBRE } = require("./ayudas_nueva.cjs");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV], capturas = process.argv[2] ? path.resolve(process.argv[2]) : null; if (capturas) fs.mkdirSync(capturas, { recursive: true });
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
    const ctxMovil = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, ...(NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u = "ana") => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (a > v + 1) { const mal = await p.evaluate((v) => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > v + 1).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`), v); assert.fail(`desplazamiento horizontal en ${donde}: ${a} > ${v} (${mal.join(", ")})`); } };
    const foto = async (p, n) => { if (capturas) await p.screenshot({ path: path.join(capturas, n) }); };
    const altura = (p, s) => p.locator(s).evaluate((e) => e.getBoundingClientRect().height);
    const toast = (p, t) => p.waitForSelector(`#toasts >> text=${t}`, { timeout: 8000 });
    const borrador = (p, precio = "100", cantidad = "2") => p.evaluate(async ([precio, cantidad]) => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio con una descripción bastante larga para comprobar que se ajusta a dos líneas sin romper la fila", cantidad, precio_unitario: precio }] });
      if (!d.documento) throw new Error("no se creó el borrador: " + JSON.stringify(d).slice(0, 200)); return d.documento.id;
    }, [precio, cantidad]);

    // ================= ETAPA 1 · marco a 390 px
    const { p } = await ctxMovil(390); await entrar(p);
    const pet = []; p.on("request", (r) => { if (r.method() === "POST" && /\/api\/receptores\/(nit|cui)$/.test(r.url())) pet.push(r.url().split("/").pop()); });
    await p.goto(`${srv.url}/#/nueva`); await esperarNueva(p); await p.waitForTimeout(300);
    const cab = await altura(p, ".cab-fila"), banda = await altura(p, ".banda-simulado"), navH = await altura(p, ".nav-movil");
    assert.ok(Math.abs(cab - 48) <= 1, `encabezado de 48 px (${cab})`); assert.ok(banda >= 21 && banda <= 24, `franja de una línea de 22 px (${banda})`); assert.ok(navH >= 56 && navH <= 60, `navegación de 56 px (${navH})`);
    assert.match(await p.locator(".banda-simulado").innerText(), /SIMULADO - SIN VALOR FISCAL/); assert.equal(await p.locator(".cab-marca").isVisible(), true); assert.equal(await p.locator(".cab-der").isHidden(), true, "sin la fila de empresa/usuario/campana del encabezado de PC");
    assert.deepEqual((await p.locator(".nav-movil > a").allInnerTexts()).map((t) => t.trim()), ["Panel", "Nueva", "Facturas", "Clientes"], "cuatro accesos con etiqueta corta + «Más»"); assert.equal(await p.locator("#nav-mas").count(), 1);
    assert.equal(await p.locator('.nav-movil a[aria-current="page"]').getAttribute("aria-label"), "Nueva factura", "el acceso activo conserva su nombre completo para lectores de pantalla");
    await foto(p, "m1-marco-vacio.png");
    // menú de la cuenta: nombre, empresa, DEMO, pendientes y «Cerrar sesión»; se cierra tocando fuera y con Escape; objetivo táctil ≥ 40 px
    assert.ok((await altura(p, "#menu-cuenta")) >= 40, "avatar táctil"); await p.click("#menu-cuenta"); await p.waitForSelector(".menu-cuenta:not([hidden])");
    const mc = await p.locator(".menu-cuenta").innerText(); assert.match(mc, /Ana Torres/); assert.match(mc, /propietario/); assert.match(mc, /DEMO · datos NO persistentes/); assert.match(mc, /requieren atención/i); assert.match(mc, /Cerrar sesión/);
    await sinDesborde(p, "menú de la cuenta"); await foto(p, "m1b-menu-cuenta.png"); await p.locator(".cab-marca").click({ position: { x: 3, y: 3 } }); await p.waitForSelector(".menu-cuenta", { state: "hidden" });
    await p.click("#menu-cuenta"); await p.keyboard.press("Escape"); await p.waitForSelector(".menu-cuenta", { state: "hidden" });
    assert.equal(await p.locator("#cerrar-sesion-cab").count(), 1, "«Cerrar sesión» vive en el menú de la cuenta");

    // ================= ETAPA 2 · receptor inteligente
    // estado vacío: control segmentado con NIT activo, ayuda y SIN tarjeta; «Vista previa» junto al título
    assert.deepEqual((await p.locator(".seg-tipo [role=radio]").allInnerTexts()).map((t) => t.trim()), ["NIT", "CUI", "CF", "Otro"]); assert.equal(await tipoActual(p), "NIT"); assert.equal(await p.locator(".rc-card").isHidden(), true); assert.equal(await p.locator(".rc-ayuda").isVisible(), true);
    const tit = await p.locator("h1").boundingBox(), vp = await p.locator("#previa-titulo").boundingBox(); assert.ok(Math.abs((tit.y + tit.height / 2) - (vp.y + vp.height / 2)) < 18, "«Vista previa» está en la fila del título"); assert.ok(vp.height >= 40 && vp.x + vp.width <= 391, "visible, táctil y dentro de la pantalla");
    await p.click("#previa-titulo"); await p.waitForSelector(".previa-modal .papel"); await p.keyboard.press("Escape"); await p.waitForSelector(".previa-modal", { state: "detached" });
    assert.equal((await p.locator("#guardar").count()) + (await p.locator(".barra-acciones").count()) > 0, true, "la barra de acciones sigue (etapa 3 pendiente)");
    await foto(p, "m2-nueva-vacia.png");

    // cliente EXISTENTE: se busca por nombre y se toca la sugerencia «Existente»; tarjeta con nombre, etiqueta y «Cambiar»; nada se consulta fuera
    await p.fill(ID, "Comerc"); await p.waitForSelector(".rc-sug .sg-ex"); assert.match(await p.locator(".rc-sug .sg-ex").first().innerText(), /Existente/); await foto(p, "m3-sugerencias.png");
    const cli = await elegirReceptor(p, /Comercial Los Pinos/);
    assert.equal((await p.locator('.rc-card[data-modo="existente"] .tg').innerText()).trim(), "Existente"); assert.match(await p.locator(".rc-card").innerText(), /Comercial Los Pinos/); assert.match(await p.locator(".rc-card .rc-meta").innerText(), /Cliente guardado/); assert.equal(await p.inputValue(ID), cli.numero_identificacion);
    assert.ok((await altura(p, "#receptor-cambiar")) >= 40, "«Cambiar» táctil"); await foto(p, "m4-existente.png"); await sinDesborde(p, "receptor existente");
    // NIT idéntico al de un cliente guardado: se elige sin consultar nada
    await p.click("#receptor-cambiar"); assert.equal(await p.inputValue(ID), ""); assert.equal(await p.locator(".rc-card").isHidden(), true, "«Cambiar» vuelve al estado vacío"); pet.length = 0;
    await p.fill(ID, cli.numero_identificacion); await p.waitForSelector('.rc-card[data-modo="existente"]'); await p.waitForTimeout(900); assert.deepEqual(pet, [], "un identificación guardada no se consulta a Digifact");
    // NUEVO por NIT (autollenado del servidor, igual que antes): una sola consulta, etiqueta «Nuevo»
    await p.click("#receptor-cambiar"); await p.fill(ID, "10000011"); await p.waitForSelector('.rc-card[data-modo="nuevo"] .nit-etiqueta:not([hidden])');
    for (let i = 0; i < 60 && (await p.inputValue(NOMBRE)) === ""; i++) await p.waitForTimeout(150);
    assert.equal(await p.inputValue(NOMBRE), "CONTRIBUYENTE DE PRUEBA UNO, S.A."); assert.equal((await p.locator(".rc-card .tg").innerText()).trim(), "Nuevo"); assert.deepEqual(pet, ["nit"], "una sola consulta de NIT"); assert.match(await p.locator(".rc-card .nit-etiqueta").innerText(), /Datos simulados/);
    assert.equal(await p.locator("#receptor-nombre-ver").isVisible(), true, "el nombre consultado se ve como texto confirmado"); assert.equal(await p.locator(NOMBRE).isHidden(), true, "sin campo de edición a la vista");
    assert.equal(await p.locator("#receptor-nombre-ver").evaluate((e) => getComputedStyle(e).borderTopWidth), "0px", "sin recuadro alrededor del nombre");
    await p.click("#receptor-nombre-ver"); assert.equal(await p.locator(NOMBRE).isVisible(), true, "al tocarlo se puede corregir"); assert.equal(await p.evaluate((s) => document.activeElement === document.querySelector(s), NOMBRE), true);
    const altoTexto = await p.locator(".rc-l1").evaluate((e) => e.getBoundingClientRect().height); await p.locator(NOMBRE).blur(); assert.equal(Math.round(await p.locator(".rc-l1").evaluate((e) => e.getBoundingClientRect().height)), Math.round(altoTexto), "editar y salir no cambia la altura (un toque siguiente nunca se pierde)");
    assert.equal(await p.inputValue(NOMBRE), "CONTRIBUYENTE DE PRUEBA UNO, S.A.", "tocar y salir sin cambios conserva el nombre");
    await foto(p, "m5-nuevo-nit.png"); await sinDesborde(p, "receptor nuevo por NIT");
    // NUEVO por CUI: solo al confirmar (Enter)
    pet.length = 0; await elegirTipo(p, "CUI"); assert.equal(await tipoActual(p), "CUI"); assert.equal(await p.locator(ID).getAttribute("inputmode"), "numeric"); await p.fill(ID, "1000000000101"); await p.waitForTimeout(900); assert.deepEqual(pet, [], "el CUI no se consulta mientras se escribe");
    await p.locator(ID).press("Enter"); for (let i = 0; i < 60 && (await p.inputValue(NOMBRE)) === ""; i++) await p.waitForTimeout(150); assert.equal(await p.inputValue(NOMBRE), "PERSONA FICTICIA DE PRUEBA CUI UNO"); assert.deepEqual(pet, ["cui"], "una sola consulta de CUI");
    assert.equal((await p.locator(".rc-card .tg").innerText()).trim(), "Nuevo"); await p.locator(NOMBRE).blur(); await foto(p, "m6-nuevo-cui.png");
    // CF: sin consulta, nombre fijo y sin etiqueta «Nuevo»
    pet.length = 0; await elegirTipo(p, "CF"); assert.equal(await p.inputValue(ID), "CF"); assert.equal(await p.inputValue(NOMBRE), "CONSUMIDOR FINAL"); assert.equal(await p.locator(NOMBRE).evaluate((e) => e.readOnly), true); assert.equal(await p.locator(".rc-card .tg").isHidden(), true); await p.waitForTimeout(700); assert.deepEqual(pet, [], "CF no consulta nada");
    // «Otro»: ingreso manual
    await elegirTipo(p, "EXT"); assert.equal(await tipoActual(p), "EXT"); await p.fill(ID, "AB1234567"); await p.waitForSelector(NOMBRE); await p.fill(NOMBRE, "Persona extranjera de prueba"); assert.deepEqual(pet, [], "Otro no consulta nada");
    // establecimiento y fecha en una fila; observaciones plegadas
    const e1 = await p.locator('select[aria-label="Establecimiento"]').boundingBox(), e2 = await p.locator('input[aria-label="Fecha de emisión"]').boundingBox(); assert.ok(Math.abs(e1.y - e2.y) < 2, "establecimiento y fecha en una sola fila");
    // fecha SIEMPRE día/mes/año (el valor interno sigue siendo AAAA-MM-DD); establecimiento ya elegido (el principal)
    const vista = await p.locator("#fecha-vista").innerText(), iso = await p.inputValue('input[aria-label="Fecha de emisión"]'); assert.match(vista, /^\d{2}\/\d{2}\/\d{4}$/, `fecha en dd/mm/aaaa: ${vista}`); assert.match(iso, /^\d{4}-\d{2}-\d{2}$/); assert.equal(vista, iso.split("-").reverse().join("/"), "lo mostrado coincide con el valor interno");
    await p.fill('input[aria-label="Fecha de emisión"]', "2026-12-31"); assert.equal((await p.locator("#fecha-vista").innerText()).trim(), "31/12/2026"); await p.fill('input[aria-label="Fecha de emisión"]', iso);
    assert.match(await p.locator('select[aria-label="Establecimiento"] option:checked').innerText(), /^1 · /, "viene elegido el establecimiento principal");
    assert.equal(await p.locator('input[aria-label="Observaciones"]').count(), 0, `observaciones plegadas: ${await p.locator('input[aria-label="Observaciones"]').evaluateAll((l) => l.map((e) => e.outerHTML)).catch(() => "")}`); await p.click("#agregar-observaciones"); await p.waitForSelector('input[aria-label="Observaciones"]');

    // ================= «Marcar revisado» NO certifica: solo cambia la preparación; ninguna operación fiscal ni petición de certificar
    const id = await borrador(p); const posts = []; p.on("request", (r) => { if (r.method() === "POST") posts.push(r.url().replace(srv.url, "")); });
    await p.goto(`${srv.url}/#/f/${id}`); await p.waitForSelector("#revisar"); await p.click("#revisar"); await toast(p, "Marcado como revisado");
    const det = await p.evaluate(async (id) => (await fetch(`/api/documentos/${id}`, { headers: { "x-demo": "1" } })).json(), id);
    assert.equal(det.documento.estado_preparacion, "revisado"); assert.equal(det.documento.estado_fiscal, "ninguno", "sigue sin vida fiscal"); assert.equal(det.operaciones.length, 0, "ninguna operación fiscal"); assert.equal(det.documento.autorizacion_sat, null);
    assert.ok(!posts.some((u) => /certificar|digifact|anular|conciliar|preparar/.test(u)), `solo se pidió cambiar el estado: ${posts.join(", ")}`); assert.ok(posts.some((u) => /\/estado$/.test(u)));

    // ================= distribución a 320 / 360 / 390 / 430 px, con receptor largo e importes grandes
    const GRANDE = "99999999.99";
    const idGrande = await borrador(p, GRANDE, "999");
    for (const w of [320, 360, 390, 430]) {
      const m = await ctxMovil(w, 800); await entrar(m.p);
      await m.p.goto(`${srv.url}/#/nueva`); await esperarNueva(m.p); await sinDesborde(m.p, `${w}px · nueva vacía`);
      await elegirTipo(m.p, "CUI"); await m.p.fill(ID, "1000000000101"); await m.p.locator(ID).press("Enter"); for (let i = 0; i < 60 && (await m.p.inputValue(NOMBRE)) === ""; i++) await m.p.waitForTimeout(150);
      await m.p.locator(NOMBRE).blur(); await foto(m.p, `n${w}-nuevo-cui.png`);
      const fb = await m.p.locator(".fv").boundingBox(), sb = await m.p.locator('select[aria-label="Establecimiento"]').boundingBox(); assert.equal(await m.p.locator(".fv").evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.querySelector(".fv-t").getBoundingClientRect().right <= e.querySelector(".fv-i").getBoundingClientRect().left + 1), true, `${w}px: la fecha dd/mm/aaaa cabe sin recortarse (${Math.round(fb.width)} px)`); assert.ok(sb.width >= 110, `${w}px: el establecimiento es legible (${Math.round(sb.width)} px)`); { const med = await m.p.locator("#establecimiento-vista").evaluate((e) => { const cs = getComputedStyle(e), p = e.parentElement.getBoundingClientRect(), n = e.querySelector(".sv-nom"); return { scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, fuente: cs.fontFamily.slice(0, 40), tam: cs.fontSize, padre: Math.round(p.width), nombre: n ? Math.round(n.getBoundingClientRect().width) : null, codigoVisible: !!e.querySelector(".sv-cod") && getComputedStyle(e.querySelector(".sv-cod")).display !== "none", texto: e.textContent.slice(0, 40) }; }); assert.equal(med.scrollWidth <= med.clientWidth + 1, true, `${w}px: el nombre del establecimiento se ve completo (sin «…») · medidas: ${JSON.stringify(med)}`); } assert.match(await m.p.locator("#establecimiento-vista").innerText(), /Casa matriz/); assert.ok(fb.x + fb.width <= w && Math.abs(fb.y - sb.y) < 2, `${w}px: establecimiento y fecha en una fila`);
      await escribirNombre(m.p, "NOMBRE MUY LARGO DE UN RECEPTOR NUEVO ".repeat(4).trim().slice(0, 200)); await sinDesborde(m.p, `${w}px · receptor nuevo con nombre largo`);
      const caja = await m.p.evaluate(([i, n]) => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { id: r(i), n: r(n) }; }, [ID, ".rc-card .rc-l1"]);
      assert.ok(caja.id.b <= caja.n.t + 1 && caja.n.r <= w + 1 && caja.id.r <= w + 1, `${w}px: identificación y nombre en orden y dentro de la pantalla`);
      const seg = await m.p.locator(".seg-tipo").boundingBox(); assert.ok(seg.x >= 0 && seg.x + seg.width <= w, `${w}px: el control segmentado cabe`);
      for (const t of ["NIT", "CUI", "CF", "EXT"]) assert.ok((await m.p.locator(`.seg-tipo [data-tipo="${t}"]`).boundingBox()).height >= 40, `${w}px: segmento ${t} táctil`);
      const tt = await m.p.locator("h1").boundingBox(), vp2 = await m.p.locator("#previa-titulo").boundingBox(); assert.ok(Math.abs((tt.y + tt.height / 2) - (vp2.y + vp2.height / 2)) < 20, `${w}px: título, estado y «Vista previa» en una sola fila`); assert.ok(vp2.x >= 0 && vp2.x + vp2.width <= w && vp2.height >= 40, `${w}px: «Vista previa» visible y táctil`); if (w < 380) assert.ok(vp2.width <= 44, `${w}px: «Vista previa» pasa a icono`); else assert.ok(vp2.width > 70, `${w}px: «Vista previa» con texto`);
      await foto(m.p, `n${w}-nombre-largo.png`);
      // importes grandes en una factura guardada: la fila del ítem, el resumen y la barra no se salen ni se cortan
      await m.p.goto(`${srv.url}/#/f/${idGrande}`); await m.p.waitForSelector('button.it[data-linea="1"]'); await sinDesborde(m.p, `${w}px · importes grandes`);
      const cortes = await m.p.evaluate(() => [...document.querySelectorAll(".it-neto, .tot strong")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)); assert.deepEqual(cortes, [], `${w}px: importes sin cortar`);
      assert.match(await m.p.locator(".tot-base").innerText(), /Q\s?[\d,]+\.\d\d/); await foto(m.p, `n${w}-importes-grandes.png`);
      const b = await m.p.locator("#guardar, #revisar, #ver-previa").first().boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= w + 0.5, `${w}px: la acción principal cabe`);
      await m.c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`REDISEÑO MÓVIL (etapas 1 y 2) E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
