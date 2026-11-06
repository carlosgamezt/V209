// Función "supervision-sucursal" de Nexa: captura mensual de datos que dan las sucursales para la Supervisión.
// Cada sucursal (usuario con rol "sucursal") solo ve y escribe lo de SU sucursal. Los datos caen en la hoja de Google
// "Supervisión mensual - datos de sucursales" (pestaña AAAA-MM, columna del código de la sucursal) y en supervision_mensual (fuente 'sucursal').
// Secretos: GOOGLE_SA_JSON (el mismo de rapid-function). La hoja debe estar compartida como EDITOR con la cuenta nexa-lector.
// Desplegar con "Verify JWT" ACTIVADO (además la función valida al usuario por su cuenta).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (n: string) => Deno.env.get(n) || ''
const db = () => createClient(env('SUPABASE_URL'), env('SB_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
class Err extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status } }

const SHEET_ID = '1yhx7amI36V_3Hy4cQg66VwrRyuhBBKIPDgNuMvWodHY'
// pregunta -> tipo: f fecha dd/mm/aaaa, n número, e entero 1-10, t texto
const PREG: Record<number, string> = { 13: 'f', 14: 't', 15: 'n', 16: 'n', 17: 'n', 18: 'n', 28: 'n', 33: 'n', 35: 'n', 36: 'n', 37: 'n', 45: 'e', 46: 'e', 47: 't', 49: 'n', 50: 'n' }
const SUC: Record<string, string> = {
  'SAN JUAN': '136', JOCOTENANGO: '128', CHIMALTENANGO: '13', SOLOLA: '131', QUICHE: '21',
  HUEHUETENANGO: '18', XELA: '3', QUETZALTENANGO: '3', TOTONICAPAN: '146', SACAPULAS: '151',
}
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const codigo = (s: unknown) => { const n = norm(s); for (const k in SUC) if (n.includes(k)) return SUC[k]; return null }

