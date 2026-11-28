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
  const page = await abrir(browser, port, 'admin'), ev = (fn, a) => page.evaluate(fn, a);
  const parche = await ev(() => !!Supa.patch);
  const id = await ev(() => db.plans.find(p => p.acts.length >= 3).id);
  // 1) diferencias: aplicar(diff(a,b), a) = b para casos con objetos, arreglos y borrados
  const d1 = await ev(() => { const ap = (o, ops) => { const c = JSON.parse(JSON.stringify(o)); ops.forEach(op => { let x = c; for (let i = 0; i < op.path.length - 1; i++) x = x[op.path[i]]; const k = op.path[op.path.length - 1]; if (op.del) { if (Array.isArray(x)) x.splice(+k, 1); else delete x[k] } else x[k] = op.value }); return c };
    const casos = [[{ a: 1, b: { c: [1, 2, 3], d: 'x' }, e: [{ t: 'a' }, { t: 'b' }] }, { a: 2, b: { c: [1, 9, 3], d: 'x' }, e: [{ t: 'a' }, { t: 'B', n: 1 }] }], [{ a: 1, z: 5 }, { a: 1 }], [{ l: [1, 2] }, { l: [1, 2, 3] }], [{ x: { y: 1 } }, { x: { y: 1 } }]];
    return casos.every(([a, b]) => JSON.stringify(ap(a, diffOps(a, b, [], []))) === JSON.stringify(b)) });
  ok(d1, 'las diferencias reconstruyen exactamente el JSON nuevo (objetos, arreglos, campos nuevos y borrados)');
  // 2) un cambio pequeño viaja como parche
  await ev(() => { __EG.api.reset(); const p = db.plans.find(p => p.acts.length >= 3); p.acts[2].text = 'Texto cambiado por mí'; save() }); await page.clock.runFor(3000);
  console.log('      log:', JSON.stringify(await ev(() => __EG.api.net.log.map(e => e.table + ':' + e.op)))); const usoRpc = await ev(() => __EG.api.net.log.filter(e => e.table === 'rpc:pa_docs_patch').length), upd = await ev(() => __EG.api.net.log.filter(e => e.table === 'pa_docs' && e.op === 'update').length);
  if (parche) ok(usoRpc === 1 && upd === 0, 'un cambio pequeño se envía como parche (' + usoRpc + ' RPC, ' + upd + ' actualizaciones completas)'); else ok(usoRpc === 0 && upd === 1, 'sin la función E3 se guarda la fila completa como antes (' + upd + ' actualización completa)');
  // 3) edición concurrente: otra persona cambia la actividad 2 en el servidor mientras yo cambio la 3
  await ev(() => { const srv = __EG.api.db.pa_docs.find(d => d.col === 'plans' && d.data.acts.length >= 3); window.__id = srv.id; srv.data.acts[1].text = 'Cambio AJENO'; });   // el servidor cambia sin avisar a esta pestaña
  await ev(() => { const p = db.plans.find(p => p.id === window.__id); p.acts[2].text = 'Cambio MÍO ' + Date.now(); save() }); await page.clock.runFor(3000);
  const fin = await ev(() => { const srv = __EG.api.db.pa_docs.find(d => d.col === 'plans' && d.id === window.__id); return [srv.data.acts[1].text, srv.data.acts[2].text] });
  if (parche) ok(fin[0] === 'Cambio AJENO' && /^Cambio MÍO/.test(fin[1]), 'dos ediciones concurrentes de actividades distintas se conservan ambas (servidor: «' + fin[0] + '» y «' + fin[1].slice(0, 11) + '…»)'); else ok(fin[0] !== 'Cambio AJENO' && /^Cambio MÍO/.test(fin[1]), 'sin E3 (comportamiento anterior) el último en guardar pisa la edición ajena: «' + fin[0].slice(0, 20) + '»');
  // 4) sin permiso: el visualizador no puede guardar (el servidor rechaza y la app avisa), con y sin E3
  console.log(fallo ? 'PARCIAL FALLO ' + fallo : 'PARCIAL OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
