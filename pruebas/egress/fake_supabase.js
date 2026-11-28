/* Supabase SIMULADO para medir el consumo (Egress) de la app de Nexa SIN red ni credenciales.
   Se inyecta antes de la app (addInitScript). Implementa el subconjunto de supabase-js que usa Nexa: auth, from().select/insert/update/delete/upsert con filtros,
   rpc y Realtime (postgres_changes). Cuenta SOLO lo que Supabase cobraría como salida hacia el cliente: cuerpos de respuesta REST/RPC y eventos Realtime
   (bruto en bytes + estimación comprimida con gzip). La seguridad por filas se simula con las mismas reglas de alcance de la app (admin todo, supervisor región, sucursal propia…).
   NO es la base real: mide el comportamiento del CLIENTE con datos idénticos antes/después. */
(() => {
  const P = Object.assign({ regionsPlans: 6, plansPerBranch: 1, acts: 6, withPhotos: 1, thumbs: 8, notifs: 1200, arqueos: 300, descargas: 1500, mensual: 600, user: 'admin', caps: {} }, window.__EG || {});
  window.__EG = P;
  let seedN = 12345; const rnd = () => (seedN = (seedN * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = a => a[Math.floor(rnd() * a.length)];
  const net = window.__net = { log: [], phase: 'init' };
  const enc = new TextEncoder();
  const gz = async s => { try { const r = await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); return r.byteLength } catch (e) { return Math.round(s.length * .3) } };
  const rec = (kind, table, op, payload) => { const s = JSON.stringify(payload === undefined ? null : payload), raw = enc.encode(s).length + 600 /* cabeceras */; const e = { kind, table, op, raw, gz: raw, ph: net.phase, view: (typeof view !== 'undefined' ? view : ''), t: Date.now() }; net.log.push(e); if (raw > 3000) gz(s).then(g => { e.gz = g + 600 }); };
  const X0 = window.__EG_X || {};
  /* ---------- datos ---------- */
  const db = { pa_docs: [], pa_profiles: [], pa_drafts: [], pa_descargas: [], pa_arqueos: [], pa_arqueo_deposito: [], pa_ff_asignaciones: [], pa_arqueo_eliminados: [], supervision_mensual: [], supervision_sync_log: [], supervision_visitas: [], pa_push: [], pa_thumbs: [] };
  const photos = []; // variantes de JPEG reales (~30 KB)
  function mkPhotos() { for (let i = 0; i < P.thumbs; i++) { const c = document.createElement('canvas'); c.width = 480; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0'); x.fillRect(0, 0, 480, 360); for (let j = 0; j < 260; j++) { x.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',' + Math.floor(40 + rnd() * 50) + '%,' + Math.floor(25 + rnd() * 55) + '%)'; x.fillRect(rnd() * 480, rnd() * 360, 8 + rnd() * 70, 8 + rnd() * 70) } photos.push(c.toDataURL('image/jpeg', .72)) } }
  const now0 = Date.now(), day = 864e5; let ts = now0 - 90 * day; const tick = () => (ts += 1000 + Math.floor(rnd() * 90000));
  const iso = t => new Date(t).toISOString();
  function seedAll() {
    mkPhotos(); const sd = seed(); const users = sd.users.map(u => ({ ...u }));
    users.forEach(u => db.pa_docs.push({ col: 'users', id: u.id, data: u, updated_at: iso(tick()) }));
    db.pa_docs.push({ col: 'meta', id: 'cfg', data: { schema: 1 }, updated_at: iso(tick()) });
    db.pa_docs.push({ col: 'meta', id: 'catalogV2', data: true, updated_at: iso(tick()) });
    users.forEach(u => db.pa_profiles.push({ auth_id: 'auth-' + u.id, user_id: u.id, role: u.role, region: u.region || null, branch: u.branch || null, assigned: u.assigned || null, must_change: false }));
    if (P.branchCount) { const nat = users.filter(u => u.role === 'sucursal'); const keep = new Set(nat.slice(0, P.branchCount).map(u => u.id)); for (let i = users.length - 1; i >= 0; i--) if (users[i].role === 'sucursal' && !keep.has(users[i].id)) { const id = users[i].id; users.splice(i, 1); db.pa_docs.splice(db.pa_docs.findIndex(d => d.col === 'users' && d.id === id), 1); db.pa_profiles.splice(db.pa_profiles.findIndex(p => p.user_id === id), 1) } P.extraBranches = Math.max(0, P.branchCount - nat.length) }
    if (P.extraBranches) { const regs = [...new Set(users.filter(u => u.region).map(u => u.region))]; for (let i = 0; i < P.extraBranches; i++) { const r = regs[i % regs.length], u = { id: 'xb' + i, name: 'Sucursal X' + i, role: 'sucursal', region: r, branch: 'Sucursal X' + i, login: 'xb' + i }; users.push(u); db.pa_docs.push({ col: 'users', id: u.id, data: u, updated_at: iso(tick()) }); db.pa_profiles.push({ auth_id: 'auth-' + u.id, user_id: u.id, role: u.role, region: u.region, branch: u.branch, assigned: null, must_change: false }) } }
    const branches = users.filter(u => u.role === 'sucursal'); let n = 0; const sts = ['En proceso', 'En proceso', 'Completado', 'Pendiente de autorización'], sta = ['Pendiente', 'Enviada', 'Aprobada', 'Aprobada'];
    branches.slice(0, P.maxPlans || 999).forEach(b => { for (let k = 0; k < P.plansPerBranch; k++) { n++; const t0 = tick(), acts = []; for (let a = 0; a < P.acts; a++) { const st = pick(sta); acts.push({ text: 'Actividad ' + (a + 1) + ' de ' + b.branch, deadline: iso(t0 + 30 * day).slice(0, 10), st, enc: 'Encargado', ref: P.withPhotos ? { k: 'ref#' + n + '-' + a, t: photos[(n + a) % photos.length], o: 1, x: 'jpg' } : null, ev: P.withPhotos && st !== 'Pendiente' ? { k: 'ev#' + n + '-' + a, t: photos[(n + a + 3) % photos.length], o: 1, x: 'jpg' } : undefined, ...(st === 'Aprobada' ? { eff: 'Eficiente', rv: { n: 'Rev', t: t0, ok: true }, tl: [['e', t0], ['a', t0]] } : {}) }) }
      db.pa_docs.push({ col: 'plans', id: 'PA-2026-' + String(n).padStart(3, '0'), data: { created: t0, id: 'PA-2026-' + String(n).padStart(3, '0'), resumen: '', auto: 0, region: b.region, branch: b.branch, type: pick(['Auditoría', 'Inventarios', 'Operaciones']), visit: iso(t0).slice(0, 10), deadline: iso(t0 + 30 * day).slice(0, 10), status: pick(sts), by: 'Carlos Gamez', byId: 'admin', acts }, updated_at: iso(t0) }) } });
    const plans = db.pa_docs.filter(d => d.col === 'plans');
    for (let i = 0; i < P.notifs; i++) { const p = pick(plans), br = users.filter(u => u.role === 'sucursal' && u.branch === p.data.branch).map(u => u.id); db.pa_docs.push({ col: 'notifs', id: 'n' + i, data: { id: 'n' + i, text: 'Aviso sobre ' + p.id + ' · actividad actualizada', to: br.concat(['admin']), ts: tick(), read: i % 3 ? br.concat(['admin']) : [], pid: p.id }, updated_at: iso(tick()) }) }
    const mine = branches; for (let i = 0; i < P.arqueos; i++) { const b = pick(mine), t = tick(); db.pa_arqueos.push({ folio: 'AQ-' + String(i).padStart(5, '0'), version: 1, estado: pick(['completo', 'completo', 'pend_supervisor']), branch_user_id: b.id, region: b.region, branch: b.branch, fecha: iso(t).slice(0, 10), fondo: 1000, supervisor_user_id: 'sup' + b.region, supervisor_name: 'Sup', ff_user_id: b.id, ff_name: 'Enc', data: { den: { 200: 3, 100: 4 }, docs: [], caja: [], fact: Array.from({ length: 40 }, (_, j) => ({ no: 'F' + j, fecha: iso(t).slice(0, 10), monto: 120.5 + j })), recibo: '', obs: 'ok'.repeat(30) }, totales: { efectivo: 1000 }, resultado: 0, tipo_resultado: 'cuadrado', modo_firma: 'digital', created_at: iso(t), updated_at: iso(t) }) }
    db.pa_arqueos.slice(0, 80).forEach((a, i) => db.pa_arqueo_deposito.push({ id: i + 1, folio: a.folio, version: 1, numero_confirmacion: '12345' + i, comprobante: null, agregado_at: a.created_at }));
    branches.forEach(b => db.pa_ff_asignaciones.push({ id: db.pa_ff_asignaciones.length + 1, branch_user_id: b.id, encargado_user_id: b.id, encargado_nombre: 'Enc ' + b.branch, monto: 1000, desde: iso(ts - 60 * day), hasta: null }));
    for (let i = 0; i < P.descargas; i++) { const p = pick(plans); db.pa_descargas.push({ id: i + 1, plan_id: p.id, user_name: 'Inventarios', role: 'inventarios', manual: false, created_at: iso(tick()) }) }
    for (let i = 0; i < P.mensual; i++) db.supervision_mensual.push({ id: i + 1, sucursal_codigo: 'S' + (i % 150), mes: iso(now0).slice(0, 7) + '-01', pregunta: 'P' + (i % 4), valor: i, fuente: 'sheet', actualizado_en: iso(tick()) });
    db.supervision_sync_log.push({ mes: iso(now0).slice(0, 7) + '-01', ejecutado_en: iso(now0 - day), ejecutado_por: 'sistema', filas: P.mensual, avisos: 0, ok: true });
    db.__users = users; if (X0.afterSeed) X0.afterSeed(db, P);
  }
  /* ---------- seguridad por filas simulada ---------- */
  const profOf = () => db.pa_profiles.find(p => p.user_id === P.user);
  const scopeOf = r => ({ admin: 'all', supervisor: 'region', comodin: 'region', inventarios: 'assigned', visualizador: 'all', analista: 'all', gerencia: 'all', sucursal: 'branch' }[r] || 'branch');
  function visible(table, row) {
    const pr = profOf(); if (!pr) return false; if (table === 'pa_docs_lite') table = 'pa_docs'; if (table === 'pa_thumbs') { const pl = db.pa_docs.find(d => d.col === 'plans' && d.id === row.plan_id); return !!pl && visible('pa_docs', pl) }
    if (table === 'pa_docs') { if (row.col === 'plans') { const s = scopeOf(pr.role), p = row.data; return s === 'all' || (s === 'region' && p.region === pr.region) || (s === 'branch' && p.branch === pr.branch && p.region === pr.region) || (s === 'assigned' && p.type === 'Inventarios') } if (row.col === 'notifs') return (row.data.to || []).includes(pr.user_id); return true }
    if (table === 'pa_arqueos' || table === 'pa_ff_asignaciones') { const b = row.branch_user_id, u = db.__users.find(x => x.id === b); return pr.role === 'admin' || (pr.role === 'supervisor' && u && u.region === pr.region) || (pr.role === 'sucursal' && b === pr.user_id) }
    if (table === 'pa_arqueo_deposito' || table === 'pa_arqueo_eliminados') { const a = db.pa_arqueos.find(x => x.folio === row.folio); return !!a && visible('pa_arqueos', a) }
    if (table === 'pa_descargas') return ['admin', 'supervisor', 'visualizador', 'analista', 'gerencia', 'inventarios'].includes(pr.role) && db.pa_docs.some(d => d.col === 'plans' && d.id === row.plan_id && visible('pa_docs', d));
    if (table === 'pa_profiles') return pr.role === 'admin' || pr.role === 'supervisor' || row.user_id === pr.user_id;
    if (table === 'pa_drafts') return row.user_id === pr.user_id;
    return true;
  }
  /* ---------- servidor lógico (vistas, RPC y capacidades nuevas se agregan en server_extra.js) ---------- */
  const X = window.__EG_X || {}; window.__EG_X = X;
  const tableRows = t => X.view && X.view[t] ? X.view[t](db) : (t === 'pa_thumbs' && !(P.caps || {}).lite ? undefined : db[t]);
  const X1 = X;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const proj = (row, cols) => { if (!cols || cols === '*') return row; const o = {}; cols.split(',').map(s => s.trim()).forEach(c => { const m = /^(\w+):(\w+)->(\w+)$/.exec(c); if (m) o[m[1]] = (row[m[2]] || {})[m[3]]; else if (c in row) o[c] = row[c] }); return o };
  const listeners = [];
  function emit(table, type, row, old) { listeners.forEach(l => { if (l.table !== table) return; const r = row || old; if (!visible(table, r)) return; const pl = { eventType: type, schema: 'public', table, new: type === 'DELETE' ? {} : (X.realtimeRow ? X.realtimeRow(table, row) : row), old: type === 'INSERT' ? {} : { col: (old || row).col, id: (old || row).id } }; rec('realtime', table, type, pl); try { l.cb(pl) } catch (e) { console.error(e) } }) }
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.cols = '*'; this.opts = {}; this.ord = []; this.lim = null; this.rng = null; this.single = 0; this.retCols = null }
    select(c, o) { if (this.op !== 'select') { this.retCols = c || '*'; return this } this.cols = c || '*'; this.opts = o || {}; return this }
    insert(r) { this.op = 'insert'; this.body = r; return this } update(b) { this.op = 'update'; this.body = b; return this } delete() { this.op = 'delete'; return this } upsert(b, o) { this.op = 'upsert'; this.body = b; this.conf = o; return this }
    eq(c, v) { this.f.push(r => r[c] === v); return this } neq(c, v) { this.f.push(r => r[c] !== v); return this } in(c, a) { this.f.push(r => a.includes(r[c])); return this }
    gt(c, v) { this.f.push(r => r[c] > v); return this } gte(c, v) { this.f.push(r => r[c] >= v); return this } lt(c, v) { this.f.push(r => r[c] < v); return this } lte(c, v) { this.f.push(r => r[c] <= v); return this }
    is(c, v) { this.f.push(r => (r[c] ?? null) === v); return this } order(c, o) { this.ord.push([c, !(o && o.ascending === false)]); return this } limit(n) { this.lim = n; return this } range(a, b) { this.rng = [a, b]; return this }
    maybeSingle() { this.single = 1; return this } single_() { return this }
    then(res, rej) { return this.run().then(res, rej) }
    async run() {
      await Promise.resolve();
      const T = this.t, trace = { table: T }; const rows = tableRows(T); if (!rows) return { data: null, error: { message: 'relation "' + T + '" does not exist' } };
      const nowIso = new Date().toISOString();
      if (this.op === 'select') {
        let r = rows.filter(x => visible(T, x) && this.f.every(f => f(x)));
        this.ord.forEach(() => {}); for (let i = this.ord.length - 1; i >= 0; i--) { const [c, asc] = this.ord[i]; r = r.slice().sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c])) }
        const total = r.length; if (this.rng) r = r.slice(this.rng[0], this.rng[1] + 1); else if (this.lim != null) r = r.slice(0, this.lim);
        if (this.opts.head) { rec('rest', T, 'head', { count: total }); return { data: null, count: total, error: null } }
        const out = r.map(x => proj(x, this.cols)); const res = this.single ? { data: out[0] || null, error: null } : { data: out, error: null }; if (this.opts.count) res.count = total; rec('rest', T, 'select', res.data); return res;
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const arr = Array.isArray(this.body) ? this.body : [this.body], done = [];
        for (const b of arr) { const row = { ...b }; if (T === 'pa_docs') { if (db.pa_docs.some(x => x.col === row.col && x.id === row.id)) { if (this.op === 'upsert') { const ex = db.pa_docs.find(x => x.col === row.col && x.id === row.id); Object.assign(ex, row, { updated_at: row.updated_at || nowIso }); emit(T, 'UPDATE', ex); done.push(ex); continue } return { data: null, error: { message: 'duplicate key value violates unique constraint "pa_docs_pkey"' } } } row.updated_at = row.updated_at || nowIso } else if (T === 'pa_drafts') { const ex = db.pa_drafts.find(x => x.user_id === row.user_id); if (ex) { Object.assign(ex, row); done.push(ex); continue } } else if (T === 'pa_descargas') { row.id = db.pa_descargas.length + 1; row.created_at = nowIso; const pr = profOf(); row.user_name = pr.user_id; row.role = pr.role }
          if (X.beforeWrite) X.beforeWrite(T, 'INSERT', row, null, db); db[T].push(row); emit(T, 'INSERT', row); done.push(row) }
        const res = { data: this.retCols ? done.map(x => proj(x, this.retCols)) : null, error: null }; rec('rest', T, 'insert', res.data); return res;
      }
      if (this.op === 'update') {
        const r = rows.filter(x => visible(T, x) && this.f.every(f => f(x))); r.forEach(x => { const old = JSON.parse(JSON.stringify({ col: x.col, id: x.id })); const prev = X.beforeWrite ? JSON.parse(JSON.stringify(x)) : null; Object.assign(x, this.body); if (X.beforeWrite) X.beforeWrite(T, 'UPDATE', x, prev, db); emit(T, 'UPDATE', x, old) });
        const res = { data: this.retCols ? r.map(x => proj(x, this.retCols)) : null, error: null }; rec('rest', T, 'update', res.data); return res;
      }
      if (this.op === 'delete') { const r = rows.filter(x => visible(T, x) && this.f.every(f => f(x))); r.forEach(x => { db[T].splice(db[T].indexOf(x), 1); emit(T, 'DELETE', x, x) }); const res = { data: this.retCols ? r.map(x => proj(x, this.retCols)) : null, error: null }; rec('rest', T, 'delete', res.data); return res }
    }
  }
  const sess = () => ({ access_token: 'fake.' + P.user, user: { id: 'auth-' + P.user, email: P.user + '@planes.sistegua.com' } });
  const authCbs = [];
  const client = {
    auth: { onAuthStateChange(cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe() { } } } } }, async getSession() { return { data: { session: sess() } } }, async refreshSession() { return { data: { session: sess() }, error: null } }, async signInWithPassword() { return { data: { session: sess() }, error: null } }, async signOut() { authCbs.forEach(c => c('SIGNED_OUT', null)); return { error: null } } },
    from: t => new Q(t),
    async rpc(name, args) { await Promise.resolve(); if (name === 'pa_next_seq') return { data: 1, error: null }; if (X.rpc && X.rpc[name]) { const out = X.rpc[name](db, args || {}, { visible, prof: profOf(), rec }); rec('rest', 'rpc:' + name, 'rpc', out); return { data: out, error: null } } return { data: null, error: { message: 'function ' + name + ' not found' } } },
    channel(name) { const ch = { _l: [], on(kind, f, cb) { this._l.push({ table: f.table, cb }); return this }, subscribe(st) { ch.__st = st; if (net.rtBlocked) { (window.__pendingSubs = window.__pendingSubs || []).push(ch); return this } this._l.forEach(l => listeners.push(l)); setTimeout(() => { net.rtStatus = 'SUBSCRIBED'; st && st('SUBSCRIBED') }, 0); return this } }; return ch },
    removeChannel(ch) { ch._l.forEach(l => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1) }); return Promise.resolve('ok') },
  };
  /* utilidades de la prueba */
  P.api = {
    db, net, emit, listeners,
    realtimeDown() { net.rtStatus = 'CLOSED'; net.rtBlocked = true; const chs = listeners.splice(0); window.__lostListeners = (window.__lostListeners || []).concat(chs); client.__chs.forEach(c => c.__st && c.__st('CLOSED')) },
    realtimeUp() { net.rtBlocked = false; (window.__lostListeners || []).forEach(l => listeners.push(l)); window.__lostListeners = []; const pend = window.__pendingSubs || []; window.__pendingSubs = []; pend.forEach(c => { c._l.forEach(l => { if (!listeners.includes(l)) listeners.push(l) }); c.__st && c.__st('SUBSCRIBED') }); client.__chs.forEach(c => { if (!pend.includes(c) && c.__st) c.__st('SUBSCRIBED') }) },
    /* actividad de OTRAS personas: cambia un plan (y emite el evento a quien esté suscrito) */
    othersTouchPlan(i) { const plans = db.pa_docs.filter(d => d.col === 'plans'); const p = plans[i % plans.length]; const a = p.data.acts[0]; a.text = 'Actividad editada ' + Date.now(); p.updated_at = new Date().toISOString(); if (X.beforeWrite) X.beforeWrite('pa_docs', 'UPDATE', p, JSON.parse(JSON.stringify(p)), db); emit('pa_docs', 'UPDATE', p, p) },
    othersAddNotif(i) { const plans = db.pa_docs.filter(d => d.col === 'plans'); const p = plans[i % plans.length], to = db.__users.filter(u => u.role === 'sucursal' && u.branch === p.data.branch).map(u => u.id).concat(['admin']); const r = { col: 'notifs', id: 'nx' + Date.now() + i, data: { id: 'nx' + Date.now() + i, text: 'Nuevo aviso ' + p.id, to, ts: Date.now(), read: [], pid: p.id }, updated_at: new Date().toISOString() }; db.pa_docs.push(r); emit('pa_docs', 'INSERT', r) },
    othersDeletePlanDoc(id) { const d = db.pa_docs, i = d.findIndex(x => x.col === 'plans' && x.id === id); if (i >= 0) { const r = d[i]; d.splice(i, 1); emit('pa_docs', 'DELETE', r, r) } },
    othersAddArqueo(i) { const b = db.__users.find(u => u.role === 'sucursal'), t = new Date().toISOString(), a = { folio: 'AQN-' + Date.now() + '-' + i, version: 1, estado: 'completo', branch_user_id: b.id, region: b.region, branch: b.branch, fecha: t.slice(0, 10), fondo: 1000, supervisor_user_id: 'sup' + b.region, supervisor_name: 'Sup', ff_user_id: b.id, ff_name: 'Enc', data: { den: {}, docs: [], caja: [], fact: Array.from({ length: 40 }, (_, j) => ({ no: 'F' + j, monto: 1 })), recibo: { fecha: '', ultimo: '', blanco: '' }, obs: '' }, totales: {}, resultado: 0, tipo_resultado: 'cuadrado', modo_firma: 'digital', created_at: t, updated_at: t }; db.pa_arqueos.push(a) },
    setUser(u) { P.user = u },
    mark(ph) { net.phase = ph }, reset() { net.log.length = 0 },
    summary(by) { const o = {}; net.log.forEach(e => { const k = (by === 'view' ? e.view : by === 'table' ? e.kind + ':' + e.table : by === 'kind' ? e.kind : e.ph) || '-'; const s = o[k] || (o[k] = { n: 0, raw: 0, gz: 0 }); s.n++; s.raw += e.raw; s.gz += e.gz }); return o },
  };
  client.__chs = []; const _ch = client.channel; client.channel = n => { const c = _ch(n); client.__chs.push(c); return c };
  window.supabase = { createClient: () => { seedAll(); return client } };
  window.__EG_ready = true;
})();
