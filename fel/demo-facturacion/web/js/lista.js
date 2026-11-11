// Lista de facturas de la demostración (individuales, simuladas): cliente, fecha, importe, estado, canal y acciones contextuales.
// Los estados fiscales de esta fase son SIEMPRE simulados y se dibujan distinto (borde discontinuo y «SIM»); los reales usarán la etiqueta sólida.
import { h, boton, insignia, vacio, cabecera, quetzales, fechaLarga, mensajeError, poner, toast, modal } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";

const FILTROS = [["todas", "Todas"], ["borrador", "Borradores"], ["revisado", "Revisadas"], ["certificado", "Certificadas (simuladas)"], ["por_verificar", "Por verificar"], ["rechazado", "Rechazadas"]];
const coincide = (d, f) => f === "todas" || d.estado_preparacion === f || d.estado_fiscal === f;
export const esSimulado = (d) => (d.canal_ambiente ?? "simulado") === "simulado";

/** Etiquetas de estado: la preparación interna y, si existe, el estado fiscal (marcado como SIMULADO o real). */
export function etiquetasEstado(d) {
  const [pt, ptono] = PREPARACION[d.estado_preparacion], tags = d.estado_fiscal === "ninguno" ? [insignia(pt, ptono)] : [];   // con vida fiscal, el estado fiscal manda y la etiqueta interna sobra
  if (d.estado_fiscal !== "ninguno") {
    const [ft, ftono] = FISCAL[d.estado_fiscal];
    tags.push(esSimulado(d) ? h("span", { class: "tag tag-sim", title: "Estado simulado: sin valor fiscal", "data-simulado": "1" }, `SIM · ${ft}`) : insignia(ft, ftono));
  }
  if (d.alertas > 0) tags.push(insignia("Alerta abierta", "rojo"));
  return tags;
}

export function pantallaLista(ctx) {
  let filtro = "todas", busqueda = "", todos = [];
  const lista = h("div", { class: "lista", "aria-live": "polite" }), resumen = h("span", { class: "mut resumen-lista" });
  const puedeCrear = ctx.tiene("borradores.crear");
  const selFiltro = h("select", { "aria-label": "Estado de las facturas", class: "sel-tipo", onchange: (e) => { filtro = e.target.value; pintar(); } });
  function pintarFiltro() {
    poner(selFiltro, ...FILTROS.map(([v, t]) => h("option", { value: v, selected: v === filtro }, `${t} (${todos.filter((d) => coincide(d, v)).length})`)));
    selFiltro.value = filtro;
  }
  async function cargar() {
    try { todos = await api.documentos(); pintarFiltro(); pintar(); } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const visibles = () => todos.filter((d) => coincide(d, filtro) && (!busqueda || `${codigoBorrador(d.numero_borrador)} ${d.cliente_nombre ?? ""}`.toLowerCase().includes(busqueda.toLowerCase())));
  function pintar() {
    const datos = visibles();
    poner(resumen, `${datos.length} de ${todos.length} facturas`);
    poner(lista, ...(datos.length ? [h("div", { class: "fila fila-fac-cab fila-cab", "aria-hidden": "true" }, ...["Factura / Cliente", "Fecha", "Importe", "Estado", "Canal de emisión", "Acciones"].map((t, i) => h("span", { class: i === 2 ? "der" : "" }, t))), ...datos.map(fila)]
      : [vacio("file", "No hay facturas", filtro === "todas" && !busqueda ? "Crea una factura para recorrer el proceso completo en simulación." : "Ninguna factura coincide con los filtros.",
        puedeCrear && filtro === "todas" && !busqueda ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null)]));
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
    a.push(h("a", { class: "icon-btn slot-3", href: `#/f/${d.id}`, title: "Consultar", "aria-label": `Consultar ${codigoBorrador(d.numero_borrador)}`, "data-accion": "consultar" }, icono("eye")));
    return a;
  };
  const fila = (d) => h("div", { class: "fila fila-fac", "data-factura": codigoBorrador(d.numero_borrador) },
    h("div", { class: "celda celda-main", "data-et": "Factura" }, h("strong", { class: "mono" }, codigoBorrador(d.numero_borrador)), h("span", {}, d.cliente_nombre ?? "Sin receptor"), d.autorizacion_sat ? h("small", { class: "mono" }, d.autorizacion_sat) : h("small", {}, d.establecimiento_nombre ?? "Sin establecimiento")),
    h("div", { class: "celda", "data-et": "Fecha" }, fechaLarga(String(d.fecha_emision_prevista ?? "").slice(0, 10))),
    h("div", { class: "celda der num", "data-et": "Importe" }, h("strong", {}, quetzales(d.base_imponible)), h("small", {}, "base imponible")),
    h("div", { class: "celda celda-tags", "data-et": "Estado" }, ...etiquetasEstado(d)),
    h("div", { class: "celda", "data-et": "Canal" }, d.canal_nombre ? [h("span", {}, d.canal_nombre), h("small", {}, d.canal_ambiente === "simulado" ? "simulado" : d.canal_ambiente)] : h("small", {}, "Sin enviar")),
    h("div", { class: "celda celda-ac acciones-fac" }, ...accionesDe(d)));

  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "file", titulo: "Facturas", subtitulo: "Facturación individual en simulación: borrador → validación → revisión → envío simulado → resultado.",
      accion: puedeCrear ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null }),
    h("div", { class: "barra barra-compacta" }, h("label", { class: "buscador" }, icono("search"), h("input", { type: "search", placeholder: "Buscar por número o cliente…", "aria-label": "Buscar facturas", oninput: (e) => { busqueda = e.target.value.trim(); pintar(); } })), selFiltro, resumen),
    lista);
}
