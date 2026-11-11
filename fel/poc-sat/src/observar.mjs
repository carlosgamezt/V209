// Observación (solo lectura): inventario de los controles de la página activa para que una persona construya el mapeo con
// lo que REALMENTE existe. No hace clic, no escribe, no lee valores de campos, no toca cookies ni almacenamiento.
import { clasificarControl, textoProhibido, sanearRuta } from "./guardia.mjs";

/* Se ejecuta DENTRO de la página. Devuelve solo estructura: etiquetas, tipos y atributos; NUNCA el valor de un campo. */
function recoger({ incluirOpciones }) {
  let redactados = 0;   // textos sustituidos por [REDACTADO]: números largos (NIT/DPI/teléfono), correos
  const redactar = (t) => (/\d{6,}|@|\d{4}[\s-]?\d{5}[\s-]?\d{4}|\d{3,4}[\s-]\d{4}/.test(t) ? (redactados++, "[REDACTADO]") : t);
  const txt = (s, n = 80) => redactar(String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n));
  // ruta sin ?consulta, #hash, parámetros de ruta (;jsessionid=…) ni segmentos con aspecto de token/identificador
  const limpiaRuta = (p) => { let r = ""; try { r = new URL(p, location.href).pathname; } catch { return ""; } return r.split("/").map((seg) => { const b = seg.split(";")[0]; return /^[A-Za-z0-9_-]{20,}$/.test(b) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(b) || /^\d{6,}$/.test(b) || b.includes("=") ? ":id" : b; }).join("/").slice(0, 120); };
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const etiquetaDe = (el) => {
    let t = "";
    if (el.labels && el.labels.length) t = [...el.labels].map((l) => l.innerText).join(" ");
    if (!t && el.getAttribute("aria-labelledby")) t = el.getAttribute("aria-labelledby").split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" ");
    if (!t) t = el.getAttribute("aria-label") || "";
    return txt(t);
  };
  const rolDe = (el) => {
    const r = el.getAttribute("role"); if (r) return r;
    const tag = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return ["button", "submit", "reset", "image"].includes(ty) ? "button" : ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ["hidden", "file", "range", "color"].includes(ty) ? "" : "textbox";
    return "";
  };
  const idGenerado = (id) => !id || /^(:r|ember|ng-|mat-|react|rc-|radix|headlessui|[0-9a-f]{8}-[0-9a-f]{4})/i.test(id) || /\d{4,}/.test(id) || /(^|:)j_(idt|id_)\w*/i.test(id);   // incluye los ids autogenerados de JSF (j_idt123)
  const domDe = (el) => { const partes = []; let x = el; for (let i = 0; i < 5 && x && x.nodeType === 1 && x !== document.body; i++) { const cls = [...x.classList].filter((c) => /^(ui-|p-|mat-|ng-)/.test(c)).slice(0, 2).map((c) => "." + c).join(""); partes.unshift(x.tagName.toLowerCase() + (x.id && !idGenerado(x.id) ? "#" + x.id.slice(0, 30) : "") + cls); x = x.parentElement; } return partes.join(" > "); };
  const els = [...document.querySelectorAll("input,select,textarea,button,[role=button],[role=tab],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=textbox]")]
    .filter((el) => !(el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden"));
  const datos = els.map((el) => {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || "").toLowerCase();
    const esBoton = tag === "button" || (tag === "input" && ["submit", "button", "reset", "image"].includes(type)) || ["button", "tab"].includes(el.getAttribute("role") || "");
    const texto = esBoton ? txt(el.innerText || (tag === "input" ? el.value : "") || el.getAttribute("aria-label")) : "";
    const o = {
      tag, type, rol: rolDe(el), visible: visible(el), deshabilitado: !!el.disabled, soloLectura: !!el.readOnly, requerido: !!(el.required || el.getAttribute("aria-required") === "true"),
      enFormulario: !!el.closest("form"), etiqueta: etiquetaDe(el), texto, titulo: txt(el.getAttribute("title")), nombre: txt(el.getAttribute("name")), id: idGenerado(el.id) ? "" : txt(el.id),
      id_generado: !!el.id && idGenerado(el.id), marcador: txt(el.getAttribute("placeholder")), href: el.tagName === "A" ? limpiaRuta(el.getAttribute("href") || "") : "",
      autocompletar: txt(el.getAttribute("autocomplete"), 30),
      dom: domDe(el), clases: [...el.classList].filter((c) => /^(ui-|p-|mat-|ng-)/.test(c)).slice(0, 4),
      ajax: /(PrimeFaces\.ab|mojarra\.ab|jsf\.ajax|PrimeFaces\.cw)/.test((el.getAttribute("onclick") || "") + (el.getAttribute("onchange") || "") + (el.getAttribute("onblur") || "")),   // solo se comprueba la presencia; el texto no se guarda
    };
    if (tag === "select") { o.opciones_n = el.options.length; if (incluirOpciones) o.opciones = [...el.options].slice(0, 30).map((x) => txt(x.textContent, 40)); }
    return o;
  });
  // unicidad de cada candidato dentro de ESTE documento
  const cuenta = (f) => datos.filter(f).length;
  for (const o of datos) {
    const c = [];
    if (o.etiqueta) c.push({ estrategia: "etiqueta", valor: o.etiqueta, exacto: true, unico: cuenta((x) => x.etiqueta === o.etiqueta) === 1 });
    if (o.rol && (o.etiqueta || o.texto)) { const n = o.etiqueta || o.texto; c.push({ estrategia: "rol", rol: o.rol, valor: n, exacto: true, unico: cuenta((x) => x.rol === o.rol && (x.etiqueta || x.texto) === n) === 1 }); }
    if (o.id) c.push({ estrategia: "id", valor: o.id, unico: document.querySelectorAll(`[id="${o.id.replace(/"/g, '\\"')}"]`).length === 1 });
    if (o.nombre) c.push({ estrategia: "nombre", valor: o.nombre, unico: cuenta((x) => x.nombre === o.nombre) === 1 });
    if (o.marcador) c.push({ estrategia: "marcador", valor: o.marcador, exacto: true, unico: cuenta((x) => x.marcador === o.marcador) === 1 });
    o.candidatos = c;
  }
  const todos = [...document.querySelectorAll("*")];
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[class*="captcha" i],[id*="captcha" i]');
  const frameworks = [];
  if (document.querySelector("[ng-version]") || window.angular) frameworks.push("angular");
  if (document.querySelector("[data-reactroot]") || window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size) frameworks.push("react");
  if (window.Vue || document.querySelector("[data-v-app]")) frameworks.push("vue");
  if (window.jQuery) frameworks.push("jquery");
  const pathDe = (a) => limpiaRuta(a);
  const formularios = [...document.forms].map((f) => ({ id: f.id && !idGenerado(f.id) ? txt(f.id, 40) : "", id_generado: !!f.id && idGenerado(f.id), metodo: (f.method || "get").toLowerCase(), accion_ruta: pathDe(f.getAttribute("action") || ""), controles: f.elements.length }));
  const cuentaSel = (q) => document.querySelectorAll(q).length;
  const componentes = { selectonemenu: cuentaSel(".ui-selectonemenu"), autocomplete: cuentaSel(".ui-autocomplete"), calendario: cuentaSel(".ui-datepicker,.hasDatepicker,.ui-calendar"), tabla: cuentaSel(".ui-datatable"), dialogo: cuentaSel(".ui-dialog"), pestanas: cuentaSel(".ui-tabview"), asistente: cuentaSel(".ui-wizard"), subida_archivo: cuentaSel(".ui-fileupload"), spinner: cuentaSel(".ui-spinner"), ocultos_accesibles: cuentaSel(".ui-helper-hidden-accessible input,.ui-helper-hidden-accessible select,.ui-helper-hidden-accessible textarea") };
  if (document.querySelector('input[name$="ViewState"]') || window.jsf || window.mojarra) frameworks.push("jsf");   // solo presencia: el valor del ViewState NUNCA se lee
  if (window.PrimeFaces) frameworks.push("primefaces");
  const marcos = [...document.querySelectorAll("iframe")].map((f) => { try { const u = new URL(f.src || "about:blank", location.href); return { host: u.hostname, ruta: limpiaRuta(u.pathname) }; } catch { return { host: "", ruta: "" }; } });
  return { ruta_pagina: limpiaRuta(location.pathname), titulo_pagina: txt(document.title), marcos, redactados, formularios, componentes, controles: datos, shadow_abierto: todos.filter((e) => e.shadowRoot).length, contenteditable: document.querySelectorAll("[contenteditable=true]").length, captcha, frameworks };
}

