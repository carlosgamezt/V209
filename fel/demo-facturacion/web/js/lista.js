// Lista de facturas de la demostración (individuales, simuladas): cliente, fecha, importe, estado, canal y acciones contextuales.
// Los estados fiscales de esta fase son SIEMPRE simulados y se dibujan distinto (borde discontinuo y «SIM»); los reales usarán la etiqueta sólida.
import { h, boton, insignia, vacio, cabecera, quetzales, fechaLarga, mensajeError, poner, toast, modal } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";

// Un documento certificado con una autorización que NO empieza por «SIM-» salió del certificador de PRUEBAS (Digifact TEST): se rotula TEST, nunca como simulado ni como real.
export const esTest = (d) => d.estado_fiscal !== "ninguno" && !!d.autorizacion_sat && !String(d.autorizacion_sat).toUpperCase().startsWith("SIM-");
export const esSimulado = (d) => !esTest(d) && (d.canal_ambiente ?? "simulado") === "simulado";

/** Etiquetas de estado: la preparación interna y, si existe, el estado fiscal (marcado como SIMULADO o real). */
export function etiquetasEstado(d) {
  const [pt, ptono] = PREPARACION[d.estado_preparacion], tags = d.estado_fiscal === "ninguno" ? [insignia(pt, ptono)] : [];   // con vida fiscal, el estado fiscal manda y la etiqueta interna sobra
  if (d.estado_fiscal !== "ninguno") {
    const [ft, ftono] = FISCAL[d.estado_fiscal];
    tags.push(esTest(d) ? h("span", { class: "tag tag-test", title: "Certificado en el ambiente de PRUEBAS de Digifact: sin valor fiscal", "data-test": "1" }, `TEST · ${ft}`)
      : esSimulado(d) ? h("span", { class: "tag tag-sim", title: "Estado simulado: sin valor fiscal", "data-simulado": "1" }, `SIM · ${ft}`) : insignia(ft, ftono));
  }
  if (d.alertas > 0) tags.push(insignia("Alerta abierta", "rojo"));
  return tags;
}

const CATEGORIAS = [["emitidos", "Emitidos"], ["borradores", "Borradores"], ["anulados", "Anulados"], ["pendientes", "Pendientes"]];
const ESTADOS = [["", "Todos los estados"], ["certificado", "Certificado"], ["por_verificar", "Por verificar"], ["pendiente_certificacion", "Pendiente de certificación"], ["rechazado", "Rechazado"], ["anulacion_solicitada", "Anulación solicitada"], ["anulado", "Anulado"], ["revisado", "Revisado"], ["borrador", "Borrador"]];
const TAM = 25;

