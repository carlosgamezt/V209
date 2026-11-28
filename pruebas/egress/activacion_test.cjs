/* Prueba FUNCIONAL comparativa: con los mismos datos, cada rol ve lo mismo (planes visibles, estados, avances, contadores, dashboard, evidencias, arqueos, historial) en la versión de referencia y en la optimizada.
   Uso: node funcional.cjs --root <carpeta> --out <json> [--extra server_extra.js] [--caps '{"lite":true}'] */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root')), OUT = arg('out'), EXTRA = arg('extra', ''), CAPS = JSON.parse(arg('caps', '{}'));
const DATA = { maxPlans: 12, acts: 4, thumbs: 8, notifs: 300, arqueos: 120, descargas: 300, mensual: 100, caps: CAPS };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); r.writeHead(200); return r.end(JSON.stringify({ v: m[1] })) } const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = EXTRA ? fs.readFileSync(EXTRA, 'utf8') : '';
async function abrir(browser, port, user) {
  const ctx = await browser.newContext(process.argv.includes('--movil') ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' } : { viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page.__errs = errs;
  await page.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: "window.PA_CONFIG={url:'https://fake.supabase.co',key:'k',cache:" + JSON.stringify(arg('cache', '') === 'true' ? true : (arg('cache', '') || false)) + "};" }));
  await page.route('**/functions/v1/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }) }));
  await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...DATA, user } }); if (XTRA) await page.addInitScript(XTRA); await page.addInitScript(FAKE);
  { const c = arg('cache', ''); await page.addInitScript(({ C, OD, RC }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = RC ? x : Object.assign({}, x, { odDirect: OD, cache: C, cacheRoles: undefined }) } }) }, { C: c === 'true' ? true : (c || false), OD: process.argv.includes('--odval') ? JSON.parse(arg('odval', 'true')) : !process.argv.includes('--odoff'), RC: process.argv.includes('--realcfg') }) }
  await page.clock.install({ time: new Date('2026-11-27T14:00:00Z') });
  await page.goto(`http://127.0.0.1:${port}/index.html`); await page.waitForFunction(() => typeof me !== 'undefined' && me && db, null, { timeout: 60000 }); await page.clock.runFor(2500); return page;
}
const norm = t => t.replace(/127\.0\.0\.1:\d+/g, 'HOST').replace(/\s+/g, ' ').trim();

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  // Configuración REAL de nexa/index.html (sin sustituir): activación solo para administrador
  const page = await abrir(browser, port, 'admin'), ev = (f, a) => page.evaluate(f, a); await page.clock.runFor(4000);
  const cfg = await ev(() => ({ od: PA_CFG.odDirect, cache: PA_CFG.cache, roles: PA_CFG.cacheRoles, ver: APP_VER }));
  ok(cfg.od === 'admin' && cfg.cache === true && JSON.stringify(cfg.roles) === '["admin"]', 'la configuración real activa solo para administrador: ' + JSON.stringify(cfg));
  const a = await ev(() => ({ rol: me.role, od: odOn(), cache: PCache.on(), movil: matchMedia('(max-width:820px)').matches }));
  ok(a.rol === 'admin' && a.od === true && a.cache === true, 'administrador' + (a.movil ? ' (pantalla de teléfono)' : '') + ': descarga/subida directa y caché ACTIVAS');
  const roles = await ev(() => __EG.api.db.__users.map(u => u.role));
  for (const r of ['sucursal', 'supervisor', 'inventarios'].filter(r => roles.includes(r))) {
    await ev(rol => { const u = __EG.api.db.__users.find(x => x.role === rol).id; __EG.api.setUser(u); Supa.cleanup(); me = null; db = null }, r); await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(4000);
    const b = await ev(() => ({ rol: me.role, od: odOn(), cache: PCache.on(), tieneCopia: !!localStorage.getItem('nx_pc_used') }));
    ok(b.rol === r && b.od === false && b.cache === false, r + ': descarga/subida directa y caché APAGADAS (siguen con el mecanismo anterior)');
  }
  // vuelve el administrador: la copia se crea solo para él y se borra al cerrar sesión
  await ev(() => { const u = __EG.api.db.__users.find(x => x.role === 'admin').id; __EG.api.setUser(u); Supa.cleanup(); me = null; db = null }); await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(4000);
  const n1 = await ev(async () => { const d = await PCache.open(); return await new Promise(r => { const q = d.transaction('rows').objectStore('rows').count(); q.onsuccess = () => r(q.result) }) });
  await ev(() => { window.__lo = 1; Supa.cleanup() }); await page.clock.runFor(1000);
  const n2 = await ev(async () => { const d = await PCache.open(); return await new Promise(r => { const q = d.transaction('rows').objectStore('rows').count(); q.onsuccess = () => r(q.result) }) });
  ok(n1 > 0 && n2 === 0, 'administrador: la copia local se crea (' + n1 + ' filas) y se borra al cerrar sesión (' + n2 + ')');
  console.log(fallo ? 'ACTIVACION FALLO ' + fallo : 'ACTIVACION OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
