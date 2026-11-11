// Clientes (compradores): indicadores, búsqueda, filtros, tabla paginada, alta y edición. Datos reales de la base de la demostración.
// «Frecuente» es una marca por empresa que se cambia con la estrella (o al editar); los clientes frecuentes salen primero al elegir receptor.
import { h, boton, insignia, vacio, cabecera, modal, campo, toast, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";

const POR_PAGINA = 5;
const TIPOS = [["todos", "Todos los tipos"], ["empresa", "Empresa (NIT)"], ["persona", "Persona (CUI / otro)"], ["cf", "Consumidor final"]];
const categoria = (c) => (c.tipo_identificacion === "CF" ? "cf" : c.tipo_identificacion === "NIT" ? "empresa" : "persona");

export function pantallaClientes(ctx) {
  let datos = [], busqueda = "", tipo = "todos", soloFrecuentes = false, verInactivos = false, pagina = 1;
  const puedeEscribir = ctx.tiene("clientes.escribir");
  const indicadores = h("div", { class: "indicadores" }), tabla = h("div", { class: "lista" }), pie = h("div", { class: "paginacion" });
  const frecuente = (c) => c.frecuente === true;
  const filtrados = () => datos.filter((c) => (verInactivos || c.activo) && (tipo === "todos" || categoria(c) === tipo) && (!soloFrecuentes || frecuente(c))
    && (!busqueda || `${c.numero_identificacion} ${c.nombre}`.toLowerCase().includes(busqueda.toLowerCase())));

  function pintarIndicadores() {
    const act = datos.filter((c) => c.activo), ind = (ik, n, t, tono) => h("div", { class: `indicador ind-${tono}` }, h("span", { class: "ind-ik" }, icono(ik)), h("div", {}, h("strong", { class: "num" }, String(n)), h("small", {}, t)));
    poner(indicadores, ind("users", act.length, "Clientes registrados", "azul"), ind("circleCheck", act.filter(frecuente).length, "Clientes frecuentes", "ambar"),
      ind("building", act.filter((c) => categoria(c) === "empresa").length, "Empresas", "azul"), ind("users", act.filter((c) => categoria(c) !== "empresa").length, "Personas y consumidor final", "lila"));
  }
  function pintarTabla() {
    const todos = filtrados(), paginas = Math.max(1, Math.ceil(todos.length / POR_PAGINA)); pagina = Math.min(pagina, paginas);
    const vista = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    poner(tabla,
      vista.length ? [h("div", { class: "fila fila-cli fila-cab", "aria-hidden": "true" }, ...["", "NIT / Id.", "Nombre / Razón social", "Tipo", "Teléfono", "Correo", ""].map((t) => h("span", {}, t))),
        ...vista.map((c) => h("div", { class: `fila fila-cli${c.activo ? "" : " inactivo"}`, "data-cliente": c.numero_identificacion },
          h("div", { class: "celda" }, estrella(c)),
          h("div", { class: "celda mono", "data-et": "Identificación" }, c.tipo_identificacion === "CF" ? "C/F" : c.numero_identificacion),
          h("div", { class: "celda celda-main", "data-et": "Nombre" }, h("strong", {}, c.nombre), c.direccion ? h("small", {}, c.direccion) : null, c.activo ? null : insignia("Inactivo", "gris")),
          h("div", { class: "celda", "data-et": "Tipo" }, insignia(c.tipo_identificacion === "CF" ? "Con. Final" : c.tipo_identificacion === "NIT" ? "Empresa" : "Persona", c.tipo_identificacion === "CF" ? "verde" : "azul")),
          h("div", { class: "celda", "data-et": "Teléfono" }, c.telefono ?? "—"), h("div", { class: "celda celda-correo", "data-et": "Correo" }, c.email ? h("button", { type: "button", class: "correo", title: c.email, "data-correo": c.numero_identificacion, "aria-label": `Ver el correo completo de ${c.nombre}`, onclick: () => verCorreo(c) }, c.email) : "—"),
          h("div", { class: "celda celda-ac" }, puedeEscribir && c.tipo_identificacion !== "CF" ? h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${c.nombre}`, onclick: () => formulario(c) }, icono("pencil")) : null)))]
        : vacio("users", "No hay clientes", busqueda || tipo !== "todos" || soloFrecuentes ? "Ningún cliente coincide con los filtros." : "Agrega tu primer cliente.", puedeEscribir && !busqueda ? boton("Nuevo cliente", { icon: "plus", onclick: () => formulario(null) }) : null));
    poner(pie, h("span", { class: "mut" }, todos.length ? `Mostrando ${(pagina - 1) * POR_PAGINA + 1} a ${(pagina - 1) * POR_PAGINA + vista.length} de ${todos.length} clientes` : "Sin resultados"),
      paginas > 1 ? h("div", { class: "pag" }, h("button", { type: "button", class: "pag-b", "aria-label": "Página anterior", disabled: pagina === 1, onclick: () => { pagina--; pintarTabla(); } }, "‹"),
        ...Array.from({ length: paginas }, (_, i) => h("button", { type: "button", class: `pag-b${pagina === i + 1 ? " on" : ""}`, "aria-current": pagina === i + 1 ? "page" : null, onclick: () => { pagina = i + 1; pintarTabla(); } }, String(i + 1))),
        h("button", { type: "button", class: "pag-b", "aria-label": "Página siguiente", disabled: pagina === paginas, onclick: () => { pagina++; pintarTabla(); } }, "›")) : null);
  }
  function estrella(c) {
    const puede = puedeEscribir && c.tipo_identificacion !== "CF" && c.activo;
    return h("button", { type: "button", class: `estrella${frecuente(c) ? " on" : ""}`, disabled: !puede, "aria-pressed": String(frecuente(c)), "data-estrella": c.numero_identificacion,
      title: c.tipo_identificacion === "CF" ? "El consumidor final no es cliente frecuente" : frecuente(c) ? "Quitar de frecuentes" : "Marcar como frecuente",
      "aria-label": `${frecuente(c) ? "Quitar de frecuentes a" : "Marcar como frecuente a"} ${c.nombre}`,
      onclick: async () => { try { await api.frecuenteCliente(c.id, !frecuente(c)); await ctx.recargarEstado(); await cargar(); } catch (e) { toast(mensajeError(e), "error"); } } }, "★");
  }
  function verCorreo(c) {
    let m; const estado = h("p", { class: "mut", role: "status" });
    m = modal({ titulo: "Correo del cliente", ancho: "sm", contenido: [h("p", { class: "mut" }, c.nombre), h("p", { class: "correo-completo", "data-correo-completo": "1" }, c.email), estado],
      pie: [boton("Copiar", { tipo: "sec", onclick: async () => { try { await navigator.clipboard.writeText(c.email); estado.textContent = "Copiado."; } catch { estado.textContent = "No se pudo copiar; selecciona el texto."; } } }), boton("Cerrar", { onclick: () => m.cerrar() })] });
  }
  function descargar() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;   // evita fórmulas al abrir en hojas de cálculo
    const csv = ["Identificación,Nombre,Tipo,Teléfono,Correo,Facturas", ...filtrados().map((c) => [c.numero_identificacion, c.nombre, c.tipo_identificacion, c.telefono, c.email, c.facturas].map(esc).join(","))].join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })), download: "clientes-demostracion.csv" }); document.body.append(a); a.click(); a.remove();
  }
  function formulario(c) {
    const f = { tipo: c?.tipo_identificacion ?? "NIT", numero: c?.numero_identificacion ?? "", nombre: c?.nombre ?? "", direccion: c?.direccion ?? "", email: c?.email ?? "", telefono: c?.telefono ?? "" };
    const err = h("p", { class: "err", role: "alert" }); let m;
    const inp = (k, et, extra = {}) => h("input", { value: f[k], "aria-label": et, oninput: (e) => { f[k] = e.target.value; }, ...extra });
    const guardar = boton("Guardar", { id: "guardar-cliente", onclick: async () => {
      err.textContent = ""; if (!f.numero.trim() || !f.nombre.trim()) { err.textContent = "La identificación y el nombre son obligatorios."; return; }
      if (!/^[0-9A-Za-z-]{1,30}$/.test(f.numero.trim())) { err.textContent = "La identificación solo admite letras, números y guion."; return; }
      if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { err.textContent = "El correo no es válido."; return; }
      guardar.disabled = true;
      try { await api.guardarCliente({ id: c?.id, version: c?.version, tipo_identificacion: f.tipo, numero_identificacion: f.numero, nombre: f.nombre, direccion: f.direccion, email: f.email, telefono: f.telefono }); m.cerrar(); toast(c ? "Cliente actualizado" : "Cliente creado"); await ctx.recargarEstado(); await cargar(); }
      catch (e) { err.textContent = mensajeError(e); guardar.disabled = false; }
    } });
    m = modal({ titulo: c ? "Editar cliente" : "Nuevo cliente", contenido: h("div", { class: "form" },
      h("div", { class: "grid2" }, campo("Tipo", h("select", { "aria-label": "Tipo de identificación", disabled: !!c, onchange: (e) => { f.tipo = e.target.value; } }, ...[["NIT", "NIT"], ["CUI", "CUI"], ["EXT", "Extranjero / otro"]].map(([v, t]) => h("option", { value: v, selected: f.tipo === v }, t)))),
        campo("Identificación", inp("numero", "Identificación del cliente", { maxlength: 30, disabled: !!c }))),
      campo("Nombre o razón social", inp("nombre", "Nombre del cliente", { maxlength: 200 })), campo("Dirección", inp("direccion", "Dirección del cliente", { maxlength: 300 })),
      h("div", { class: "grid2" }, campo("Teléfono", inp("telefono", "Teléfono del cliente", { maxlength: 40 })), campo("Correo", inp("email", "Correo del cliente", { maxlength: 200, type: "email" }))), err),
      pie: [c ? boton(c.activo ? "Desactivar" : "Reactivar", { tipo: c.activo ? "peligro" : "sec", id: "estado-cliente", onclick: async () => { try { await api.estadoCliente(c.id, !c.activo); m.cerrar(); toast(c.activo ? "Cliente desactivado" : "Cliente reactivado"); await ctx.recargarEstado(); await cargar(); } catch (e) { err.textContent = mensajeError(e); } } }) : null,
        boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), guardar] });
  }
  async function cargar() { try { datos = await api.clientes(); pintarIndicadores(); pintarTabla(); } catch (e) { poner(tabla, h("p", { class: "err", role: "alert" }, mensajeError(e))); } }

  const buscador = h("label", { class: "buscador" }, icono("search"), h("input", { type: "search", placeholder: "Buscar por NIT, nombre o razón social…", "aria-label": "Buscar clientes", oninput: (e) => { busqueda = e.target.value.trim(); pagina = 1; pintarTabla(); } }));
  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "users", titulo: "Clientes", subtitulo: "Administra tus compradores (clientes) para agilizar la facturación.",
      accion: h("div", { class: "acciones-fila" }, puedeEscribir ? boton("Nuevo cliente", { icon: "plus", id: "nuevo-cliente", onclick: () => formulario(null) }) : null,
        boton("Importar", { tipo: "sec", icon: "archive", disabled: true, title: "La importación masiva llega en una fase posterior (facturación individual primero)" })) }),
    indicadores,
    h("div", { class: "barra" }, buscador,
      h("select", { "aria-label": "Tipo de cliente", class: "sel-tipo", onchange: (e) => { tipo = e.target.value; pagina = 1; pintarTabla(); } }, ...TIPOS.map(([v, t]) => h("option", { value: v }, t))),
      h("label", { class: "check" }, h("input", { type: "checkbox", "aria-label": "Solo frecuentes", onchange: (e) => { soloFrecuentes = e.target.checked; pagina = 1; pintarTabla(); } }), h("span", {}, "Solo frecuentes")),
      h("label", { class: "check" }, h("input", { type: "checkbox", "aria-label": "Incluir inactivos", onchange: (e) => { verInactivos = e.target.checked; pagina = 1; pintarTabla(); } }), h("span", {}, "Inactivos")),
      h("button", { type: "button", class: "icon-btn borde", title: "Descargar lista (CSV)", "aria-label": "Descargar clientes en CSV", onclick: descargar }, icono("archive"))),
    tabla, pie);
}
