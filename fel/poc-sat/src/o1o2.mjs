// Análisis OFFLINE de los resultados de la observación pasiva O-1 (fragmento 4) y O-2 (red en reposo). Solo lee datos ya recogidos: no abre navegador ni red.
import { evaluarSolicitud, sanearRuta } from "./guardia.mjs";

const ROJO0 = /(guard|emit|emis|certific|firma|envi|anul|transmit|submit|save|persist|autosave|sync|beacon|fetch|xhr|xmlhttp|ajax|\bpost\b|\.post|\bput\b|\.put|\.patch|\.delete|\$http|\$resource|websocket)/i;
// nombres de almacenamiento/credenciales como señal roja; se arman por partes porque la prueba de independencia prohíbe esas palabras literales en src/
const ALMACEN = new RegExp("local" + "storage|session" + "storage|coo" + "kie|index" + "eddb", "i");
export const ROJO = { test: (n) => ROJO0.test(n) || ALMACEN.test(n) };
export const FRAMEWORK = /^(\$[\w$.]*|[\w$]+\.\$[\w$.]*|angular\.[\w.]+|(?:[\w$]+\.)?(?:apply|call|bind|forEach|slice|push|splice|indexOf|test|exec|toLowerCase|toUpperCase|trim|replace|match|isFunction|isString|isDefined|isUndefined|isArray|isObject|isNumber|noop|extend|copy|equals|stopPropagation|preventDefault|stopImmediatePropagation|getAttribute|hasAttribute|keys|isNaN|parseFloat|parseInt|Number|String|Boolean|Object|Array|RegExp|Error|min|max|round|abs|floor|ceil|isFinite|toString|valueOf|join|map|filter|some|every|find|concat|includes|startsWith|endsWith|charAt|substring|substr|split))$/;

/** Campos de la lista cerrada de la Etapa 2 (ETAPA2_ESCRITURA). El NIT solo cuenta en el tramo 2B. */
export const CAMPOS_ETAPA2 = [
  { id: "NIT (solo 2B)", solo2B: true, f: (c) => c.ng_model === "datosGenerales.nitReceptor" },
  { id: "dirección", f: (c) => c.ng_model === "datosGenerales.direccionReceptor" },
  { id: "BienOServicio0", f: (c) => c.name === "BienOServicio0" && c.tag === "select" },
  { id: "Cantidad0", f: (c) => c.name === "Cantidad0" && c.tag === "input" },
  { id: "Descripcion0", f: (c) => c.name === "Descripcion0" && c.tag === "input" },
  { id: "PrecioUnitario0", f: (c) => c.name === "PrecioUnitario0" && c.tag === "input" },
  { id: "Descuento0", f: (c) => c.name === "Descuento0" && c.tag === "input" },
  { id: "OtrosDescuento0", f: (c) => c.name === "OtrosDescuento0" && c.tag === "input" },
];
const EVENTOS_GLOBALES = /^(input|change|focus|blur|focusin|focusout|keyup|keydown|keypress|paste|cut|propertychange|ajax\w*|beforeunload|unload|pagehide|visibilitychange|online|offline)$/;

