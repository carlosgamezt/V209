// Prueba de super-api EJECUTÁNDOLA (Deno) contra un Supabase/PostgREST y un OneDrive (Graph) simulados. Cubre: autorización de fotos (off/log/enforce), enlaces temporales en caché y con retroceso, concurrencia, contadores del aviso fijo, mover planes y papelera con miniaturas.
import webpush from 'npm:web-push@3.6.7'
const vapid = webpush.generateVAPIDKeys()
const T: Record<string, any> = { admin: { auth_id: 'a1', user_id: 'admin', role: 'admin', login: 'admin' }, suc: { auth_id: 'a2', user_id: 'suc11', role: 'sucursal', region: '1', branch: 'b11', login: 'suc11' }, otra: { auth_id: 'a3', user_id: 'suc21', role: 'sucursal', region: '2', branch: 'b21', login: 'suc21' }, sup: { auth_id: 'a4', user_id: 'sup1', role: 'supervisor', region: '1', login: 'sup1' } }
const bearer = (k: string) => 'Bearer tok-' + k
const store = new Map<string, Uint8Array>(), log: string[] = [], calls: Record<string, number> = {}
const cnt = (k: string) => { calls[k] = (calls[k] || 0) + 1 }
let rpcFoto: (tok: string, b: any) => any = () => true, pendMode = 'ok', dlFail = 0
const pa_docs: any[] = [
  { col: 'users', id: 's1', data: { id: 's1', role: 'sucursal', region: '1', branch: 'Mixco', name: 'Mixco' } }, { col: 'users', id: 'sup2', data: { id: 'sup2', role: 'supervisor', region: '2' } },
  { col: 'plans', id: 'PA-1', data: { id: 'PA-1', region: '1', branch: 'Mixco', acts: [] } }, { col: 'plans', id: 'PA-2', data: { id: 'PA-2', region: '1', branch: 'Mixco', acts: [] } },
  { col: 'users', id: 'u9', data: { role: 'sucursal', region: '1', branch: 'Mixco' } }, { col: 'plans', id: 'PA-9', data: { id: 'PA-9', region: '1', branch: 'X', status: 'En proceso', acts: [{ st: 'Pendiente' }] } }]
