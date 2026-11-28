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
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const PH = 2.5e6, MODO = arg('od', 'cors'), CORS = MODO === 'cors' || MODO === 'exp';   // foto original simulada de 2.5 MB; OneDrive con o sin cabecera CORS
  const od = require('http').createServer((q, r) => { if (MODO === 'exp') { r.writeHead(403, { 'access-control-allow-origin': '*' }); return r.end('expired') } const h = { 'content-type': 'application/octet-stream', 'content-length': PH }; if (CORS) h['access-control-allow-origin'] = '*'; r.writeHead(200, h); r.end(Buffer.alloc(PH, 7)) }); await new Promise(r => od.listen(0, '127.0.0.1', r)); const odPort = od.address().port;
  const page = await abrir(browser, port, 'admin'); const fn = { bytes: 0, llamadas: {} }; let directo = 0;
  await page.route('**/functions/v1/**', async r => { const b = JSON.parse(r.request().postData() || '{}'); let out;
    if (b.action === 'get') out = { ok: true, url: `http://127.0.0.1:${odPort}/${encodeURIComponent(b.name)}`, exists: true };
    else if (b.action === 'photo_data') { const off = b.offset || 0, len = Math.min(b.length || 3e6, PH - off); out = { ok: true, total: PH, data: Buffer.alloc(len, 7).toString('base64') } } else out = { ok: true };
    const s = JSON.stringify(out); fn.bytes += s.length + 600; fn.llamadas[b.action] = (fn.llamadas[b.action] || 0) + 1; await r.fulfill({ contentType: 'application/json', body: s }) });
  let intentos = 0; page.on('request', r => { if (r.url().startsWith('http://127.0.0.1:' + odPort)) intentos++ }); page.on('response', async r => { if (r.url().startsWith('http://127.0.0.1:' + odPort)) directo += PH });
  const plan = await page.evaluate(() => { const p = db.plans.find(p => p.acts.filter(a => a.ev).length >= 2); p.acts.forEach(a => { if (a.ref) a.ref.o = 1; if (a.ev) a.ev.o = 1 }); return { id: p.id, fotos: p.acts.reduce((n, a) => n + (a.ref ? 1 : 0) + (a.ev ? 1 : 0), 0) } });
  const bajar = async () => { fn.bytes = 0; fn.llamadas = {}; directo = 0; intentos = 0; const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(id => downloadPlan(id), plan.id)]); await page.clock.runFor(2000); const f = await dl.path(); const z = require('fs').readFileSync(f); const e = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = z.readUInt16LE(e + 10) - 2 ; return { zip: z.length, fotosEnZip: n, fnMB: (fn.bytes / 1e6).toFixed(2), directoMB: (directo / 1e6).toFixed(2), llamadas: { ...fn.llamadas }, intentosOneDrive: intentos } };
  const d1 = await bajar(); console.log('      descarga 1:', JSON.stringify(d1));
  ok(d1.fotosEnZip === plan.fotos && d1.zip > plan.fotos * PH, 'el ZIP contiene las ' + plan.fotos + ' fotos originales completas (' + (d1.zip / 1e6).toFixed(1) + ' MB)');
  const d2 = await bajar(); console.log('      descarga 2:', JSON.stringify(d2));
  console.log('RESUMEN ' + JSON.stringify({ od: CORS ? 'con CORS' : 'sin CORS', fotos: plan.fotos, egressSupabase_descarga1_MB: +d1.fnMB, egressSupabase_descarga2_MB: +d2.fnMB, desdeOneDrive_descarga1_MB: +d1.directoMB }));
  ok(d2.fotosEnZip === plan.fotos, 'la segunda descarga también es completa');
  if (process.argv.includes('--directo')) ok(MODO !== 'cors' || +d1.fnMB < 1, 'con OneDrive legible, las fotos NO pasan por Supabase (' + d1.fnMB + ' MB de la función)');
  if (process.argv.includes('--directo') && MODO === 'nocors') ok(d2.intentosOneDrive === 0 && !(d2.llamadas.get > 0), 'sin CORS: se recuerda y no se reintenta (segunda descarga: ' + d2.intentosOneDrive + ' intentos a OneDrive)');
  console.log(fallo ? 'DESCARGA FALLO ' + fallo : 'DESCARGA OK'); await browser.close(); srv.close(); od.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
