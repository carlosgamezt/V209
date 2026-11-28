// Función "fotos" de Planes de Acción (slug: super-api): guarda y entrega las fotos de evidencia, y administra usuarios, sucursales y papelera.
// VERSIÓN SEGURA: todas las acciones (menos 'setup') exigen una sesión iniciada. Las de administrador exigen rol admin.
// Mejoras de esta versión (ver docs/egress/AUDITORIA-SUPER-API.md):
//  - Fotos: además de la sesión, se comprueba que la persona pueda leer/escribir el PLAN de la foto bajo las mismas políticas RLS (nexa_foto_acceso). Modo del secreto PHOTO_AUTH: off | log (por omisión: solo registra lo que negaría) | enforce.
//  - Avisos push: los contadores del aviso fijo se calculan en PostgreSQL (nexa_push_pendientes) en vez de bajar hasta 5000 planes; sin espera fija si la app confirma que ya guardó (synced).
//  - OneDrive: enlace de descarga en memoria 10 min (menos llamadas a Graph) y sin estado compartido entre peticiones.
//  - Mover planes de sucursal: cambio puntual (pa_docs_patch) en vez de reescribir el plan; papelera: al borrar para siempre también se limpian sus miniaturas.
// La app solo habla con esta función. Para cambiar de almacén (OneDrive -> Google Drive) se agrega un proveedor nuevo abajo y se cambia el secreto STORAGE_PROVIDER. La app no cambia.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (n) => Deno.env.get(n) || ''
const FOLDER = env('PA_FOLDER') || 'PlanesAccion/evidencias'
const db = () => createClient(env('SUPABASE_URL'), env('SB_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
// cliente con la sesión de QUIEN LLAMA: toda consulta pasa por las políticas RLS de esa persona
const userDb = (req) => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })

/* ---------- Proveedor: OneDrive (Microsoft Graph) ---------- */
const TENANT = env('MS_TENANT'), CID = env('MS_CLIENT_ID'), SEC = env('MS_CLIENT_SECRET')
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const SCOPE = 'https://graph.microsoft.com/Files.ReadWrite offline_access'
let cache = { t: '', exp: 0 }
const dlCache = new Map() // nombre -> { u: enlace temporal de descarga, exp }; solo en memoria, 10 minutos

async function tokenReq(params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID, client_secret: SEC, scope: SCOPE, ...params }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error_description || j.error || 'Error de Microsoft')
  return j
}
async function saveRefresh(rt) {
  const { error } = await db().from('pa_secrets').upsert({ key: 'ms_refresh_token', value: rt, updated_at: new Date().toISOString() })
  if (error) throw new Error('No se pudo guardar la vinculación: ' + error.message)
}
async function access() {
  if (cache.t && Date.now() < cache.exp) return cache.t
  const { data } = await db().from('pa_secrets').select('value').eq('key', 'ms_refresh_token').maybeSingle()
  if (!data) throw new Error('OneDrive todavía no está vinculado')
  const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: data.value })
  if (j.refresh_token) await saveRefresh(j.refresh_token)
  cache = { t: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 }
  return cache.t
}
async function graph(path, opts = {}) {
  return fetch('https://graph.microsoft.com/v1.0' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + (await access()), ...(opts.headers || {}) },
  })
}
const onedrive = {
  async setup(b) {
    const j = await tokenReq({ grant_type: 'authorization_code', code: b.code, redirect_uri: b.redirectUri })
    await saveRefresh(j.refresh_token)
    cache = { t: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 }
  },
  async who() {
    const r = await graph('/me?$select=displayName')
    const j = await r.json()
    if (!r.ok) throw new Error((j.error && j.error.message) || 'No se pudo leer la cuenta')
    return j.displayName
  },
  async put(name, bytes, mime) {
    const r = await graph(`/me/drive/root:/${FOLDER}/${name}:/content`, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || 'OneDrive rechazó la foto') }
    dlCache.delete(name)
  },
  // Entrega la foto completa o solo un tramo (offset/length). Devuelve también el tamaño total.
  async bytes(name, offset, length) {
    const ranged = length !== undefined
    const rng = ranged ? { headers: { Range: `bytes=${offset}-${offset + length - 1}` } } : {}
    let r
    for (let intento = 0; intento < 2; intento++) {
      const u = (await this.urlInfo(name)).url
      if (u) r = await fetch(u, rng)
      else { r = await graph(`/me/drive/root:/${FOLDER}/${name}:/content`, rng); if (r.status === 404) return null }
      if (u && (r.status === 401 || r.status === 403) && intento === 0) { dlCache.delete(name); continue } // el enlace temporal venció: se pide uno nuevo
      break
    }
    if (!r.ok && r.status !== 206) throw new Error('OneDrive no entregó la foto')
    const all = new Uint8Array(await r.arrayBuffer())
    const mime = r.headers.get('content-type') || 'image/jpeg'
    if (!ranged) return { data: all, mime, total: all.length }
    if (r.status === 206) {
      const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '')
      return { data: all, mime, total: m ? Number(m[1]) : offset + all.length }
    }
    return { data: all.subarray(offset, offset + length), mime, total: all.length } // el servidor mandó todo: se recorta aquí
  },
  // Sesión de carga de Microsoft: permite subir archivos grandes por tramos
  async beginUpload(name) {
    const r = await graph(`/me/drive/root:/${FOLDER}/${name}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.uploadUrl) throw new Error((j.error && j.error.message) || 'OneDrive no abrió la carga')
    dlCache.delete(name)
    return j.uploadUrl
  },
  async uploadChunk(uploadUrl, bytes, start, total) {
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${start + bytes.length - 1}/${total}` },
      body: bytes,
    })
    if (r.status === 202) return false
    if (r.status === 200 || r.status === 201) return true
    const j = await r.json().catch(() => ({}))
    throw new Error((j.error && j.error.message) || 'OneDrive rechazó un tramo de la foto (' + r.status + ')')
  },
  // { exists, url }: sin estado compartido entre peticiones simultáneas
  async urlInfo(name) {
    const c = dlCache.get(name)
    if (c && Date.now() < c.exp) return { exists: true, url: c.u }
    const r = await graph(`/me/drive/root:/${FOLDER}/${name}`)
    if (r.status === 404) return { exists: false, url: null }
    const j = await r.json()
    if (!r.ok) throw new Error((j.error && j.error.message) || 'No se pudo leer la foto')
    const u = j['@microsoft.graph.downloadUrl'] || j['@content.downloadUrl'] || null
    if (u) dlCache.set(name, { u, exp: Date.now() + 10 * 60000 })
    return { exists: true, url: u }
  },
  async url(name) { return (await this.urlInfo(name)).url },
  async del(name) {
    const r = await graph(`/me/drive/root:/${FOLDER}/${name}`, { method: 'DELETE' })
    if (!r.ok && r.status !== 404) throw new Error('OneDrive no pudo borrar ' + name)
    dlCache.delete(name)
  },
  // Plan B: leer el archivo directo por Graph cuando OneDrive no entrega enlace de descarga
  async content(name, range) {
    const r = await graph(`/me/drive/root:/${FOLDER}/${name}:/content`, range ? { headers: { Range: range } } : {})
    if (r.status === 404) return null
    if (!r.ok && r.status !== 206) throw new Error('OneDrive no entregó la foto (' + r.status + ')')
    return r
  },
}
/* ---------- Proveedor futuro: Google Drive ----------
   Se agrega aquí un objeto con los mismos métodos (setup, who, put, url) y se registra abajo. */
