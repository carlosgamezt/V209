// Lista de facturas de la demostración (individuales, simuladas).
import { h, boton, insignia, vacio, cabecera, quetzales, fechaLarga, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";

const FILTROS = [["todas", "Todas"], ["borrador", "Borradores"], ["revisado", "Revisadas"], ["certificado", "Certificadas (simuladas)"], ["por_verificar", "Por verificar"], ["rechazado", "Rechazadas"]];
const coincide = (d, f) => f === "todas" || d.estado_preparacion === f || d.estado_fiscal === f;

export function pantallaLista(ctx) {
  let filtro = "todas";
  const chips = h("div", { class: "chips", role: "tablist" }), lista = h("div", { class: "lista", "aria-live": "polite" });
  const puedeCrear = ctx.tiene("borradores.crear");
  function pintarChips() {
    poner(chips, ...FILTROS.map(([v, t]) => h("button", { type: "button", role: "tab", "aria-selected": String(filtro === v), class: `chip${filtro === v ? " on" : ""}`, onclick: () => { filtro = v; pintarChips(); cargar(); } }, t)));
  }
  async function cargar() {
    try {
      const todos = await api.documentos(), datos = todos.filter((d) => coincide(d, filtro));
      poner(lista, ...(datos.length ? datos.map(fila) : [vacio("file", "No hay facturas", filtro === "todas" ? "Crea una factura para recorrer el proceso completo en simulación." : "No hay facturas en este estado.",
        puedeCrear && filtro === "todas" ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null)]));
    } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const fila = (d) => {
    const [pt, ptono] = PREPARACION[d.estado_preparacion], [ft, ftono] = FISCAL[d.estado_fiscal];
    return h("a", { class: "fila-fac", href: `#/f/${d.id}`, "aria-label": `Abrir ${codigoBorrador(d.numero_borrador)}` },
      h("div", { class: "ff-main" }, h("strong", { class: "mono" }, codigoBorrador(d.numero_borrador)), h("span", {}, d.cliente_nombre ?? "Sin receptor"), h("small", { class: "mut" }, `${d.establecimiento_nombre ?? "Sin establecimiento"} · ${fechaLarga(d.fecha_emision_prevista)}`)),
      h("div", { class: "ff-num num" }, quetzales(d.base_imponible), h("small", { class: "mut" }, "base imponible")),
      h("div", { class: "ff-tags" }, insignia(pt, ptono), d.estado_fiscal !== "ninguno" ? insignia(ft, ftono) : null, d.alertas > 0 ? insignia("Alerta abierta", "rojo") : null,
        d.autorizacion_sat ? h("small", { class: "mono mut" }, d.autorizacion_sat) : null),
      h("span", { class: "ff-ir" }, icono("eye")));
  };
  pintarChips(); cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "file", titulo: "Facturas", subtitulo: "Facturación individual en simulación: borrador → validación → revisión → envío simulado → resultado.",
      accion: puedeCrear ? boton("Nueva factura", { icon: "plus", onclick: () => ctx.ir("/nueva") }) : null }),
    h("div", { class: "barra" }, chips), lista);
}
