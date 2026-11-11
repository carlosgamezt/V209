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
    await p.click("#paso-siguiente");
    await p.fill('input[aria-label="Descripción de la línea 1"]', desc); await p.fill('input[aria-label="Cantidad de la línea 1"]', cant); await p.fill('input[aria-label="Precio de la línea 1"]', precio);
    await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); return p.url().split("/").pop();
  };
  const abrirDemo = async () => { const d = p.locator('details.demo-controles'); await p.waitForLoadState("networkidle");   // tolera un repintado de la acción anterior: reabre hasta que quede abierto de forma estable
    for (let n = 0; n < 20; n++) { await d.evaluate((x) => { x.open = true; }); await p.waitForTimeout(150); if (await p.locator('details.demo-controles[open]').count()) return; } throw new Error("no se pudieron abrir los controles de la demostración"); };
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
  assert.equal(await p.locator("li.paso").count(), 3, "tres pasos: datos, ítems, vista previa"); await p.click("#paso-siguiente"); await p.waitForSelector('input[aria-label="Descripción de la línea 1"]');
  await p.click('button:has-text("Agregar ítem")'); assert.equal(await p.locator(".ln:not(.ln-cab)").count(), 2);
  await p.fill('input[aria-label="Cantidad de la línea 2"]', "abc"); await p.click("#guardar"); assert.match(await p.locator(".validacion").innerText(), /Línea 2: la cantidad/);
  await p.click('button[aria-label="Quitar la línea 2"]'); assert.equal(await p.locator(".ln:not(.ln-cab)").count(), 1);
  await p.selectOption('select[aria-label="Tipo de descuento de la línea 1"]', "porcentaje"); await p.fill('input[aria-label="Valor del descuento de la línea 1"]', "150"); await p.click("#guardar"); assert.match(await p.locator(".validacion").innerText(), /no puede superar 100/);
  await p.fill('input[aria-label="Valor del descuento de la línea 1"]', "10");
  await p.fill('input[aria-label="Descripción de la línea 1"]', "Servicio de consultoría"); await p.fill('input[aria-label="Cantidad de la línea 1"]', "2"); await p.fill('input[aria-label="Precio de la línea 1"]', "100");
  assert.match(await p.locator(".totales").innerText(), /Q 180\.00/, "base imponible = 2 × 100 − 10 %");
  await p.click('[data-ir-paso="1"]'); await p.waitForSelector('select[aria-label="Receptor"]');
  await p.check('input[aria-label="Receptor nuevo"]'); await p.selectOption('select[aria-label="Tipo de identificación"]', "NIT");
  await p.fill('input[aria-label="Identificación del receptor"]', "5550001-2"); await p.fill('input[aria-label="Nombre del receptor"]', "Cliente nuevo de prueba (ficticio)");
  const est = await p.locator('select[aria-label="Establecimiento"] option', { hasText: "Sucursal" }).getAttribute("value"); await p.selectOption('select[aria-label="Establecimiento"]', est);
  await foto("02-editor-con-validaciones.png");
  await p.click("#guardar"); await p.waitForURL(/#\/f\/[0-9a-f-]{36}$/); await p.waitForSelector(".doc-cab"); await toast("guardado");
  const idMarta = p.url().split("/").pop(); assert.match(await p.locator(".doc-cab h1").innerText(), /BR-0001/);
  assert.equal(await p.locator('button:has-text("Marcar como revisado")').count(), 0, "el emisor no revisa");
  assert.match(await p.locator("#motivo-sin-envio").innerText(), /revisado/);
  await p.click('button:has-text("Vista previa")'); await p.waitForSelector('[data-vista="previa"]'); assert.match(await p.locator('[data-vista="previa"]').innerText(), /SIMULADO - SIN VALOR FISCAL/); assert.match(await p.locator('[data-vista="previa"]').innerText(), /Observaciones/); assert.match(await p.locator('[data-vista="previa"]').innerText(), /Correo/); assert.match(await p.locator('[data-vista="previa"]').innerText(), /Cliente nuevo de prueba/);
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

  // ============ 10b. clientes, conceptos y configuración (datos reales de la base; permisos por persona)
  await como("ana"); await p.goto(`${srv.url}/#/clientes`); await p.waitForSelector(".indicadores");
  assert.match(await p.locator(".indicadores").innerText(), /Clientes registrados/); assert.ok(await p.locator('[data-cliente]').count() <= 5, "máximo 5 por página");
  await p.fill('input[aria-label="Buscar clientes"]', "Tornillo"); assert.equal(await p.locator('[data-cliente]').count(), 1); await p.fill('input[aria-label="Buscar clientes"]', "");
  assert.ok(await p.locator(".pag-b").count() >= 3, "hay paginación con más de 5 clientes"); await foto("10-clientes.png");
  const [csv] = await Promise.all([p.waitForEvent("download"), p.click('button[aria-label="Descargar clientes en CSV"]')]); assert.match(fs.readFileSync(await csv.path(), "utf8"), /Comercial Los Pinos/);
  { await api("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "8880001-1", nombre: "Cliente con correo largo (ficticio)", email: "departamento.de.facturacion.electronica.muy.largo@subdominio-de-prueba.empresa-ficticia.example" });
    await p.reload(); await p.waitForSelector("[data-correo]"); await p.fill('input[aria-label="Buscar clientes"]', "correo largo"); const c = p.locator('[data-correo="8880001-1"]'); await c.waitFor();
    const m = await c.evaluate((el) => ({ trunc: el.scrollWidth > el.clientWidth, alto: el.getBoundingClientRect().height, estilo: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace }));
    assert.equal(m.trunc, true, "el correo largo se trunca"); assert.equal(m.estilo, "ellipsis"); assert.equal(m.ws, "nowrap"); assert.ok(m.alto < 30, "el correo no se parte en varias líneas");
    assert.match(await c.getAttribute("title"), /departamento\.de\.facturacion/, "el correo completo está en el título"); await foto("14-correo-truncado.png"); await c.click(); await p.waitForSelector('[data-correo-completo]'); assert.equal(await p.locator('[data-correo-completo]').innerText(), "departamento.de.facturacion.electronica.muy.largo@subdominio-de-prueba.empresa-ficticia.example"); await p.keyboard.press("Escape"); await p.fill('input[aria-label="Buscar clientes"]', ""); }
  await p.click("#nuevo-cliente"); await p.fill('input[aria-label="Identificación del cliente"]', "9990001-3"); await p.fill('input[aria-label="Nombre del cliente"]', "Cliente del catálogo (ficticio)"); await p.click("#guardar-cliente"); await toast("Cliente creado");
  await p.fill('input[aria-label="Buscar clientes"]', "catálogo"); assert.equal(await p.locator('[data-cliente="9990001-3"]').count(), 1);
  await p.click("#nuevo-cliente"); await p.fill('input[aria-label="Identificación del cliente"]', "9990001-3"); await p.fill('input[aria-label="Nombre del cliente"]', "Repetido"); await p.click("#guardar-cliente"); await p.waitForSelector(".modal .err:has-text('Ya existe')"); await p.keyboard.press("Escape");
  await p.goto(`${srv.url}/#/conceptos`); await p.waitForSelector("[data-concepto]"); assert.ok(await p.locator("[data-concepto]").count() >= 4);
  await p.click("#nuevo-concepto"); await p.fill('input[aria-label="Código del concepto"]', "SERV-900"); await p.fill('input[aria-label="Descripción del concepto"]', "Concepto de prueba"); await p.fill('input[aria-label="Precio sugerido"]', "77.5"); await p.click("#guardar-concepto"); await toast("Concepto creado");
  await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]'); await p.click("#paso-siguiente");
  await p.selectOption('select[aria-label="Agregar un concepto del catálogo"]', await p.locator('select[aria-label="Agregar un concepto del catálogo"] option', { hasText: "Concepto de prueba" }).getAttribute("value")); assert.equal(await p.inputValue('input[aria-label="Descripción de la línea 1"]'), "Concepto de prueba"); assert.equal(await p.inputValue('input[aria-label="Precio de la línea 1"]'), "77.5");
  await p.goto(`${srv.url}/#/config`); await p.waitForSelector(".tabs"); await p.waitForSelector(".tab-cuerpo .datos"); assert.match(await p.locator(".tab-cuerpo").innerText(), /Empresa activa/);
  for (const t of ["establecimientos", "canal", "numeracion", "impuestos", "preferencias"]) { await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(200); }
  await p.click('[data-tab="canal"]'); const canales = await p.locator(".tab-cuerpo").innerText(); assert.match(canales, /Habilitado · simulado/); assert.match(canales, /Bloqueado en esta fase/); assert.equal(await p.locator("input[type=password], input[aria-label*=Contraseña i], button:has-text('Probar conexión')").count(), 0, "sin campos de credenciales de SAT ni «Probar conexión»"); await foto("11-config-canal.png");
  await p.click('[data-tab="establecimientos"]'); await p.click("#nuevo-establecimiento"); await p.fill('input[aria-label="Código del establecimiento"]', "3"); await p.fill('input[aria-label="Nombre del establecimiento"]', "Bodega ficticia"); await p.click("#guardar-establecimiento"); await toast("Establecimiento creado"); await p.waitForSelector(`[data-establecimiento="3"]`);
  await como("pedro"); await p.goto(`${srv.url}/#/clientes`); await p.waitForSelector(".indicadores"); assert.equal(await p.locator("#nuevo-cliente").count(), 0, "el lector no crea clientes");
  assert.equal(await p.locator('a.nv:has-text("Nueva factura")').count(), 0, "el lector no ve «Nueva factura»");
  await p.goto(`${srv.url}/#/config`); await p.click('[data-tab="establecimientos"]'); assert.equal(await p.locator("#nuevo-establecimiento").count(), 0, "el lector no crea establecimientos");
  await como("ana");

  // ============ 10c. ajustes de la Fase 2: facturas (filtros, canal, estados simulados, acciones), clientes frecuentes y estado, conceptos, empresa y canales
  await como("ana");
  const idB = await crear("Borrador para la lista", "1", "5"); await p.goto(`${srv.url}/#/`); await p.waitForSelector(".fila-fac");
  assert.ok(await p.locator(".fila-fac").count() >= 9);
  const cert = p.locator('.fila-fac:has([data-simulado])').first(); assert.match(await cert.innerText(), /SIM · Certificado/); assert.match(await cert.innerText(), /Proveedor simulado/); assert.match(await cert.innerText(), /Q\s?[\d,]+\.\d\d/);
  await p.selectOption('select[aria-label="Estado de las facturas"]', "certificado"); const nCert = await p.locator(".fila-fac").count(); assert.ok(nCert >= 5 && await p.locator(".fila-fac:not(:has([data-simulado]))").count() === 0, "todas las certificadas se marcan como simuladas");
  await p.selectOption('select[aria-label="Estado de las facturas"]', "todas"); await p.fill('input[aria-label="Buscar facturas"]', "zzzz-no-existe"); await p.waitForSelector("text=Ninguna factura coincide"); await p.fill('input[aria-label="Buscar facturas"]', "Cliente del catálogo"); await p.fill('input[aria-label="Buscar facturas"]', "");
  const filaB = p.locator(".fila-fac", { hasText: "Borrador para la lista" }).first().or(p.locator(".fila-fac", { has: p.locator('[data-accion="revisar"]') }).first());
  assert.equal(await filaB.locator('[data-accion="continuar"]').count(), 1); assert.equal(await filaB.locator('[data-accion="revisar"]').count(), 1); assert.equal(await filaB.locator('[data-accion="consultar"]').count(), 1);
  assert.match(await filaB.innerText(), /Sin enviar/, "un borrador aún no tiene canal"); { const cajas = await p.evaluate(() => [...document.querySelectorAll(".fila-fac")].flatMap((f) => [...f.querySelectorAll(".acciones-fac > *")].map((b) => { const r = b.getBoundingClientRect(); return { slot: b.className.match(/slot-(\d)/)?.[1], w: Math.round(r.width), h: Math.round(r.height), izq: Math.round(r.left) }; })));
    assert.ok(cajas.length >= 10); assert.ok(cajas.every((c) => c.h === 34), "todos los botones de acción miden lo mismo de alto");
    for (const s of ["1", "2"]) assert.equal(new Set(cajas.filter((c) => c.slot === s).map((c) => c.w)).size, 1, `ranura ${s}: mismo ancho`); assert.equal(new Set(cajas.filter((c) => c.slot === "3").map((c) => c.izq)).size, 1, "el botón «Consultar» queda alineado en todas las filas"); assert.equal(new Set(cajas.filter((c) => c.slot === "1").map((c) => c.izq)).size, 1, "la acción principal queda alineada"); }
  await foto("12-facturas.png");
  await filaB.locator('[data-accion="revisar"]').click(); await p.click("#confirmar-revision"); await toast("marcado como revisado");
  await p.waitForSelector('.fila-fac [data-accion="enviar"]'); assert.equal(await api("GET", `/api/documentos/${idB}`).then((d) => d.documento.estado_preparacion), "revisado");
  const idV = await crear("Por verificar desde la lista", "1", "6"); await p.click('button:has-text("Marcar como revisado")'); await p.waitForSelector('.doc-cab .tag:has-text("Revisado")');
  await api("POST", `/api/documentos/${idV}/certificar`, { clave: "clave-lista-0123456789", escenario: "timeout_antes" }); await p.goto(`${srv.url}/#/`); await p.waitForSelector('.fila-fac [data-accion="resolver"]');
  assert.match(await p.locator(".fila-fac", { has: p.locator('[data-accion="resolver"]') }).first().innerText(), /Por verificar/);
  await p.locator('.fila-fac [data-accion="consultar"]').first().click(); await p.waitForSelector(".doc-cab");
  await como("marta"); await p.goto(`${srv.url}/#/`); await p.waitForSelector(".fila-fac"); assert.equal(await p.locator('[data-accion="revisar"]').count(), 0, "el emisor no revisa"); assert.equal(await p.locator('[data-accion="resolver"]').count(), 0, "el emisor no resuelve");
  await como("pedro"); await p.goto(`${srv.url}/#/`); await p.waitForSelector(".fila-fac"); for (const a of ["continuar", "revisar", "enviar", "resolver"]) assert.equal(await p.locator(`[data-accion="${a}"]`).count(), 0, `el lector no ve «${a}»`); assert.ok(await p.locator('[data-accion="consultar"]').count() >= 9);
  // clientes: frecuentes persistentes, orden al elegir receptor, edición, desactivar y reactivar
  await como("ana"); await p.goto(`${srv.url}/#/clientes`); await p.waitForSelector(".indicadores");
  await p.fill('input[aria-label="Buscar clientes"]', "Tornillo"); const estr = p.locator('[data-estrella="7654321-4"]'); assert.equal(await estr.getAttribute("aria-pressed"), "false"); await estr.click(); await p.waitForSelector('[data-estrella="7654321-4"][aria-pressed="true"]');
  await p.goto(`${srv.url}/#/clientes`); await p.reload(); await p.waitForSelector(".indicadores"); await p.fill('input[aria-label="Buscar clientes"]', "Tornillo"); assert.equal(await p.locator('[data-estrella="7654321-4"]').getAttribute("aria-pressed"), "true", "la marca persiste");
  await p.fill('input[aria-label="Buscar clientes"]', ""); await p.check('input[aria-label="Solo frecuentes"]'); const nf = await p.locator("[data-cliente]").count(); assert.ok(nf >= 3 && await p.locator('[data-cliente][data-cliente="CF"]').count() === 0); await p.uncheck('input[aria-label="Solo frecuentes"]');
  await p.fill('input[aria-label="Buscar clientes"]', "Consumidor"); assert.equal(await p.locator('[data-estrella="CF"]').isDisabled(), true, "el consumidor final no es frecuente"); await p.fill('input[aria-label="Buscar clientes"]', "");
  await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]'); const ops = await p.locator('select[aria-label="Receptor"] option').allInnerTexts(); assert.match(ops[1], /Comercial Los Pinos/, "los frecuentes salen primero"); assert.ok(ops.findIndex((t) => /Multiservicios/.test(t)) > ops.findIndex((t) => /Ferretería El Tornillo/.test(t)), "un no frecuente va después");
  await p.goto(`${srv.url}/#/clientes`); await p.waitForSelector(".indicadores"); await p.fill('input[aria-label="Buscar clientes"]', "5550001-2");
  await p.click('button[aria-label^="Editar Cliente nuevo de prueba"]'); await p.fill('input[aria-label="Correo del cliente"]', "no-es-correo"); await p.click("#guardar-cliente"); await p.waitForSelector(".modal .err:has-text('correo no es válido')");
  await p.fill('input[aria-label="Correo del cliente"]', "nuevo@cliente.example"); await p.fill('input[aria-label="Teléfono del cliente"]', "2200-7777"); await p.fill('input[aria-label="Nombre del cliente"]', "Cliente editado (ficticio)"); await p.click("#guardar-cliente"); await toast("Cliente actualizado");
  await p.fill('input[aria-label="Buscar clientes"]', "editado"); await p.waitForSelector('[data-cliente="5550001-2"]'); assert.match(await p.locator('[data-cliente="5550001-2"]').innerText(), /2200-7777/);
  await p.click('button[aria-label^="Editar Cliente editado"]'); await p.click("#estado-cliente"); await toast("Cliente desactivado"); await p.waitForTimeout(200); assert.equal(await p.locator('[data-cliente="5550001-2"]').count(), 0, "los inactivos se ocultan");
  await p.check('input[aria-label="Incluir inactivos"]'); assert.match(await p.locator('[data-cliente="5550001-2"]').innerText(), /Inactivo/); await p.click('button[aria-label^="Editar Cliente editado"]'); await p.click("#estado-cliente"); await toast("Cliente reactivado");
  await como("pedro"); await p.goto(`${srv.url}/#/clientes`); await p.waitForSelector(".indicadores"); assert.equal(await p.locator("[data-estrella]:not([disabled])").count(), 0, "el lector no cambia frecuentes"); assert.equal(await p.locator('button[aria-label^="Editar"]').count(), 0);
  // conceptos: edición, duplicado, desactivar (sale del catálogo al facturar) y reactivar
  await como("ana"); await p.goto(`${srv.url}/#/conceptos`); await p.waitForSelector("[data-concepto]");
  await p.click('button[aria-label="Editar Concepto de prueba"]'); await p.fill('input[aria-label="Precio sugerido"]', "abc"); await p.click("#guardar-concepto"); await p.waitForSelector(".modal .err:has-text('precio debe ser un número')");
  await p.fill('input[aria-label="Precio sugerido"]', "90.25"); await p.selectOption('select[aria-label="Tipo de concepto"]', "bien"); await p.click("#guardar-concepto"); await toast("Concepto actualizado"); await p.locator('[data-concepto="SERV-900"]', { hasText: /Q\s?90\.25/ }).waitFor();
  assert.match(await p.locator('[data-concepto="SERV-900"]').innerText(), /Bien/);
  await p.click("#nuevo-concepto"); await p.fill('input[aria-label="Código del concepto"]', "SERV-900"); await p.fill('input[aria-label="Descripción del concepto"]', "Duplicado"); await p.click("#guardar-concepto"); await p.waitForSelector(".modal .err:has-text('Ya existe')"); await p.keyboard.press("Escape");
  await p.click('button[aria-label="Editar Concepto de prueba"]'); await p.click("#estado-concepto"); await toast("Concepto desactivado"); await p.waitForTimeout(200); assert.equal(await p.locator('[data-concepto="SERV-900"]').count(), 0);
  await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]'); await p.click("#paso-siguiente"); assert.equal(await p.locator('select[aria-label="Agregar un concepto del catálogo"] option', { hasText: "Concepto de prueba" }).count(), 0, "un concepto inactivo no se ofrece al facturar");
  await p.goto(`${srv.url}/#/conceptos`); await p.check('input[aria-label="Incluir inactivos"]'); await p.click('button[aria-label="Editar Concepto de prueba"]'); await p.click("#estado-concepto"); await toast("Concepto reactivado");
  // empresa: edición con permiso, validación, solo lectura sin permiso, vista previa con los datos nuevos; datos fiscales intactos
  await p.goto(`${srv.url}/#/config`); await p.waitForSelector(".tab-cuerpo .datos"); assert.equal(await p.locator(".tab-cuerpo .aviso-azul").count(), 0, "sin avisos azules redundantes en Empresa"); assert.match(await p.locator(".tab-cuerpo").innerText(), /datos fiscales críticos/); assert.match(await p.locator(".tab-cuerpo .aviso-ambar").innerText(), /sin verificar/i); assert.equal(await p.locator(".tab-cuerpo .card").count(), 2);
  await p.fill('input[aria-label="Teléfono de la empresa"]', "2200-9999"); await p.fill('input[aria-label="Correo de facturación"]', "x"); await p.click("#guardar-empresa"); await p.waitForSelector(".err:has-text('correo no es válido')");
  await p.fill('input[aria-label="Correo de facturación"]', "nuevo@empresa-demo.example"); await p.fill('input[aria-label="Nombre comercial"]', "Empresa Demo Editada"); await p.click("#guardar-empresa"); await toast("Datos de la empresa guardados");
  const emp = await api("GET", "/api/configuracion"); assert.equal(emp.empresa.telefono, "2200-9999"); assert.equal(emp.empresa.nit, "7770001-0", "el NIT no cambia"); assert.match(emp.empresa.razon_social, /FICTICIA/, "la razón social no cambia");
  assert.match((await api("POST", "/api/empresa", { nombre_comercial: "Intento", telefono: "1" }, "marta")).mensaje, /permiso/i, "el emisor no edita la empresa");
  await p.goto(`${srv.url}/#/nueva`); await p.waitForSelector('select[aria-label="Receptor"]'); await p.click("#ver-previa"); await p.waitForSelector('[data-vista="previa"]'); assert.match(await p.locator('[data-vista="previa"]').innerText(), /2200-9999/, "la vista previa usa los datos guardados");
  await como("marta"); await p.goto(`${srv.url}/#/config`); await p.waitForSelector(".tab-cuerpo .datos"); assert.equal(await p.locator('input[aria-label="Teléfono de la empresa"]').isDisabled(), true); assert.equal(await p.locator("#guardar-empresa").count(), 0);
  // canales: Playwright principal previsto, Digifact secundario, agente sin conexión simulada, activación real bloqueada
  await como("ana"); await p.goto(`${srv.url}/#/config`); await p.waitForSelector(".tabs"); await p.click('[data-tab="canal"]'); await p.waitForSelector('[data-canal="portal_playwright"]');
  assert.match(await p.locator('[data-canal="portal_playwright"]').innerText(), /Principal previsto/); assert.match(await p.locator('[data-canal="portal_playwright"]').innerText(), /Bloqueado en esta fase/); assert.match(await p.locator('[data-canal="digifact"]').innerText(), /Secundario previsto/); assert.match(await p.locator('[data-canal="mock"]').innerText(), /Habilitado · simulado/);
  assert.equal(await p.locator("[data-panel=agente] [data-estado-agente]").innerText(), "No registrado"); assert.equal(await p.locator("[data-panel=agente] .tag").count(), 1, "solo el estado actual; los futuros no se muestran"); assert.doesNotMatch(await p.locator("[data-panel=agente]").innerText(), /Conectado|Sin conexión|Sesión/, "sin estados de conexión simulados");
  assert.equal(await p.locator("#registrar-agente").isDisabled(), true); assert.equal(await p.locator("#activar-canal-real").isDisabled(), true); await foto("13-canales-agente.png");
  assert.equal((await api("GET", "/api/configuracion")).canales.filter((c) => c.habilitado && c.proveedor_id !== "mock").length, 0, "ningún canal real habilitado");

  // ============ 11. móvil: sin desborde horizontal, aviso visible, flujo utilizable
  const movil = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-GT" });
  await movil.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); const m = await movil.newPage(); m.on("pageerror", (e) => errores.push(`pageerror(móvil): ${e.message}`));
  for (const ruta of ["/", "/#/nueva", `/#/f/${id8}`, `/#/f/${idMarta}`, "/#/clientes", "/#/conceptos", "/#/config", "/#/config"]) { await m.goto(srv.url + ruta); await m.waitForSelector(".cab-demo"); await m.waitForTimeout(400); await banda(m);
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `desborde horizontal en móvil: ${ruta}`); await foto(`m-${ruta.replace(/[^a-z0-9]/gi, "_")}.png`, m); }
  { const mm = await movil.newPage(); mm.on("pageerror", (e) => errores.push(`pageerror(móvil2): ${e.message}`));
    for (const [ruta, sel] of [["/#/", ".fila-fac"], ["/#/clientes", "[data-cliente]"], ["/#/conceptos", "[data-concepto]"]]) { await mm.goto(srv.url + ruta); await mm.waitForSelector(sel); await mm.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await mm.waitForTimeout(250);
      const g = await mm.evaluate((s) => { const nav = document.querySelector(".nav-movil").getBoundingClientRect(), ult = [...document.querySelectorAll(s)].pop().getBoundingClientRect(), pie = document.querySelector(".pie-demo").getBoundingClientRect(); return { navTop: nav.top, ultimaBase: ult.bottom, pieBase: pie.bottom }; }, sel);
      assert.ok(g.ultimaBase <= g.navTop + 0.5, `${ruta}: la última tarjeta queda por encima de la barra inferior (${JSON.stringify(g)})`); assert.ok(g.pieBase <= g.navTop + 0.5, `${ruta}: el pie queda visible sobre la barra inferior`);
      if (ruta === "/#/" && capturas) await mm.screenshot({ path: path.join(capturas, "m-facturas-final-scroll.png") }); }
    await mm.close(); }
  await movil.close();

  assert.deepEqual(errores, [], `errores en el navegador:\n${errores.join("\n")}`);
  await nav.close(); srv.parar(); console.log("DEMOSTRACIÓN E2E OK");
})().catch((e) => { console.error(e); process.exit(1); });
