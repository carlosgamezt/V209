// Clientes (compradores): indicadores, búsqueda, filtros, tabla paginada, alta y edición. Datos reales de la base de la demostración.
// «Frecuente» es una marca por empresa que se cambia con la estrella (o al editar); los clientes frecuentes salen primero al elegir receptor.
import { h, boton, insignia, vacio, cabecera, modal, campo, toast, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { crearAutollenado, textoEstado, ETIQUETAS, RE_CUI, normalizarCui } from "./receptor_nit.js";

const POR_PAGINA = 5;
const TIPOS = [["todos", "Todos los tipos"], ["empresa", "Empresa (NIT)"], ["persona", "Persona (CUI / otro)"], ["cf", "Consumidor final"]];
const categoria = (c) => (c.tipo_identificacion === "CF" ? "cf" : c.tipo_identificacion === "NIT" ? "empresa" : "persona");

export function pantallaClientes(ctx) {
  let datos = [], busqueda = "", tipo = "todos", soloFrecuentes = false, verInactivos = false, pagina = 1;
  // MODO SERVIDOR: solo si hay más clientes activos que el conjunto de trabajo que entrega /api/estado (500). Con menos, todo funciona exactamente como antes (lista completa y filtros en el navegador).
  let srv = false, totalSrv = 0, paginasSrv = 1, conteosSrv = null, temporizador = 0;
  const truncado = () => (ctx.estado?.clientes_total ?? 0) > (ctx.estado?.clientes?.length ?? 0);
  const paramsSrv = (p, tam) => ({ pagina: p, tam, q: busqueda, tipo, frecuentes: soloFrecuentes ? 1 : 0, inactivos: verInactivos ? 1 : 0 });
  const puedeEscribir = ctx.tiene("clientes.escribir");
  const indicadores = h("div", { class: "indicadores" }), tabla = h("div", { class: "lista" }), pie = h("div", { class: "paginacion" });
  const frecuente = (c) => c.frecuente === true;
  const filtrados = () => srv ? datos : datos.filter((c) => (verInactivos || c.activo) && (tipo === "todos" || categoria(c) === tipo) && (!soloFrecuentes || frecuente(c))
    && (!busqueda || `${c.numero_identificacion} ${c.nombre}`.toLowerCase().includes(busqueda.toLowerCase())));

  function pintarIndicadores() {
    const act = srv ? [] : datos.filter((c) => c.activo), ind = (ik, n, t, tono) => h("div", { class: `indicador ind-${tono}` }, h("span", { class: "ind-ik" }, icono(ik)), h("div", {}, h("strong", { class: "num" }, String(n)), h("small", {}, t)));
    const k = srv ? conteosSrv : { registrados: act.length, frecuentes: act.filter(frecuente).length, empresas: act.filter((c) => categoria(c) === "empresa").length, personas: act.filter((c) => categoria(c) !== "empresa").length };
    poner(indicadores, ind("users", k.registrados, "Clientes registrados", "azul"), ind("circleCheck", k.frecuentes, "Clientes frecuentes", "ambar"),
      ind("building", k.empresas, "Empresas", "azul"), ind("users", k.personas, "Personas y consumidor final", "lila"));
  }
  function pintarTabla() {
    const todos = srv ? { length: totalSrv } : filtrados(), paginas = srv ? paginasSrv : Math.max(1, Math.ceil(todos.length / POR_PAGINA)); if (!srv) pagina = Math.min(pagina, paginas);
    const vista = srv ? datos : todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
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
      paginas > 1 ? h("div", { class: "pag" }, h("button", { type: "button", class: "pag-b", "aria-label": "Página anterior", disabled: pagina === 1, onclick: () => { pagina--; refrescar(); } }, "‹"),
        ...Array.from({ length: paginas }, (_, i) => h("button", { type: "button", class: `pag-b${pagina === i + 1 ? " on" : ""}`, "aria-current": pagina === i + 1 ? "page" : null, onclick: () => { pagina = i + 1; refrescar(); } }, String(i + 1))),
        h("button", { type: "button", class: "pag-b", "aria-label": "Página siguiente", disabled: pagina === paginas, onclick: () => { pagina++; refrescar(); } }, "›")) : null);
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
  async function filasCsv() {   // en modo servidor se piden las páginas de 100 con el filtro actual (tope 10 000 filas)
    if (!srv) return filtrados(); const out = [];
    for (let p = 1; p <= 100; p++) { const r = await api.clientesPagina(paramsSrv(p, 100)); out.push(...r.items); if (p >= r.paginas) break; }
    return out;
  }
  async function descargar() {
    let filas; try { filas = await filasCsv(); } catch (e) { toast(mensajeError(e), "error"); return; }
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;   // evita fórmulas al abrir en hojas de cálculo
    const csv = ["Identificación,Nombre,Tipo,Teléfono,Correo,Facturas", ...filas.map((c) => [c.numero_identificacion, c.nombre, c.tipo_identificacion, c.telefono, c.email, c.facturas].map(esc).join(","))].join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })), download: "clientes-demostracion.csv" }); document.body.append(a); a.click(); a.remove();
  }
  function formulario(c) {
    const f = { tipo: c?.tipo_identificacion ?? "NIT", numero: c?.numero_identificacion ?? "", nombre: c?.nombre ?? "", direccion: c?.direccion ?? "", email: c?.email ?? "", telefono: c?.telefono ?? "" };
    const err = h("p", { class: "err", role: "alert" }); let m; const refs = {};
    const inp = (k, et, extra = {}) => (refs[k] = h("input", { value: f[k], "aria-label": et, oninput: (e) => { f[k] = e.target.value; }, ...extra }));
    // autollenado del nombre al escribir el NIT (solo clientes nuevos): lo consulta el SERVIDOR (Digifact TEST o simulador con datos ficticios); «CF» se resuelve sin consulta; nunca se pisa un nombre escrito a mano
    const estadoNit = h("small", { class: "nit-estado", role: "status", "aria-live": "polite" }), etiquetaNit = h("small", { class: "nit-etiqueta", hidden: true });
    const ctrl = c ? null : crearAutollenado({ modelo: f, consultar: (n, o) => (o.tipo === "CUI" ? api.receptorCui(n, o) : api.receptorNit(n, o)),
      refrescar: () => { if (refs.tipo) refs.tipo.value = f.tipo; if (refs.numero) refs.numero.value = f.numero; if (refs.nombre) { refs.nombre.value = f.nombre; refs.nombre.readOnly = f.tipo === "CF"; } guardar.disabled = f.tipo === "CF"; },
      estado: (info) => { estadoNit.textContent = info?.fase === "cf" ? "Consumidor final no se registra como cliente: se elige al facturar." : textoEstado(info); },
      etiqueta: (t) => { etiquetaNit.hidden = !t; etiquetaNit.textContent = t ? ETIQUETAS[t] : ""; etiquetaNit.className = `nit-etiqueta${t ? ` nit-et-${t}` : ""}`; } });
    const guardar = boton("Guardar", { id: "guardar-cliente", onclick: async () => {
      err.textContent = ""; if (!f.numero.trim() || !f.nombre.trim()) { err.textContent = "La identificación y el nombre son obligatorios."; return; }
      if (!/^[0-9A-Za-z-]{1,30}$/.test(f.numero.trim())) { err.textContent = "La identificación solo admite letras, números y guion."; return; }
      if (f.tipo === "CUI" && !RE_CUI.test(normalizarCui(f.numero))) { err.textContent = "El CUI debe tener 13 dígitos (solo números)."; return; }
      if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { err.textContent = "El correo no es válido."; return; }
      guardar.disabled = true;
      try { await api.guardarCliente({ id: c?.id, version: c?.version, tipo_identificacion: f.tipo, numero_identificacion: f.numero, nombre: f.nombre, direccion: f.direccion, email: f.email, telefono: f.telefono }); await ctx.recargarEstado(); m.cerrar(); toast(c ? "Cliente actualizado" : "Cliente creado"); await cargar(); }
      catch (e) { err.textContent = mensajeError(e); guardar.disabled = false; }
    } });
    m = modal({ titulo: c ? "Editar cliente" : "Nuevo cliente", contenido: h("div", { class: "form" },
      h("div", { class: "grid2" }, campo("Tipo", (refs.tipo = h("select", { "aria-label": "Tipo de identificación", disabled: !!c, onchange: (e) => { if (ctrl) ctrl.alElegirTipo(e.target.value); else f.tipo = e.target.value; refs.numero?.setAttribute("inputmode", f.tipo === "CUI" ? "numeric" : "text"); } }, ...[["NIT", "NIT"], ["CUI", "CUI"], ["EXT", "Extranjero / otro"], ...(c ? [] : [["CF", "Consumidor final"]])].map(([v, t]) => h("option", { value: v, selected: f.tipo === v }, t))))),
        h("div", { class: "nit-id" }, campo("Identificación", inp("numero", "Identificación del cliente", { maxlength: 30, disabled: !!c, autocomplete: "off", enterkeyhint: "next", inputmode: f.tipo === "CUI" ? "numeric" : "text", oninput: (e) => { if (ctrl) ctrl.alEscribirId(e.target.value); else f.numero = e.target.value; }, onblur: () => ctrl?.alSalirIdentificacion(),
          onkeydown: (e) => { if (e.key !== "Enter" || e.isComposing || !ctrl) return; e.preventDefault(); ctrl.alConfirmarIdentificacion(); refs.nombre?.focus(); } })   /* Enter / «Siguiente»: confirma el NIT o el CUI y pasa al nombre */), estadoNit, etiquetaNit)),
      campo("Nombre o razón social", inp("nombre", "Nombre del cliente", { maxlength: 200, oninput: (e) => { if (ctrl) ctrl.alEscribirNombre(e.target.value); else f.nombre = e.target.value; } })), campo("Dirección", inp("direccion", "Dirección del cliente", { maxlength: 300 })),
      h("div", { class: "grid2" }, campo("Teléfono", inp("telefono", "Teléfono del cliente", { maxlength: 40 })), campo("Correo", inp("email", "Correo del cliente", { maxlength: 200, type: "email" }))), err),
      pie: [c ? boton(c.activo ? "Desactivar" : "Reactivar", { tipo: c.activo ? "peligro" : "sec", id: "estado-cliente", onclick: async () => { try { await api.estadoCliente(c.id, !c.activo); await ctx.recargarEstado(); m.cerrar(); toast(c.activo ? "Cliente desactivado" : "Cliente reactivado"); await cargar(); } catch (e) { err.textContent = mensajeError(e); } } }) : null,
        boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), guardar] });
  }
  async function cargarSrv() { const r = await api.clientesPagina(paramsSrv(pagina, POR_PAGINA)); datos = r.items; totalSrv = r.total; paginasSrv = r.paginas; pagina = r.pagina; conteosSrv = r.conteos; pintarIndicadores(); pintarTabla(); }
  const refrescar = () => { if (!srv) { pintarTabla(); return; } clearTimeout(temporizador); temporizador = setTimeout(() => cargarSrv().catch((e) => toast(mensajeError(e), "error")), 200); };   // la búsqueda espera 200 ms tras la última tecla
  async function cargar() { try { srv = truncado(); if (srv) await cargarSrv(); else { datos = await api.clientes(); pintarIndicadores(); pintarTabla(); } } catch (e) { poner(tabla, h("p", { class: "err", role: "alert" }, mensajeError(e))); } }

  const buscador = h("label", { class: "buscador" }, icono("search"), h("input", { type: "search", placeholder: "Buscar por NIT, nombre o razón social…", "aria-label": "Buscar clientes", oninput: (e) => { busqueda = e.target.value.trim(); pagina = 1; refrescar(); } }));
  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "users", titulo: "Clientes", subtitulo: "Administra tus compradores (clientes) para agilizar la facturación.",
      accion: h("div", { class: "acciones-fila" }, puedeEscribir ? boton("Nuevo cliente", { icon: "plus", id: "nuevo-cliente", onclick: () => formulario(null) }) : null,
        boton("Importar", { tipo: "sec", icon: "archive", disabled: true, title: "La importación masiva llega en una fase posterior (facturación individual primero)" })) }),
    indicadores,
    h("div", { class: "barra" }, buscador,
      h("select", { "aria-label": "Tipo de cliente", class: "sel-tipo", onchange: (e) => { tipo = e.target.value; pagina = 1; refrescar(); } }, ...TIPOS.map(([v, t]) => h("option", { value: v }, t))),
      h("label", { class: "check" }, h("input", { type: "checkbox", "aria-label": "Solo frecuentes", onchange: (e) => { soloFrecuentes = e.target.checked; pagina = 1; refrescar(); } }), h("span", {}, "Solo frecuentes")),
      h("label", { class: "check" }, h("input", { type: "checkbox", "aria-label": "Incluir inactivos", onchange: (e) => { verInactivos = e.target.checked; pagina = 1; refrescar(); } }), h("span", {}, "Inactivos")),
      h("button", { type: "button", class: "icon-btn borde", title: "Descargar lista (CSV)", "aria-label": "Descargar clientes en CSV", onclick: descargar }, icono("archive"))),
    tabla, pie);
}
