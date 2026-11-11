// === NEXA FEL · O-1 MÍNIMO (consola de Chrome) · SOLO LECTURA ===
// Registra ÚNICAMENTE: (a) qué TIPOS de evento tienen manejadores y (b) qué POSIBLES MECANISMOS de autoguardado/envío aparecen en el código de esos manejadores.
// NO registra: nombres de funciones, de campos ni de variables, ids, selectores, ng-model, títulos, textos, valores, NIT, datos personales o fiscales, cookies,
// tokens, cabeceras ni URL. La salida son solo contadores y etiquetas FIJAS definidas aquí (no leídas del portal) más el número de versión de las librerías.
// NO ejecuta funciones del formulario (lee su texto con Function.prototype.toString, sin llamarlas, y no invoca getters), NO modifica el DOM, NO dispara ni crea eventos,
// NO enfoca, NO hace peticiones, NO instala interceptores ni observadores, NO usa temporizadores, NO deja procesos ni variables globales, NO usa el portapapeles.
// Las únicas funciones ajenas al formulario que llama son las de las propias herramientas: getEventListeners (DevTools), jQuery._data y angular.element(...).scope() (lecturas).
// Salida: UNA línea «NEXA-O1M {json}». Cópiala con clic derecho → «Copy string contents». Elige antes en la consola el marco del formulario (felav.c.sat.gob.gt).
(() => {
  "use strict";
  const MAX_ELEMENTOS = 600, MAX_SCOPES = 500, MAX_WATCHERS = 800, MAX_FUENTE = 20000, PROFUNDIDAD = 3;
  // PATRONES-INICIO
  const PATRONES = {
    http: /\$http|\$resource|XMLHttpRequest|\bfetch\s*\(|\.ajax\s*\(|\$\.(?:get|post)\s*\(|getJSON/,
    envio_beacon: /sendBeacon/,
    almacenamiento: /localStorage|sessionStorage|indexedDB|document\.cookie|\$cookies/,
    temporizador: /setTimeout|setInterval|\$timeout|\$interval|requestAnimationFrame/,
    metodo_escritura: /\.(?:post|put|patch|delete)\s*\(|method\s*:\s*["']?(?:POST|PUT|PATCH|DELETE)/i,
    palabra_guardado: /guard|\bsave|autosave|persist|\bsync\b|\bdraft|borrador|emitir|emisi|certific|firma|enviar|\benvio|\bsubmit(?!ted)|transmit|anular|anulaci/i,   // evita falsos positivos del propio AngularJS ($evalAsync, $emit, $submitted…)
    navegacion: /location\.(?:href|assign|replace)|window\.open|\.submit\s*\(/,
  };
  // PATRONES-FIN
  const CATEGORIAS = Object.keys(PATRONES);
  const TIPOS = new Set(["click", "dblclick", "mousedown", "mouseup", "mouseover", "mouseenter", "mouseleave", "focus", "blur", "focusin", "focusout", "input", "change", "keyup", "keydown", "keypress", "paste", "copy", "cut", "submit", "reset", "select", "propertychange", "beforeunload", "unload", "pagehide", "visibilitychange", "online", "offline", "storage", "scroll", "resize", "ajaxStart", "ajaxStop", "ajaxSend", "ajaxComplete", "ajaxSuccess", "ajaxError", "init"]);
  const tipoSeguro = (t) => (TIPOS.has(t) ? t : "otro");
  const dato = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? d.value : undefined; };   // lee propiedades de datos sin invocar getters
  const fuenteDe = (f) => { try { return typeof f === "function" ? Function.prototype.toString.call(f).slice(0, MAX_FUENTE) : ""; } catch (e) { return ""; } };
  const llamadasEn = (src) => { const out = new Set(), re = /([A-Za-z_$][\w$]*)\s*\(/g; let m; const base = String(src).replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "''"); while ((m = re.exec(base)) && out.size < 40) out.add(m[1]); return out; };

  const hayGEL = typeof getEventListeners === "function";
  const jq = window.jQuery || (window.$ && window.$.fn && window.$.fn.jquery ? window.$ : null);
  const hayJQData = !!(jq && typeof jq._data === "function");
  const ang = window.angular || null;
  const version = (v) => (/^\d{1,2}\.\d{1,2}\.\d{1,3}/.test(String(v)) ? String(v).slice(0, 12) : null);

  // ---- Scopes: mapa de funciones (para resolver, SIN ejecutar, qué hace lo que invocan los atributos ng-*) y watchers ----
  const funciones = new Map(), watchersFuente = [], scopes = { total: 0, truncado: false, con_debug: false };
  let nWatchers = 0, nProfundos = 0, nFuncScopeGuardado = 0;
  if (ang) {
    const raiz = document.querySelector("[ng-app],[data-ng-app]") || document.documentElement;
    let s0 = null; try { const w = ang.element(raiz); s0 = typeof w.scope === "function" ? w.scope() : null; } catch (e) { s0 = null; }
    if (s0) {
      scopes.con_debug = true; const cola = [s0.$root || s0];
      while (cola.length) {
        const s = cola.shift(); if (scopes.total++ >= MAX_SCOPES) { scopes.truncado = true; break; }
        for (const k of Object.keys(s)) { if (k.charAt(0) === "$") continue; const f = dato(s, k); if (typeof f === "function") { if (!funciones.has(k)) funciones.set(k, f); if (PATRONES.palabra_guardado.test(k)) nFuncScopeGuardado++; } }
        for (const w of (dato(s, "$$watchers") || [])) { if (nWatchers >= MAX_WATCHERS) { scopes.truncado = true; break; } nWatchers++; if (w.eq) nProfundos++; watchersFuente.push([fuenteDe(w.fn), typeof w.exp === "function" ? fuenteDe(w.exp) : ""]); }
        for (let h = dato(s, "$$childHead"); h; h = dato(h, "$$nextSibling")) cola.push(h);
      }
    }
  }
  // categorías presentes en un texto de código y en las funciones del scope que invoca (hasta PROFUNDIDAD niveles, sin ejecutarlas)
  const categoriasDe = (src) => {
    const cats = new Set(), visto = new Set();
    const rec = (texto, nivel) => {
      for (const c of CATEGORIAS) if (PATRONES[c].test(texto)) cats.add(c);
      if (nivel >= PROFUNDIDAD) return;
      for (const n of llamadasEn(texto)) { if (visto.has(n) || !funciones.has(n)) continue; visto.add(n); rec(fuenteDe(funciones.get(n)), nivel + 1); }
    };
    rec(String(src).slice(0, MAX_FUENTE), 0); return cats;
  };

  // ---- Estructuras de salida (solo contadores) ----
  const nuevoAcum = () => ({ eventos: { nativo: {}, jquery: {}, ng: {} }, mecanismos: {} });
  const suma = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const anota = (acum, origen, tipo, cats) => { const t = tipoSeguro(tipo); suma(acum.eventos[origen], t); const m = (acum.mecanismos[t] = acum.mecanismos[t] || {}); for (const c of cats) suma(m, c); };
  const NG_A_TIPO = { "ng-change": "change", "ng-blur": "blur", "ng-focus": "focus", "ng-click": "click", "ng-dblclick": "dblclick", "ng-keyup": "keyup", "ng-keydown": "keydown", "ng-keypress": "keypress", "ng-submit": "submit", "ng-paste": "paste", "ng-copy": "copy", "ng-cut": "cut", "ng-mousedown": "mousedown", "ng-mouseup": "mouseup", "ng-mouseover": "mouseover", "ng-mouseenter": "mouseenter", "ng-mouseleave": "mouseleave", "ng-init": "init" };

  const clases = {}, cerrados = {}, globales = {};
  // etiquetas FIJAS de la lista cerrada de la Etapa 2 (definidas aquí; no se copia nada del portal)
  const LISTA = [["nit_receptor", (e) => e.getAttribute("ng-model") === "datosGenerales.nitReceptor"], ["direccion_receptor", (e) => e.getAttribute("ng-model") === "datosGenerales.direccionReceptor"], ["tipo_linea0", (e) => e.tagName === "SELECT" && e.getAttribute("name") === "BienOServicio0"], ["cantidad0", (e) => e.tagName === "INPUT" && e.getAttribute("name") === "Cantidad0"], ["descripcion0", (e) => e.tagName === "INPUT" && e.getAttribute("name") === "Descripcion0"], ["precio0", (e) => e.tagName === "INPUT" && e.getAttribute("name") === "PrecioUnitario0"], ["descuento0", (e) => e.tagName === "INPUT" && e.getAttribute("name") === "Descuento0"], ["otros_descuentos0", (e) => e.tagName === "INPUT" && e.getAttribute("name") === "OtrosDescuento0"]];
  const claseDe = (e) => { const t = e.tagName; if (t === "FORM") return "formulario"; if (t === "SELECT") return "lista"; if (t === "BUTTON") return "boton"; if (t === "TEXTAREA") return "texto"; if (t === "INPUT") { const ty = (e.getAttribute("type") || "text").toLowerCase(); return ty === "radio" || ty === "checkbox" ? "radio_casilla" : ty === "button" || ty === "submit" || ty === "image" ? "boton" : "texto"; } return "otro"; };
  const escuchas = (obj) => { if (!hayGEL) return {}; try { return getEventListeners(obj); } catch (e) { return {}; } };
  const eventosJQ = (obj) => { if (!hayJQData) return {}; try { return jq._data(obj, "events") || {}; } catch (e) { return {}; } };
  const recoger = (el, acum) => {
    for (const a of el.getAttributeNames()) {   // atributos ng-* y on*: solo el TIPO de evento y qué mecanismos hay en lo que invocan
      const n = a.replace(/^(data|x)-/, "");
      if (NG_A_TIPO[n]) anota(acum, "ng", NG_A_TIPO[n], categoriasDe(el.getAttribute(a)));
      else if (/^on[a-z]+$/.test(a)) anota(acum, "nativo", a.slice(2), categoriasDe(el.getAttribute(a)));
    }
    const l = escuchas(el); for (const t of Object.keys(l)) for (const x of l[t]) anota(acum, "nativo", t, categoriasDe(fuenteDe(x.listener)));
    const j = eventosJQ(el); for (const t of Object.keys(j)) for (const h of Array.prototype.slice.call(j[t], 0, 40)) anota(acum, "jquery", t, categoriasDe(fuenteDe(h.handler)));
  };
  const todos = Array.prototype.slice.call(document.querySelectorAll("input,select,textarea,button,form,a,[ng-click],[ng-change],[ng-blur],[ng-focus],[ng-keyup],[ng-submit],[onclick],[onchange],[onblur],[onfocus]"));
  for (const el of todos.slice(0, MAX_ELEMENTOS)) {
    const k = claseDe(el); recoger(el, (clases[k] = clases[k] || nuevoAcum()));
    for (const [etq, f] of LISTA) { let ok = false; try { ok = f(el); } catch (e) { ok = false; } if (ok) { const c = (cerrados[etq] = cerrados[etq] || { encontrados: 0, ...nuevoAcum() }); c.encontrados++; recoger(el, c); } }
  }
  for (const [etqg, obj] of [["ventana", window], ["documento", document], ["cuerpo", document.body]]) { if (!obj) continue; const a = nuevoAcum(); const l = escuchas(obj); for (const t of Object.keys(l)) for (const x of l[t]) anota(a, "nativo", t, categoriasDe(fuenteDe(x.listener))); const j = eventosJQ(obj); for (const t of Object.keys(j)) for (const h of Array.prototype.slice.call(j[t], 0, 40)) anota(a, "jquery", t, categoriasDe(fuenteDe(h.handler))); globales[etqg] = a; }

  // ---- Mecanismos de autoguardado a nivel de página (solo presencia/contadores) ----
  const wcon = {}; for (const [fn, ex] of watchersFuente) for (const c of categoriasDe(fn + "\n" + ex)) suma(wcon, c);
  const formularios = Array.prototype.slice.call(document.querySelectorAll("form"));
  const salida = {
    version: 5, nivel: "O-1 mínimo", contexto: { en_iframe: window !== window.top, dominio_sat: /(^|\.)sat\.gob\.gt$/.test(location.hostname) },
    herramientas: { getEventListeners: hayGEL, jquery: jq ? version(jq.fn && jq.fn.jquery) : null, jquery_data: hayJQData, angular: ang ? version(ang.version && ang.version.full) : null, angular_debug: scopes.con_debug },
    cobertura: { elementos_encontrados: todos.length, elementos_leidos: Math.min(todos.length, MAX_ELEMENTOS), scopes: scopes.total, truncado: scopes.truncado || todos.length > MAX_ELEMENTOS },
    por_clase: clases, lista_cerrada: cerrados, globales,
    autoguardado: {
      angular: { watchers: nWatchers, watchers_profundos: nProfundos, watchers_con: wcon, funciones_de_scope_con_palabra_de_guardado: nFuncScopeGuardado },
      formularios: { total: formularios.length, metodo_post: formularios.filter((f) => /^post$/i.test(f.getAttribute("method") || "")).length, con_ng_submit: formularios.filter((f) => f.hasAttribute("ng-submit") || f.hasAttribute("data-ng-submit")).length },
      meta_refresco: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
      service_worker_activo: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    },
    no_cubierto: ["temporizadores sin código visible en los manejadores", "manejadores añadidos después de la lectura", "código cargado de forma perezosa", "funciones fuera de los scopes de AngularJS", "efectos que dependan de valores o respuestas del servidor"],
  };
  console.log("NEXA-O1M " + JSON.stringify(salida));
  console.info("NEXA-O1M: listo (" + Math.min(todos.length, MAX_ELEMENTOS) + " elementos; getEventListeners " + (hayGEL ? "disponible" : "NO disponible: ejecútalo en la consola de DevTools") + "). No se escribió ni se pulsó nada.");
})();
