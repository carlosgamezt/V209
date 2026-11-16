// Acceso anticipado (DEMO): rótulo DEMO, navegación móvil «4 + Más», botón «Reportar un problema» y precio Q0.00 (aceptado solo en DEMO, con aviso; los negativos se rechazan).
// Servidor propio en modo de pruebas (sin credenciales, sin red externa). Uso: node e2e_acceso.cjs   (FEL_DEMO_URL para usar un servidor ya iniciado)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
function arrancar() {
  if (process.env.FEL_DEMO_URL) return Promise.resolve({ url: process.env.FEL_DEMO_URL, parar() {} });
  const puerto = 9800 + Math.floor(Math.random() * 150);
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
    assert.match(banda, /SIMULADO - SIN VALOR FISCAL/); assert.match(banda, /DEMO · datos NO persistentes/, "rótulo DEMO visible según la base real (memoria)");
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
    await pc.goto(srv.url + "/#/nueva"); await pc.waitForSelector('select[aria-label="Receptor"]');
    await pc.selectOption('select[aria-label="Receptor"]', { index: 1 }); await pc.selectOption('select[aria-label="Establecimiento"]', { index: 1 });
    await pc.getByRole("button", { name: "Continuar" }).click(); await pc.waitForSelector('input[aria-label="Precio de la línea 1"]');
    await pc.fill('input[aria-label="Descripción de la línea 1"]', "Cortesía de prueba");
    assert.equal(await pc.locator("#aviso-precio-cero").count(), 0, "sin aviso mientras el precio no es cero");
    await pc.fill('input[aria-label="Precio de la línea 1"]', "0.00"); await pc.waitForSelector("#aviso-precio-cero");
    assert.match(await pc.locator("#aviso-precio-cero").innerText(), /Q0\.00.*línea 1.*solo en esta DEMO.*No es válido para certificar/s);
    await pc.fill('input[aria-label="Precio de la línea 1"]', "25.50"); await pc.waitForSelector("#aviso-precio-cero", { state: "detached" });
    await pc.fill('input[aria-label="Precio de la línea 1"]', "-5"); await pc.getByRole("button", { name: /Guardar borrador/ }).click();
    await pc.waitForSelector("text=el precio debe ser un número"); assert.equal(await pc.locator("#aviso-precio-cero").count(), 0, "el negativo no recibe el aviso de DEMO: se rechaza");
    await pc.fill('input[aria-label="Precio de la línea 1"]', "0"); await pc.waitForSelector("#aviso-precio-cero");
    await pc.getByRole("button", { name: /Guardar borrador/ }).click(); await pc.waitForSelector("#toasts >> text=/guardad/i");   // en DEMO se puede guardar con Q0.00
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log("ACCESO ANTICIPADO E2E OK");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
