// Función "arqueos" de Nexa: ARQUEO DE CAJA Y FONDO FIJO.
// Es la ÚNICA que escribe en las tablas pa_arqueos, pa_arqueo_firmas, pa_arqueo_deposito, pa_arqueo_audit y pa_ff_asignaciones
// (usa la clave de servicio). Valida en el servidor: quién es el usuario, sus sucursales, los estados, las firmas y los cálculos.
// Secretos: los mismos de super-api (SB_SECRET o SUPABASE_SERVICE_ROLE_KEY). SUPABASE_URL y SUPABASE_ANON_KEY los pone Supabase solo.
// Desplegar con "Verify JWT" ACTIVADO (además la función valida el usuario por su cuenta).
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

/* ===== NÚCLEO DE CÁLCULO (mismas fórmulas del Excel "FORMATO DE ARQUEOS CAJA"; en centavos para no perder decimales) ===== */
const DENOM: Array<[string, number]> = [['200', 20000], ['100', 10000], ['50', 5000], ['20', 2000], ['10', 1000], ['5', 500], ['1', 100], ['0.5', 50], ['0.25', 25], ['0.1', 10], ['0.05', 5]]
const MAX_DOCS = 11, MAX_CAJA = 6, MAX_FACT = 6
const cents = (v: unknown) => Math.round((Number(v) || 0) * 100)
const money = (c: number) => Math.round(c) / 100
function calc(d: any, fondo: number) {
  const den = (d && d.den) || {}
  const efectivo = DENOM.reduce((s, [k, c]) => s + (Math.floor(Number(den[k]) || 0)) * c, 0)
  const docs = ((d && d.docs) || []).reduce((s: number, r: any) => s + cents(r && r.valor), 0)
  const caja = ((d && d.caja) || []).reduce((s: number, r: any) => s + cents(r && r.valor), 0)
  const fact = ((d && d.fact) || []).reduce((s: number, r: any) => s + cents(r && r.valor), 0)
  const ventasFF = fact + cents(fondo)            // VENTAS + FONDO FIJO = total de facturas + monto fondo fijo
  const efDocs = efectivo + docs + caja           // EFECTIVO + DOCTOS. DE PAGO = efectivo + total docs + caja chica
  const res = efDocs - ventasFF                   // RESULTADO
  return {
    efectivo: money(efectivo), docs: money(docs), caja: money(caja), fact: money(fact),
    ventasFF: money(ventasFF), efDocs: money(efDocs), resultado: money(res),
    tipo: res === 0 ? 'cuadrado' : res < 0 ? 'faltante' : 'sobrante',
  }
}
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
const txt = (x: unknown, max = 200) => String(x == null ? '' : x).trim().slice(0, max)
const val = (x: unknown) => { const n = Number(x); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN }
// Limpia y valida el contenido del arqueo; devuelve el contenido saneado o lanza un error claro
function limpiar(d: any) {
  if (!d || typeof d !== 'object') throw new Err('Faltan los datos del arqueo')
  const den: Record<string, number> = {}
  for (const [k] of DENOM) {
    const n = Number((d.den || {})[k] || 0)
    if (!Number.isInteger(n) || n < 0 || n > 1e7) throw new Err('La cantidad de la denominación Q' + k + ' no es válida')
    if (n) den[k] = n
  }
  const filas = (a: any, max: number, nom: string, campos: string[]) => {
    const l = Array.isArray(a) ? a : []
    if (l.length > max) throw new Err('Máximo ' + max + ' filas en ' + nom)
    return l.map((r: any) => {
      const v = val(r && r.valor)
      if (isNaN(v)) throw new Err('Hay un valor no válido en ' + nom)
      const o: any = { valor: v }
      for (const c of campos) o[c] = txt(r && r[c], 120)
      if (campos.includes('fecha') && o.fecha && !isDate(o.fecha)) throw new Err('Hay una fecha no válida en ' + nom)
      return o
    }).filter((o: any) => o.valor || campos.some((c) => o[c]))
  }
  const rec = d.recibo || {}
  if (rec.fecha && !isDate(rec.fecha) && !/^[\p{L}\p{N} .,-]{1,40}$/u.test(String(rec.fecha))) throw new Err('La fecha del recibo provisional no es válida')
  return {
    den,
    docs: filas(d.docs, MAX_DOCS, 'documentos de pago', ['tipo', 'no']),
    caja: filas(d.caja, MAX_CAJA, 'caja chica', ['tipo', 'fecha']),
    fact: filas(d.fact, MAX_FACT, 'facturas', ['no', 'fecha']),
    recibo: { fecha: txt(rec.fecha, 40), ultimo: txt(rec.ultimo, 30), blanco: txt(rec.blanco, 30) },
    obs: String(d.obs == null ? '' : d.obs),
  }
}
/* ===== FIN DEL NÚCLEO ===== */

