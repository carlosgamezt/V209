// Precarga de pruebas: redirige las llamadas HTTPS de super-api a Microsoft (Graph, login, sesiones de carga) hacia el servidor simulado. Solo para el banco de pruebas.
const BASE = Deno.env.get('FAKE_BASE')!, real = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input: any, init?: any) => {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (u.hostname === 'graph.microsoft.com') return real(BASE + '/graph' + u.pathname.replace(/^\/v1\.0/, '') + u.search, init)
  if (u.hostname === 'login.microsoftonline.com') return real(BASE + '/login' + u.pathname, init)
  if (/\.sharepoint\.com$/.test(u.hostname)) return real(BASE + '/up' + u.pathname, init)
  return real(input, init)
}