const providers = { onedrive }
const PROVIDER = (env('STORAGE_PROVIDER') || 'onedrive').toLowerCase()


/* ---------- Autenticación y accesos ---------- */
async function caller(req) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const a = db()
  const { data, error } = await a.auth.getUser(t)
  if (error || !data || !data.user) return null
  const { data: p } = await a.from('pa_profiles').select('*').eq('auth_id', data.user.id).maybeSingle()
  return p || null
}
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
function genPass(n = 10) {
  const r = crypto.getRandomValues(new Uint32Array(n))
  return Array.from(r, (x) => ALPHA[x % ALPHA.length]).join('')
}
const canManage = (me, t) => me.role === 'admin' || (me.role === 'supervisor' && t.role === 'sucursal' && t.region === me.region)
const slugLogin = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const cleanLogin = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const authEmail = (login) => (login.includes('@') ? login : `${login}@planes.sistegua.com`)

/* ---------- Autorización de fotos (por plan, bajo las políticas RLS reales de quien llama) ---------- */
const PHOTO_AUTH = () => { const m = (env('PHOTO_AUTH') || 'log').toLowerCase(); return m === 'enforce' || m === 'off' ? m : 'log' }
// Nombres de archivo que genera la app: <plan>#ev<n>#<marca> (evidencia), ref#<marca> (foto de referencia del plan), ARQ_<folio>_v<n>_dep_<marca> (comprobante de Arqueos), prueba_conexion.jpg
function classifyPhoto(name) {
  if (name === 'prueba_conexion.jpg') return { t: 'prueba' }
  const base = name.replace(/_orig\.[a-z0-9]+$/i, '').replace(/\.(jpe?g|png|webp|heic|heif)$/i, '')
  let m = /^(.+)_ev(\d+)_(\d{10,})$/.exec(base)
  if (m) return { t: 'ev', planId: m[1], k: `${m[1]}#ev${m[2]}#${m[3]}` }
  m = /^ref_(\d{10,})$/.exec(base)
  if (m) return { t: 'ref', k: `ref#${m[1]}` }
  if (/^ARQ_/.test(name)) return { t: 'arq' }
  return { t: 'otro' }
}
async function photoAllowed(req, me, name, write) {
  const c = classifyPhoto(name)
  if (c.t === 'prueba') return { ok: me.role === 'admin', why: 'prueba: solo administrador' }
  if (c.t === 'arq') return { ok: write ? ['admin', 'supervisor'].includes(me.role) : ['admin', 'supervisor', 'sucursal'].includes(me.role), why: 'comprobante de arqueo: rol ' + me.role }
  if (c.t === 'otro') return { ok: me.role === 'admin', why: 'nombre sin plan asociado' }
  const { data, error } = await userDb(req).rpc('nexa_foto_acceso', { p_tipo: c.t, p_planid: c.planId || null, p_k: c.k || null, p_escritura: !!write })
  if (error) throw new Error('nexa_foto_acceso: ' + error.message)
  return { ok: data === true, why: (write ? 'escritura' : 'lectura') + ' de ' + c.t + ' sin permiso sobre el plan' }
}
// Devuelve una respuesta de rechazo (solo en modo enforce) o null si se puede continuar. En modo log solo deja constancia.
async function guardPhoto(req, me, name, write) {
  const mode = PHOTO_AUTH()
  if (mode === 'off') return null
  let r
  try { r = await photoAllowed(req, me, name, write) }
  catch (e) { r = { ok: mode !== 'enforce', why: 'error: ' + String((e && e.message) || e).slice(0, 120) } }
  if (r.ok) return null
  console.error('photo_auth_deny', JSON.stringify({ mode, write: !!write, role: me.role, name: String(name).slice(0, 70), why: r.why }))
  return mode === 'enforce' ? json({ ok: false, error: 'No tienes permiso sobre esta foto', denied: true }, 403) : null
}


