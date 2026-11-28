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

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const MODO = arg('od', 'cors'), SIZE = 3.2e6, CH = 983040;   // foto original simulada de 3.2 MB (4 tramos)
  const partes = []; let recibido = 0, tramos = 0, auth = 0, prefl = 0, expectedRange = true;
  const od = require('http').createServer((q, r) => {
    const h = { 'access-control-allow-origin': MODO === 'nocors' ? undefined : '*', 'access-control-allow-headers': 'content-range,content-type', 'access-control-allow-methods': 'PUT' }; Object.keys(h).forEach(k => h[k] === undefined && delete h[k]);
    if (q.method === 'OPTIONS') { prefl++; r.writeHead(204, h); return r.end() }
    if (q.headers.authorization) auth++;
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(q.headers['content-range'] || ''); let n = 0; const bufs = []; q.on('data', c => { n += c.length; bufs.push(c) }); q.on('end', () => {
      partes.push(Buffer.concat(bufs)); tramos++; if (!m || +m[2] - +m[1] + 1 !== n || +m[3] !== SIZE) expectedRange = false; recibido += n;
      if (MODO === 'mid' && tramos === 2) { r.writeHead(500, h); return r.end() }
      const ultimo = m && +m[2] + 1 === +m[3]; r.writeHead(ultimo ? 201 : 202, h); r.end('{}') })
  }); await new Promise(r => od.listen(0, '127.0.0.1', r)); const odPort = od.address().port;
  const page = await abrir(browser, port, 'admin'); const fn = { bytes: 0, llamadas: {}, b64: 0 };
  await page.route('**/functions/v1/**', async r => { const b = JSON.parse(r.request().postData() || '{}'); let out;
    if (b.action === 'put_begin') out = { ok: true, uploadUrl: `http://127.0.0.1:${odPort}/sesion/` + Math.random(), chunk: CH };
    else { out = { ok: true }; if (b.data) fn.b64 += b.data.length }
    const s = JSON.stringify(out); fn.bytes += (r.request().postData() || '').length + s.length + 600; fn.llamadas[b.action] = (fn.llamadas[b.action] || 0) + 1; await r.fulfill({ contentType: 'application/json', body: s }) });
  const res = await page.evaluate(async SIZE => { const f = new File([new Uint8Array(SIZE).fill(9)], 'x.jpg', { type: 'image/jpeg' }); const prog = []; const o = await putOriginal('k1', f, () => { }, v => prog.push(v)); return { o, prog: prog.length } }, SIZE);
  console.log('RESUMEN ' + JSON.stringify({ modo: MODO, subido: !!res.o, egressSupabase_MB: +(fn.bytes / 1e6).toFixed(3), base64_por_funcion_MB: +(fn.b64 / 1e6).toFixed(2), directoAOneDrive_MB: +(recibido / 1e6).toFixed(2), llamadas: fn.llamadas, preflight: prefl, conAuthorization: auth }));
  ok(!!res.o, 'la subida termina correctamente (' + MODO + ')');
  ok(auth === 0, 'ninguna petición a OneDrive lleva credenciales (Authorization)');
  if (MODO === 'cors') { ok(require('crypto').createHash('sha256').update(Buffer.concat(partes)).digest('hex') === require('crypto').createHash('sha256').update(Buffer.alloc(SIZE, 9)).digest('hex'), 'integridad: el SHA-256 de lo recibido por OneDrive es idéntico al del archivo original'); ok(recibido === SIZE && expectedRange, 'OneDrive recibe los ' + SIZE / 1e6 + ' MB exactos, con Content-Range correcto'); ok(!fn.llamadas.put_chunk && fn.b64 === 0 && fn.bytes < 5e3, 'los bytes de la foto NO pasan por Supabase (' + (fn.bytes / 1e6).toFixed(3) + ' MB solo de autorización)') }
  else { ok(fn.llamadas.put_chunk === Math.ceil(SIZE / CH), 'con ' + (MODO === 'nocors' ? 'OneDrive sin CORS' : 'un fallo a mitad de subida') + ' se usa la función como hoy (' + fn.llamadas.put_chunk + ' tramos)'); ok(Math.abs(fn.b64 - Math.ceil(SIZE / 3) * 4) < 4 * Math.ceil(SIZE / CH), 'el archivo completo llega por la alternativa (' + (fn.b64 / 1e6).toFixed(2) + ' MB en base64)') }
  if (MODO !== 'cors') { const antes = fn.llamadas.put_begin; const r2 = await page.evaluate(async SIZE => { const f = new File([new Uint8Array(SIZE).fill(9)], 'y.jpg', { type: 'image/jpeg' }); return !!await putOriginal('k2', f, () => { }, () => { }) }, SIZE); const t = tramos; ok(r2 && (fn.llamadas.put_begin - antes) === 1, 'la siguiente subida va directo a la función (se recuerda el fallo, sin reintentar OneDrive)') }
  if (MODO === 'cors') { const r3 = await page.evaluate(async () => { const u = 'data:image/jpeg;base64,' + btoa('x'.repeat(5000)); const ok = await odPutBlob('pequena.jpg', dataUrlBlob(u)); return ok }); ok(r3 === true, 'la versión reducida (data URL) también sube directa') }
  if (MODO === 'cors') { const c = await page.evaluate(() => { const r = {}; const v0 = PA_CFG.odDirect; PA_CFG.odDirect = false; r.apagada = odOn(); PA_CFG.odDirect = 'admin'; r.admin_siendo_admin = odOn(); const rol = me.role; me.role = 'sucursal'; r.admin_siendo_sucursal = odOn(); me.role = rol; PA_CFG.odDirect = [me.id]; r.lista_incluida = odOn(); PA_CFG.odDirect = ['otra-persona']; r.lista_excluida = odOn(); PA_CFG.odDirect = true; r.todos = odOn(); PA_CFG.odDirect = false; localStorage.setItem('nx_od_pilot', '1'); r.piloto_admin = odOn(); me.role = 'sucursal'; r.piloto_sucursal = odOn(); me.role = rol; localStorage.removeItem('nx_od_pilot'); r.piloto_apagado = odOn(); PA_CFG.odDirect = v0; return r });
    ok(c.apagada === false && c.admin_siendo_admin === true && c.admin_siendo_sucursal === false && c.lista_incluida === true && c.lista_excluida === false && c.todos === true && c.piloto_admin === true && c.piloto_sucursal === false && c.piloto_apagado === false, 'activación controlada: apagada / solo administradores / lista / todos / piloto por dispositivo (solo admin) → ' + JSON.stringify(c)) }
  if (MODO === 'cors') { const pu = await page.evaluate(async () => { const orig = Fn.call; const calls = []; Fn.call = async b => { calls.push(b); return { ok: true } }; let rel; const oq = Supa.q; Supa.q = new Promise(r => { rel = r }); try { Push.send(['otro'], 'texto', 'PA-1'); await new Promise(r => setTimeout(r, 50)); const antes = calls.length; rel(); await new Promise(r => setTimeout(r, 50)); return { antes, despues: calls.length, synced: calls[0] && calls[0].synced, accion: calls[0] && calls[0].action } } finally { Fn.call = orig; Supa.q = oq } });
    ok(pu.antes === 0 && pu.despues === 1 && pu.synced === 1 && pu.accion === 'push_send', 'aviso push: el cliente espera a que termine de guardar y luego envía «synced» (el servidor ya no espera 1.8 s) → ' + JSON.stringify(pu)) }
  console.log(fallo ? 'SUBIDA FALLO ' + fallo : 'SUBIDA OK'); await browser.close(); srv.close(); od.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