const trash: any[] = [{ id: 'T1', payload: { plans: [{ id: 'PA-7', data: { acts: [{ ev: { k: 'PA-7#ev1#1795000000001', o: 1, x: 'jpg' }, ref: { k: 'ref#1795000000002' } }] } }] } }]
const jr = (o: unknown, s = 200, h: Record<string, string> = {}) => s === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } })
const getp = (u: URL, k: string) => u.searchParams.get(k) || ''
function filtra(rows: any[], u: URL) {
  let r = rows
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit'].includes(k)) continue
    const m = /^(eq|in)\.(.*)$/.exec(v); if (!m) continue
    const get = (x: any) => { if (k.startsWith('data->>')) return x.data && x.data[k.slice(7)] !== undefined ? String(x.data[k.slice(7)]) : undefined; return x[k] }
    if (m[1] === 'eq') r = r.filter((x) => String(get(x)) === m[2])
    else { const set = new Set(m[2].replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))); r = r.filter((x) => set.has(String(get(x)))) }
  }
  return r
}
const fake = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  const u = new URL(req.url), p = u.pathname; const auth = req.headers.get('authorization') || ''
  const single = (req.headers.get('accept') || '').includes('vnd.pgrst.object')
  const respond = (rows: any[]) => single ? (rows.length ? jr(rows[0]) : jr({ code: 'PGRST116', message: 'no rows' }, 406)) : jr(rows)
  if (p === '/auth/v1/user') { const k = auth.replace('Bearer tok-', ''); return T[k] ? jr({ id: T[k].auth_id }) : jr({ message: 'bad' }, 401) }
  if (p === '/rest/v1/pa_profiles') return respond(filtra(Object.values(T), u).filter((x: any) => !u.searchParams.get('auth_id') || x.auth_id === u.searchParams.get('auth_id').replace('eq.', '')).concat([]))
  if (p === '/rest/v1/rpc/nexa_foto_acceso') { cnt('rpc_foto'); const b = await req.json(); const r = rpcFoto(auth, b); return r === 'error' ? jr({ message: 'no existe la función' }, 404) : jr(r) }
  if (p === '/rest/v1/rpc/nexa_push_pendientes') { cnt('rpc_push'); return pendMode === 'ok' ? jr({ u1: 3 }) : jr({ message: 'no existe' }, 404) }
  if (p === '/rest/v1/rpc/pa_docs_patch') { cnt('patch'); const b = await req.json(); log.push('patch ' + b.p_id + ' ' + JSON.stringify(b.p_ops)); const row = pa_docs.find((x) => x.col === b.p_col && x.id === b.p_id); if (!row) return jr(null); for (const o of b.p_ops) row.data[o.path[0]] = o.value; return jr('2026-11-28T10:00:00Z') }
  if (p === '/rest/v1/pa_push') { cnt('pa_push'); return jr([]) }
  if (p === '/rest/v1/pa_secrets') return req.method === 'GET' ? respond([{ value: 'rt' }]) : jr({}, 201)
  if (p === '/rest/v1/pa_thumbs') { log.push('thumbs ' + req.method + ' ' + u.search); return jr({}, 204) }
  if (p === '/rest/v1/pa_trash') { if (req.method === 'DELETE') { cnt('trash_del'); return jr({}, 204) } return respond(filtra(trash, u)) }
  if (p === '/rest/v1/pa_docs') {
    cnt('pa_docs_' + req.method + '_' + (getp(u, 'col').replace('eq.', '') || 'x'))
    if (req.method === 'PATCH') { const b = await req.json(); for (const r of filtra(pa_docs, u)) r.data = b.data; log.push('update ' + u.search); return jr({}, 204) }
    if (req.method === 'GET') return respond(filtra(pa_docs, u))
    return jr({}, 204)
  }
  // ---- OneDrive (Graph) simulado ----
  if (p === '/login/ten/oauth2/v2.0/token') return jr({ access_token: 'g-token', expires_in: 3600, refresh_token: 'rt2' })
  const gm = /^\/graph\/me\/drive\/root:\/PlanesAccion\/evidencias\/([^:]+)(:\/(content|createUploadSession))?$/.exec(p)
  if (gm) {
    const name = decodeURIComponent(gm[1]), kind = gm[3]
    if (kind === 'createUploadSession') { cnt('upload_session'); return jr({ uploadUrl: 'https://tenant.sharepoint.com/sess/' + name }) }
    if (req.method === 'DELETE') { cnt('graph_del'); store.delete(name); return jr({}, 204) }
    if (kind === 'content') { cnt('graph_content'); const b = store.get(name); return b ? new Response(b, { headers: { 'content-type': 'image/jpeg' } }) : jr({}, 404) }
    cnt('graph_meta'); if (!store.has(name)) return jr({ error: { message: 'no' } }, 404)
    return jr({ '@microsoft.graph.downloadUrl': `http://127.0.0.1:${fake.addr.port}/dl/${encodeURIComponent(name)}` })
  }
  if (p.startsWith('/dl/')) {
    cnt('dl'); if (dlFail > 0) { dlFail--; return new Response('expirado', { status: 403 }) }
    const b = store.get(decodeURIComponent(p.slice(4))); if (!b) return new Response('', { status: 404 })
    const rg = /bytes=(\d+)-(\d+)/.exec(req.headers.get('range') || ''); if (!rg) return new Response(b, { headers: { 'content-type': 'image/jpeg' } })
    const s = +rg[1], e = Math.min(+rg[2], b.length - 1); return new Response(b.slice(s, e + 1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${s}-${e}/${b.length}` } })
  }
  return jr({ message: 'ruta no simulada ' + p }, 404)
})
const FB = `http://127.0.0.1:${fake.addr.port}`
let fallos = 0; const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallos++ }
async function arranca(modo: string) {
  const port = 18700 + Math.floor(Math.random() * 600), errs: string[] = []
  const child = new Deno.Command('deno', { args: ['run', '-A', '--preload', new URL('./super_api_stub.ts', import.meta.url).pathname, new URL('../../supabase/functions/super-api/index.ts', import.meta.url).pathname], env: { FAKE_BASE: FB, SUPABASE_URL: FB, SB_SECRET: 'svc', SUPABASE_ANON_KEY: 'anon', MS_TENANT: 'ten', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', PHOTO_AUTH: modo, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}` }, stdout: 'null', stderr: 'piped' }).spawn()
  ;(async () => { const dec = new TextDecoder(); for await (const c of child.stderr) errs.push(dec.decode(c)) })()
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/`, { method: 'OPTIONS' }).then((r) => r.body?.cancel()); break } catch { await new Promise((r) => setTimeout(r, 250)) } }
  const call = async (who: string | null, b: unknown) => { const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: bearer(who) } : {}) }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
  return { call, errs, stop: () => child.kill(), port }
}
const PH = new Uint8Array(2_000_000).fill(7); store.set('PA-111_ev1_1795000000001.jpg', PH); store.set('ref_1795000000002.jpg', PH); store.set('foto_rara.jpg', PH)
const EV = 'PA-111_ev1_1795000000001.jpg'
// reglas simuladas de nexa_foto_acceso: la sucursal 'suc' ve y escribe el plan PA-111; 'otra' no; 'sup' solo ve
rpcFoto = (tok, b) => { const w = tok.replace('Bearer tok-', ''); if (b.p_tipo === 'ev') return w === 'suc' || w === 'admin' || (w === 'sup' && !b.p_escritura); if (b.p_tipo === 'ref') return b.p_escritura ? ['admin', 'sup'].includes(w) : w !== 'otra'; return false }

// ===== enforce =====
let S = await arranca('enforce')
ok((await S.call(null, { action: 'get', name: EV })).s === 401, 'sin sesión: 401')
let r = await S.call('suc', { action: 'photo_data', name: EV, offset: 0, length: 1000 }); ok(r.s === 200 && r.j.ok && r.j.total === 2_000_000, 'enforce: la sucursal dueña del plan lee su evidencia (tramo)')
r = await S.call('otra', { action: 'photo_data', name: EV, offset: 0, length: 1000 }); ok(r.s === 403 && r.j.denied === true, 'enforce: otra sucursal NO lee evidencia ajena (403)')
r = await S.call('otra', { action: 'get', name: EV }); ok(r.s === 403, 'enforce: otra sucursal NO obtiene el enlace de descarga')
r = await S.call('otra', { action: 'put_begin', name: 'PA-111_ev1_1795000000009_orig.jpg', size: 5000 }); ok(r.s === 403, 'enforce: otra sucursal NO abre una sesión de carga sobre evidencia ajena')
r = await S.call('otra', { action: 'put', name: 'PA-111_ev1_1795000000009.jpg', data: 'data:image/jpeg;base64,AAAA' }); ok(r.s === 403, 'enforce: otra sucursal NO sobrescribe evidencia ajena (put)')
const antesSes = calls['upload_session'] || 0
r = await S.call('suc', { action: 'put_begin', name: 'PA-111_ev1_1795000000009_orig.jpg', size: 5000 }); ok(r.s === 200 && r.j.uploadUrl && (calls['upload_session'] || 0) === antesSes + 1 && r.j.chunk === 983040, 'enforce: quien puede actualizar el plan abre la sesión de carga (tramos de 960 KB)')
r = await S.call('sup', { action: 'put_begin', name: 'PA-111_ev1_1795000000010.jpg', size: 5000 }); ok(r.s === 403, 'enforce: quien solo puede VER el plan (supervisor en modo «ver») no escribe')
r = await S.call('sup', { action: 'put_begin', name: 'ref_1795000000003.jpg', size: 5000 }); ok(r.s === 200, 'enforce: el rol que crea planes sube la foto de referencia')
r = await S.call('suc', { action: 'put_begin', name: 'ref_1795000000003.jpg', size: 5000 }); ok(r.s === 403, 'enforce: la sucursal NO sube fotos de referencia')
r = await S.call('suc', { action: 'get', name: 'foto_rara.jpg' }); ok(r.s === 403, 'enforce: nombre sin plan asociado: solo administrador')
r = await S.call('admin', { action: 'get', name: 'foto_rara.jpg' }); ok(r.s === 200 && r.j.url, 'enforce: el administrador sí (nombre sin plan)')
r = await S.call('suc', { action: 'get', name: 'prueba_conexion.jpg' }); ok(r.s === 403, 'enforce: prueba_conexion.jpg solo administrador')
r = await S.call('suc', { action: 'get', name: 'ARQ_123_v1_dep_1795000000001.jpg' }); ok(r.s === 200 || r.s === 403, 'comprobante de arqueo clasificado'); 
r = await S.call('otra', { action: 'put_begin', name: 'ARQ_123_v1_dep_1795000000001.jpg', size: 100 }); ok(r.s === 403, 'enforce: la sucursal NO sube comprobantes de arqueo')
rpcFoto = () => 'error'; r = await S.call('suc', { action: 'get', name: EV }); ok(r.s === 403, 'enforce: si la comprobación falla se NIEGA (falla cerrada)')
rpcFoto = (tok, b) => { const w = tok.replace('Bearer tok-', ''); if (b.p_tipo === 'ev') return w === 'suc' || w === 'admin' || (w === 'sup' && !b.p_escritura); if (b.p_tipo === 'ref') return b.p_escritura ? ['admin', 'sup'].includes(w) : w !== 'otra'; return false }
// caché del enlace y enlace vencido
store.set('PA-222_ev1_1795000000555.jpg', PH); calls['graph_meta'] = 0; calls['dl'] = 0
for (let i = 0; i < 3; i++) await S.call('suc', { action: 'photo_data', name: 'PA-222_ev1_1795000000555.jpg', offset: i * 700000, length: 700000 })
ok(calls['graph_meta'] === 1 && calls['dl'] === 3, 'enlace temporal en memoria: 3 tramos = 1 consulta a Graph (antes 3) y 3 lecturas del archivo')
dlFail = 1; r = await S.call('suc', { action: 'photo_data', name: EV, offset: 0, length: 1000 }); ok(r.s === 200 && r.j.ok && r.j.total === 2_000_000, 'si el enlace en caché venció (403) se pide uno nuevo y la descarga sigue')
// concurrencia: 24 consultas simultáneas, existentes y no existentes, sin mezclar resultados
const ps = Array.from({ length: 24 }, (_, i) => S.call('admin', { action: 'get', name: i % 2 ? 'foto_rara.jpg' : `no_existe_${i}.jpg` }))
const rs = await Promise.all(ps); ok(rs.every((x, i) => i % 2 ? (x.j.url && true) : (x.j.url === null && x.j.exists === false)), 'concurrencia: 24 consultas a la vez (existentes y ausentes) devuelven cada una lo suyo (sin estado compartido)')
// enlaces directos para el cliente: get devuelve el enlace temporal de OneDrive, nunca token de Graph
r = await S.call('suc', { action: 'get', name: EV }); ok(r.s === 200 && /^http:\/\/127\.0\.0\.1:\d+\/dl\//.test(r.j.url) && !JSON.stringify(r.j).includes('g-token'), 'get entrega el enlace temporal y ninguna credencial de Microsoft')
// ---- avisos push ----
let t0 = Date.now(); r = await S.call('suc', { action: 'push_send', to: ['u1'], title: 't', body: 'b', pid: 'PA-1', synced: true }); let dt = Date.now() - t0
ok(r.j.ok && calls['rpc_push'] === 1 && dt < 1500, 'push con «synced»: contadores por SQL (1 consulta) y sin la espera de 1.8 s (' + dt + ' ms)')
const plansAntes = calls['pa_docs_GET_plans'] || 0; ok(plansAntes === 0, 'push: no se descargó ningún plan de pa_docs')
t0 = Date.now(); r = await S.call('suc', { action: 'push_send', to: ['u1'], title: 't', body: 'b' }); dt = Date.now() - t0; ok(r.j.ok && dt >= 1700, 'push de una versión anterior de la app (sin synced): conserva la espera de 1.8 s (' + dt + ' ms)')
r = await S.call('otra', { action: 'push_send', to: ['u1'], title: 'x', body: 'y', pid: 'PA-111', synced: true }); ok(r.s === 403 && r.j.denied === true, 'enforce: no se puede avisar sobre un plan que la persona no puede ver (aviso falso a otros)')
r = await S.call('suc', { action: 'push_send', to: ['u1'], title: 'x', body: 'y', pid: 'PA-111', synced: true }); ok(r.s === 200 && r.j.ok, 'enforce: quien ve el plan sí puede avisar')
pendMode = 'falta'; r = await S.call('suc', { action: 'push_send', to: ['u1'], synced: true }); ok(r.j.ok && (calls['pa_docs_GET_plans'] || 0) === 1, 'si la función SQL no existe: retroceso a la lectura anterior y el aviso sale igual'); pendMode = 'ok'
// ---- mover planes de sucursal: cambio puntual ----
r = await S.call('admin', { action: 'branch_edit', user_id: 's1', region: '2' }); ok(r.j.ok && r.j.moved === 2 && calls['patch'] === 2 && !log.some((l) => l.startsWith('update ?col=eq.plans')), 'branch_edit: 2 planes movidos con cambio PUNTUAL (pa_docs_patch), sin reescribir el plan')
ok(log.filter((l) => l.startsWith('patch')).every((l) => /"path":\["region"\]/.test(l) && /"path":\["branch"\]/.test(l)), 'el cambio puntual solo toca región y sucursal')
// ---- papelera: limpia miniaturas ----
r = await S.call('admin', { action: 'trash_purge', id: 'T1' }); ok(r.j.ok && calls['graph_del'] === 3 && log.some((l) => l.startsWith('thumbs DELETE') && l.includes('PA-7%23ev1%231795000000001') && l.includes('ref%231795000000002')), 'papelera: al borrar para siempre se borran las fotos de OneDrive (3 archivos) y sus miniaturas de pa_thumbs')
r = await S.call('suc', { action: 'trash_purge', id: 'T1' }); ok(r.s === 403, 'papelera: solo administrador')
r = await fetch(`http://127.0.0.1:${S.port}/`, { method: 'OPTIONS' }) as any; ok(r.status === 200 && r.headers.get('access-control-allow-origin') === '*', 'CORS: la petición previa responde 200 con los encabezados permitidos'); 
ok(!S.errs.join('').includes('g-token') && !S.errs.join('').includes('svc') && !S.errs.join('').includes('tok-'), 'los registros de la función no contienen tokens ni secretos')
S.stop()
// ===== log =====
S = await arranca('log'); const antes = calls['upload_session'] || 0
r = await S.call('otra', { action: 'put_begin', name: 'PA-111_ev1_1795000000011_orig.jpg', size: 5000 }); await new Promise((x) => setTimeout(x, 300))
ok(r.s === 200 && r.j.uploadUrl && (calls['upload_session'] || 0) === antes + 1 && S.errs.join('').includes('photo_auth_deny') && S.errs.join('').includes('"mode":"log"'), 'log: no bloquea pero deja constancia (photo_auth_deny) de lo que enforce negaría')
ok(S.errs.join('').includes('"role":"sucursal"') && !S.errs.join('').includes('uploadUrl'), 'el registro indica rol y nombre de la foto, sin direcciones de carga')
S.stop()
// ===== off =====
S = await arranca('off'); const rf = calls['rpc_foto'] || 0; r = await S.call('otra', { action: 'get', name: EV }); ok(r.s === 200 && (calls['rpc_foto'] || 0) === rf, 'off: sin comprobación por plan (comportamiento anterior)'); S.stop()
await fake.shutdown(); console.log(fallos ? 'SUPER-API FALLO ' + fallos : 'SUPER-API OK'); Deno.exit(fallos ? 1 : 0)