// Avisos al teléfono (push). La app llama a esta acción cada vez que crea un aviso. Necesita los secretos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT.
// Contadores de pendientes (aviso fijo): lectura anterior, conservada solo como retroceso si la función SQL aún no existe.
async function pendLegacy(a, ids) {
  const pend: Record<string, number> = {}
  const { data: pl } = await a.from('pa_docs').select('data').eq('col', 'plans').limit(5000)
  const { data: us } = await a.from('pa_docs').select('id,data').eq('col', 'users').in('id', ids)
  const { data: cf } = await a.from('pa_docs').select('data').eq('col', 'meta').eq('id', 'cfg').maybeSingle()
  const plans = (pl || []).map((r) => r.data), cfg = (cf && cf.data) || {}
  for (const u of us || []) {
    const d = u.data || {}, r = d.role
    let n: number | null = null
    const enviadas = (l) => l.reduce((k, p) => k + (p.acts || []).filter((x) => x.st === 'Enviada').length, 0)
    if (r === 'sucursal') n = plans.filter((p) => p.status === 'En proceso' && String(p.region) === String(d.region) && p.branch === d.branch && (p.acts || []).some((x) => ['Pendiente', 'Rechazada'].includes(x.st))).length
    else if (r === 'supervisor') n = enviadas(plans.filter((p) => String(p.region) === String(d.region)))
    else if (r === 'admin') n = enviadas(plans.filter((p) => String(p.region) === '2'))
    else if (r === 'analista' || r === 'gerencia') { const w = (cfg.watch || {})[u.id] || {}; n = enviadas(plans.filter((p) => w.all || (w.regs || []).map(String).includes(String(p.region)))) }
    else if (r === 'inventarios') { const l = plans.filter((p) => p.type === 'Inventarios'); n = cfg.invReview ? enviadas(l) : l.filter((p) => p.status !== 'Completado').length }
    if (n !== null) pend[u.id] = n
  }
  return pend
}
async function pushSend(me, b) {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return { ok: false, error: 'Faltan las claves VAPID en los secretos' }
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:operaciones2@sistegua.com', pub, priv)
  const ids = Array.isArray(b.to) ? b.to.map(String).filter((x) => b.test || x !== me.user_id).slice(0, 80) : []
  if (!ids.length) return { ok: true, sent: 0 }
  const a = db()
  const { data: subs } = await a.from('pa_push').select('endpoint,sub,user_id').in('user_id', ids)
  const base = { title: String(b.title || 'Nexa Corp').slice(0, 60), body: String(b.body || '').slice(0, 180), pid: b.pid ? String(b.pid).slice(0, 40) : null }
  // Conteo de pendientes por usuario (para el aviso fijo). Si la app avisa que ya terminó de guardar (synced) no hace falta esperar; con versiones anteriores se conserva la espera.
  let pend: Record<string, number> = {}
  try {
    if (!b.test) {
      if (b.synced !== true && b.synced !== 1) await new Promise((r) => setTimeout(r, 1800))
      const { data, error } = await a.rpc('nexa_push_pendientes', { p_ids: ids })
      if (!error && data && typeof data === 'object') pend = data as Record<string, number>
      else pend = await pendLegacy(a, ids)
    }
  } catch (x) { console.error('pend error', x && x.message) }
  let sent = 0
  const errs: Array<{ status: unknown; msg: string }> = []
  await Promise.all((subs || []).map(async (s) => {
    try { const pl2 = JSON.stringify(typeof pend[s.user_id] === 'number' ? { ...base, pend: pend[s.user_id] } : base); await webpush.sendNotification(s.sub, pl2, { TTL: 86400, urgency: 'high' }); sent++ }
    catch (x) {
      console.error('push_send error', x && x.statusCode, x && (x.body || x.message))
      errs.push({ status: x && x.statusCode, msg: String((x && (x.body || x.message)) || x).slice(0, 200) })
      if (x && (x.statusCode === 404 || x.statusCode === 410)) await a.from('pa_push').delete().eq('endpoint', s.endpoint)
    }
  }))
  return { ok: true, sent, subs: (subs || []).length, to: ids.length, errs }
}

