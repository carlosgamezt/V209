// Fecha de emisión en el NAVEGADOR (teléfono y computadora): «Nuevo documento» trae por defecto el día de hoy EN GUATEMALA (la fecha la fija el servidor, no el reloj del dispositivo), el selector solo admite de hoy a 5 días atrás,
// una fecha anterior muestra un aviso discreto, una fuera del plazo se señala y no se guarda, y lo guardado lo muestran el detalle y la vista previa. Servidor real con inicio de sesión (todo simulado; no se certifica ni se envía nada).
// Uso: node e2e_fecha_emision.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const { esperarNueva, elegirReceptor } = require("./ayudas_nueva.cjs");
const { puertoLibre } = require("./puerto_libre.cjs");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const hoyGt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const sumar = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split("-").reverse().join("/");
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
    const hoy = hoyGt(), minima = sumar(hoy, -5);
    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT", timezoneId: "Pacific/Auckland" });   // el reloj del DISPOSITIVO está en otra zona a propósito
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`));
      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
      const donde = `${w}px`;
      await p.goto(srv.url + "/#/nueva"); await esperarNueva(p);
      const entrada = p.locator('input[aria-label="Fecha de emisión"]'), aviso = p.locator("#fecha-aviso");
      // ---- por defecto: hoy en Guatemala (lo dice el servidor), aunque el dispositivo esté en Nueva Zelanda
      assert.equal(await entrada.inputValue(), hoy, `${donde}: la fecha por defecto es la de hoy en Guatemala`); assert.equal((await p.locator("#fecha-vista").innerText()).trim(), dmy(hoy));
      assert.equal(await entrada.getAttribute("min"), minima, `${donde}: el selector no admite antes de ${minima}`); assert.equal(await entrada.getAttribute("max"), hoy, `${donde}: ni después de hoy`);
      assert.equal(await aviso.isVisible(), false, "sin aviso cuando la fecha es hoy");
      // ---- una fecha anterior válida: aviso discreto (no bloquea) con los días y la nota sobre la certificación
      await entrada.fill(sumar(hoy, -3));
      assert.equal(await aviso.isVisible(), true); const t3 = await aviso.innerText(); assert.match(t3, /Fecha anterior \(hace 3 días\)/); assert.match(t3, /certificación la asigna el certificador/); assert.equal(await aviso.evaluate((e) => e.classList.contains("err")), false);
      await entrada.fill(sumar(hoy, -1)); assert.match(await aviso.innerText(), /hace 1 día\)/);
      // ---- fuera del plazo: se señala en rojo (la fecha NO se cambia sola)
      await entrada.fill(sumar(hoy, -6)); assert.equal(await aviso.evaluate((e) => e.classList.contains("err")), true); assert.match(await aviso.innerText(), /no puede ser anterior al/);
      assert.equal(await entrada.inputValue(), sumar(hoy, -6), "la interfaz no corrige la fecha por su cuenta");
      await entrada.fill(sumar(hoy, 1)); assert.match(await aviso.innerText(), /no puede ser futura/);
      // ---- no se guarda con una fecha fuera del plazo; con una válida sí, y queda la fecha elegida
      await elegirReceptor(p); const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it");
      await entrada.fill(sumar(hoy, -6)); await p.click("#guardar");
      await p.waitForFunction(() => /anterior al/.test(document.body.innerText)).catch(() => {}); assert.ok(!/#\/documento\//.test(p.url()), "no se guardó"); assert.match(await p.locator("body").innerText(), /no puede ser anterior al/);
      const fechaValida = sumar(hoy, -4); await entrada.fill(fechaValida); await p.click("#guardar"); await p.waitForSelector(".doc-tit h1.mono");
      // el formulario queda en «Nuevo documento» ya guardado: se lee el borrador más reciente por la API
      const det = await p.evaluate(async () => { const J = { "x-demo": "1" }, lista = await (await fetch("/api/documentos", { headers: J })).json(); const ult = [...lista].sort((a, b) => b.numero_borrador - a.numero_borrador)[0]; return (await (await fetch(`/api/documentos/${ult.id}`, { headers: J })).json()).documento; });
      assert.ok(det, "no se pudo leer el borrador guardado");
      assert.equal(det.fecha_emision_prevista, fechaValida, `${donde}: se guardó la fecha elegida (AAAA-MM-DD, sin horas)`);
      assert.equal(await p.locator('input[aria-label="Fecha de emisión"]').inputValue(), fechaValida, "al reabrir, el formulario muestra la fecha guardada");
      // ---- la petición directa a la API (sin interfaz) también se rechaza
      const directa = await p.evaluate(async (f) => { const est = await (await fetch("/api/estado", { headers: { "x-demo": "1" } })).json(); const r = await fetch("/api/documentos", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ cliente_id: est.clientes[0].id, establecimiento_id: est.establecimientos[0].id, fecha: f, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "10" }] }) }); return r.status; }, sumar(hoy, -9));
      assert.equal(directa, 422, "el servidor rechaza una fecha fuera del plazo aunque venga de una petición directa");
      const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`);
      await c.close();
    }
    assert.deepEqual(errores, [], `errores en la consola: ${errores.join(" | ")}`);
    console.log("OK  fecha de emisión en el navegador (390 px y 1100 px): hoy en Guatemala por defecto, ventana de 5 días, aviso discreto, fuera de plazo señalado y rechazado, petición directa rechazada");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
