/* Prueba de navegador (sin red real ni credenciales) del acceso EXCLUSIVO a NEXA FEL desde el panel principal de NEXA.
   Uso:  node pruebas-fel-nexa/acceso-fel.cjs          (desde la raíz del repositorio; necesita Playwright y la rama base origin/main)
   NEXA se ejecuta con su código real y la biblioteca real de Supabase contra un Supabase FALSO (https://fake-nexa.supabase.test, interceptado): inicio de sesión, perfiles, datos y la función
   nx_fel_autorizado() (que devuelve solo true/false). La regla real del servidor se prueba aparte, con PostgreSQL real: pruebas-fel-nexa/sql/test-nx-fel-acceso.sh.
   · Cuenta autorizada (UUID registrado en el servidor falso) → ve NEXA FEL, sea admin o no. · Cualquier otra cuenta —incluido otro administrador— → no lo ve y su navegación es idéntica a la de origin/main.
   · Sin sesión, con error, tiempo agotado o respuesta no válida → oculto. · Cerrar sesión / cambiar de cuenta → se descarta al instante, también con una consulta pendiente.
   · Cambiar parámetros del navegador (PA_CONFIG, almacenamiento, rol) no lo habilita. · Ventana propia, sin compartir sesión ni datos. · Teléfono y computadora. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const NUEVA = path.join(REPO, 'nexa');
const BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-base-'));
cp.execSync(`git -C "${REPO}" archive origin/main nexa | tar -x -C "${BASE_DIR}"`);
const BASE = path.join(BASE_DIR, 'nexa');
const FEL = 'https://nexa-fel-demo.pages.dev/';
const FAKE = 'https://fake-nexa.supabase.test';
let fallos = 0;
const ok = (m) => console.log('OK    ' + m), mal = (m, e) => { console.log('FALLO ' + m); if (e) console.log('      ' + e); fallos++; };
const prueba = (c, m, e) => (c ? ok(m) : mal(m, e));
const SEC = (n) => !process.env.NXSEC || process.env.NXSEC.split(',').includes(String(n));   // NXSEC=2,5 ejecuta solo esas secciones (uso: comprobar mutaciones más rápido)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function servir(root) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
      const f = path.join(root, u);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      const t = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream';
      r.writeHead(200, { 'content-type': t }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res({ s, url: 'http://127.0.0.1:' + s.address().port + '/' }));
  });
}
const RAIZ = {};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

/* NOTA: tras cerrar sesión se espera 1.8 s antes de entrar con otra cuenta: NEXA termina el cierre con un temporizador propio de 1.5 s (previo a este cambio). */
/* ---------------------------------------------------------------- cuentas de prueba (UUID inventados) y servidor falso */
const U = { aut: '11111111-1111-4111-8111-111111111111', autSup: '55555555-5555-4555-8555-555555555555', adm2: '22222222-2222-4222-8222-222222222222', sup: '33333333-3333-4333-8333-333333333333',
  com: '44444444-4444-4444-8444-444444444444', inv: '66666666-6666-4666-8666-666666666666', vis: '77777777-7777-4777-8777-777777777777', suc: '88888888-8888-4888-8888-888888888888' };
const CUENTAS = { 'aut@prueba.test': [U.aut, 'admin'], 'aut-sup@prueba.test': [U.autSup, 'supervisor'], 'adm2@prueba.test': [U.adm2, 'admin'], 'sup@prueba.test': [U.sup, 'supervisor'],
  'com@prueba.test': [U.com, 'comodin'], 'inv@prueba.test': [U.inv, 'inventarios'], 'vis@prueba.test': [U.vis, 'visualizador'], 'suc@prueba.test': [U.suc, 'sucursal'] };
const AUTORIZADAS = new Set([U.aut, U.autSup]);   // «la tabla del servidor»
let DEMO = null;  // filas y usuarios de la demostración de NEXA, para servirlos como si fueran de Supabase