async function userAccess(me, b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u) return { ok: false, error: 'Ese usuario no existe en la app' }
  const ud = u.data
  if (!canManage(me, ud)) return { ok: false, error: 'Solo puedes crear accesos de las sucursales de tu región' }
  const { data: ex } = await a.from('pa_profiles').select('login').eq('user_id', ud.id).maybeSingle()
  if (ex) return { ok: false, error: 'Ese usuario ya tiene acceso (' + ex.login + ')' }
  let login = String(b.login || '').trim().toLowerCase()
  if (ud.role === 'sucursal') {
    login = cleanLogin(ud.login || slugLogin(ud.branch || ud.name))
    if (!login) return { ok: false, error: 'Esa sucursal no tiene un usuario válido' }
  } else if (!MAIL.test(login)) return { ok: false, error: 'Escribe un correo válido para ' + ud.name }
  const password = genPass()
  const { data: cu, error } = await a.auth.admin.createUser({ email: authEmail(login), password, email_confirm: true })
  if (error) return { ok: false, error: /already|registered|exists/i.test(error.message) ? 'Ese correo o usuario ya está en uso' : error.message }
  const { error: pe } = await a.from('pa_profiles').insert({ auth_id: cu.user.id, user_id: ud.id, role: ud.role, region: ud.region || null, branch: ud.branch || null, login, must_change: true, assigned: ud.role === 'inventarios' && Array.isArray(ud.assigned) ? ud.assigned : null })
  if (pe) { await a.auth.admin.deleteUser(cu.user.id); return { ok: false, error: 'No se pudo crear el perfil: ' + pe.message } }
  return { ok: true, name: ud.name, login, password }
}
async function userReset(me, b) {
  const a = db()
  const { data: p } = await a.from('pa_profiles').select('*').eq('user_id', String(b.user_id || '')).maybeSingle()
  if (!p) return { ok: false, error: 'Ese usuario no tiene acceso todavía' }
  if (!canManage(me, p)) return { ok: false, error: 'Solo puedes restablecer contraseñas de las sucursales de tu región' }
  const password = genPass()
  const { error } = await a.auth.admin.updateUserById(p.auth_id, { password })
  if (error) return { ok: false, error: error.message }
  await a.from('pa_profiles').update({ must_change: true }).eq('auth_id', p.auth_id)
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', p.user_id).maybeSingle()
  return { ok: true, name: (u && u.data && u.data.name) || p.user_id, login: p.login, password }
}
async function userRemove(b) {
  const a = db()
  const { data: p } = await a.from('pa_profiles').select('*').eq('user_id', String(b.user_id || '')).maybeSingle()
  if (!p) return { ok: false, error: 'Ese usuario no tiene acceso' }
  if (p.role === 'admin') {
    const { count } = await a.from('pa_profiles').select('auth_id', { count: 'exact', head: true }).eq('role', 'admin')
    if ((count || 0) <= 1) return { ok: false, error: 'No se puede quitar el único administrador' }
  }
  const { error } = await a.auth.admin.deleteUser(p.auth_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function branchEdit(b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u || u.data.role !== 'sucursal') return { ok: false, error: 'Esa sucursal no existe' }
  const old = u.data
  const nu = { ...old }
  if (b.name !== undefined) {
    const n = String(b.name).trim()
    if (!n) return { ok: false, error: 'Escribe el nombre de la sucursal' }
    nu.name = n
    nu.branch = n
  }
  if (b.region !== undefined) {
    const r = String(b.region)
    const { data: sup } = await a.from('pa_docs').select('id').eq('col', 'users').eq('id', 'sup' + r).maybeSingle()
    if (!sup) return { ok: false, error: 'Esa región no existe' }
    nu.region = r
  }
  if (b.login !== undefined) {
    nu.login = cleanLogin(b.login)
    if (!nu.login) return { ok: false, error: 'Escribe un usuario válido (letras y números, sin espacios)' }
  }
  if (nu.branch !== old.branch || nu.region !== old.region) {
    const { data: dup } = await a.from('pa_docs').select('id').eq('col', 'users').eq('data->>region', nu.region).eq('data->>branch', nu.branch)
    if ((dup || []).some((d) => d.id !== old.id)) return { ok: false, error: 'Ya existe una sucursal con ese nombre en esa región' }
  }
  const { data: pr } = await a.from('pa_profiles').select('*').eq('user_id', old.id).maybeSingle()
  // se compara contra el usuario de la CUENTA de acceso (si existe), porque la app puede haber guardado ya el usuario nuevo en la fila
  const curLogin = pr ? pr.login : old.login || ''
  const newLogin = nu.login && nu.login !== curLogin ? nu.login : null
  if (newLogin) {
    const { data: other } = await a.from('pa_profiles').select('user_id').eq('login', newLogin)
    if ((other || []).some((o) => o.user_id !== old.id)) return { ok: false, error: 'Ese usuario ya está en uso' }
    const { data: users } = await a.from('pa_docs').select('id,data').eq('col', 'users').eq('data->>login', newLogin)
    if ((users || []).some((x) => x.id !== old.id)) return { ok: false, error: 'Ese usuario ya está en uso' }
  }
  let moved = 0
  if (nu.branch !== old.branch || nu.region !== old.region) {
    const { data: pl } = await a.from('pa_docs').select('id,data').eq('col', 'plans').eq('data->>region', old.region).eq('data->>branch', old.branch)
    for (const p of pl || []) {
      // cambio PUNTUAL (solo región y sucursal): si alguien edita el plan a la vez, no se pisa su cambio. Retroceso: reescritura completa como antes.
      const q = await a.rpc('pa_docs_patch', { p_col: 'plans', p_id: p.id, p_ops: [{ path: ['region'], value: nu.region }, { path: ['branch'], value: nu.branch }] })
      if (q.error || !q.data) {
        const { error } = await a.from('pa_docs').update({ data: { ...p.data, region: nu.region, branch: nu.branch } }).eq('col', 'plans').eq('id', p.id)
        if (error) return { ok: false, error: 'No se pudo mover un plan: ' + error.message }
      }
      moved++
    }
  }
  if (pr) {
    const patch = { region: nu.region || null, branch: nu.branch || null }
    if (newLogin) {
      const { error } = await a.auth.admin.updateUserById(pr.auth_id, { email: authEmail(newLogin) })
      if (error) return { ok: false, error: 'No se pudo cambiar el usuario: ' + error.message }
      patch.login = newLogin
    }
    const { error } = await a.from('pa_profiles').update(patch).eq('auth_id', pr.auth_id)
    if (error) return { ok: false, error: 'No se pudo actualizar el permiso: ' + error.message }
  }
  const { error } = await a.from('pa_docs').update({ data: nu }).eq('col', 'users').eq('id', old.id)
  if (error) return { ok: false, error: 'No se pudo guardar la sucursal: ' + error.message }
  return { ok: true, moved }
}

const TRASH_DAYS = 15
// nombres de las fotos (reducida y original) que usa un conjunto de planes
function photoNames(plans) {
  const out = new Set()
  const add = (ph) => {
    if (!ph || !ph.k) return
    const base = String(ph.k).replace(/[^\w.-]/g, '_')
    out.add(base + '.jpg')
    if (ph.o) out.add(base + '_orig.' + (ph.x || 'jpg'))
  }
  for (const p of plans || []) for (const a of (p.data && p.data.acts) || []) { add(a.ref); add(a.ev) }
  return [...out]
}
// claves (k) de las miniaturas de un conjunto de planes (tabla pa_thumbs de E1)
function thumbKeys(plans) {
  const out = new Set<string>()
  for (const p of plans || []) for (const a of (p.data && p.data.acts) || []) for (const w of ['ref', 'ev']) if (a && a[w] && a[w].k) out.add(String(a[w].k))
  return [...out]
}
// Elimina una sucursal: va a la PAPELERA (con todos sus planes) por 15 días
async function branchDelete(me, b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u || u.data.role !== 'sucursal') return { ok: false, error: 'Esa sucursal no existe' }
  const sd = u.data
  const { data: pl, error: pe } = await a.from('pa_docs').select('id,data').eq('col', 'plans').eq('data->>region', sd.region).eq('data->>branch', sd.branch)
  if (pe) return { ok: false, error: 'No se pudieron leer los planes: ' + pe.message }
  const plans = pl || []
  const { data: pr } = await a.from('pa_profiles').select('auth_id,login').eq('user_id', sd.id).maybeSingle()
  const { data: invs } = await a.from('pa_docs').select('id,data').eq('col', 'users').eq('data->>role', 'inventarios')
  const invIds = (invs || []).filter((iv) => Array.isArray(iv.data.assigned) && iv.data.assigned.includes(sd.id)).map((iv) => iv.id)
  // 1) primero se guarda todo en la papelera: si algo falla después, nada se pierde
  const tid = 'T' + Date.now()
  const { error: te } = await a.from('pa_trash').insert({
    id: tid, kind: 'branch', name: sd.branch, region: sd.region, plans_count: plans.length,
    deleted_by: me.login || me.user_id || '', purge_at: new Date(Date.now() + TRASH_DAYS * 864e5).toISOString(),
    payload: { user: sd, plans, login: pr ? pr.login : null, inv_ids: invIds },
  })
  if (te) return { ok: false, error: 'No se pudo enviar a la papelera: ' + te.message + (/pa_trash/.test(te.message) ? ' (falta crear la tabla de la papelera: ejecuta papelera.sql en Supabase)' : '') }
  // 2) se quita su acceso (el perfil se borra en cascada)
  if (pr) {
    const { error } = await a.auth.admin.deleteUser(pr.auth_id)
    if (error) { await a.from('pa_trash').delete().eq('id', tid); return { ok: false, error: 'No se pudo quitar el acceso: ' + error.message } }
  }
  // 3) se saca de las listas de sucursales asignadas a Inventarios
  for (const iv of invs || []) {
    if (invIds.includes(iv.id)) {
      const na = iv.data.assigned.filter((x) => x !== sd.id)
      await a.from('pa_docs').update({ data: { ...iv.data, assigned: na } }).eq('col', 'users').eq('id', iv.id)
      await a.from('pa_profiles').update({ assigned: na }).eq('user_id', iv.id)
    }
  }
  // 4) se quitan sus planes y la sucursal (quedan en la papelera; sus miniaturas de pa_thumbs se conservan para poder restaurarlos)
  if (plans.length) {
    const { error } = await a.from('pa_docs').delete().eq('col', 'plans').in('id', plans.map((p) => p.id))
    if (error) return { ok: false, error: 'No se pudieron quitar los planes (todo quedó guardado en la papelera): ' + error.message }
  }
  const { error } = await a.from('pa_docs').delete().eq('col', 'users').eq('id', sd.id)
  if (error) return { ok: false, error: 'No se pudo quitar la sucursal (todo quedó guardado en la papelera): ' + error.message }
  return { ok: true, plans: plans.length }
}
// Quita un comodín (su acceso y su usuario). Solo comodines.
async function comodinDelete(b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u || u.data.role !== 'comodin') return { ok: false, error: 'Ese comodín no existe' }
  const { data: pr } = await a.from('pa_profiles').select('auth_id').eq('user_id', u.data.id).maybeSingle()
  if (pr) {
    const { error } = await a.auth.admin.deleteUser(pr.auth_id)
    if (error) return { ok: false, error: 'No se pudo quitar el acceso: ' + error.message }
  }
  const { error } = await a.from('pa_docs').delete().eq('col', 'users').eq('id', u.data.id)
  if (error) return { ok: false, error: 'No se pudo quitar al comodín: ' + error.message }
  return { ok: true }
}
// Elimina una región VACÍA (sin sucursales, sin planes y sin nada en la papelera) junto con su supervisor y su comodín
async function regionDelete(me, b) {
  const a = db()
  const r = String(b.region || '')
  if (!r) return { ok: false, error: 'Falta la región' }
  const { data: us } = await a.from('pa_docs').select('id,data').eq('col', 'users').eq('data->>region', r)
  const users = us || []
  const nb = users.filter((u) => u.data.role === 'sucursal').length
  if (nb) return { ok: false, error: 'La región ' + r + ' todavía tiene ' + nb + ' sucursal(es). Elimínalas o pásalas a otra región primero.' }
  const { count: np } = await a.from('pa_docs').select('id', { count: 'exact', head: true }).eq('col', 'plans').eq('data->>region', r)
  if (np) return { ok: false, error: 'La región ' + r + ' todavía tiene ' + np + ' plan(es).' }
  const { count: nt } = await a.from('pa_trash').select('id', { count: 'exact', head: true }).eq('region', r)
  if (nt) return { ok: false, error: 'La papelera tiene ' + nt + ' elemento(s) de la región ' + r + '. Restáuralos o elimínalos para siempre primero.' }
  const own = users.filter((u) => u.data.role === 'supervisor' || u.data.role === 'comodin')
  for (const u of own) {
    const { data: pr } = await a.from('pa_profiles').select('auth_id').eq('user_id', u.id).maybeSingle()
    if (pr) {
      const { error } = await a.auth.admin.deleteUser(pr.auth_id)
      if (error) return { ok: false, error: 'No se pudo quitar el acceso de ' + u.data.name + ': ' + error.message }
    }
  }
  if (own.length) {
    const { error } = await a.from('pa_docs').delete().eq('col', 'users').in('id', own.map((u) => u.id))
    if (error) return { ok: false, error: 'No se pudo quitar al supervisor: ' + error.message }
  }
  const meta = async (id) => { const { data } = await a.from('pa_docs').select('data').eq('col', 'meta').eq('id', id).maybeSingle(); return data && Array.isArray(data.data) ? data.data : [] }
  const regs = (await meta('regions')).filter((x) => String(x.id) !== r)
  const dels = [...new Set([...(await meta('delRegions')).map(String), r])]
  for (const [id, val] of [['regions', regs], ['delRegions', dels]]) {
    const { error } = await a.from('pa_docs').upsert({ col: 'meta', id, data: val }, { onConflict: 'col,id' })
    if (error) return { ok: false, error: 'No se pudo guardar la lista de regiones: ' + error.message }
  }
  return { ok: true, removed: own.map((u) => u.data.name) }
}
async function trashPurgeRow(P, row) {
  const a = db()
  const plans = row.payload && row.payload.plans
  if (P.del) for (const n of photoNames(plans)) { try { await P.del(n) } catch (_) { /* si una foto no se puede borrar, se sigue */ } }
  // al borrar para siempre también se limpian las miniaturas (pa_thumbs, E1) de esos planes; si la tabla no existe o falla, no se interrumpe
  try { const ks = thumbKeys(plans); for (let i = 0; i < ks.length; i += 100) await a.from('pa_thumbs').delete().in('k', ks.slice(i, i + 100)) } catch (_) { /* sin E1 */ }
  await a.from('pa_trash').delete().eq('id', row.id)
}
async function trashPurgeExpired(P) {
  const a = db()
  const { data } = await a.from('pa_trash').select('id,payload').lte('purge_at', new Date().toISOString())
  for (const r of data || []) await trashPurgeRow(P, r)
  return (data || []).length
}
async function trashList(P) {
  const a = db()
  await trashPurgeExpired(P)
  const { data, error } = await a.from('pa_trash').select('id,kind,name,region,plans_count,deleted_at,deleted_by,purge_at').order('deleted_at', { ascending: false })
  if (error) return { ok: false, error: error.message + (/pa_trash/.test(error.message) ? ' (falta crear la tabla de la papelera: ejecuta papelera.sql en Supabase)' : '') }
  return { ok: true, items: data || [] }
}
async function trashPurge(P, b) {
  const a = db()
  const { data: row } = await a.from('pa_trash').select('id,payload').eq('id', String(b.id || '')).maybeSingle()
  if (!row) return { ok: false, error: 'Ese elemento ya no está en la papelera' }
  await trashPurgeRow(P, row)
  return { ok: true }
}
async function trashRestore(b) {
  const a = db()
  const { data: t } = await a.from('pa_trash').select('*').eq('id', String(b.id || '')).maybeSingle()
  if (!t) return { ok: false, error: 'Ese elemento ya no está en la papelera' }
  const pl = t.payload, sd = pl.user
  const { data: ex } = await a.from('pa_docs').select('id').eq('col', 'users').eq('id', sd.id).maybeSingle()
  if (ex) return { ok: false, error: 'Ya existe una sucursal con ese identificador' }
  const { data: dup } = await a.from('pa_docs').select('id').eq('col', 'users').eq('data->>role', 'sucursal').eq('data->>region', sd.region).eq('data->>branch', sd.branch)
  if ((dup || []).length) return { ok: false, error: 'Ya existe otra sucursal llamada ' + sd.branch + ' en esa región. Cámbiale el nombre a una de las dos.' }
  const { data: sup } = await a.from('pa_docs').select('id').eq('col', 'users').eq('id', 'sup' + sd.region).maybeSingle()
  if (!sup) return { ok: false, error: 'La región ' + sd.region + ' ya no existe' }
  const { error: ue } = await a.from('pa_docs').insert({ col: 'users', id: sd.id, data: sd })
  if (ue) return { ok: false, error: 'No se pudo restaurar la sucursal: ' + ue.message }
  // planes: si el número ya lo usa otro plan nuevo, se renumera (las fotos no se afectan)
  const { data: allp } = await a.from('pa_docs').select('id').eq('col', 'plans')
  const used = new Set((allp || []).map((x) => x.id)), maxBy = {}
  for (const id of used) { const m = /^PA-(\d+)-(\d+)/.exec(id); if (m) maxBy[m[1]] = Math.max(maxBy[m[1]] || 0, +m[2]) }
  const renum = []
  const rows = (pl.plans || []).map((p) => {
    let id = p.id, data = p.data
    if (used.has(id)) {
      const m = /^PA-(\d+)-/.exec(id), y = m ? m[1] : String(new Date().getFullYear())
      maxBy[y] = (maxBy[y] || 0) + 1
      const nid = `PA-${y}-${String(maxBy[y]).padStart(3, '0')}`
      renum.push({ from: id, to: nid }); id = nid; data = { ...data, id: nid }
    }
    used.add(id)
    return { col: 'plans', id, data }
  })
  if (rows.length) {
    const { error } = await a.from('pa_docs').insert(rows)
    if (error) { await a.from('pa_docs').delete().eq('col', 'users').eq('id', sd.id); return { ok: false, error: 'No se pudieron restaurar los planes: ' + error.message } }
  }
  for (const iid of pl.inv_ids || []) {
    const { data: iv } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', iid).maybeSingle()
    if (iv && iv.data.role === 'inventarios' && Array.isArray(iv.data.assigned) && !iv.data.assigned.includes(sd.id)) {
      const na = [...iv.data.assigned, sd.id]
      await a.from('pa_docs').update({ data: { ...iv.data, assigned: na } }).eq('col', 'users').eq('id', iid)
      await a.from('pa_profiles').update({ assigned: na }).eq('user_id', iid)
    }
  }
  await a.from('pa_trash').delete().eq('id', t.id)
  return { ok: true, plans: rows.length, renumbered: renum, hadAccess: !!pl.login }
}

