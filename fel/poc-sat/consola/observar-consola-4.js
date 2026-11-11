// === NEXA FEL · O-1 · manejadores de eventos (consola de Chrome) · SOLO LECTURA ===
// Qué hace: lista, por cada control del formulario, QUÉ TIPOS de evento tienen manejadores y QUÉ FUNCIONES invocan (solo nombres de funciones).
// Fuentes que lee: atributos ng-* / on* del DOM, getEventListeners() (API de la consola de DevTools), jQuery._data(el,"events") y la estructura de scopes y
// watchers de AngularJS (solo la expresión simple y los nombres de funciones que llama el código del watcher).
// Qué NO hace: no pulsa nada, no escribe en ningún campo, no dispara ni crea eventos, no enfoca ni desenfoca, no hace peticiones de red, no usa
// cookies, almacenamiento local, tokens ni cabeceras, no toca $http, no ejecuta ninguna función de la página, no llama a copy() ni escribe en el portapapeles,
// no deja variables globales ni modifica el DOM. NO LEE valores de campos, casillas marcadas, textos de opciones, contenido de celdas ni los valores
// de los watchers; los literales de texto dentro de expresiones se sustituyen por «…» y los números largos o correos salen como [REDACTADO].
// Salida: UNA línea en la consola que empieza por «NEXA-O1 » seguida de un JSON. Cópiala con clic derecho → «Copy string contents» (no aparece en pantalla completa).
// IMPORTANTE: elige en el selector de contexto de la consola («top») el marco del formulario (felav.c.sat.gob.gt), no el menú.
(() => {
  "use strict";
  const MAX_CONTROLES = 400, MAX_NOMBRES = 25, MAX_WATCHERS = 600, MAX_SCOPES = 500, MAX_FUENTE = 20000;
  let redactados = 0;
  const redactar = (t) => (/\d{6,}|@|\d{4}[\s-]?\d{5}[\s-]?\d{4}|\d{3,4}[\s-]\d{4}/.test(t) ? (redactados++, "[REDACTADO]") : t);
  const txt = (s, n = 80) => redactar(String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n));
  const sinLiterales = (s) => String(s).slice(0, MAX_FUENTE).replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
  const limpiaExpr = (s, n = 200) => txt(String(s).replace(/(["'])(?:\\.|(?!\1)[^\\]){6,}\1/g, "'…'"), n);
  const limpiaRuta = (p) => { let r = ""; try { r = new URL(p, location.href).pathname; } catch (e) { return ""; } return r.split("/").map((seg) => { const b = seg.split(";")[0]; return /^[A-Za-z0-9_-]{20,}$/.test(b) || /^\d{6,}$/.test(b) || b.indexOf("=") >= 0 ? ":id" : b; }).join("/"); };
  const PALABRAS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "with", "else", "do"]);
  const llamadas = (src) => {
    const nombres = [], visto = new Set(), re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3})\s*\(/g, base = sinLiterales(src);
    let m;
    while ((m = re.exec(base)) && nombres.length < MAX_NOMBRES) { const n = m[1].slice(0, 60); if (!PALABRAS.has(n) && !visto.has(n)) { visto.add(n); nombres.push(n); } }
    return nombres;
  };
  const nombreDe = (f) => (typeof f === "function" ? (f.name ? txt(f.name, 60) : "(anónima)") : "(no función)");
  const infoFuncion = (f) => {
    if (typeof f !== "function") return { nombre: "(no función)" };
    let fuente = ""; try { fuente = Function.prototype.toString.call(f); } catch (e) { fuente = ""; }
    return { nombre: nombreDe(f), nativa: /\[native code\]/.test(fuente), llama_a: /\[native code\]/.test(fuente) ? [] : llamadas(fuente) };
  };

  const ATRIBUTOS_EVENTO = ["ng-change", "ng-blur", "ng-focus", "ng-keyup", "ng-keydown", "ng-keypress", "ng-click", "ng-dblclick", "ng-mousedown", "ng-mouseup", "ng-mouseover", "ng-mouseenter", "ng-mouseleave", "ng-submit", "ng-paste", "ng-copy", "ng-cut", "ng-init"];
  const norm = (a) => a.replace(/^(data|x)-/, "");
  const atributosDe = (el) => {
    const out = {}, nativos = {};
    for (const a of el.getAttributeNames()) {
      const n = norm(a);
      if (ATRIBUTOS_EVENTO.indexOf(n) >= 0) out[n] = { llama_a: llamadas(el.getAttribute(a)) };
      else if (/^on[a-z]+$/.test(a)) nativos[a] = { llama_a: llamadas(el.getAttribute(a)) };
      else if (n === "ng-model-options") { const v = el.getAttribute(a) || "", d = /debounce\s*:\s*(\d{1,5})/.exec(v), u = /updateOn\s*:\s*['"]([\w\s]{1,30})['"]/.exec(v); out["ng-model-options"] = { debounce_ms: d ? Number(d[1]) : null, updateOn: u ? u[1] : null }; }
    }
    return { ng: out, atributos_on: nativos };
  };

  const hayGEL = typeof getEventListeners === "function";   // solo existe en la consola de DevTools
  const jq = window.jQuery || (window.$ && window.$.fn && window.$.fn.jquery ? window.$ : null);
  const hayJQData = !!(jq && typeof jq._data === "function");
  const ang = window.angular || null;

  const escuchasNativas = (obj) => {
    if (!hayGEL) return null;
    let l; try { l = getEventListeners(obj); } catch (e) { return null; }
    const out = {};
    for (const tipo of Object.keys(l)) out[tipo] = l[tipo].slice(0, 20).map((x) => ({ captura: !!x.useCapture, pasivo: !!x.passive, una_vez: !!x.once, ...infoFuncion(x.listener) }));
    return out;
  };
  const escuchasJQuery = (obj) => {
    if (!hayJQData) return null;
    let ev; try { ev = jq._data(obj, "events"); } catch (e) { return null; }
    if (!ev) return {};
    const out = {};
    for (const tipo of Object.keys(ev)) out[tipo] = Array.prototype.slice.call(ev[tipo], 0, 20).map((h) => ({ espacio: txt(h.namespace || "", 40), selector_delegado: h.selector ? txt(h.selector, 80) : null, ...infoFuncion(h.handler) }));
    return out;
  };

  // ---- Controles ----
  const CSS_CONTROLES = "input,select,textarea,button,form,a[ng-click],[ng-click],[ng-change],[ng-blur],[ng-focus],[ng-keyup],[ng-submit],[onclick],[onchange],[onblur],[onfocus],[data-ng-click],[data-ng-change]";
  const todos = Array.prototype.slice.call(document.querySelectorAll(CSS_CONTROLES));
  const controles = [];
  const escopesVistos = new Map();
  const idScope = (s) => { if (!s) return null; const k = s.$id; if (!escopesVistos.has(k)) escopesVistos.set(k, s); return k; };
  for (const el of todos.slice(0, MAX_CONTROLES)) {
    const tag = el.tagName.toLowerCase(), boton = tag === "button" || tag === "a";
    const modelo = el.getAttribute("ng-model") || el.getAttribute("data-ng-model");
    const at = atributosDe(el);
    let sc = null; if (ang) { try { const w = ang.element(el); sc = typeof w.scope === "function" ? w.scope() : null; } catch (e) { sc = null; } }
    const c = {
      tag, tipo: tag === "input" ? txt(el.getAttribute("type") || "text", 20) : null, name: el.getAttribute("name") ? txt(el.getAttribute("name"), 60) : null, id: el.id ? txt(el.id, 60) : null,
      ng_model: modelo ? limpiaExpr(modelo) : null, titulo: boton && el.getAttribute("title") ? txt(el.getAttribute("title"), 40) : null,
      visible: el.getClientRects().length > 0, deshabilitado_attr: el.hasAttribute("disabled"), solo_lectura_attr: el.hasAttribute("readonly"),
      scope: idScope(sc), ng: at.ng, atributos_on: at.atributos_on, nativos: escuchasNativas(el), jquery: escuchasJQuery(el),
    };
    if (tag === "form") { c.form = { accion: el.getAttribute("action") ? limpiaRuta(el.getAttribute("action")) : null, metodo: txt(el.getAttribute("method") || "", 10) }; }
    controles.push(c);
  }

  // ---- Objetivos globales (manejadores delegados) ----
  const globales = {};
  for (const [nombre, obj] of [["window", window], ["document", document], ["documentElement", document.documentElement], ["body", document.body]]) { if (obj) globales[nombre] = { nativos: escuchasNativas(obj), jquery: escuchasJQuery(obj) }; }

  // ---- AngularJS: scopes y watchers (sin leer valores) ----
  let angular_info = null;
  if (ang) {
    const raiz = document.querySelector("[ng-app],[data-ng-app]") || document.documentElement;
    let sraiz = null; try { const w = ang.element(raiz); sraiz = typeof w.scope === "function" ? w.scope() : null; } catch (e) { sraiz = null; }
    angular_info = { version: txt((ang.version && ang.version.full) || "", 20), debug_info: !!sraiz, scopes: [], watchers: [], watchers_por_llamada: {}, truncado: false };
    if (sraiz) {
      const cola = [sraiz.$root || sraiz]; let n = 0;
      while (cola.length) {
        const s = cola.shift(); if (n++ >= MAX_SCOPES) { angular_info.truncado = true; break; }
        const funciones = Object.keys(s).filter((k) => typeof s[k] === "function" && k.charAt(0) !== "$" && k !== "constructor").slice(0, 150).map((k) => txt(k, 60));
        const ws = s.$$watchers || [];
        angular_info.scopes.push({ id: s.$id, padre: s.$parent ? s.$parent.$id : null, funciones, n_watchers: ws.length });
        for (const w of ws) {
          if (angular_info.watchers.length >= MAX_WATCHERS) { angular_info.truncado = true; break; }
          const exp = typeof w.exp === "string" ? (/^[\w$.\[\]'"]{1,120}$/.test(w.exp) ? limpiaExpr(w.exp, 120) : "(expresión compleja)") : (typeof w.exp === "function" ? "(función " + nombreDe(w.exp) + ")" : "(otro)");
          const f = infoFuncion(w.fn), calls = f.llama_a;
          for (const k of calls) angular_info.watchers_por_llamada[k] = (angular_info.watchers_por_llamada[k] || 0) + 1;
          angular_info.watchers.push({ scope: s.$id, exp, profundo: !!w.eq, funcion: f.nombre, llama_a: calls });
        }
        for (let h = s.$$childHead; h; h = h.$$nextSibling) cola.push(h);
      }
    }
  }
  // asocia a cada scope vigente solo los datos ya contenidos arriba (sin tocar el scope de los controles otra vez)
  const salida = {
    version: 4, generado: "lectura", marco: { host: txt(location.hostname, 80), ruta: limpiaRuta(location.href), en_iframe: window !== window.top },
    herramientas: { getEventListeners: hayGEL, jquery: jq ? txt(jq.fn && jq.fn.jquery, 20) : null, jquery_data: hayJQData, angular: ang ? txt((ang.version && ang.version.full) || "sí", 20) : null },
    totales: { controles_encontrados: todos.length, controles_listados: controles.length },
    controles, globales, angular: angular_info, redactados,
  };
  console.log("NEXA-O1 " + JSON.stringify(salida));
  console.info("NEXA-O1: listo (" + controles.length + " controles; getEventListeners " + (hayGEL ? "disponible" : "NO disponible: abre esto en la consola de DevTools") + "). No se escribió ni se pulsó nada.");
})();