const estable = (o: any): any => Array.isArray(o) ? o.map(estable) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, estable(o[k])])) : o
async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
}
async function caller(req: Request) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const a = db()
  const { data, error } = await a.auth.getUser(t)
  if (error || !data || !data.user) return null
  const { data: p } = await a.from('pa_profiles').select('*').eq('auth_id', data.user.id).maybeSingle()
  return p || null
}
async function userDoc(a: any, id: string) {
  const { data } = await a.from('pa_docs').select('data').eq('col', 'users').eq('id', String(id || '')).maybeSingle()
  return data ? data.data : null
}
async function cfg(a: any) {
  const { data } = await a.from('pa_docs').select('data').eq('col', 'meta').eq('id', 'cfg').maybeSingle()
  return (data && data.data) || {}
}
// ¿Puede esta persona operar en esa sucursal? Administrador: todas. Supervisor: su región y las regiones donde tiene "editar".
async function puede(a: any, me: any, suc: any) {
  if (me.role === 'admin') return true
  if (me.role !== 'supervisor') return false
  if (String(suc.region) === String(me.region)) return true
  const acc = ((await cfg(a)).access || {})[me.user_id] || {}
  return (acc.reg && acc.reg[String(suc.region)] === 'editar') || acc.all === 'editar'
}
async function audit(a: any, row: any, accion: string, me: any, nombre: string, detalle: any = null) {
  await a.from('pa_arqueo_audit').insert({ folio: row?.folio ?? null, version: row?.version ?? null, branch_user_id: row?.branch_user_id ?? null, accion, user_id: me.user_id, user_name: nombre, detalle })
}
async function cargar(a: any, folio: string, version: number) {
  const { data } = await a.from('pa_arqueos').select('*').eq('folio', String(folio || '')).eq('version', Number(version) || 0).maybeSingle()
  if (!data) throw new Err('Ese arqueo no existe', 404)
  return data
}
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
function firmaOk(f: unknown) {
  if (typeof f !== 'string' || !PNG.test(f) || f.length > 400_000) throw new Err('La firma no es válida')
  return f as string
}
// Reglas para pasar a firmas: datos completos y texto obligatorio si hay faltante o sobrante
function listo(row: any) {
  const c = calc(row.data, Number(row.fondo))
  if (!isDate(row.fecha)) throw new Err('Falta la fecha del arqueo')
  if (c.tipo !== 'cuadrado' && !String(row.data.obs || '').trim()) {
    throw new Err(c.tipo === 'faltante' ? 'Escribe cómo se procedió con el faltante' : 'Escribe qué se hizo con el sobrante')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const me = await caller(req)
    if (!me) return json({ ok: false, error: 'Inicia sesión para continuar' }, 401)
    const b = await req.json()
    const a = db()
    const yo = await userDoc(a, me.user_id)
    const miNombre = (yo && yo.name) || me.login || me.user_id

    /* ----- Asignar el encargado de fondo fijo de una sucursal (solo administrador) ----- */
    if (b.action === 'ff_assign') {
      if (me.role !== 'admin' && me.role !== 'supervisor') throw new Err('Solo administradores y supervisores asignan encargados de fondo fijo', 403)
      const suc = await userDoc(a, b.branch_user_id)
      if (!suc || suc.role !== 'sucursal') throw new Err('Esa sucursal no existe')
      if (!(await puede(a, me, suc))) throw new Err('No tienes permiso en esa sucursal', 403)
      if (String(b.encargado_user_id) === me.user_id) throw new Err('No puedes asignarte a ti mismo como encargado del fondo fijo')
      const enc = await userDoc(a, b.encargado_user_id)
      if (!enc) throw new Err('Ese usuario no existe')
      const { data: pr } = await a.from('pa_profiles').select('auth_id').eq('user_id', String(b.encargado_user_id)).maybeSingle()
      if (!pr) throw new Err('Esa persona todavía no tiene cuenta de acceso en Nexa')
      const monto = val(b.monto)
      if (isNaN(monto)) throw new Err('Escribe el monto del fondo fijo')
      const { data: vig } = await a.from('pa_ff_asignaciones').select('*').eq('branch_user_id', suc.id).is('hasta', null).maybeSingle()
      if (vig && vig.encargado_user_id === b.encargado_user_id && Number(vig.monto) === monto) return json({ ok: true, sinCambios: true })
      if (vig) await a.from('pa_ff_asignaciones').update({ hasta: new Date().toISOString() }).eq('id', vig.id)
      const { error } = await a.from('pa_ff_asignaciones').insert({ branch_user_id: suc.id, encargado_user_id: String(b.encargado_user_id), monto, creado_por: me.user_id })
      if (error) throw new Err('No se pudo guardar la asignación: ' + error.message)
      await audit(a, { branch_user_id: suc.id }, 'ff_asignado', me, miNombre, { sucursal: suc.branch, encargado: enc.name, monto, anterior: vig ? vig.encargado_user_id : null, montoAnterior: vig ? Number(vig.monto) : null })
      return json({ ok: true })
    }

    /* ----- Crear o guardar un borrador ----- */
    if (b.action === 'save') {
      if (me.role !== 'admin' && me.role !== 'supervisor') throw new Err('No tienes permiso para hacer arqueos', 403)
      if (!isDate(b.fecha)) throw new Err('Escribe una fecha válida')
      const data = limpiar(b.data)
      let row: any
      if (b.folio) {
        row = await cargar(a, b.folio, b.version)
        if (row.estado !== 'borrador') throw new Err('Este arqueo ya no se puede editar')
        if (row.supervisor_user_id !== me.user_id && me.role !== 'admin') throw new Err('Solo quien lo creó puede editarlo', 403)
        const suc = await userDoc(a, row.branch_user_id)
        if (!suc || !(await puede(a, me, suc))) throw new Err('No tienes permiso en esa sucursal', 403)
        const c = calc(data, Number(row.fondo))
        const { error } = await a.from('pa_arqueos').update({ fecha: b.fecha, data, totales: c, resultado: c.resultado, tipo_resultado: c.tipo }).eq('folio', row.folio).eq('version', row.version)
        if (error) throw new Err('No se pudo guardar: ' + error.message)
        await audit(a, row, 'editado', me, miNombre, { resultado: c.resultado, tipo: c.tipo })
        return json({ ok: true, folio: row.folio, version: row.version, totales: c })
      }
      const suc = await userDoc(a, b.branch_user_id)
      if (!suc || suc.role !== 'sucursal') throw new Err('Elige una sucursal')
      if (!(await puede(a, me, suc))) throw new Err('No tienes permiso en esa sucursal', 403)
      const { data: asig } = await a.from('pa_ff_asignaciones').select('*').eq('branch_user_id', suc.id).is('hasta', null).maybeSingle()
      if (!asig) throw new Err('Esa sucursal no tiene encargado de fondo fijo asignado. Pide al administrador que lo configure.')
      const fondo = Number(asig.monto) // el monto lo define el administrador por sucursal; no viene de la pantalla
      const enc = await userDoc(a, asig.encargado_user_id)
      if (asig.encargado_user_id === me.user_id) throw new Err('Quien hace el arqueo no puede ser el encargado del fondo fijo de esa sucursal')
      const { data: folio } = await a.rpc('pa_arqueo_next_folio')
      const c = calc(data, fondo)
      const nuevo = {
        folio, version: 1, estado: 'borrador', branch_user_id: suc.id, region: String(suc.region ?? ''), branch: suc.branch || suc.name, fecha: b.fecha, fondo,
        supervisor_user_id: me.user_id, supervisor_name: miNombre, ff_user_id: asig.encargado_user_id, ff_name: (enc && enc.name) || asig.encargado_user_id,
        data, totales: c, resultado: c.resultado, tipo_resultado: c.tipo,
      }
      const { error } = await a.from('pa_arqueos').insert(nuevo)
      if (error) throw new Err('No se pudo crear el arqueo: ' + error.message)
      await audit(a, nuevo, 'creado', me, miNombre, { sucursal: nuevo.branch, fecha: b.fecha })
      return json({ ok: true, folio, version: 1, totales: c })
    }

    /* ----- Resto de acciones: trabajan sobre un arqueo existente ----- */
    const row = await cargar(a, b.folio, b.version)
    const suc = await userDoc(a, row.branch_user_id)

    if (b.action === 'lock') { // "Continuar a las firmas": se confirma el contenido y se calcula su huella
      if (row.estado !== 'borrador') throw new Err('Este arqueo ya pasó a firmas')
      if (row.supervisor_user_id !== me.user_id && me.role !== 'admin') throw new Err('Solo quien lo creó puede continuar', 403)
      listo(row)
      const c = calc(row.data, Number(row.fondo))
      const hash = await sha256(JSON.stringify(estable({ folio: row.folio, version: row.version, branch: row.branch_user_id, fecha: row.fecha, fondo: row.fondo, ff: row.ff_user_id, sup: row.supervisor_user_id, data: row.data, c })))
      const { error } = await a.from('pa_arqueos').update({ estado: 'pend_supervisor', hash, totales: c, resultado: c.resultado, tipo_resultado: c.tipo, bloqueado_at: new Date().toISOString() }).eq('folio', row.folio).eq('version', row.version)
      if (error) throw new Err('No se pudo continuar: ' + error.message)
      await audit(a, row, 'revision_confirmada', me, miNombre, { resultado: c.resultado, tipo: c.tipo })
      return json({ ok: true })
    }
    if (b.action === 'unlock') { // volver a editar mientras no haya firmas
      if (row.estado !== 'pend_supervisor') throw new Err('Ya no se puede volver a editar')
      if (row.supervisor_user_id !== me.user_id && me.role !== 'admin') throw new Err('Solo quien lo creó puede hacerlo', 403)
      await a.from('pa_arqueos').update({ estado: 'borrador', hash: null, bloqueado_at: null }).eq('folio', row.folio).eq('version', row.version)
      await audit(a, row, 'volver_a_editar', me, miNombre)
      return json({ ok: true })
    }
    if (b.action === 'sign_supervisor') {
      if (row.estado !== 'pend_supervisor') throw new Err('Este arqueo no está esperando la firma del supervisor')
      if (row.supervisor_user_id !== me.user_id) throw new Err('Solo quien realiza el arqueo puede firmar como supervisor', 403)
      const firma = firmaOk(b.firma)
      const { error } = await a.from('pa_arqueo_firmas').insert({ folio: row.folio, version: row.version, rol: 'supervisor', user_id: me.user_id, user_name: miNombre, auth_id: me.auth_id, firma, doc_hash: row.hash })
      if (error) throw new Err('No se pudo registrar la firma: ' + error.message)
      await a.from('pa_arqueos').update({ estado: 'pend_encargado' }).eq('folio', row.folio).eq('version', row.version)
      await audit(a, row, 'firma_supervisor', me, miNombre, { hash: row.hash })
      return json({ ok: true })
    }
    if (b.action === 'sign_encargado') {
      // El encargado firma con SU propia cuenta: se verifica su usuario y contraseña sin tocar la sesión de quien hace el arqueo.
      if (row.estado !== 'pend_encargado') throw new Err('Este arqueo no está esperando la firma del encargado de fondo fijo')
      if (row.supervisor_user_id !== me.user_id && me.role !== 'admin') throw new Err('Solo quien realiza el arqueo puede pedir esta firma', 403)
      const firma = firmaOk(b.firma)
      const login = String(b.usuario || '').trim().toLowerCase()
      if (!login || !b.password) throw new Err('Escribe el usuario y la contraseña del encargado')
      const email = login.includes('@') ? login : `${login.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '')}@planes.sistegua.com`
      const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env('SUPABASE_ANON_KEY') },
        body: JSON.stringify({ email, password: String(b.password) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.access_token) throw new Err('Usuario o contraseña del encargado incorrectos')
      const { data: u } = await a.auth.getUser(j.access_token)
      if (!u || !u.user) throw new Err('No se pudo verificar la cuenta del encargado')
      const { data: pr } = await a.from('pa_profiles').select('user_id,auth_id').eq('auth_id', u.user.id).maybeSingle()
      if (!pr || pr.user_id !== row.ff_user_id) throw new Err('Esa cuenta no es la del encargado de fondo fijo asignado a esta sucursal')
      if (pr.user_id === row.supervisor_user_id) throw new Err('El encargado de fondo fijo y quien hace el arqueo no pueden ser la misma persona')
      const ed = await userDoc(a, pr.user_id)
      const nom = (ed && ed.name) || row.ff_name
      const { error } = await a.from('pa_arqueo_firmas').insert({ folio: row.folio, version: row.version, rol: 'encargado', user_id: pr.user_id, user_name: nom, auth_id: pr.auth_id, firma, doc_hash: row.hash })
      if (error) throw new Err('No se pudo registrar la firma: ' + error.message)
      await a.from('pa_arqueos').update({ estado: 'completo' }).eq('folio', row.folio).eq('version', row.version)
      await audit(a, row, 'firma_encargado', me, miNombre, { firmo: nom, hash: row.hash })
      return json({ ok: true })
    }
    if (b.action === 'deposito') { // se agrega DESPUÉS de firmar; no cambia la versión firmada
      if (!suc || !(await puede(a, me, suc))) throw new Err('No tienes permiso en esa sucursal', 403)
      if (row.estado !== 'completo' || row.tipo_resultado !== 'sobrante') throw new Err('Solo los arqueos completos con sobrante llevan datos de depósito')
      const num = String(b.numero || '').trim()
      if (num && !/^[0-9]+$/.test(num)) throw new Err('El número de confirmación debe tener solo números')
      const comp = txt(b.comprobante, 160)
      if (!num && !comp) throw new Err('Escribe el número de confirmación o sube el comprobante')
      const { error } = await a.from('pa_arqueo_deposito').insert({ folio: row.folio, version: row.version, numero_confirmacion: num || null, comprobante: comp || null, agregado_por: me.user_id, agregado_nombre: miNombre })
      if (error) throw new Err('No se pudo guardar: ' + error.message)
      await audit(a, row, 'deposito_agregado', me, miNombre, { numero: num || null, comprobante: comp || null })
      return json({ ok: true })
    }
    if (b.action === 'correccion') { // nueva versión controlada; la anterior se conserva y se vuelven a pedir las dos firmas
      if (!suc || !(await puede(a, me, suc))) throw new Err('No tienes permiso en esa sucursal', 403)
      if (row.estado !== 'completo') throw new Err('Solo se corrige un arqueo completo')
      const { data: ult } = await a.from('pa_arqueos').select('version').eq('folio', row.folio).order('version', { ascending: false }).limit(1).maybeSingle()
      if (ult && ult.version !== row.version) throw new Err('Ya existe una versión más reciente de este arqueo')
      const motivo = txt(b.motivo, 1000)
      if (!motivo) throw new Err('Escribe el motivo de la corrección')
      const nv = { ...row, version: row.version + 1, estado: 'borrador', corrige_de: row.version, motivo_correccion: motivo, hash: null, bloqueado_at: null, supervisor_user_id: me.user_id, supervisor_name: miNombre }
      delete nv.created_at; delete nv.updated_at
      const { error } = await a.from('pa_arqueos').insert(nv)
      if (error) throw new Err('No se pudo crear la corrección: ' + error.message)
      await audit(a, nv, 'correccion_iniciada', me, miNombre, { de: row.version, motivo })
      return json({ ok: true, folio: row.folio, version: nv.version })
    }
    if (b.action === 'pdf') {
      if (row.estado !== 'completo') throw new Err('El PDF definitivo solo existe con las dos firmas')
      await audit(a, row, 'pdf_generado', me, miNombre)
      return json({ ok: true })
    }
    throw new Err('Acción desconocida')
  } catch (e) {
    const err = e as Err
    return json({ ok: false, error: String((err && err.message) || e) }, err instanceof Err ? err.status : 500)
  }
})