async function userReplace(b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u) return { ok: false, error: 'Ese usuario no existe en la app' }
  const ud = u.data
  if (!['supervisor', 'comodin', 'inventarios', 'visualizador'].includes(ud.role)) return { ok: false, error: 'Solo se puede cambiar de persona a supervisores, comodines, inventarios y visualizadores' }
  const name = String(b.name || '').trim()
  if (!name) return { ok: false, error: 'Escribe el nombre de la persona nueva' }
  const login = String(b.login || '').trim().toLowerCase()
  if (!MAIL.test(login)) return { ok: false, error: 'Escribe un correo válido para ' + name }
  const { data: dup } = await a.from('pa_profiles').select('user_id').eq('login', login)
  if ((dup || []).some((d) => d.user_id !== ud.id)) return { ok: false, error: 'Ese correo ya está en uso por otro usuario' }
  const { data: old } = await a.from('pa_profiles').select('*').eq('user_id', ud.id).maybeSingle()
  if (old && old.login === login) return { ok: false, error: 'Ese es el mismo correo del acceso actual. Si es la misma persona, usa "Nueva contraseña"' }
  const password = genPass()
  // 1) primero la cuenta nueva: si algo falla aquí, no se quita nada
  const { data: cu, error } = await a.auth.admin.createUser({ email: authEmail(login), password, email_confirm: true })
  if (error) return { ok: false, error: /already|registered|exists/i.test(error.message) ? 'Ese correo ya está en uso' : error.message }
  // 2) se quita el acceso anterior (su perfil se borra en cascada): esa persona deja de ver datos de inmediato
  if (old) {
    const { error: de } = await a.auth.admin.deleteUser(old.auth_id)
    if (de) { await a.auth.admin.deleteUser(cu.user.id); return { ok: false, error: 'No se pudo quitar el acceso anterior: ' + de.message } }
  }
  // 3) permiso de la persona nueva, en el mismo puesto
  const { error: pe } = await a.from('pa_profiles').insert({ auth_id: cu.user.id, user_id: ud.id, role: ud.role, region: ud.region || null, branch: null, login, must_change: true, assigned: ud.role === 'inventarios' && Array.isArray(ud.assigned) ? ud.assigned : null })
  if (pe) { await a.auth.admin.deleteUser(cu.user.id); return { ok: false, error: 'No se pudo crear el permiso: ' + pe.message + (old ? '. El acceso anterior ya se había quitado: crea el acceso de nuevo.' : '') } }
  // 4) nombres en la app: el puesto, y el comodín de esa región si es supervisor
  const nu = { ...ud, name }
  if (ud.role === 'supervisor') nu.preAuth = false
  await a.from('pa_docs').update({ data: nu }).eq('col', 'users').eq('id', ud.id)
  if (ud.role === 'supervisor' && ud.region) {
    const { data: cs } = await a.from('pa_docs').select('id,data').eq('col', 'users').eq('data->>role', 'comodin').eq('data->>region', ud.region)
    for (const c of cs || []) {
      if (!/^Comodín/.test(c.data.name || '')) continue // si le pusieron otro nombre (p. ej. asistente), no se toca
      const m = String(c.id).match(/-(\d+)$/)
      await a.from('pa_docs').update({ data: { ...c.data, name: 'Comodín ' + (m ? m[1] : '1') + ' de ' + name } }).eq('col', 'users').eq('id', c.id)
    }
  }
  return { ok: true, name, login, password, replaced: !!old }
}