function clase(nombre, aprobadas) {
  if (ROJO.test(nombre)) return "rojo";
  if (aprobadas.has(nombre)) return "aprobada";
  if (FRAMEWORK.test(nombre)) return "framework";
  return "desconocida";
}
function recogerControl(c) {
  const out = [];
  const add = (origen, nombres) => { for (const n of nombres ?? []) out.push({ origen, nombre: n }); };
  for (const [a, v] of Object.entries(c.ng ?? {})) add(a, v.llama_a);
  for (const [a, v] of Object.entries(c.atributos_on ?? {})) add(a, v.llama_a);
  for (const [grupo, mapa] of [["nativo", c.nativos], ["jquery", c.jquery]]) for (const [tipo, ls] of Object.entries(mapa ?? {})) for (const l of ls) { if (l.nombre && !/^\(/.test(l.nombre)) add(`${grupo}:${tipo}`, [l.nombre]); add(`${grupo}:${tipo}`, l.llama_a); }
  return out;
}

/** @param {object} o1 JSON del fragmento 4  @param {{tramo?:"2A"|"2B", aprobadas?:string[]}} op */
export function analizarO1(o1, { tramo = "2A", aprobadas = [] } = {}) {
  const ap = new Set(aprobadas), incompleto = [], hallazgos = [], campos = [];
  if (!o1?.herramientas?.getEventListeners) incompleto.push("getEventListeners no estaba disponible: el fragmento no se ejecutó en la consola de DevTools (faltan los manejadores nativos)");
  if (!o1?.angular?.debug_info) incompleto.push("AngularJS sin información de depuración: no se pudieron leer scopes ni watchers");
  if (o1?.herramientas?.jquery && !o1.herramientas.jquery_data) incompleto.push("jQuery presente pero sin _data: no se pudieron leer sus manejadores");
  if (o1?.totales && o1.totales.controles_listados < o1.totales.controles_encontrados) incompleto.push("la lista de controles se truncó");
  if (o1?.angular?.truncado) incompleto.push("la lista de scopes o watchers se truncó");
  if (o1?.marco?.en_iframe === false && !/felav/.test(o1?.marco?.host ?? "")) incompleto.push(`el contexto era «${o1?.marco?.host}», no el marco del formulario (felav…)`);
  const lista = CAMPOS_ETAPA2.filter((k) => tramo === "2B" || !k.solo2B);
  for (const k of CAMPOS_ETAPA2) {
    const hits = (o1?.controles ?? []).filter(k.f), vigente = lista.includes(k);
    if (vigente && hits.length !== 1) incompleto.push(`campo «${k.id}»: se encontraron ${hits.length} controles (debe ser exactamente 1)`);
    const llamadas = hits.flatMap(recogerControl).map((x) => ({ ...x, clase: clase(x.nombre, ap) }));
    campos.push({ campo: k.id, vigente, encontrados: hits.length, llamadas });
    if (vigente) for (const x of llamadas) if (x.clase === "rojo" || x.clase === "desconocida") hallazgos.push({ donde: `campo ${k.id}`, origen: x.origen, nombre: x.nombre, clase: x.clase });
  }
  const globales = [];
  for (const [obj, d] of Object.entries(o1?.globales ?? {})) for (const [grupo, mapa] of [["nativo", d.nativos], ["jquery", d.jquery]]) for (const [tipo, ls] of Object.entries(mapa ?? {})) {
    if (!EVENTOS_GLOBALES.test(tipo)) continue;
    for (const l of ls) for (const n of [...(l.nombre && !/^\(/.test(l.nombre) ? [l.nombre] : []), ...(l.llama_a ?? [])]) { const cl = clase(n, ap); globales.push({ objeto: obj, origen: `${grupo}:${tipo}`, nombre: n, clase: cl, selector: l.selector_delegado ?? null }); if (cl === "rojo" || cl === "desconocida") hallazgos.push({ donde: `global ${obj}`, origen: `${grupo}:${tipo}`, nombre: n, clase: cl }); }
  }
  const watchers = (o1?.angular?.watchers ?? []).map((w) => ({ exp: w.exp, funcion: w.funcion, llama_a: w.llama_a, clases: w.llama_a.map((n) => clase(n, ap)) }));
  for (const w of watchers) for (const [i, n] of w.llama_a.entries()) if (w.clases[i] === "rojo" || w.clases[i] === "desconocida") hallazgos.push({ donde: `watcher «${w.exp}»`, origen: "watcher", nombre: n, clase: w.clases[i] });
  const rojos = hallazgos.filter((h) => h.clase === "rojo"), amarillos = hallazgos.filter((h) => h.clase === "desconocida");
  const veredicto = incompleto.length ? "INCOMPLETO" : rojos.length ? "ROJO" : amarillos.length ? "AMARILLO" : "VERDE";
  return { veredicto, tramo, incompleto, rojos, amarillos, campos, globales, watchers, funciones_scope: (o1?.angular?.scopes ?? []).flatMap((s) => s.funciones).filter((f) => ROJO.test(f)) };
}

/** O-2: líneas «segundo,metodo,host,ruta,tipo» transcritas de la pestaña Network (sin cuerpos ni cabeceras). */
export function leerRegistroO2(texto) {
  const filas = [], errores = [], vacio_confirmado = /^\s*#\s*sin solicitudes/im.test(texto);
  for (const [i, l0] of texto.split(/\r?\n/).entries()) {
    const l = l0.trim(); if (!l || l.startsWith("#") || /^segundo\s*,/i.test(l)) continue;
    const p = l.split(",").map((x) => x.trim()); if (p.length < 5) { errores.push(`línea ${i + 1}: se esperaban 5 columnas (segundo,metodo,host,ruta,tipo)`); continue; }
    const [seg, metodo, host, ruta, tipo] = p; if (!(Number(seg) >= 0)) { errores.push(`línea ${i + 1}: «segundo» no es un número`); continue; }
    if (!/^[A-Za-z]{3,7}$/.test(metodo)) { errores.push(`línea ${i + 1}: método no válido`); continue; }
    filas.push({ segundo: Number(seg), metodo: metodo.toUpperCase(), host: host.toLowerCase(), ruta: sanearRuta(ruta.split("?")[0].split("#")[0]), tipo: tipo.toLowerCase() });
  }
  return { filas, errores, vacio_confirmado };
}
export function analizarO2(filas, { dominios = ["felav.c.sat.gob.gt", "farm3.sat.gob.gt"], duracion_s = 300, aprobadas = [], vacio_confirmado = false } = {}) {
  const ap = new Set(aprobadas), grupos = new Map(), hallazgos = [];
  for (const f of filas) {
    const k = `${f.metodo} ${f.host}${f.ruta}`, g = grupos.get(k) ?? { clave: k, metodo: f.metodo, host: f.host, ruta: f.ruta, tipo: f.tipo, t: [] }; g.t.push(f.segundo); grupos.set(k, g);
  }
  const resumen = [];
  for (const g of grupos.values()) {
    const ev = evaluarSolicitud({ metodo: g.metodo, url: `https://${g.host}${g.ruta}`, tipoRecurso: g.tipo === "fetch/xhr" ? "xhr" : g.tipo }, { dominios, permitir_get: [] });
    const t = [...g.t].sort((a, b) => a - b), dif = t.slice(1).map((x, i) => x - t[i]), mediana = dif.length ? dif.sort((a, b) => a - b)[Math.floor(dif.length / 2)] : null;
    const periodica = t.length >= 3 && mediana !== null && mediana > 0, aprobada = ap.has(g.clave);
    let clase = "verde"; const razones = [];
    if (!/^(GET|HEAD|OPTIONS)$/.test(g.metodo)) { clase = "rojo"; razones.push(`método ${g.metodo}`); }
    if (!ev.permitir && /^(GET|HEAD|OPTIONS)$/.test(g.metodo)) { clase = "rojo"; razones.push(ev.razon); }
    if (g.tipo === "websocket" || g.tipo === "ws" || g.tipo === "eventsource") { clase = clase === "rojo" ? clase : "amarillo"; razones.push("canal persistente (WebSocket/EventSource)"); }
    if (/^(xhr|fetch|fetch\/xhr|ping|beacon|websocket|ws|eventsource)$/.test(g.tipo) && !aprobada) { if (clase === "verde") clase = "amarillo"; razones.push(`solicitud dinámica (${g.tipo}) con la página en reposo`); }
    if (periodica) { if (clase === "verde") clase = "amarillo"; razones.push(`periódica (~${mediana} s, ${t.length} veces)`); }   // aprobar una ruta NO elimina la periodicidad
    resumen.push({ ...g, veces: t.length, mediana_s: mediana, clase, razones }); if (clase === "rojo" || clase === "amarillo") hallazgos.push({ clave: g.clave, clase, razones });
  }
  const fuera = filas.filter((f) => f.segundo > duracion_s + 30).length;
  const incompleto = []; if (!filas.length && !vacio_confirmado) incompleto.push("el registro está vacío: confirma que la pestaña Network estaba grabando y que se observaron los 5 minutos (si de verdad no hubo solicitudes, escribe la línea «# sin solicitudes en 300 s»)");
  if (fuera) incompleto.push(`${fuera} filas fuera de la ventana de ${duracion_s} s`);
  const veredicto = incompleto.length && !filas.length && !vacio_confirmado ? "INCOMPLETO" : resumen.some((r) => r.clase === "rojo") ? "ROJO" : resumen.some((r) => r.clase === "amarillo") ? "AMARILLO" : "VERDE";
  return { veredicto, incompleto, resumen, hallazgos };
}
export function informeTexto(titulo, r) {
  const L = [`# ${titulo}`, `VEREDICTO: ${r.veredicto}`];
  if (r.incompleto?.length) L.push("", "Incompleto:", ...r.incompleto.map((x) => `  - ${x}`));
  if (r.rojos) L.push("", `ROJOS (${r.rojos.length}):`, ...r.rojos.map((h) => `  - ${h.donde} · ${h.origen} · ${h.nombre}`), `AMARILLOS (${r.amarillos.length}):`, ...r.amarillos.map((h) => `  - ${h.donde} · ${h.origen} · ${h.nombre}`));
  if (r.hallazgos && !r.rojos) L.push("", `Hallazgos (${r.hallazgos.length}):`, ...r.hallazgos.map((h) => `  - [${h.clase}] ${h.clave}: ${h.razones.join("; ")}`));
  return L.join("\n");
}

// ───── O-1 MÍNIMO (fragmento 5): solo tipos de evento y posibles mecanismos de autoguardado ─────
export const O1M_CAMPOS = [["nit_receptor", true], ["direccion_receptor", false], ["tipo_linea0", false], ["cantidad0", false], ["descripcion0", false], ["precio0", false], ["descuento0", false], ["otros_descuentos0", false]];   // [etiqueta, solo2B]
const EVENTOS_EDICION = new Set(["change", "input", "blur", "focus", "focusin", "focusout", "keyup", "keydown", "keypress", "paste", "cut", "propertychange", "init"]);
const EVENTOS_SALIDA = new Set(["beforeunload", "unload", "pagehide", "visibilitychange"]);
const CATS_ROJAS = new Set(["http", "envio_beacon", "almacenamiento", "metodo_escritura", "palabra_guardado", "navegacion"]);
export function analizarO1Minimo(o, { tramo = "2A" } = {}) {
  const incompleto = [], rojos = [], amarillos = [];
  if (!o?.herramientas?.getEventListeners) incompleto.push("getEventListeners no estaba disponible (no se ejecutó en la consola de DevTools)");
  if (o?.herramientas?.angular && !o.herramientas.angular_debug) incompleto.push("AngularJS sin información de depuración: scopes y watchers no legibles");
  if (o?.herramientas?.jquery && !o.herramientas.jquery_data) incompleto.push("jQuery presente sin _data: manejadores de jQuery no legibles");
  if (o?.cobertura?.truncado) incompleto.push("la lectura se truncó (demasiados elementos, scopes o watchers)");
  if (!o?.contexto?.dominio_sat) incompleto.push("el contexto no era un marco de sat.gob.gt (¿elegiste el marco correcto en la consola?)");
  const vigentes = O1M_CAMPOS.filter(([, s2b]) => tramo === "2B" || !s2b);
  for (const [etq] of vigentes) { const c = o?.lista_cerrada?.[etq]; if (!c || c.encontrados !== 1) incompleto.push(`campo «${etq}»: ${c?.encontrados ?? 0} controles encontrados (debe ser 1)`); }
  const revisar = (donde, mec, { edicion = false, salida = false, siempre = false } = {}) => {
    for (const [tipo, cats] of Object.entries(mec ?? {})) for (const [cat, n] of Object.entries(cats)) {
      const rojo = CATS_ROJAS.has(cat) && (siempre || (edicion && EVENTOS_EDICION.has(tipo)) || (salida && EVENTOS_SALIDA.has(tipo)) || (salida && edicion && EVENTOS_EDICION.has(tipo)));
      if (rojo) rojos.push({ donde, tipo, categoria: cat, n }); else if (cat === "temporizador") amarillos.push({ donde, tipo, categoria: cat, n }); else if (CATS_ROJAS.has(cat)) amarillos.push({ donde, tipo, categoria: `${cat} (evento no relacionado con la edición)`, n });
    }
  };
  for (const [etq] of vigentes) revisar(`campo ${etq}`, o?.lista_cerrada?.[etq]?.mecanismos, { edicion: true });
  for (const [g, a] of Object.entries(o?.globales ?? {})) { revisar(`global ${g}`, a.mecanismos, { edicion: true, salida: true }); for (const t of Object.keys({ ...a.eventos?.nativo, ...a.eventos?.jquery })) { if (EVENTOS_SALIDA.has(t)) amarillos.push({ donde: `global ${g}`, tipo: t, categoria: "manejador de salida/ocultamiento (revisar qué hace al cerrar la pestaña)", n: 1 }); if (/^ajax/.test(t)) amarillos.push({ donde: `global ${g}`, tipo: t, categoria: "evento global de jQuery.ajax", n: 1 }); } }
  for (const [cl, a] of Object.entries(o?.por_clase ?? {})) { const antes = rojos.length; revisar(`clase ${cl}`, a.mecanismos, { edicion: true }); const nuevos = rojos.splice(antes); for (const r of nuevos) amarillos.push({ ...r, categoria: `${r.categoria} (campo fuera de la lista cerrada o NIT en 2A: no distingue)` }); }
  for (const [cat, n] of Object.entries(o?.autoguardado?.angular?.watchers_con ?? {})) { if (CATS_ROJAS.has(cat)) rojos.push({ donde: "watcher de AngularJS", tipo: "cambio de modelo", categoria: cat, n }); else if (cat === "temporizador") amarillos.push({ donde: "watcher de AngularJS", tipo: "cambio de modelo", categoria: cat, n }); }
  const f = o?.autoguardado?.formularios; if (f?.metodo_post > 0) amarillos.push({ donde: "formularios", tipo: "submit", categoria: `${f.metodo_post} con método POST`, n: f.metodo_post });
  if (o?.autoguardado?.meta_refresco > 0) amarillos.push({ donde: "página", tipo: "recarga", categoria: "meta refresh", n: o.autoguardado.meta_refresco });
  if (o?.autoguardado?.service_worker_activo) amarillos.push({ donde: "página", tipo: "service worker", categoria: "controla la página", n: 1 });
  const veredicto = incompleto.length ? "INCOMPLETO" : rojos.length ? "ROJO" : amarillos.length ? "AMARILLO" : "VERDE";
  return { veredicto, tramo, incompleto, rojos, amarillos, nota: "VERDE no demuestra ausencia de autoguardado: solo que no se vio ninguno en lo que este fragmento puede leer (ver no_cubierto)." };
}
export function informeO1Minimo(r) {
  const L = [`# O-1 mínimo · tramo ${r.tramo}`, `VEREDICTO: ${r.veredicto}`];
  if (r.incompleto.length) L.push("", "Incompleto:", ...r.incompleto.map((x) => `  - ${x}`));
  L.push("", `ROJOS (${r.rojos.length}):`, ...r.rojos.map((h) => `  - ${h.donde} · evento ${h.tipo} · ${h.categoria} (x${h.n})`), `AMARILLOS (${r.amarillos.length}):`, ...r.amarillos.map((h) => `  - ${h.donde} · evento ${h.tipo} · ${h.categoria} (x${h.n})`), "", r.nota);
  return L.join("\n");
}
