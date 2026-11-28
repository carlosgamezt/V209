// Prueba de humo de la función recordatorios-de-nexa (ejecutándola de verdad con Deno) contra un PostgREST simulado.
const plan = (id: string, d: string) => ({ id, status: 'En proceso', region: 2, branch: 'Mixco', type: 'Inventarios', acts: [{ st: 'Pendiente', deadline: d, dr: null, tl: [] }] })
const PL = [plan('P1', '2026-11-28'), plan('P2', '2026-11-30')]
const users = [{ id: 'u1', role: 'sucursal', region: '2', branch: 'Mixco', assigned: null }, { id: 'u2', role: 'supervisor', region: '2', branch: null, assigned: null }]
const log: string[] = []; let planesRpcOk = true, usersAlias = true
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
const fake = Deno.serve({ port: 0, onListen() {} }, async (r) => {
  const u = new URL(r.url), p = u.pathname; log.push(r.method + ' ' + p + (u.searchParams.get('select') ? ' ?select=' + u.searchParams.get('select') : ''))
  if (p.endsWith('/rpc/nexa_cron_check')) { const b = await r.json(); return json(b.p === 'NUEVO-SECRETO') }
  if (p.endsWith('/rpc/nexa_recordatorios_planes')) return planesRpcOk ? json(PL) : json({ message: 'no existe' }, 404)
  if (p.endsWith('/pa_docs_lite')) return json(PL.map((d) => ({ data: d })))
  if (p.endsWith('/pa_docs')) {
    const col = (u.searchParams.get('col') || '').replace('eq.', ''), sel = u.searchParams.get('select') || ''
    if (col === 'users') return sel.includes('role:data') ? (usersAlias ? json(users) : json({ message: 'x' }, 400)) : json(users.map((x) => ({ id: x.id, data: x })))
    if (col === 'meta') return json({ data: {} })
    return json([])
  }
  return json([])
})
const fp = fake.addr.port
const PORT = 18100 + Math.floor(Math.random() * 500)
const child = new Deno.Command('deno', { args: ['run', '-A', new URL('../../supabase/functions/recordatorios-de-nexa/index.ts', import.meta.url).pathname], env: { SUPABASE_URL: `http://127.0.0.1:${fp}`, SB_SECRET: 'x', CRON_SECRET: 'VIEJO-SECRETO', DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORT}` }, stdout: 'null', stderr: 'null' }).spawn()
let fallos = 0; const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallos++ }
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.body?.cancel()); break } catch { await new Promise((r) => setTimeout(r, 250)) } }
const call = async (h: Record<string, string>, b: unknown) => { const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() } }
const N = { 'x-cron-secret': 'NUEVO-SECRETO' }
ok((await call({}, { mode: 'badge', dry: true })).s === 401, 'sin secreto: 401')
ok((await call({ 'x-cron-secret': 'otro' }, { mode: 'badge', dry: true })).s === 401, 'secreto equivocado: 401')
ok((await call({ 'x-cron-secret': 'x'.repeat(500) }, { mode: 'badge', dry: true })).s === 401, 'secreto absurdo: 401 sin consultar la base')
let r = await call(N, { mode: 'badge', dry: true }); ok(r.s === 200 && r.j.lectura.fuente === 'lectura minima' && r.j.lectura.modo === 'badge' && r.j.lectura.usuarios === 2 && r.j.total === 1, 'secreto nuevo: acepta y usa la lectura mínima (badge): ' + JSON.stringify(r.j.lectura))
r = await call({ 'x-cron-secret': 'VIEJO-SECRETO' }, { mode: 'unread', dry: true }); ok(r.s === 401, 'fase 2: el secreto anterior del entorno ya NO se acepta')
r = await call(N, { mode: 'unread', dry: true }); ok(r.s === 200 && r.j.lectura.modo === 'unread', 'el secreto de la base sigue aceptándose en unread')
r = await call(N, { slot: 'am', dry: true, today: '2026-11-28' }); ok(r.s === 200 && r.j.lectura.modo === 'recordatorios' && r.j.total === 2, 'recordatorio diario: 2 avisos (sucursal y supervisor no, solo sucursal por plan) → ' + r.j.total)
const antes = log.length; await call(N, { slot: 'pm', dry: true, today: '2026-11-28' }); const q = log.slice(antes).join('\n')
ok(!/pa_descargas|col=eq.meta|\/pa_docs_lite/.test(q) && !q.includes('select=id,data'), 'el recordatorio diario no consulta descargas ni configuración ni la vista pesada')
r = await call(N, { mode: 'badge', dry: true, legacy: true }); ok(r.s === 200 && r.j.lectura.fuente.startsWith('vista ligera'), 'dry con legacy: usa la vista ligera para comparar')
ok(JSON.stringify((await call(N, { mode: 'badge', dry: true })).j.usuarios) === JSON.stringify(r.j.usuarios), 'mismos contadores con lectura mínima y con vista ligera')
planesRpcOk = false; r = await call(N, { mode: 'badge', dry: true }); ok(r.s === 200 && r.j.lectura.fuente.startsWith('vista ligera'), 'si la lectura mínima no existe: retroceso a la vista ligera y sigue funcionando')
usersAlias = false; r = await call(N, { mode: 'badge', dry: true }); ok(r.s === 200 && r.j.lectura.usuarios === 2, 'si la consulta ligera de usuarios falla: retroceso a la lectura completa')
child.kill(); await fake.shutdown(); console.log(fallos ? 'FUNCION FALLO ' + fallos : 'FUNCION OK'); Deno.exit(fallos ? 1 : 0)