async function assignSet(b) {
  const a = db()
  const { data: u } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(b.user_id || '')).maybeSingle()
  if (!u || u.data.role !== 'inventarios') return { ok: false, error: 'Solo se asignan sucursales a usuarios de Inventarios' }
  let list = null // null = todas las sucursales (sin restricción)
  if (b.assigned !== null && b.assigned !== undefined) {
    if (!Array.isArray(b.assigned)) return { ok: false, error: 'La lista de sucursales no es válida' }
    list = [...new Set(b.assigned.map((x) => String(x)))]
    if (list.length) {
      const { data: sucs } = await a.from('pa_docs').select('id').eq('col', 'users').eq('data->>role', 'sucursal')
      const valid = new Set((sucs || []).map((x) => x.id))
      const bad = list.filter((id) => !valid.has(id))
      if (bad.length) return { ok: false, error: 'Estas sucursales no existen: ' + bad.slice(0, 3).join(', ') }
    }
  }
  const nu = { ...u.data }
  if (list === null) delete nu.assigned
  else nu.assigned = list
  const { error } = await a.from('pa_docs').update({ data: nu }).eq('col', 'users').eq('id', u.data.id)
  if (error) return { ok: false, error: 'No se pudo guardar: ' + error.message }
  const { error: pe } = await a.from('pa_profiles').update({ assigned: list }).eq('user_id', u.data.id)
  if (pe) return { ok: false, error: 'No se pudo actualizar el permiso: ' + pe.message }
  return { ok: true, count: list === null ? null : list.length }
}
async function changePassword(c, b) {
  const pw = String(b.password || '')
  if (pw.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }
  if (/^(12345678|password|contrase)/i.test(pw)) return { ok: false, error: 'Elige una contraseña menos obvia' }
  const a = db()
  const { error } = await a.auth.admin.updateUserById(c.auth_id, { password: pw })
  if (error) return { ok: false, error: error.message }
  await a.from('pa_profiles').update({ must_change: false }).eq('auth_id', c.auth_id)
  return { ok: true }
}

