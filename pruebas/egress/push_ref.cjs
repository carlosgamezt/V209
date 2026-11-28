// Referencia: el cálculo de contadores del aviso fijo EXACTAMENTE como lo hacía super-api (pushSend) con los planes completos. Uso: node push_ref.cjs <dir> (lee planes.json, usuarios.json, cfg.json, pg.json)
const fs = require('fs'), dir = process.argv[2], rd = n => JSON.parse(fs.readFileSync(dir + '/' + n + '.json', 'utf8'));
const plans = rd('planes'), us = rd('usuarios'), cfg = rd('cfg') || {}, pg = rd('pg'); const pend = {}; let fallos = 0, casos = 0;
for (const u of us) {
  const d = u.data || {}, r = d.role; let n = null;
  const enviadas = l => l.reduce((k, p) => k + (p.acts || []).filter(x => x && x.st === 'Enviada').length, 0);
  if (r === 'sucursal') n = plans.filter(p => p.status === 'En proceso' && String(p.region) === String(d.region) && p.branch === d.branch && (p.acts || []).some(x => x && ['Pendiente', 'Rechazada'].includes(x.st))).length;
  else if (r === 'supervisor') n = enviadas(plans.filter(p => String(p.region) === String(d.region)));
  else if (r === 'admin') n = enviadas(plans.filter(p => String(p.region) === '2'));
  else if (r === 'analista' || r === 'gerencia') { const w = (cfg.watch || {})[u.id] || {}; n = enviadas(plans.filter(p => w.all || (w.regs || []).map(String).includes(String(p.region)))) }
  else if (r === 'inventarios') { const l = plans.filter(p => p.type === 'Inventarios'); n = cfg.invReview ? enviadas(l) : l.filter(p => p.status !== 'Completado').length }
  if (n !== null) pend[u.id] = n
}
for (const u of us) { casos++; const a = pend[u.id], b = pg[u.id]; if (a !== b) { fallos++; console.log('FALLO', u.id, (u.data || {}).role, 'referencia:', a, 'SQL:', b) } }
console.log(JSON.stringify({ usuarios: us.length, con_contador: Object.keys(pend).length, fallos })); process.exit(fallos ? 1 : 0)
