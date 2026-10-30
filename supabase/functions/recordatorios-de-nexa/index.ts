// Función "recordatorios" de Nexa: avisos automáticos por fecha de vencimiento de los planes de acción.
// La ejecuta Supabase solo (pg_cron) a las 8:30 a. m. ("am") y 1:00 p. m. ("pm") hora de Guatemala.
// Destinatarios: la SUCURSAL recibe los días que le faltan; el SUPERVISOR solo cuando hay evidencias por revisar; Inventarios no recibe recordatorios (su aviso es al completarse el plan, ya existente en la app).
// Reglas: faltan 3, 2, 1 y 0 días -> 2 avisos al día (am y pm).
// Ya vencido -> UN solo aviso final, el día siguiente al plazo (1 día de atraso). Solo actividades que no están aprobadas.
// Dos tareas más (misma función, se eligen con "mode" en el cuerpo de la llamada):
//  - mode "unread": cada hora (7 a. m. a 7 p. m.) avisa a la SUCURSAL que no ha abierto un plan asignado: a las 4, 8 y 12 horas.
//  - mode "badge": cada 15 min repone el aviso fijo "N planes por revisar" (y el numerito del ícono) si el usuario lo borró. Supervisores, administrador (región 2) y sucursales con pendientes.
// Usa los mismos secretos que super-api: SB_SECRET (o SUPABASE_SERVICE_ROLE_KEY), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Secreto nuevo: CRON_SECRET (cualquier texto largo). Desplegar con "Verify JWT" DESACTIVADO (se protege con CRON_SECRET).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const env = (n: string) => Deno.env.get(n) || ''
const db = () => createClient(env('SUPABASE_URL'), env('SB_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })

/* ===== NÚCLEO (lógica pura, probada con fechas simuladas) ===== */
const HECHO_PENDIENTE = ['Pendiente', 'Rechazada'] // la sucursal debe actuar
const HECHO_REVISION = ['Enviada'] // el supervisor debe revisar
const FINAL_DIAS = 1 // el aviso final sale solo al día siguiente del plazo (1 día de atraso)

function diasQueFaltan(deadline: string, hoy: string) {
  return Math.round((Date.parse(deadline + 'T00:00:00Z') - Date.parse(hoy + 'T00:00:00Z')) / 864e5)
}
// ¿toca avisar con d días restantes en este turno ("am"/"pm")?  devuelve 'normal' | 'final' | null
function tocaAvisar(d: number, slot: string) {
  if (d >= 0 && d <= 3) return 'normal' // 3,2,1,0: dos veces al día
  if (d < 0 && d >= -FINAL_DIAS) return 'final' // vencido: un solo aviso final
  return null
}
const plural = (n: number, s: string, p: string) => (n === 1 ? `${n} ${s}` : `${n} ${p}`)
function textoSucursal(id: string, d: number, n: number, kind: string) {
  const act = plural(n, 'actividad', 'actividades')
  if (kind === 'final') return `🔴 Último aviso · ${id}: el plazo venció ayer y quedaron ${act} sin culminar. Serán revisadas.`
  if (d === 0) return `🔴 HOY vence el plan ${id}. Tienes ${act} sin entregar. Entrégalas hoy.`
  if (d === 1) return `🔴 ${id}: te queda 1 día. Tienes ${act} por entregar.`
  if (d === 2) return `🔴 ${id}: te quedan 2 días. Tienes ${act} por entregar.`
  if (d === 3) return `⚠️ ${id}: te quedan 3 días. Tienes ${act} por entregar.`
  return `Recordatorio · ${id}: te quedan ${d} días para entregar ${act}.`
}
function textoSupervisor(id: string, branch: string, d: number, nRev: number, kind: string) {
  const ev = plural(nRev, 'evidencia', 'evidencias')
  if (kind === 'final') return `🔴 Último aviso · ${branch} ${id}: el plazo venció ayer y hay ${ev} sin revisar.`
  const cuando = d === 0 ? 'HOY vence el plazo' : d === 1 ? 'falta 1 día' : `faltan ${d} días`
  const rojo = d <= 2 ? '🔴 ' : d === 3 ? '⚠️ ' : ''
  return `${rojo}${branch} ${id}: ${cuando} y hay ${ev} por revisar.`
}
// plans: [{id,status,region,branch,acts:[{st,deadline,dr}]}]  users: [{id,role,region,branch}]  sent: Set de claves ya enviadas
function construirAvisos(plans: any[], users: any[], hoy: string, slot: string, sent: Set<string>) {
  const out: any[] = []
  for (const p of plans) {
    if (!p || p.status !== 'En proceso') continue
    const acts = (p.acts || []).filter((a: any) => a && a.deadline && !a.dr)
    const pend = acts.filter((a: any) => HECHO_PENDIENTE.includes(a.st))
    const rev = acts.filter((a: any) => HECHO_REVISION.includes(a.st))
    const sucs = users.filter((u) => u.role === 'sucursal' && String(u.region) === String(p.region) && u.branch === p.branch).map((u) => u.id)
    const sups = users.filter((u) => u.role === 'supervisor' && String(u.region) === String(p.region)).map((u) => u.id)
    const minD = (l: any[]) => l.length ? Math.min(...l.map((a) => diasQueFaltan(a.deadline, hoy))) : null
    // Sucursal: solo lo que ella debe entregar
    const dS = minD(pend)
    if (dS !== null && sucs.length) {
      const kind = tocaAvisar(dS, slot)
      if (kind) {
        const dl = pend.map((a: any) => a.deadline).sort()[0]
        const key = kind === 'final' ? `${p.id}|suc|final|${dl}` : `${p.id}|suc|${hoy}|${slot}`
        const nVenc = kind === 'final' ? pend.filter((a: any) => diasQueFaltan(a.deadline, hoy) < 0).length : pend.filter((a: any) => diasQueFaltan(a.deadline, hoy) === dS).length
        if (!sent.has(key)) out.push({ key, to: sucs, plan: p.id, branch: p.branch, urgent: kind === 'final' || dS <= 2, text: textoSucursal(p.id, dS, nVenc, kind), kind, d: dS, aud: 'sucursal' })
      }
    }
    // Supervisor: SOLO cuando hay evidencias enviadas por revisar (el plazo se cuenta con esas actividades)
    const dV = minD(rev)
    if (dV !== null && sups.length) {
      const kind = tocaAvisar(dV, slot)
      if (kind) {
        const dl = rev.map((a: any) => a.deadline).sort()[0]
        const key = kind === 'final' ? `${p.id}|sup|final|${dl}` : `${p.id}|sup|${hoy}|${slot}`
        const nRev = rev.filter((a: any) => kind === 'final' ? diasQueFaltan(a.deadline, hoy) < 0 : diasQueFaltan(a.deadline, hoy) === dV).length
        if (!sent.has(key)) out.push({ key, to: sups, plan: p.id, branch: p.branch, urgent: kind === 'final' || dV <= 2, text: textoSupervisor(p.id, p.branch, dV, nRev, kind), kind, d: dV, aud: 'supervisor' })
      }
    }
  }
  return out
}
// Planes asignados que la sucursal aún no ha abierto. Cada aviso de "Nuevo plan" se marca como leído al abrir el plan o la notificación.
const SIN_LEER_CADA_H = 4, SIN_LEER_MAX = 3
function construirSinLeer(notifs: any[], plans: any[], users: any[], ahora: number, sent: Set<string>) {
  const out: any[] = []
  const porId = new Map(plans.map((p) => [p.id, p]))
  const sucs = new Set(users.filter((u) => u.role === 'sucursal').map((u) => u.id))
  for (const n of notifs) {
    if (!n || !n.pid || !/^Nuevo plan /.test(n.text || '') || n.rec) continue
    const p = porId.get(n.pid)
    if (!p || p.status !== 'En proceso') continue
    if (!(p.acts || []).some((a: any) => a && HECHO_PENDIENTE.includes(a.st) && !a.dr)) continue
    const k = Math.floor((ahora - Number(n.ts || 0)) / (SIN_LEER_CADA_H * 3600e3))
    if (k < 1 || k > SIN_LEER_MAX) continue
    const to = (n.to || []).filter((id: string) => sucs.has(id) && !(n.read || []).includes(id))
    if (!to.length) continue
    const key = `${n.id}|sin-leer|${k}`
    if (sent.has(key)) continue
    out.push({ key, to, plan: p.id, branch: p.branch, urgent: false, aud: 'sucursal', kind: 'sin-leer', d: 0,
      text: `⏰ ${p.id}: tienes un plan asignado que aún no abres (hace ${k * SIN_LEER_CADA_H} horas). Ábrelo y revisa tus actividades.` })
  }
  return out
}
// Cuántos pendientes tiene cada usuario para el aviso fijo (mismo criterio que super-api) y de qué sucursales (las más recientes primero)
function contarPendientes(plans: any[], users: any[]) {
  const out: Array<{ id: string; n: number; lab: string }> = []
  for (const u of users) {
    if (u.role !== 'sucursal' && u.role !== 'supervisor' && u.role !== 'admin') continue
    let n = 0
    const ramas = new Map<string, number>()
    for (const p of plans) {
      if (!p) continue
      if (u.role === 'sucursal') {
        if (p.status === 'En proceso' && String(p.region) === String(u.region) && p.branch === u.branch && (p.acts || []).some((a: any) => HECHO_PENDIENTE.includes(a.st))) n++
      } else if (u.role === 'admin' ? String(p.region) === '2' : String(p.region) === String(u.region)) { // el administrador ve la región 2, igual que en los avisos normales
        let t = 0, c = 0
        for (const a of p.acts || []) if (a && a.st === 'Enviada') { c++; for (const x of a.tl || []) if (x && x[0] === 'e') t = Math.max(t, Number(x[1]) || 0) }
        if (c) { n += c; ramas.set(p.branch, Math.max(ramas.get(p.branch) || 0, t)) }
      }
    }
    if (n <= 0) continue
    const l = [...ramas.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])
    const lab = !l.length ? '' : l.length === 1 ? l[0] : l[0] + ' y ' + (l.length - 1) + (l.length === 2 ? ' sucursal más' : ' sucursales más')
    out.push({ id: u.id, n, lab })
  }
  return out
}
/* ===== FIN DEL NÚCLEO ===== */

const hoyGT = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10) // Guatemala = UTC-6, sin horario de verano

