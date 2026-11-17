// Rediseño móvil de la factura (navegador real, 320 / 360 / 390 / 430 px): una sola pantalla, captura rápida de ítems en la hoja de edición, barra con acción principal + «Más acciones»,
// sin desplazamiento horizontal ni elementos fijos que tapen acciones, guardado y recuperación del borrador, vista previa limpia, impresión y PDF en HOJA CARTA y TICKET 80 MM.
// Uso: node e2e_movil.cjs [carpeta-de-capturas]   (servidor real en modo con inicio de sesión; sin red externa, sin SAT)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null; if (capturas) fs.mkdirSync(capturas, { recursive: true });

function arrancar() {
  const puerto = 9000 + Math.floor(Math.random() * 400);
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
const caja = (pdf) => { const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf); return m ? { w: Number(m[1]), h: Number(m[2]) } : null; };

(async () => {
  const srv = await arrancar(), nav = await pw.chromium.launch(), errores = [];
  try {
    for (const w of [320, 360, 390, 430]) {
      const alto = w <= 360 ? 640 : 844, donde = (x) => `${w}px · ${x}`;
      const ctx = await nav.newContext({ viewport: { width: w, height: alto }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, locale: "es-GT" });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      const p = await ctx.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`${w}: ${m.text()}`); });
      const foto = async (n) => { if (capturas && (w === 390 || w === 320)) await p.screenshot({ path: path.join(capturas, `${n}-${w}.png`) }); };
      const sinDesborde = async (x) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde(x)}: ${a} > ${v}`); };
      // un elemento «libre» no está tapado por nada fijo (encabezado, barra de acciones, navegación) una vez desplazado a la vista
      const libre = async (sel, x) => { await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(120);
        const ok = await p.evaluate((s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (t === e || e.contains(t)); }, sel); assert.ok(ok, `«${sel}» queda tapado por un elemento fijo en ${donde(x)}`); };
      const textoVisible = async (x) => {   // ningún botón con el texto desbordado o cortado
        const mal = await p.evaluate(() => [...document.querySelectorAll(".barra-acciones .btn, .menu-mas .mi, .hoja-item .btn")].filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1).map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 30)));
        assert.deepEqual(mal, [], `texto cortado en ${donde(x)}: ${mal.join(" | ")}`); };

      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");

      // ---- una sola pantalla: receptor + ítems + resumen, una acción principal y «Más acciones», sin botón flotante «+»
      await p.goto(srv.url + "/#/nueva"); await p.waitForSelector('select[aria-label="Receptor"]');
      assert.equal(await p.locator("li.paso, .stepper").count(), 0, donde("sin asistente de pasos")); assert.equal(await p.locator("#fab-agregar, .ab-fab").count(), 0, donde("sin botón flotante +"));
      assert.equal(await p.locator(".barra-acciones > .btn").count(), 1, donde("una acción principal")); assert.equal(await p.locator("#mas-acciones").count(), 1);
      assert.ok(await p.locator('select[aria-label="Receptor"]').isVisible() && await p.locator("#agregar-item").count() === 1, donde("datos e ítems en la misma pantalla"));
      await sinDesborde("nueva factura vacía"); await foto("01-nueva"); await textoVisible("nueva factura vacía");
      await p.selectOption('select[aria-label="Receptor"]', { index: 1 }); await p.selectOption('select[aria-label="Establecimiento"]', { index: 1 });

      // ---- captura rápida: descripción ⏎ cantidad ⏎ precio ⏎ guarda y deja la hoja lista para el siguiente ítem
      await p.click("#agregar-item"); await p.waitForSelector(".hoja-item"); await sinDesborde("hoja de edición"); await foto("02-editor"); await textoVisible("hoja de edición");
      const hoja = await p.locator(".hoja-item").boundingBox(); assert.ok(hoja.x >= 0 && hoja.x + hoja.width <= w + 1 && hoja.y >= 0 && hoja.y + hoja.height <= alto + 1, donde("la hoja cabe en la pantalla"));
      await p.fill('.hoja-item [aria-label="Descripción"]', "Servicio de consultoría"); await p.keyboard.press("Enter"); await p.keyboard.type("2"); await p.keyboard.press("Enter"); await p.keyboard.type("150.50");
      await p.selectOption('.hoja-item [aria-label="Tipo de descuento"]', "porcentaje"); await p.fill('.hoja-item [aria-label="Valor del descuento"]', "10"); await foto("03-editor-descuento");
      assert.match(await p.locator("#ed-neto").innerText(), /Q 270\.90/, donde("neto del ítem con descuento")); await p.click("#ed-otro");
      await p.fill('.hoja-item [aria-label="Descripción"]', "Hosting anual"); await p.keyboard.press("Enter"); await p.keyboard.type("1"); await p.keyboard.press("Enter"); await p.keyboard.type("300"); await p.keyboard.press("Enter");
      assert.match(await p.locator(".ed-ok").innerText(), /Ítem 2 agregado/, donde("la hoja confirma el ítem y queda lista")); assert.equal(await p.locator('.hoja-item [aria-label="Descripción"]').inputValue(), "", donde("campos limpios para el siguiente"));
      await p.fill('.hoja-item [aria-label="Descripción"]', "Dominio .com"); await p.keyboard.press("Enter"); await p.keyboard.press("Enter"); await p.keyboard.type("85.5"); await p.click("#ed-guardar"); await p.waitForSelector(".hoja-item", { state: "detached" });
      assert.equal(await p.locator("button.it").count(), 3, donde("tres ítems como filas compactas")); await sinDesborde("lista de ítems"); await foto("04-lista");
      assert.ok((await p.locator("#agregar-item").boundingBox()).y > (await p.locator("button.it").last().boundingBox()).y, donde("«Agregar ítem» al final de la lista"));
      assert.match(await p.locator(".totales").innerText(), /Subtotal\s*Q 686\.50[\s\S]*Descuentos\s*Q 30\.10[\s\S]*Total provisional\s*Q 656\.40/, donde("resumen compacto: subtotal y total provisional"));
      for (const s of ["#agregar-item", "#guardar", "#mas-acciones", 'select[aria-label="Receptor"]']) await libre(s, `acción accesible ${s}`);
      await textoVisible("barra de acciones");

      // ---- «Más acciones»: el menú cabe en pantalla; la barra no pisa la navegación inferior ni a sí misma
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120);
      const c = await p.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { barra: r(".barra-acciones"), nav: r(".nav-movil"), prim: r(".barra-acciones > .btn"), mas: r("#mas-acciones") }; });
      assert.ok(c.barra.b <= c.nav.t + 1, donde(`la barra queda sobre la navegación inferior (${c.barra.b} ≤ ${c.nav.t})`)); assert.ok(c.prim.r <= c.mas.l + 1, donde("acción principal y «Más acciones» en una fila sin superponerse"));
      await p.click("#mas-acciones"); const mn = await p.locator(".menu-mas").boundingBox(); assert.ok(mn.x >= 0 && mn.x + mn.width <= w + 1 && mn.y >= 0, donde("el menú cabe en la pantalla")); await sinDesborde("menú Más acciones"); await foto("05-mas-acciones"); await textoVisible("menú"); await p.keyboard.press("Escape");

      // ---- guardar (el borrador no pierde nada), recargar y recuperar
      await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); const url = p.url();
      await p.reload(); await p.waitForSelector(".doc-cab"); assert.equal(await p.locator("button.it").count(), 3, donde("el borrador conserva sus ítems")); assert.match(await p.locator('button.it[data-linea="1"]').innerText(), /Servicio de consultoría[\s\S]*2 × Q 150\.50 · −10%[\s\S]*Q 270\.90/, donde("descuento conservado"));
      await p.click('button.it[data-linea="3"]'); await p.waitForSelector(".hoja-item"); await p.fill('.hoja-item [aria-label="Cantidad"]', "2"); await p.click("#ed-guardar"); await p.waitForSelector(".sucio"); await p.click("#guardar"); await p.waitForSelector(".sucio", { state: "detached" });
      assert.match(await p.locator(".totales").innerText(), /Total provisional\s*Q 741\.90/, donde("edición guardada y recalculada")); await sinDesborde("factura guardada"); await foto("06-guardada");

      // ---- vista previa limpia con impresión: HOJA CARTA y TICKET 80 MM, PDF de cada una
      await p.click("#mas-acciones"); await p.click("#mi-previa"); await p.waitForSelector(".previa-modal"); await sinDesborde("vista previa carta"); await foto("07-previa-carta");
      const pm = await p.locator(".previa-modal").boundingBox(); assert.ok(pm.x >= 0 && pm.x + pm.width <= w + 1, donde("la vista previa cabe en la pantalla"));
      for (const [fmt, cajaEsperada] of [["carta", { w: 612, h: 792 }], ["ticket", { w: 226 }]]) {
        await p.check(`input[name="formato-impresion"][value="${fmt}"]`); await p.waitForSelector(`.papel[data-formato="${fmt}"]`); await sinDesborde(`vista previa ${fmt}`); if (fmt === "ticket") await foto("08-previa-ticket");
        const txt = await p.locator(`.papel[data-formato="${fmt}"]`).innerText(); assert.match(txt, /SIMULADO - SIN VALOR FISCAL/, donde(`${fmt}: rotulado SIN VALOR FISCAL`)); assert.doesNotMatch(txt, /Serie \S+ · Número/, donde(`${fmt}: no muestra serie ni número fiscales inventados`));
        const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#previa-pdf")]); const pdf = fs.readFileSync(await dl.path()).toString("latin1");
        assert.ok(pdf.startsWith("%PDF-1.4"), donde(`${fmt}: PDF válido`)); const b = caja(pdf); assert.equal(b.w, cajaEsperada.w, donde(`${fmt}: ancho del PDF`)); if (cajaEsperada.h) assert.equal(b.h, cajaEsperada.h); else assert.ok(b.h > 250, donde("ticket: alto variable según el contenido"));
        assert.match(pdf, /SIN VALOR FISCAL/, donde(`${fmt}: PDF rotulado`)); assert.match(pdf, /NO es una factura ni un DTE/); assert.match(dl.suggestedFilename(), new RegExp(`^NO-FISCAL-DEMO-${fmt.toUpperCase()}-BR-`));
      }
      assert.equal(await p.locator("#previa-compartir").isDisabled(), false, donde("compartir disponible con el documento guardado"));
      // impresión del navegador: el tamaño de página sale del formato elegido (@page con nombre) y solo se imprime el documento
      if (w === 390) {
        for (const [fmt, esperado] of [["ticket", (b) => b.w > 220 && b.w < 235 && b.h > 150 && b.h < 780], ["carta", (b) => b.w > 605 && b.w < 620 && b.h > 785 && b.h < 800]]) {
          await p.check(`input[name="formato-impresion"][value="${fmt}"]`); await p.waitForSelector(`.papel[data-formato="${fmt}"]`); await p.evaluate(() => window.dispatchEvent(new Event("beforeprint"))); await p.emulateMedia({ media: "print" });
          assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#app")).display), "none", "al imprimir se oculta la aplicación"); assert.equal(await p.locator(`.papel[data-formato="${fmt}"]`).isVisible(), true);
          const hojaPdf = (await p.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1"); const bb = caja(hojaPdf); assert.ok(bb && esperado(bb), `impresión ${fmt}: tamaño de página ${JSON.stringify(bb)}`); await p.emulateMedia({ media: "screen" });
        }
      }
      await p.keyboard.press("Escape"); await ctx.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log("MÓVIL E2E OK");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
