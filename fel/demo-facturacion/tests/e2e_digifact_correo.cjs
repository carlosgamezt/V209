// «Enviar factura por correo» (lo envía DIGIFACT al certificar) en el panel «Digifact TEST» del detalle, en el NAVEGADOR (teléfono 320–430 px).
// Servidor real de la demostración; las respuestas de Digifact TEST se SUSTITUYEN en el navegador (la certificación real está apagada): se prueba la pantalla y lo que envía al servidor, no a Digifact.
// Uso: node e2e_digifact_correo.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
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
    const ctxMovil = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: true, ...(NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); return { c, p }; };
    const entrar = async (p, u) => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const revisado = (p) => p.evaluate(async () => {
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "300" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version }); return d.documento.id;
    });
    // Digifact TEST SUSTITUIDO en el navegador: estado, operaciones, validar/preparar/certificar y «correo». Guarda lo que la pantalla ENVÍA.
    const simular = async (p, { correoHabilitado, rechazo = null }) => {
      const env = { ops: [], cuerpos: { validar: [], preparar: [], certificar: [] }, correo: { solicitado: false } };
      const json = (r, o, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
      await p.route("**/api/digifact/estado", (r) => json(r, { habilitado: true, certificacion: true, consultaNit: false, consultaCui: false, correoDigifact: { habilitado: correoHabilitado }, ambiente: "TEST", produccion: "bloqueada", anulacion: "cerrada", notaCredito: "cerrada", confirmacion: "CERTIFICAR-TEST" }));
      await p.route(/\/api\/documentos\/[0-9a-f-]{36}\/digifact(\/[a-z]+)?$/, async (r) => {
        const rq = r.request(), accion = (/digifact\/([a-z]+)$/.exec(rq.url()) ?? [])[1], id = /documentos\/([0-9a-f-]{36})/.exec(rq.url())[1];
        if (rq.method() === "GET" && !accion) return json(r, { operaciones: env.ops });
        if (rq.method() === "GET" && accion === "correo") return json(r, env.correo.solicitado ? { solicitado: true, destinatario: env.correo.destinatario, cuando: new Date().toISOString(), entrega: "sin_confirmacion" } : { solicitado: false, destinatario: null, cuando: null, entrega: "sin_confirmacion" });
        if (rq.method() !== "POST") return r.fallback();
        const cuerpo = JSON.parse(rq.postData() ?? "{}"); env.cuerpos[accion]?.push(cuerpo);
        if (rechazo && cuerpo.enviar_correo) return json(r, rechazo, rechazo.status ?? 403);
        if (accion === "validar") return json(r, { ok: true, errores: [], total: "300.00", huellaEmisor: "HUELLA-1" });
        if (accion === "preparar") return json(r, { operacionId: "op-1", referencia: "REF-0001", documentoId: id, total: "300.00", receptor: { tipoId: "NIT", id: "123", nombre: "X" }, fechaEmision: "2026-11-21", huellaEmisor: "HUELLA-1", establecimiento: 1, caducaEnMs: 900000, reutilizada: false, correoSolicitado: cuerpo.enviar_correo ? "c***@ejemplo.com" : null });
        if (accion === "certificar") {
          env.ops = [{ id: "op-1", documentoId: id, referencia: "REF-0001", estado: "certificada", resultado: { serie: "0AB12CD", numero: "1234567", autorizacion: "A1B2C3D4-0000-1111-2222-333344445555" } }];
          if (cuerpo.enviar_correo) env.correo = { solicitado: true, destinatario: "c***@ejemplo.com" }; return json(r, { reutilizada: false, operacion: env.ops[0] });
        }
        return json(r, {});
      });
      return env;
    };
    const PANEL = '[data-panel="digifact-test"]', CHK = "#digifact-correo-chk", CAMPO = "#digifact-correo-campo", IN = "#digifact-correo";
    const confirmar = async (p) => { await p.fill('input[aria-label="Confirmación escrita"]', "CERTIFICAR-TEST"); await p.fill('input[aria-label="Referencia repetida"]', "REF-0001"); await p.fill('input[aria-label="Huella repetida"]', "HUELLA-1"); };

    // ================= 1) servidor SIN el correo de Digifact: la casilla no existe y nada cambia
    const A = await ctxMovil(390); await entrar(A.p, "ana"); const idA = await revisado(A.p); const envA = await simular(A.p, { correoHabilitado: false });
    await A.p.goto(`${srv.url}/#/f/${idA}`); await A.p.waitForSelector("#digifact-preparar"); assert.equal(await A.p.locator(CHK).count(), 0, "sin FEL_DIGIFACT_CORREO no hay casilla");
    await A.p.click("#digifact-preparar"); await A.p.waitForSelector("#digifact-preparada"); assert.deepEqual(envA.cuerpos.preparar[0], {}, "sin la opción, la petición no lleva nada de correo"); assert.equal(await A.p.locator("#digifact-correo-resumen").count(), 0);

    // ================= 2) habilitado: casilla APAGADA por defecto; correo del cliente editable; validación; el mismo correo viaja en validar, preparar y certificar
    const B = await ctxMovil(390); await entrar(B.p, "ana"); const idB = await revisado(B.p); const envB = await simular(B.p, { correoHabilitado: true });
    await B.p.goto(`${srv.url}/#/f/${idB}`); await B.p.waitForSelector(CHK); assert.equal(await B.p.locator(CHK).isChecked(), false, "la casilla viene APAGADA"); assert.equal(await B.p.locator(CAMPO).isVisible(), false);
    assert.match(await B.p.locator(PANEL).innerText(), /después no se puede reenviar desde NEXA/, "avisa que solo se puede pedir ahora");
    await B.p.check(CHK); await B.p.waitForSelector(CAMPO, { state: "visible" }); const dado = await B.p.inputValue(IN); assert.match(dado, /@/, "el correo del cliente viene prellenado"); assert.match(await B.p.locator("#digifact-correo-nota").innerText(), /Tomado del cliente/);
    // correo inválido: no se puede validar ni preparar
    await B.p.fill(IN, "no-es-correo"); assert.equal(await B.p.locator("#digifact-preparar").isDisabled(), true); assert.equal(await B.p.locator("#digifact-validar").isDisabled(), true); assert.match(await B.p.locator("#digifact-correo-nota").innerText(), /válido/);
    await B.p.fill(IN, "x".repeat(45) + "@ejemplo.com"); assert.equal(await B.p.locator("#digifact-preparar").isDisabled(), true, "más de 50 caracteres");
    await B.p.fill(IN, "cliente.prueba@ejemplo.com"); assert.equal(await B.p.locator("#digifact-preparar").isDisabled(), false); assert.match(await B.p.locator("#digifact-correo-nota").innerText(), /escrito por ti/);
    for (const sel of [CHK, IN, "#digifact-preparar", "#digifact-validar"]) { const b = await B.p.locator(sel).boundingBox(); assert.ok(b.height >= 20 && b.x >= 0 && b.x + b.width <= 390.5, `${sel} dentro del ancho`); } for (const sel of [IN, "#digifact-preparar"]) assert.ok((await B.p.locator(sel).boundingBox()).height >= 40, `${sel} ≥ 40 px`);
    assert.ok((await B.p.locator(".chk-correo").boundingBox()).height >= 40, "la casilla completa mide ≥ 40 px"); await sinDesborde(B.p, "casilla de correo");
    await B.p.click("#digifact-validar"); await B.p.waitForSelector("#digifact-validacion"); assert.deepEqual(envB.cuerpos.validar[0], { enviar_correo: true, correo: "cliente.prueba@ejemplo.com" });
    await B.p.click("#digifact-preparar"); await B.p.waitForSelector("#digifact-preparada"); assert.deepEqual(envB.cuerpos.preparar[0], { enviar_correo: true, correo: "cliente.prueba@ejemplo.com" });
    assert.match(await B.p.locator("#digifact-correo-resumen").innerText(), /Digifact enviará a c\*\*\*@ejemplo\.com al certificar/, "el resumen lo muestra enmascarado, antes de confirmar");
    await B.p.uncheck(CHK); assert.match(await B.p.locator("#digifact-correo-resumen").innerText(), /No se enviará correo/); await B.p.check(CHK); assert.match(await B.p.locator("#digifact-correo-resumen").innerText(), /Digifact enviará a/);
    await B.p.fill(IN, "malo"); await confirmar(B.p); assert.equal(await B.p.locator("#digifact-certificar").isDisabled(), true, "con el correo marcado e inválido no se puede certificar"); await B.p.fill(IN, "cliente.prueba@ejemplo.com");
    await confirmar(B.p); assert.equal(await B.p.locator("#digifact-certificar").isDisabled(), false);
    await B.p.click("#digifact-certificar"); await B.p.waitForSelector("#digifact-correo-solicitado");
    assert.deepEqual(envB.cuerpos.certificar[0], { operacionId: "op-1", confirmacion: "CERTIFICAR-TEST", referencia: "REF-0001", huellaEmisor: "HUELLA-1", enviar_correo: true, correo: "cliente.prueba@ejemplo.com" }, "certificar lleva el MISMO correo");
    const t = await B.p.locator("#digifact-correo-solicitado").innerText(); assert.match(t, /envío solicitado a Digifact/); assert.match(t, /c\*\*\*@ejemplo\.com/); assert.match(t, /hora de Guatemala/); assert.match(t, /no recibe confirmación de entrega/); assert.match(t, /No se puede reenviar desde NEXA/);
    assert.ok(!/Entregado/i.test(await B.p.locator("#digifact-correo-solicitado .tag").innerText()), "nunca se afirma «entregado»"); await sinDesborde(B.p, "correo solicitado");
    assert.equal(await B.p.locator(CHK).count(), 0, "ya certificada: no se vuelve a ofrecer la casilla (no se reenvía)");

    // ================= 3) habilitado pero SIN marcar la casilla: la petición no lleva correo y no hay «solicitado»
    const C = await ctxMovil(390); await entrar(C.p, "ana"); const idC = await revisado(C.p); const envC = await simular(C.p, { correoHabilitado: true });
    await C.p.goto(`${srv.url}/#/f/${idC}`); await C.p.waitForSelector("#digifact-preparar"); await C.p.click("#digifact-preparar"); await C.p.waitForSelector("#digifact-preparada");
    assert.deepEqual(envC.cuerpos.preparar[0], {}, "sin marcar la casilla no se manda nada de correo"); assert.match(await C.p.locator("#digifact-correo-resumen").innerText(), /No se enviará correo/);
    await confirmar(C.p); await C.p.click("#digifact-certificar"); await C.p.waitForSelector('[data-digifact-op="certificada"]'); assert.deepEqual(envC.cuerpos.certificar[0], { operacionId: "op-1", confirmacion: "CERTIFICAR-TEST", referencia: "REF-0001", huellaEmisor: "HUELLA-1" });
    assert.equal(await C.p.locator("#digifact-correo-solicitado").count(), 0, "sin pedirlo no aparece «envío solicitado»");

    // ================= 4) el servidor rechaza un destinatario no autorizado: el mensaje se muestra y no se avanza
    const D = await ctxMovil(390); await entrar(D.p, "ana"); const idD = await revisado(D.p); await simular(D.p, { correoHabilitado: true, rechazo: { codigo: "destinatario_no_autorizado", mensaje: "En el ambiente de pruebas solo se puede enviar a los correos autorizados.", status: 403 } });
    await D.p.goto(`${srv.url}/#/f/${idD}`); await D.p.waitForSelector(CHK); await D.p.check(CHK); await D.p.fill(IN, "cliente@dominio-externo.com"); await D.p.click("#digifact-preparar");
    await D.p.waitForSelector("#digifact-aviso"); assert.match(await D.p.locator("#digifact-aviso").innerText(), /correos autorizados/); assert.equal(await D.p.locator("#digifact-preparada").count(), 0, "no se prepara con un destinatario no autorizado");

    // ================= 5) lector: no ve la casilla (no puede certificar)
    const L = await ctxMovil(390); await entrar(L.p, "pedro"); await simular(L.p, { correoHabilitado: true }); await L.p.goto(`${srv.url}/#/f/${idA}`); await L.p.waitForSelector(PANEL); await L.p.waitForTimeout(600); assert.equal(await L.p.locator(CHK).count(), 0, "el lector no puede elegir el envío por correo");

    // ================= 6) distribución a 320 / 360 / 390 / 430 px
    for (const w of [320, 360, 390, 430]) {
      const m = await ctxMovil(w, 740); await entrar(m.p, "ana"); const id = await revisado(m.p); await simular(m.p, { correoHabilitado: true });
      await m.p.goto(`${srv.url}/#/f/${id}`); await m.p.waitForSelector(CHK); await m.p.check(CHK); await m.p.fill(IN, "una.direccion.larga.de.prueba@ejemplo.com"); await sinDesborde(m.p, `${w}px casilla y correo`);
      const c = await m.p.locator(".chk-correo").boundingBox(), i = await m.p.locator(IN).boundingBox(); assert.ok(c.x >= 0 && c.x + c.width <= w + 0.5 && i.x >= 0 && i.x + i.width <= w + 0.5, `${w}px: caben`); assert.ok(c.height >= 40 && i.height >= 40, `${w}px: ≥ 40 px`);
      await m.p.click("#digifact-preparar"); await m.p.waitForSelector("#digifact-preparada"); await sinDesborde(m.p, `${w}px preparada`); await m.c.close();
    }
    assert.deepEqual(errores, [], `errores de página: ${errores.join(" | ")}`);
    console.log(`DIGIFACT CORREO E2E OK (${NAV})`);
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
