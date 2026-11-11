// Conceptos (productos y servicios): catálogo para agilizar las líneas de la factura. Datos reales de la base de la demostración.
import { h, boton, insignia, vacio, cabecera, modal, campo, toast, quetzales, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";

const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;

export function pantallaConceptos(ctx) {
  let datos = [], busqueda = "", tipo = "todos";
  const puedeEscribir = ctx.tiene("conceptos.escribir"), lista = h("div", { class: "lista" });
  const filtrados = () => datos.filter((c) => c.activo && (tipo === "todos" || c.tipo === tipo) && (!busqueda || `${c.codigo} ${c.descripcion}`.toLowerCase().includes(busqueda.toLowerCase())));
  function pintar() {
    const v = filtrados();
    poner(lista, v.length ? [h("div", { class: "fila fila-con fila-cab", "aria-hidden": "true" }, ...["Código", "Descripción", "Tipo", "Precio sugerido", ""].map((t, i) => h("span", { class: i === 3 ? "der" : "" }, t))),
      ...v.map((c) => h("div", { class: "fila fila-con", "data-concepto": c.codigo },
        h("div", { class: "celda mono", "data-et": "Código" }, c.codigo), h("div", { class: "celda celda-main", "data-et": "Descripción" }, h("strong", {}, c.descripcion)),
        h("div", { class: "celda", "data-et": "Tipo" }, insignia(c.tipo === "bien" ? "Bien" : "Servicio", c.tipo === "bien" ? "verde" : "azul")),
        h("div", { class: "celda der num", "data-et": "Precio sugerido" }, quetzales(c.precio_unitario)),
        h("div", { class: "celda celda-ac" }, puedeEscribir ? h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${c.descripcion}`, onclick: () => formulario(c) }, icono("pencil")) : null)))]
      : vacio("package", "No hay conceptos", busqueda || tipo !== "todos" ? "Ningún concepto coincide con los filtros." : "Agrega productos o servicios para reutilizarlos en tus facturas.", puedeEscribir && !busqueda ? boton("Nuevo concepto", { icon: "plus", onclick: () => formulario(null) }) : null));
  }
  function formulario(c) {
    const f = { codigo: c?.codigo ?? "", descripcion: c?.descripcion ?? "", tipo: c?.tipo ?? "servicio", precio: c?.precio_unitario ?? "0" };
    const err = h("p", { class: "err", role: "alert" }); let m;
    const guardar = boton("Guardar", { id: "guardar-concepto", onclick: async () => {
      err.textContent = ""; if (!f.codigo.trim() || !f.descripcion.trim()) { err.textContent = "El código y la descripción son obligatorios."; return; }
      if (!RE_MONTO.test(f.precio)) { err.textContent = "El precio debe ser un número (hasta 6 decimales)."; return; }
      guardar.disabled = true;
      try { await api.guardarConcepto({ id: c?.id, version: c?.version, codigo: f.codigo, descripcion: f.descripcion, tipo: f.tipo, precio_unitario: f.precio }); m.cerrar(); toast(c ? "Concepto actualizado" : "Concepto creado"); await ctx.recargarEstado(); await cargar(); }
      catch (e) { err.textContent = mensajeError(e); guardar.disabled = false; }
    } });
    m = modal({ titulo: c ? "Editar concepto" : "Nuevo concepto", contenido: h("div", { class: "form" },
      h("div", { class: "grid2" }, campo("Código", h("input", { value: f.codigo, maxlength: 40, "aria-label": "Código del concepto", oninput: (e) => { f.codigo = e.target.value; } })),
        campo("Tipo", h("select", { "aria-label": "Tipo de concepto", onchange: (e) => { f.tipo = e.target.value; } }, ...[["servicio", "Servicio"], ["bien", "Bien"]].map(([v, t]) => h("option", { value: v, selected: f.tipo === v }, t))))),
      campo("Descripción", h("input", { value: f.descripcion, maxlength: 300, "aria-label": "Descripción del concepto", oninput: (e) => { f.descripcion = e.target.value; } })),
      campo("Precio sugerido (Q)", h("input", { value: f.precio, inputmode: "decimal", "aria-label": "Precio sugerido", oninput: (e) => { f.precio = e.target.value; } }), { ayuda: "Sin impuestos: las reglas fiscales siguen pendientes de verificación." }), err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), guardar] });
  }
  async function cargar() { try { datos = await api.conceptos(); pintar(); } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); } }
  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "package", titulo: "Conceptos", subtitulo: "Productos y servicios que repites en tus facturas.", accion: puedeEscribir ? boton("Nuevo concepto", { icon: "plus", id: "nuevo-concepto", onclick: () => formulario(null) }) : null }),
    h("div", { class: "barra" }, h("label", { class: "buscador" }, icono("search"), h("input", { type: "search", placeholder: "Buscar por código o descripción…", "aria-label": "Buscar conceptos", oninput: (e) => { busqueda = e.target.value.trim(); pintar(); } })),
      h("select", { "aria-label": "Tipo de concepto (filtro)", class: "sel-tipo", onchange: (e) => { tipo = e.target.value; pintar(); } }, ...[["todos", "Todos los tipos"], ["servicio", "Servicios"], ["bien", "Bienes"]].map(([v, t]) => h("option", { value: v }, t)))),
    lista);
}