async function enviar(a: any, avisos: any[]) {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY')
  if (pub && priv) webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:operaciones2@sistegua.com', pub, priv)
  let enviados = 0
  for (const x of avisos) {
    // 1) se reserva la clave primero: si la función corre dos veces, el segundo intento no repite el aviso
    const { error: ke } = await a.from('pa_recordatorios').insert({ clave: x.key, plan_id: x.plan, audiencia: x.aud })
    if (ke) continue
    // 2) aviso dentro de la app (campana), en rojo si es urgente
    const nid = 'n' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
    await a.from('pa_docs').insert({ col: 'notifs', id: nid, data: { id: nid, text: x.text, to: x.to, ts: Date.now(), read: [], pid: x.plan, urgent: x.urgent, rec: true } })
    // 3) aviso push al teléfono/computadora (al supervisor se le agrega la sucursal en el título)
    if (pub && priv) {
      const { data: subs } = await a.from('pa_push').select('endpoint,sub').in('user_id', x.to)
      const titulo = (x.urgent ? 'Nexa · 🔴 Urgente' : 'Nexa · Recordatorio') + (x.aud === 'supervisor' && x.branch ? ' · ' + x.branch : '')
      const payload = JSON.stringify({ title: titulo.slice(0, 60), body: x.text.slice(0, 180), pid: x.plan })
      await Promise.all((subs || []).map(async (s: any) => {
        try { await webpush.sendNotification(s.sub, payload, { TTL: 43200, urgency: 'high' }); enviados++ }
        catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await a.from('pa_push').delete().eq('endpoint', s.endpoint) }
      }))
    }
  }
  return enviados
}

