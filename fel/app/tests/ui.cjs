// Prueba de interfaz de NEXA FEL (modo demostración, sin red ni credenciales). Uso: node ui.cjs [carpeta-de-capturas]
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
const { servirEstaticos } = require("./comun.cjs");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (capturas) fs.mkdirSync(capturas, { recursive: true });

(async () => {
  const { servidor, base } = await servirEstaticos();
  const navegador = await chromium.launch();
  const errores = [];
  const nueva = async (opts) => {
    const ctx = await navegador.newContext({ deviceScaleFactor: 2, locale: "es-GT", ...opts });
    // Las fuentes de Google no se descargan en el entorno de pruebas (sin red): se ignoran.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
    await p.goto(base); await p.waitForSelector(".shell");
    return p;
  };
  const foto = async (p, nombre, o = {}) => { assert.doesNotMatch(await p.locator("body").innerText(), /\bnull\b|\bundefined\b|\[object /, `texto interno visible en ${nombre}`); await p.evaluate((completa) => { document.getElementById("toasts").replaceChildren(); document.querySelectorAll(".nav-movil").forEach((n) => { n.style.visibility = completa ? "hidden" : ""; }); document.querySelectorAll(".barra-acciones").forEach((n) => { n.style.position = completa ? "static" : ""; }); }, !!o.fullPage); if (capturas) await p.screenshot({ path: path.join(capturas, nombre), ...o }); };
  const sinDesbordeHorizontal = async (p, donde) => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `desborde horizontal en ${donde}`);

  // ================= escritorio · propietario
  const p = await nueva({ viewport: { width: 1360, height: 860 } });
  await p.waitForSelector(".fila:not(.fila-cab)");
  assert.equal(await p.locator(".fila:not(.fila-cab)").count(), 5, "5 clientes activos de ejemplo");
  assert.equal(await p.locator("text=Servicios Gráficos Aurora").count(), 0, "el inactivo no se muestra");
  await foto(p, "01-clientes-escritorio.png");
  // buscar
  await p.fill('input[type=search]', "pinos"); await p.waitForTimeout(400);
  assert.equal(await p.locator(".fila:not(.fila-cab)").count(), 1);
  await p.fill('input[type=search]', ""); await p.waitForTimeout(400);
  // crear cliente
  await p.click("text=Nuevo cliente"); await p.waitForSelector(".modal");
  await p.selectOption('select[name=tipo]', "NIT"); await p.fill('input[name=numero]', "5551234-6"); await p.fill('input[name=nombre]', "Panadería La Espiga");
  await p.fill('input[name=email]', "mal-correo"); await p.click(".modal .btn-pri"); await p.waitForSelector(".modal .err:not(:empty)");
  await foto(p, "02-cliente-formulario-error.png");
  await p.fill('input[name=email]', "hola@espiga.example"); await p.click(".modal .btn-pri"); await p.waitForSelector(".modal", { state: "detached" });
  await p.waitForSelector("text=Panadería La Espiga");
  // identificación duplicada
  await p.click("text=Nuevo cliente"); await p.fill('input[name=numero]', "5551234-6"); await p.fill('input[name=nombre]', "Otro"); await p.click(".modal .btn-pri");
  await p.waitForSelector("text=Ya existe un cliente con esa identificación"); await p.keyboard.press("Escape");
  // CF fuerza el número
  await p.click("text=Nuevo cliente"); await p.selectOption('select[name=tipo]', "CF");
  assert.equal(await p.inputValue('input[name=numero]'), "CF"); assert.equal(await p.locator('input[name=numero]').isDisabled(), true); await p.keyboard.press("Escape");
  // desactivar y mostrar inactivos
  await p.click('button[aria-label="Desactivar Panadería La Espiga"]'); await p.waitForSelector("text=Panadería La Espiga", { state: "detached" });
  await p.check('.check input'); await p.waitForSelector("text=Panadería La Espiga"); await p.uncheck('.check input');

  // ================= conceptos
  await p.click('a.nv:has-text("Conceptos")'); await p.waitForSelector("text=Consultoría administrativa");
  assert.equal(await p.locator(".fila:not(.fila-cab)").count(), 7);
  assert.ok(await p.locator("text=Q 28.333333").count() >= 1, "el precio con 6 decimales se muestra exacto, sin redondeo");
  await foto(p, "03-conceptos-escritorio.png");
  await p.click("text=Nuevo concepto"); await p.fill('.modal input >> nth=0', "SRV-100"); await p.fill('.modal input >> nth=1', "Auditoría interna");
  await p.fill('.modal input[inputmode=decimal]', "1,5"); await p.click(".modal .btn-pri"); await p.waitForSelector(".modal .err:not(:empty)");
  await p.fill('.modal input[inputmode=decimal]', "1500.5"); await p.click(".modal .btn-pri"); await p.waitForSelector("text=Auditoría interna");
  await p.click("text=Nuevo concepto"); await p.fill('.modal input >> nth=0', "SRV-100"); await p.fill('.modal input >> nth=1', "Duplicado"); await p.fill('.modal input[inputmode=decimal]', "1");
  await p.click(".modal .btn-pri"); await p.waitForSelector("text=Ya existe un concepto con ese código"); await p.keyboard.press("Escape");

  // ================= borradores
  await p.click('a.nv:has-text("Borradores")'); await p.waitForSelector("text=BR-0004");
  assert.equal(await p.locator(".fila-doc:not(.fila-cab)").count(), 4);
  assert.ok(await p.locator("text=NO certificada").count() >= 1);
  await foto(p, "04-borradores-lista-escritorio.png");
  await p.click("text=Nuevo borrador"); await p.waitForSelector(".lineas");
  await p.locator('select[aria-label=Cliente]').selectOption({ label: "Ferretería El Tornillo — NIT 7654321-K" });
  await p.locator('select[aria-label="Concepto de la línea 1"]').selectOption({ label: "PRD-001 · Resma de papel bond carta" });
  await p.fill('input[aria-label="Cantidad de la línea 1"]', "10");
  await p.click("text=Agregar línea");
  await p.fill('input[aria-label="Descripción de la línea 2"]', "Servicio especial"); await p.fill('input[aria-label="Cantidad de la línea 2"]', "3"); await p.fill('input[aria-label="Precio de la línea 2"]', "0.1");
  await p.locator('select[aria-label="Tipo de descuento de la línea 2"]').selectOption("porcentaje"); await p.fill('input[aria-label="Valor del descuento de la línea 2"]', "10");
  const tot = await p.locator(".totales").innerText();
  assert.match(tot, /Subtotal\s*Q 427\.80/, "10 × 42.75 + 3 × 0.1 = 427.80 exacto");
  assert.match(tot, /Descuentos\s*Q 0\.03/); assert.match(tot, /Base imponible\s*Q 427\.77/);
  assert.match(tot, /Impuestos y total: pendientes/); assert.match(tot, /Vista previa NO certificada/); assert.match(tot, /Vacío hasta confirmación verificable/);
  assert.doesNotMatch(tot, /IVA|12 ?%/i, "no se aplica ninguna tasa");
  await foto(p, "05-editor-borrador-escritorio.png", { fullPage: true });
  // dato inválido bloquea el guardado
  await p.fill('input[aria-label="Cantidad de la línea 1"]', "1e3"); assert.match(await p.locator(".totales").innerText(), /deben ser números/);
  await p.fill('input[aria-label="Cantidad de la línea 1"]', "10");
  await p.click("text=Guardar borrador"); await p.waitForSelector("text=BR-0005"); await p.waitForSelector(".sucio", { state: "detached" });
  assert.equal(await p.locator("text=Marcar como revisado").isDisabled(), false);
  await p.click("text=Marcar como revisado"); await p.waitForSelector("text=Volver a borrador");
  assert.equal(await p.locator('input[aria-label="Cantidad de la línea 1"]').isDisabled(), true, "revisado es de solo lectura");
  await foto(p, "06-editor-revisado-solo-lectura.png", { fullPage: true });
  await p.click("text=Archivar"); await p.click(".modal .btn-pri"); await p.waitForSelector("text=al menos 5 caracteres");
  await p.fill(".modal textarea", "Cliente pidió cambios"); await p.click(".modal .btn-pri"); await p.waitForSelector("text=Restaurar como borrador");
  assert.equal(await p.locator("text=No es una anulación").count(), 0, "el diálogo ya se cerró");
  await p.click("text=Restaurar como borrador"); await p.waitForSelector("text=Guardar cambios");
  await p.click("text=Volver"); await p.waitForSelector("text=BR-0005");

  // ================= usuarios (modo demostración, propietario)
  await p.click('aside a.nv:has-text("Usuarios")'); await p.waitForSelector("text=Ana Gómez");
  assert.deepEqual(await p.locator(".tabs a").allInnerTexts(), ["Usuarios", "Invitaciones", "Roles y permisos", "Recuperación de acceso"]);
  assert.equal(await p.locator(".fila-usr:not(.fila-cab)").count(), 5);
  assert.equal(await p.locator('button[aria-label^="Cambiar rol y permisos de demo@"]').count(), 0, "uno no se edita a sí mismo");
  await foto(p, "23-usuarios-escritorio.png");
  // editar: Luis (emisor) → se le quita un permiso del rol y se le da uno extra
  await p.click('button[aria-label="Cambiar rol y permisos de luis.perez@distribuidora.example"]'); await p.waitForSelector(".rejilla-permisos");
  assert.equal(await p.locator('input[aria-label="usuarios.gestionar"]').isChecked(), false);
  await p.check('input[aria-label="usuarios.ver"]'); await p.uncheck('input[aria-label="clientes.escribir"]');
  assert.ok(await p.locator(".permiso-extra").count() >= 1 && await p.locator(".permiso-quitado").count() >= 1, "se distinguen extra y quitado");
  await foto(p, "24-usuarios-editar-permisos.png");
  await p.click(".modal .btn-pri"); await p.waitForSelector("text=Cambios guardados"); await p.waitForSelector("text=+2 extra");
  // desactivar a Eva y reactivarla
  await p.click('button[aria-label="Desactivar a eva.morales@distribuidora.example"]'); await p.waitForSelector("text=Persona desactivada");
  await p.waitForSelector(".fila-usr.inactivo >> text=Eva Morales"); await p.click('button[aria-label="Reactivar a eva.morales@distribuidora.example"]'); await p.waitForSelector("text=Persona reactivada");
  // invitaciones: se explican las dos cosas distintas
  await p.click('.tabs a:has-text("Invitaciones")'); await p.waitForSelector("text=Dos cosas distintas"); await p.waitForSelector("text=Correo de cuenta (Supabase Auth)");
  assert.equal(await p.locator(".fila-inv:not(.fila-cab)").count(), 5);
  await foto(p, "25-invitaciones-escritorio.png");
  await p.click("text=Invitar a la empresa"); await p.fill('input[aria-label="Correo de la persona"]', "no-es-correo"); await p.click(".modal .btn-pri"); await p.waitForSelector(".modal .err:not(:empty)");
  await p.fill('input[aria-label="Correo de la persona"]', "carla.soto@distribuidora.example"); await p.click(".modal .btn-pri"); await p.waitForSelector("text=Ya existe un registro con esos datos"); await p.fill('input[aria-label="Correo de la persona"]', "nueva.persona@example.com");
  await p.click(".modal .btn-pri"); await p.waitForSelector("text=Invitación registrada"); await p.waitForSelector("text=nueva.persona@example.com");
  await p.click('button[aria-label="Revocar la invitación de nueva.persona@example.com"]'); await p.waitForSelector("text=Invitación revocada");
  // roles y permisos: matriz de solo lectura
  await p.click('.tabs a:has-text("Roles y permisos")'); await p.waitForSelector("table.matriz");
  assert.equal(await p.locator('td[aria-label="usuarios.gestionar para Lector: no"]').count(), 1); assert.equal(await p.locator('td[aria-label="usuarios.gestionar para Propietario: sí"]').count(), 1);
  assert.equal(await p.locator('td[aria-label="clientes.escribir para Emisor: sí"]').count(), 1);
  await foto(p, "26-roles-y-permisos.png");
  // recuperación de acceso: exige evidencia y confirmación
  await p.click('.tabs a:has-text("Recuperación de acceso")'); await p.waitForSelector("text=Cuando alguien pierde su dispositivo TOTP");
  await foto(p, "27-recuperacion-de-acceso.png");
  await p.click("text=Revisar"); await p.click(".modal .btn-peligro"); await p.waitForSelector("text=Confirma que verificaste la identidad");
  await p.check('input[aria-label="Confirmo la verificación"]'); await p.click(".modal .btn-peligro"); await p.waitForSelector("text=mínimo 20 caracteres");
  await p.fill('textarea[aria-label="Cómo verificaste su identidad"]', "Videollamada con documento en mano; confirmé nombre y cargo."); await p.click(".modal .btn-peligro");
  await p.waitForSelector("text=Recuperación aplicada"); await p.waitForSelector("text=Sin solicitudes");

  // ================= roles
  await p.selectOption('select[aria-label="Rol de demostración"]', "lector");
  await p.waitForSelector('aside a.nv[href="#/usuarios"]', { state: "detached" });
  await p.waitForSelector("text=Nuevo borrador", { state: "detached" }); // el lector no crea borradores
  await p.click('a.nv:has-text("Clientes")'); await p.waitForSelector("text=Tu rol solo permite consultar clientes");
  assert.equal(await p.locator("text=Nuevo cliente").count(), 0); assert.equal(await p.locator('button[aria-label^="Editar"]').count(), 0);
  await foto(p, "07-lector-solo-consulta.png");
  await p.selectOption('select[aria-label="Rol de demostración"]', "emisor"); await p.click('a.nv:has-text("Borradores")'); await p.click("text=BR-0001");
  await p.waitForSelector("text=Volver"); assert.equal(await p.locator("text=Archivar").count(), 0, "el emisor no archiva"); assert.equal(await p.locator("text=Marcar como revisado").count(), 0, "el emisor no revisa");
  await sinDesbordeHorizontal(p, "escritorio");
  await p.context().close();

  // ================= móvil
  const m = await nueva({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.waitForSelector(".fila:not(.fila-cab)"); await sinDesbordeHorizontal(m, "clientes móvil");
  assert.equal(await m.locator(".nav-movil .nv").count(), 4); await foto(m, "08-clientes-movil.png");
  await m.click('.nav-movil a:has-text("Borradores")'); await m.waitForSelector("text=BR-0004"); await sinDesbordeHorizontal(m, "borradores móvil"); await foto(m, "09-borradores-movil.png");
  await m.click("text=Nuevo borrador"); await m.waitForSelector(".lineas"); await sinDesbordeHorizontal(m, "editor móvil"); await foto(m, "10-editor-movil.png", { fullPage: true });
  await m.context().close();

  // ================= modo oscuro (respeta la preferencia del sistema)
  const o = await nueva({ viewport: { width: 1360, height: 860 }, colorScheme: "dark" });
  await o.waitForSelector(".fila:not(.fila-cab)"); await foto(o, "11-clientes-oscuro.png");
  await o.context().close();

  await navegador.close(); servidor.close();
  assert.deepEqual(errores, [], `errores en la consola:\n${errores.join("\n")}`);
  console.log("OK interfaz FEL: clientes, conceptos, borradores, roles, móvil y modo oscuro");
})().catch((e) => { console.error(e); process.exit(1); });
