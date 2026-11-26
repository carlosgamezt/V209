// ESTABLECIMIENTOS Y PERSONAS: qué sucursales tiene la empresa, su nombre INTERNO (editable) y a cuál está asignada cada persona. Pantalla mínima y táctil: tarjetas, no tablas.
// Esta pantalla solo muestra y pide: quién puede hacer qué lo decide la base de datos con la sesión (nunca se envía el usuario que actúa ni la empresa). El código Digifact/SAT NO se edita aquí.
import { h, boton, insignia, cabecera, campo, toast, mensajeError, poner } from "/app/js/ui.js";
import { api } from "./api.js";
import { formulario } from "./plataforma.js";

const ROL = { propietario: "Propietario", administrador: "Administrador", emisor: "Facturador", lector: "Lector" };
const ACC = { "usuario.establecimiento": "Asignación", "usuario.establecimiento.revocar": "Asignación retirada", "establecimiento.nombre": "Nombre cambiado", "usuario.supervisor": "Supervisión", "documento.borrador_trasladado": "Borrador trasladado" };
const fecha = (iso) => { try { return new Intl.DateTimeFormat("es-GT", { timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)); } catch { return ""; } };

export function pantallaEstablecimientos(ctx) {
  const cuerpo = h("div", { class: "plan-col", "data-panel": "establecimientos" }, h("p", { class: "cargando" }, "Cargando establecimientos…"));
  async function cargar() {
    let d;
    try { d = await api.adminEstablecimientos(); } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); return; }
    const nombreEst = (id) => d.establecimientos.find((x) => x.id === id)?.nombre ?? "—", codigoEst = (id) => d.establecimientos.find((x) => x.id === id)?.codigo_sat ?? "?";
    const activos = d.establecimientos.filter((x) => x.estado === "activo");
    const hecho = async (f, ok) => { try { await f(); toast(ok); } catch (e) { toast(mensajeError(e), "error"); } await cargar(); };
    // ---- pedir el motivo (queda en el historial)
    const conMotivo = (titulo, textoBoton, f, porDefecto) => { const m = { motivo: porDefecto }; formulario({ titulo, textoBoton, campos: [campo("Motivo (queda en el historial)", h("input", { "aria-label": "Motivo", maxlength: 300, value: porDefecto, oninput: (x) => { m.motivo = x.target.value; } }))], accion: async () => { await f(m.motivo); await cargar(); } }); };
    const renombrar = (x) => { const f = { nombre: x.nombre }; formulario({ titulo: `Nombre interno del establecimiento ${x.codigo_sat}`, textoBoton: "Guardar nombre", campos: [
      h("p", { class: "mut" }, `El código ${x.codigo_sat} es el de Digifact y no cambia. Aquí solo se cambia cómo lo llaman las personas en NEXA FEL.`),
      campo("Nombre interno", h("input", { "aria-label": "Nombre interno", maxlength: 120, value: x.nombre, oninput: (e) => { f.nombre = e.target.value; } }))], accion: async () => { await api.adminNombreEstablecimiento(x.id, f.nombre); toast("Nombre actualizado"); await cargar(); } }); };
    const asignar = (p, estId, predeterminado) => conMotivo(`Asignar a ${p.nombre ?? p.usuario}`, "Asignar", (motivo) => api.adminAsignar(p.user_id, estId, predeterminado, motivo), p.asignaciones.length ? "Reasignación" : "Alta");
    const tarjetaEst = (x) => h("div", { class: "card-fila", "data-establecimiento": x.codigo_sat }, h("div", { class: "fila-t" }, h("strong", {}, `${x.codigo_sat} · ${x.nombre}`), h("small", { class: "mut" }, `${x.personas} ${x.personas === 1 ? "persona" : "personas"}${x.estado === "activo" ? "" : " · inactivo"}`)),
      boton("Cambiar nombre", { tipo: "sec", "data-editar-establecimiento": x.codigo_sat, onclick: () => renombrar(x) }));
    const tarjetaPersona = (p) => {
      const sup = p.supervisor, esDueno = p.rol === "propietario", todos = esDueno || (p.rol === "administrador" && !sup && false);
      const actual = p.asignaciones[0]?.establecimiento_id ?? "";
      const sel = h("select", { "aria-label": `Establecimiento de ${p.nombre ?? p.usuario}`, "data-persona": p.usuario ?? "", disabled: esDueno || !p.activo || p.rol === "lector", onchange: (e) => { if (e.target.value && e.target.value !== actual) asignar(p, e.target.value, true); else e.target.value = actual; } },
        h("option", { value: "" }, p.rol === "lector" ? "No factura" : esDueno ? "Todos los establecimientos" : "Sin asignar"), ...activos.map((x) => h("option", { value: x.id, selected: x.id === actual }, `${x.codigo_sat} · ${x.nombre}`)));
      sel.value = esDueno || p.rol === "lector" ? "" : actual;
      const extra = sup ? h("div", { class: "chips" }, ...p.asignaciones.map((a) => h("span", { class: "chip" }, `${codigoEst(a.establecimiento_id)} · ${nombreEst(a.establecimiento_id)}${a.predeterminado ? " (predeterminado)" : ""}`)),
        activos.filter((x) => !p.asignaciones.some((a) => a.establecimiento_id === x.id)).length ? h("select", { "aria-label": `Agregar establecimiento a ${p.nombre ?? p.usuario}`, onchange: (e) => { if (e.target.value) asignar(p, e.target.value, false); } }, h("option", { value: "" }, "Agregar…"), ...activos.filter((x) => !p.asignaciones.some((a) => a.establecimiento_id === x.id)).map((x) => h("option", { value: x.id }, `${x.codigo_sat} · ${x.nombre}`))) : null) : null;
      const puedeSup = !esDueno && p.rol !== "lector" && p.activo && p.user_id !== d.yo;
      return h("div", { class: "card-fila", "data-persona-fila": p.usuario ?? "" }, h("div", { class: "fila-t" }, h("strong", {}, p.nombre ?? p.usuario ?? "—"), h("small", { class: "mut" }, `${p.usuario ?? p.email} · ${ROL[p.rol] ?? p.rol}`), p.activo ? null : insignia("Desactivado", "gris"), sup ? insignia("Supervisor", "azul") : null),
        sel, extra,
        puedeSup ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: sup, "aria-label": `Supervisor: ${p.nombre ?? p.usuario}`, "data-supervisor": p.usuario ?? "", onchange: (e) => { const v = e.target.checked; e.target.checked = sup; conMotivo(v ? "Permitir elegir entre sus establecimientos" : "Quitar la supervisión", v ? "Permitir" : "Quitar", (motivo) => api.adminSupervisor(p.user_id, v, motivo), v ? "Supervisa varias sucursales" : "Vuelve a un solo establecimiento"); } }), " Puede elegir entre varios establecimientos (supervisor)") : null);
    };
    poner(cuerpo,
      h("div", { class: "card", "data-panel": "est-lista" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Establecimientos")), ...d.establecimientos.map(tarjetaEst)),
      h("div", { class: "card", "data-panel": "est-personas" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Personas y su establecimiento"), boton("Nuevo usuario", { icon: "plus", tipo: "sec", onclick: () => { location.hash = "#/usuarios"; } })),
        h("p", { class: "mut" }, "Cada facturador ve y usa solo su establecimiento (queda fijo en Nueva factura). Una reasignación no cambia las facturas ya hechas."), ...d.personas.map(tarjetaPersona)),
      h("details", { class: "card", "data-panel": "est-historial" }, h("summary", {}, h("strong", {}, "Historial de cambios")),
        d.historial.length ? h("ul", { class: "lista-simple" }, ...d.historial.map((x) => h("li", {}, h("small", { class: "mut" }, fecha(x.ocurrido_en)), " ", h("strong", {}, ACC[x.accion] ?? x.accion), x.datos?.motivo ? h("span", { class: "mut" }, ` — ${x.datos.motivo}`) : null))) : h("p", { class: "mut" }, "Todavía no hay cambios.")));
  }
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "building", titulo: "Establecimientos", subtitulo: "Sucursales, su nombre interno y quién factura desde cada una." }), cuerpo);
}
