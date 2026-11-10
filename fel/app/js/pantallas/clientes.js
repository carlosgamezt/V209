import { h, boton, insignia, modal, campo, toast, vacio, cabecera, mensajeError, poner } from "../ui.js";
import { icono } from "../icons.js";
import { TIPOS_IDENTIFICACION_ES } from "../formato.js";

export function pantallaClientes(ctx) {
  const { api, empresa, tiene } = ctx;
  const puedeEscribir = tiene("clientes.escribir");
  const est = { buscar: "", inactivos: false };
  const lista = h("div", { class: "lista", "aria-live": "polite" });
  let tipos = [];

  const buscador = h("input", { type: "search", placeholder: "Buscar por nombre, identificación o correo", "aria-label": "Buscar clientes",
    oninput: (e) => { est.buscar = e.target.value; clearTimeout(buscador.t); buscador.t = setTimeout(cargar, 200); } });
  const chkInactivos = h("input", { type: "checkbox", onchange: (e) => { est.inactivos = e.target.checked; cargar(); } });

  async function cargar() {
    try {
      const datos = await api.listarClientes(empresa.id, est);
      poner(lista, ...(datos.length ? [
        h("div", { class: "fila fila-cab", "aria-hidden": "true" }, h("span", {}, "Cliente"), h("span", {}, "Identificación"), h("span", {}, "Contacto"), h("span", {}, "Estado"), h("span", {})),
        ...datos.map(fila)] : [vacio("users", est.buscar ? "Sin resultados" : "Aún no hay clientes", est.buscar ? "Prueba con otra búsqueda." : "Registra tu primer cliente para usarlo en los borradores.",
          puedeEscribir && !est.buscar ? boton("Nuevo cliente", { icon: "plus", onclick: () => formulario() }) : null)]));
    } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }

  const fila = (c) => h("div", { class: `fila${c.activo ? "" : " inactivo"}` },
    h("div", { class: "celda celda-main", "data-et": "Cliente" }, h("strong", {}, c.nombre), c.direccion ? h("small", {}, c.direccion) : null),
    h("div", { class: "celda", "data-et": "Identificación" }, insignia(c.tipo_identificacion, c.tipo_identificacion === "CF" ? "gris" : "azul"), " ", h("span", { class: "mono" }, c.tipo_identificacion === "CF" ? "Consumidor final" : c.numero_identificacion)),
    h("div", { class: "celda", "data-et": "Contacto" }, c.email ? h("span", {}, c.email) : null, c.telefono ? h("small", {}, c.telefono) : null, !c.email && !c.telefono ? h("span", { class: "mut" }, "—") : null),
    h("div", { class: "celda", "data-et": "Estado" }, insignia(c.activo ? "Activo" : "Inactivo", c.activo ? "verde" : "gris")),
    h("div", { class: "celda celda-ac" }, puedeEscribir ? [
      h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${c.nombre}`, onclick: () => formulario(c) }, icono("pencil")),
      h("button", { type: "button", class: "icon-btn", title: c.activo ? "Desactivar" : "Reactivar", "aria-label": `${c.activo ? "Desactivar" : "Reactivar"} ${c.nombre}`, onclick: () => cambiarEstado(c) }, icono(c.activo ? "archive" : "undo"))] : null));

  async function cambiarEstado(c) {
    try { await api.estadoCliente(empresa.id, c.id, !c.activo); toast(c.activo ? "Cliente desactivado" : "Cliente reactivado"); cargar(); }
    catch (e) { toast(mensajeError(e), "error"); }
  }

  async function formulario(c) {
    if (!tipos.length) tipos = await api.tiposIdentificacion();
    const sel = h("select", { name: "tipo" }, tipos.map((t) => h("option", { value: t.codigo, selected: (c?.tipo_identificacion ?? "NIT") === t.codigo }, `${TIPOS_IDENTIFICACION_ES[t.codigo] ?? t.nombre}`)));
    const num = h("input", { name: "numero", value: c?.numero_identificacion ?? "", maxlength: 30, autocomplete: "off", inputmode: "text" });
    const ayuda = h("small", { class: "campo-ayuda" });
    const nom = h("input", { name: "nombre", value: c?.nombre ?? "", maxlength: 200, required: true });
    const dir = h("input", { name: "direccion", value: c?.direccion ?? "", maxlength: 300 });
    const mail = h("input", { name: "email", type: "email", value: c?.email ?? "", maxlength: 200 });
    const tel = h("input", { name: "telefono", value: c?.telefono ?? "", maxlength: 30, inputmode: "tel" });
    const err = h("p", { class: "err", role: "alert" });
    const sync = () => {
      const t = tipos.find((x) => x.codigo === sel.value);
      const cf = sel.value === "CF";
      num.disabled = cf; if (cf) num.value = "CF";
      ayuda.textContent = cf ? "Se registra siempre como CF." : t && !t.verificado ? "Formato aún sin validar contra la normativa vigente de SAT: solo se revisa que use letras, números y guion." : "";
    };
    sel.addEventListener("change", sync); sync();
    let guardando = false, m;
    const ok = boton(c ? "Guardar cambios" : "Crear cliente", { onclick: async () => {
      if (guardando) return; guardando = true; ok.disabled = true; err.textContent = "";
      try {
        await api.guardarCliente(empresa.id, { id: c?.id, version: c?.version, tipo_identificacion: sel.value, numero_identificacion: num.value, nombre: nom.value, direccion: dir.value, email: mail.value, telefono: tel.value });
        m.cerrar(); toast(c ? "Cliente actualizado" : "Cliente creado"); cargar();
      } catch (e) { err.textContent = mensajeError(e); if (e.codigo === "conflicto") cargar(); }
      finally { guardando = false; ok.disabled = false; }
    } });
    m = modal({ titulo: c ? "Editar cliente" : "Nuevo cliente", contenido: h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); ok.click(); } },
      h("div", { class: "grid2" }, campo("Tipo de identificación", sel), campo("Número", num, { ayuda: ayuda })), campo("Nombre o razón social", nom), campo("Dirección", dir),
      h("div", { class: "grid2" }, campo("Correo", mail), campo("Teléfono", tel)), err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), ok] });
  }

  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "users", titulo: "Clientes", subtitulo: "Compradores de tus documentos. Cada empresa ve solo los suyos.", accion: puedeEscribir ? boton("Nuevo cliente", { icon: "plus", onclick: () => formulario() }) : null }),
    h("div", { class: "barra" }, h("div", { class: "buscador" }, icono("search"), buscador), h("label", { class: "check" }, chkInactivos, h("span", {}, "Mostrar inactivos"))),
    !puedeEscribir ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, "Tu rol solo permite consultar clientes.")) : null, lista);
}
