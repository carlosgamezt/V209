// Pruebas de autenticación, MFA TOTP, recuperación de sesión, permisos y navegación (modo remoto contra un Supabase FALSO).
// Sin credenciales reales ni conexión a producción. Uso: node auth.cjs [carpeta-de-capturas]
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { chromium } = require("playwright");
const { RAIZ, servirEstaticos } = require("./comun.cjs");
const { crear, CLAVE, CODIGO_OK } = require("./falso_supabase.cjs");
const capturas = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (capturas) fs.mkdirSync(capturas, { recursive: true });

(async () => {
  const { servidor, base } = await servirEstaticos();
  const navegador = await chromium.launch();
  const errores = [], falsos = [];
  const pagina = async (fake, { hash = "", viewport = { width: 1280, height: 820 }, inicio, ...o } = {}) => {
    falsos.push(fake);
    const ctx = await navegador.newContext({ deviceScaleFactor: 2, locale: "es-GT", viewport, ...o });
    await fake.instalar(ctx, base);
    if (inicio) await ctx.addInitScript(inicio.fn, inicio.arg);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/fonts\.|Failed to load resource/.test(m.text())) errores.push(`console: ${m.text()}`); });
    await p.goto(base + hash);
    return p;
  };
  const foto = async (p, nombre, o = {}) => { await p.evaluate(() => document.getElementById("toasts").replaceChildren()); if (capturas) await p.screenshot({ path: path.join(capturas, nombre), ...o }); };
  const login = async (p, email, pass = CLAVE) => { await p.fill('input[aria-label="Correo"]', email); await p.fill('input[aria-label="Contraseña"]', pass); await p.click("button:has-text('Entrar')"); };
  const codigo = async (p, c) => { await p.fill('input[aria-label="Código de 6 dígitos"]', c); await p.click("button:has-text('Verificar')"); };
  const almacen = (p) => p.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage } }));
  const ultimoAccess = (f) => [...f.sesiones.keys()].pop();
  const cuenta = (f, re) => f.log.filter((l) => re.test(l)).length;

  // ================= 1. login: errores y almacenamiento
  {
    const f = crear(); const p = await pagina(f);
    await p.waitForSelector(".login-card"); await foto(p, "12-login-escritorio.png");
    await p.click("button:has-text('Entrar')"); await p.waitForSelector("text=Escribe tu correo y tu contraseña");
    assert.equal(f.log.length, 0, "sin datos no se hace ninguna petición");
    await login(p, "propietario@fel.test", "incorrecta"); await p.waitForSelector("text=Correo o contraseña incorrectos");
    assert.equal(await p.inputValue('input[aria-label="Contraseña"]'), "", "la contraseña se borra tras un fallo");
    assert.deepEqual(await almacen(p), { session: {}, local: {} }, "un intento fallido no guarda nada");
    assert.equal(await p.getAttribute('input[aria-label="Contraseña"]', "autocomplete"), "current-password");
    await p.context().close();
  }

  // ================= 2. login correcto sin TOTP: qué se guarda y qué se pide
  {
    const f = crear(); const p = await pagina(f);
    await login(p, "propietario@fel.test"); await p.waitForSelector(".shell"); await p.waitForSelector("text=Comercial Los Pinos");
    const a = await almacen(p), access = ultimoAccess(f);
    assert.deepEqual(Object.keys(a.session).sort(), ["fel.rt", "fel.t0", "fel.ua"], "solo el token de renovación y dos marcas de tiempo en sessionStorage");
    assert.ok(!/eyJ/.test(a.session["fel.t0"] + a.session["fel.ua"]) && /^\d+$/.test(a.session["fel.t0"]) && /^\d+$/.test(a.session["fel.ua"]), "las marcas son solo números");
    assert.deepEqual(a.local, {}, "nada en localStorage");
    assert.ok(!JSON.stringify(a).includes(access), "el token de acceso no se guarda");
    assert.ok(!(await p.url()).includes(access), "el token no va en la URL");
    assert.ok(!(await p.content()).includes(CLAVE), "la contraseña no queda en el DOM");
    assert.equal(await p.inputValue("body input >> nth=0").catch(() => ""), "", "no quedan campos con la contraseña");
    await p.waitForSelector("text=Protege tu cuenta con verificación en dos pasos");
    assert.deepEqual(f.log.slice(0, 4), ["POST /auth/v1/token?password", "GET /auth/v1/user", "POST /functions/v1/fel-api", "POST /functions/v1/fel-api"]);
    await foto(p, "13-app-remoto-sin-mfa.png");

    // ================= 3. recuperar la sesión al recargar (una sola renovación, token rotado)
    const rtAntes = a.session["fel.rt"]; assert.equal(cuenta(f, /refresh_token/), 0);
    await p.reload(); await p.waitForSelector(".shell"); await p.waitForSelector("text=Comercial Los Pinos");
    assert.equal(cuenta(f, /refresh_token/), 1, "una renovación al recargar");
    assert.notEqual((await almacen(p)).session["fel.rt"], rtAntes, "el token de renovación rota");
    assert.equal(await p.locator(".login-card").count(), 0);

    // ================= 4. cerrar sesión
    await p.click('button[aria-label="Cerrar sesión"]'); await p.waitForSelector(".login-card");
    assert.ok(f.log.includes("POST /auth/v1/logout"), "se revoca la sesión en el servidor");
    assert.deepEqual(await almacen(p), { session: {}, local: {} }, "el cierre borra todo");
    assert.equal(new URL(p.url()).hash, "", "se limpia la ruta");
    await p.reload(); await p.waitForSelector(".login-card"); assert.equal(await p.locator(".shell").count(), 0, "recargar tras salir no entra");
    await p.context().close();
  }

  // ================= 5. TOTP: la contraseña sola no basta
  {
    const f = crear(); const p = await pagina(f, { hash: "#/clientes" });
    await login(p, "mfa@fel.test"); await p.waitForSelector("text=Verificación en dos pasos");
    await foto(p, "14-mfa-codigo-escritorio.png");
    assert.equal(cuenta(f, /\/rest\/|fel-api/), 0, "antes del código no se pide ningún dato");
    await p.evaluate(() => { location.hash = "#/conceptos"; }); await p.waitForTimeout(150);
    assert.equal(await p.locator(".shell").count(), 0, "cambiar la ruta no salta el código");
    assert.equal(cuenta(f, /\/rest\/|fel-api/), 0);
    assert.deepEqual((await almacen(p)).session, {}, "sin completar el código no se guarda sesión");
    await codigo(p, "12ab56"); await p.waitForSelector("text=El código tiene 6 dígitos"); assert.equal(cuenta(f, /challenge|verify/), 0, "un código mal formado ni se envía");
    await codigo(p, "111111"); await p.waitForSelector("text=Código incorrecto o vencido"); assert.equal(await p.locator(".shell").count(), 0);
    f.limitarMfa = true; await codigo(p, CODIGO_OK); await p.waitForSelector("text=Reintenta en 7 s"); f.limitarMfa = false;
    await codigo(p, CODIGO_OK); await p.waitForSelector(".shell"); await p.waitForSelector("text=Consultoría");
    assert.equal(new URL(p.url()).hash, "#/conceptos", "se conserva la ruta pedida");
    assert.equal(await p.locator("text=Protege tu cuenta").count(), 0, "con aal2 no aparece el aviso de MFA");
    // recuperar sesión aal2 tras recargar
    await p.reload(); await p.waitForSelector(".shell"); assert.equal(await p.locator("text=Verificación en dos pasos").count(), 0);
    await p.context().close();

    // cinco códigos incorrectos: se vuelve al login
    const g = crear(); const q = await pagina(g);
    await login(q, "mfa@fel.test"); await q.waitForSelector("text=Verificación en dos pasos");
    for (let i = 0; i < 5; i++) { await codigo(q, "000000"); await q.waitForTimeout(80); }
    await q.waitForSelector("text=Demasiados intentos fallidos"); assert.equal(await q.locator(".shell").count(), 0); await q.context().close();
  }

  // ================= 6. recuperación: no se acepta una sesión sin el nivel que la cuenta exige
  {
    const f = crear(); const rt = f.sembrarRefresco("mfa@fel.test", "aal1");
    const ahora = String(Date.now());
    const p = await pagina(f, { inicio: { fn: ([rt_, t]) => { sessionStorage.setItem("fel.rt", rt_); sessionStorage.setItem("fel.t0", t); sessionStorage.setItem("fel.ua", t); }, arg: [rt, ahora] } });
    await p.waitForSelector(".login-card"); assert.equal(await p.locator(".shell").count(), 0, "un token aal1 de una cuenta con TOTP no entra");
    await p.context().close();
    const g = crear(); const q = await pagina(g, { inicio: { fn: ([k, v]) => sessionStorage.setItem(k, v), arg: ["fel.rt", "rt-inexistente"] } });
    await q.waitForSelector(".login-card"); assert.equal(await q.evaluate(() => sessionStorage.length), 0, "un token inválido se borra"); await q.context().close();
  }

  // ================= 7. activar TOTP desde Seguridad
  {
    const f = crear(); const p = await pagina(f);
    await login(p, "propietario@fel.test"); await p.waitForSelector(".shell");
    const rt0 = (await almacen(p)).session["fel.rt"];
    await p.click('aside a.nv:has-text("Seguridad")'); await p.waitForSelector("text=Inactiva"); await foto(p, "15-seguridad-inactiva.png");
    await p.click("button:has-text('Activar verificación en dos pasos')"); await p.waitForSelector("img.qr");
    assert.match(await p.getAttribute("img.qr", "src"), /^data:image\/svg\+xml/);
    await p.waitForSelector("text=JBSWY3DPEHPK3PXP"); await foto(p, "16-seguridad-activar-totp.png", { fullPage: true });
    await p.fill('input[aria-label="Código de 6 dígitos"]', "999999"); await p.click("button:has-text('Confirmar y activar')"); await p.waitForSelector("text=Código incorrecto o vencido");
    await p.fill('input[aria-label="Código de 6 dígitos"]', CODIGO_OK); await p.click("button:has-text('Confirmar y activar')");
    await p.waitForSelector("text=Verificación en dos pasos activada"); await p.waitForSelector(".seg-fila >> text=Activa"); await p.waitForSelector("text=Verificada con código (aal2)");
    assert.notEqual((await almacen(p)).session["fel.rt"], rt0, "tras subir a aal2 se guarda la sesión nueva");
    await foto(p, "17-seguridad-activa.png");
    await p.click('aside a.nv:has-text("Clientes")'); await p.waitForSelector("text=Comercial Los Pinos"); assert.equal(await p.locator("text=Protege tu cuenta").count(), 0, "desaparece el aviso");
    // desde ahora la cuenta exige código al iniciar sesión
    await p.click('button[aria-label="Cerrar sesión"]'); await p.waitForSelector(".login-card");
    await login(p, "propietario@fel.test"); await p.waitForSelector("text=Verificación en dos pasos"); assert.equal(await p.locator(".shell").count(), 0);
    await p.context().close();
  }

  // ================= 8. caducidad: renovación transparente, previa y pérdida de sesión
  {
    const f = crear(); const p = await pagina(f);
    await login(p, "propietario@fel.test"); await p.waitForSelector(".shell");
    f.vencer(ultimoAccess(f)); const r0 = cuenta(f, /refresh_token/);
    await p.click('aside a.nv:has-text("Conceptos")'); await p.waitForSelector("text=Consultoría");
    assert.equal(cuenta(f, /refresh_token/), r0 + 1, "el 401 provoca una renovación y se reintenta sin que el usuario lo note");
    f.revocarRefrescos(); f.vencer(ultimoAccess(f));
    await p.click('aside a.nv:has-text("Borradores")'); await p.waitForSelector(".login-card"); await p.waitForSelector("text=Tu sesión venció");
    assert.equal(new URL(p.url()).hash, "#/borradores", "se conserva la ruta para volver tras iniciar sesión");
    assert.equal(await p.evaluate(() => sessionStorage.length), 0);
    await foto(p, "18-sesion-vencida.png");
    await p.context().close();

    const g = crear(); g.expiresIn = 10; const q = await pagina(g);   // token de 10 s: se renueva ANTES de cada petición
    await login(q, "propietario@fel.test"); await q.waitForSelector("text=Comercial Los Pinos");
    assert.ok(cuenta(g, /refresh_token/) >= 1, "renovación previa al vencimiento"); await q.context().close();
  }

  // ================= 9. permisos y navegación
  {
    const f = crear(); const p = await pagina(f, { hash: "#/borradores" });   // enlace directo antes de iniciar sesión
    await p.waitForSelector(".login-card"); await login(p, "lector@fel.test"); await p.waitForSelector(".shell");
    await p.waitForSelector("h1:has-text('Borradores')"); assert.equal(new URL(p.url()).hash, "#/borradores", "tras el login vuelve al enlace pedido");
    assert.deepEqual(await p.locator("aside a.nv").allInnerTexts(), ["Clientes", "Conceptos", "Borradores", "Seguridad"]);
    assert.equal(await p.locator("text=Nuevo borrador").count(), 0, "el lector no crea borradores");
    await p.evaluate(() => { location.hash = "#/borradores/nuevo"; }); await p.waitForSelector("h1:has-text('Borradores')"); assert.equal(new URL(p.url()).hash, "#/borradores");
    await p.evaluate(() => { location.hash = "#/ruta-inexistente"; }); await p.waitForSelector("h1:has-text('Clientes')"); assert.equal(new URL(p.url()).hash, "#/clientes");
    await p.click('aside a.nv:has-text("Clientes")'); await p.waitForSelector("text=Tu rol solo permite consultar clientes");
    assert.equal(await p.locator("text=Nuevo cliente").count(), 0); await foto(p, "19-lector-remoto.png");
    await p.context().close();

    const g = crear(); const q = await pagina(g);
    await login(q, "propietario@fel.test"); await q.waitForSelector(".shell");
    assert.equal(await q.locator("text=Nuevo cliente").count(), 1, "el propietario sí crea clientes");
    await q.click("text=Nuevo cliente"); await q.fill('input[name=nombre]', "Prueba"); await q.fill('input[name=numero]', "5551234-6"); await q.click(".modal .btn-pri");
    await q.waitForSelector("text=Cliente creado"); assert.ok(cuenta(g, /fel-api/) >= 3, "la escritura pasa por la Edge Function");
    assert.equal(cuenta(g, /POST \/rest\//), 0, "la interfaz nunca escribe directo en las tablas");
    await q.context().close();

    // cuenta sin perfil y cuenta bloqueada
    for (const [correo, texto] of [["nuevo@fel.test", "invitación vigente"], ["bloqueado@fel.test", "desactivada"]]) {
      const h = crear(); const r = await pagina(h);
      await login(r, correo); await r.waitForSelector("text=Sin acceso"); await r.waitForSelector(`text=${texto}`);
      assert.equal(cuenta(h, /\/rest\//), 0, "sin acceso: no se leen datos"); assert.equal(await r.locator(".shell").count(), 0);
      if (correo.startsWith("nuevo")) await foto(r, "20-sin-acceso.png");
      await r.click("button:has-text('Salir')"); await r.waitForSelector(".login-card"); await r.context().close();
    }
  }

  // ================= 10. móvil: login y MFA sin desborde
  {
    const f = crear(); const p = await pagina(f, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.waitForSelector(".login-card"); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await foto(p, "21-login-movil.png");
    await login(p, "mfa@fel.test"); await p.waitForSelector("text=Verificación en dos pasos"); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await foto(p, "22-mfa-movil.png"); await p.context().close();
  }

  // ================= 11. higiene del código y de la red
  for (const f of falsos) assert.deepEqual(f.violaciones, [], `peticiones indebidas:\n${f.violaciones.join("\n")}`);
  const archivos = [];
  const recorrer = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const r = path.join(d, n.name); if (n.isDirectory()) { if (!["tests", "capturas"].includes(n.name)) recorrer(r); } else archivos.push(r); } };
  recorrer(RAIZ);
  for (const a of archivos.filter((x) => /\.(js|html|css)$/.test(x))) {
    const crudo = fs.readFileSync(a, "utf8"), rel = path.relative(RAIZ, a);
    const t = /\.js$/.test(a) ? crudo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1") : crudo; // sin comentarios
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t), `${rel}: parece contener un JWT`);
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role['"]?\s*[:=]\s*['"]/i.test(t), `${rel}: parece contener la clave service_role`);
    if (!/icons\.js$/.test(a)) assert.ok(!/\binnerHTML\b|\binsertAdjacentHTML\b|document\.write\b|\beval\(/.test(t), `${rel}: usa HTML dinámico`);
    assert.ok(!/localStorage/.test(t), `${rel}: usa localStorage`);
  }
  assert.match(fs.readFileSync(path.join(RAIZ, "index.html"), "utf8"), /Content-Security-Policy/);
  assert.match(fs.readFileSync(path.join(RAIZ, "config.js"), "utf8"), /modo: "demo"/, "el modo por defecto es la demostración");

  await navegador.close(); servidor.close();
  assert.deepEqual(errores, [], `errores en la consola:\n${errores.join("\n")}`);
  console.log("OK autenticación FEL: login, TOTP, recuperación de sesión, caducidad, permisos y navegación");
})().catch((e) => { console.error(e); process.exit(1); });
