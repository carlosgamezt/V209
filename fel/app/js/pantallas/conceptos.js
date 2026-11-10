import { h, boton, insignia, modal, campo, toast, vacio, cabecera, quetzales, mensajeError, poner } from "../ui.js";
import { icono } from "../icons.js";

export function pantallaConceptos(ctx) {
  const { api, empresa, tiene } = ctx;
  const puedeEscribir = tiene("conceptos.escribir");
  const est = { buscar: "", inactivos: false };
  const lista = h("div", { class: "lista", "aria-live": "polite" });
  const buscador = h("input", { type: "search", placeholder: "Buscar por código o descripción", "aria-label": "Buscar conceptos",
    oninput: (e) => { est.buscar = e.target.value; clearTimeout(buscador.t); buscador.t = setTimeout(cargar, 200); } });
  const chk = h("input", { type: "checkbox", onchange: (e) => { est.inactivos = e.target.checked; cargar(); } });

  async function cargar() {
    try {
      const datos = await api.listarConceptos(empresa.id, est);
      poner(lista, ...(datos.length ? [
        h("div", { class: "fila fila-cab fila-conc", "aria-hidden": "true" }, h("span", {}, "Concepto"), h("span", {}, "Tipo"), h("span", { class: "der" }, "Precio unitario"), h("span", {}, "Categoría fiscal"), h("span", {}, "Estado"), h("span", {})),
        ...datos.map(fila)] : [vacio("package", est.buscar ? "Sin resultados" : "Aún no hay conceptos", est.buscar ? "Prueba con otra búsqueda." : "Define los bienes y servicios que facturas.",
          puedeEscribir && !est.buscar ? boton("Nuevo concepto", { icon: "plus", onclick: () => formulario() }) : null)]));
    } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }

  const fila = (c) => h("div", { class: `fila fila-conc${c.activo ? "" : " inactivo"}` },
    h("div", { class: "celda celda-main", "data-et": "Concepto" }, h("strong", {}, c.descripcion), h("small", { class: "mono" }, `${c.codigo} · ${c.unidad_medida}`)),
    h("div", { class: "celda", "data-et": "Tipo" }, insignia(c.tipo === "bien" ? "Bien" : "Servicio", c.tipo === "bien" ? "azul" : "lila")),
    h("div", { class: "celda der num", "data-et": "Precio" }, quetzales(c.precio_unitario)),
    h("div", { class: "celda", "data-et": "Categoría fiscal" }, c.categoria_fiscal ? h("span", {}, c.categoria_fiscal) : h("span", { class: "mut" }, "Sin definir")),
    h("div", { class: "celda", "data-et": "Estado" }, insignia(c.activo ? "Activo" : "Inactivo", c.activo ? "verde" : "gris")),
    h("div", { class: "celda celda-ac" }, puedeEscribir ? [
      h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${c.descripcion}`, onclick: () => formulario(c) }, icono("pencil")),
      h("button", { type: "button", class: "icon-btn", title: c.activo ? "Desactivar" : "Reactivar", "aria-label": `${c.activo ? "Desactivar" : "Reactivar"} ${c.descripcion}`, onclick: () => cambiarEstado(c) }, icono(c.activo ? "archive" : "undo"))] : null));

  async function cambiarEstado(c) {
    try { await api.estadoConcepto(empresa.id, c.id, !c.activo); toast(c.activo ? "Concepto desactivado" : "Concepto reactivado"); cargar(); }
    catch (e) { toast(mensajeError(e), "error"); }
  }

  function formulario(c) {
    const cod = h("input", { value: c?.codigo ?? "", maxlength: 40, required: true });
    const des = h("input", { value: c?.descripcion ?? "", maxlength: 300, required: true });
    const tipo = h("select", {}, [["servicio", "Servicio"], ["bien", "Bien"]].map(([v, t]) => h("option", { value: v, selected: (c?.tipo ?? "servicio") === v }, t)));
    const uni = h("input", { value: c?.unidad_medida ?? "UND", maxlength: 20 });
    const precio = h("input", { value: c?.precio_unitario ?? "", inputmode: "decimal", placeholder: "0.00", autocomplete: "off" });
    const cat = h("input", { value: c?.categoria_fiscal ?? "", maxlength: 60 });
    const err = h("p", { class: "err", role: "alert" });
    let guardando = false, m;
    const ok = boton(c ? "Guardar cambios" : "Crear concepto", { onclick: async () => {
      if (guardando) return; guardando = true; ok.disabled = true; err.textContent = "";
      try {
        await api.guardarConcepto(empresa.id, { id: c?.id, version: c?.version, codigo: cod.value, descripcion: des.value, tipo: tipo.value, unidad_medida: uni.value, precio_unitario: precio.value.trim(), categoria_fiscal: cat.value });
        m.cerrar(); toast(c ? "Concepto actualizado" : "Concepto creado"); cargar();
      } catch (e) { err.textContent = mensajeError(e); if (e.codigo === "conflicto") cargar(); }
      finally { guardando = false; ok.disabled = false; }
    } });
    m = modal({ titulo: c ? "Editar concepto" : "Nuevo concepto", contenido: h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); ok.click(); } },
      h("div", { class: "grid2" }, campo("Código", cod), campo("Tipo", tipo)), campo("Descripción", des),
      h("div", { class: "grid2" }, campo("Unidad de medida", uni), campo("Precio unitario (Q)", precio, { ayuda: "Hasta 6 decimales. Se guarda exacto, sin redondeo." })),
      campo("Categoría fiscal", cat, { ayuda: "Opcional. Se definirá con las reglas fiscales verificadas de tu régimen." }), err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), ok] });
  }

  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "package", titulo: "Conceptos", subtitulo: "Catálogo de bienes y servicios con su precio unitario.", accion: puedeEscribir ? boton("Nuevo concepto", { icon: "plus", onclick: () => formulario() }) : null }),
    h("div", { class: "barra" }, h("div", { class: "buscador" }, icono("search"), buscador), h("label", { class: "check" }, chk, h("span", {}, "Mostrar inactivos"))),
    !puedeEscribir ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, "Tu rol solo permite consultar conceptos.")) : null, lista);
}
