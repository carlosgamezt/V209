// Tipos de documento (DTE) en el NAVEGADOR: «Nuevo documento», selector compacto, campos del tipo (recibo; nota con documento de origen), cambio de tipo en un borrador, vista previa y PDF,
// historial con filtro por tipo y configuración por empresa. Servidor real con inicio de sesión (todo simulado, nada sale a la red, no se certifica ningún tipo nuevo).
// Uso: node e2e_tipos.cjs   (FEL_E2E_NAVEGADOR=firefox|webkit para otro motor)
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
(async () => {
  const srv = await arrancar(), nav = await motor.launch(), errores = [];
  try {
    const ctxPag = async (w, h = 844) => { const c = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, ...(w < 900 && NAV !== "firefox" ? { isMobile: true } : {}), serviceWorkers: "block", locale: "es-GT" });
      await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" })); const p = await c.newPage(); p.on("pageerror", (e) => errores.push(`${w}: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(`${w}: consola: ${m.text()}`); }); return p; };
    const entrar = async (p, u = "ana") => { await p.goto(srv.url); await p.waitForSelector("#login-usuario"); await p.selectOption("#login-usuario", u); await p.fill("#login-clave", "demo1234"); await p.click("#login-entrar"); await p.waitForSelector(".cab-demo"); };
    const sinDesborde = async (p, donde) => { const [a, v] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(a <= v + 1, `desplazamiento horizontal en ${donde}: ${a} > ${v}`); };
    const api = (p, m, r, b) => p.evaluate(async ([m, r, b]) => { const x = await fetch(r, { method: m, headers: { "x-demo": "1", "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await x.json(); } catch { /* sin cuerpo */ } return { status: x.status, json: j }; }, [m, r, b]);
    const toast = (p, t) => p.waitForSelector(`#toasts >> text=${t}`, { timeout: 8000 }).catch(async (e) => { throw new Error(`no apareció el aviso «${t}». Avisos: «${await p.locator("#toasts").innerText()}» · error en pantalla: «${await p.locator(".area-msg").innerText()}» · validación: «${await p.locator(".validacion").innerText().catch(() => "")}»`); });
    const certificado = (p, n) => p.evaluate(async (n) => {   // FACT certificado en SIMULACIÓN, creado por la API con la sesión del navegador
      const J = { "x-demo": "1", "content-type": "application/json" }, get = async (r) => (await fetch(r, { headers: J })).json(), post = async (r, b) => (await fetch(r, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const est = await get("/api/estado"), cli = est.clientes.find((c) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
      const d = await post("/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "50000" }] });
      await post(`/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version });
      const c = await post(`/api/documentos/${d.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-e2e-tipos-${n}-${Date.now()}` });
      if (c.documento?.estado_fiscal !== "certificado") throw new Error("no se certificó: " + JSON.stringify(c).slice(0, 200));
      return { id: d.documento.id, serie: c.documento.serie, numero: c.documento.numero_fiscal, cliente: cli.nombre };
    }, n);
    const agregarConcepto = async (p) => { const sel = p.locator(".sel-concepto"); const v = await sel.locator("option").nth(1).getAttribute("value"); await sel.selectOption(v); await p.waitForSelector(".it"); };

    for (const [w, h] of [[390, 844], [1100, 800]]) {
      const p = await ctxPag(w, h); await entrar(p); const donde = `${w}px`;
      // ================= 1. «Nuevo documento»: con solo Factura habilitada la captura rápida no cambia (etiqueta, sin selector ni campos extra)
      assert.match(await p.locator('.nav a[href="#/nueva"], .nav-movil a[href="#/nueva"]').first().innerText(), /Nuevo/, "el acceso se llama «Nuevo documento»");
      await p.goto(srv.url + "/#/nueva"); await esperarNueva(p);
      assert.equal((await p.locator(".doc-tit h1").innerText()).trim(), "Nuevo documento"); assert.equal((await p.locator("#tipo-actual").innerText()).trim(), "Factura");
      assert.equal(await p.locator("#tipo-documento").count(), 0, "con un solo tipo habilitado no hay selector"); assert.equal(await p.locator(".card-tipo").count(), 0);
      await sinDesborde(p, `Nuevo documento ${donde}`);
      if (w === 1100) {
        // ================= 2. la empresa habilita NCRE y RECI: aparece el selector compacto, Factura sigue por defecto
        assert.equal((await api(p, "POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true })).status, 200);
        assert.equal((await api(p, "POST", "/api/tipos-documento", { tipo: "RECI", habilitado: true, base_habilitacion: "Base de prueba (no es una resolución real)" })).status, 200);
      } else { await p.waitForTimeout(100); }
      if (w === 390) continue;   // el resto del recorrido se hace en PC; el móvil comprueba el desborde del formulario con selector y panel más abajo
      await p.goto(srv.url + "/#/nueva"); await p.reload(); await esperarNueva(p); await p.waitForSelector("#tipo-documento");
      assert.deepEqual((await p.locator("#tipo-documento option").allInnerTexts()).map((t) => t.trim()), ["Factura", "Nota de crédito (en pruebas)", "Recibo (en pruebas)"]);
      assert.equal(await p.inputValue("#tipo-documento"), "FACT"); assert.equal(await p.locator(".card-tipo").count(), 0, "Factura: sin campos adicionales");
      // ================= 3. recibo: tipo propio, aviso «en pruebas», validación, guardado, vista previa
      await p.selectOption("#tipo-documento", "RECI"); await p.waitForSelector('.card-tipo[data-tipo="RECI"]');
      assert.match(await p.locator("#aviso-en-pruebas").innerText(), /EN PRUEBAS.*no se puede certificar/s); assert.ok(await p.locator('[data-en-pruebas="1"]').isVisible());
      await elegirReceptor(p); await agregarConcepto(p); await p.click("#guardar");
      assert.match(await p.locator(".area-msg, .validacion").first().innerText(), /tipo/i, "sin tipo de recibo no se guarda");
      await p.selectOption("#tipo-recibo", "Colegio"); await p.click("#guardar"); await toast(p, "Borrador");
      await p.waitForSelector(".doc-tit h1.mono");
      assert.equal(await p.inputValue("#tipo-documento"), "RECI", "el tipo quedó guardado");
      assert.ok(await p.locator('[data-panel="tipo-sin-certificacion"]').isVisible(), "un recibo no ofrece enviar a certificación"); assert.equal(await p.locator("#enviar").count(), 0); assert.equal(await p.locator('[data-panel="digifact-test"]').count(), 0);
      await p.click("#previa-titulo"); await p.waitForSelector('.papel[data-vista="previa"]');
      const papel = await p.locator('.papel[data-vista="previa"]').innerText();
      assert.match(papel, /Recibo/); assert.match(papel, /NO es una factura/i); assert.match(papel, /EN PRUEBAS/); assert.doesNotMatch(papel, /Factura · /, "el título ya no dice Factura");
      await p.keyboard.press("Escape"); await p.waitForSelector(".previa-modal", { state: "detached" }).catch(() => {});
      await sinDesborde(p, `recibo ${donde}`);
      // cambiar el tipo mientras es editable: a Factura (se quita el panel del recibo) y de nuevo a Recibo
      await p.selectOption("#tipo-documento", "FACT"); await p.locator(".card-tipo").waitFor({ state: "detached" }); await p.selectOption("#tipo-documento", "RECI"); await p.waitForSelector('.card-tipo[data-tipo="RECI"]');
      assert.equal(await p.inputValue("#tipo-recibo"), "", "al cambiar de tipo se limpia lo que no corresponde");
      await p.selectOption("#tipo-recibo", "Universidad"); await p.click("#guardar"); await toast(p, "guardado"); assert.equal(await p.inputValue("#tipo-recibo"), "Universidad");
      // ================= 4. nota de crédito: exige un documento de origen certificado
      await p.goto(srv.url + "/#/nueva"); await p.reload(); await esperarNueva(p); await p.selectOption("#tipo-documento", "NCRE"); await p.waitForSelector("#origen-lista");
      await p.locator("#origen-lista option", { hasText: "No hay documentos certificados" }).waitFor({ state: "attached", timeout: 15000 });
      assert.ok(await p.locator('input[aria-label="Identificación del receptor"]').isDisabled(), "en una nota el receptor no se escribe: es el del origen");
      await agregarConcepto(p); await p.fill("#motivo-ajuste", "Devolución de mercadería"); await p.click("#guardar"); assert.match(await p.locator(".area-msg, .validacion").first().innerText(), /origen/i, "sin origen no se guarda");
      const o = await certificado(p, "a"); await p.goto(srv.url + "/#/nueva"); await p.reload(); await esperarNueva(p); await p.selectOption("#tipo-documento", "NCRE"); await p.waitForSelector("#origen-lista");
      await p.locator("#origen-lista option", { hasText: o.serie }).first().waitFor({ state: "attached", timeout: 8000 });
      await p.selectOption("#origen-lista", o.id); await p.waitForSelector('[data-origen="1"]'); assert.match(await p.locator('[data-origen="1"]').innerText(), new RegExp(o.serie));
      assert.match(await p.locator(".rc-card").innerText(), new RegExp(o.cliente.slice(0, 8)), "el receptor se toma del documento de origen");
      await agregarConcepto(p); await p.fill("#motivo-ajuste", "Devolución de mercadería"); await p.click("#guardar"); await toast(p, "guardado"); await p.waitForSelector(".doc-tit h1.mono");
      assert.equal(await p.inputValue("#tipo-documento"), "NCRE"); assert.match(await p.locator('[data-origen="1"]').innerText(), new RegExp(o.numero));
      await p.click("#previa-titulo"); await p.waitForSelector('.papel[data-vista="previa"]');
      const pn = await p.locator('.papel[data-vista="previa"]').innerText(); assert.match(pn, /Nota de crédito/); assert.match(pn, new RegExp(`serie ${o.serie}`)); assert.match(pn, /Devolución de mercadería/);
      await p.keyboard.press("Escape"); await p.waitForSelector(".previa-modal", { state: "detached" }).catch(() => {});
      const idNota = new URL(p.url()).hash.split("/").pop();
      const pdf = await p.evaluate(async (id) => { const r = await fetch(`/api/documentos/${id}/pdf-demo?formato=carta`, { headers: { "x-demo": "1" } }); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, texto: new TextDecoder("latin1").decode(b) }; }, idNota);
      assert.equal(pdf.status, 200); assert.match(pdf.texto, /^%PDF/); assert.match(pdf.texto, /NOTA DE CR/); assert.match(pdf.texto, /Hace referencia a FACT/); assert.match(pdf.texto, /EN PRUEBAS/);
      await sinDesborde(p, `nota ${donde}`);
      // volver a Factura mientras es borrador: se limpian el origen y el motivo y el receptor vuelve a ser editable
      await p.selectOption("#tipo-documento", "FACT"); await p.locator(".card-tipo").waitFor({ state: "detached" }); assert.equal(await p.locator('input[aria-label="Identificación del receptor"]').isDisabled(), false);
      await p.click("#guardar"); await toast(p, "guardado"); assert.equal(await p.inputValue("#tipo-documento"), "FACT");
      // ================= 5. historial: tipo en cada fila y filtro por tipo
      await p.goto(srv.url + "/#/"); await p.locator("details.filtros-mas summary").click(); await p.locator("#filtro-tipo option").nth(1).waitFor({ state: "attached" }); await p.locator("#filtro-tipo").waitFor({ state: "visible" }); await p.locator('.pestana[data-categoria="borradores"]').click(); await p.waitForFunction(() => !document.querySelector(".lista[aria-busy]"));
      const opts = (await p.locator("#filtro-tipo option").allInnerTexts()).map((t) => t.trim().replace(/\s*\(\d+\)$/, "")); assert.ok(opts.includes("Recibo") && opts.includes("Factura"), JSON.stringify(opts));
      await p.selectOption("#filtro-tipo", "RECI"); await p.waitForFunction(() => !document.querySelector(".lista[aria-busy]")); assert.ok((await p.locator('.fila-fac [data-tipo="RECI"]').count()) >= 1); assert.equal(await p.locator('.fila-fac:not(:has([data-tipo="RECI"]))').count(), 0, "el filtro solo deja recibos");
      assert.match(await p.locator("h1, .ph-t").first().innerText(), /Documentos/); await sinDesborde(p, `historial ${donde}`);
      // ================= 6. configuración por empresa
      await p.goto(srv.url + "/#/config"); await p.waitForSelector('[data-tab="tipos"]'); await p.click('[data-tab="tipos"]'); await p.waitForSelector('[data-tipo-cfg="FACT"]');
      for (const c of ["FACT", "NCRE", "NDEB", "RECI"]) assert.ok(await p.locator(`[data-tipo-cfg="${c}"]`).isVisible(), c);
      assert.match(await p.locator('[data-tipo-cfg="FCAM"]').innerText(), /No disponible/); assert.equal(await p.locator('[data-tipo-cfg="FCAM"] input[type=checkbox]').count(), 0, "un pendiente no se puede habilitar");
      await p.check('input[aria-label="Habilitar Nota de débito"]'); await toast(p, "Configuración guardada");
      await p.waitForSelector('[data-tipo-cfg="NDEB"]'); assert.equal(await p.locator('input[aria-label="Habilitar Nota de débito"]').isChecked(), true);
      await p.check('input[aria-label="Nota de crédito como tipo predeterminado"]'); await toast(p, "Configuración guardada");
      await sinDesborde(p, `configuración de tipos ${donde}`);
      await p.goto(srv.url + "/#/nueva"); await p.reload(); await esperarNueva(p); await p.waitForSelector("#tipo-documento"); assert.equal(await p.inputValue("#tipo-documento"), "NCRE", "el predeterminado de la empresa se propone al crear");
      await p.selectOption("#tipo-documento", "FACT"); await p.locator(".card-tipo").waitFor({ state: "detached" });
    }
    // ================= 7. móvil con selector y panel: sin desborde
    { const p = await ctxPag(390); await entrar(p); await p.goto(srv.url + "/#/nueva"); await esperarNueva(p); await p.waitForSelector("#tipo-documento");
      await p.selectOption("#tipo-documento", "RECI"); await p.waitForSelector(".card-tipo"); await sinDesborde(p, "móvil recibo");
      await p.selectOption("#tipo-documento", "NCRE"); await p.waitForSelector("#origen-lista"); await sinDesborde(p, "móvil nota"); }
    assert.deepEqual(errores, [], "errores de la página:\n" + errores.join("\n"));
    console.log("OK e2e_tipos: Nuevo documento, selector compacto, recibo, nota con origen, cambio de tipo, vista previa y PDF, historial y configuración (390 y 1100 px)");
  } finally { await nav.close(); srv.parar(); }
})().catch((e) => { console.error(e); process.exit(1); });
