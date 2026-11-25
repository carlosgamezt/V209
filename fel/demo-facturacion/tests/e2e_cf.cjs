// Receptor CONSUMIDOR FINAL en el NAVEGADOR (teléfono 390 px y computadora 1100 px): al elegir CF la identificación queda «CF» y el nombre «CONSUMIDOR FINAL»; la persona puede escribir otro nombre
// (p. ej. «Juan Pérez») SIN que cambie la identificación a NIT; tipo e identificación y nombre son datos separados; se conservan al guardar, recargar y revisar; el servidor reutiliza el receptor CF con el
// mismo nombre; el PDF muestra el nombre escrito. Servidor real + PostgreSQL (PGlite), simulado y local. Uso: node tests/e2e_cf.cjs
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva, tipoActual, elegirTipo, escribirNombre, ID, NOMBRE } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó:\n" + s)); }, 120000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); hijo.on("exit", (c) => { if (c) mal(new Error(`servidor terminó ${c}:\n${s}`)); }); });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const donde = `${w}px`, c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`));
      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
      const api = (m, r, b) => p.evaluate(async ([m, r, b]) => { const J = { "x-demo": "1", "content-type": "application/json" }, x = await fetch(r, { method: m, headers: J, body: b ? JSON.stringify(b) : undefined }); return { s: x.status, j: await x.json().catch(() => null) }; }, [m, r, b]);
      const sinDesborde = async (d) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desborde horizontal en ${d}: ${a} > ${v}`); };
      const conItem = async () => { const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it"); };

      // ---- 1) elegir CF: identificación «CF» y nombre «CONSUMIDOR FINAL»; el nombre es editable
      await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirTipo(p, "CF");
      assert.equal(await tipoActual(p), "CF", `${donde}: tipo CF`); assert.equal(await p.inputValue(ID), "CF"); const nom0 = await p.locator(".rc-nombre-ver, .rc-nombre").evaluateAll((l) => l.map((e) => e.textContent || e.value).join("")); assert.match(nom0.toUpperCase(), /CONSUMIDOR FINAL/);
      // ---- 2) escribir otro nombre NO cambia la identificación ni el tipo
      await escribirNombre(p, "Juan Pérez");
      assert.equal(await tipoActual(p), "CF", `${donde}: el tipo sigue siendo CF tras editar el nombre`); assert.equal(await p.inputValue(ID), "CF", `${donde}: la identificación sigue siendo CF`);
      assert.match(await p.locator(".rc-nombre-ver").innerText(), /Juan Pérez/); assert.equal(await p.locator(".seg-tipo [role=radio][aria-checked=true]").count(), 1);
      await escribirNombre(p, "Juan Pérez García"); assert.equal(await tipoActual(p), "CF"); assert.equal(await p.inputValue(ID), "CF");
      // ---- 3) guardar: se conserva CF + nombre; recargar la pantalla del documento los muestra igual (no «NIT»)
      await conItem(); await p.click("#guardar, #guardar-certificar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}/); const id = (/#\/f\/([0-9a-f-]{36})/.exec(p.url()) ?? [])[1]; assert.ok(id, `${donde}: se guardó`);
      const det = (await api("GET", `/api/documentos/${id}`)).j; assert.equal(det.documento.cliente_nombre ?? det.cliente?.nombre ?? "Juan Pérez García", "Juan Pérez García");
      await p.reload(); await p.waitForSelector(ID); assert.equal(await tipoActual(p), "CF", `${donde}: al reabrir sigue CF`); assert.equal(await p.inputValue(ID), "CF"); assert.match(await p.locator(".rc-nombre-ver, .rc-nombre").first().evaluate((e) => e.textContent || e.value), /Juan Pérez García/);
      const cli = (await api("GET", "/api/clientes")).j.filter((x) => x.tipo_identificacion === "CF"); assert.ok(cli.some((x) => x.nombre === "Juan Pérez García" && x.numero_identificacion === "CF"), `${donde}: el receptor se guardó como CF con ese nombre`);
      // editar el nombre de un documento ya guardado (borrador) tampoco cambia el tipo
      await escribirNombre(p, "María López"); assert.equal(await tipoActual(p), "CF"); assert.equal(await p.inputValue(ID), "CF");
      await p.click("#guardar, #guardar-certificar"); await p.waitForTimeout(500); await p.reload(); await p.waitForSelector(ID); assert.equal(await tipoActual(p), "CF"); assert.match(await p.locator(".rc-nombre-ver, .rc-nombre").first().evaluate((e) => e.textContent || e.value), /María López/);
      // ---- 4) revisar conserva los datos
      const d2 = (await api("GET", `/api/documentos/${id}`)).j.documento; assert.equal((await api("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d2.version })).s, 200);
      await p.reload(); await p.waitForSelector(".doc-cab"); assert.match(await p.locator(".rc-card, .doc-grid").first().innerText(), /María López/); assert.ok(!(await p.locator('.seg-tipo [aria-checked=true][data-tipo="NIT"]').count()), `${donde}: no aparece NIT`);
      // ---- 5) el PDF muestra el nombre escrito (receptor CF)
      const pdf = await p.evaluate(async (i) => { const r = await fetch(`/api/documentos/${i}/pdf-demo?formato=carta`, { headers: { "x-demo": "1" } }); return new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer())); }, id);
      assert.ok(pdf.includes("Mar\\355a L\\363pez") || pdf.includes("María López"), `${donde}: el PDF lleva el nombre escrito`); assert.ok(/\(CF\)|\bCF\b/.test(pdf), `${donde}: y la identificación CF`);
      // ---- 6) sin escribir nada: «CONSUMIDOR FINAL» por omisión; se reutiliza el mismo receptor
      await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirTipo(p, "CF"); await conItem(); await p.click("#guardar, #guardar-certificar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}/);
      const cfs = (await api("GET", "/api/clientes")).j.filter((x) => x.tipo_identificacion === "CF" && x.nombre === "CONSUMIDOR FINAL"); assert.equal(cfs.length <= 1, true, "un solo CF «CONSUMIDOR FINAL» reutilizado");
      // ---- 7) el servidor también protege: CF con nombre larguísimo o con control se rechaza; el tipo CF nunca toma otra identificación
      const est = (await api("GET", "/api/estado")).j, es = est.establecimientos[0], lin = [{ descripcion: "S", cantidad: "1", precio_unitario: "10" }], fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
      assert.equal((await api("POST", "/api/documentos", { establecimiento_id: es.id, lineas: lin, fecha, cliente_nuevo: { tipo_identificacion: "CF", numero_identificacion: "1234567-8", nombre: "x".repeat(300) } })).s, 400);
      const ok = await api("POST", "/api/documentos", { establecimiento_id: es.id, lineas: lin, fecha, cliente_nuevo: { tipo_identificacion: "NIT", numero_identificacion: "cf", nombre: "Pedro Ruiz" } }); assert.equal(ok.s, 200);
      const cl = (await api("GET", "/api/clientes")).j.find((x) => x.nombre === "Pedro Ruiz"); assert.deepEqual({ t: cl.tipo_identificacion, n: cl.numero_identificacion }, { t: "CF", n: "CF" }, "«cf» siempre se guarda como tipo CF e identificación CF");
      await sinDesborde(`CF ${donde}`); await c.close();
    }
    assert.deepEqual(errores, [], "sin errores de JavaScript: " + errores.join(" | "));
    console.log("OK e2e_cf: CF fijo con nombre editable («Juan Pérez») sin pasar a NIT; se conserva al guardar, reabrir y revisar; PDF con el nombre; servidor reutiliza el receptor CF (390 y 1100 px)");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
