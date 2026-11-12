// Prueba de extremo a extremo de la VERSIÓN PRÁCTICA (navegador real, PC y teléfono): inicio de sesión, factura con varios ítems, Digifact simulado, consulta, anulación,
// plan y consumo, plataforma y PWA. Servidor real + PostgreSQL (PGlite). Sin credenciales, sin red externa, sin SAT.
// Uso: node e2e_practico.cjs [carpeta-de-capturas]   (FEL_DEMO_URL=http://127.0.0.1:8787 para usar un servidor ya iniciado en modo con inicio de sesión)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { chromium, devices } = require("playwright");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null; if (capturas) fs.mkdirSync(capturas, { recursive: true });

function arrancar() {
  if (process.env.FEL_DEMO_URL) return Promise.resolve({ url: process.env.FEL_DEMO_URL, parar() {} });
  const puerto = 9400 + Math.floor(Math.random() * 400);
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}

(async () => {
  const srv = await arrancar(), errores = [], nav = await chromium.launch();
  const nuevoCtx = async (opciones) => { const c = await nav.newContext({ locale: "es-GT", acceptDownloads: true, ...opciones }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); const p = await c.newPage();
    p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); }); return { c, p }; };
  const foto = async (p, nombre) => { assert.doesNotMatch(await p.locator("body").innerText(), /\bnull\b|\bundefined\b|\[object /, `texto interno visible en ${nombre}`); if (capturas) await p.screenshot({ path: path.join(capturas, nombre) }); };
  const sinDesborde = async (p, donde) => { const [ancho, vista] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(ancho <= vista + 1, `desborde horizontal en ${donde}: ${ancho} > ${vista}`); };
  const entrar = async (p, usuario, clave = "demo1234", recordar = false) => {
    await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", usuario); await p.fill("#login-clave", clave); if (recordar) await p.check("#login-recordar"); await p.click("#login-entrar");
  };
  const toast = (p, t) => p.waitForSelector(`#toasts >> text=${t}`);
  const llenarFactura = async (p, lineas) => {
    await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]');
    const cli = await p.locator('select[aria-label="Receptor"] option', { hasText: "Comercial Los Pinos" }).getAttribute("value"); await p.selectOption('select[aria-label="Receptor"]', cli);
    const est = await p.locator('select[aria-label="Establecimiento"] option', { hasText: "Casa matriz" }).getAttribute("value"); await p.selectOption('select[aria-label="Establecimiento"]', est);
    await p.click("#paso-siguiente");
    for (let i = 0; i < lineas.length; i++) {
      if (i > 0) await p.click("text=Agregar ítem");
      const [d, c, pr] = lineas[i]; await p.fill(`input[aria-label="Descripción de la línea ${i + 1}"]`, d); await p.fill(`input[aria-label="Cantidad de la línea ${i + 1}"]`, c); await p.fill(`input[aria-label="Precio de la línea ${i + 1}"]`, pr);
    }
  };

  // ====================================================== PC
  const { c: cPc, p } = await nuevoCtx({ viewport: { width: 1360, height: 900 } });
  await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await foto(p, "pc-01-login.png");
  assert.match(await p.locator(".login-banda").innerText(), /SIMULADO - SIN VALOR FISCAL/);
  assert.equal((await p.evaluate(() => fetch("/api/estado", { headers: { "x-demo": "1" } }).then((r) => r.status))), 401, "sin sesión no hay datos");
  await entrar(p, "ana", "incorrecta"); await p.waitForSelector("text=Usuario o contraseña incorrectos."); await foto(p, "pc-02-login-error.png");
  await entrar(p, "ana", "demo1234", true); await p.waitForSelector(".cab-demo"); assert.equal(await p.locator("#usuario-actual").innerText(), "Ana Torres");
  const ck = (await cPc.cookies()).find((x) => x.name === "fel_sid"); assert.ok(ck && ck.httpOnly && ck.sameSite === "Strict", "cookie HttpOnly y SameSite=Strict");
  assert.doesNotMatch(await p.evaluate(() => document.cookie), /fel_sid/, "JavaScript no puede leer la sesión");
  assert.equal(await p.locator('select[aria-label="Persona de la demostración"]').count(), 0, "con inicio de sesión no hay selector de personas");
  await p.reload(); await p.waitForSelector(".cab-demo"); await foto(p, "pc-03-facturas.png");   // la sesión sobrevive a recargar

  // factura con varios ítems, cálculo y vista previa
  await llenarFactura(p, [["Supervisión de obra", "2", "500"], ["Asesoría técnica", "3", "250.50"], ["Material de construcción", "1.5", "33.33"]]);
  await p.waitForSelector('.tot-base:has-text("1,801.495")'); await foto(p, "pc-04-factura-items.png");
  await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); const docUrl = p.url();
  await p.click("text=Marcar como revisado"); await toast(p, "Marcado como revisado");
  // certificar con Digifact simulado
  await p.waitForSelector("#canal-certificacion"); await p.selectOption("#canal-certificacion", "digifact"); await foto(p, "pc-05-envio-digifact.png");
  await p.click("#enviar"); await p.waitForSelector('[data-estado="certificado"]'); await p.waitForSelector('[data-panel="cobertura"]');
  assert.match(await p.locator('[data-panel="cobertura"]').innerText(), /Confirmado · 1 unidad\(es\) · cobrado Q 2\.50\b/); assert.match(await p.locator('[data-estado="certificado"]').innerText(), /SIM-/);
  await foto(p, "pc-06-certificado.png");
  await p.click("#consultar-proveedor"); await p.waitForSelector("#resultado-consulta >> text=Digifact confirma el documento"); await foto(p, "pc-07-consulta.png");
  // plan y consumo
  await p.goto(`${srv.url}/#/plan`); await p.waitForSelector('[data-panel="monedero"]'); assert.match(await p.locator('[data-panel="plan-resumen"]').innerText(), /Q 97\.50/); assert.match(await p.locator('[data-panel="consumos"]').innerText(), /Certificación/); await foto(p, "pc-08-plan.png");
  // anulación simulada
  await p.goto(docUrl); await p.waitForSelector("#anular"); await p.click("#anular"); await p.fill('textarea[aria-label="Motivo"]', "Error en los datos del receptor"); await p.getByRole("button", { name: "Anular", exact: true }).last().click(); await toast(p, "Documento anulado (simulación)"); await p.waitForSelector(".doc-cab .tag >> text=Anulado"); await foto(p, "pc-09-anulado.png");
  await p.goto(`${srv.url}/#/plan`); await p.waitForSelector('[data-panel="consumos"]'); assert.match(await p.locator('[data-panel="consumos"]').innerText(), /Anulación/); assert.match(await p.locator('[data-panel="plan-resumen"]').innerText(), /Q 97\.50/, "anular no se cobra");
  await p.click("#cerrar-sesion"); await p.waitForSelector("#login-usuario");
  assert.equal((await cPc.cookies()).find((x) => x.name === "fel_sid")?.value ?? "", "", "la cookie se borra al cerrar sesión");

  // emisor sin permisos de plan; lector sin certificar
  await entrar(p, "marta"); await p.waitForSelector(".cab-demo"); assert.equal(await p.locator('.nav a:has-text("Plan y consumo")').count(), 0, "la emisora no ve el plan"); await p.click("#cerrar-sesion"); await p.waitForSelector("#login-usuario");

  // plataforma
  await entrar(p, "maestro"); await p.waitForSelector('[data-panel="empresas"]'); assert.equal(await p.locator('.nav a:has-text("Nueva factura")').count(), 0); await foto(p, "pc-10-plataforma.png");
  await p.click("#nueva-empresa"); await p.fill('input[aria-label="Nombre comercial"]', "Taller Rivera"); await p.fill('input[aria-label="Razón social"]', "Taller Rivera, S.A. (FICTICIA)"); await p.fill('input[aria-label="NIT"]', "9990003-1");
  await p.fill('input[aria-label="Nombre del propietario"]', "Rita Rivera"); await p.fill('input[aria-label="Usuario del propietario"]', "rita"); await p.fill('input[aria-label="Contraseña del propietario"]', "clave-rita-1234"); await p.click("#guardar-formulario");
  await p.waitForSelector('[data-empresa="Taller Rivera"]'); await p.click('[data-empresa="Taller Rivera"]'); await p.waitForSelector("#asignar-plan");
  await p.click("#asignar-plan"); const ver = await p.locator('select[aria-label="Plan y versión"] option', { hasText: "prepago_basico" }).first().getAttribute("value"); await p.selectOption('select[aria-label="Plan y versión"]', ver); await p.click("#guardar-formulario"); await p.waitForSelector("text=Prepago básico");
  await p.click("#registrar-pago"); await p.fill('input[aria-label="Monto"]', "10"); await p.fill('input[aria-label="Referencia del pago"]', "PAGO-RITA-1"); await p.click("#guardar-formulario"); await p.waitForSelector('[data-panel="plan-resumen"] >> text=Q 10.00'); await foto(p, "pc-11-empresa.png");
  await p.goto(`${srv.url}/#/planes`); await p.waitForSelector('[data-plan="prepago_basico"]'); await foto(p, "pc-12-planes.png");
  await p.goto(`${srv.url}/#/bolson`); await p.waitForSelector('[data-panel="bolson-cuentas"]'); assert.match(await p.locator("body").innerText(), /Bolsón SIMULADO de Digifact/); assert.match(await p.locator('[data-panel="bolson-empresas"]').innerText(), /Empresa Demo/); await foto(p, "pc-13-bolson.png");
  await p.click("#cerrar-sesion"); await p.waitForSelector("#login-usuario");
  // la propietaria recién creada entra y ve su empresa
  await entrar(p, "rita", "clave-rita-1234"); await p.waitForSelector(".cab-demo"); assert.match(await p.locator(".emp-sel").innerText(), /TALLER RIVERA/);
  await cPc.close();

  // ====================================================== TELÉFONO (emulación de Chrome en Android)
  const { c: cMov, p: m } = await nuevoCtx({ ...devices["Pixel 7"] });
  await m.goto(srv.url); await m.waitForSelector("#login-usuario"); await foto(m, "mov-01-login.png"); await sinDesborde(m, "login");
  assert.ok(await m.locator("#login-clave").evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 16), "campos de 16 px o más");
  await entrar(m, "ana"); await m.waitForSelector(".cab-demo"); await foto(m, "mov-02-facturas.png"); await sinDesborde(m, "facturas");
  assert.ok(await m.locator(".nav-movil a").first().evaluate((e) => e.getBoundingClientRect().height >= 44), "objetivos táctiles de 44 px");
  // PWA: manifiesto instalable, service worker solo de recursos estáticos (nunca la API ni datos fiscales)
  const man = await m.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json())); assert.equal(man.display, "standalone"); assert.equal(man.start_url, "/");
  assert.ok(man.icons.some((i) => i.sizes === "192x192") && man.icons.some((i) => i.sizes === "512x512") && man.icons.some((i) => i.purpose === "maskable"), "íconos 192, 512 y maskable");
  for (const i of man.icons) assert.equal(await m.evaluate((s) => fetch(s).then((r) => r.status), i.src), 200, i.src);
  await m.evaluate(() => navigator.serviceWorker.ready); await m.reload(); await m.waitForSelector(".cab-demo"); await m.evaluate(() => fetch("/api/estado", { headers: { "x-demo": "1" } }).then((r) => r.json()));
  const cacheadas = await m.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
  assert.ok(cacheadas.length > 0 && cacheadas.every((x) => /^\/(web|app)\/|^\/manifest/.test(x)), "solo recursos estáticos en caché: " + cacheadas.join(","));
  assert.ok(!cacheadas.some((x) => x.startsWith("/api/")), "la API nunca se guarda en caché");
  await m.goto(`${srv.url}/#/nueva`); await m.waitForSelector('select[aria-label="Receptor"]'); await foto(m, "mov-03-nueva.png"); await sinDesborde(m, "nueva factura");
  for (const [ruta, sel, nombre] of [["/plan", '[data-panel="consumos"]', "plan"], ["/clientes", ".lista", "clientes"], ["/config", ".tabs", "config"]]) { await m.goto(`${srv.url}/#${ruta}`); await m.waitForSelector(sel); await foto(m, `mov-04-${nombre}.png`); await sinDesborde(m, nombre); }
  await cMov.close();

  await nav.close(); srv.parar();
  assert.deepEqual(errores, [], "errores de consola o de página:\n" + errores.join("\n"));
  console.log("PRÁCTICA E2E OK");
})().catch((e) => { console.error(e); process.exit(1); });
