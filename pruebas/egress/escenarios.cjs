/* Mide el consumo (solicitudes y bytes) de la app de Nexa con Supabase SIMULADO, con datos y escenarios idénticos para cualquier versión.
   Uso: node escenarios.cjs --root <carpeta con index.html> --out <resultado.json> [--extra <server_extra.js>] [--quick]  */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root', '../../nexa')), OUT = arg('out', '/tmp/egress_medicion.json'), EXTRA = arg('extra', ''), QUICK = process.argv.includes('--quick'), SPAN = QUICK ? 15 : +arg('span', 60), F = 60 / SPAN;
const DATA = JSON.parse(arg('data', '{"maxPlans":120,"acts":4,"thumbs":8,"notifs":1200,"arqueos":300,"descargas":1500,"mensual":600}'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ v: m ? m[1] : 'v0' })) } const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = EXTRA ? fs.readFileSync(EXTRA, 'utf8') : '';
const MIN = 60000, H = 60 * MIN;
async function nuevo(browser, port, user, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const fnlog = [];
  await page.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: "window.PA_CONFIG={url:'https://fake.supabase.co',key:'fake-publishable',cache:" + JSON.stringify(arg('cache', '') === 'true' ? true : (arg('cache', '') || false)) + "};" }));
  await page.route('**/functions/v1/**', async r => { const b = JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }); fnlog.push(b.length + 600); await r.fulfill({ contentType: 'application/json', body: b }) });
  await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...DATA, user, caps: opts.caps || DATA.caps || {} } });
  { const c = arg('cache', ''); await page.addInitScript(({ C, OD, RC }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = RC ? x : Object.assign({}, x, { odDirect: OD, cache: C, cacheRoles: undefined }) } }) }, { C: c === 'true' ? true : (c || false), OD: !process.argv.includes('--odoff'), RC: process.argv.includes('--realcfg') }) }
  if (XTRA) await page.addInitScript(XTRA);
  await page.addInitScript(FAKE);
  await page.addInitScript(() => { Object.defineProperty(document, 'hidden', { get: () => !!window.__hid, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => window.__hid ? 'hidden' : 'visible', configurable: true }) });
  if (!opts.noClock) await page.clock.install({ time: new Date('2026-11-27T14:00:00Z') });
  page.on('pageerror', e => (page.__errs = page.__errs || []).push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => typeof me !== 'undefined' && me && typeof db !== 'undefined' && db, null, { timeout: 120000 });
  page.__fn = fnlog; return page;
}
const sum = (page, by) => page.evaluate(b => __EG.api.summary(b), by);
const tot = o => Object.values(o).reduce((a, s) => ({ n: a.n + s.n, raw: a.raw + s.raw, gz: a.gz + s.gz }), { n: 0, raw: 0, gz: 0 });
async function avanzar(page, ms, others, activo = true) { // ms de reloj simulado, con actividad de OTRAS personas por hora (others={plans,notifs})
  const steps = Math.ceil(ms / MIN); let i = 0; const pp = others ? others.plans / (H / MIN) : 0, pn = others ? others.notifs / (H / MIN) : 0; let ap = 0, an = 0;
  for (let s = 0; s < steps; s++) { if (activo) await page.evaluate(() => ['mousemove', 'keydown'].forEach(t => { document.dispatchEvent(new Event(t, { bubbles: true })); window.dispatchEvent(new Event(t)) })); await page.clock.runFor(Math.min(MIN, ms - s * MIN)); ap += pp; an += pn; while (ap >= 1) { ap--; await page.evaluate(k => __EG.api.othersTouchPlan(k), i++) } while (an >= 1) { an--; await page.evaluate(k => __EG.api.othersAddNotif(k), i++) } }
}
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; const browser = await chromium.launch(); const R = { datos: DATA, root: ROOT, escenarios: {} }; const t0 = Date.now();
  const log = (k, v) => { R.escenarios[k] = v; console.log(k, JSON.stringify(v.total || v)) };
  for (const [user, etq] of [['admin', 'admin'], ['supRoleBranch', 'sucursal']]) {
    let u = user; if (user === 'supRoleBranch') { const tmp = await nuevo(browser, port, 'admin', { noClock: true }); u = await tmp.evaluate(() => __EG.api.db.__users.find(x => x.role === 'sucursal').id); await tmp.context().close() }
    // 1) inicio de sesión (carga inicial)
    let page = await nuevo(browser, port, u); const ini = await sum(page, 'table'); const iniT = tot(ini);
    const nplans = await page.evaluate(() => db.plans.length); log('login_' + etq, { total: iniT, porTabla: ini, planesVisibles: nplans });
    // 2) consumo de cargar planes y detalle de evidencias (abrir el primer plan)
    await page.evaluate(() => __EG.api.reset()); await page.evaluate(() => __EG.api.mark('detalle'));
    await page.evaluate(async () => { const p = db.plans[0]; if (p) { try { go('plans') } catch (e) { } await new Promise(r => setTimeout(r, 50)); try { verPlan(p.id) } catch (e) { } } }); await page.clock.runFor(3000);
    log('detalle_plan_' + etq, { total: tot(await sum(page, 'kind')), porTabla: await sum(page, 'table') });
    // 3) 1 hora con la app abierta y visible (con actividad de otros: 12 planes y 6 avisos por hora)
    await page.evaluate(() => { __EG.api.reset(); __EG.api.mark('hora_visible') }); await avanzar(page, SPAN * MIN, { plans: 12, notifs: 6 }); const f = F;
    const hv = await sum(page, 'kind'); log('hora_visible_' + etq, { total: scale(tot(hv), f), porTipo: hv, porTabla: await sum(page, 'table'), nota: SPAN + ' min simulados ×' + F });
    // 4) 1 hora en segundo plano (pestaña oculta)
    await page.evaluate(() => { window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); __EG.api.reset(); __EG.api.mark('hora_oculta') }); await avanzar(page, SPAN * MIN, { plans: 12, notifs: 6 });
    const ho = await sum(page, 'kind'); log('hora_segundo_plano_' + etq, { total: scale(tot(ho), f), porTipo: ho, porTabla: await sum(page, 'table') });
    await page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')) });
    // 5) arqueos: abrir la pantalla y dejarla 10 minutos
    if (etq === 'admin') { await page.evaluate(() => { __EG.api.reset(); __EG.api.mark('arqueos') }); await page.evaluate(() => { try { go('arqueos') } catch (e) { } }); await avanzar(page, 10 * MIN); log('arqueos_10min_' + etq, { total: tot(await sum(page, 'kind')), porTabla: await sum(page, 'table') });
      await page.evaluate(() => { __EG.api.reset(); __EG.api.mark('descargas') }); await page.evaluate(() => { try { go('hist') } catch (e) { } }); await avanzar(page, 10 * MIN); log('historial_10min_' + etq, { total: tot(await sum(page, 'kind')), porTabla: await sum(page, 'table') }) }
    // 6) pérdida de Realtime y recuperación (10 min caído con actividad de otros, luego reconexión)
    await page.evaluate(() => { __EG.api.reset(); __EG.api.mark('realtime_caido'); __EG.api.realtimeDown() }); await avanzar(page, 10 * MIN, { plans: 12, notifs: 6 }); await page.evaluate(() => __EG.api.realtimeUp()); await avanzar(page, 2 * MIN);
    const cons = await page.evaluate(() => { const l = __EG.api.db.pa_docs.filter(d => d.col === 'plans'); return { plansServidor: l.length } }); log('realtime_caido_10min_' + etq, { total: tot(await sum(page, 'kind')), porTabla: await sum(page, 'table'), ...cons });
    R.escenarios['errores_' + etq] = page.__errs || []; await page.context().close();
  }
  // 7) dos pestañas del mismo navegador (admin) 30 minutos visibles
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }); const a = await nuevo(browser, port, 'admin', { ctx }), b = await nuevo(browser, port, 'admin', { ctx });
    await a.evaluate(() => { __EG.api.reset(); __EG.api.mark('dos_pestanas') }); await b.evaluate(() => { __EG.api.reset(); __EG.api.mark('dos_pestanas') });
    for (let i = 0; i < (QUICK ? 5 : 30); i++) { await a.clock.runFor(MIN); await b.clock.runFor(MIN) }
    const sa = tot(await sum(a, 'kind')), sb = tot(await sum(b, 'kind')); log('dos_pestanas_30min', { total: { n: sa.n + sb.n, raw: sa.raw + sb.raw, gz: sa.gz + sb.gz }, pestanaA: sa, pestanaB: sb }); await ctx.close() }
  R.segundos = Math.round((Date.now() - t0) / 1000); fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1) });
function scale(t, f) { return { n: Math.round(t.n * f), raw: Math.round(t.raw * f), gz: Math.round(t.gz * f) } }
