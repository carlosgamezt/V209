/* Prueba FUNCIONAL comparativa: con los mismos datos, cada rol ve lo mismo (planes visibles, estados, avances, contadores, dashboard, evidencias, arqueos, historial) en la versión de referencia y en la optimizada.
   Uso: node funcional.cjs --root <carpeta> --out <json> [--extra server_extra.js] [--caps '{"lite":true}'] */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root')), OUT = arg('out'), EXTRA = arg('extra', ''), CAPS = JSON.parse(arg('caps', '{}'));
const DATA = { maxPlans: 40, acts: 4, thumbs: 8, notifs: 300, arqueos: 120, descargas: 300, mensual: 100, caps: CAPS };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/version.json') { const m = /APP_VER='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); r.writeHead(200); return r.end(JSON.stringify({ v: m[1] })) } const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
const FAKE = fs.readFileSync(path.join(__dirname, 'fake_supabase.js'), 'utf8'), XTRA = EXTRA ? fs.readFileSync(EXTRA, 'utf8') : '';
async function abrir(browser, port, user) {
  const ctx = await browser.newContext(process.argv.includes('--movil') ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' } : { viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page.__errs = errs;
  await page.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: "window.PA_CONFIG={url:'https://fake.supabase.co',key:'k',cache:" + JSON.stringify(arg('cache', '') === 'true' ? true : (arg('cache', '') || false)) + "};" }));
  await page.route('**/functions/v1/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', exists: true }) }));
  await page.route(/fonts\.(googleapis|gstatic)|jsdelivr/, r => r.abort());
  await page.addInitScript(({ P }) => { window.__EG = P }, { P: { ...DATA, user } }); if (XTRA) await page.addInitScript(XTRA); await page.addInitScript(FAKE);
  { const c = arg('cache', ''); await page.addInitScript(({ C }) => { let v; Object.defineProperty(window, 'PA_CONFIG', { configurable: true, get: () => v, set: x => { v = Object.assign({}, x, { cache: C }) } }) }, { C: c === 'true' ? true : (c || false) }) }
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
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const page = await abrir(browser, port, 'admin'), ev = (f, a) => page.evaluate(f, a);
  await ev(() => { go('arqueos') }); await page.clock.runFor(4000);
  const lite = await ev(() => Supa.lite), n0 = await ev(() => ARQ.list.length);
  ok(n0 > 100 && await ev(() => !!ARQ.sigs), 'Arqueos cargó la lista (' + n0 + ' versiones) y guardó su firma por tabla');
  await ev(() => { __EG.api.reset(); __EG.api.mark('sync') }); await page.clock.runFor(180000);   // 3 min sin cambios
  const quieto = await ev(() => __EG.api.net.log.filter(e => /arq|ff_asig/.test(e.table)).reduce((a, e) => ({ n: a.n + 1, raw: a.raw + e.raw }), { n: 0, raw: 0 }));
  console.log('      3 min sin cambios: ' + quieto.n + ' solicitudes, ' + Math.round(quieto.raw / 1024) + ' KB'); ok(quieto.raw < 12 * 1024, 'sin cambios, Arqueos solo hace consultas de firma (< 12 KB en 3 min; ninguna fila)');
  await ev(() => { __EG.api.reset(); for (let i = 0; i < 3; i++) __EG.api.othersAddArqueo(i) }); await page.clock.runFor(70000);
  const cambio = await ev(() => ({ log: __EG.api.net.log.map(e => e.table + ':' + e.op + ':' + e.raw), n: ARQ.list.length, nuevos: ARQ.list.filter(r => /^AQN-/.test(r.folio)).length }));
  const kbs = Math.round(cambio.log.reduce((a, x) => a + +x.split(':')[2], 0) / 1024);
  ok(cambio.nuevos === 3, 'tres arqueos nuevos de otras personas aparecen en la lista (' + cambio.nuevos + ' nuevos)');
  console.log('      sincronización de 3 arqueos: ' + cambio.log.length + ' solicitudes, ' + kbs + ' KB'); ok(kbs < 40, 'la sincronización incremental baja solo lo nuevo (< 40 KB, no la lista completa)');
  const vs = await ev(() => { const s = __EG.api.db.pa_arqueos.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 600).map(r => r.folio + '|' + r.version).sort(); const c = ARQ.list.map(r => r.folio + '|' + r.version).sort(); return JSON.stringify(s) === JSON.stringify(c) });
  ok(vs, 'la lista local = las 600 versiones más recientes del servidor (idéntica a una recarga completa)');
  // abrir un arqueo ligero trae su cuerpo
  const op = await ev(async () => { const r = ARQ.list.find(x => x.estado === 'completo'); await arqOpen(r.folio, r.version); return { f: r.folio, fact: (ARQ.d && ARQ.d.data && ARQ.d.data.fact || []).length, lite: !!r._lite } });
  ok(op.fact > 0, 'al abrir un arqueo se pide su cuerpo completo (' + op.fact + ' facturas) sin haberlo bajado en la lista (' + (lite ? 'modo ligero' : 'modo normal') + ')');
  console.log(fallo ? 'ARQUEOS FALLO ' + fallo : 'ARQUEOS OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
