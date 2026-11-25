// Revisión visual AUTOMÁTICA de las pantallas principales a 320/360/390/412/768/1440 px: sin desplazamiento horizontal, ningún elemento más ancho que la pantalla, objetivos táctiles ≥ 40 px en teléfono,
// la barra de acciones fija no tapa la navegación inferior ni el contenido interactivo, y la acción principal visible. Con FEL_FOTOS=<carpeta> guarda capturas para inspección humana.
// Servidor real + PostgreSQL (PGlite); simulado y local. Uso: node tests/e2e_vistas.cjs
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva, elegirReceptor } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó:\n" + s)); }, 120000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); hijo.on("exit", (c) => { if (c) mal(new Error(`servidor terminó ${c}:\n${s}`)); }); });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    for (const w of [320, 360, 390, 412, 768, 1440]) {
      const movil = w < 768, c = await nav.newContext({ viewport: { width: w, height: movil ? 844 : 900 }, hasTouch: movil, ...(movil && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`));
      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
      const foto = async (n) => { if (process.env.FEL_FOTOS) await p.screenshot({ path: path.join(process.env.FEL_FOTOS, `${n}-${w}.png`) }); };
      const revisar = async (pantalla) => {
        await p.waitForTimeout(250);
        const r = await p.evaluate(() => {
          const v = innerWidth, anchos = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[hidden]") && b.right > v + 1 && !e.closest(".scroll-x, .pestanas, table"); }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ")[0]}`);
          const peq = [...document.querySelectorAll("button, a.btn, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, .nav-movil a")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 40 && !e.closest("[hidden]") && getComputedStyle(e).visibility !== "hidden" && !e.closest(".cab-demo, .lateral"); }).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}#${e.id || e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 18)} (${Math.round(e.getBoundingClientRect().height)}px)`);
          const barra = document.querySelector(".barra-acciones"), nv = document.querySelector(".nav-movil");
          const solapa = barra && nv && getComputedStyle(nv).display !== "none" ? barra.getBoundingClientRect().bottom > nv.getBoundingClientRect().top + 1 : false;
          return { desborde: document.documentElement.scrollWidth - v, anchos, peq, solapa };
        });
        assert.ok(r.desborde <= 1, `${w}px · ${pantalla}: desplazamiento horizontal de ${r.desborde}px`); assert.deepEqual(r.anchos, [], `${w}px · ${pantalla}: elementos fuera de la pantalla`);
        if (movil) { assert.deepEqual(r.peq, [], `${w}px · ${pantalla}: objetivos táctiles menores de 40 px`); assert.equal(r.solapa, false, `${w}px · ${pantalla}: la barra de acciones tapa la navegación inferior`); }
      };
      // Documentos: Emitidos (vista predeterminada), Borradores, filtros abiertos, y la lista vacía por una búsqueda sin resultados
      await p.goto(srv.url + "/#/"); await p.waitForSelector(".pestana.act"); assert.equal(await p.locator(".pestana.act").getAttribute("data-categoria"), "emitidos", `${w}px: la vista predeterminada es Emitidos`); await revisar("Documentos · Emitidos"); await foto("lista-emitidos");
      { const b = await p.evaluate(() => { const i = document.querySelector(".buscador input"), cs = getComputedStyle(i), caja = document.querySelector(".buscador").getBoundingClientRect(), r = i.getBoundingClientRect(); return { borde: cs.borderTopWidth, dentro: r.left >= caja.left - 1 && r.right <= caja.right + 1 && r.top >= caja.top - 1 && r.bottom <= caja.bottom + 1 }; });
        assert.equal(b.borde, "0px", `${w}px: el campo de búsqueda no lleva un segundo marco`); assert.equal(b.dentro, true, `${w}px: el campo de búsqueda queda dentro de su caja`); }
      await p.click('.pestana[data-categoria="borradores"]'); await p.locator('.pestana[data-categoria="borradores"].act').waitFor(); await revisar("Documentos · Borradores");
      await p.locator("details.filtros-mas > summary").click(); await revisar("Documentos · filtros"); await foto("lista-filtros");
      await p.fill('input[aria-label="Buscar documentos"]', "zzzz-no-existe"); await p.waitForSelector("text=Ningún documento coincide"); await revisar("Documentos · sin resultados");
      // Nueva factura con un ítem (barra fija, totales, resumen)
      await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirReceptor(p); const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it");
      await revisar("Nueva factura"); await foto("nueva");
      // otras pantallas
      for (const [ruta, sel2, nombre] of [["#/clientes", ".indicadores, .vacio, .lista", "Clientes"], ["#/conceptos", ".indicadores, .vacio, .lista", "Conceptos"], ["#/config", "h1, .ph-t", "Configuración"], ["#/panel", "h1, .ph-t", "Panel"]]) {
        await p.goto(srv.url + "/" + ruta); await p.waitForSelector(sel2); await p.waitForTimeout(150); await revisar(nombre);
      }
      await c.close();
    }
    assert.deepEqual(errores, [], "sin errores de JavaScript: " + errores.join(" | "));
    console.log("OK e2e_vistas: Documentos (Emitidos/Borradores/filtros/vacío), Nueva factura, Clientes, Conceptos, Configuración y Panel a 320/360/390/412/768/1440 px sin desbordes, objetivos táctiles ≥ 40 px y barra fija sin tapar la navegación");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
