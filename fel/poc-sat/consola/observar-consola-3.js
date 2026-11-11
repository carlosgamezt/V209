// === NEXA FEL · TERCERA observación de solo lectura (consola de Chrome) ===
// No hace peticiones, no escribe en la página, no hace clic, no lee valores de campos, cookies ni tokens. Describe controles, lee atributos ng-* (nombres de
// variables/acciones del código de la página) y cuenta cuántos elementos coinciden con una lista CERRADA de selectores CSS (CSS_A_COMPROBAR).
// NO captura el texto de las opciones de las listas, salvo las de la lista OPCIONES_PERMITIDAS (por defecto vacía): esas opciones pueden contener datos personales.
// Los literales de texto de 6 o más caracteres dentro de expresiones ng-* se sustituyen por … (podrían ser nombres o mensajes).
// Lo único que "escribe" es el portapapeles de tu equipo (copy). Textos con números largos o correos salen como [REDACTADO].
(() => {
  const CSS_A_COMPROBAR = [
  "input[name=\"Cantidad0\"]",
  "select[name=\"BienOServicio0\"]",
  "input[name=\"Descripcion0\"]",
  "select[name=\"Descripcion0\"]",
  "input[name=\"PrecioUnitario0\"]",
  "input[name=\"Descuento0\"]",
  "input[name=\"OtrosDescuento0\"]",
  "input[name=\"Total0\"]",
  "select[name=\"CodigoProducto0\"]",
  "input[name=\"Observaciones0\"]",
  "input[name^=\"Cantidad\"]",
  "tbody tr.ng-scope",
  "table",
  "button[title=\"NIT del Receptor\"]",
  "button[title=\"Dirección del Receptor\"]",
  "button[title=\"Fecha Emisión\"]",
  "button[title=\"Editar impuestos\"]",
  "button[title=\"Eliminar item\"]",
  "input[type=\"radio\"]",
  "[role=\"tab\"]",
  "[ng-model]",
  "input[ng-model]",
  "select[ng-model]",
  "[ng-repeat]",
  "[ng-click]",
  "fieldset",
  "legend",
  "[ng-show]",
  "[ng-hide]"
];
  const OPCIONES_PERMITIDAS = [];
  const recoger = function recoger({ incluirOpciones }) {
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
};
  const extra = function recogerExtra({ css, permitidas }) {
  let redactados = 0;
  const redactar = (t) => (/\d{6,}|@|\d{4}[\s-]?\d{5}[\s-]?\d{4}|\d{3,4}[\s-]\d{4}/.test(t) ? (redactados++, "[REDACTADO]") : t);
  const txt = (s, n = 80) => redactar(String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n));
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const SEL = "input,select,textarea,button,[role=button],[role=tab],[role=combobox],[role=checkbox],[role=radio],[role=switch],[role=textbox]";
  const els = [...document.querySelectorAll(SEL)].filter((el) => !(el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden"));
  const attr = (el, n) => { const v = String(el.getAttribute(n) ?? el.getAttribute("data-" + n) ?? ""); return txt(n === "ng-model" ? v.slice(0, 200) : v.replace(/(['"])[^'"]{6,}\1/g, "$1…$1"), n === "ng-model" ? 200 : 80); };   // los literales de texto de 6+ caracteres dentro de expresiones ng-* (posibles nombres o mensajes) salen como …
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
    if (el.tagName === "SELECT") { o.opciones_n = el.options.length; if ((permitidas || []).includes(o.ng.model)) o.opciones = [...el.options].slice(0, 30).map((x) => txt(x.textContent, 40)); }
    return o;
  });
  const secciones = [...document.querySelectorAll("legend,h1,h2,h3,h4,h5,th")].map((h) => ({ tag: h.tagName.toLowerCase(), texto: txt(h.innerText, 50), visible: visible(h) })).filter((h) => h.texto);
  const comprobaciones = (css || []).map((q) => { let total = 0, visibles = 0; try { const n = [...document.querySelectorAll(q)]; total = n.length; visibles = n.filter(visible).length; } catch (e) { total = -1; } return { css: q, total, visibles }; });
  return { extras, secciones, comprobaciones, angular: (window.angular && window.angular.version && window.angular.version.full) || "", redactados };
};
  const r = recoger({ incluirOpciones: false }), top = { host: location.hostname, ruta: r.ruta_pagina };
  r.extra = extra({ css: CSS_A_COMPROBAR, permitidas: OPCIONES_PERMITIDAS });
  const salida = { version: 3, origen: "consola", pagina: { ...top, titulo: r.titulo_pagina }, frames: [{ indice: 0, principal: true, ...top, r }], marcos_sin_inspeccionar: r.marcos };
  const json = JSON.stringify(salida);
  try { copy(json); console.log("Copiado al portapapeles (" + json.length + " caracteres). Pégalo en un archivo .json y envíalo tras revisarlo"); } catch (e) { console.log(json); }
  return { controles: r.controles.length, comprobaciones: r.extra.comprobaciones.length, marcos_sin_inspeccionar: r.marcos.length };
})();
