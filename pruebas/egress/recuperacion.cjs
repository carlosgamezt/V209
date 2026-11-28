/* Prueba FUNCIONAL comparativa: con los mismos datos, cada rol ve lo mismo (planes visibles, estados, avances, contadores, dashboard, evidencias, arqueos, historial) en la versión de referencia y en la optimizada.
   Uso: node funcional.cjs --root <carpeta> --out <json> [--extra server_extra.js] [--caps '{"lite":true}'] */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root')), OUT = arg('out'), EXTRA = arg('extra', ''), CAPS = JSON.parse(arg('caps', '{}'));
const DATA = { maxPlans: 40, acts: 4, thumbs: 8, notifs: 300, arqueos: 120, descargas: 300, mensual: 100, caps: CAPS };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); r.writeHead(200); return r.end(JSON.stringify({ v: m[1] })) } const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = EXTRA ? fs.readFileSync(EXTRA, 'utf8') : '';
async function abrir(browser, port, user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page.__errs = errs;
  await page.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: "window.PA_CONFIG={url:'https://fake.supabase.co',key:'k',cache:" + JSON.stringify(arg('cache', '') === 'true' ? true : (arg('cache', '') || false)) + "};" }));
  await page.route('**/functions/v1/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }) }));
  await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...DATA, user } }); if (XTRA) await page.addInitScript(XTRA); await page.addInitScript(FAKE); await page.addInitScript(() => { Object.defineProperty(document, 'hidden', { get: () => !!window.__hid, configurable: true }); Object.defineProperty(document, 'visibilityState', { get: () => window.__hid ? 'hidden' : 'visible', configurable: true }) });
  { const c = arg('cache', ''); await page.addInitScript(({ C, OD, RC }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = RC ? x : Object.assign({}, x, { odDirect: OD, cache: C, cacheRoles: undefined }) } }) }, { C: c === 'true' ? true : (c || false), OD: !process.argv.includes('--odoff'), RC: process.argv.includes('--realcfg') }) }
  await page.clock.install({ time: new Date('2026-11-27T14:00:00Z') });
  await page.goto(`http://127.0.0.1:${port}/index.html`); await page.waitForFunction(() => typeof me !== 'undefined' && me && db, null, { timeout: 60000 }); await page.clock.runFor(2500); return page;
}
const norm = t => t.replace(/127\.0\.0\.1:\d+/g, 'HOST').replace(/\s+/g, ' ').trim();
async function foto(page) { return page.evaluate(() => { const i = [...document.querySelectorAll('img[data-tk], img.th')]; return { total: i.length, conImagen: i.filter(x => /^data:image\/jpeg/.test(x.src)).length } }) }
async function recorrer(page) { // baja por toda la pantalla (como una persona) para que carguen las imágenes perezosas
  for (let i = 0; i < 40; i++) { const fin = await page.evaluate(() => { const els = [document.scrollingElement, ...[...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 80 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))]; let mov = false; els.forEach(e => { const y = e.scrollTop; e.scrollTop = y + 350; if (e.scrollTop !== y) mov = true }); return !mov }); await page.clock.runFor(400); if (fin) break }
  for (let i = 0; i < 40; i++) { const fin = await page.evaluate(() => { const els = [document.scrollingElement, ...[...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 80 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))]; let mov = false; els.forEach(e => { const y = e.scrollTop; e.scrollTop = Math.max(0, y - 350); if (e.scrollTop !== y) mov = true }); return !mov }); await page.clock.runFor(400); if (fin) break }
  await page.clock.runFor(1500) }
async function vista(page, v) { await page.evaluate(x => { try { go(x) } catch (e) { } }, v); await page.clock.runFor(5000); await page.evaluate(() => window.scrollTo(0, 0)); const t = norm(await page.evaluate(() => document.querySelector('#app').innerText)); const f0 = await foto(page); await recorrer(page); return { texto: t, fotosArriba: f0, fotos: await foto(page) } }
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(), R = {}; let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const page = await abrir(browser, port, 'admin'); const ev = f => page.evaluate(f);
  // 1) Realtime activo: el cambio de otra persona llega SIN consultas periódicas
  await ev(() => { __EG.api.reset(); __EG.api.mark('rt') }); await ev(() => __EG.api.othersTouchPlan(3)); await page.clock.runFor(2000);
  ok(await ev(() => db.plans.some(p => /Actividad editada/.test(p.acts[0].text))), 'con Realtime activo el cambio de otra persona aparece al instante');
  // 2) Realtime se cae: cambios, avisos y un BORRADO de otra persona ocurren mientras no hay conexión
  await ev(() => { __EG.api.realtimeDown(); const d = __EG.api.db.pa_docs, i = d.findIndex(x => x.col === 'plans' && x.id === 'PA-2026-005'); d.splice(i, 1); __EG.api.othersTouchPlan(7); __EG.api.othersAddNotif(2) });
  const n0 = await ev(() => db.notifs.length), tiene0 = await ev(() => db.plans.some(p => p.id === 'PA-2026-005'));
  await ev(() => { __EG.api.reset() }); await page.clock.runFor(95000); console.log('      depuración reqs 95s:', JSON.stringify(await ev(() => ({ log: __EG.api.net.log.map(e => e.table + ':' + e.op), rt: Supa.rt && { ok: Supa.rt.ok, d: Supa.rt.dropped }, rlt: Supa.rlt, now: Date.now(), lfull: Supa.lfull, max: Supa.maxUa, busy: Supa.rbusy, hold: Supa.hold && [...Supa.hold.values()].length }))));   // 95 s: el sondeo de respaldo (60 s, incremental) debe traer lo nuevo
  ok(await ev(() => db.notifs.length) === n0 + 1, 'con Realtime caído, el sondeo de respaldo incremental trae el aviso nuevo (<= 60 s)');
  ok(await ev(() => db.plans.some(p => p.id === 'PA-2026-005')) === tiene0 && tiene0, 'el borrado todavía no se ve (el incremental no detecta borrados; se corrige al recuperar)');
  // 3) vuelve Realtime: UNA sincronización completa detecta el borrado
  await ev(() => { __EG.api.reset(); __EG.api.mark('recuperacion'); __EG.api.realtimeUp() }); await page.clock.runFor(4000);
  ok(!(await ev(() => db.plans.some(p => p.id === 'PA-2026-005'))), 'al recuperar Realtime se hace una sincronización completa y el plan borrado desaparece');
  const rs = await ev(() => __EG.api.summary('table')); console.log('      solicitudes de la recuperación:', JSON.stringify(rs));
  // 4) el canal no vuelve solo en 45 s: la app lo recrea
  await ev(() => { __EG.api.realtimeDown() }); const l0 = await ev(() => (window.__pendingSubs || []).length); await page.clock.runFor(50000); const l1 = await ev(() => (window.__pendingSubs || []).length);
  ok(l1 > l0, 'si Realtime no vuelve en 45 s la app recrea la suscripción (' + l0 + ' -> ' + l1 + ' pendientes)');
  // 5) segundo plano: sin consultas
  await ev(() => { window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); __EG.api.reset() }); await page.clock.runFor(600000, 0).catch(() => { });
  await page.evaluate(() => ['mousemove'].forEach(t => document.dispatchEvent(new Event(t)))); const bg = await ev(() => __EG.api.net.log.filter(e => e.kind === 'rest').length);
  ok(bg === 0, 'en segundo plano (10 min) la app no hace ninguna consulta REST (' + bg + ')');
  console.log(fallo ? 'RECUPERACION FALLO ' + fallo : 'RECUPERACION OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
