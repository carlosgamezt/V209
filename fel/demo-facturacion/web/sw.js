// Service worker de la demostración: SOLO recursos estáticos públicos (hojas de estilo, scripts, íconos, manifiesto).
// NUNCA toca /api/ ni guarda facturas, sesiones ni datos fiscales: sin red, la aplicación avisa que no hay conexión en lugar de mostrar datos guardados.
const CACHE = "fel-estaticos-v1";
const ESTATICO = /^\/(web\/(css|js|icons)\/[A-Za-z0-9._-]+|app\/(css|js)\/[A-Za-z0-9._-]+|manifest\.webmanifest)$/;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/web/css/demo.css", "/app/css/fel.css", "/web/icons/icon-192.png"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin || !ESTATICO.test(u.pathname)) return;   // todo lo demás (API, páginas con datos) va directo a la red
  e.respondWith(fetch(r).then((resp) => { if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); } return resp; }).catch(() => caches.match(r).then((x) => x || Response.error())));
});
