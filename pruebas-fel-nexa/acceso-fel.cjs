/* Prueba local (sin red, sin credenciales) del acceso a NEXA FEL desde el panel principal de NEXA.
   Uso:  node pruebas-fel-nexa/acceso-fel.cjs          (desde la raíz del repositorio; necesita Playwright y la rama base origin/main)
   · Compara la navegación de CADA rol contra la de origin/main (la versión de NEXA sin este cambio).
   · Apagado por defecto, URL válida/inválida, solo el administrador, abrir en ventana propia sin compartir nada,
     módulos actuales sin errores, teléfono y computadora sin desplazamiento horizontal.
   No usa Supabase (modo de pruebas de NEXA con config.js interceptado) ni toca la red: todo lo externo se aborta. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const NUEVA = path.join(REPO, 'nexa');
const BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-base-'));
cp.execSync(`git -C "${REPO}" archive origin/main nexa | tar -x -C "${BASE_DIR}"`);
const BASE = path.join(BASE_DIR, 'nexa');
const FEL = 'https://nexa-fel-demo.pages.dev/';
let fallos = 0;
const ok = (m) => console.log('OK    ' + m), mal = (m) => { console.log('FALLO ' + m); fallos++; };
const prueba = (c, m, extra) => (c ? ok(m) : (mal(m), extra && console.log('      ' + extra)));

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
const ROLES = ['admin', 'supervisor', 'comodin', 'inventarios', 'visualizador', 'analista', 'gerencia', 'sucursal'];

async function sesion(browser, url, cfg, rol, vp, salidas) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 800 } });
  const externos = []; const errores = [];
  // modo de pruebas de NEXA: se sustituye SOLO el objeto de configuración del documento (index.html lo trae incrustado) y se intercepta config.js; el resto del código no se toca
  await ctx.route((u) => ['127.0.0.1', 'localhost'].includes(u.hostname) && /^\/(index\.html)?$/.test(u.pathname), async (r) => {
    const resp = await r.fetch(); const body = (await resp.text()).replace(/window\.PA_CONFIG\s*=\s*\{[^}]*\};/, 'window.PA_CONFIG=' + JSON.stringify(cfg) + ';');
    await r.fulfill({ response: resp, body });
  });
  await ctx.route(/\/config\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.PA_CONFIG=' + JSON.stringify(cfg) + ';' }));
  await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => {
    if (r.request().url().startsWith(FEL.slice(0, -1)) || r.request().url().includes('pages.dev')) { externos.push({ url: r.request().url(), ref: r.request().headers()['referer'] || null, ck: r.request().headers()['cookie'] || null }); return r.fulfill({ contentType: 'text/html', body: '<title>FEL de prueba</title><h1>NEXA FEL</h1>' }); }
    externos.push({ url: r.request().url(), ref: null, ck: null }); return r.abort();
  });
  // la versión que publica el servidor (version.json) se iguala a la de la página probada: así no sale el aviso «Nueva versión disponible» (ajeno a este cambio) y no tapa la navegación
  await ctx.route(/\/version\.json(\?.*)?$/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: (fs.readFileSync(path.join(RAIZ[url], 'index.html'), 'utf8').match(/APP_VER='(v\d+)'/) || [])[1] }) }));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errores.push(e.message));
  await pg.goto(url); await pg.waitForSelector('#lu', { timeout: 15000 });
  const id = await pg.evaluate((r) => db.users.find((u) => u.role === r).id, rol);
  await pg.selectOption('#lu', id); await pg.fill('#lp', '1234'); await pg.click('button:has-text("ENTRAR")');
  await pg.waitForSelector('aside .nv', { timeout: 15000 });
  return { ctx, pg, externos, errores };
}
const etiquetas = (pg) => pg.$$eval('aside .nv .lb', (e) => e.map((x) => x.textContent.trim()));

(async () => {
  const b = await chromium.launch();
  const nueva = await servir(NUEVA), base = await servir(BASE); RAIZ[nueva.url] = NUEVA; RAIZ[base.url] = BASE;
  try {
    // 1) Navegación de cada rol: NUEVA con FEL apagado == origin/main (y el administrador con FEL encendido solo añade «FEL»)
    const linea = {};
    const hay = await (async () => { const s = await sesion(b, base.url, {}, 'admin'); const r = await s.pg.evaluate(() => [...new Set(db.users.map((u) => u.role))]); await s.ctx.close(); return r; })();
    console.log('roles con usuario de prueba: ' + hay.join(', '));
    for (const rol of ROLES.filter((r) => hay.includes(r))) {
      const sb = await sesion(b, base.url, {}, rol); const lb = await etiquetas(sb.pg); await sb.ctx.close();
      const s0 = await sesion(b, nueva.url, {}, rol); const l0 = await etiquetas(s0.pg); await s0.ctx.close();
      const s1 = await sesion(b, nueva.url, { fel: { url: FEL } }, rol); const l1 = await etiquetas(s1.pg); await s1.ctx.close();
      linea[rol] = lb;
      prueba(JSON.stringify(lb) === JSON.stringify(l0), `${rol}: con FEL apagado la navegación es IDÉNTICA a la de origin/main (${lb.length} elementos)`, JSON.stringify([lb, l0]));
      if (rol === 'admin') prueba(l1.includes('NEXA FEL') && JSON.stringify(l1.filter((x) => x !== 'NEXA FEL')) === JSON.stringify(lb), `${rol}: con FEL encendido solo se AÑADE «NEXA FEL» (los ${lb.length} módulos actuales siguen en el mismo orden)`, JSON.stringify([lb, l1]));
      else prueba(JSON.stringify(l1) === JSON.stringify(lb), `${rol}: con FEL encendido NO ve FEL y su navegación no cambia`, JSON.stringify([lb, l1]));
    }
    // 2) URL no válidas o inseguras: el administrador NO ve FEL
    const malas = ['http://nexa-fel-demo.pages.dev/', 'https://evil.example.com/', 'javascript:alert(1)', 'https://u:p@nexa-fel-demo.pages.dev/', 'https://nexa-fel-demo.pages.dev:8443/', 'https://nexa-fel-demo.pages.dev.evil.com/', '', 'sin-url', 12];
    for (const u of malas) {
      const s = await sesion(b, nueva.url, { fel: { url: u } }, 'admin'); const l = await etiquetas(s.pg); await s.ctx.close();
      prueba(!l.includes('NEXA FEL'), `URL rechazada, no aparece FEL: ${JSON.stringify(u)}`);
    }
    { const s = await sesion(b, nueva.url, { fel: { url: 'https://fel.ejemplo.com/', dominios: ['fel.ejemplo.com'] } }, 'admin'); const l = await etiquetas(s.pg); await s.ctx.close(); prueba(l.includes('NEXA FEL'), 'un dominio de la lista «dominios» se acepta'); }
    { const s = await sesion(b, nueva.url, { fel: { url: 'https://otro.ejemplo.com/', dominios: ['fel.ejemplo.com'] } }, 'admin'); const l = await etiquetas(s.pg); await s.ctx.close(); prueba(!l.includes('NEXA FEL'), 'un dominio que NO está en la lista se rechaza'); }
    // 3) La pantalla FEL y el acceso (computadora): ventana propia, sin compartir nada
    {
      const s = await sesion(b, nueva.url, { fel: { url: FEL, etiqueta: 'Demostración' } }, 'admin');
      const antes = s.externos.length;
      await s.pg.click('aside .nv:has-text("NEXA FEL")'); await s.pg.waitForSelector('main a.btn');
      const txt = await s.pg.textContent('main');
      prueba(/Certificación fiscal: DESHABILITADA/.test(txt) && /simuladas y sin valor fiscal/.test(txt), 'la pantalla dice que la certificación fiscal está DESHABILITADA y que las facturas son simuladas');
      prueba(/propio inicio de sesión/.test(txt) && /no se comparte/.test(txt), 'la pantalla explica que FEL tiene su propio inicio de sesión y que la sesión de NEXA no se comparte');
      const a = await s.pg.$eval('main a.btn', (e) => ({ h: e.getAttribute('href'), t: e.target, r: e.rel }));
      prueba(a.h === FEL && a.t === '_blank' && /noopener/.test(a.r) && /noreferrer/.test(a.r), 'el enlace abre FEL en ventana propia con noopener y noreferrer', JSON.stringify(a));
      prueba(s.externos.length === antes, 'NEXA no hizo ninguna petición a FEL ni a otro servidor externo antes de abrirlo');
      const [pop] = await Promise.all([s.ctx.waitForEvent('page'), s.pg.click('main a.btn')]);
      await pop.waitForLoadState();
      prueba(pop.url() === FEL, 'se abre exactamente la URL configurada, sin parámetros', pop.url());
      prueba((await pop.evaluate(() => window.opener)) === null, 'la ventana de FEL no puede acceder a NEXA (window.opener es nulo)');
      const pet = s.externos.find((x) => x.url.startsWith(FEL.slice(0, -1)));
      prueba(pet && !pet.ref && !pet.ck, 'la petición a FEL no lleva Referer ni cookies de NEXA', JSON.stringify(pet));
      prueba(s.errores.length === 0, 'sin errores de JavaScript en NEXA', s.errores.join(' | '));
      await s.ctx.close();
    }
    // 4) Módulos actuales del administrador con FEL encendido: cada uno se abre sin errores y el Dashboard queda igual que sin FEL
    {
      const s1 = await sesion(b, nueva.url, { fel: { url: FEL } }, 'admin'); const s0 = await sesion(b, nueva.url, {}, 'admin');
      const vistas = await s1.pg.evaluate(() => PERMS[me.role].views);
      for (const v of vistas) { await s1.pg.evaluate((x) => navTo(x), v); await s1.pg.waitForTimeout(150); const n = (await s1.pg.textContent('main')).length; if (n < 20) mal(`el módulo ${v} quedó vacío`); }
      prueba(s1.errores.length === 0, `los ${vistas.length} módulos del administrador se abren sin errores con FEL encendido`, s1.errores.join(' | '));
      await s1.pg.evaluate(() => navTo('dash')); await s0.pg.evaluate(() => navTo('dash')); await s1.pg.waitForTimeout(300); await s0.pg.waitForTimeout(300);
      const d1 = await s1.pg.$eval('main', (e) => e.innerText.replace(/\d{1,2}:\d{2}/g, '')), d0 = await s0.pg.$eval('main', (e) => e.innerText.replace(/\d{1,2}:\d{2}/g, ''));
      prueba(d1 === d0, 'el Dashboard es idéntico con FEL encendido y apagado');
      await s1.ctx.close(); await s0.ctx.close();
    }
    // 5) Teléfono y computadora: sin desplazamiento horizontal; en el teléfono FEL está en «Más» y es alcanzable
    for (const [nombre, vp, movil] of [['teléfono 360', { width: 360, height: 740 }, 1], ['teléfono 390', { width: 390, height: 844 }, 1], ['teléfono 412', { width: 412, height: 915 }, 1], ['tableta 820', { width: 820, height: 1180 }, 0], ['computadora 1100', { width: 1100, height: 800 }, 0], ['computadora 1440', { width: 1440, height: 900 }, 0]]) {
      const s = await sesion(b, nueva.url, { fel: { url: FEL } }, 'admin', vp);
      const sw = async () => s.pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      prueba((await sw()) <= 0, `${nombre}: el panel con FEL encendido no se desborda horizontalmente`);
      const bt = s.pg.locator('aside .nv:has-text("NEXA FEL")');
      const vis0 = await bt.isVisible(); if (movil) prueba(!vis0, `${nombre}: FEL queda dentro de «Más» (no desplaza los accesos principales)`); if (!vis0) { await s.pg.click('aside .nv.more'); await s.pg.waitForTimeout(250); }
 await bt.scrollIntoViewIfNeeded(); const caja = await bt.boundingBox();
      prueba(caja && caja.width >= 36 && caja.height >= 36 && caja.x >= 0 && caja.x + caja.width <= vp.width + 1, `${nombre}: el botón FEL es visible, entra en pantalla y mide ≥ 36 px`, JSON.stringify(caja));
      await bt.click(); await s.pg.waitForSelector('main a.btn'); await s.pg.waitForTimeout(200);
      prueba((await sw()) <= 0, `${nombre}: la pantalla de FEL no se desborda horizontalmente`);
      const ab = await s.pg.locator('main a.btn').boundingBox();
      prueba(ab && ab.height >= 36 && ab.x >= 0 && ab.x + ab.width <= vp.width + 1, `${nombre}: «Abrir NEXA FEL» es visible y tocable`, JSON.stringify(ab));
      prueba(s.errores.length === 0, `${nombre}: sin errores de JavaScript`, s.errores.join(' | '));
      await s.ctx.close();
    }
    // 6) Archivos: el service worker y las cabeceras no se tocan salvo la versión
    const dif = cp.execSync(`git -C "${REPO}" diff origin/main --stat -- nexa`).toString();
    prueba(!/_headers|supabase\.js|config\.js/.test(dif), 'no se modificó _headers, config.js ni supabase.js (CSP y marcos siguen igual)');
    const swd = cp.execSync(`git -C "${REPO}" diff origin/main -U0 -- nexa/sw.js`).toString().split('\n').filter((l) => /^[+-][^+-]/.test(l));
    prueba(swd.length === 4 && swd.every((l) => /v51[23]/.test(l)), 'del service worker solo cambia la versión (4 líneas)', swd.join(' | '));
  } finally { await b.close(); nueva.s.close(); base.s.close(); fs.rmSync(BASE_DIR, { recursive: true, force: true }); }
  console.log(fallos ? `${fallos} fallo(s)` : 'ACCESO A NEXA FEL DESDE NEXA: OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
