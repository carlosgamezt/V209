// Panel «Digifact TEST» en el NAVEGADOR (teléfono 320–430 px y PC): estado real de la certificación y del almacenamiento, avisos de Digifact, bloqueo por resultado incierto, conciliación y RENOVACIÓN de una preparación vencida.
// Servidor real de la demostración; las respuestas de Digifact TEST se SUSTITUYEN en el navegador (no sale nada a Digifact): se prueba la pantalla y lo que envía al servidor.
// Uso: node e2e_digifact_panel.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const { puertoLibre } = require("./puerto_libre.cjs");
const NAV = process.env.FEL_E2E_NAVEGADOR ?? "chromium", motor = pw[NAV];
async function arrancar() {
  const puerto = await puertoLibre();
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_DEMO_LOGIN: "1" } });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    const ctxMovil = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, ...(NAV !== "firefox" && w < 800 ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const revisado = (p) => p.evaluate(async () => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "300" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version }); return d.documento.id;
    });
    const json = (r, o, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    // Digifact TEST SUSTITUIDO en el navegador; «ops» es lo que el servidor devolvería; guarda lo que la pantalla ENVÍA
    const simular = async (p, { almacenamiento = "persistente", ops = [], conciliar = null, preparar = null }) => {
      const env = { ops, cuerpos: { preparar: [], conciliar: [], certificar: [] } };
      await p.route("**/api/digifact/estado", (r) => json(r, { habilitado: true, certificacion: true, consultaNit: false, consultaCui: false, correoDigifact: { habilitado: false }, ambiente: "TEST", produccion: "bloqueada", anulacion: "cerrada", notaCredito: "cerrada", confirmacion: "CERTIFICAR-TEST", almacenamiento }));
      await p.route(/\/api\/documentos\/[0-9a-f-]{36}\/digifact(\/[a-z]+)?$/, async (r) => {
        const rq = r.request(), accion = (/digifact\/([a-z]+)$/.exec(rq.url()) ?? [])[1], id = /documentos\/([0-9a-f-]{36})/.exec(rq.url())[1];
        if (rq.method() === "GET" && !accion) return json(r, { operaciones: env.ops.map((o) => ({ ...o, documentoId: id })) });
        if (rq.method() === "GET" && accion === "correo") return json(r, { solicitado: false, destinatario: null, cuando: null, entrega: "sin_confirmacion" });
        if (rq.method() !== "POST") return r.fallback();
        const cuerpo = JSON.parse(rq.postData() ?? "{}"); env.cuerpos[accion]?.push(cuerpo);
        if (accion === "preparar") { const resp = preparar ? preparar(id) : {}; env.ops = [{ id: "op-1", referencia: "REF-0001", estado: "preparada", total: "300.00", fechaEmision: "2026-11-21", huellaEmisor: "HUELLA-1", renovaciones: resp.renovaciones ?? 0, vigenteHasta: Date.now() + (resp.caducaEnMs ?? 1800000) }]; return json(r, { operacionId: "op-1", referencia: "REF-0001", documentoId: id, total: "300.00", receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" }, fechaEmision: "2026-11-21", huellaEmisor: "HUELLA-1", establecimiento: 1, caducaEnMs: 1800000, reutilizada: false, renovada: false, renovaciones: 0, ...resp }); }
        if (accion === "conciliar") { env.ops = [{ ...env.ops[0], estado: "certificada", resultado: { serie: "0AB12CD", numero: "1234567", autorizacion: "A1B2C3D4-0000-1111-2222-333344445555" } }]; return json(r, conciliar ?? { resultado: "certificada", operacion: env.ops[0] }); }
        return json(r, {});
      });
      await p.reload(); await p.waitForSelector(".cab-demo");   // la aplicación precarga el estado de Digifact al entrar (caché en memoria): se recarga para que use las respuestas simuladas de arriba
      return env;
    };
    const PANEL = '[data-panel="digifact-test"]';
    const hasta = async (cond, msg) => { for (let i = 0; i < 60; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(`tiempo agotado: ${msg}`); };
    const abrir = async (w, cfg, u = "ana") => { const X = await ctxMovil(w); await entrar(X.p, u); const id = await revisado(X.p); const env = await simular(X.p, cfg); await X.p.goto(`${srv.url}/#/f/${id}`); await X.p.waitForSelector(`${PANEL} #digifact-estado-real`); return { ...X, id, env }; };
    const grandes = async (p, sels, donde) => { for (const sel of sels) { const l = p.locator(sel); if (!(await l.count())) continue; const b = await l.first().boundingBox(); assert.ok(b.height >= 40, `${donde}: ${sel} mide ${b.height} px (<40)`); assert.ok(b.x >= 0 && b.x + b.width <= p.viewportSize().width + 0.5, `${donde}: ${sel} se sale del ancho`); } };

    for (const w of [320, 360, 390, 430, 1100]) {
      const donde = `${w}px`;
      // ===== 1) almacén persistente: se dice, con el estado real de la certificación; el pie ya no habla de un estado «simulado» ni de algo futuro
      { const X = await abrir(w, { almacenamiento: "persistente" }); const t = await X.p.locator(PANEL).innerText();
        assert.match(t, /Certificación: habilitada/); assert.match(t, /Almacenamiento: persistente/); assert.equal(await X.p.locator("#digifact-sin-almacen").count(), 0);
        assert.match(await X.p.locator("#digifact-pie").innerText(), /guarda en el documento el estado fiscal, la serie, el número y la autorización/); assert.doesNotMatch(t, /estado simulado|eso llega con/, "sin texto desactualizado");
        await grandes(X.p, ["#digifact-validar", "#digifact-preparar"], donde); await sinDesborde(X.p, `${donde} · persistente`); await X.c.close(); }
      // ===== 2) almacén temporal: se explica que es una protección (no se certifica)
      { const X = await abrir(w, { almacenamiento: "temporal" }); assert.match(await X.p.locator("#digifact-sin-almacen").innerText(), /sin la migración 29 no se envía nada real/); assert.match(await X.p.locator("#digifact-estado-real").innerText(), /TEMPORAL \(no se certifica\)/); assert.match(await X.p.locator("#digifact-pie").innerText(), /Sin almacén persistente/); await sinDesborde(X.p, `${donde} · temporal`); await X.c.close(); }
      // ===== 3) preparación VENCIDA: se ofrece renovarla (misma referencia), no se puede certificar y la renovación no autoriza nada
      { const X = await abrir(w, { ops: [{ id: "op-1", referencia: "REF-0001", estado: "preparada", total: "300.00", fechaEmision: "2026-11-21", huellaEmisor: "HUELLA-1", renovaciones: 0, vigenteHasta: Date.now() - 60000 }],
          preparar: () => ({ renovada: true, renovaciones: 1, caducaEnMs: 1800000 }) });
        await X.p.waitForSelector("#digifact-vencida"); assert.equal(await X.p.locator("#digifact-certificar").isDisabled(), true, "vencida: no se certifica"); await grandes(X.p, ["#digifact-renovar", "#digifact-certificar"], donde);
        await X.p.fill('input[aria-label="Confirmación escrita"]', "CERTIFICAR-TEST"); await X.p.fill('input[aria-label="Referencia repetida"]', "REF-0001"); await X.p.fill('input[aria-label="Huella repetida"]', "HUELLA-1"); assert.equal(await X.p.locator("#digifact-certificar").isDisabled(), true, "vencida: ni con todo escrito");
        await X.p.click("#digifact-renovar"); await hasta(async () => (await X.p.locator("#digifact-vencida").count()) === 0, "desaparece el aviso de vencida"); assert.equal(X.env.cuerpos.preparar.length, 1, "se renovó con UNA llamada a preparar"); assert.equal(X.env.cuerpos.certificar.length, 0, "renovar NO certifica");
        assert.match(await X.p.locator("#digifact-info").innerText(), /RENOVÓ: misma operación, referencia y huella\. No se envió nada ni se autorizó nada/); assert.match(await X.p.locator("#digifact-vigencia").innerText(), /\d{2}:\d{2} \(hora de Guatemala\)/);
        assert.equal(await X.p.locator("#digifact-certificar").isDisabled(), true, "tras renovar sigue exigiendo la confirmación escrita"); await sinDesborde(X.p, `${donde} · renovada`); await X.c.close(); }
      // ===== 4) resultado incierto: BLOQUEA, no se reenvía; Digifact ya lo tenía → se explica; conciliar muestra el aviso del servidor
      { const X = await abrir(w, { ops: [{ id: "op-1", referencia: "REF-0001", estado: "desconocida", total: "300.00", resultado: { motivoDesconocido: "ya_existia_en_digifact" } }], conciliar: { resultado: "certificada", aviso: "Digifact ya tenía este documento: se registró su resultado sin reenviar nada.", operacion: {} } });
        await X.p.waitForSelector("#digifact-ya-existia"); assert.match(await X.p.locator("#digifact-ya-existia").innerText(), /YA tiene un documento con esta referencia: NO se envió nada/); assert.equal(await X.p.locator("#digifact-preparar").count(), 0, "con una operación que bloquea no se prepara otra");
        await grandes(X.p, ["#digifact-conciliar"], donde); await X.p.click("#digifact-conciliar"); await X.p.waitForSelector("#digifact-info"); assert.match(await X.p.locator("#digifact-info").innerText(), /se registró su resultado sin reenviar nada/); assert.equal(X.env.cuerpos.conciliar.length, 1);
        await X.p.waitForSelector("#digifact-certificada"); assert.match(await X.p.locator(PANEL).innerText(), /A1B2C3D4-0000-1111-2222-333344445555/); await sinDesborde(X.p, `${donde} · conciliada`); await X.c.close(); }
      { const X = await abrir(w, { ops: [{ id: "op-1", referencia: "REF-0001", estado: "desconocida", total: "300.00", resultado: { motivoDesconocido: "tiempo_agotado" } }] });
        await X.p.waitForSelector("#digifact-bloqueo"); assert.match(await X.p.locator("#digifact-bloqueo").innerText(), /BLOQUEADO: no se prepara ni se envía otro\. NO se reenvía/); assert.equal(await X.p.locator("#digifact-preparar").count(), 0); await sinDesborde(X.p, `${donde} · desconocida`); await X.c.close(); }
      { const X = await abrir(w, { ops: [{ id: "op-1", referencia: "REF-0001", estado: "enviando", total: "300.00" }] }); await X.p.waitForSelector("#digifact-bloqueo"); assert.match(await X.p.locator("#digifact-bloqueo").innerText(), /envío en curso.*BLOQUEADO/s); assert.equal(await X.p.locator("#digifact-preparar").count(), 0); await X.c.close(); }
      // ===== 5) una preparación descartada (agotó sus renovaciones) se explica y deja preparar otra
      { const X = await abrir(w, { ops: [{ id: "op-0", referencia: "REF-0000", estado: "no_enviada", total: "300.00", resultado: { codigo: "preparacion_caducada" } }] });
        await X.p.waitForSelector("#digifact-no-enviada"); assert.match(await X.p.locator("#digifact-no-enviada").innerText(), /NUNCA se envió/); assert.equal(await X.p.locator("#digifact-preparar").count(), 1); await X.c.close(); }
    }
    assert.deepEqual(errores, [], "sin errores de JavaScript en la página"); console.log(`DIGIFACT PANEL E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
