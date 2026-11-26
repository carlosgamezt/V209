// ESTABLECIMIENTO ASIGNADO Y BLOQUEADO en «Nueva factura» (teléfono 390 px y computadora 1100 px). El servidor real entrega /api/estado; para representar a las personas con alcance se reescribe SOLO esa respuesta
// (lo mismo que hace el servidor con la función encendida: lista reducida + «alcance»); la imposición real (rechazo de peticiones manipuladas) la prueban tests/establecimiento_api_test.ts y las pruebas SQL.
// Comprueba: facturador (un establecimiento) → aparece solo, elegido y BLOQUEADO; supervisor autorizado (varios) → puede elegir solo entre los suyos; sin alcance (apagado) → como siempre. Uso: node tests/e2e_establecimiento_bloqueado.cjs
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva } = require("./ayudas_nueva.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó:\n" + s)); }, 120000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); hijo.on("exit", (c) => { if (c) mal(new Error("salió " + c + "\n" + s)); }); });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const donde = `${w}px`;
      for (const caso of ["facturador", "supervisor", "sin_alcance"]) {
        const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
        await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
        let ids = {};
        await c.route("**/api/estado", async (ruta) => {
          const r = await ruta.fetch(); const j = await r.json(); const e2 = j.establecimientos.find((x) => x.codigo_sat === "2"), e1 = j.establecimientos.find((x) => x.codigo_sat === "1"); ids = { e1: e1.id, e2: e2.id };
          if (caso === "facturador") { j.establecimientos = [e2]; j.alcance = { restringido: true, multiples: false, activo: e2.id, ids: [e2.id] }; }
          else if (caso === "supervisor") { j.alcance = { restringido: true, multiples: true, activo: e2.id, ids: [e1.id, e2.id] }; }
          else j.alcance = { restringido: false };
          await ruta.fulfill({ response: r, json: j });
        });
        const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${donde}/${caso}: ${e.message}`));
        await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
        await p.goto(srv.url + "/#/nueva"); await esperarNueva(p);
        const sel = p.locator('select[aria-label="Establecimiento"]');
        const opciones = await sel.locator("option").evaluateAll((l) => l.map((o) => o.textContent.trim().split(" ")[0]).filter((t) => /^\d/.test(t)));
        const valor = await sel.inputValue(), bloqueado = await sel.isDisabled(), visible = (await p.locator("#establecimiento-vista").innerText()).trim();
        if (caso === "facturador") {
          assert.deepEqual(opciones, ["2"], `${donde}: el facturador solo ve su establecimiento`); assert.equal(valor, ids.e2, `${donde}: viene elegido automáticamente`); assert.equal(bloqueado, true, `${donde}: está bloqueado`);
          assert.match(visible, /^2\b/, `${donde}: se muestra el código 2`);
          const ancho = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(ancho[0] <= ancho[1] + 1, `${donde}: sin desborde horizontal`);
        } else if (caso === "supervisor") {
          assert.deepEqual(opciones.sort(), ["1", "2"], `${donde}: el supervisor elige solo entre los suyos`); assert.equal(bloqueado, false, `${donde}: el supervisor puede cambiar`); assert.equal(valor, ids.e2, `${donde}: predeterminado: el activo`);
        } else { assert.equal(bloqueado, false, `${donde}: sin alcance se puede elegir como siempre`); assert.ok(opciones.length >= 2); }
        console.log(`OK ${donde} · ${caso}: opciones [${opciones}] · elegido ${visible.slice(0, 12)} · bloqueado ${bloqueado}`);
        await c.close();
      }
    }
    assert.deepEqual(errores, [], "errores de página: " + errores.join(" | "));
    console.log("OK establecimiento bloqueado (UI)");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
