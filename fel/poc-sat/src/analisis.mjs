// Análisis de una observación: clasifica cada control por sección, visibilidad, función y estabilidad del identificador. PURO (sin navegador).
import { clasificarControl } from "./guardia.mjs";

const limpiarTab = (t) => String(t ?? "").replace(/\s*\(\s*\?\s*\)\s*$/, "").trim();
const esAyuda = (c) => c.tag === "button" && /^\(\s*\?\s*\)$/.test(c.texto);
const esDesplegable = (c) => c.tag === "button" && /^---.*---$/.test(c.texto);

/** Estabilidad del mejor localizador conocido. */
export function estabilidad(c) {
  const k = c.candidatos ?? [];
  if (c.rol === "tab") return k.some((x) => x.estrategia === "rol" && x.unico) ? "estable_rol_texto" : "ambiguo";
  if (esAyuda(c)) return "ayuda_sin_localizador_propio";
  const n = k.find((x) => x.estrategia === "ng_model" && x.unico); if (n) return "estable_ng_model";
  const nom = k.find((x) => x.estrategia === "nombre");
  if (nom?.estable === false && k.some((x) => x.estrategia === "etiqueta" && x.unico)) return "estable_etiqueta (name numérico descartado)";
  if (nom) { if (nom.estable === false) return "inestable_nombre_numerico"; if (nom.unico) return /\d+$/.test(nom.valor) ? "estable_nombre_indexado" : "estable_nombre"; return "ambiguo_nombre_repetido"; }
  if (k.some((x) => x.estrategia === "etiqueta" && x.unico)) return "estable_etiqueta";
  if (k.some((x) => x.estrategia === "rol" && x.unico)) return "estable_rol_texto";
  return "sin_identificador";
}

