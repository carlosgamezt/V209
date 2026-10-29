/* Service worker de Nexa (v423).
   Primero red y, si no hay internet, la copia guardada. También muestra los avisos push. No toca datos ni fotos. */
const CACHE = 'pa-shell-nexacorp-v423';
const SHELL = ['./', './index.html', './config.js', './supabase.js', './manifest.webmanifest', './icon-192.png?v=423', './icon-512.png?v=423', './apple-touch-icon.png?v=423', './badge-96.png?v=423'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pa-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Arranque rápido: los archivos fijos (librería, íconos) salen de la copia guardada al instante y se renuevan por detrás.
   index.html y config.js usan la red, pero si tarda más de 2.5 s se abre la copia guardada (no queda la pantalla en blanco). */
const FIJOS = /\/(supabase\.js|591\.supabase\.js|[^/]*\.png|manifest\.webmanifest)$/;
const guardar = (req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) } return res };
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const u = new URL(req.url);
  if (FIJOS.test(u.pathname)) {
    e.respondWith(caches.match(req).then(hit => { const red = fetch(req).then(r => guardar(req, r)).catch(() => hit); return hit || red }));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const red = fetch(req).then(r => guardar(req, r));
    if (!hit) return red.catch(() => caches.match('./index.html'));
    const espera = new Promise(ok => setTimeout(() => ok(hit), 2500));
    return Promise.race([red.catch(() => hit), espera]);
  })());
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json() } catch (_) { d = { body: e.data ? e.data.text() : '' } }
  try { self.navigator.setAppBadge && self.navigator.setAppBadge() } catch (_) {}
  e.waitUntil((async () => { await self.registration.showNotification(d.title || 'Nexa', { body: d.body || '', icon: 'icon-192.png?v=423', badge: 'badge-96.png?v=423', tag: d.pid || 'nexa', data: { pid: d.pid || null } }); if (typeof d.pend === 'number') { await pendSet(d.pend); await pendShow(d.pend) } })())
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const pid = e.notification.data && e.notification.data.pid;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) { if ('focus' in c) { c.postMessage({ pa: pid }); return c.focus() } }
    return clients.openWindow(new URL('./' + (pid ? '?pa=' + encodeURIComponent(pid) : ''), self.registration.scope).href)
  }))
});

/* Aviso fijo "N planes por revisar": se vuelve a mostrar si lo deslizas, hasta que ya no haya pendientes. */
const PEND_URL = './__pend';
async function pendGet() { try { const r = await (await caches.open('pa-state')).match(PEND_URL); return r ? parseInt(await r.text(), 10) || 0 : 0 } catch (_) { return 0 } }
async function pendSet(n) { try { await (await caches.open('pa-state')).put(PEND_URL, new Response(String(n))) } catch (_) {} }
async function pendOnGet() { try { const r = await (await caches.open('pa-state')).match('./__pendon'); return r ? (await r.text()) !== '0' : true } catch (_) { return true } }
async function pendShow(n) {
  try { self.navigator.setAppBadge && (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()) } catch (_) {}
  const old = await self.registration.getNotifications({ tag: 'nexa-pend' });
  if (n <= 0 || !(await pendOnGet())) { old.forEach(x => x.close()); return }
  if (n <= 0) { old.forEach(x => x.close()); return }
  return self.registration.showNotification('Nexa', { body: n === 1 ? '1 plan por revisar' : n + ' planes por revisar', tag: 'nexa-pend', renotify: false, silent: true, requireInteraction: true, icon: 'icon-192.png?v=423', badge: 'badge-96.png?v=423', data: { pid: null, pend: 1 } });
}
self.addEventListener('message', e => {
  const d = e.data || {}; if (typeof d.pend !== 'number') return;
  e.waitUntil((async () => { if (typeof d.on === 'boolean') await (await caches.open('pa-state')).put('./__pendon', new Response(d.on ? '1' : '0')); await pendSet(d.pend); if (d.pend <= 0 || !d.show) { const o = await self.registration.getNotifications({ tag: 'nexa-pend' }); if (d.pend <= 0 || o.length) o.forEach(x => x.close()); if (d.pend > 0) return; return } await pendShow(d.pend) })());
});
self.addEventListener('notificationclose', e => {
  if (e.notification.tag !== 'nexa-pend') return;
  e.waitUntil((async () => { const n = await pendGet(); if (n > 0) await pendShow(n) })());
});
