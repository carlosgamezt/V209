// Paginación de clientes y conceptos en el NAVEGADOR (modo servidor): con más de 500 clientes activos y más de 200 conceptos, las pantallas piden páginas al servidor (5 y 50 por página), los indicadores salen de los totales,
// la búsqueda y los filtros se hacen en el servidor, el CSV recorre las páginas, y la factura encuentra un cliente que NO está en el conjunto de trabajo de /api/estado. Nunca se pide la lista completa.
// Servidor local con PGlite y datos ficticios. Uso: node e2e_paginacion.cjs
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), fs = require("fs");
const { chromium } = require("playwright"); const { puertoLibre } = require("./puerto_libre.cjs"); const { ID, esperarNueva } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); });
}
(async () => {
  const srv = await arrancar(), errores = []; let nav;
  try {
    nav = await chromium.launch(); const c = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-GT", acceptDownloads: true }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
    await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".indicadores, .lista, h1", { timeout: 30000 });
    const post = (ruta, data) => c.request.post(srv.url + ruta, { headers: { "x-demo": "1" }, data });
    // datos ficticios: 520 clientes (+ los del demo) y 230 conceptos, y un cliente que queda FUERA del conjunto de trabajo (nombre al final del alfabeto)
    for (let i = 0; i < 520; i += 20) await Promise.all(Array.from({ length: 20 }, (_, k) => i + k + 1).map((n) => post("/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: `${7000000 + n}-1`, nombre: `Masivo ${String(n).padStart(4, "0")}` }).then((r) => assert.equal(r.status(), 200, `cliente ${n}`))));
    assert.equal((await post("/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "9999999-9", nombre: "Zzz Remoto S.A." })).status(), 200);
    for (let i = 0; i < 230; i += 23) await Promise.all(Array.from({ length: 23 }, (_, k) => i + k + 1).map((n) => post("/api/conceptos", { codigo: `M${n}`, descripcion: `Concepto masivo ${String(n).padStart(4, "0")}`, tipo: n % 2 ? "bien" : "servicio", unidad_medida: "UNI", precio_unitario: "10.00" }).then((r) => assert.equal(r.status(), 200, `concepto ${n}`))));
    const estado = await (await c.request.get(srv.url + "/api/estado", { headers: { "x-demo": "1" } })).json();
    assert.equal(estado.clientes.length, 500, "conjunto de trabajo de 500"); assert.ok(estado.clientes_total >= 521, `total ${estado.clientes_total}`); assert.ok(!estado.clientes.some((x) => x.nombre === "Zzz Remoto S.A."), "el cliente final queda fuera del conjunto");
    // ---- Clientes: modo servidor
    const pedidos = []; p.on("request", (r) => { if (/\/api\/(clientes|conceptos)(\?|$)/.test(r.url())) pedidos.push(r.url().replace(srv.url, "")); });
    await p.goto(srv.url + "/#/clientes"); await p.reload(); pedidos.length = 0; await p.reload(); await p.waitForSelector(".indicadores .num");   // el estado de la sesión es posterior a la siembra solo tras recargar await p.waitForSelector('[data-cliente]');
    assert.equal(await p.locator("[data-cliente]").count(), 5, "5 por página");
    const reg = Number(await p.locator(".indicadores .indicador").first().locator(".num").innerText()); assert.ok(reg >= 521, `indicador de registrados sale del total (${reg})`);
    assert.match(await p.locator(".paginacion .mut").innerText(), new RegExp(`Mostrando 1 a 5 de ${reg} clientes`), "texto de rango con el total del servidor");
    await p.click('button[aria-label="Página siguiente"]'); await p.waitForFunction(() => /Mostrando 6 a 10/.test(document.querySelector(".paginacion .mut")?.textContent ?? "")); assert.equal(await p.locator("[data-cliente]").count(), 5, "página 2");
    await p.fill('input[aria-label="Buscar clientes"]', "Masivo 0123"); await p.waitForFunction(() => /de 1 clientes/.test(document.querySelector(".paginacion .mut")?.textContent ?? "")); assert.equal(await p.locator('[data-cliente="7000123-1"]').count(), 1, "búsqueda en el servidor");
    await p.fill('input[aria-label="Buscar clientes"]', "zzz-nadie"); await p.waitForSelector("text=Ningún cliente coincide"); await p.fill('input[aria-label="Buscar clientes"]', "");
    await p.waitForFunction(() => document.querySelectorAll("[data-cliente]").length === 5);
    assert.ok(pedidos.some((u) => /\/api\/clientes\?.*pagina=/.test(u)), "pidió páginas"); assert.ok(!pedidos.some((u) => /\/api\/clientes$/.test(u)), "NUNCA pidió la lista completa de clientes: " + pedidos.join(" "));
    // CSV recorre las páginas con el filtro actual
    await p.fill('input[aria-label="Buscar clientes"]', "Masivo 01"); await p.waitForFunction(() => /de 100 clientes/.test(document.querySelector(".paginacion .mut")?.textContent ?? ""));
    const [d] = await Promise.all([p.waitForEvent("download"), p.click('button[aria-label="Descargar clientes en CSV"]')]); const csv = fs.readFileSync(await d.path(), "utf8").split(/\r?\n/).filter(Boolean); assert.equal(csv.length, 101, "CSV: cabecera + 100 filas del filtro");
    // ---- Conceptos: modo servidor (más de 200)
    pedidos.length = 0; await p.goto(srv.url + "/#/conceptos"); await p.waitForSelector("[data-concepto]"); assert.equal(await p.locator("[data-concepto]").count(), 50, "50 por página"); assert.match(await p.locator(".paginacion .mut").innerText(), /Página 1 de \d+ · \d+ conceptos/);
    await p.click('button[aria-label="Página siguiente"]'); await p.waitForFunction(() => /Página 2 de/.test(document.querySelector(".paginacion .mut")?.textContent ?? ""));
    await p.fill('input[aria-label="Buscar conceptos"]', "masivo 0042"); await p.waitForFunction(() => /· 1 conceptos/.test(document.querySelector(".paginacion .mut")?.textContent ?? "")); assert.equal(await p.locator("[data-concepto]").count(), 1);
    assert.ok(!pedidos.some((u) => /\/api\/conceptos$/.test(u)), "NUNCA pidió la lista completa de conceptos");
    // ---- Factura: un cliente que no está en el conjunto de trabajo se encuentra en el servidor
    await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await p.fill(ID, "Zzz Remoto"); const fila = p.locator(".rc-sug .sg-ex", { hasText: "Zzz Remoto" }).first(); await fila.waitFor({ state: "visible", timeout: 8000 }); await fila.click();
    await p.waitForFunction(() => /Zzz Remoto/.test(document.body.innerText), null, { timeout: 8000 });
    await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await p.fill(ID, "9999999-9"); await p.waitForFunction(() => /Zzz Remoto/.test(document.body.innerText), null, { timeout: 8000 });   // NIT exacto: se elige solo
    assert.deepEqual(errores, [], "sin errores de JavaScript: " + errores.join(" | "));
    console.log("OK e2e_paginacion: clientes y conceptos paginados en el servidor (indicadores, búsqueda, CSV), sin pedir listas completas, y la factura encuentra un cliente fuera del conjunto de trabajo");
  } finally { await nav?.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