async function sesion(browser, url, opts = {}) {
  const { vp = { width: 1280, height: 800 }, modo = 'normal', hold = {}, supa = true, holdLogout = null } = opts;
  const ctx = await browser.newContext({ viewport: vp });
  const est = { rpc: [], externos: [], errores: [], modo, hold, felReq: [], holdLogout };
  await ctx.route((u) => ['127.0.0.1', 'localhost'].includes(u.hostname) && /^\/(index\.html)?$/.test(u.pathname), async (r) => {
    const resp = await r.fetch(); const cfg = supa ? { url: FAKE, key: 'clave-publica-falsa' } : {};
    await r.fulfill({ response: resp, body: (await resp.text()).replace(/window\.PA_CONFIG\s*=\s*\{[^}]*\};/, 'window.PA_CONFIG=' + JSON.stringify(cfg) + ';') });
  });
  await ctx.route(/\/config\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.PA_CONFIG=' + JSON.stringify(supa ? { url: FAKE, key: 'clave-publica-falsa' } : {}) + ';' }));
  await ctx.route(/\/version\.json(\?.*)?$/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: (fs.readFileSync(path.join(RAIZ[url], 'index.html'), 'utf8').match(/APP_VER='(v\d+)'/) || [])[1] }) }));
  await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), async (r) => {
    const rq = r.request(), u = new URL(rq.url());
    if (u.origin === FAKE) return servidorFalso(r, rq, u, est);
    if (u.hostname === 'nexa-fel-demo.pages.dev') { est.felReq.push({ url: rq.url(), ref: rq.headers()['referer'] || null, ck: rq.headers()['cookie'] || null }); return r.fulfill({ contentType: 'text/html', body: '<title>FEL de prueba</title><h1>NEXA FEL</h1>' }); }
    est.externos.push(rq.url()); return r.abort();
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => est.errores.push(e.message));
  await pg.goto(url);
  return { ctx, pg, est };
}

