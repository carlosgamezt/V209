/* Prueba FUNCIONAL comparativa: con los mismos datos, cada rol ve lo mismo (planes visibles, estados, avances, contadores, dashboard, evidencias, arqueos, historial) en la versión de referencia y en la optimizada.
   Uso: node funcional.cjs --root <carpeta> --out <json> [--extra server_extra.js] [--caps '{"lite":true}'] */
const http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const ROOT = path.resolve(arg('root')), OUT = arg('out'), EXTRA = arg('extra', ''), CAPS = JSON.parse(arg('caps', '{}'));
const DATA = { maxPlans: 80, acts: 4, thumbs: 8, notifs: 300, arqueos: 120, descargas: 300, mensual: 100, caps: CAPS };
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

const kb = n => Math.round(n / 1024);
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const MODO = arg('cache', 'true');
  const page = await abrir(browser, port, 'admin'), ev = (f, a) => page.evaluate(f, a);
  const net = async () => ev(() => { const t = __EG.api.net.log.reduce((a, e) => ({ n: a.n + 1, raw: a.raw + e.raw }), { n: 0, raw: 0 }); return t });
  const relogin = async (conServidor = true) => { await ev(() => { __EG.api.reset(); __EG.api.mark('relogin'); Supa.cleanup(); me = null; db = null }); await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(3500); };
  const idb = () => ev(async () => { const d = await PCache.open(); const n = k => new Promise(r => { const q = d.transaction(k).objectStore(k).count(); q.onsuccess = () => r(q.result) }); return { rows: await n('rows'), meta: await n('meta') } });
  const visibles = () => ev(() => JSON.stringify([...Supa.snap.keys()].sort()));
  const servidor = () => ev(() => { const x = __EG; const lite = !!(x.caps && x.caps.lite); const rows = x.api.db.pa_docs.filter(d => d.col !== 'x'); return JSON.stringify(rows.filter(d => !(d.col === 'notifs' && Date.now() - Date.parse(d.updated_at) > 45 * 864e5 && (d.data.to || []).every(u => (d.data.read || []).includes(u))) && (d.col !== 'notifs' || (d.data.to || []).includes('admin'))).map(d => d.col + '|' + d.id).sort()) });
  // 1) inicio en frío
  const frio = await net(); await page.clock.runFor(4000); const n0 = await ev(() => db.plans.length), nn0 = await ev(() => db.notifs.length); const i0 = await idb();
  ok(i0.rows > 0 && i0.meta === 1, 'inicio en frío: la copia local se guarda (' + i0.rows + ' filas); descarga ' + kb(frio.raw) + ' KB en ' + frio.n + ' solicitudes');
  // 2) segundo inicio (sin cambios): casi sin datos
  await relogin(); const t2 = await net(); const n1 = await ev(() => db.plans.length), nn1 = await ev(() => db.notifs.length);
  ok(n1 === n0 && nn1 === nn0, 'segundo inicio: mismos planes (' + n1 + ') y avisos (' + nn1 + ')');
  console.log('      segundo inicio: ' + kb(t2.raw) + ' KB en ' + t2.n + ' solicitudes (frío: ' + kb(frio.raw) + ' KB)'); R_warm = t2.raw;
  if (MODO === 'dispositivo') ok(t2.raw < frio.raw * 0.2, 'segundo inicio descarga < 20 % del inicio en frío');
  // 3) cambios, avisos y un borrado de otros mientras no hay sesión
  await ev(() => { __EG.api.reset(); Supa.cleanup(); me = null; db = null; __EG.api.othersTouchPlan(2); __EG.api.othersTouchPlan(5); __EG.api.othersAddNotif(1); __EG.api.othersDeletePlanDoc(__EG.api.db.pa_docs.find(d => d.col === 'plans').id) });
  await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(6000);
  const sv = await servidor(), cl = await visibles(); const cs = JSON.stringify(JSON.parse(cl).filter(k => !k.startsWith('meta|') && !k.startsWith('users|')).sort()), ss = JSON.stringify(JSON.parse(sv).filter(k => !k.startsWith('meta|') && !k.startsWith('users|')).sort());
  ok(cs === ss, 'tras cambios y un borrado ajenos, la copia local queda IDÉNTICA a lo que ve el servidor (planes, avisos)');
  ok(await ev(() => db.plans.some(p => /Actividad editada/.test(p.acts[0].text))), 'los planes modificados por otros se actualizaron');
  // 4) cambio de perfil → copia anulada
  await ev(() => { __EG.api.db.pa_profiles.find(p => p.user_id === 'admin').region = '9'; Supa.cleanup(); me = null; db = null }); await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(3000);
  const i4 = await idb(); ok(await ev(() => Supa.profile.region) === '9' && i4.meta === 1, 'cambio de perfil (región): la copia anterior se anula y se vuelve a bajar completa');
  await ev(() => { __EG.api.db.pa_profiles.find(p => p.user_id === 'admin').region = null });
  // 5) otra persona entra en el equipo: la copia de la anterior se elimina
  await ev(() => { const u = __EG.api.db.__users.find(x => x.role === 'sucursal').id; __EG.api.setUser(u); Supa.cleanup(); me = null; db = null }); await ev(async () => { await Supa.afterLogin() }); await page.clock.runFor(4000);
  const i5 = await ev(async () => { const d = await PCache.open(); return await new Promise(r => { const q = d.transaction('meta').objectStore('meta').getAllKeys(); q.onsuccess = () => r(q.result) }) });
  ok(i5.length === 1 && i5[0] !== 'auth-admin', 'otra persona entra en el equipo: la copia de la anterior se elimina (quedan: ' + JSON.stringify(i5) + ')');
  // 6) cierre voluntario borra; cierre por inactividad conserva solo en modo "dispositivo"
  await ev(() => { window.__lo = 1; window.__idle = 1; Supa.cleanup() }); await page.clock.runFor(1000); const i6 = await idb();
  if (MODO === 'dispositivo') ok(i6.rows > 0, 'modo dispositivo: el cierre por inactividad CONSERVA la copia (' + i6.rows + ' filas)'); else ok(i6.rows === 0, 'modo sesión: cualquier cierre borra la copia');
  await ev(async () => { me = null; db = null; window.__lo = 0; await Supa.afterLogin() }); await page.clock.runFor(4000);
  await ev(() => { window.__lo = 1; window.__idle = 0; Supa.cleanup() }); await page.clock.runFor(1000); const i7 = await idb(); ok(i7.rows === 0 && i7.meta === 0, 'cierre de sesión voluntario: la copia local se borra por completo');
  // 7) permisos revocados: un supervisor pierde la visibilidad de un plan (cambia de región) → tras volver a entrar el plan desaparece de la pantalla Y de la copia local; perfil cambiado → copia anulada
  { const us = await ev(() => __EG.api.db.__users); const sup = us.find(u => u.role === 'supervisor').id; const pg = await abrir(browser, port, sup), e2 = (fn, a) => pg.evaluate(fn, a);
    await pg.clock.runFor(4000); const pid = await e2(() => db.plans[0] && db.plans[0].id); ok(!!pid, 'supervisor con planes visibles y copia guardada');
    await e2(id => { const d = __EG.api.db.pa_docs.find(x => x.col === 'plans' && x.id === id); d.data.region = '99'; d.updated_at = new Date().toISOString(); Supa.cleanup(); me = null; db = null }, pid);
    await e2(async () => { await Supa.afterLogin() }); await pg.clock.runFor(6000);
    ok(!(await e2(id => db.plans.some(p => p.id === id), pid)), 'plan que dejó de ser visible (permiso/región revocados) desaparece tras volver a entrar');
    const en = await e2(async id => { const d = await PCache.open(); return await new Promise(r => { const q = d.transaction('rows').objectStore('rows').getAllKeys(); q.onsuccess = () => r(q.result.some(k => k.endsWith('|plans|' + id))) }) }, pid);
    ok(!en, 'y desaparece también de la copia local (invalidación por conteo + listado completo)');
    await e2(() => { __EG.api.db.pa_profiles.find(p => p.user_id === Supa.profile.user_id).role = 'visualizador'; Supa.cleanup(); me = null; db = null }); await e2(async () => { await Supa.afterLogin() }); await pg.clock.runFor(4000);
    ok(await e2(() => Supa.profile.role) === 'visualizador' && (await e2(() => db.plans.length)) > 0 && (await e2(() => PCache.fp())).includes('visualizador'), 'cambio de rol: la copia se rehace con el perfil nuevo (huella distinta)'); }
  // 8) Seguridad: un registro con campo de credencial NUNCA se guarda en el equipo (se borra la copia y no se vuelve a guardar)
  { const pg = await abrir(browser, port, 'admin'), e2 = (fn, a) => pg.evaluate(fn, a); await pg.clock.runFor(4000);
    const i = await e2(async () => { const d = await PCache.open(); return await new Promise(r => { const q = d.transaction('rows').objectStore('rows').count(); q.onsuccess = () => r(q.result) }) }); ok(i > 0, 'control: sin campos sensibles la copia sí se guarda (' + i + ' filas)');
    await e2(() => { const d = __EG.api.db.pa_docs.find(x => x.col === 'users'); d.data.pw = 'contraseña-de-prueba'; d.updated_at = new Date().toISOString(); Supa.cleanup(); me = null; db = null }); await e2(async () => { await Supa.afterLogin() }); await pg.clock.runFor(8000);
    await e2(() => { __EG.api.othersTouchPlan(1) }); await pg.clock.runFor(6000);
    const j = await e2(async () => { const d = await PCache.open(); const rows = await new Promise(r => { const q = d.transaction('rows').objectStore('rows').getAll(); q.onsuccess = () => r(q.result) }); return { n: rows.length, hay: rows.some(x => /contraseña-de-prueba/.test(x.j)), dead: !!PCache.dead, planes: db.plans.length } });
    ok(j.n === 0 && !j.hay && j.dead && j.planes > 0, 'registro con campo «pw»: no se guarda NADA en el equipo, la caché se apaga en la sesión y la app sigue funcionando (' + j.planes + ' planes)'); }
  // 9) Piloto por rol: con cacheRoles=['sucursal'] el administrador no guarda copia
  { const pg = await abrir(browser, port, 'admin'), e2 = (fn, a) => pg.evaluate(fn, a); await pg.clock.runFor(3000);
    await e2(() => { PA_CFG.cacheRoles = ['sucursal']; Supa.cleanup(); me = null; db = null; window.__lo = 1; Supa.cleanup(); window.__lo = 0 }); await e2(async () => { me = null; db = null; await Supa.afterLogin() }); await pg.clock.runFor(5000);
    ok(!(await e2(() => PCache.on())), 'cacheRoles=["sucursal"]: la caché no se activa para un administrador'); }
  // 10) Desactivación reversible: al apagar la caché por configuración se borra por completo la base local
  { const pg = await abrir(browser, port, 'admin'), e2 = (fn, a) => pg.evaluate(fn, a); await pg.clock.runFor(4000);
    const antes = await e2(async () => { const d = await PCache.open(); const n = await new Promise(r => { const q = d.transaction('rows').objectStore('rows').count(); q.onsuccess = () => r(q.result) }); return { n, bd: (await indexedDB.databases()).some(x => x.name === 'pa_cache'), flag: !!localStorage.getItem('nx_pc_used') } });
    ok(antes.n > 0 && antes.bd && antes.flag, 'antes de apagar: la copia existe (' + antes.n + ' filas)');
    await e2(() => { PA_CFG.cache = false; Supa.cleanup(); me = null; db = null }); await e2(async () => { await Supa.afterLogin() }); await pg.clock.runFor(4000);
    const desp = await e2(async () => ({ bd: (await indexedDB.databases()).some(x => x.name === 'pa_cache'), flag: !!localStorage.getItem('nx_pc_used'), planes: db.plans.length }));
    ok(!desp.bd && !desp.flag && desp.planes > 0, 'tras apagar la caché por configuración: la base local se borra por completo y la app sigue funcionando'); }
  console.log(fallo ? 'CACHE FALLO ' + fallo : 'CACHE OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
let R_warm = 0;
