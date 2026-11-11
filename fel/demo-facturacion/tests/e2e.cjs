// Prueba de extremo a extremo de la DEMOSTRACIÓN (navegador real): recorre el proceso completo con el servidor, la base PostgreSQL (PGlite), el orquestador real
// y el proveedor SIMULADO. Sin credenciales, sin red externa, sin SAT. Uso: node e2e.cjs [carpeta-de-capturas]   (FEL_DEMO_URL=http://127.0.0.1:8787 para usar un servidor ya iniciado)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (capturas) fs.mkdirSync(capturas, { recursive: true });

function arrancar() {
  if (process.env.FEL_DEMO_URL) return Promise.resolve({ url: process.env.FEL_DEMO_URL, parar() {} });
  const puerto = 9300 + Math.floor(Math.random() * 500);
  const hijo = spawn("deno", ["run", "-A", "servidor.ts", `--puerto=${puerto}`], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((ok, mal) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); mal(new Error("el servidor no arrancó a tiempo:\n" + salida)); }, 120000);
    const alLeer = (d) => { salida += d; if (salida.includes("Abre:")) { clearTimeout(t); ok({ url: `http://127.0.0.1:${puerto}`, parar() { hijo.kill(); } }); } };
    hijo.stdout.on("data", alLeer); hijo.stderr.on("data", alLeer); hijo.on("exit", (c) => { if (c) mal(new Error(`el servidor terminó con código ${c}:\n${salida}`)); });
  });
}

