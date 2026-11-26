// VERIFICACIÓN FUNCIONAL de la interfaz PUBLICADA (solo lectura: no guarda ni certifica nada; la ejecuta quien despliega en modo «probar»):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…' node nube/verificar_ui_real.cjs     (requiere playwright-core y Chrome)
// Con un navegador real (computadora y teléfono) comprueba, contra lo publicado: (1) qué consultas de NIT/CUI están habilitadas y si un NIT/CUI de PRUEBA llena el nombre (origen digifact_test o simulado);
// (2) Consumidor Final (nombre «Consumidor Final», se escribe encima al tocar, vacío lo recupera, la identificación CF no cambia); (3) pasaporte/«Otro»: sin consulta, nombre manual, 13 dígitos no se vuelven CUI.
// Solo usa identificaciones FICTICIAS; no imprime nombres devueltos por consultas, contraseñas, tokens ni cookies.
const { chromium } = require("playwright-core");
const url = (process.env.FEL_DEMO_URL ?? "").replace(/\/$/, ""), clave = Object.fromEntries((process.env.FEL_DEMO_CLAVES ?? "").split(",").filter(Boolean).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)])).ana;
if (!url || !clave) { console.error("Faltan FEL_DEMO_URL o la clave de ana."); process.exit(1); }
const ID = 'input[aria-label="Identificación del receptor"]', NOM = '[aria-label="Nombre del receptor"]', SEG = (t) => `.seg-tipo [role="radio"][data-tipo="${t}"]`;
const PERFILES = [{ n: "computadora 1100 px", v: { width: 1100, height: 800 }, m: false }, { n: "teléfono 360 px", v: { width: 360, height: 740 }, m: true }, { n: "teléfono 412 px", v: { width: 412, height: 915 }, m: true }];
async function lanzar() { for (const o of [...(process.env.FEL_CHROME ? [{ executablePath: process.env.FEL_CHROME }] : []), { channel: "chrome" }, { executablePath: "/usr/bin/google-chrome" }, {}]) { try { return await chromium.launch({ ...o, args: ["--no-sandbox"] }); } catch { /* siguiente */ } } throw new Error("no hay Chrome disponible"); }
const ok = (c, m) => console.log(`  ${c ? "OK   " : "FALLO"} ${m}`);
(async () => {
  const nav = await lanzar(); let fallos = 0; const chk = (c, m) => { ok(c, m); if (!c) fallos++; };
  try {
    for (const pf of PERFILES) {
      console.log(`\n== ${pf.n} ==`);
      const ctx = await nav.newContext({ viewport: pf.v, isMobile: pf.m, hasTouch: pf.m, locale: "es-GT" }), p = await ctx.newPage(), toque = (s) => (pf.m ? p.tap(s) : p.click(s)), resp = [];
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      p.on("response", async (r) => { if (/\/api\/receptores\/(nit|cui)$/.test(r.url())) { let j = {}; try { j = await r.json(); } catch { /* sin cuerpo */ } resp.push({ tipo: /cui$/.test(r.url()) ? "CUI" : "NIT", origen: j.origen ?? "?", simulado: j.simulado, encontrado: j.encontrado, conNombre: !!j.nombre }); } });
      await p.goto(url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", clave); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
      const dg = await p.evaluate(async () => (await fetch("/api/digifact/estado", { headers: { "x-demo": "1" } })).json()); console.log(`  consulta real de NIT habilitada: ${dg.consultaNit ? "SÍ" : "NO"} · consulta real de CUI habilitada: ${dg.consultaCui ? "SÍ" : "NO"} (por empresa; las demás usan el simulador)`);
      const nueva = async () => { await p.goto(url + "/#/"); await p.waitForSelector(".cab-demo"); await p.goto(url + "/#/nueva"); await p.waitForSelector(ID); resp.length = 0; };
      // ---- NIT y CUI de PRUEBA
      await nueva(); await p.click(SEG("NIT")); await p.fill(ID, "10000011"); await p.waitForTimeout(2500); const n1 = resp.at(-1); console.log(`  NIT de prueba 10000011 → origen ${n1?.origen ?? "sin respuesta"}, simulado ${n1?.simulado}, encontrado ${n1?.encontrado}, nombre ${(await p.inputValue(NOM)).length ? "llenado" : "vacío"}`);
      await nueva(); await p.click(SEG("NIT")); await p.fill(ID, "44653948"); await p.waitForTimeout(3500); const n2 = resp.at(-1); console.log(`  NIT de prueba de Digifact TEST 44653948 → origen ${n2?.origen ?? "sin respuesta"}, simulado ${n2?.simulado}, encontrado ${n2?.encontrado}, nombre ${(await p.inputValue(NOM)).length ? "llenado" : "vacío"}`);
      await nueva(); await p.click(SEG("CUI")); await p.fill(ID, "9990000010101"); await p.locator(ID).press("Enter"); await p.waitForTimeout(3500); const c1 = resp.at(-1); console.log(`  CUI ficticio → origen ${c1?.origen ?? "sin respuesta"}, simulado ${c1?.simulado}, encontrado ${c1?.encontrado}; mensaje: «${(await p.locator(".nit-estado").first().innerText().catch(() => "")).slice(0, 110)}»`);
      chk(!(await p.inputValue(NOM)).length || c1?.encontrado === true, "una consulta que no encuentra nada NO inventa nombre");
      // ---- Consumidor Final
      await nueva(); await p.click(SEG("CF")); const nom = p.locator(NOM);
      chk(/consumidor final/i.test(await nom.inputValue()), "CF: nombre predeterminado «Consumidor Final»"); chk(await p.locator(ID).evaluate((e) => e.readOnly), "CF: la identificación es fija");
      await toque(NOM); await p.keyboard.type("Ana Gómez"); chk((await nom.inputValue()) === "Ana Gómez", "CF: al tocar el nombre, lo escrito reemplaza el texto (sin borrar a mano)");
      await p.locator(ID).click({ force: true }).catch(() => {}); await p.keyboard.type("123"); chk((await p.inputValue(ID)) === "CF" && (await p.locator(`${SEG("CF")}[aria-checked=true]`).count()) === 1, "CF: escribir en la identificación no la convierte en NIT ni CUI");
      await toque(NOM); await p.keyboard.press("Control+A"); await p.keyboard.press("Delete"); await p.locator("body").click({ position: { x: 5, y: 5 } }); chk(/consumidor final/i.test(await nom.inputValue()), "CF: vacío recupera «Consumidor Final»");
      // ---- Pasaporte / «Otro»
      await nueva(); await p.click(SEG("EXT")); await p.fill(ID, "AB1234567"); await p.waitForTimeout(900); await p.fill(ID, "2000000000101"); await p.waitForTimeout(1500);
      chk((await p.locator(`${SEG("EXT")}[aria-checked=true]`).count()) === 1, "«Otro»: 13 dígitos NO se convierten en CUI"); chk(resp.length === 0, "«Otro»: nunca consulta NIT ni CUI"); chk((await p.inputValue(NOM)) === "", "«Otro»: no se inventa un nombre (se escribe a mano)");
      await ctx.close();
    }
  } finally { await nav.close(); }
  console.log(fallos ? `\nVERIFICACIÓN: ${fallos} comprobación(es) FALLARON` : "\nVERIFICACIÓN FUNCIONAL: todas las comprobaciones de CF y pasaporte pasaron; los resultados de NIT y CUI están arriba");
})().catch((e) => { console.error("verificación de interfaz:", String(e.message).slice(0, 200)); process.exit(0); });