const CHUNK = 327680 * 3 // Microsoft exige tramos múltiplos de 320 KiB
const MAXFILE = 60_000_000
const MAXPART = 4_000_000
const EXT = /\.(jpe?g|png|webp|heic|heif)$/i
const UPHOST = /^https:\/\/[a-z0-9.-]+\.(sharepoint\.com|microsoftpersonalcontent\.com|1drv\.com|live\.com)\//i
const toB64 = (u8) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}

/* ---------- Servidor ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const b = await req.json()
    const P = providers[PROVIDER]
    if (!P) return json({ ok: false, error: 'Proveedor no disponible: ' + PROVIDER }, 400)
    const nameOk = typeof b.name === 'string' && /^[\w.-]{3,120}$/.test(b.name)

    if (b.action !== 'setup') {
      var me = await caller(req)
      if (!me) return json({ ok: false, error: 'Inicia sesión para continuar' }, 401)
    }
    if (b.action === 'status') {
      try { return json({ ok: true, provider: PROVIDER, account: await P.who() }) }
      catch (e) { return json({ ok: false, provider: PROVIDER, error: String(e.message || e) }) }
    }
    if (b.action === 'change_password') return json(await changePassword(me, b))
    if (b.action === 'push_send') {
      // quien avisa sobre un plan debe poder ver ese plan (mismas políticas RLS); evita avisos falsos sobre planes ajenos. Modo PHOTO_AUTH: off | log | enforce.
      if (b.pid && PHOTO_AUTH() !== 'off') {
        let ok = true
        try { const { data, error } = await userDb(req).rpc('nexa_foto_acceso', { p_tipo: 'ev', p_planid: String(b.pid).slice(0, 40), p_k: null, p_escritura: false }); ok = error ? PHOTO_AUTH() !== 'enforce' : data === true } catch (_) { ok = PHOTO_AUTH() !== 'enforce' }
        if (!ok) { console.error('push_auth_deny', JSON.stringify({ mode: PHOTO_AUTH(), role: me.role, pid: String(b.pid).slice(0, 40) })); if (PHOTO_AUTH() === 'enforce') return json({ ok: false, error: 'No tienes permiso sobre ese plan', denied: true }, 403) }
      }
      return json(await pushSend(me, b))
    }
    if (b.action === 'assign_set') {
      if (me.role !== 'admin') return json({ ok: false, error: 'Solo el administrador puede asignar sucursales' }, 403)
      return json(await assignSet(b))
    }
    if (b.action === 'user_replace') {
      if (me.role !== 'admin') return json({ ok: false, error: 'Solo el administrador puede cambiar de persona un puesto' }, 403)
      return json(await userReplace(b))
    }
    if (['branch_delete', 'region_delete', 'comodin_delete', 'trash_list', 'trash_restore', 'trash_purge', 'trash_purge_expired'].includes(b.action)) {
      if (me.role !== 'admin') return json({ ok: false, error: 'Solo el administrador puede usar la papelera' }, 403)
      if (b.action === 'branch_delete') return json(await branchDelete(me, b))
      if (b.action === 'comodin_delete') return json(await comodinDelete(b))
      if (b.action === 'region_delete') return json(await regionDelete(me, b))
      if (b.action === 'trash_list') return json(await trashList(P))
      if (b.action === 'trash_restore') return json(await trashRestore(b))
      if (b.action === 'trash_purge') return json(await trashPurge(P, b))
      return json({ ok: true, purged: await trashPurgeExpired(P) })
    }
    if (b.action === 'branch_edit') {
      if (me.role !== 'admin') return json({ ok: false, error: 'Solo el administrador puede editar sucursales' }, 403)
      return json(await branchEdit(b))
    }
    if (['user_access', 'user_reset', 'user_remove'].includes(b.action)) {
      if (b.action === 'user_remove' && me.role !== 'admin') return json({ ok: false, error: 'Solo el administrador puede quitar accesos' }, 403)
      if (me.role !== 'admin' && me.role !== 'supervisor') return json({ ok: false, error: 'No tienes permiso para esto' }, 403)
      if (b.action === 'user_access') return json(await userAccess(me, b))
      if (b.action === 'user_reset') return json(await userReset(me, b))
      return json(await userRemove(b))
    }
    if (b.action === 'setup') {
      if (!env('SETUP_KEY') || b.setupKey !== env('SETUP_KEY')) return json({ ok: false, error: 'Clave de configuración incorrecta' }, 403)
      await P.setup(b)
      return json({ ok: true, provider: PROVIDER, account: await P.who() })
    }
    if (b.action === 'put') {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '')
      if (!nameOk || !m) return json({ ok: false, error: 'Foto o nombre no válidos' }, 400)
      const denied = await guardPhoto(req, me, b.name, true); if (denied) return denied
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
      if (bytes.length > 3_500_000) return json({ ok: false, error: 'La foto es demasiado grande' }, 400)
      await P.put(b.name, bytes, m[1])
      return json({ ok: true })
    }
    if (b.action === 'put_begin') {
      if (!nameOk || !EXT.test(b.name)) return json({ ok: false, error: 'Nombre de foto no válido' }, 400)
      const size = Number(b.size)
      if (!Number.isInteger(size) || size < 1 || size > MAXFILE) return json({ ok: false, error: 'El tamaño de la foto no es válido (máximo 60 MB)' }, 400)
      if (!P.beginUpload) return json({ ok: false, error: 'Este almacén no permite cargas grandes' }, 400)
      const denied = await guardPhoto(req, me, b.name, true); if (denied) return denied
      return json({ ok: true, uploadUrl: await P.beginUpload(b.name), chunk: CHUNK })
    }
    if (b.action === 'put_chunk') {
      if (typeof b.uploadUrl !== 'string' || !UPHOST.test(b.uploadUrl)) return json({ ok: false, error: 'Dirección de carga no válida' }, 400)
      const start = Number(b.start), total = Number(b.total)
      if (!Number.isInteger(start) || !Number.isInteger(total) || start < 0 || total < 1 || total > MAXFILE || start >= total) return json({ ok: false, error: 'Tramo no válido' }, 400)
      if (typeof b.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b.data)) return json({ ok: false, error: 'Datos no válidos' }, 400)
      const bytes = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0))
      const last = start + bytes.length === total
      if (!bytes.length || start + bytes.length > total || (!last && bytes.length % CHUNK !== 0)) return json({ ok: false, error: 'Tamaño de tramo no válido' }, 400)
      return json({ ok: true, done: await P.uploadChunk(b.uploadUrl, bytes, start, total) })
    }
    if (b.action === 'photo_data') {
      if (!nameOk) return json({ ok: false, error: 'Nombre no válido' }, 400)
      if (!P.bytes) return json({ ok: false, error: 'Este almacén no permite descargar fotos' }, 400)
      const ranged = b.length !== undefined
      let off = 0, len
      if (ranged) {
        off = Number(b.offset || 0); len = Number(b.length)
        if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 1 || len > MAXPART) return json({ ok: false, error: 'Tramo no válido' }, 400)
      }
      const denied = await guardPhoto(req, me, b.name, false); if (denied) return denied
      const f = await P.bytes(b.name, off, len)
      if (!f) return json({ ok: false, error: 'La foto no está en el almacén' })
      if (!ranged && f.data.length > 8_000_000) return json({ ok: false, error: 'La foto es demasiado grande' })
      if (f.total > MAXFILE) return json({ ok: false, error: 'La foto es demasiado grande' })
      return json({ ok: true, mime: f.mime, total: f.total, offset: off, data: toB64(f.data) })
    }
    if (b.action === 'get') {
      if (!nameOk) return json({ ok: false, error: 'Nombre no válido' }, 400)
      const denied = await guardPhoto(req, me, b.name, false); if (denied) return denied
      const info = await P.urlInfo(b.name)
      if (info.url) return json({ ok: true, url: info.url })
      if (info.exists && P.content) {
        const r = await P.content(b.name)
        const all = r ? new Uint8Array(await r.arrayBuffer()) : null
        if (all && all.length <= 3_500_000) return json({ ok: true, url: `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${toB64(all)}` })
        return json({ ok: true, url: null, exists: true })
      }
      return json({ ok: true, url: null, exists: false })
    }
    return json({ ok: false, error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500)
  }
})