/** Mismo criterio que dentro de la página: números largos (NIT/DPI/teléfono) o correos → [REDACTADO]. */
export const redactar = (t) => (/\d{6,}|@|\d{4}[\s-]?\d{5}[\s-]?\d{4}|\d{3,4}[\s-]\d{4}/.test(t) ? "[REDACTADO]" : t);
/* Segunda observación (se ejecuta DENTRO de la página, SOLO LECTURA). Devuelve datos alineados con los controles de recoger():
   atributos ng-* (son nombres de variables/acciones del código de la página, no datos de personas), ayuda adyacente, sección, opciones de listas
   pequeñas y cuántos elementos coinciden con cada selector CSS de la lista cerrada que se le pasa. Nunca lee valores de campos. */
function recogerExtra({ css }) {
  let redactados = 0;
  const redactar = (t) => (/\d{6,}|@|\d{4}[\s-]?\d{5}[\s-]?\d{4}|\d{3,4}[\s-]\d{4}/.test(t) ? (redactados++, "[REDACTADO]") : t);
  const txt = (s, n = 80) => redactar(String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n));
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const SEL = "input,select,textarea,button,[role=button],[role=tab],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=textbox]";
  const els = [...document.querySelectorAll(SEL)].filter((el) => !(el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden"));
  const attr = (el, n) => txt(el.getAttribute(n) ?? el.getAttribute("data-" + n) ?? "", 80);
  const fieldsets = [...document.querySelectorAll("fieldset")];
  const extras = els.map((el) => {
    let ayuda = "", ayuda_nivel = 0, a = el.parentElement;
    for (let i = 1; i <= 3 && a && !ayuda; i++, a = a.parentElement) {
      const b = [...a.querySelectorAll("button[title]")].find((x) => x !== el && (el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (b) { ayuda = txt(b.getAttribute("title")); ayuda_nivel = i; }
    }
    const fs = el.closest("fieldset"), rep = el.closest("[ng-repeat],[data-ng-repeat]"), tr = el.closest("tr"), p = el.parentElement;
    const o = {
      ng: { model: attr(el, "ng-model"), show: attr(el, "ng-show"), hide: attr(el, "ng-hide"), if: attr(el, "ng-if"), disabled: attr(el, "ng-disabled"), click: attr(el, "ng-click"), change: attr(el, "ng-change"), required: attr(el, "ng-required"), repeat: rep ? attr(rep, rep.hasAttribute("ng-repeat") ? "ng-repeat" : "data-ng-repeat") : "" },
      ayuda, ayuda_nivel, fieldset: fs ? fieldsets.indexOf(fs) : -1, leyenda: fs ? txt(fs.querySelector("legend")?.innerText, 50) : "",
      fila: tr ? tr.rowIndex : -1, hermano: p ? Array.prototype.indexOf.call(p.children, el) : -1,
    };
    if (el.tagName === "SELECT" && el.options.length <= 30) o.opciones = [...el.options].map((x) => txt(x.textContent, 40));
    return o;
  });
  const secciones = [...document.querySelectorAll("legend,h1,h2,h3,h4,h5,th")].map((h) => ({ tag: h.tagName.toLowerCase(), texto: txt(h.innerText, 50), visible: visible(h) })).filter((h) => h.texto);
  const comprobaciones = (css || []).map((q) => { let total = 0, visibles = 0; try { const n = [...document.querySelectorAll(q)]; total = n.length; visibles = n.filter(visible).length; } catch (e) { total = -1; } return { css: q, total, visibles }; });
  return { extras, secciones, comprobaciones, angular: (window.angular && window.angular.version && window.angular.version.full) || "", redactados };
}

const sinQuery = (u) => { try { const x = new URL(u); return { host: x.hostname, ruta: sanearRuta(x.pathname) }; } catch { return { host: "", ruta: "" }; } };

/** Recolecta cada marco de la página (solo lectura) y construye el inventario. */
export async function inventariar(page, { incluirOpciones = false } = {}) {
  const frames = [];
  for (const [i, f] of page.frames().entries()) {
    const u = sinQuery(f.url()), base = { indice: i, principal: f === page.mainFrame(), ...u };
    try { frames.push({ ...base, r: await f.evaluate(recoger, { incluirOpciones }) }); } catch (e) { frames.push({ ...base, error: String(e.message ?? e).slice(0, 120) }); }
  }
  return construirInventario({ pagina: { ...sinQuery(page.url()), titulo: redactar(String((await page.title().catch(() => "")) ?? "").replace(/\s+/g, " ").trim().slice(0, 80)) }, frames });
}

/** PURA: arma el inventario a partir de lo recolectado (por Playwright o por el fragmento pegado en la consola de Chrome). */
export function construirInventario({ pagina, frames, origen = "playwright" }) {
  const controles = [], informe = [], formularios = []; let n = 0;
  const comp = {}, marcosMismo = frames.length;
  for (const f of frames) {
    const u = { host: f.host, ruta: f.ruta };
    if (!f.r) { informe.push({ indice: f.indice, principal: !!f.principal, ...u, error: f.error ?? "sin datos" }); continue; }
    const r = f.r;
    informe.push({ indice: f.indice, principal: !!f.principal, ...u, controles: r.controles.length, shadow_abierto: r.shadow_abierto, contenteditable: r.contenteditable, captcha: r.captcha, frameworks: r.frameworks, componentes: r.componentes });
    for (const [k, v] of Object.entries(r.componentes ?? {})) comp[k] = (comp[k] ?? 0) + v;
    for (const fo of r.formularios ?? []) formularios.push({ marco: f.indice, ...fo, accion_ruta: sanearRuta(fo.accion_ruta) });
    for (const c of r.controles) {
      const cl = clasificarControl(c);
      const ex = r.extra?.extras?.[r.controles.indexOf(c)] ?? {};
      const cta = { ...c, ...ex };
      const mismo = (x, tag) => r.controles.filter((y) => y.nombre === x && (!tag || y.tag === tag)).length;
      let cand = c.candidatos.filter((k) => k.estrategia !== "nombre").map((k) => k);
      if (c.nombre && !c.nombre.includes("[REDACTADO]")) cand.push({ estrategia: "nombre", valor: c.nombre, tag: c.tag, unico: mismo(c.nombre, c.tag) === 1, estable: !/^\d+$/.test(c.nombre) });   // nombre solo numérico = id interno de Angular: inestable
      if (ex.ng?.model) { const mismos = r.extra.extras.map((y, j) => ({ y, j })).filter(({ y, j }) => y.ng.model === ex.ng.model && r.controles[j].tag === c.tag), nVis = mismos.filter(({ j }) => r.controles[j].visible).length;
        cand.push({ estrategia: "ng_model", valor: ex.ng.model, tag: c.tag, unico: mismos.length === 1 || (c.visible && nVis === 1), ...(mismos.length > 1 && c.visible && nVis === 1 ? { visible: true } : {}), estable: true }); }
      cand = cand.map((k) => (f.principal ? k : { ...k, marco: { url_contiene: u.host + u.ruta } }));
      controles.push({ n: `c${String(++n).padStart(3, "0")}`, marco: f.indice, ...cta, candidatos: cand, mejor: cand.find((k) => k.unico && k.estable !== false) ?? null, clasificacion: cl.nivel, envia_formulario: cl.envia_formulario, razones: cl.razones });
    }
  }
  const inv = {
    version: 2, origen, generado: new Date().toISOString(), pagina,
    marcos: informe, total_controles: controles.length, formularios, componentes: comp,
    senales_sesion: { campo_clave_visible: controles.some((c) => c.type === "password" && c.visible), nota: "Si esta página es la de inicio de sesión, campo_clave_visible será true. Observa también la página ya con sesión iniciada para elegir un indicador de «sesión activa»." },
    sin_candidato_unico: controles.filter((c) => !c.mejor && c.tag !== "button").length,
    angular: frames.map((f) => f.r?.extra?.angular).find(Boolean) ?? "", secciones: frames.flatMap((f) => f.r?.extra?.secciones ?? []), comprobaciones: frames.flatMap((f) => f.r?.extra?.comprobaciones ?? []),
    con_riesgo_de_emision: controles.filter((c) => c.clasificacion !== "ok").length,
    controles,
    advertencia: "Esta observación no contiene valores de campos, cookies, tokens ni el ViewState. Revísala antes de compartirla: puede contener etiquetas con nombres de tu empresa. No incluye controles dentro de shadow DOM cerrado ni de marcos que Chrome no deje inspeccionar.",
  };
  inv.redactados = frames.reduce((a, f) => a + (f.r?.redactados ?? 0), 0);
  inv.obstaculos = obstaculos(inv, marcosMismo);
  if (inv.redactados) inv.obstaculos.push({ codigo: "textos_redactados", severidad: "info", n: inv.redactados, detalle: "Se sustituyeron por [REDACTADO] textos con números largos o correos (posibles datos personales o fiscales). Revisa de todos modos: los nombres de personas o empresas no se pueden detectar por patrón." });
  return inv;
}

/** PURA: posibles obstáculos para automatizar el llenado, deducidos de lo observado (nada se asume del portal). */
export function obstaculos(inv, nMarcos = inv.marcos.length) {
  const o = [], C = inv.controles, cuenta = (f) => C.filter(f).length, add = (codigo, severidad, n, detalle) => { if (n) o.push({ codigo, severidad, n, detalle }); };
  const campos = C.filter((c) => ["input", "select", "textarea"].includes(c.tag) && c.visible && !["hidden", "submit", "button", "reset", "image"].includes(c.type));
  add("ids_autogenerados", "media", cuenta((c) => c.id_generado), "Controles con id autogenerado (p. ej. j_idt…, números largos): NO se usan como localizador; hay que apoyarse en etiqueta, rol o nombre, y pueden cambiar entre cargas.");
  add("sin_localizador_unico", "alta", campos.filter((c) => !c.mejor).length, "Campos visibles sin ningún localizador único (etiqueta/rol/id/nombre/marcador repetidos o ausentes): hay que decidirlos a mano.");
  add("sin_etiqueta", "media", campos.filter((c) => !c.etiqueta && !c.marcador).length, "Campos visibles sin etiqueta accesible ni marcador: difíciles de identificar de forma estable.");
  const pers = (inv.componentes.selectonemenu ?? 0) + (inv.componentes.autocomplete ?? 0) + (inv.componentes.calendario ?? 0) + (inv.componentes.spinner ?? 0);
  add("componentes_personalizados", "alta", pers, "Componentes JSF/PrimeFaces (desplegables personalizados, autocompletar, calendario, spinner): el paso «seleccionar» solo soporta <select> nativo; probablemente haga falta un tipo de paso nuevo, diseñado tras observar su comportamiento.");
  add("campos_ocultos_accesibles", "info", inv.componentes.ocultos_accesibles ?? 0, "Controles nativos ocultos que respaldan componentes personalizados (no son los que ve la persona).");
  add("envio_ajax", "alta", cuenta((c) => c.ajax), "Controles que disparan peticiones AJAX de JSF/PrimeFaces: la red de solo lectura las bloquea; si un campo hace AJAX al cambiar o al salir de él, el llenado puede romperse. Se verá en «solicitudes bloqueadas».");
  add("botones_que_envian", "info", cuenta((c) => c.envia_formulario), "Botones que pueden enviar un formulario: nunca se pulsan.");
  add("jsf_detectado", "info", inv.marcos.some((m) => (m.frameworks ?? []).some((x) => ["jsf", "primefaces"].includes(x))) ? 1 : 0, "Se detectó JSF/PrimeFaces. El estado de la vista está ligado a la pestaña: no recargar ni abrir el formulario en otra pestaña durante la ejecución.");
  add("tablas_o_asistentes", "media", (inv.componentes.tabla ?? 0) + (inv.componentes.asistente ?? 0) + (inv.componentes.pestanas ?? 0) + (inv.componentes.dialogo ?? 0), "Tablas, asistentes por pasos, pestañas o diálogos: pueden cargar campos de forma dinámica; observa de nuevo tras abrirlos a mano y compara con bin/comparar.mjs.");
  add("subida_de_archivos", "info", inv.componentes.subida_archivo ?? 0, "Hay carga de archivos: la PoC no la automatiza.");
  add("marcos", "media", Math.max(0, nMarcos - 1), "La página tiene marcos (iframes): cada uno se inspecciona por separado; los de otro origen pueden no ser inspeccionables desde la consola.");
  add("marcos_con_error", "alta", inv.marcos.filter((m) => m.error).length, "Marcos que no se pudieron inspeccionar.");
  add("shadow_dom", "alta", inv.marcos.reduce((a, m) => a + (m.shadow_abierto ?? 0), 0), "Shadow DOM abierto: Playwright lo atraviesa, pero este inventario no lista sus controles.");
  add("captcha", "alta", inv.marcos.some((m) => m.captcha) ? 1 : 0, "Se detectó un posible CAPTCHA en la página.");
  add("contenteditable", "media", inv.marcos.reduce((a, m) => a + (m.contenteditable ?? 0), 0), "Editores contenteditable: no son campos de formulario estándar.");
  return o;
}

/** Fragmento de JavaScript para pegar en la consola de Chrome (DevTools) de la pestaña con el formulario. SOLO LECTURA: no hace peticiones, no escribe, no hace clic; copia el resultado al portapapeles. */
/** Fuente de recogerExtra para la versión 3: ng-model completo (hasta 200 caracteres) y texto de opciones SOLO de las listas cuyo ng-model esté en la lista permitida (por defecto ninguna). */
function extraV3Fuente() {
  let f = recogerExtra.toString();
  const reemplazar = (a, b) => { if (f.split(a).length !== 2) throw new Error(`no se pudo derivar la versión 3: ${a.slice(0, 40)}`); f = f.replace(a, b); };
  reemplazar("function recogerExtra({ css })", "function recogerExtra({ css, permitidas })");
  reemplazar('const attr = (el, n) => txt(el.getAttribute(n) ?? el.getAttribute("data-" + n) ?? "", 80);', 'const attr = (el, n) => { const v = String(el.getAttribute(n) ?? el.getAttribute("data-" + n) ?? ""); return txt(n === "ng-model" ? v.slice(0, 200) : v.replace(/([\'"])[^\'"]{6,}\\1/g, "$1…$1"), n === "ng-model" ? 200 : 80); };   // los literales de texto de 6+ caracteres dentro de expresiones ng-* (posibles nombres o mensajes) salen como …');
  reemplazar('if (el.tagName === "SELECT" && el.options.length <= 30) o.opciones = [...el.options].map((x) => txt(x.textContent, 40));', 'if (el.tagName === "SELECT") { o.opciones_n = el.options.length; if ((permitidas || []).includes(o.ng.model)) o.opciones = [...el.options].slice(0, 30).map((x) => txt(x.textContent, 40)); }');
  return f;
}

export function fuenteConsola({ extendido = false, css = [], version = 2, permitidas = [] } = {}) {
  if (extendido && version === 3) {
    for (const q of css) if (!/^[\p{L}\p{N}_\-\[\]="'.:>#*^$~| ,]+$/u.test(q) || /(eval|function|=>|javascript)/i.test(q)) throw new Error(`selector CSS no permitido en la lista cerrada: ${q}`);
    for (const m of permitidas) if (!/^[A-Za-z0-9_.\[\]]+$/.test(m)) throw new Error(`modelo no permitido en la lista de opciones: ${m}`);
    return `// === NEXA FEL · TERCERA observación de solo lectura (consola de Chrome) ===
// No hace peticiones, no escribe en la página, no hace clic, no lee valores de campos, cookies ni tokens. Describe controles, lee atributos ng-* (nombres de
// variables/acciones del código de la página) y cuenta cuántos elementos coinciden con una lista CERRADA de selectores CSS (CSS_A_COMPROBAR).
// NO captura el texto de las opciones de las listas, salvo las de la lista OPCIONES_PERMITIDAS (por defecto vacía): esas opciones pueden contener datos personales.
// Los literales de texto de 6 o más caracteres dentro de expresiones ng-* se sustituyen por … (podrían ser nombres o mensajes).
// Lo único que "escribe" es el portapapeles de tu equipo (copy). Textos con números largos o correos salen como [REDACTADO].
(() => {
  const CSS_A_COMPROBAR = ${JSON.stringify(css, null, 2)};
  const OPCIONES_PERMITIDAS = ${JSON.stringify(permitidas)};
  const recoger = ${recoger.toString()};
  const extra = ${extraV3Fuente()};
  const r = recoger({ incluirOpciones: false }), top = { host: location.hostname, ruta: r.ruta_pagina };
  r.extra = extra({ css: CSS_A_COMPROBAR, permitidas: OPCIONES_PERMITIDAS });
  const salida = { version: 3, origen: "consola", pagina: { ...top, titulo: r.titulo_pagina }, frames: [{ indice: 0, principal: true, ...top, r }], marcos_sin_inspeccionar: r.marcos };
  const json = JSON.stringify(salida);
  try { copy(json); console.log("Copiado al portapapeles (" + json.length + " caracteres). Pégalo en un archivo .json y envíalo tras revisarlo"); } catch (e) { console.log(json); }
  return { controles: r.controles.length, comprobaciones: r.extra.comprobaciones.length, marcos_sin_inspeccionar: r.marcos.length };
})();
`;
  }
  if (extendido) {
    for (const q of css) if (!/^[\p{L}\p{N}_\-\[\]="'.:>#*^$~| ,]+$/u.test(q) || /(eval|function|=>|javascript)/i.test(q)) throw new Error(`selector CSS no permitido en la lista cerrada: ${q}`);
    return `// === NEXA FEL · SEGUNDA observación de solo lectura (consola de Chrome) ===
// No hace peticiones, no escribe en la página, no hace clic, no lee valores de campos, cookies ni tokens. Describe controles y cuenta cuántos elementos
// coinciden con una lista CERRADA de selectores CSS (abajo, en CSS_A_COMPROBAR). Lee atributos ng-* (nombres de variables/acciones del código de la página).
// Lo único que "escribe" es el portapapeles de tu equipo (copy). Textos con números largos o correos salen como [REDACTADO].
(() => {
  const CSS_A_COMPROBAR = ${JSON.stringify(css, null, 2)};
  const recoger = ${recoger.toString()};
  const extra = ${recogerExtra.toString()};
  const r = recoger({ incluirOpciones: false }), top = { host: location.hostname, ruta: r.ruta_pagina };
  r.extra = extra({ css: CSS_A_COMPROBAR });
  const salida = { version: 2, origen: "consola", pagina: { ...top, titulo: r.titulo_pagina }, frames: [{ indice: 0, principal: true, ...top, r }], marcos_sin_inspeccionar: r.marcos };
  const json = JSON.stringify(salida);
  try { copy(json); console.log("Copiado al portapapeles (" + json.length + " caracteres). Pégalo en un archivo .json y pásaselo a bin/importar-observacion.mjs"); } catch (e) { console.log(json); }
  return { controles: r.controles.length, comprobaciones: r.extra.comprobaciones.length, marcos_sin_inspeccionar: r.marcos.length };
})();
`;
  }
  return `// === NEXA FEL · observación de solo lectura (consola de Chrome) ===
// No hace peticiones, no escribe en la página, no hace clic, no lee valores de campos, cookies ni tokens. Solo describe qué controles existen.
// Lo único que "escribe" es el portapapeles de tu equipo (copy) con el inventario. Textos con números largos o correos salen como [REDACTADO].
(() => {
  const recoger = ${recoger.toString()};
  const r = recoger({ incluirOpciones: false }), top = { host: location.hostname, ruta: r.ruta_pagina };
  const salida = { version: 1, origen: "consola", pagina: { ...top, titulo: r.titulo_pagina }, frames: [{ indice: 0, principal: true, ...top, r }], marcos_sin_inspeccionar: r.marcos };
  const json = JSON.stringify(salida);
  try { copy(json); console.log("Copiado al portapapeles (" + json.length + " caracteres). Pégalo en un archivo .json y pásaselo a bin/importar-observacion.mjs"); } catch (e) { console.log(json); }
  return { controles: salida.frames[0].r.controles.length, marcos_sin_inspeccionar: salida.marcos_sin_inspeccionar.length };
})();
`;
}

/** Borrador de mapeo A PARTIR de lo observado. Todo sale con verificado=false y dato=null: una persona decide qué dato va en cada campo y lo confirma. */
export function borradorMapeo(inv) {
  const omitidos = [], pasos = [{ id: "p000-sesion", tipo: "manual", instruccion: "Abre tú mismo el formulario FEL de PRUEBA en la sesión ya iniciada (sin emitir) y pulsa Enter." }];
  for (const c of inv.controles) {
    if (!["input", "select", "textarea"].includes(c.tag) || !c.visible || c.deshabilitado || c.soloLectura) continue;
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(c.type)) { if (c.type === "password") omitidos.push({ n: c.n, motivo: "campo de contraseña: nunca se automatiza" }); continue; }
    if (c.clasificacion === "prohibido" || c.envia_formulario) { omitidos.push({ n: c.n, motivo: c.razones.join("; ") }); continue; }
    if (!c.mejor) { omitidos.push({ n: c.n, motivo: "sin localizador único: hay que decidirlo a mano" }); continue; }
    const tipo = c.tag === "select" ? "seleccionar" : ["checkbox", "radio"].includes(c.type) ? "marcar" : "llenar";
    pasos.push({ id: `p${String(pasos.length).padStart(3, "0")}-${c.n}`, tipo, comentario: `observado: ${c.etiqueta || c.marcador || c.nombre || c.id}`, localizador: c.mejor, dato: null, verificado: false });
  }
  pasos.push({ id: "p999-detener", tipo: "detener" });
  const dominios = [...new Set(inv.marcos.filter((m) => m.principal && m.host).map((m) => m.host))];
  return { version: 1, comentario: "BORRADOR generado a partir de una observación. Rellena «dato» con rutas del archivo de datos ficticios, confirma cada localizador contra el portal real y cambia verificado a true. Confirma también dominios_permitidos y completa «sesion» con lo que observes (páginas de inicio de sesión e indicadores de sesión activa; ninguno se inventa).", dominios_permitidos: dominios, permitir_post: [], sesion: { hosts_login: [], rutas_login: [], indicadores_sesion_activa: [], indicadores_login: [], campo_clave_visible: true }, pasos, omitidos_por_riesgo: omitidos };
}
export const controlesDeRiesgo = (inv) => inv.controles.filter((c) => c.clasificacion !== "ok").map((c) => ({ n: c.n, texto: c.texto || c.etiqueta, nivel: c.clasificacion, razones: c.razones }));
export { textoProhibido };
