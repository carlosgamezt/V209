/* Matriz de consumo por versión y tamaño (usuarios), con datos equivalentes. Uso: node escala.cjs --out resultados/escala.json [--quick]
   Versiones: v512 · v513 (P0) · v513+E1 · v513+E1+E2 · v514 completa (E1+E2+caché 'dispositivo'+arqueos incrementales). Tamaños: sucursales B = 26, 75, 190, 375, 750 (≈ 35, 100, 250, 500, 1000 usuarios activos mensuales).
   Las versiones sin lectura ligera se miden hasta B=190 (con más datos el navegador no puede cargar el volumen); más allá se extrapolan con el ajuste de lo medido (y se marca). */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const REAL = process.argv.includes('--real'), OUT = arg('out', 'resultados/escala.json'), QUICK = process.argv.includes('--quick'), ONLY = arg('only', '');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = fs.readFileSync(path.join(__dirname, 'server_extra.js'), 'utf8');
const VERS_ALL = [['v512', '/tmp/baseline/nexa', {}, ''], ['v513_P0', '/tmp/pub/nexa', {}, ''], ['v513_E1', '/tmp/pub/nexa', { lite: true }, ''], ['v513_E1_E2', '/tmp/pub/nexa', { lite: true, compact: true }, ''], ['v514_completa', '/home/user/V209/nexa', { lite: true, compact: true }, 'dispositivo']];
const VERS = (process.argv.includes('--real') ? VERS_ALL.filter(x => x[0] !== 'v513_E1_E2') : VERS_ALL); const SCALES = QUICK ? [26, 75] : REAL ? [27, 92, 242, 492, 992] : [26, 75, 190, 375, 750]; const MAXNL = REAL ? 242 : 190; const MIN = 60000, SPAN = 10, F = 60 / SPAN;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
function serve(root) { return new Promise(r => { const s = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8')); res.writeHead(200); return res.end(JSON.stringify({ v: m[1] })) } const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)) }); s.listen(0, '127.0.0.1', () => r(s)) }) }
async function abrir(browser, port, user, B, caps, cache) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }), page = await ctx.newPage(); page.__errs = []; page.on('pageerror', e => page.__errs.push(String(e)));
  await page.route('**/functions/v1/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }) })); await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  const data = REAL ? { branchCount: B, maxPlans: B, maxTotal: Math.round(B * 5.4), photoPlanRatio: 48 / 146, plansPerBranch: 6, acts: 4, thumbs: 8, notifs: Math.round(B * 37), notifLeidoFrac: 247 / 996, notifViejoFrac: 169 / 247, arqueos: Math.max(16, Math.round(B * 0.6)), descargas: Math.max(18, Math.round(B * 0.7)), mensual: 477, caps } : { branchCount: B, maxPlans: B * 4, plansPerBranch: 1, acts: 3, thumbs: 8, notifs: B * 20, arqueos: Math.min(B * 6, 1500), descargas: B * 5, mensual: 600, caps };
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...data, user } });
  await page.addInitScript(({ C }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = Object.assign({ odDirect: true }, x, { cache: C }) } }) }, { C: cache || false });
  await page.addInitScript(XTRA); await page.addInitScript(FAKE);
  await page.addInitScript(() => { Object.defineProperty(document, 'hidden', { get: () => !!window.__hid, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => window.__hid ? 'hidden' : 'visible', configurable: true }) });
  await page.clock.install({ time: new Date('2026-11-27T14:00:00Z') }); const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html`); await page.waitForFunction(() => typeof me !== 'undefined' && me && db, null, { timeout: 600000 }); page.__ms = Date.now() - t0; return page;
}
const tot = async page => page.evaluate(() => __EG.api.net.log.reduce((a, e) => ({ n: a.n + 1, raw: a.raw + e.raw, gz: a.gz + e.gz }), { n: 0, raw: 0, gz: 0 }));
async function avanzar(page, ms, B) { const pp = 0.5 * B / 60, pn = 0.25 * B / 60; let ap = 0, an = 0, i = 0; for (let s = 0; s < ms / MIN; s++) { await page.evaluate(() => ['mousemove', 'keydown'].forEach(t => { document.dispatchEvent(new Event(t, { bubbles: true })); window.dispatchEvent(new Event(t)) })); await page.clock.runFor(MIN); ap += pp; an += pn; while (ap >= 1) { ap--; await page.evaluate(k => __EG.api.othersTouchPlan(k), i++) } while (an >= 1) { an--; await page.evaluate(k => __EG.api.othersAddNotif(k), i++) } } }
(async () => {
  const browser = await chromium.launch(), R = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : { resultados: [] };
  for (const [vn, root, caps, cache] of VERS) { if (ONLY && !ONLY.split(',').includes(vn)) continue; const srv = await serve(root), port = srv.address().port;
    for (const B of SCALES) { const lite = !!caps.lite; if (!lite && B > MAXNL) continue; if (R.resultados.some(x => x.version === vn && x.B === B)) continue;
      const fila = { version: vn, B, plansTotal: B * 4 }; process.stdout.write(vn + ' B=' + B + ' ... ');
      try {
        for (const rol of (arg('roles', 'admin,supervisor,sucursal')).split(',')) {
          let uid = rol; const probe = await abrir(browser, port, 'admin', B, caps, cache); const us = await probe.evaluate(() => __EG.api.db.__users); await probe.context().close(); if (rol === 'supervisor') uid = us.find(u => u.role === 'supervisor').id; if (rol === 'sucursal') uid = us.find(u => u.role === 'sucursal').id;
          process.stdout.write('[' + rol + ' abrir] '); const page = await abrir(browser, port, uid, B, caps, cache); process.stdout.write('[abierto ' + page.__ms + ' ms] '); const o = fila[rol] = {};
          o.login_frio = await tot(page); o.planes = await page.evaluate(() => db.plans.length); o.avisos = await page.evaluate(() => db.notifs.length); o.fotos = await page.evaluate(() => { let n = 0; __EG.api.db.pa_docs.forEach(d => { if (d.col === 'plans') JSON.stringify(d.data).replace(/"k":"(ref|ev)#/g, () => { n++; return '' }) }); return n }); o.cpu_login_ms = page.__ms; await page.clock.runFor(4000);
          // inicio con copia local (misma persona, sin cambios): solo cuenta con caché; sin caché equivale al frío
          await page.evaluate(() => { __EG.api.reset(); Supa.cleanup(); me = null; db = null }); const tw = Date.now(); await page.evaluate(async () => { await Supa.afterLogin() }); await page.clock.runFor(3500); o.login_caliente = await tot(page); o.cpu_caliente_ms = Date.now() - tw;
          process.stdout.write('[hora] '); await page.evaluate(() => __EG.api.reset()); await avanzar(page, SPAN * MIN, B); process.stdout.write('[hora ok] '); const h = await tot(page); o.hora_visible = { n: h.n * F, raw: h.raw * F, gz: h.gz * F };
          if (rol !== 'sucursal') { await page.evaluate(() => { __EG.api.reset(); try { go('arqueos') } catch (e) { } }); await page.clock.runFor(5 * MIN); const a = await tot(page); o.arqueos_5min = a }
          o.errores = page.__errs.slice(0, 3); await page.context().close();
        }
        console.log('ok');
      } catch (e) { console.log('ERROR ' + String(e).slice(0, 120)); fila.error = String(e).slice(0, 200) }
      R.resultados.push(fila); fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); }
    srv.close(); }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1) });