(async () => {
  const srv = await arrancar(), errores = [];
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, locale: "es-GT", acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
  const api = (m, ruta, cuerpo, u = "ana") => fetch(srv.url + ruta, { method: m, headers: { "x-demo": "1", "x-demo-usuario": u, "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then((r) => r.json());
  const foto = async (nombre, pg = p) => { assert.doesNotMatch(await pg.locator("body").innerText(), /\bnull\b|\bundefined\b|\[object /, `texto interno visible en ${nombre}`); if (capturas) await pg.screenshot({ path: path.join(capturas, nombre), fullPage: true }); };
  const como = async (clave) => { await p.selectOption('select[aria-label="Persona de la demostración"]', clave); await p.waitForSelector(`text=Ahora actúas como`); await p.waitForTimeout(150); };
  const toast = (t) => p.waitForSelector(`#toasts >> text=${t}`);
  const banda = async (pg = p) => assert.equal(await pg.locator(".banda-simulado").innerText().then((t) => t.includes("SIMULADO - SIN VALOR FISCAL")), true, "la banda de simulación debe verse siempre");
  const estadoFiscal = async () => (await p.locator(".doc-cab .tag").allInnerTexts()).join("|");
  const abrir = async (id) => { await p.goto(`${srv.url}/#/f/${id}`); await p.waitForSelector(".doc-cab"); };
  const crear = async (desc = "Servicio de consultoría", cant = "2", precio = "100") => {   // crea un borrador guardado y devuelve su id
    await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]');
    await p.selectOption('select[aria-label="Receptor"]', { label: /Comercial Los Pinos/ }).catch(async () => { const v = await p.locator('select[aria-label="Receptor"] option', { hasText: "Comercial Los Pinos" }).getAttribute("value"); await p.selectOption('select[aria-label="Receptor"]', v); });
    const est = await p.locator('select[aria-label="Establecimiento"] option', { hasText: "Casa matriz" }).getAttribute("value"); await p.selectOption('select[aria-label="Establecimiento"]', est);
    await p.fill('input[aria-label="Descripción de la línea 1"]', desc); await p.fill('input[aria-label="Cantidad de la línea 1"]', cant); await p.fill('input[aria-label="Precio de la línea 1"]', precio);
    await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); return p.url().split("/").pop();
  };
  const abrirDemo = async () => { await p.locator('details.demo-controles').evaluate((d) => { d.open = true; }); };
  const revisar = async () => { await p.click('button:has-text("Marcar como revisado")'); await p.waitForSelector('.doc-cab .tag:has-text("Revisado")'); };
  const enviar = async (escenario) => { await p.selectOption('select[aria-label="Comportamiento del proveedor simulado"]', escenario); await p.click("#enviar"); };

  // ============ 1. inicio, aviso permanente, usuario sin permisos
  await p.goto(srv.url); await p.waitForSelector(".cab-demo"); await banda(); await p.waitForSelector("text=No hay facturas");
  await foto("01-lista-vacia.png");
  assert.equal(await p.locator('select[aria-label="Persona de la demostración"] option').count(), 4);

  // ============ 2. crear con el emisor: validaciones, agregar y quitar líneas, guardar; el emisor no revisa ni certifica
  await como("marta");
  await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]');
  assert.match(await p.locator(".totales").innerText(), /SIMULADO - SIN VALOR FISCAL/); assert.match(await p.locator(".totales").innerText(), /dato.* por completar/);
  await p.click("#guardar"); await p.waitForSelector(".validacion"); assert.match(await p.locator(".validacion").innerText(), /Elige el receptor/); assert.match(await p.locator(".validacion").innerText(), /falta la descripción/);
  await p.click('button:has-text("Agregar línea")'); assert.equal(await p.locator(".ln:not(.ln-cab)").count(), 2);
  await p.fill('input[aria-label="Cantidad de la línea 2"]', "abc"); await p.click("#guardar"); assert.match(await p.locator(".validacion").innerText(), /Línea 2: la cantidad/);
  await p.click('button[aria-label="Quitar la línea 2"]'); assert.equal(await p.locator(".ln:not(.ln-cab)").count(), 1);
  await p.selectOption('select[aria-label="Tipo de descuento de la línea 1"]', "porcentaje"); await p.fill('input[aria-label="Valor del descuento de la línea 1"]', "150"); await p.click("#guardar"); assert.match(await p.locator(".validacion").innerText(), /no puede superar 100/);
  await p.fill('input[aria-label="Valor del descuento de la línea 1"]', "10");
  await p.fill('input[aria-label="Descripción de la línea 1"]', "Servicio de consultoría"); await p.fill('input[aria-label="Cantidad de la línea 1"]', "2"); await p.fill('input[aria-label="Precio de la línea 1"]', "100");
  assert.match(await p.locator(".totales").innerText(), /Q 180\.00/, "base imponible = 2 × 100 − 10 %");
  await p.check('input[aria-label="Receptor nuevo"]'); await p.selectOption('select[aria-label="Tipo de identificación"]', "NIT");
  await p.fill('input[aria-label="Identificación del receptor"]', "5550001-2"); await p.fill('input[aria-label="Nombre del receptor"]', "Cliente nuevo de prueba (ficticio)");
  const est = await p.locator('select[aria-label="Establecimiento"] option', { hasText: "Sucursal" }).getAttribute("value"); await p.selectOption('select[aria-label="Establecimiento"]', est);
  await foto("02-editor-con-validaciones.png");
  await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); await toast("guardado");
  const idMarta = p.url().split("/").pop(); assert.match(await p.locator(".doc-cab h1").innerText(), /BR-0001/);
  assert.equal(await p.locator('button:has-text("Marcar como revisado")').count(), 0, "el emisor no revisa");
  assert.match(await p.locator("#motivo-sin-envio").innerText(), /revisado/);
  await p.click('button:has-text("Vista previa")'); await p.waitForSelector('[data-vista="previa"]'); assert.match(await p.locator('[data-vista="previa"]').innerText(), /SIMULADO - SIN VALOR FISCAL/); assert.match(await p.locator('[data-vista="previa"]').innerText(), /Cliente nuevo de prueba/);
  await foto("03-vista-previa.png"); await p.keyboard.press("Escape");

  // ============ 3. revisar y enviar con la propietaria; el contenido se congela
  await como("ana"); await abrir(idMarta);
  await p.click('button:has-text("Validar con el proveedor")'); await toast("valida el documento");
  await revisar(); assert.equal(await p.locator('input[aria-label="Descripción de la línea 1"]').isDisabled(), true, "congelado tras revisar"); assert.equal(await p.locator("#guardar").count(), 0);
  assert.match(await p.locator("#enviar").innerText(), /Enviar a certificación simulada/);

  // ============ 4. tiempo agotado (el proveedor SÍ certificó): por_verificar BLOQUEA; consultar al proveedor concilia
  await enviar("timeout_despues"); await p.waitForSelector('[data-estado="por_verificar"]');
  assert.match(await estadoFiscal(), /Por verificar/); assert.equal(await p.locator("#enviar").count(), 0, "no hay botón de envío con un resultado desconocido"); assert.match(await p.locator("#motivo-sin-envio").innerText(), /Bloqueado/);
  assert.match(await p.locator('[data-panel="linea-tiempo"]').innerText(), /Sin respuesta utilizable \(tiempo agotado\)/); await foto("04-por-verificar.png");
  const d1 = await api("GET", `/api/documentos/${idMarta}`); const bad = await api("POST", `/api/documentos/${idMarta}/certificar`, { clave: "otra-clave-0123456789", escenario: "exito" });
  assert.match(bad.mensaje, /concilia/i, "el servidor también bloquea un reintento con otra clave"); assert.equal(d1.operaciones.length, 1);
  await p.click("#consultar"); await toast("certificado (simulación)"); await p.waitForSelector('[data-estado="certificado"]');
  assert.match(await p.locator('[data-estado="certificado"]').innerText(), /SIM-/); assert.match(await p.locator('[data-estado="certificado"]').innerText(), /NO son de SAT/);
  for (const tipo of ["xml", "pdf"]) { const [dl] = await Promise.all([p.waitForEvent("download"), p.click(`[data-archivo="${tipo}"]`)]); const f = await dl.path(); const txt = fs.readFileSync(f).toString("latin1"); assert.match(txt, /SIMULADO - SIN VALOR FISCAL/, `${tipo} marcado`); assert.match(dl.suggestedFilename(), /^SIMULADO-/); }
  await p.click('button:has-text("Ver documento")'); await p.waitForSelector('[data-vista="previa"]'); assert.match(await p.locator('[data-vista="previa"]').innerText(), /certificada en SIMULACIÓN/); assert.match(await p.locator('[data-vista="previa"]').innerText(), /Autorización SIM-/);
  await foto("05-certificado-simulado.png"); await p.keyboard.press("Escape");
  const fin1 = await api("GET", `/api/documentos/${idMarta}`); assert.equal(fin1.documento.estado_fiscal, "certificado"); assert.equal(fin1.operaciones.filter((o) => o.enviada_en).length, 1, "un solo envío al proveedor");

  // ============ 5. doble clic: una sola operación
  await como("ana"); const id2 = await crear("Producto doble clic", "1", "50"); await revisar();
  await p.selectOption('select[aria-label="Comportamiento del proveedor simulado"]', "exito"); await p.locator("#enviar").dblclick(); await p.waitForSelector('[data-estado="certificado"]');
  assert.equal((await api("GET", `/api/documentos/${id2}`)).operaciones.length, 1, "doble clic = una sola operación");

  // ============ 6. respuesta tardía: indeterminado → sigue bloqueado → el proveedor procesa → conciliar certifica
  const id3 = await crear("Producto tardío", "1", "75"); await revisar(); await enviar("timeout_tardio"); await p.waitForSelector('[data-estado="por_verificar"]');
  await p.click("#consultar"); await toast("no puede confirmar ni descartar"); assert.equal(await p.locator("#enviar").count(), 0);
  await abrirDemo(); await p.click("#demo-tardios"); await toast("procesó las solicitudes tardías");
  await p.click("#consultar"); await p.waitForSelector('[data-estado="certificado"]');
  const f3 = await api("GET", `/api/documentos/${id3}`); assert.equal(f3.operaciones.filter((o) => o.enviada_en).length, 1);

  // ============ 7. sin forma de saberlo → conciliación manual de DOS personas → auditoría antes de reintentar
  const id4 = await crear("Producto indeterminado", "1", "30"); await revisar(); await enviar("timeout_indeterminado"); await p.waitForSelector('[data-estado="por_verificar"]');
  assert.equal(await p.locator("#proponer").count(), 0, "la vía manual exige que el proveedor responda «indeterminado» antes"); await p.click("#consultar"); await toast("no puede confirmar ni descartar"); await p.waitForSelector("#proponer");
  await p.fill('input[aria-label="Referencia de la consulta"]', "consulta-portal-0001"); await p.click("#proponer"); await toast("la debe aprobar otra persona"); await p.waitForSelector('[data-estado="propuesta"]');
  assert.equal(await p.locator("#aprobar").isDisabled(), true, "quien propone no aprueba"); assert.match(await p.locator('[data-estado="propuesta"]').innerText(), /otra persona/);
  assert.match((await api("POST", `/api/conciliaciones/${(await api("GET", `/api/documentos/${id4}`)).conciliaciones[0].id}/decidir`, { aprobar: true, nota: "x" }, "ana")).mensaje, /otra persona/);
  await como("luis"); await abrir(id4); assert.equal(await p.locator("#aprobar").isDisabled(), false); await foto("06-conciliacion-manual.png"); await p.click("#aprobar"); await toast("Conciliación aprobada"); await p.waitForSelector('[data-estado="rechazado"]');
  await como("ana"); await abrir(id4); await p.selectOption('select[aria-label="Comportamiento del proveedor simulado"]', "exito"); await p.click("#enviar");
  await p.waitForSelector(".err:has-text('comprobación del proveedor')"); assert.equal((await api("GET", `/api/documentos/${id4}`)).operaciones.length, 1, "no se creó otra operación");
  await abrirDemo(); await p.click("#demo-auditar"); await toast("Auditoría hecha"); await p.click("#enviar"); await p.waitForSelector('[data-estado="certificado"]');
  assert.equal((await api("GET", `/api/documentos/${id4}`)).operaciones.length, 2);

  // ============ 8. respuesta tardía tras conciliación manual → alerta (certificación huérfana) que bloquea
  const id5 = await crear("Producto huérfano", "1", "20"); await revisar(); await enviar("timeout_tardio"); await p.waitForSelector('[data-estado="por_verificar"]'); await p.click("#consultar"); await toast("no puede confirmar"); await p.waitForSelector("#proponer");
  await p.fill('input[aria-label="Referencia de la consulta"]', "consulta-portal-0002"); await p.click("#proponer"); await p.waitForSelector('[data-estado="propuesta"]');
  await como("luis"); await abrir(id5); await p.click("#aprobar"); await p.waitForSelector('[data-estado="rechazado"]');
  await abrirDemo(); await p.click("#demo-tardios"); await toast("procesó las solicitudes tardías"); await p.click("#demo-auditar"); await toast("certificación huérfana");
  await abrir(id5); await p.waitForSelector('[data-estado="alerta"]'); assert.equal(await p.locator("#enviar").count(), 0); await foto("07-alerta-huerfana.png");
  assert.equal((await api("GET", `/api/documentos/${id5}`)).operaciones.filter((o) => o.enviada_en).length, 1, "jamás se reenvió");
  await como("ana"); await abrir(id5); await p.fill('input[aria-label="Nota de resolución"]', "Se anuló la certificación huérfana con el proveedor"); await p.click('button:has-text("Resolver alerta")'); await toast("Alerta resuelta");

  // ============ 9. caídas del proceso y recuperación sin reenviar
  const id6 = await crear("Caída antes de enviar", "1", "10"); await revisar();
  await abrirDemo(); await p.selectOption('select[aria-label="Punto de la caída"]', "a");
  await p.click("#demo-caida"); await toast("El proceso se cayó"); await p.waitForSelector('[data-estado="pendiente"]');
  await abrirDemo(); await p.click("#demo-recuperar"); await toast("1 liberadas sin envío");
  await p.waitForSelector('[data-estado="rechazado"]'); assert.match(await p.locator('[data-panel="linea-tiempo"]').innerText(), /se probó que nunca se envió/);
  await p.selectOption('select[aria-label="Comportamiento del proveedor simulado"]', "exito"); await p.click("#enviar"); await p.waitForSelector('[data-estado="certificado"]');
  const id7 = await crear("Caída tras enviar", "1", "11"); await revisar();
  await abrirDemo(); await p.selectOption('select[aria-label="Punto de la caída"]', "c"); await p.click("#demo-caida"); await toast("El proceso se cayó");
  await abrirDemo(); await p.click("#demo-recuperar"); await toast("1 resueltas"); await p.waitForSelector('[data-estado="certificado"]');
  assert.equal((await api("GET", `/api/documentos/${id7}`)).operaciones.filter((o) => o.enviada_en).length, 1, "la recuperación no reenvía");

  // ============ 10. canal asistido (futuro Playwright)
  const id8 = await crear("Canal asistido", "1", "12"); await revisar(); await enviar("accion_humana"); await p.waitForSelector('[data-estado="pendiente"]');
  assert.match(await p.locator('[data-estado="pendiente"]').innerText(), /persona/); await p.click("#completar-humana"); await p.waitForSelector('[data-estado="certificado"]');
  await foto("08-lista-final.png"); await p.goto(srv.url); await p.waitForSelector(".fila-fac"); assert.ok(await p.locator(".fila-fac").count() >= 8); await foto("09-lista.png");

  // ============ 11. móvil: sin desborde horizontal, aviso visible, flujo utilizable
  const movil = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-GT" });
  await movil.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); const m = await movil.newPage(); m.on("pageerror", (e) => errores.push(`pageerror(móvil): ${e.message}`));
  for (const ruta of ["/", "/#/nueva", `/#/f/${id8}`, `/#/f/${idMarta}`]) { await m.goto(srv.url + ruta); await m.waitForSelector(".cab-demo"); await m.waitForTimeout(400); await banda(m);
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `desborde horizontal en móvil: ${ruta}`); await foto(`m-${ruta.replace(/[^a-z0-9]/gi, "_")}.png`, m); }
  await movil.close();

  assert.deepEqual(errores, [], `errores en el navegador:\n${errores.join("\n")}`);
  await nav.close(); srv.parar(); console.log("DEMOSTRACIÓN E2E OK");
})().catch((e) => { console.error(e); process.exit(1); });
