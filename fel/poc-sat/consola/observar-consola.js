// === NEXA FEL · observación de solo lectura (consola de Chrome) ===
// No hace peticiones, no escribe en la página, no hace clic, no lee valores de campos, cookies ni tokens. Solo describe qué controles existen.
(() => {
  const recoger = function recoger({ incluirOpciones }) {
  const txt = (s, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
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
    const texto = esBoton ? txt(el.innerText || el.value || el.getAttribute("aria-label")) : "";
    const o = {
      tag, type, rol: rolDe(el), visible: visible(el), deshabilitado: !!el.disabled, soloLectura: !!el.readOnly, requerido: !!(el.required || el.getAttribute("aria-required") === "true"),
      enFormulario: !!el.closest("form"), etiqueta: etiquetaDe(el), texto, titulo: txt(el.getAttribute("title")), nombre: txt(el.getAttribute("name")), id: idGenerado(el.id) ? "" : txt(el.id),
      id_generado: !!el.id && idGenerado(el.id), marcador: txt(el.getAttribute("placeholder")), href: el.tagName === "A" ? txt(el.getAttribute("href"), 120) : "",
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
  const pathDe = (a) => { try { return new URL(a, location.href).pathname; } catch { return ""; } };
  const formularios = [...document.forms].map((f) => ({ id: f.id && !idGenerado(f.id) ? txt(f.id, 40) : "", id_generado: !!f.id && idGenerado(f.id), metodo: (f.method || "get").toLowerCase(), accion_ruta: pathDe(f.getAttribute("action") || ""), controles: f.elements.length }));
  const cuentaSel = (q) => document.querySelectorAll(q).length;
  const componentes = { selectonemenu: cuentaSel(".ui-selectonemenu"), autocomplete: cuentaSel(".ui-autocomplete"), calendario: cuentaSel(".ui-datepicker,.hasDatepicker,.ui-calendar"), tabla: cuentaSel(".ui-datatable"), dialogo: cuentaSel(".ui-dialog"), pestanas: cuentaSel(".ui-tabview"), asistente: cuentaSel(".ui-wizard"), subida_archivo: cuentaSel(".ui-fileupload"), spinner: cuentaSel(".ui-spinner"), ocultos_accesibles: cuentaSel(".ui-helper-hidden-accessible input,.ui-helper-hidden-accessible select,.ui-helper-hidden-accessible textarea") };
  if (document.querySelector('input[name$="ViewState"]') || window.jsf || window.mojarra) frameworks.push("jsf");   // solo presencia: el valor del ViewState NUNCA se lee
  if (window.PrimeFaces) frameworks.push("primefaces");
  return { formularios, componentes, controles: datos, shadow_abierto: todos.filter((e) => e.shadowRoot).length, contenteditable: document.querySelectorAll("[contenteditable=true]").length, captcha, frameworks };
};
  const limpiar = (p) => String(p || "").split("?")[0].split("#")[0];
  const top = { host: location.hostname, ruta: limpiar(location.pathname) };
  const salida = {
    version: 1, origen: "consola", pagina: { ...top, titulo: String(document.title || "").slice(0, 80) },
    frames: [{ indice: 0, principal: true, ...top, r: recoger({ incluirOpciones: false }) }],
    marcos_sin_inspeccionar: [...document.querySelectorAll("iframe")].map((f) => { try { const u = new URL(f.src || "about:blank", location.href); return { host: u.hostname, ruta: limpiar(u.pathname) }; } catch { return { host: "", ruta: "" }; } }),
  };
  const json = JSON.stringify(salida);
  try { copy(json); console.log("Copiado al portapapeles (" + json.length + " caracteres). Pégalo en un archivo .json y pásaselo a bin/importar-observacion.mjs"); } catch (e) { console.log(json); }
  return { controles: salida.frames[0].r.controles.length, marcos_sin_inspeccionar: salida.marcos_sin_inspeccionar.length };
})();
