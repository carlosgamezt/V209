/* Prueba FUNCIONAL comparativa: con los mismos datos, cada rol ve lo mismo (planes visibles, estados, avances, contadores, dashboard, evidencias, arqueos, historial) en la versión de referencia y en la optimizada.
   Uso: node funcional.cjs --root <carpeta> --out <json> [--extra server_extra.js] [--caps '{"lite":true}'] */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root')), OUT = arg('out'), EXTRA = arg('extra', ''), CAPS = JSON.parse(arg('caps', '{}'));
const DATA = { maxPlans: 60, acts: 4, thumbs: 8, notifs: 300, arqueos: 120, descargas: 300, mensual: 100, caps: CAPS };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); r.writeHead(200); return r.end(JSON.stringify({ v: m[1] })) } const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = EXTRA ? fs.readFileSync(EXTRA, 'utf8') : '';
async function abrir(browser, port, user) {
  const ctx = await browser.newContext(process.argv.includes('--movil') ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' } : { viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page.__errs = errs;
  await page.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: "window.PA_CONFIG={url:'https://fake.supabase.co',key:'k',cache:" + JSON.stringify(arg('cache', '') === 'true' ? true : (arg('cache', '') || false)) + "};" }));
  await page.route('**/functions/v1/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }) }));
  await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...DATA, user } }); if (XTRA) await page.addInitScript(XTRA); await page.addInitScript(FAKE);
  { const c = arg('cache', ''); await page.addInitScript(({ C, OD }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = Object.assign({ odDirect: OD }, x, { cache: C }) } }) }, { C: c === 'true' ? true : (c || false), OD: !process.argv.includes('--odoff') }) }
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
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(), R = {};
  const roles = await (async () => { const p = await abrir(browser, port, 'admin'); const us = await p.evaluate(() => __EG.api.db.__users); await p.context().close(); const by = r => us.find(u => u.role === r); return { admin: 'admin', supervisor: by('supervisor').id, sucursal: by('sucursal').id, inventarios: by('inventarios').id, visualizador: by('visualizador').id } })();
  for (const [rol, uid] of Object.entries(roles)) {
    const page = await abrir(browser, port, uid); const o = R[rol] = {};
    o.planesVisibles = await page.evaluate(() => db.plans.map(p => p.id).sort()); o.avisos = await page.evaluate(() => db.notifs.length); o.sinLeer = await page.evaluate(() => unread().length);
    o.estados = await page.evaluate(() => Object.fromEntries(db.plans.map(p => [p.id, [stl(p), prog(p).pct, p.acts.length]])));
    const vs = await page.evaluate(() => PERMS[me.role].views); o.vistas = {};
    for (const v of vs) { try { o.vistas[v] = await vista(page, v) } catch (e) { o.vistas[v] = { error: String(e) } } }
    // detalle de un plan: texto y miniaturas
    const id = o.planesVisibles[0]; if (id) { await page.evaluate(i => { go('plans'); verPlan(i) }, id); await page.clock.runFor(3000); o.detalle = { texto: norm(await page.evaluate(() => document.querySelector('#app').innerText)), fotos: await foto(page) } }
    o.errores = page.__errs; await page.context().close();
  }
  // escritura: la sucursal sube una foto de evidencia y el administrador la ve en otra sesión
  { const suc = roles.sucursal, page = await abrir(browser, port, suc); const w = {};
    const r = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 640, 480); const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .8)); const f = new File([b], 'e.jpg', { type: 'image/jpeg' }); const ph = await procPhoto(f, 'ev'); const p = db.plans.find(p => p.acts.some(a => a.st === 'Pendiente')); const a = p.acts.find(a => a.st === 'Pendiente'); a.ev = ph; a.st = 'Enviada'; save(); return { plan: p.id, k: ph.k } });
    await page.clock.runFor(3000); w.plan = r.plan; w.servidorSinImagenEnData = await page.evaluate(({ plan }) => { const d = __EG.api.db.pa_docs.find(x => x.col === 'plans' && x.id === plan); const tiene = JSON.stringify(d.data).includes('data:image/'); return { tieneImagenEmbebida: tiene, acts: d.data.acts.map(a => a.st) } }, r);
    w.miniaturaEnServidor = await page.evaluate(({ k }) => (__EG.api.db.pa_thumbs || []).some(t => t.k === k) || JSON.stringify(__EG.api.db.pa_docs.map(d => d.data)).includes('"k":"' + k + '","t":"data:image'), r);
    await page.evaluate(i => { go('plans'); verPlan(i) }, r.plan); await page.clock.runFor(3000); w.fotosTrasGuardar = await foto(page);
    if (await page.evaluate(() => typeof TH !== 'undefined')) { await page.evaluate(async () => { TH.mem.clear(); const d = await Photos.open(); await new Promise(r => { const t = d.transaction('p', 'readwrite'); t.objectStore('p').clear(); t.oncomplete = r }); db.plans.forEach(p => p.acts.forEach(a => { if (a.ev) delete a.ev.t; if (a.ref) delete a.ref.t })); render() }); await page.clock.runFor(3000); w.fotosSinCacheLocal = await foto(page) }
    await page.context().close(); R.escritura = w }
  // recarga completa con el mismo servidor: las fotos siguen visibles (sin copias locales: contexto nuevo)
  fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); await browser.close(); srv.close(); console.log('listo', OUT);
})().catch(e => { console.error(e); process.exit(1) });
