// Fluidez en un teléfono de gama media (CPU 4× más lenta, red 1.6 Mb/s y 150 ms): tareas largas del hilo principal (bloqueos), solicitudes por acción y tiempos de las acciones principales. Servidor real (PGlite), todo local.
// Uso: node tests/medir_fluidez.cjs   (FEL_CPU=1 para no frenar la CPU; FEL_RED=rapida para no frenar la red)
const { spawn } = require("child_process"), path = require("path"), pw = require("playwright");
const { puertoLibre } = require("./puerto_libre.cjs"); const { esperarNueva, elegirTipo, ID } = require("./ayudas_nueva.cjs");
(async () => {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  await new Promise((ok) => { let s = ""; const f = (d) => { s += d; if (s.includes("Abre:")) ok(); }; hijo.stdout.on("data", f); hijo.stderr.on("data", f); });
  const nav = await pw.chromium.launch(), c = await nav.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "es-GT" });
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await c.addInitScript(() => { globalThis.__largas = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__largas.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch { /* sin soporte */ } });
  const p = await c.newPage(), s = await c.newCDPSession(p); await s.send("Network.enable");
  if (process.env.FEL_RED !== "rapida") await s.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  if (process.env.FEL_CPU !== "1") await s.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.FEL_CPU ?? 4) });
  let reqs = []; p.on("request", (r) => { if (new URL(r.url()).origin === `http://127.0.0.1:${puerto}` && /\/api\//.test(r.url())) reqs.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const fase = async (nombre, fn) => { reqs = []; await p.evaluate(() => { globalThis.__largas.length = 0; }); const t = Date.now(); await fn(); const dt = Date.now() - t; const L = await p.evaluate(() => [...globalThis.__largas]); console.log(`| ${nombre} | ${dt} ms | ${reqs.length} | ${L.length} tareas largas, bloqueo total ${L.reduce((a, b) => a + Math.max(0, b - 50), 0)} ms (máx ${Math.max(0, ...L)} ms) |`); return reqs; };
  console.log(`CPU ${process.env.FEL_CPU ?? 4}× · red ${process.env.FEL_RED === "rapida" ? "sin limitar" : "1.6 Mb/s + 150 ms"}\n| acción | tiempo | solicitudes API | hilo principal |\n|---|---|---|---|`);
  await fase("abrir la página (login)", async () => { await p.goto(`http://127.0.0.1:${puerto}`); await p.waitForSelector("#login-usuario"); });
  await fase("iniciar sesión → lista", async () => { await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.tap("#login-entrar"); await p.waitForSelector(".cab-demo"); await p.locator(".lista:not([aria-busy])").waitFor({ state: "attached" }); });
  await fase("abrir Nueva factura", async () => { await p.evaluate(() => { location.hash = "#/nueva"; }); await esperarNueva(p); });
  await fase("elegir CF", async () => { await elegirTipo(p, "CF"); });
  await fase("agregar concepto", async () => { const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it"); });
  const teclas = await fase("escribir 30 caracteres en observaciones/nombre", async () => { await p.tap(".rc-nombre-ver:visible, .rc-nombre:visible"); const campo = p.locator('[aria-label="Nombre del receptor"]'); await campo.pressSequentially("Juan Pérez García de los Montes ", { delay: 15 }); });
  console.log("solicitudes durante el tecleo:", teclas.length ? [...new Set(teclas)].join(", ") + ` (${teclas.length})` : "ninguna");
  await fase("Guardar borrador", async () => { await p.tap("#guardar, #guardar-certificar"); await p.waitForURL(/#\/f\//); await p.waitForSelector(".doc-cab"); });
  const t2 = await fase("escribir 30 caracteres en un documento YA guardado", async () => { const campo = p.locator('[aria-label="Nombre del receptor"]'); await campo.waitFor({ state: "visible" }); await campo.pressSequentially("Maria Lopez Garcia de la Cruz Perez", { delay: 15 }); });
  console.log("solicitudes durante el tecleo (documento guardado):", t2.length ? [...new Set(t2)].join(", ") + ` (${t2.length})` : "ninguna");
  await fase("volver a Documentos", async () => { await p.evaluate(() => { location.hash = "#/"; }); await p.waitForSelector(".pestana.act"); await p.locator(".lista:not([aria-busy])").waitFor({ state: "attached" }); });
  await nav.close(); hijo.kill();
})().catch((e) => { console.error(e); process.exit(1); });
