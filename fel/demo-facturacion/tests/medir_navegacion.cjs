// Medición de navegación (servidor real de la demostración, PostgreSQL en memoria, sin red externa): solicitudes HTTP, bytes y tiempo por acción. NO mide red móvil real.
// Con FEL_RED=lenta limita el ancho de banda y añade latencia (CDP) para aproximar una red móvil 3G rápida. Uso: node tests/medir_navegacion.cjs
const { spawn } = require("child_process"), path = require("path"), pw = require("playwright");
const { puertoLibre } = require("./puerto_libre.cjs");
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => { let s = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("no arrancó")); }, 120000);
    const f = (d) => { s += d; if (s.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); });
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
(async () => {
  const srv = await arrancar(), nav = await pw.chromium.launch(); const lenta = process.env.FEL_RED === "lenta";
  try {
    const c = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "es-GT" });
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    const p = await c.newPage();
    if (lenta) { const s = await c.newCDPSession(p); await s.send("Network.enable"); await s.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }); }
    let reqs = [], bytes = 0; p.on("response", async (r) => { const u = new URL(r.url()); if (u.origin !== srv.url) return; reqs.push(`${r.request().method()} ${u.pathname}${u.search ? "?…" : ""}`); try { bytes += (await r.body()).length; } catch { /* sin cuerpo */ } });
    const medir = async (nombre, fn, n = 1) => { const t = []; let nr = 0, nb = 0, detalle = []; for (let i = 0; i < n; i++) { reqs = []; bytes = 0; const a = Date.now(); await fn(); t.push(Date.now() - a); nr = reqs.length; nb = bytes; detalle = reqs; } console.log(`| ${nombre} | ${pct(t, 0.5)} | ${pct(t, 0.95)} | ${nr} | ${(nb / 1024).toFixed(1)} |`); return detalle; };
    console.log(`Red: ${lenta ? "lenta emulada (1.6 Mb/s, 150 ms)" : "local sin limitar"}\n| acción | p50 ms | p95 ms | solicitudes | KB |\n|---|---|---|---|---|`);
    const dCarga = await medir("carga inicial (login incluido)", async () => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); });
    await medir("Documentos (primera vez)", async () => { await p.goto(`${srv.url}/#/`); await p.waitForSelector(".fila-fac, .vacio"); });
    const det = await medir("Nueva factura (formulario listo)", async () => { await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector("#agregar-item"); }, 5);
    const dNav = await medir("navegar Documentos → Nueva (SPA)", async () => { await p.evaluate(() => { location.hash = "#/"; }); await p.waitForSelector(".fila-fac, .vacio"); await p.evaluate(() => { location.hash = "#/nueva"; }); await p.waitForSelector("#agregar-item"); }, 5);
    await medir("abrir Clientes (SPA)", async () => { await p.evaluate(() => { location.hash = "#/clientes"; }); await p.waitForSelector(".indicadores, .vacio, .lista"); }, 5);
    const agr = (l) => Object.entries(l.reduce((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {})).map(([k, v]) => `${v}× ${k}`).join("\n- ");
    console.log("\nCarga inicial:\n- " + agr(dCarga) + "\n\nNavegación Documentos → Nueva:\n- " + agr(dNav));
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
