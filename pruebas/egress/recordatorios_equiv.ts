// Compara, con el mismo núcleo de la función, los avisos y contadores calculados con los planes COMPLETOS y con la lectura mínima de PostgreSQL.
// Uso: deno run -A recordatorios_equiv.ts <dir con completo.json, usuarios.json, min_<modo>.json, descargados.json>
const dir = Deno.args[0]
const src = await Deno.readTextFile(new URL('../../supabase/functions/recordatorios-de-nexa/index.ts', import.meta.url))
const ini = src.indexOf('/* ===== NÚCLEO'), fin = src.indexOf('/* ===== FIN DEL NÚCLEO')
const nucleo = src.slice(ini, fin) + '\nexport { construirAvisos, construirSinLeer, construirSinDescargar, contarPendientes }'
const f = await Deno.makeTempFile({ suffix: '.ts' }); await Deno.writeTextFile(f, nucleo)
const N = await import('file://' + f)
const rd = async (n: string) => JSON.parse(await Deno.readTextFile(`${dir}/${n}.json`))
const completo = (await rd('completo')).map((r: any) => r), users = await rd('usuarios'), desc = new Set<string>(await rd('descargados'))
const notifs = await rd('notifs')
let fallos = 0, casos = 0
const igual = (a: unknown, b: unknown, m: string) => { casos++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { fallos++; console.log('FALLO', m, '\n  completo:', x.slice(0, 300), '\n  minimo  :', y.slice(0, 300)) } }
const minRec = await rd('min_recordatorios'), minUn = await rd('min_unread'), minBadge = await rd('min_badge')
const ahora = Date.parse('2026-11-27T20:00:00Z')
const ids = (l: any[]) => l.length
for (const inMail of [true, false]) {
  for (const hoy of ['2026-11-20', '2026-11-27', '2026-11-28', '2026-12-02']) for (const slot of ['am', 'pm'])
    igual(N.construirAvisos(completo, users, hoy, slot, new Set()), N.construirAvisos(minRec, users, hoy, slot, new Set()), `avisos ${hoy} ${slot}`)
  igual(N.construirSinLeer(notifs, completo, users, ahora, new Set()), N.construirSinLeer(notifs, minUn, users, ahora, new Set()), 'sin leer')
  igual(N.construirSinDescargar(completo, users, desc, inMail, ahora, new Set()), N.construirSinDescargar(minUn, users, desc, inMail, ahora, new Set()), 'sin descargar invMail=' + inMail)
  igual(N.contarPendientes(completo, users, desc, inMail), N.contarPendientes(minBadge, users, desc, inMail), 'contadores invMail=' + inMail)
}
const kb = (x: unknown) => Math.round(JSON.stringify(x).length / 1024)
console.log(JSON.stringify({ planes_completos: completo.length, planes_recordatorios: minRec.length, planes_unread: minUn.length, planes_badge: minBadge.length, kb_completo: kb(completo), kb_recordatorios: kb(minRec), kb_unread: kb(minUn), kb_badge: kb(minBadge), casos, fallos }))
if (!fallos && (await Promise.all([completo, minBadge])).length) console.log('EQUIVALENCIA OK'); else { console.log('EQUIVALENCIA FALLO'); Deno.exit(1) }