async function servidorFalso(r, rq, u, est) {
  const h = rq.headers(), m = rq.method(), p = u.pathname;
  if (process.env.NXDEBUG) console.log('   [falso]', m, p + u.search.slice(0, 80));
  const R = (status, body, extra = {}) => r.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) });
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  const bearer = (h['authorization'] || '').replace(/^Bearer /, ''), uidTok = bearer.startsWith('jwt-') ? bearer.slice(4) : null;
  const porUid = (uid) => Object.entries(CUENTAS).find(([, v]) => v[0] === uid);
  if (p === '/auth/v1/token' && m === 'POST') {
    let b = {}; try { b = JSON.parse(rq.postData() || '{}'); } catch (e) { }
    const c = CUENTAS[b.email]; if (!c) return R(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    const ahora = Math.floor(Date.now() / 1000);
    return R(200, { access_token: 'jwt-' + c[0], token_type: 'bearer', expires_in: 3600, expires_at: ahora + 3600, refresh_token: 'r-' + c[0], user: { id: c[0], aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
  }
  if (p === '/auth/v1/user') { const x = uidTok && porUid(uidTok); return x ? R(200, { id: uidTok, aud: 'authenticated', role: 'authenticated', email: x[0], app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) : R(401, { msg: 'no session' }); }
  if (p === '/auth/v1/logout') { if (est.holdLogout) await est.holdLogout; return r.fulfill({ status: 204, headers: CORS }); }
  if (p === '/rest/v1/rpc/nx_fel_autorizado' && m === 'POST') {
    est.rpc.push({ auth: h['authorization'] || null, apikey: h['apikey'] || null, body: rq.postData() || '', uid: uidTok });
    if (est.hold[uidTok]) await est.hold[uidTok];
    if (est.modo === 'error500') return R(500, { message: 'boom' });
    if (est.modo === 'netfail') return r.abort('failed');
    if (est.modo === 'timeout') return new Promise(() => { });
    if (est.modo === 'denegado') return R(403, { code: '42501', message: 'permission denied for function nx_fel_autorizado' });
    if (est.modo.startsWith('basura:')) return R(200, est.modo.slice(7));
    return R(200, AUTORIZADAS.has(uidTok) ? 'true' : 'false');
  }
  if (p === '/rest/v1/pa_profiles' && m === 'GET') {
    const perfiles = Object.entries(CUENTAS).map(([email, [uid, rol]]) => ({ user_id: (DEMO.users.find((x) => x.role === rol) || DEMO.users[0]).id, auth_id: uid, role: rol, must_change: false }));
    const q = (u.searchParams.get('auth_id') || '').replace(/^eq\./, '');
    if (q) { const f = perfiles.filter((x) => x.auth_id === q); return (h['accept'] || '').includes('pgrst.object') ? (f.length === 1 ? R(200, f[0], { 'content-type': 'application/vnd.pgrst.object+json; charset=utf-8' }) : R(406, { code: 'PGRST116', message: 'no rows' })) : R(200, f); }   // maybeSingle() pide un arreglo
    return R(200, perfiles);
  }
  if (p === '/rest/v1/pa_docs' && m === 'GET') return R(200, DEMO.rows);
  if (p.startsWith('/rest/v1/') && m === 'GET') return R(200, []);
  if (m === 'HEAD') return r.fulfill({ status: 200, headers: CORS });
  return R(200, {});
}

async function entrar(pg, email) {
  await pg.waitForSelector('#lu', { timeout: 15000 });
  await pg.fill('#lu', email); await pg.fill('#lp', 'clave-de-prueba'); await pg.click('#lb');
  try { await pg.waitForSelector('aside .nv', { timeout: 20000 }); await pg.waitForTimeout(450); /* el ingreso de NEXA termina con un último redibujo a los 250 ms */ } catch (e) { if (process.env.NXDEBUG) console.log('   [pantalla]', (await pg.textContent('#le').catch(() => '?')), (await pg.innerText('body')).slice(0, 200).replace(/\s+/g, ' ')); throw e; }
}
const felListo = (pg, ms = 12000) => pg.waitForFunction(() => window.FELACC && window.FELACC.estado === 'listo', null, { timeout: ms });
const etiquetas = (pg) => pg.$$eval('aside .nv .lb', (e) => e.map((x) => x.textContent.trim()));
const FELBTN = 'aside .nv:has-text("NEXA FEL")';
const hayFel = async (pg) => (await etiquetas(pg)).includes('NEXA FEL');

(async () => {
  const b = await chromium.launch();
  const nueva = await servir(NUEVA), base = await servir(BASE); RAIZ[nueva.url] = NUEVA; RAIZ[base.url] = BASE;
  try {
    // datos de la demostración de NEXA, para servirlos desde el Supabase falso
    { const s = await sesion(b, nueva.url, { supa: false }); await s.pg.waitForSelector('#lu'); DEMO = await s.pg.evaluate(() => ({ rows: Supa.rows(db), users: db.users.map((u) => ({ id: u.id, name: u.name, role: u.role })) })); await s.ctx.close(); }
    prueba(DEMO.users.length > 3, `datos de la demostración cargados (${DEMO.users.length} usuarios)`);

    if (SEC(1)) {
    // 1) Cuenta autorizada: lo ve, sea admin o no (la regla es la identidad, no el rol)
    for (const [email, rol] of [['aut@prueba.test', 'admin'], ['aut-sup@prueba.test', 'supervisor']]) {
      const s = await sesion(b, nueva.url); await entrar(s.pg, email); await felListo(s.pg);
      prueba(await hayFel(s.pg), `cuenta autorizada (rol ${rol}): ve «NEXA FEL»`);
      prueba(s.est.rpc.length === 1 && s.est.rpc[0].uid === CUENTAS[email][0] && s.est.rpc[0].auth === 'Bearer jwt-' + CUENTAS[email][0] && s.est.rpc[0].auth !== 'Bearer clave-publica-falsa' && !/\S/.test(s.est.rpc[0].body.replace(/[{}]/g, '')), `una sola consulta a nx_fel_autorizado, con el token de la sesión y sin datos en el cuerpo`, JSON.stringify(s.est.rpc));
      prueba(s.est.errores.length === 0, `sin errores de JavaScript (${rol})`, s.est.errores.join(' | '));
      await s.ctx.close();
    }

    }
    if (SEC(2)) {
    // 2) Cuentas NO autorizadas (otro administrador incluido): oculto y navegación idéntica a la de origin/main
    for (const [email, [uid, rol]] of Object.entries(CUENTAS).filter(([, v]) => !AUTORIZADAS.has(v[0]))) {
      const sb = await sesion(b, base.url); await entrar(sb.pg, email); const lb = await etiquetas(sb.pg); await sb.ctx.close();
      const s = await sesion(b, nueva.url); await entrar(s.pg, email); await felListo(s.pg); const ln = await etiquetas(s.pg);
      prueba(JSON.stringify(ln) === JSON.stringify(lb) && !ln.includes('NEXA FEL'), `${email} (rol ${rol}, no registrado): no ve FEL y su navegación es IDÉNTICA a la de origin/main (${lb.length} elementos)`, JSON.stringify([lb, ln]));
      prueba(!(await s.pg.evaluate(() => felVis())), `${email}: felVis() es false`);
      await s.ctx.close();
    }

    }
    if (SEC(3)) {
    // 3) Sin sesión de Supabase / fallos / respuestas no válidas: oculto
    { const s = await sesion(b, nueva.url); await s.pg.waitForSelector('#lu'); const t = await s.pg.innerText('body');
      prueba(!/NEXA FEL/.test(t) && !(await s.pg.evaluate(() => felVis())), 'sin sesión (pantalla de ingreso): no hay rastro de NEXA FEL'); await s.ctx.close(); }
    for (const [modo, desc] of [['error500', 'la consulta responde 500'], ['netfail', 'falla la red'], ['denegado', 'la función responde permission denied (403)'], ['basura:"true"', 'responde la cadena "true"'], ['basura:1', 'responde el número 1'],
      ['basura:null', 'responde null'], ['basura:{"autorizado":true}', 'responde un objeto'], ['basura:[true]', 'responde un arreglo'], ['basura:"si"', 'responde texto'], ['basura:', 'responde vacío'], ['basura:true{', 'responde JSON roto']]) {
      const s = await sesion(b, nueva.url, { modo }); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg);   // aunque la cuenta SÍ está registrada
      prueba(!(await hayFel(s.pg)) && !(await s.pg.evaluate(() => felVis())), `la cuenta autorizada NO ve FEL si ${desc} (falla en cerrado)`, JSON.stringify(await etiquetas(s.pg))); await s.ctx.close();
    }
    { const s = await sesion(b, nueva.url, { modo: 'timeout' }); await entrar(s.pg, 'aut@prueba.test'); await sleep(2000);
      prueba(!(await hayFel(s.pg)), 'mientras la consulta está pendiente, FEL permanece oculto'); await felListo(s.pg, 14000);
      prueba(!(await hayFel(s.pg)) && (await s.pg.evaluate(() => FELACC.ok)) === false, 'si la consulta no responde (tiempo agotado a los 8 s), FEL permanece oculto'); await s.ctx.close(); }

    }
    if (SEC(4)) {
    // 4) Manipular parámetros del navegador no lo habilita
    for (const [email, desc] of [['adm2@prueba.test', 'otro administrador'], ['sup@prueba.test', 'supervisor'], ['suc@prueba.test', 'sucursal']]) {
      const s = await sesion(b, nueva.url); await entrar(s.pg, email); await felListo(s.pg);
      await s.pg.evaluate(() => { PA_CONFIG.fel = { url: 'https://evil.example/', etiqueta: 'x' }; PA_CONFIG.felUsuarios = ['*']; localStorage.setItem('pa_fel', '1'); localStorage.setItem('nx_fel', '1'); localStorage.setItem('pa_supa_cfg', JSON.stringify({ fel: true }));
        sessionStorage.setItem('pa_fel', '1'); sessionStorage.setItem('pa_me', me.id); me.role = 'admin'; window.__FEL = true; render(); });
      await sleep(400);
      const cfg = await s.pg.evaluate(() => felCfg());
      prueba(!(await hayFel(s.pg)) && !(await s.pg.evaluate(() => felVis())), `${desc}: cambiar PA_CONFIG, el almacenamiento y el rol desde la consola NO habilita FEL`, JSON.stringify(await etiquetas(s.pg)));
      prueba(cfg && cfg.url === FEL, `${desc}: la URL sigue siendo la de la aplicación (no la del navegador)`, JSON.stringify(cfg)); await s.ctx.close();
    }
    { const s = await sesion(b, nueva.url, { supa: false }); await s.pg.waitForSelector('#lu'); const id = await s.pg.evaluate(() => db.users.find((u) => u.role === 'admin').id);   // modo de pruebas sin Supabase
      await s.pg.selectOption('#lu', id); await s.pg.fill('#lp', '1234'); await s.pg.click('button:has-text("ENTRAR")'); await s.pg.waitForSelector('aside .nv');
      await s.pg.evaluate(() => { PA_CONFIG.fel = { url: 'https://nexa-fel-demo.pages.dev/' }; render(); }); await sleep(300);
      prueba(!(await hayFel(s.pg)), 'sin Supabase (modo de pruebas), aunque se fije PA_CONFIG.fel y el usuario sea admin: FEL oculto'); await s.ctx.close(); }

    }
    if (SEC(5)) {
    // 5) Cerrar sesión elimina la autorización al instante; la cuenta siguiente no la hereda
    { const s = await sesion(b, nueva.url); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); prueba(await hayFel(s.pg), 'cuenta autorizada dentro: FEL visible');
      await s.pg.click(FELBTN); await s.pg.waitForSelector('main a.btn'); prueba(/Certificación fiscal: DESHABILITADA/.test(await s.pg.textContent('main')), 'la pantalla de FEL dice que la certificación fiscal está DESHABILITADA');
      await s.pg.click('.hout'); await sleep(250);   // antes de los 1.5 s en que NEXA termina de cerrar
      const t = await s.pg.evaluate(() => ({ vis: felVis(), est: FELACC.estado, ok: FELACC.ok, uid: FELACC.uid, view, btn: document.querySelectorAll('aside .nv[onclick="navTo(\'fel\')"]').length }));
      prueba(!t.vis && t.est === 'idle' && !t.ok && t.uid === null && t.view !== 'fel' && t.btn === 0, 'al cerrar sesión, a los 250 ms ya no hay autorización, ni botón, ni pantalla de FEL', JSON.stringify(t));
      await s.pg.waitForSelector('#lu', { timeout: 8000 }); await sleep(1800); await entrar(s.pg, 'adm2@prueba.test'); await felListo(s.pg);
      prueba(!(await hayFel(s.pg)) && s.est.rpc.length === 2 && s.est.rpc[1].uid === U.adm2, 'el siguiente usuario (otro administrador, sin cerrar el navegador) NO hereda el acceso y NEXA vuelve a consultar con SU token', JSON.stringify(s.est.rpc.map((x) => x.uid)));
      await s.pg.click('.hout'); await s.pg.waitForSelector('#lu', { timeout: 8000 }); await sleep(1800); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg);
      prueba(await hayFel(s.pg), 'y al volver la cuenta autorizada, FEL reaparece'); prueba(s.est.errores.length === 0, 'sin errores de JavaScript durante los cambios de sesión', s.est.errores.join(' | ')); await s.ctx.close(); }

    }
    if (SEC(6)) {
    // 5b) El cierre de sesión descarta la autorización AUNQUE el servidor tarde en responder (la regla no espera al evento de Supabase)
    { let soltar; const espera = new Promise((r) => { soltar = r; });
      const s = await sesion(b, nueva.url, { holdLogout: espera }); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); prueba(await hayFel(s.pg), 'cierre lento: la cuenta autorizada ve FEL antes de salir');
      await s.pg.click('.hout'); await sleep(300);
      const t = await s.pg.evaluate(() => ({ vis: felVis(), est: FELACC.estado, uid: FELACC.uid, btn: document.querySelectorAll('aside .nv[onclick="navTo(\'fel\')"]').length, hay: !!me }));
      prueba(t.hay && !t.vis && t.est === 'idle' && t.uid === null && t.btn === 0, 'cierre lento: aunque el servidor aún no confirma el cierre (la sesión sigue en pantalla), FEL ya desapareció y la autorización se descartó', JSON.stringify(t)); soltar(); await sleep(1800); await s.ctx.close(); }

    // 6) Cambio de cuenta sin cerrar sesión (otro inicio de sesión sobre la misma página)
    { const s = await sesion(b, nueva.url); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); prueba(await hayFel(s.pg), 'cambio de cuenta: la cuenta autorizada ve FEL');
      const r = await s.pg.evaluate(async () => { await Supa.sb.auth.signInWithPassword({ email: 'adm2@prueba.test', password: 'x' }); await Supa.afterLogin(); const justo = felVis(); render(); return { justo, est: FELACC.estado }; });
      prueba(r.justo === false && r.est !== 'listo', 'al cambiar de cuenta, la autorización anterior se descarta al instante (antes de que responda la consulta de la nueva)', JSON.stringify(r));
      await felListo(s.pg); await sleep(200); prueba(!(await hayFel(s.pg)), 'tras la consulta de la nueva cuenta (no registrada) FEL sigue oculto'); await s.ctx.close(); }

    }
    if (SEC(7)) {
    // 7) Consulta pendiente + cierre de sesión + otra cuenta: la respuesta tardía de la primera cuenta NO se aplica a la segunda
    { let soltar; const espera = new Promise((r) => { soltar = r; });
      const s = await sesion(b, nueva.url, { hold: { [U.aut]: espera } }); await entrar(s.pg, 'aut@prueba.test'); await sleep(500);
      prueba(!(await hayFel(s.pg)), 'carrera: con la consulta de la cuenta autorizada aún pendiente, FEL no se muestra');
      await s.pg.click('.hout'); await s.pg.waitForSelector('#lu', { timeout: 8000 }); await sleep(1800); await entrar(s.pg, 'adm2@prueba.test'); await felListo(s.pg);
      soltar(); await sleep(800);   // llega tarde la respuesta true de la primera cuenta
      prueba(!(await hayFel(s.pg)) && (await s.pg.evaluate(() => FELACC.uid)) === U.adm2 && (await s.pg.evaluate(() => FELACC.ok)) === false, 'carrera: la respuesta tardía de la cuenta anterior se descarta y la nueva cuenta sigue sin acceso', JSON.stringify(await etiquetas(s.pg)));
      await s.ctx.close(); }

    }
    if (SEC(8)) {
    // 8) El enlace: ventana propia, sin compartir sesión ni datos
    { const s = await sesion(b, nueva.url); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); const antes = s.est.felReq.length;
      await s.pg.click(FELBTN); await s.pg.waitForSelector('main a.btn');
      const a = await s.pg.$eval('main a.btn', (e) => ({ h: e.getAttribute('href'), t: e.target, r: e.rel }));
      prueba(a.h === FEL && a.t === '_blank' && /noopener/.test(a.r) && /noreferrer/.test(a.r), 'el enlace abre FEL en ventana propia con noopener y noreferrer', JSON.stringify(a));
      prueba(s.est.felReq.length === antes && !s.est.externos.some((u) => /nexa-fel/.test(u)), 'NEXA no hizo ninguna petición a FEL antes de abrirlo (solo las fuentes y bibliotecas habituales de NEXA)', JSON.stringify(s.est.externos.map((u) => new URL(u).host)));
      const [pop] = await Promise.all([s.ctx.waitForEvent('page'), s.pg.click('main a.btn')]); await pop.waitForLoadState();
      prueba(pop.url() === FEL && (await pop.evaluate(() => window.opener)) === null, 'se abre exactamente la URL de FEL, sin parámetros, y la ventana no puede acceder a NEXA');
      const pet = s.est.felReq[s.est.felReq.length - 1]; prueba(pet && !pet.ref && !pet.ck, 'la petición a FEL no lleva Referer ni cookies de NEXA', JSON.stringify(pet)); await s.ctx.close(); }

    }
    if (SEC(9)) {
    // 9) Módulos actuales con la cuenta autorizada: cada uno se abre sin errores
    { const s = await sesion(b, nueva.url); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); const vistas = await s.pg.evaluate(() => PERMS[me.role].views);
      for (const v of vistas) { await s.pg.evaluate((x) => navTo(x), v); await sleep(150); if ((await s.pg.textContent('main')).length < 20) mal(`el módulo ${v} quedó vacío`); }
      prueba(s.est.errores.length === 0, `los ${vistas.length} módulos del administrador se abren sin errores con FEL visible`, s.est.errores.join(' | '));
      prueba(JSON.stringify(vistas) === JSON.stringify(['dash', 'plans', 'nuevo', 'review', 'hist', 'arqueos', 'sup', 'suc', 'users', 'data', 'roles']), 'la matriz de permisos del administrador no cambió (FEL no está en PERMS_DEF)', JSON.stringify(vistas)); await s.ctx.close(); }

    }
    if (SEC(10)) {
    // 10) Teléfono y computadora (cuenta autorizada)
    for (const [nombre, vp, movil] of [['teléfono 360', { width: 360, height: 740 }, 1], ['teléfono 390', { width: 390, height: 844 }, 1], ['teléfono 412', { width: 412, height: 915 }, 1], ['tableta 820', { width: 820, height: 1180 }, 1], ['computadora 1100', { width: 1100, height: 800 }, 0], ['computadora 1440', { width: 1440, height: 900 }, 0]]) {
      const s = await sesion(b, nueva.url, { vp }); await entrar(s.pg, 'aut@prueba.test'); await felListo(s.pg); const sw = () => s.pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      prueba((await sw()) <= 0, `${nombre}: el panel con FEL no se desborda horizontalmente`);
      const bt = s.pg.locator(FELBTN); const vis0 = await bt.isVisible(); if (movil) prueba(!vis0, `${nombre}: FEL queda dentro de «Más» (no desplaza los accesos principales)`);
      if (!vis0) { await s.pg.click('aside .nv.more'); await s.pg.waitForTimeout(250); } await bt.scrollIntoViewIfNeeded(); const caja = await bt.boundingBox();
      prueba(caja && caja.width >= 36 && caja.height >= 36 && caja.x >= 0 && caja.x + caja.width <= vp.width + 1, `${nombre}: el botón FEL es visible, entra en pantalla y mide ≥ 36 px`, JSON.stringify(caja));
      await bt.click(); await s.pg.waitForSelector('main a.btn'); await s.pg.waitForTimeout(200); const ab = await s.pg.locator('main a.btn').boundingBox();
      prueba((await sw()) <= 0 && ab && ab.height >= 36 && ab.x >= 0 && ab.x + ab.width <= vp.width + 1, `${nombre}: la pantalla de FEL no se desborda y «Abrir NEXA FEL» es tocable`, JSON.stringify(ab));
      prueba(s.est.errores.length === 0, `${nombre}: sin errores de JavaScript`, s.est.errores.join(' | ')); await s.ctx.close();
    }

    }
    if (SEC(12)) {
    // 12) Capas de defensa, una por una (con consultas simuladas dentro de la página)
    { const s = await sesion(b, nueva.url); await entrar(s.pg, 'adm2@prueba.test'); await felListo(s.pg);
      const r = await s.pg.evaluate(async () => {
        const o = {}; const miUid = felUid();
        FELACC = { uid: '99999999-9999-4999-8999-999999999999', ok: true, estado: 'listo' }; o.otroUuid = felVis();   // autorización de OTRA cuenta
        FELACC = { uid: miUid, ok: true, estado: 'pendiente' }; o.pendiente = felVis();
        FELACC = { uid: miUid, ok: false, estado: 'listo' }; o.rechazada = felVis();
        FELACC = { uid: miUid, ok: 'true', estado: 'listo' }; o.noBooleana = felVis();
        const supaOn = Supa.on; Supa.on = false; FELACC = { uid: miUid, ok: true, estado: 'listo' }; o.sinSupabase = felVis(); Supa.on = supaOn;
        const prof = Supa.profile; Supa.profile = null; o.sinPerfil = felVis(); Supa.profile = prof;
        // la respuesta TARDÍA de una cuenta anterior no pisa el estado de la cuenta actual
        const render0 = window.render; let llamadas = 0; window.render = () => { llamadas++; };   // sin redibujos: así no se «cura» solo el estado
        const rpc0 = Supa.sb.rpc; let soltar; const espera = new Promise((res) => { soltar = res; });
        Supa.sb.rpc = () => espera; FELACC = { uid: 'x', ok: false, estado: 'idle' }; const viejo = felResolver('11111111-0000-4000-8000-000000000000');
        FELACC = { uid: miUid, ok: false, estado: 'pendiente' }; soltar({ data: true, error: null }); await viejo; o.pisado = JSON.stringify(FELACC); o.renders = llamadas; Supa.sb.rpc = rpc0;
        FELACC = { uid: miUid, ok: true, estado: 'listo' }; await Supa.afterLogin(); o.trasIngreso = FELACC.estado + '/' + FELACC.ok;   // cada ingreso descarta lo anterior y vuelve a preguntar
        FELACC = { uid: miUid, ok: true, estado: 'listo' }; Supa.cleanup(); o.trasLimpieza = FELACC.estado + '/' + FELACC.ok;   // toda salida de sesión descarta la autorización
        window.render = render0; FELACC = { uid: null, ok: false, estado: 'idle' }; return Object.assign(o, { miUid });
      });
      prueba(r.otroUuid === false, 'capa: la autorización guardada de OTRA cuenta no vale para la sesión actual', JSON.stringify(r));
      prueba(r.pendiente === false && r.rechazada === false && r.noBooleana === false, 'capa: pendiente, rechazada o no booleana → oculto');
      prueba(r.sinSupabase === false && r.sinPerfil === false, 'capa: sin Supabase o sin perfil de sesión → oculto');
      prueba(r.pisado === JSON.stringify({ uid: r.miUid, ok: false, estado: 'pendiente' }), 'capa: la respuesta tardía de una cuenta anterior NO pisa el estado de la cuenta actual', r.pisado);
      prueba(r.renders === 0, 'capa: una respuesta tardía descartada no provoca ningún redibujo', String(r.renders));
      prueba(r.trasIngreso === 'idle/false', 'capa: cada ingreso (afterLogin) descarta la autorización anterior y vuelve a preguntar', r.trasIngreso);
      prueba(r.trasLimpieza === 'idle/false', 'capa: toda salida de sesión (cleanup) descarta la autorización', r.trasLimpieza);
      await s.ctx.close(); }
    }
    if (SEC(11)) {
    // 11) Archivos
    const dif = cp.execSync(`git -C "${REPO}" diff origin/main --stat -- nexa`).toString();
    prueba(!/_headers|supabase\.js|config\.js/.test(dif), 'no se modificó _headers, config.js ni supabase.js (CSP y marcos siguen igual)');
    const html = fs.readFileSync(path.join(NUEVA, 'index.html'), 'utf8');
    prueba(!/PA_CONFIG\s*&&\s*PA_CONFIG\.fel|PA_CONFIG\.fel\.url|c\.dominios/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')), 'el código ya no lee PA_CONFIG.fel (se eliminó la regla anterior basada en configuración del navegador y en el rol admin)');
    prueba(!/function felVis\(\)\{[^}]*role/.test(html), 'felVis() no mira el rol');
    prueba(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(html.slice(html.indexOf('/* ===== NEXA FEL desde el panel principal'), html.indexOf('V.fel=()=>felView();'))), 'el código de NEXA FEL no contiene ningún UUID');
    }
  } finally { await b.close(); nueva.s.close(); base.s.close(); fs.rmSync(BASE_DIR, { recursive: true, force: true }); }
  console.log(fallos ? `${fallos} fallo(s)` : 'ACCESO EXCLUSIVO A NEXA FEL DESDE NEXA: OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
