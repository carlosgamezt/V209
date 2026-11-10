// Pruebas de cuentas y usuarios (modo remoto contra un Supabase FALSO): recuperación de contraseña, invitación de cuenta, pérdida del
// dispositivo TOTP, inactividad y duración máxima, revocación y cambios de permisos en caliente, pantallas de Usuarios y aislamiento entre empresas.
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
const { servirEstaticos } = require("./comun.cjs");
const { crear, CLAVE, CODIGO_OK } = require("./falso_supabase.cjs");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (capturas) fs.mkdirSync(capturas, { recursive: true });
const NUEVA = "Otra-Clave-Segura-456";

(async () => {
  const { servidor, base } = await servirEstaticos();
  const navegador = await chromium.launch();
  const errores = [], falsos = [];
  const pagina = async (fake, { hash = "", viewport = { width: 1280, height: 820 }, ...o } = {}) => {
    falsos.push(fake);
    const ctx = await navegador.newContext({ deviceScaleFactor: 2, locale: "es-GT", viewport, ...o });
    await fake.instalar(ctx);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
    await p.goto(base + hash);
    return p;
  };
  const foto = async (p, nombre, o = {}) => { await p.evaluate(() => document.getElementById("toasts").replaceChildren()); if (capturas) await p.screenshot({ path: path.join(capturas, nombre), ...o }); };
  const login = async (p, email, pass = CLAVE) => { await p.fill('input[aria-label="Correo"]', email); await p.fill('input[aria-label="Contraseña"]', pass); await p.click("button:has-text('Entrar')"); };
  const codigo = async (p, c, boton = "Verificar") => { await p.fill('input[aria-label="Código de 6 dígitos"]', c); await p.click(`button:has-text('${boton}')`); };
  const entrarConMfa = async (p, email) => { await login(p, email); await p.waitForSelector("text=Verificación en dos pasos"); await codigo(p, CODIGO_OK); await p.waitForSelector(".shell"); };
  const cuenta = (f, re) => f.log.filter((l) => re.test(l)).length;
  const sinDatos = (f) => cuenta(f, /\/rest\/|fel-api/) === 0;
  const clave = async (p, a, b = a) => { await p.fill('input[aria-label="Contraseña nueva"]', a); await p.fill('input[aria-label="Repite la contraseña"]', b); await p.click("button:has-text('Guardar contraseña')"); };

  // ================= 1. olvidé mi contraseña: respuesta idéntica, sin revelar cuentas
  {
    const f = crear(); const p = await pagina(f);
    await p.click("text=¿Olvidaste tu contraseña?"); await p.waitForSelector("text=Recuperar contraseña"); await foto(p, "28-olvide-mi-contrasena.png");
    const textos = [];
    for (const correo of ["propietario@fel.test", "no-existe@fel.test"]) {
      await p.fill('input[aria-label="Correo"]', correo); await p.click("button:has-text('Enviar enlace')"); await p.waitForSelector("text=Revisa tu correo");
      textos.push(await p.locator(".login-card").innerText());
      await p.click("text=Volver al inicio de sesión"); await p.click("text=¿Olvidaste tu contraseña?");
    }
    assert.equal(textos[0], textos[1], "la respuesta es idéntica exista o no la cuenta");
    assert.equal(f.correosRecuperacion.length, 2); assert.equal(f.correosRecuperacion[0].redirect_to, base, "el retorno es la propia aplicación");
    assert.equal(cuenta(f, /\/rest\/|fel-api|logout/), 0);
    f.limitarRecover = true; await p.fill('input[aria-label="Correo"]', "propietario@fel.test"); await p.click("button:has-text('Enviar enlace')");
    await p.waitForSelector("text=Ya pediste un enlace hace poco"); assert.equal(await p.locator("text=Revisa tu correo").count(), 0);
    await p.context().close();
  }

  // ================= 2. enlace de recuperación (cuenta SIN TOTP)
  {
    const f = crear(); const enlace = f.enlaceCorreo("propietario@fel.test");
    const p = await pagina(f, { hash: enlace });
    await p.waitForSelector("text=Nueva contraseña");
    assert.ok(!p.url().includes("access_token") && !p.url().includes("#"), "el token se borra de la barra de direcciones al instante");
    assert.equal(await p.evaluate(() => history.length > 0 && !location.hash), true);
    assert.ok(sinDatos(f), "con el enlace no se leen datos ni se entra a la aplicación"); assert.equal(await p.locator(".shell").count(), 0);
    assert.deepEqual(await p.evaluate(() => ({ ...sessionStorage })), {}, "la sesión de recuperación no se guarda");
    await foto(p, "29-nueva-contrasena.png");
    await clave(p, "corta"); await p.waitForSelector("text=12 caracteres o más");
    await clave(p, NUEVA, "otra-distinta"); await p.waitForSelector("text=no coinciden");
    assert.equal(f.ultimaAccion, null, "una contraseña débil o distinta no llega al servidor como cambio");
    await clave(p, NUEVA); await p.waitForSelector("text=Contraseña actualizada"); assert.equal(f.ultimaAccion, "password:propietario@fel.test");
    assert.ok(f.log.includes("POST /auth/v1/logout"), "la sesión de recuperación se descarta"); assert.ok(sinDatos(f), "cambiar la contraseña no entra a la aplicación");
    await login(p, "propietario@fel.test", CLAVE); await p.waitForSelector("text=Correo o contraseña incorrectos");   // la anterior ya no sirve
    await login(p, "propietario@fel.test", NUEVA); await p.waitForSelector(".shell");
    await p.context().close();

    // enlaces malos: caducado, mal formado, tipo no previsto, token inválido
    for (const hash of ["#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", "#access_token=x&type=recovery&refresh_token=", "#access_token=abc.def.ghi&type=magiclink", "#access_token=basura&refresh_token=r&type=recovery"]) {
      const g = crear(); const q = await pagina(g, { hash });
      await q.waitForSelector("text=El enlace venció o no es válido"); assert.ok(!q.url().includes("#"), "el fragmento se borra"); assert.equal(await q.locator(".shell").count(), 0); assert.ok(sinDatos(g)); await q.context().close();
    }
  }

  // ================= 3. enlace de recuperación con TOTP: sin código no se puede cambiar la contraseña
  {
    const f = crear(); const p = await pagina(f, { hash: f.enlaceCorreo("mfa@fel.test") });
    await p.waitForSelector("text=Confirma que eres tú"); assert.equal(await p.locator('input[aria-label="Contraseña nueva"]').count(), 0, "no se ofrece cambiar la contraseña antes del código");
    await codigo(p, "111111"); await p.waitForSelector("text=Código incorrecto o vencido"); assert.equal(await p.locator('input[aria-label="Contraseña nueva"]').count(), 0);
    await codigo(p, CODIGO_OK); await p.waitForSelector("text=Nueva contraseña"); await clave(p, NUEVA);
    await p.waitForSelector("text=Contraseña actualizada"); assert.equal(f.ultimaAccion, "password:mfa@fel.test");
    await login(p, "mfa@fel.test", NUEVA); await p.waitForSelector("text=Verificación en dos pasos");   // recuperar la contraseña NO quita el MFA
    assert.ok(sinDatos(f)); await p.context().close();
  }

  // ================= 4. invitación de cuenta (Supabase Auth): crear contraseña; no da acceso por sí sola
  {
    const f = crear(); const p = await pagina(f, { hash: f.enlaceCorreo("nuevo@fel.test", "invite") });
    await p.waitForSelector("text=Crea tu contraseña"); await clave(p, NUEVA); await p.waitForSelector("text=Contraseña creada");
    await login(p, "nuevo@fel.test", NUEVA); await p.waitForSelector("text=Sin acceso"); await p.waitForSelector("text=invitación vigente");   // la cuenta existe, pero no hay invitación a ninguna empresa
    assert.equal(cuenta(f, /\/rest\//), 0); await p.context().close();
  }

  // ================= 5. perdí mi dispositivo: solicitud + verificación administrativa; nada se omite
  {
    const f = crear(); const p = await pagina(f);
    await login(p, "emisor@fel.test"); await p.waitForSelector("text=Verificación en dos pasos");
    await p.click("text=Perdí mi dispositivo"); await p.waitForSelector("text=nadie puede saltarse"); await foto(p, "30-perdi-mi-dispositivo.png");
    await p.fill('textarea[aria-label="Qué ocurrió"]', "corto"); await p.click("button:has-text('Solicitar recuperación')"); await p.waitForSelector("text=mínimo 10 caracteres");
    await p.fill('textarea[aria-label="Qué ocurrió"]', "Perdí mi teléfono y no tengo copia de la clave"); await p.click("button:has-text('Solicitar recuperación')"); await p.waitForSelector("text=Solicitud enviada");
    assert.equal(f.solicitudes.length, 1); assert.ok(f.usuarios["emisor@fel.test"].factor?.verificado, "solicitar NO elimina el factor");
    assert.equal(cuenta(f, /\/rest\/|fel-api.*/) >= 1, true); assert.equal(await p.locator(".shell").count(), 0, "solicitar no entra a la aplicación");
    await p.click("button:has-text('Volver')"); await p.waitForSelector("text=Verificación en dos pasos");     // sigue pidiendo el código
    await p.click("text=Perdí mi dispositivo"); await p.fill('textarea[aria-label="Qué ocurrió"]', "Segundo intento mientras hay una solicitud abierta"); await p.click("button:has-text('Solicitar recuperación')");
    await p.waitForSelector("text=Ya tienes una solicitud en curso"); assert.equal(f.solicitudes.length, 1);
    await p.context().close();

    // quien aprueba: propietario con aal2 (mfa@). Un propietario sin aal2 (propietario@) no puede resolver.
    const q = await pagina(f);
    await login(q, "propietario@fel.test"); await q.waitForSelector(".shell");
    await q.click('aside a.nv:has-text("Usuarios")'); await q.click('.tabs a:has-text("Recuperación de acceso")'); await q.waitForSelector("text=Resolver solicitudes exige verificación en dos pasos");
    assert.ok(f.usuarios["emisor@fel.test"].factor, "sin aal2 no se resuelve nada"); await q.context().close();

    const r = await pagina(f);
    await entrarConMfa(r, "mfa@fel.test");
    await r.click('aside a.nv:has-text("Usuarios")'); await r.click('.tabs a:has-text("Recuperación de acceso")'); await r.waitForSelector("text=emisor@fel.test");
    await r.click("text=Revisar"); await r.click(".modal .btn-peligro"); await r.waitForSelector("text=Confirma que verificaste");
    await r.check('input[aria-label="Confirmo la verificación"]'); await r.fill('textarea[aria-label="Cómo verificaste su identidad"]', "corta"); await r.click(".modal .btn-peligro"); await r.waitForSelector("text=mínimo 20 caracteres");
    assert.ok(f.usuarios["emisor@fel.test"].factor, "sin evidencia suficiente no se elimina nada");
    await r.fill('textarea[aria-label="Cómo verificaste su identidad"]', "Videollamada con documento en mano; confirmé nombre, cargo y teléfono registrado."); await foto(r, "31-aprobar-recuperacion.png"); await r.click(".modal .btn-peligro");
    await r.waitForSelector("text=Recuperación aplicada"); assert.equal(f.usuarios["emisor@fel.test"].factor, null); await r.context().close();

    // la persona recuperada entra con su contraseña, sin MFA, y se le pide activar uno nuevo
    const s = await pagina(f);
    await login(s, "emisor@fel.test"); await s.waitForSelector(".shell"); await s.waitForSelector("text=Protege tu cuenta con verificación en dos pasos");
    await s.context().close();
  }

  // ================= 6. inactividad y duración máxima (cierre local; el límite real lo fija el servidor)
  {
    const f = crear(); f.config = { inactividadMs: 1600 };
    const p = await pagina(f); await login(p, "propietario@fel.test"); await p.waitForSelector(".shell");
    for (let i = 0; i < 6; i++) { await p.mouse.move(100 + i, 100); await p.keyboard.press("Shift"); await p.waitForTimeout(500); }   // 3 s CON actividad
    assert.equal(await p.locator(".shell").count(), 1, "con actividad la sesión sigue");
    await p.waitForSelector("text=Cerraste sesión por inactividad", { timeout: 6000 });
    assert.ok(f.log.includes("POST /auth/v1/logout"), "se revoca en el servidor"); assert.equal(await p.evaluate(() => sessionStorage.length), 0, "se borra todo lo guardado");
    await foto(p, "32-sesion-por-inactividad.png"); await p.context().close();

    const g = crear(); g.config = { duracionMaximaMs: 1500 };
    const q = await pagina(g); await login(q, "propietario@fel.test"); await q.waitForSelector(".shell");
    for (let i = 0; i < 5; i++) { await q.keyboard.press("Shift"); await q.waitForTimeout(400); }                      // activo, pero se acaba el tiempo
    await q.waitForSelector("text=alcanzó su duración máxima", { timeout: 6000 }); await q.context().close();

    // al recargar, la duración máxima y la inactividad también cuentan (no se "renueva" una sesión vencida)
    const h = crear(); h.config = { inactividadMs: 60000, duracionMaximaMs: 3600000 };
    const r = await pagina(h); await login(r, "propietario@fel.test"); await r.waitForSelector(".shell");
    await r.evaluate(() => sessionStorage.setItem("fel.ua", String(Date.now() - 120000))); await r.reload(); await r.waitForSelector(".login-card"); assert.equal(await r.locator(".shell").count(), 0);
    await login(r, "propietario@fel.test"); await r.waitForSelector(".shell");
    await r.evaluate(() => sessionStorage.setItem("fel.t0", String(Date.now() - 4000000))); await r.reload(); await r.waitForSelector(".login-card");
    await r.evaluate(() => { sessionStorage.setItem("fel.rt", "rt-inexistente"); sessionStorage.setItem("fel.t0", String(Date.now())); sessionStorage.setItem("fel.ua", String(Date.now())); }); await r.reload();
    await r.waitForSelector(".login-card"); assert.equal(await r.evaluate(() => sessionStorage.length), 0, "token de renovación inválido: se borra todo"); await r.context().close();
  }

  // ================= 7. revocación y cambios de permisos EN CALIENTE
  {
    // a) un lector asciende a emisor mientras trabaja: al cambiar de pantalla se recargan los permisos
    const f = crear(); const p = await pagina(f);
    await login(p, "lector@fel.test"); await p.waitForSelector("text=Tu rol solo permite consultar clientes"); assert.equal(await p.locator("text=Nuevo cliente").count(), 0);
    f.setRol("lector@fel.test", "emp-1", "emisor");
    await p.click('aside a.nv:has-text("Conceptos")'); await p.waitForSelector("text=Tus permisos cambiaron"); await p.waitForSelector("text=Nuevo concepto");
    // b) un propietario pierde el rol: desaparecen Usuarios y los botones de escritura
    await p.context().close();
    const g = crear(); const q = await pagina(g);
    await login(q, "propietario@fel.test"); await q.waitForSelector("text=Nuevo cliente"); await q.waitForSelector('aside a.nv:has-text("Usuarios")');
    g.setRol("propietario@fel.test", "emp-1", "lector");
    await q.click('aside a.nv:has-text("Conceptos")'); await q.waitForFunction(() => !document.querySelector('aside a.nv[href="#/usuarios"]'));
    assert.equal(await q.locator("text=Nuevo concepto").count(), 0, "ya no puede crear");
    // c) escribir con permisos ya revocados: el servidor responde 403 y la interfaz recarga los permisos (no se queda con botones falsos)
    await q.context().close();
    const h = crear(); const r = await pagina(h);
    await login(r, "propietario@fel.test"); await r.waitForSelector("text=Nuevo cliente");
    await r.click("text=Nuevo cliente"); await r.fill('input[name=nombre]', "Prueba"); await r.fill('input[name=numero]', "5551234-6");
    h.setRol("propietario@fel.test", "emp-1", "lector"); await r.click(".modal .btn-pri");
    await r.waitForSelector("text=No tienes permiso para esta operación"); await r.waitForSelector("text=Tus permisos cambiaron"); await r.keyboard.press("Escape");
    await r.waitForFunction(() => !document.body.innerText.includes("Nuevo cliente")); await r.context().close();
    // d) cuenta bloqueada mientras trabaja
    const i = crear(); const s = await pagina(i);
    await login(s, "propietario@fel.test"); await s.waitForSelector(".shell");
    i.setEstado("propietario@fel.test", "bloqueada"); await s.click('aside a.nv:has-text("Conceptos")');
    await s.waitForSelector(".login-card"); await s.waitForSelector("text=Tu acceso fue revocado"); assert.equal(await s.evaluate(() => sessionStorage.length), 0, "se borra todo");
    await foto(s, "33-acceso-revocado.png");
    await s.reload(); await s.waitForSelector(".login-card"); await s.context().close();
    // e) pierde el perfil / la membresía: igual
    const j = crear(); const t = await pagina(j);
    await login(t, "propietario@fel.test"); await t.waitForSelector(".shell"); j.setEstado("propietario@fel.test", "sin_perfil");
    await t.click('aside a.nv:has-text("Borradores")'); await t.waitForSelector("text=Tu acceso fue revocado"); await t.context().close();
  }

  // ================= 8. pantallas de Usuarios contra el servidor (aal2, jerarquía, aislamiento entre empresas)
  {
    const f = crear(); const p = await pagina(f);
    await login(p, "propietario@fel.test"); await p.waitForSelector(".shell");        // aal1: puede VER, no gestionar
    await p.click('aside a.nv:has-text("Usuarios")'); await p.waitForSelector("text=lector@fel.test"); await p.waitForSelector("text=Para invitar o modificar usuarios necesitas verificación en dos pasos");
    assert.equal(await p.locator('button[aria-label^="Cambiar rol y permisos"]').count(), 0, "sin aal2 no hay botones de gestión");
    await p.click('.tabs a:has-text("Invitaciones")'); await p.waitForSelector("text=pendiente@fel.test"); assert.equal(await p.locator("button:has-text('Invitar a la empresa')").isDisabled(), true);
    await foto(p, "34-usuarios-sin-aal2.png"); await p.context().close();

    const g = crear(); const q = await pagina(g);
    await entrarConMfa(q, "mfa@fel.test");
    await q.click('aside a.nv:has-text("Usuarios")'); await q.waitForSelector("text=lector@fel.test");
    assert.equal(await q.locator(".fila-usr:not(.fila-cab)").count(), 6, "miembros de emp-1: propietario, lector, emisor, mfa, maestro y multi");
    assert.equal(await q.locator("text=secreta-de-b@fel.test").count(), 0);
    // invitar → llega a la API con la empresa activa; la persona queda pendiente
    await q.click('.tabs a:has-text("Invitaciones")'); await q.click("text=Invitar a la empresa"); await q.fill('input[aria-label="Correo de la persona"]', "nueva@fel.test"); await q.click(".modal .btn-pri");
    await q.waitForSelector("text=Invitación registrada y correo de cuenta enviado"); await q.waitForSelector("text=nueva@fel.test"); assert.equal(g.ultimaAccion, "invitar:emp-1:nueva@fel.test");
    // cambiar el rol del lector a emisor (el rol propio y los superiores no se ofrecen)
    await q.click('.tabs a:has-text("Usuarios")'); await q.click('button[aria-label="Cambiar rol y permisos de lector@fel.test"]'); await q.waitForSelector(".rejilla-permisos");
    await q.selectOption('select[aria-label="Rol"]', "emisor"); await q.click(".modal .btn-pri"); await q.waitForSelector("text=Cambios guardados");
    assert.equal(g.usuarios["lector@fel.test"].empresas["emp-1"], "emisor");
    await q.context().close();
  }
  {
    // aislamiento entre empresas: una persona con dos empresas ve solo la activa; sus consultas llevan SU empresa
    const f = crear(); const p = await pagina(f);
    await login(p, "multi@fel.test"); await p.waitForSelector(".shell"); await p.waitForSelector("text=Comercial Los Pinos");
    assert.equal(await p.locator("text=Cliente Exclusivo de la Empresa Dos").count(), 0, "emp-1 no muestra datos de emp-2");
    assert.equal(await p.locator('aside a.nv:has-text("Usuarios")').count(), 0, "lector en emp-1: sin Usuarios");
    await p.selectOption('select[aria-label="Empresa activa"]', "emp-2"); await p.waitForSelector("text=Cliente Exclusivo de la Empresa Dos");
    assert.equal(await p.locator("text=Comercial Los Pinos").count(), 0, "emp-2 no muestra datos de emp-1"); await foto(p, "35-multiempresa-segunda-empresa.png");
    await p.click('aside a.nv:has-text("Usuarios")'); await p.waitForSelector("text=multi@fel.test");
    assert.equal(await p.locator("text=lector@fel.test").count(), 0, "los miembros de emp-1 no aparecen en emp-2");
    await p.click('.tabs a:has-text("Invitaciones")'); await p.waitForSelector("text=secreta-de-b@fel.test"); assert.equal(await p.locator("text=pendiente@fel.test").count(), 0);
    assert.ok(f.urls.filter((u) => /\/rest\/v1\/invitaciones/.test(u)).every((u) => u.includes("empresa_id=eq.emp-2")), "las invitaciones se piden solo de la empresa activa");
    await p.selectOption('select[aria-label="Empresa activa"]', "emp-1"); await p.waitForSelector("text=Tu rol solo permite consultar clientes").catch(() => {});
    await p.waitForFunction(() => !document.querySelector('aside a.nv[href="#/usuarios"]'));
    assert.ok(f.urls.filter((u) => /\/rest\/v1\/(clientes|conceptos)/.test(u)).every((u) => /empresa_id=eq\.emp-[12]/.test(u)));
    await p.context().close();
  }

  for (const f of falsos) assert.deepEqual(f.violaciones, [], `peticiones indebidas:\n${f.violaciones.join("\n")}`);
  await navegador.close(); servidor.close();
  assert.deepEqual(errores, [], `errores en la consola:\n${errores.join("\n")}`);
  console.log("OK cuentas FEL: recuperación de contraseña, invitación de cuenta, MFA perdido, inactividad, revocación, usuarios y empresas");
})().catch((e) => { console.error(e); process.exit(1); });
