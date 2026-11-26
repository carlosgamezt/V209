// PRIMERA CERTIFICACIÓN TRAS INACTIVIDAD, con y sin el calentamiento de Digifact, contra la demostración publicada (modo «probar», solo si se pide):
//   FEL_DEMO_URL=https://<nombre>.pages.dev FEL_DEMO_CLAVES='ana=…' FEL_MEDIR_INACTIVIDAD_S=600 node nube/medir_frio.cjs   (requiere playwright-core y Chrome)
// Cada ronda espera la inactividad con el navegador cerrado (nada mantiene caliente la función), luego repite el recorrido completo de la persona (entrar, abrir «Nueva factura», elegir CF, agregar concepto, esperar
// FEL_MEDIR_ESPERA_MS como quien escribe) y pulsa «Guardar y certificar en TEST». Condición «sin»: se bloquea la solicitud de calentamiento. Condición «con»: se deja salir. Después de cada primera, una certificación «siguiente» sin inactividad.
// Teléfono emulado (+120 ms, 5/2 Mbps, CPU 4×). Documentos de PRUEBA (Digifact TEST). No imprime contraseñas, tokens ni cookies.
const { chromium } = require("playwright-core");
const url = (process.env.FEL_DEMO_URL ?? "").replace(/\/$/, ""), clave = Object.fromEntries((process.env.FEL_DEMO_CLAVES ?? "").split(",").filter(Boolean).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)])).ana;
if (!url || !clave) { console.error("Faltan FEL_DEMO_URL o la clave de ana."); process.exit(1); }
const INACT = Number(process.env.FEL_MEDIR_INACTIVIDAD_S ?? 600), RONDAS = Number(process.env.FEL_MEDIR_RONDAS ?? 2), ESPERA = Number(process.env.FEL_MEDIR_ESPERA_MS ?? 8000);
const num = (s, k) => { const m = new RegExp(`${k};dur=([\\d.]+)`).exec(s ?? ""); return m ? Math.round(Number(m[1])) : 0; };
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
async function lanzar() { for (const o of [...(process.env.FEL_CHROME ? [{ executablePath: process.env.FEL_CHROME }] : []), { channel: "chrome" }, { executablePath: "/usr/bin/google-chrome" }, { executablePath: "/usr/bin/chromium" }, {}]) { try { return await chromium.launch({ ...o, args: ["--no-sandbox"] }); } catch { /* siguiente */ } } throw new Error("no hay Chrome disponible"); }
async function una(nav, sinCalentar) {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-GT" }), p = await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  if (sinCalentar) await p.route(/\/api\/digifact\/calentar/, (r) => r.abort());
  let calentar = null; p.on("response", async (r) => { if (/\/api\/digifact\/calentar/.test(r.url())) { const st = await r.headerValue("server-timing").catch(() => null); calentar = { fn: num(st, "fn"), token: num(st, "dfx_token") }; } });
  await p.goto(url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", clave); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");
  await p.goto(url + "/#/nueva"); await p.waitForSelector('input[aria-label="Identificación del receptor"]'); await p.click('.seg-tipo [data-tipo="CF"]');
  const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it"); await p.waitForTimeout(ESPERA);
  const cdp = await ctx.newCDPSession(p); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 120, downloadThroughput: 5_000_000 / 8, uploadThroughput: 2_000_000 / 8 }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let st = null; p.on("response", async (r) => { if (/certificar-todo/.test(r.url())) st = await r.headerValue("server-timing").catch(() => null); });
  const t0 = Date.now(); await p.tap("#guardar-certificar", { timeout: 30000 }); await p.waitForSelector('[data-panel="emitido"]', { state: "visible", timeout: 90000 }); const total = Date.now() - t0;
  await p.waitForTimeout(500); await ctx.close();
  return { total, fn: num(st, "fn"), token: num(st, "dfx_token"), envio: num(st, "dfx_envio"), otro: num(st, "dfx_otro"), prevuelo: num(st, "prevuelo"), dfxTotal: num(st, "dfx_total"), db: num(st, "db"), arranque: num(st, "arranque"), calentar };
}
const fila = (e, r) => `  ${e.padEnd(28)} total ${String(r.total).padStart(5)} ms · certificar-todo en función ${r.fn} (token ${r.token}, envío ${r.envio}, otros Digifact ${r.otro}${r.prevuelo ? `, chequeo previo (pared) ${r.prevuelo}` : ""}${r.dfxTotal ? `, Digifact total (pared) ${r.dfxTotal}` : ""}, base ${r.db}, arranque ${r.arranque || "–"})${r.calentar ? ` · calentamiento: función ${r.calentar.fn}, token ${r.calentar.token}` : ""}`;
(async () => {
  const nav = await lanzar(), res = { sin: [], con: [], sig: [] };
  try {
    console.log(`Inactividad ${INACT} s antes de cada primera certificación; ${RONDAS} rondas por condición; espera ${ESPERA} ms entre abrir el formulario y tocar.`);
    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      for (const cond of ronda % 2 ? ["sin", "con"] : ["con", "sin"]) {
        console.log(`\n[ronda ${ronda}] inactividad ${INACT} s…`); await new Promise((r) => setTimeout(r, INACT * 1000));
        try { const a = await una(nav, cond === "sin"); res[cond].push(a.total); console.log(fila(`primera ${cond} calentamiento`, a)); const b = await una(nav, cond === "sin"); res.sig.push(b.total); console.log(fila(`siguiente (${cond})`, b)); } catch (e) { console.log(`  ERROR ${cond}: ${String(e.message).split("\n")[0].slice(0, 160)}`); }
      }
    }
    console.log("\nRESUMEN — TOQUE → «Documento emitido» (ms)");
    for (const [k, t] of [["primera SIN calentamiento", res.sin], ["primera CON calentamiento", res.con], ["siguientes (sin inactividad)", res.sig]]) console.log(`  ${k.padEnd(30)} n=${t.length} · mediana ${mediana(t)} · valores ${t.join(", ")}`);
  } finally { await nav.close(); }
})().catch((e) => { console.error("medición en frío:", String(e.message).slice(0, 200)); process.exit(0); });
