// Ciclo «Guardar y certificar en TEST» en el NAVEGADOR (teléfono 390 px y computadora 1100 px). Servidor real de la demostración; las respuestas de Digifact TEST se SUSTITUYEN en el navegador (no sale nada a Digifact):
// se prueba lo que la pantalla hace y lo que envía al servidor. Comprueba: el documento se guarda SIEMPRE antes (aunque la certificación falle, se cancele o quede incierta), la confirmación en un solo diálogo,
// que no se certifica sin confirmar, la vista previa con el documento guardado (BR-####, IVA incluido, PDF y Compartir habilitados) y que sin el ciclo autorizado no aparece la acción.
// Uso: node e2e_digifact_ciclo.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
const { spawn } = require("child_process"), path = require("path"), assert = require("assert/strict"), pw = require("playwright");
const { esperarNueva, elegirReceptor } = require("./ayudas_nueva.cjs");
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
const json = (r, o, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const donde = `${w}px`;
      const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`));
      await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", "ana"); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo");

      // ---- Digifact TEST sustituido: estado del servidor (con ciclo autorizado) y respuestas de preparar/certificar; se guardan las peticiones
      const env = { ciclo: true, cert: "certificada", llamadas: [], docId: null };
      await p.route("**/api/digifact/estado", (r) => json(r, { habilitado: true, certificacion: true, consultaNit: false, consultaCui: false, correoDigifact: { habilitado: false }, ambiente: "TEST", produccion: "bloqueada", anulacion: "cerrada", notaCredito: "cerrada", confirmacion: "CERTIFICAR-TEST", almacenamiento: "persistente", empresaConCanal: true, ciclo: env.ciclo }));
      await p.route(/\/api\/documentos\/[0-9a-f-]{36}\/digifact(\/[a-z]+)?$/, async (r) => {
        const rq = r.request(), accion = (/digifact\/([a-z]+)$/.exec(rq.url()) ?? [])[1], id = /documentos\/([0-9a-f-]{36})/.exec(rq.url())[1];
        if (rq.method() === "GET" && !accion) return json(r, { operaciones: env.ops ?? [] });
        if (rq.method() === "GET" && accion === "correo") return json(r, { solicitado: false, destinatario: null, cuando: null, entrega: "sin_confirmacion" });
        if (rq.method() !== "POST") return r.fallback();
        const cuerpo = JSON.parse(rq.postData() ?? "{}"); env.llamadas.push({ accion, cuerpo, id });
        if (accion === "preparar") { env.ops = [{ id: "op-1", documentoId: id, referencia: "11111111-2222-4333-8444-555555555555", estado: "preparada", total: "300.00", fechaEmision: "2026-11-24", huellaEmisor: "HUELLA-1" }];
          return json(r, { operacionId: "op-1", referencia: "11111111-2222-4333-8444-555555555555", documentoId: id, total: "300.00", receptor: { nombre: "CONSUMIDOR FINAL" }, fechaEmision: "2026-11-24", huellaEmisor: "HUELLA-1", caducaEnMs: 1800000, reutilizada: false, renovada: false, renovaciones: 0 }); }
        if (accion === "certificar") {
          if (env.cert === "certificada") { env.ops = [{ ...env.ops[0], estado: "certificada", resultado: { serie: "A7220268", numero: "198134837", autorizacion: "A7220268-0BCF-4C35-9661-6791E5ADF2DC" } }]; return json(r, { reutilizada: false, operacion: env.ops[0] }); }
          if (env.cert === "error") { env.ops = [{ ...env.ops[0], estado: "no_enviada", resultado: { codigo: "autenticacion", mensaje: "credenciales" } }]; return json(r, { reutilizada: false, operacion: env.ops[0], error: { tipo: "autenticacion", mensaje: "Digifact rechazó las credenciales." } }); }
          if (env.cert === "caida") return json(r, { codigo: "error_interno", mensaje: "Conexión interrumpida" }, 502);
          env.ops = [{ ...env.ops[0], estado: "desconocida", resultado: { motivoDesconocido: "timeout" } }]; return json(r, { reutilizada: false, operacion: env.ops[0] });
        }
        return json(r, {});
      });
      const nuevaConItem = async () => {
        await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await elegirReceptor(p);
        const sel = p.locator(".sel-concepto"); await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value")); await p.waitForSelector(".it");
      };
      const listaApi = () => p.evaluate(async () => (await (await fetch("/api/documentos", { headers: { "x-demo": "1" } })).json()).sort((a, b) => b.numero_borrador - a.numero_borrador));
      const hasta = async (cond, msg) => { for (let i = 0; i < 80; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(`tiempo agotado: ${msg}`); };

      // ---- 1) con el ciclo autorizado hay DOS acciones claras: «Guardar borrador» y «Guardar y certificar en TEST»
      await nuevaConItem();
      assert.equal(await p.locator("#guardar-certificar").count(), 1, `${donde}: existe «Guardar y certificar en TEST»`); assert.equal(await p.locator("#guardar").count(), 1, `${donde}: sigue existiendo «Guardar borrador»`);
      assert.match(await p.locator("#guardar-certificar").innerText(), /certificar en TEST/i);
      // el resumen muestra el IVA incluido (estimado) en lugar de «pendientes»
      assert.match(await p.locator(".totales").innerText(), /IVA 12 % incluido/, `${donde}: el resumen muestra el IVA incluido`); assert.ok(!/pendientes de régimen/.test(await p.locator(".totales").innerText()));

      // ---- 2) Guardar y certificar → se guarda, se revisa, se prepara (sin enviar), aparece UN diálogo y solo al confirmar se certifica
      const antes = (await listaApi()).length;
      await p.click("#guardar-certificar"); await p.waitForSelector("#confirmar-certificar-test");
      assert.equal((await listaApi()).length, antes + 1, `${donde}: el documento ya está GUARDADO cuando se pide confirmar`);
      assert.deepEqual(env.llamadas.map((l) => l.accion), ["preparar"], `${donde}: hasta confirmar solo se PREPARA (nada se envía)`);
      assert.match(await p.locator(".modal").innerText(), /UNA sola vez[\s\S]*PRUEBAS[\s\S]*no tiene valor fiscal/i);
      await p.click("#confirmar-certificar-test");
      await hasta(() => env.llamadas.some((l) => l.accion === "certificar"), "se envía la certificación tras confirmar");
      const cert = env.llamadas.find((l) => l.accion === "certificar").cuerpo;
      assert.equal(cert.confirmacion, "CERTIFICAR-TEST"); assert.equal(cert.referencia, "11111111-2222-4333-8444-555555555555"); assert.equal(cert.huellaEmisor, "HUELLA-1"); assert.equal(cert.operacionId, "op-1");
      await hasta(async () => (await p.locator("body").innerText()).includes("Certificado en Digifact TEST"), "aviso de certificación en TEST");
      const doc1 = (await listaApi())[0]; assert.equal(doc1.estado_preparacion, "revisado", `${donde}: queda guardado y REVISADO`);

      // ---- 3) la certificación RECHAZADA antes de salir: el documento queda guardado y el motivo se explica
      env.ops = []; env.llamadas.length = 0; env.cert = "error";
      await nuevaConItem(); const n2 = (await listaApi()).length; await p.click("#guardar-certificar"); await p.waitForSelector("#confirmar-certificar-test"); await p.click("#confirmar-certificar-test");
      await hasta(async () => /No se envió a Digifact/.test(await p.locator(".err.area-msg").innerText()), "mensaje de no enviada");
      assert.match(await p.locator(".err.area-msg").innerText(), /quedó guardado/); assert.equal((await listaApi()).length, n2 + 1, `${donde}: el documento sigue guardado aunque no se certificó`);

      // ---- 4) respuesta INCIERTA: se dice que quedó bloqueado y que no se reenvía; una caída de red también conserva el documento
      env.ops = []; env.llamadas.length = 0; env.cert = "incierta";
      await nuevaConItem(); await p.click("#guardar-certificar"); await p.waitForSelector("#confirmar-certificar-test"); await p.click("#confirmar-certificar-test");
      await hasta(async () => /BLOQUEADO/.test(await p.locator(".err.area-msg").innerText()), "mensaje de resultado incierto");
      assert.equal(env.llamadas.filter((l) => l.accion === "certificar").length, 1, `${donde}: UNA sola certificación enviada`);
      env.ops = []; env.llamadas.length = 0; env.cert = "caida"; const n4 = (await listaApi()).length;
      await nuevaConItem(); await p.click("#guardar-certificar"); await p.waitForSelector("#confirmar-certificar-test"); await p.click("#confirmar-certificar-test");
      await hasta(async () => /quedó guardado/.test(await p.locator(".err.area-msg").innerText()), "mensaje tras la caída"); assert.equal((await listaApi()).length, n4 + 1, `${donde}: tras una caída de red el documento sigue guardado`);

      // ---- 5) «Ahora no»: el documento queda guardado y revisado, y NO se certifica
      env.ops = []; env.llamadas.length = 0; env.cert = "certificada";
      await nuevaConItem(); await p.click("#guardar-certificar"); await p.waitForSelector("#cancelar-certificar-test"); await p.click("#cancelar-certificar-test");
      await hasta(async () => (await p.locator("body").innerText()).includes("No se certificó"), "aviso de no certificado");
      assert.equal(env.llamadas.filter((l) => l.accion === "certificar").length, 0, `${donde}: sin confirmar NO se certifica`);

      // ---- 6) vista previa desde un formulario SIN guardar: se guarda primero y la vista previa trae BR-####, el IVA incluido y PDF/Compartir habilitados
      await nuevaConItem(); await p.click("#previa-titulo");
      await p.waitForSelector(".previa-modal .papel");
      const papel = await p.locator(".previa-modal .papel").innerText();
      assert.match(papel, /BR-\d{4}/, `${donde}: la vista previa trae el número de borrador`); assert.ok(!papel.includes("BR-????"), `${donde}: ya no aparece BR-????`);
      assert.match(papel, /IVA 12 % \(incluido/, `${donde}: la vista previa muestra el IVA incluido`); assert.ok(!/pendientes/.test(papel), `${donde}: sin «pendientes»`);
      assert.equal(await p.locator("#previa-pdf").isDisabled(), false, `${donde}: PDF habilitado`); assert.equal(await p.locator("#previa-compartir").isDisabled(), false, `${donde}: Compartir habilitado`);
      await p.keyboard.press("Escape");

      // ---- 7) sin el ciclo autorizado (o sin Digifact) no aparece la acción de certificar: solo se guarda
      env.ciclo = false; await p.reload(); await nuevaConItem();   // el estado del canal cambia solo al publicar de nuevo (la página se recarga y la caché en memoria se vacía)
      assert.equal(await p.locator("#guardar-certificar").count(), 0, `${donde}: sin ciclo autorizado no se ofrece certificar`); assert.equal(await p.locator("#guardar").count(), 1);
      const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`);
      await c.close();
    }
    assert.deepEqual(errores, [], `errores en la consola: ${errores.join(" | ")}`);
    console.log("OK  ciclo guardar y certificar en TEST (390 px y 1100 px): guarda siempre, confirma en un diálogo, nada sin confirmar, rechazo/incierto/caída conservan el documento, vista previa con BR e IVA, sin ciclo no se ofrece");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