export function pantallaLista(ctx) {
  // Paginación y filtros EN EL SERVIDOR: cada cambio pide una sola página de 25 (con sus conteos), nunca todos los documentos. La vista predeterminada es «Emitidos».
  let categoria = "emitidos", busqueda = "", pagina = 1, filtroTipo = "", filtroEstado = "", desde = "", hasta = "", nit = "", datos = { items: [], total: 0, paginas: 1, conteos: {} }, tiposDoc = null, peticion = 0, temporizador = null;
  const lista = h("div", { class: "lista", "aria-live": "polite" }), resumen = h("span", { class: "mut resumen-lista" }), pestanas = h("div", { class: "pestanas", role: "tablist", "aria-label": "Categorías de documentos" }), pager = h("div", { class: "barra barra-compacta pager", role: "navigation", "aria-label": "Páginas de documentos" });
  const puedeCrear = ctx.tiene("borradores.crear");
  let correoOk = false;   // el envío por correo está habilitado en el servidor y la persona puede enviar (si no, no se ofrece el atajo «Correo»)
  api.correoEstado().then((e) => { correoOk = !!(e.habilitado && e.puedeEnviar); if (datos.items.length) pintar(); }).catch(() => {});
  const selEstado = h("select", { "aria-label": "Estado de los documentos", class: "sel-tipo", onchange: (e) => { filtroEstado = e.target.value; pagina = 1; cargar(); } }, ...ESTADOS.map(([v, t]) => h("option", { value: v }, t)));
  const selTipo = h("select", { "aria-label": "Tipo de documento", class: "sel-tipo", id: "filtro-tipo", onchange: (e) => { filtroTipo = e.target.value; pagina = 1; cargar(); } });
  const campoFecha = (etiqueta, set) => h("label", { class: "campo-fecha" }, h("span", { class: "mut" }, etiqueta), h("input", { type: "date", "aria-label": etiqueta, onchange: (e) => { set(e.target.value); pagina = 1; cargar(); } }));
  const campoNit = h("input", { type: "search", placeholder: "NIT del cliente", "aria-label": "NIT del cliente", autocomplete: "off", oninput: (e) => { nit = e.target.value.trim(); pagina = 1; esperar(); } });
  const nombreTipo = (c) => tiposDoc?.tipos?.find((t) => t.codigo === c)?.corto ?? c;
  function pintarTipos() {
    const codigos = (tiposDoc?.tipos ?? []).filter((t) => t.disponibilidad !== "pendiente").map((t) => t.codigo);
    poner(selTipo, h("option", { value: "" }, "Todos los tipos"), ...(codigos.length ? codigos : ["FACT"]).map((c) => h("option", { value: c }, nombreTipo(c)))); selTipo.value = filtroTipo;
  }
  function pintarPestanas() {
    poner(pestanas, ...CATEGORIAS.filter(([v]) => v !== "pendientes" || (datos.conteos?.pendientes ?? 0) > 0 || categoria === "pendientes").map(([v, t]) => {
      const n = datos.conteos?.[v]; const act = v === categoria;
      return h("button", { type: "button", role: "tab", class: `pestana${act ? " act" : ""}${v === "pendientes" ? " pestana-aviso" : ""}`, "aria-selected": act ? "true" : "false", "data-categoria": v, onclick: () => { if (categoria !== v) { categoria = v; pagina = 1; cargar(); } } }, t, n === undefined ? null : h("span", { class: "n" }, String(n)));
    }));
  }
  const parametros = () => { const p = new URLSearchParams({ pagina: String(pagina), tam: String(TAM), categoria }); for (const [k, v] of [["q", busqueda], ["tipo", filtroTipo], ["estado", filtroEstado], ["desde", desde], ["hasta", hasta], ["nit", nit]]) if (v) p.set(k, v); return p; };
  function esperar() { clearTimeout(temporizador); temporizador = setTimeout(cargar, 300); }   // la búsqueda espera a que se deje de escribir
  async function cargar() {
    const mia = ++peticion; lista.setAttribute("aria-busy", "true");
    try {
      const pre = globalThis.__felPrecarga, qs = parametros().toString(), esInicial = qs === "pagina=1&tam=25&categoria=emitidos";   // la primera carga reutiliza lo pedido en paralelo al arrancar (una sola vez y si es reciente)
      const usarPre = esInicial && pre && Date.now() - pre.t < 10000 && !pre.listaUsada; if (usarPre) pre.listaUsada = true;
      const [r0, t] = await Promise.all([usarPre ? pre.emitidos : api.documentosPagina(qs), tiposDoc ? Promise.resolve(tiposDoc) : ((usarPre && pre.tipos) || api.tiposDocumento()).catch(() => null)]);
      const r = r0 ?? await api.documentosPagina(qs);
      if (mia !== peticion) return;   // llegó una respuesta más nueva: esta se descarta
      datos = r; pagina = r.pagina; if (!tiposDoc && t) { tiposDoc = t; pintarTipos(); }
      pintarPestanas(); pintar();
    } catch (e) { if (mia === peticion) poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
    finally { if (mia === peticion) lista.removeAttribute("aria-busy"); }
  }
  const hayFiltros = () => !!(busqueda || filtroTipo || filtroEstado || desde || hasta || nit);
  function pintar() {
    const { items, total, paginas } = datos, ini = (pagina - 1) * TAM;
    poner(resumen, total ? `${ini + 1}–${ini + items.length} de ${total}` : "0 documentos");
    poner(lista, ...(items.length ? [h("div", { class: "fila fila-fac-cab fila-cab", "aria-hidden": "true" }, ...["Documento / Cliente", "Fecha", "Importe", "Estado", "Canal de emisión", "Acciones"].map((t, i) => h("span", { class: i === 2 ? "der" : "" }, t))), ...items.map(fila)]
      : [vacio("file", "No hay documentos", hayFiltros() ? "Ningún documento coincide con los filtros." : categoria === "emitidos" ? "Aún no hay documentos emitidos. Los borradores están en la pestaña Borradores." : "No hay documentos en esta categoría.",
        puedeCrear && !hayFiltros() ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null)]));
    poner(pager, paginas > 1 ? [boton("Anterior", { tipo: "sec", id: "pag-anterior", disabled: pagina <= 1, onclick: () => { pagina--; cargar(); } }), h("span", { class: "mut" }, `Página ${pagina} de ${paginas}`), boton("Siguiente", { tipo: "sec", id: "pag-siguiente", disabled: pagina >= paginas, onclick: () => { pagina++; cargar(); } })] : null);
  }
  async function revisar(d) {
    let m;
    const ok = boton("Marcar como revisado", { id: "confirmar-revision", onclick: async () => {
      ok.disabled = true;
      try { await api.estadoPreparacion(d.id, "revisado", d.version); m.cerrar(); toast(`${codigoBorrador(d.numero_borrador)} marcado como revisado: el contenido queda congelado`); await cargar(); }
      catch (e) { ok.disabled = false; m.cerrar(); toast(mensajeError(e), "error"); }
    } });
    m = modal({ titulo: `Revisar ${codigoBorrador(d.numero_borrador)}`, ancho: "sm", contenido: [h("p", {}, "Al marcarlo como revisado el contenido queda congelado; para cambiarlo habrá que volver a borrador."), h("p", { class: "mut" }, `${d.cliente_nombre ?? "Sin receptor"} · ${quetzales(d.base_imponible)}`)], pie: [boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), ok] });
  }
  const accionesDe = (d) => {
    const a = [], abrir = (t, id, ik) => h("a", { class: "btn btn-sec btn-mini slot-1", href: `#/f/${d.id}`, "data-accion": id }, icono(ik), h("span", {}, t));   // ranuras fijas: 1 acción principal · 2 revisar · 3 consultar
    const sinFiscal = d.estado_fiscal === "ninguno";
    if (d.estado_preparacion === "borrador" && sinFiscal && ctx.tiene("borradores.editar")) a.push(abrir("Continuar", "continuar", "pencil"));
    if (d.estado_preparacion === "borrador" && sinFiscal && ctx.tiene("borradores.revisar")) a.push(h("button", { type: "button", class: "btn btn-sec btn-mini slot-2", "data-accion": "revisar", "aria-label": `Revisar ${codigoBorrador(d.numero_borrador)}`, onclick: () => revisar(d) }, icono("circleCheck"), h("span", {}, "Revisar")));
    if (d.estado_preparacion === "revisado" && sinFiscal && ctx.tiene("fiscal.certificar")) a.push(abrir("Enviar", "enviar", "shield"));
    if ((d.estado_fiscal === "por_verificar" || d.alertas > 0 || d.estado_fiscal === "pendiente_certificacion") && ctx.tiene("fiscal.conciliar")) a.push(abrir("Resolver", "resolver", "info"));
    if (d.estado_fiscal === "certificado" && correoOk) a.push(h("a", { class: "btn btn-sec btn-mini slot-2", href: `#/f/${d.id}`, "data-accion": "correo", "aria-label": `Enviar o reenviar por correo ${codigoBorrador(d.numero_borrador)}`, onclick: () => { globalThis.__felCorreo = d.id; } }, icono("mail"), h("span", {}, "Correo")));   // lleva al panel de envío y reenvío del documento
    a.push(h("a", { class: "icon-btn slot-3", href: `#/f/${d.id}`, title: "Consultar", "aria-label": `Consultar ${codigoBorrador(d.numero_borrador)}`, "data-accion": "consultar" }, icono("eye")));
    return a;
  };
  const fila = (d) => h("div", { class: "fila fila-fac", "data-factura": codigoBorrador(d.numero_borrador) },
    h("div", { class: "celda celda-main", "data-et": "Documento" }, h("strong", { class: "mono" }, codigoBorrador(d.numero_borrador)), (d.tipo_dte ?? "FACT") !== "FACT" ? h("span", { class: "tag tag-tipo", "data-tipo": d.tipo_dte, title: d.origen_serie ? `Hace referencia a la serie ${d.origen_serie}, número ${d.origen_numero}` : null }, nombreTipo(d.tipo_dte)) : null, h("span", {}, d.cliente_nombre ?? "Sin receptor"), d.autorizacion_sat ? h("small", { class: "mono" }, d.autorizacion_sat) : h("small", {}, d.establecimiento_nombre ?? "Sin establecimiento")),
    h("div", { class: "celda", "data-et": "Fecha" }, fechaLarga(String(d.fecha_emision_prevista ?? "").slice(0, 10))),
    h("div", { class: "celda der num", "data-et": "Importe" }, h("strong", {}, quetzales(d.base_imponible)), h("small", {}, "base imponible")),
    h("div", { class: "celda celda-tags", "data-et": "Estado" }, ...etiquetasEstado(d)),
    h("div", { class: "celda", "data-et": "Canal" }, d.canal_nombre ? [h("span", {}, d.canal_nombre), h("small", {}, d.canal_ambiente === "simulado" ? "simulado" : d.canal_ambiente)] : h("small", {}, "Sin enviar")),
    h("div", { class: "celda celda-ac acciones-fac" }, ...accionesDe(d)));

  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "file", titulo: "Facturas emitidas", subtitulo: "Consulta tus facturas guardadas, emitidas en TEST y simuladas.",
      accion: puedeCrear ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null }),
    pestanas,
    h("div", { class: "barra barra-compacta" }, h("label", { class: "buscador" }, icono("search"), h("input", { type: "search", placeholder: "Buscar cliente, serie, número o UUID…", "aria-label": "Buscar documentos", oninput: (e) => { busqueda = e.target.value.trim(); pagina = 1; esperar(); } })), resumen),
    h("details", { class: "filtros-mas" }, h("summary", {}, "Filtros"), h("div", { class: "barra barra-compacta filtros-grid" }, selEstado, selTipo, campoNit, campoFecha("Desde", (v) => { desde = v; }), campoFecha("Hasta", (v) => { hasta = v; }))),
    lista, pager);
}
