/* Guardado parcial: se envían solo los cambios puntuales, dos personas que editan partes distintas del mismo plan no se pisan, y sin la función E3 todo vuelve a guardarse como antes. */
const fs = require('fs');
const f = fs.readFileSync(__dirname + '/funcional.cjs', 'utf8'); const head = f.slice(0, f.indexOf('(async () => {')).replace('const DATA = { maxPlans: 60', 'const DATA = { maxPlans: 12');
const body = String.raw`
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port, browser = await chromium.launch(); let fallo = 0;
  const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fallo++ };
  const page = await abrir(browser, port, 'admin'), ev = (fn, a) => page.evaluate(fn, a);
  const parche = await ev(() => !!Supa.patch);
  const id = await ev(() => db.plans.find(p => p.acts.length >= 3).id);
  // 1) diferencias: aplicar(diff(a,b), a) = b para casos con objetos, arreglos y borrados
  const d1 = await ev(() => { const ap = (o, ops) => { const c = JSON.parse(JSON.stringify(o)); ops.forEach(op => { let x = c; for (let i = 0; i < op.path.length - 1; i++) x = x[op.path[i]]; const k = op.path[op.path.length - 1]; if (op.del) { if (Array.isArray(x)) x.splice(+k, 1); else delete x[k] } else x[k] = op.value }); return c };
    const casos = [[{ a: 1, b: { c: [1, 2, 3], d: 'x' }, e: [{ t: 'a' }, { t: 'b' }] }, { a: 2, b: { c: [1, 9, 3], d: 'x' }, e: [{ t: 'a' }, { t: 'B', n: 1 }] }], [{ a: 1, z: 5 }, { a: 1 }], [{ l: [1, 2] }, { l: [1, 2, 3] }], [{ x: { y: 1 } }, { x: { y: 1 } }]];
    return casos.every(([a, b]) => JSON.stringify(ap(a, diffOps(a, b, [], []))) === JSON.stringify(b)) });
  ok(d1, 'las diferencias reconstruyen exactamente el JSON nuevo (objetos, arreglos, campos nuevos y borrados)');
  // 2) un cambio pequeño viaja como parche
  await ev(() => { __EG.api.reset(); const p = db.plans.find(p => p.acts.length >= 3); p.acts[2].text = 'Texto cambiado por mí'; save() }); await page.clock.runFor(3000);
  const usoRpc = await ev(() => __EG.api.net.log.filter(e => e.table === 'rpc:pa_docs_patch').length), upd = await ev(() => __EG.api.net.log.filter(e => e.table === 'pa_docs' && e.op === 'update').length);
  if (parche) ok(usoRpc === 1 && upd === 0, 'un cambio pequeño se envía como parche (' + usoRpc + ' RPC, ' + upd + ' actualizaciones completas)'); else ok(usoRpc === 0 && upd === 1, 'sin la función E3 se guarda la fila completa como antes (' + upd + ' actualización completa)');
  // 3) edición concurrente: otra persona cambia la actividad 2 en el servidor mientras yo cambio la 3
  await ev(() => { const srv = __EG.api.db.pa_docs.find(d => d.col === 'plans' && d.data.acts.length >= 3); window.__id = srv.id; srv.data.acts[1].text = 'Cambio AJENO'; });   // el servidor cambia sin avisar a esta pestaña
  await ev(() => { const p = db.plans.find(p => p.id === window.__id); p.acts[2].text = 'Cambio MÍO ' + Date.now(); save() }); await page.clock.runFor(3000);
  const fin = await ev(() => { const srv = __EG.api.db.pa_docs.find(d => d.col === 'plans' && d.id === window.__id); return [srv.data.acts[1].text, srv.data.acts[2].text] });
  if (parche) ok(fin[0] === 'Cambio AJENO' && /^Cambio MÍO/.test(fin[1]), 'dos ediciones concurrentes de actividades distintas se conservan ambas (servidor: «' + fin[0] + '» y «' + fin[1].slice(0, 11) + '…»)'); else ok(fin[0] !== 'Cambio AJENO' && /^Cambio MÍO/.test(fin[1]), 'sin E3 (comportamiento anterior) el último en guardar pisa la edición ajena: «' + fin[0].slice(0, 20) + '»');
  // 4) sin permiso: el visualizador no puede guardar (el servidor rechaza y la app avisa), con y sin E3
  console.log(fallo ? 'PARCIAL FALLO ' + fallo : 'PARCIAL OK'); await browser.close(); srv.close(); process.exit(fallo ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
`;
fs.writeFileSync(__dirname + '/_parcial_run.cjs', head + body);
