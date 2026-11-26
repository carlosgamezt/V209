// MEDICIÓN DE LA INTERFAZ REAL contra la demostración publicada (la ejecuta quien despliega en modo «probar» con la prueba de Digifact TEST habilitada):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…' node nube/medir_ui_real.cjs      (requiere playwright-core y Chrome)
// Hace lo que hace la persona: entra, abre «Nueva factura», elige CF, agrega un concepto y pulsa «Guardar y certificar en TEST»; cronometra desde el toque hasta que aparece «Documento emitido» y lista TODAS las solicitudes
// del intervalo (cuándo salió cada una, cuánto tardó la red, cuánto la función, cuántas consultas a la base, cuánto Digifact). Perfiles: computadora sin limitar y teléfono con red móvil (+120 ms, 5/2 Mbps, CPU 4×). 3 corridas de cada uno.
// Documentos de PRUEBA (Digifact TEST, sin valor fiscal). No imprime contraseñas, tokens ni cookies.
const { chromium } = require("playwright-core");
const url = (process.env.FEL_DEMO_URL ?? "").replace(/\/$/, ""), clave = Object.fromEntries((process.env.FEL_DEMO_CLAVES ?? "").split(",").filter(Boolean).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)])).ana;
if (!url || !clave) { console.error("Faltan FEL_DEMO_URL o la clave de ana."); process.exit(1); }
const PERFILES = [
  { nombre: "computadora, red sin limitar", viewport: { width: 1280, height: 800 }, mobile: false, red: null, cpu: 1 },
  { nombre: "teléfono, red móvil (+120 ms, 5/2 Mbps, CPU 4×)", viewport: { width: 390, height: 844 }, mobile: true, red: { latencia: 120, bajada: 5_000_000 / 8, subida: 2_000_000 / 8 }, cpu: 4 },
];
const PLAZO = Number(process.env.FEL_UI_PLAZO ?? 30000);
const num = (s, k) => { const m = new RegExp(`${k};dur=([\\d.]+)`).exec(s ?? ""); return m ? Math.round(Number(m[1])) : null; };
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
async function lanzar() { for (const o of [...(process.env.FEL_CHROME ? [{ executablePath: process.env.FEL_CHROME }] : []), { channel: "chrome" }, { executablePath: "/usr/bin/google-chrome" }, { executablePath: "/usr/bin/chromium" }, {}]) { try { return await chromium.launch({ ...o, args: ["--no-sandbox"] }); } catch { /* siguiente */ } } throw new Error("no hay Chrome disponible"); }
async function corrida(nav, perfil, n) {
  const ctx = await nav.newContext({ viewport: perfil.viewport, isMobile: perfil.mobile, hasTouch: perfil.mobile, locale: "es-GT" }), p = await ctx.newPage(), errores = [];
  p.on("pageerror", (e) => errores.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errores.push(m.text().slice(0, 120)); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.goto(url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", clave); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
  await p.goto(url + "/#/nueva"); await p.waitForSelector('input[aria-label="Identificación del receptor"]'); await p.click('.seg-tipo [data-tipo="CF"]');
  const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it"); await p.waitForTimeout(1500);   // la persona tarda en llegar al botón
  const cdp = await ctx.newCDPSession(p);   // se limita la red y el procesador SOLO desde aquí (el inicio de sesión y la captura ya ocurrieron)
  if (perfil.red) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: perfil.red.latencia, downloadThroughput: perfil.red.bajada, uploadThroughput: perfil.red.subida }); }
  if (perfil.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: perfil.cpu });
  const reqs = []; let tClick = 0;
  p.on("request", (r) => { if (tClick && /\/api\//.test(r.url())) reqs.push({ r, ini: Date.now() }); });
  const fin = new Map(); p.on("requestfinished", (r) => fin.set(r, Date.now()));
  tClick = Date.now(); if (perfil.mobile) await p.tap("#guardar-certificar", { timeout: PLAZO }); else await p.click("#guardar-certificar", { timeout: PLAZO });
  await p.waitForSelector('[data-panel="emitido"]', { state: "visible", timeout: Number(process.env.FEL_UI_PLAZO ?? 60000) }); const tEmitido = Date.now();
  await p.waitForTimeout(1500);   // se deja terminar lo que siga cargando para ver solicitudes tardías
  const filas = [];
  for (const { r, ini } of reqs) { const resp = await r.response().catch(() => null), st = resp ? await resp.headerValue("server-timing").catch(() => null) : null, t = r.timing(); filas.push({ m: r.method(), ruta: r.url().replace(url, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").slice(0, 60), sale: ini - tClick, fin: (fin.get(r) ?? Date.now()) - tClick, esperaRed: t && t.responseStart > 0 ? Math.round(t.responseStart) : null, fn: num(st, "fn"), db: num(st, "db"), consultas: /(\d+) consultas/.exec(st ?? "")?.[1] ?? null, dfxEnv: num(st, "dfx_envio"), dfxTok: num(st, "dfx_token"), dfxOtro: num(st, "dfx_otro"), prevuelo: num(st, "prevuelo"), dfxTotal: num(st, "dfx_total"), arranque: num(st, "arranque") }); }
  const tiempos = await p.evaluate(() => globalThis.__felTiempos ?? null), total = tEmitido - tClick;
  const principal = filas.filter((f) => /certificar-todo/.test(f.ruta)).pop(), guardar = filas.find((f) => f.m === "POST" && /\/api\/documentos$/.test(f.ruta));
  await ctx.close(); return { total, filas, tiempos, errores, principal, guardar, tEmitido: tEmitido - tClick };
}
(async () => {
  const nav = await lanzar(), res = {};
  try {
    for (const perfil of PERFILES) {
      console.log(`\n== ${perfil.nombre} ==`); res[perfil.nombre] = [];
      for (let n = 1; n <= 3; n++) {
        let c; try { c = await corrida(nav, perfil, n); } catch (e) { console.log(`  corrida ${n}: ERROR ${String(e.message).split("\n")[0].slice(0, 160)}`); continue; }
        res[perfil.nombre].push(c);
        console.log(`  corrida ${n}: TOQUE → «Documento emitido» = ${c.total} ms${n === 1 ? "  (primera: puede incluir arranque en frío de la función)" : ""}${c.errores.length ? ` · errores de consola: ${c.errores.length}` : ""}`);
        console.log("     | solicitud                                   | sale | termina | espera red | fn | db (consultas) | dfx token | dfx envío | dfx otros (suma) | chequeo previo (pared) | dfx total (pared) | arranque |");
        for (const f of c.filas) console.log(`     | ${(f.m + " " + f.ruta).padEnd(44)} | ${String(f.sale).padStart(4)} | ${String(f.fin).padStart(7)} | ${String(f.esperaRed ?? "–").padStart(10)} | ${String(f.fn ?? "–").padStart(2)} | ${String(f.db ?? "–")}${f.consultas ? ` (${f.consultas})` : ""} | ${f.dfxTok ?? "–"} | ${f.dfxEnv ?? "–"} | ${f.dfxOtro ?? "–"} | ${f.prevuelo ?? "–"} | ${f.dfxTotal ?? "–"} | ${f.arranque ?? "–"} |`);
        if (c.principal) { const p = c.principal, resto = c.total - p.fin; console.log(`     desglose: antes de enviar «certificar-todo» ${p.sale} ms (validación + guardar${c.guardar ? ` ${c.guardar.fin - c.guardar.sale} ms` : ""}) · petición «certificar-todo» ${p.fin - p.sale} ms (función ${p.fn ?? "?"} ms; red y espera ${p.fin - p.sale - (p.fn ?? 0)} ms) · de la respuesta a «Documento emitido» (render) ${resto} ms`); }
        if (c.tiempos) console.log(`     reloj de la propia pantalla: total ${c.tiempos.totalMs} ms · Digifact ${c.tiempos.digifactMs} ms · NEXA ${c.tiempos.nexaMs} ms`);
      }
    }
    console.log("\nRESUMEN (mediana; mín–máx) — TOQUE → «Documento emitido»");
    for (const [nombre, cs] of Object.entries(res)) { if (!cs.length) { console.log(`  ${nombre}: sin corridas`); continue; } const t = cs.map((c) => c.total), mm = (v) => `${mediana(v)} (${Math.min(...v)}–${Math.max(...v)})`; console.log(`  ${nombre} (${cs.length}): ${mm(t)} ms · petición certificar-todo ${mm(cs.filter((c) => c.principal).map((c) => c.principal.fin - c.principal.sale))} ms · render tras la respuesta ${mm(cs.filter((c) => c.principal).map((c) => c.total - c.principal.fin))} ms · solicitudes en el intervalo: ${mm(cs.map((c) => c.filas.length))}`); }
  } finally { await nav.close(); }
})().catch((e) => { console.error("medición de interfaz:", String(e.message).slice(0, 200)); process.exit(0); });