async function caller(req: Request) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const a = db()
  const { data, error } = await a.auth.getUser(t)
  if (error || !data || !data.user) return null
  const { data: p } = await a.from('pa_profiles').select('*').eq('auth_id', data.user.id).maybeSingle()
  return p ? { ...p, email: data.user.email } : null
}
async function userDoc(a: any, id: string) {
  const { data } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(id || '')).maybeSingle()
  return data ? data.data : null
}
// Solo se captura el mes vencido (el mes anterior al actual, hora de Guatemala).
function mesValido(m: unknown): string {
  const s = String(m || '')
  const g = new Date(Date.now() - 6 * 3600 * 1000)
  const ant = new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth() - 1, 1))
  const ok = `${ant.getUTCFullYear()}-${String(ant.getUTCMonth() + 1).padStart(2, '0')}`
  if (s !== ok) throw new Err(`Solo se puede capturar el mes vencido (${ok}).`)
  return s
}
function limpiar(q: number, v: unknown): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  const k = PREG[q]
  if (k === 'f') { const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) throw new Err(`Pregunta ${q}: la fecha va como dd/mm/aaaa`); return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` }
  if (k === 'n') { const n = Number(t.replace(/[Q,\s]/g, '')); if (!isFinite(n) || n < 0) throw new Err(`Pregunta ${q}: escribe solo un número`); return String(n) }
  if (k === 'e') { const n = Number(t); if (!Number.isInteger(n) || n < 1 || n > 10) throw new Err(`Pregunta ${q}: la nota va de 1 a 10`); return String(n) }
  return t.slice(0, 500)
}

/* ---- Google (cuenta de servicio nexa-lector, con permiso de edición) ---- */
const b64u = (b: ArrayBuffer | string) => btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function googleToken(): Promise<string> {
  const sa = JSON.parse(env('GOOGLE_SA_JSON'))
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }))
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${b64u(sig)}` }) })
  const j = await r.json()
  if (!j.access_token) throw new Error('Google no dio token')
  return j.access_token
}
// Crea la pestaña del mes duplicando la más reciente (AAAA-MM) y vaciando sus datos; conserva títulos, códigos y formato.
async function crearPestana(tk: string, mes: string) {
  const H = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
  const m = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(sheetId,title)`, { headers: H })
  if (!m.ok) return
  const hojas: { sheetId: number; title: string }[] = ((await m.json()).sheets ?? []).map((x: any) => x.properties)
  if (hojas.some((h) => h.title === mes)) return
  const fuente = hojas.filter((h) => /^\d{4}-\d{2}$/.test(h.title)).sort((x, y) => y.title.localeCompare(x.title))[0]
  if (!fuente) return
  const d = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { method: 'POST', headers: H,
    body: JSON.stringify({ requests: [{ duplicateSheet: { sourceSheetId: fuente.sheetId, newSheetName: mes } }] }) })
  if (!d.ok) return
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchClear`, { method: 'POST', headers: H,
    body: JSON.stringify({ ranges: [`'${mes}'!C3:K80`] }) })
}
const letra = (i: number) => String.fromCharCode(65 + i) // columnas A..K
async function escribirHoja(mes: string, cod: string, valores: Record<number, string>): Promise<string | null> {
  try {
    const tk = await googleToken()
    const rango = encodeURIComponent(`'${mes}'!A1:K80`)
    const leer = () => fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rango}`, { headers: { Authorization: `Bearer ${tk}` } })
    let r = await leer()
    if (!r.ok) { await crearPestana(tk, mes); r = await leer() } // mes nuevo: se crea la pestaña copiando la más reciente
    if (!r.ok) return `No se encontró la pestaña ${mes} en la hoja de Google (código ${r.status}). Avísale a tu supervisor.`
    const v: string[][] = (await r.json()).values ?? []
    const col = (v[0] ?? []).findIndex((x, i) => i >= 2 && String(x).trim() === cod)
    if (col < 0) return 'La hoja de Google no tiene la columna de esta sucursal.'
    const data: unknown[] = []
    for (const [q, val] of Object.entries(valores)) {
      const fila = v.findIndex((row, i) => i >= 2 && String(row[0] ?? '').trim() === q)
      if (fila < 0) continue
      const num = PREG[+q] === 'n' || PREG[+q] === 'e'
      data.push({ range: `'${mes}'!${letra(col)}${fila + 1}`, values: [[val === '' ? '' : num ? Number(val) : val]] })
    }
    if (!data.length) return null
    const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, { method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data }) })
    if (!w.ok) return `No se pudo escribir en la hoja de Google (código ${w.status}). ¿Está compartida como editor con nexa-lector?`
    return null
  } catch (e) { return 'No se pudo escribir en la hoja de Google: ' + String((e as Error).message || e) }
}

/* ---- Visitas del supervisor -> hoja VENTAS (columna FECHA DE ÚLTIMA VISITA SUPERVISOR) ---- */
const INV_ID = '1tUqhdBVUj64oMAgbbhV_8XPQZcVaHdd4oss7OGKxgUQ'
const serial = (iso: string) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse('1899-12-30T00:00:00Z')) / 86400000)
const dmy = (t: string) => { const m = String(t).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '' }
// Para cada mes de VENTAS desde el mes siguiente a la visita: la fecha = última visita anterior al primer día de ese mes.
// Si el mes no existe en la hoja, se crea copiando las filas (sucursal y series) del último mes: así entran solas las sucursales nuevas.
async function visitaHoja(a: any, fechaIso: string): Promise<string | null> {
  try {
    const tk = await googleToken(); const H = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${INV_ID}`
    const meta = await fetch(`${base}?fields=sheets.properties(sheetId,title)`, { headers: H })
    if (!meta.ok) return `No pude abrir la hoja de VENTAS (código ${meta.status}). ¿Está compartida como editor con nexa-lector?`
    const sid = ((await meta.json()).sheets ?? []).map((x: any) => x.properties).find((x: any) => x.title === 'VENTAS')?.sheetId
    if (sid == null) return 'No encontré la pestaña VENTAS.'
    const rd = await fetch(`${base}/values/${encodeURIComponent("'VENTAS'!A1:V3000")}`, { headers: H })
    const v: string[][] = (await rd.json()).values ?? []
    const mesDe = (r: string[]) => dmy(r[3] ?? '').slice(0, 7)
    const ym = fechaIso.slice(0, 7); const [yy, mm] = ym.split('-').map(Number)
    const T = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`
    let ultimaA = 0; v.forEach((r, i) => { if (i > 0 && String(r[0] ?? '').trim()) ultimaA = i })
    const meses = new Set(v.map((r, i) => (i > 0 && String(r[0] ?? '').trim() ? mesDe(r) : '')).filter(Boolean))
    const reqs: unknown[] = []
    const data: unknown[] = []
    if (!meses.has(T)) { // crear el mes: copiar el bloque del último mes anterior
      const prev = [...meses].filter((m) => m < T).sort().pop()
      if (prev) {
        const bloque = v.map((r, i) => ({ r, i })).filter((x) => x.i > 0 && String(x.r[0] ?? '').trim() && mesDe(x.r) === prev)
        bloque.forEach((x, k) => { const fila = ultimaA + 2 + k; v[fila - 1] = [x.r[0], x.r[1] ?? '', x.r[2] ?? '', `1/${T.slice(5)}/${T.slice(0, 4)}`]
          data.push({ range: `'VENTAS'!A${fila}:D${fila}`, values: [[x.r[0], x.r[1] ?? '', x.r[2] ?? '', serial(T + '-01')]] }) })
        meses.add(T)
      }
    }
    const { data: vis } = await a.from('supervision_visitas').select('sucursal_codigo,fecha')
    for (let i = 1; i < v.length; i++) {
      const r = v[i] ?? []; const m = mesDe(r); const cod = codigo(r[0])
      if (!cod || !m || m < T) continue
      const lim = m + '-01'
      const ult = (vis || []).filter((x: any) => x.sucursal_codigo === cod && x.fecha < lim).map((x: any) => x.fecha).sort().pop()
      const fila = i + 1
      data.push({ range: `'VENTAS'!U${fila}`, values: [[ult ? serial(ult) : '']] })
      if (ult) reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 20, endColumnIndex: 21 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'd/m/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })
      if (!reqs.length && !data.length) break
    }
    if (data.length) {
      const w = await fetch(`${base}/values:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) })
      if (!w.ok) return `No se pudo escribir en VENTAS (código ${w.status}). ¿Está compartida como editor con nexa-lector?`
    }
    if (reqs.length) await fetch(`${base}:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ requests: reqs }) })
    return null
  } catch (e) { return 'No se pudo actualizar VENTAS: ' + String((e as Error).message || e) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const me = await caller(req)
    if (!me) throw new Err('Sesión no válida', 401)
    const a = db()
    const b = await req.json().catch(() => ({}))
    if (me.role === 'admin') {
      // El administrador aprueba o rechaza las solicitudes de cambio.
      if (b.action === 'pendientes') {
        const { data } = await a.from('supervision_envios').select('sucursal_codigo,mes,motivo,solicitado_en').eq('estado', 'solicitado').order('solicitado_en')
        return json({ ok: true, pendientes: (data || []).map((x: any) => ({ ...x, mes: String(x.mes).slice(0, 7) })) })
      }
      if (b.action === 'visita_hoja') {
        const f = String(b.fecha || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Err('Fecha no válida')
        return json({ ok: true, aviso: await visitaHoja(a, f) })
      }
      if (b.action === 'resolver') {
        const cod2 = String(b.sucursal_codigo || ''), mes2 = String(b.mes || '')
        if (!/^\d{4}-\d{2}$/.test(mes2) || !cod2) throw new Err('Solicitud no válida')
        const { data: e } = await a.from('supervision_envios').select('estado').eq('sucursal_codigo', cod2).eq('mes', mes2 + '-01').maybeSingle()
        if (!e || e.estado !== 'solicitado') throw new Err('Esa solicitud ya no está pendiente')
        const aprobar = !!b.aprobar
        const { error } = await a.from('supervision_envios').update({ estado: aprobar ? 'abierto' : 'enviado', nota: aprobar ? null : String(b.nota || 'Solicitud rechazada').slice(0, 300), resuelto_por: me.email, resuelto_en: new Date().toISOString() }).eq('sucursal_codigo', cod2).eq('mes', mes2 + '-01')
        if (error) throw new Err('No se pudo resolver: ' + error.message, 500)
        return json({ ok: true })
      }
      throw new Err('El administrador no captura aquí', 403)
    }
    if (me.role !== 'sucursal') throw new Err('Esta captura es solo para las sucursales', 403)
    const u = await userDoc(a, me.user_id)
    const cod = codigo(u && (u.branch || u.name))
    if (!cod) throw new Err('No pude identificar tu sucursal en la supervisión. Avisa al administrador.', 403)
    const mes = mesValido(b.mes)
    const mesDate = mes + '-01'
    const { data: envio } = await a.from('supervision_envios').select('estado,motivo,nota').eq('sucursal_codigo', cod).eq('mes', mesDate).maybeSingle()
    if (b.action === 'get') {
      const { data, error } = await a.from('supervision_mensual').select('pregunta,valor,fuente').eq('sucursal_codigo', cod).eq('mes', mesDate).in('pregunta', Object.keys(PREG).map(Number))
      if (error) throw new Err('No se pudieron leer los datos: ' + error.message, 500)
      const valores: Record<number, string> = {}; for (const r of data || []) valores[r.pregunta] = r.valor
      return json({ ok: true, valores, estado: envio ? envio.estado : 'nuevo', motivo: envio?.motivo ?? '', nota: envio?.nota ?? '' })
    }
    if (b.action === 'solicitar') {
      if (!envio || envio.estado !== 'enviado') throw new Err('Solo puedes pedir cambios de datos ya enviados')
      const motivo = String(b.motivo || '').trim().slice(0, 300)
      if (motivo.length < 5) throw new Err('Escribe el motivo del cambio')
      const { error } = await a.from('supervision_envios').update({ estado: 'solicitado', motivo, nota: null, solicitado_en: new Date().toISOString() }).eq('sucursal_codigo', cod).eq('mes', mesDate)
      if (error) throw new Err('No se pudo enviar la solicitud: ' + error.message, 500)
      return json({ ok: true })
    }
    if (b.action === 'save') {
      if (envio && envio.estado !== 'abierto') throw new Err('Ya enviaste los datos de este mes. Para cambiarlos, solicita cambios y espera la aprobación.')
      const vals: Record<number, string> = {}
      for (const [k, v] of Object.entries(b.valores || {})) {
        const q = Number(k); if (!(q in PREG)) continue
        vals[q] = limpiar(q, v)
      }
      if (!Object.keys(vals).length) throw new Err('No hay datos para guardar')
      const { data: ex } = await a.from('supervision_mensual').select('pregunta,fuente').eq('sucursal_codigo', cod).eq('mes', mesDate).in('pregunta', Object.keys(vals).map(Number))
      const bloq = new Set((ex || []).filter((x: any) => x.fuente !== 'sucursal').map((x: any) => x.pregunta)) // lo del supervisor no se pisa
      const ahora = new Date().toISOString(); const quien = (u && (u.branch || u.name)) || me.email
      const subir = Object.entries(vals).filter(([q, v]) => v !== '' && !bloq.has(+q)).map(([q, v]) => ({ sucursal_codigo: cod, mes: mesDate, pregunta: +q, valor: v, fuente: 'sucursal', actualizado_en: ahora, actualizado_por: quien }))
      const borrar = Object.entries(vals).filter(([q, v]) => v === '' && !bloq.has(+q)).map(([q]) => +q)
      if (subir.length) { const { error } = await a.from('supervision_mensual').upsert(subir, { onConflict: 'sucursal_codigo,mes,pregunta' }); if (error) throw new Err('No se pudo guardar: ' + error.message, 500) }
      if (borrar.length) await a.from('supervision_mensual').delete().eq('sucursal_codigo', cod).eq('mes', mesDate).eq('fuente', 'sucursal').in('pregunta', borrar)
      await a.from('supervision_envios').upsert({ sucursal_codigo: cod, mes: mesDate, estado: 'enviado', motivo: null, nota: null, enviado_en: ahora }, { onConflict: 'sucursal_codigo,mes' })
      const aviso = await escribirHoja(mes, cod, Object.fromEntries(Object.entries(vals).filter(([q]) => !bloq.has(+q))))
      return json({ ok: true, guardados: subir.length, bloqueados: [...bloq], aviso })
    }
    throw new Err('Acción desconocida')
  } catch (e) {
    const err = e as Err
    return json({ ok: false, error: String((err && err.message) || e) }, err instanceof Err ? err.status : 500)
  }
})