export function analizar(inv, cfg) {
  const C = inv.controles, filas = [];
  let seccion = "Datos Generales", sub = "";
  const subpest = {}; for (const [padre, hijos] of Object.entries(cfg.subpestanas ?? {})) for (const h of hijos) subpest[h] = padre;
  C.forEach((c, i) => {
    if (c.rol === "tab") { const t = limpiarTab(c.texto); seccion = subpest[t] ? `${subpest[t]} › ${t}` : t; sub = ""; }
    else if (seccion === "Datos Generales") sub = cfg.subsecciones_datos_generales.find((r) => i >= r.desde && i <= r.hasta)?.nombre ?? "";
    const m = /^(.*?)(\d+)$/.exec(c.nombre ?? ""), stem = m?.[1] ?? "", stemInfo = cfg.stems_linea[stem];
    // función: 1) nombre con sufijo, 2) ayuda adyacente (el botón ( ? ) cuyo title nombra el campo que lo precede), 3) etiqueta/texto
    let funcion = "", categoria = seccion === "Datos Generales" ? (sub || "encabezado").toLowerCase() : "otra pestaña", confianza = "";
    if (stemInfo) { funcion = stemInfo[1]; categoria = stemInfo[0]; confianza = "alta (name)"; }
    else if (c.tag === "input" && c.type === "radio") { funcion = `tipo de identificación del receptor: ${c.etiqueta}`; categoria = "receptor"; confianza = "alta (etiqueta)"; }
    else if (c.rol === "tab") { funcion = `pestaña «${limpiarTab(c.texto)}»`; categoria = "navegación"; confianza = "alta (texto)"; }
    else if (esAyuda(c)) { funcion = c.titulo ? `ayuda de «${c.titulo}»` : "ayuda (sin title)"; categoria = "ayuda"; confianza = "alta (title)"; }
    else if (esDesplegable(c)) { funcion = `desplegable personalizado: ${c.texto}`; categoria = "frases"; confianza = "alta (texto)"; }
    else if (c.tag === "button" && (c.texto || c.titulo)) { funcion = c.texto || c.titulo; categoria = "acción"; confianza = "alta (texto/title)"; }
    else {
      for (let j = i + 1; j <= i + 2 && j < C.length && !funcion; j++) { if (esAyuda(C[j]) && !/(^| > )th(\.|$| )/.test(C[j].dom)) { funcion = `«${C[j].titulo}»`; confianza = "media (adyacencia: la ayuda sigue al campo)"; } else if (C[j].marcador !== "dd/mm/aaaa" && !(c.marcador === "dd/mm/aaaa")) break; }
      if (!funcion) { let j = i - 1; while (j >= 0 && !esAyuda(C[j])) j--; funcion = j >= 0 && i - j < 12 ? `desconocida (sigue a la ayuda «${C[j].titulo}»)` : "desconocida"; confianza = "baja"; }
    }
    if (c.tag === "button" && c.marcador === "dd/mm/aaaa") { funcion = "botón del selector de fecha (calendario)"; categoria = "acción"; confianza = "media (placeholder)"; }
    const cl = clasificarControl(c);
    const calculado = c.deshabilitado && c.tag === "input" && /^Total|^total/.test(c.nombre ?? "");
    let accion;
    if (esAyuda(c)) accion = "ayuda: no se pulsa";
    else if (esDesplegable(c)) accion = "BLOQUEADA (desplegable personalizado: requiere diseño aparte)";
    else if (cl.nivel === "prohibido") accion = "BLOQUEADA (prohibida)";
    else if (c.tag === "button" && c.marcador === "dd/mm/aaaa") accion = "BLOQUEADA (calendario: requiere diseño aparte)";
    else if (c.tag === "button" || (c.rol === "button")) accion = cl.nivel === "ambiguo" || !c.texto ? "BLOQUEADA (ambigua/sin texto: requiere aprobación humana)" : "revisar";
    else if (c.rol === "tab") accion = "clic_seguro (solo navegación, con verificación)";
    else if (c.soloLectura || c.deshabilitado) accion = calculado ? "solo lectura (valor calculado)" : "solo lectura / deshabilitado";
    else accion = c.visible ? "llenar/seleccionar/marcar (tras confirmar localizador)" : "dinámico: aparece tras una acción manual";
    const mejor = c.mejor ? `${c.mejor.estrategia}${c.mejor.tag ? `[${c.mejor.tag}]` : ""}: ${c.mejor.valor}` : "";
    filas.push({ idx: i, n: c.n, seccion, subseccion: sub, visible: c.visible, tag: c.tag, tipo: c.type || c.rol, requerido: c.requerido, funcion, confianza_funcion: confianza, categoria, estabilidad: estabilidad(c), mejor_localizador: mejor, opciones_n: c.opciones_n ?? null, accion, nombre: c.nombre ?? "", clasificacion_guardia: cl.nivel });
  });
  // campos repetidos con sufijo numérico
  const grupos = {};
  C.forEach((c, i) => { const m = /^(.*?)(\d+)$/.exec(c.nombre ?? ""); if (!m || /^\d+$/.test(c.nombre)) return; (grupos[m[1]] ??= []).push({ idx: i, sufijo: Number(m[2]), tag: c.tag, visible: c.visible, seccion: filas[i].seccion }); });
  const repetidos = Object.entries(grupos).map(([stem, l]) => ({ stem, ocurrencias: l.length, sufijos: [...new Set(l.map((x) => x.sufijo))], tags: [...new Set(l.map((x) => x.tag))], visibles: l.filter((x) => x.visible).length, seccion: l[0].seccion, duplicado_mismo_nombre: new Set(l.map((x) => `${x.tag}`)).size > 1 }));
  const cuenta = (f) => filas.filter(f).length, por = (k) => Object.entries(filas.reduce((a, f) => ((a[f[k]] = (a[f[k]] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  return { total: filas.length, visibles: cuenta((f) => f.visible), por_estabilidad: por("estabilidad"), por_seccion: por("seccion"), por_categoria: por("categoria"), por_accion: por("accion"), filas, repetidos };
}

export function aMarkdown(a, titulo = "Clasificación de controles") {
  const L = [`# ${titulo}`, "", `Total: **${a.total}** controles · visibles: **${a.visibles}** · ocultos: **${a.total - a.visibles}**`, ""];
  const tabla = (t, l) => { L.push(`**${t}**`, "", "| Valor | Controles |", "|---|---|", ...l.map(([k, v]) => `| ${k} | ${v} |`), ""); };
  tabla("Por estabilidad del identificador", a.por_estabilidad); tabla("Por sección", a.por_seccion); tabla("Por acción permitida", a.por_accion);
  L.push("## Los 211 controles", "", "| # | Sección / subsección | Vis. | Control | Función | Conf. función | Estabilidad | Mejor localizador | Acción |", "|---|---|---|---|---|---|---|---|---|");
  for (const f of a.filas) L.push(`| ${f.idx} | ${f.seccion}${f.subseccion ? " › " + f.subseccion : ""} | ${f.visible ? "sí" : "no"} | ${f.tag}${f.tipo ? `[${f.tipo}]` : ""}${f.requerido ? " *" : ""} | ${f.funcion} | ${f.confianza_funcion} | ${f.estabilidad} | ${f.mejor_localizador.replace(/\|/g, "/")} | ${f.accion} |`);
  L.push("", "## Campos repetidos con sufijo numérico", "", "| Raíz del name | Ocurrencias | Sufijos vistos | Etiquetas HTML | Visibles | Sección |", "|---|---|---|---|---|---|", ...a.repetidos.map((r) => `| ${r.stem} | ${r.ocurrencias} | ${r.sufijos.join(",")} | ${r.tags.join("+")} | ${r.visibles} | ${r.seccion} |`));
  return L.join("\n") + "\n";
}