Deno.serve(async (req) => {
  try {
    if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ ok: false, error: 'No autorizado' }, 401)
    const b = await req.json().catch(() => ({}))
    const slot = b.slot === 'pm' ? 'pm' : 'am'
    const mode = b.mode === 'unread' ? 'unread' : b.mode === 'badge' ? 'badge' : 'recordatorios'
    const dry = !!b.dry // prueba: muestra qué enviaría, sin enviar ni guardar nada
    const hoy = dry && /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : hoyGT()
    const a = db()
    const { data: pl } = await a.from('pa_docs').select('data').eq('col', 'plans').limit(5000)
    const { data: us } = await a.from('pa_docs').select('id,data').eq('col', 'users').limit(5000)
    const plans = (pl || []).map((r: any) => r.data)
    const users = (us || []).map((r: any) => ({ id: r.id, role: r.data && r.data.role, region: r.data && r.data.region, branch: r.data && r.data.branch }))

    if (mode === 'badge') {
      const lista = contarPendientes(plans, users)
      if (dry) return json({ ok: true, dry: true, mode, total: lista.length, usuarios: lista })
      const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY')
      if (!pub || !priv) return json({ ok: false, error: 'Faltan las claves VAPID' }, 500)
      webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:operaciones2@sistegua.com', pub, priv)
      let n = 0
      for (const u of lista) {
        const { data: subs } = await a.from('pa_push').select('endpoint,sub').eq('user_id', u.id)
        const payload = JSON.stringify({ title: 'Nexa', body: '', refresh: true, pend: u.n, lab: u.lab })
        await Promise.all((subs || []).map(async (s: any) => {
          try { await webpush.sendNotification(s.sub, payload, { TTL: 900, urgency: 'normal' }); n++ }
          catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await a.from('pa_push').delete().eq('endpoint', s.endpoint) }
        }))
      }
      return json({ ok: true, mode, usuarios: lista.length, push: n })
    }

    const { data: ya } = await a.from('pa_recordatorios').select('clave').gte('created_at', new Date(Date.now() - 20 * 864e5).toISOString()).limit(20000)
    const sent = new Set((ya || []).map((r: any) => r.clave))
    let avisos: any[]
    if (mode === 'unread') {
      const desde = Date.now() - (SIN_LEER_MAX + 1) * SIN_LEER_CADA_H * 3600e3
      const { data: nt } = await a.from('pa_docs').select('data').eq('col', 'notifs').gte('data->>ts', String(desde)).limit(5000)
      avisos = construirSinLeer((nt || []).map((r: any) => r.data), plans, users, Date.now(), sent)
    } else avisos = construirAvisos(plans, users, hoy, slot, sent)
    if (dry) return json({ ok: true, dry: true, mode, hoy, slot, total: avisos.length, avisos: avisos.map((x) => ({ plan: x.plan, para: x.aud, d: x.d, urgente: x.urgent, texto: x.text })) })
    const push = await enviar(a, avisos)
    return json({ ok: true, mode, hoy, slot, avisos: avisos.length, push })
  } catch (e: any) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500)
  }
})
