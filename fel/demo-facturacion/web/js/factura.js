// Crear, editar, revisar y procesar UNA factura simulada. El cálculo local es solo una vista previa: el servidor recalcula siempre.
// UNA sola pantalla: receptor y establecimiento, ítems como filas compactas (se editan en una hoja, ver item_editor.js), resumen y una barra con la acción principal + «Más acciones».
import { h, boton, insignia, campo, toast, quetzales, mensajeError, pedirMotivo, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { calcular, aInterno } from "/app/js/calculo.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";
import { api } from "./api.js";
import { vistaPrevia } from "./vista_previa.js";
import { panelProceso } from "./proceso.js";
import { editarItem, problemaLinea, resumenLinea, RE_MONTO, lineaVacia } from "./item_editor.js";
import { crearAutollenado, textoEstado, ETIQUETAS } from "./receptor_nit.js";
/** Etiqueta del origen del nombre (Digifact TEST / simulado / manual / consumidor final). */
const pintarEtiqueta = (el, t) => { if (!el) return; el.hidden = !t; el.textContent = t ? ETIQUETAS[t] : ""; el.className = `nit-etiqueta${t ? ` nit-et-${t}` : ""}`; };

const TOPE_CF = "2500";   // SAT: «Consumidor final» solo en facturas por montos MENORES a Q2,500.00 (Reglamento de la Ley del IVA, art. 30 núm. 9, reformado por el Acuerdo Gubernativo 12-2023; preguntas frecuentes del portal SAT)
const MENSAJE_TOPE_CF = "Consumidor final solo se admite en facturas menores a Q2,500.00. Identifica al receptor con su NIT (o con su CUI si es persona individual sin NIT).";

export function pantallaFactura(ctx, id) {
  const raiz = h("section", { class: "pantalla" }, h("p", { class: "mut" }, "Cargando…"));
  (async () => {
    try { poner(raiz, construir(id ? await api.documento(id) : null)); }
    catch (e) { poner(raiz, h("p", { class: "err", role: "alert" }, mensajeError(e)), boton("Volver", { tipo: "sec", onclick: () => ctx.ir("/") })); }
  })();
  return raiz;

  function construir(det) {
    const est = ctx.estado;
    let d = det, doc = det?.documento ?? { id: null, version: null, estado_preparacion: "borrador", estado_fiscal: "ninguno" };
    const inicial = () => ({
      cliente_id: doc.cliente_id ?? "", nuevo: false, tipo: "NIT", numero: "", nombre: "", establecimiento_id: doc.establecimiento_id ?? "",
      fecha: doc.fecha_emision_prevista ? String(doc.fecha_emision_prevista).slice(0, 10) : new Date().toISOString().slice(0, 10), observaciones: doc.observaciones ?? "",
      lineas: d?.lineas?.length ? d.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) })) : [],
    });
    let f = inicial(), sucio = !doc.id, intentoGuardar = false;
    let ctrl = null, ctrlModelo = null; const nit = {};   // autollenado del receptor nuevo (un controlador por modelo) y referencias vivas a sus campos
    const editable = () => doc.estado_preparacion === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene(doc.id ? "borradores.editar" : "borradores.crear");

    const cardDatos = h("div", { class: "card card-datos" }), cardItems = h("div", { class: "card card-items" });
    const cab = h("div", { class: "doc-cab" }), err = h("p", { class: "err area-msg", role: "alert" });
    const cuerpoReceptor = h("div", { class: "form" }), cuerpoLineas = h("div", { class: "lineas-d" }), totales = h("aside", { class: "totales" }), barra = h("div", { class: "barra-acciones" }), proceso = h("div", { class: "area-proceso" });

    // ---------------------------------------------------------------- validación local (vista previa; el servidor y la base vuelven a validar)
    function problemas() {
      const p = [];
      if (!f.nuevo && !f.cliente_id) p.push("Elige el receptor o crea uno nuevo.");
      if (f.nuevo && f.tipo !== "CF" && !f.numero.trim()) p.push("Escribe la identificación del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !f.nombre.trim()) p.push("Escribe el nombre del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !/^[0-9A-Za-z-]{1,30}$/.test(f.numero.trim())) p.push("La identificación solo admite letras, números y guion (máximo 30).");
      if (!f.establecimiento_id) p.push("Elige el establecimiento.");
      if (!f.fecha) p.push("Indica la fecha de emisión.");
      if (!f.lineas.length) p.push("Agrega al menos un ítem.");
      f.lineas.forEach((l, i) => { const x = problemaLinea(l, i + 1); if (x) p.push(x.msg); });
      const c = calcularSeguro(); if (!c.ok && c.msg && !p.length) p.push(c.msg);
      const esCf = f.nuevo ? f.tipo === "CF" : est.clientes.find((x) => x.id === f.cliente_id)?.tipo_identificacion === "CF";
      if (esCf && c.ok && aInterno(c.r.base_imponible) >= aInterno(TOPE_CF)) p.push(MENSAJE_TOPE_CF);
      return p;
    }
    function calcularSeguro() {
      if (!f.lineas.length) return { ok: false, vacio: true, msg: "Agrega al menos un ítem." };
      for (const l of f.lineas) if (!RE_MONTO.test(l.cantidad) || !RE_MONTO.test(l.precio_unitario) || (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor))) return { ok: false, msg: "Las cantidades, precios y descuentos deben ser números (hasta 6 decimales)." };
      try { return { ok: true, r: calcular(f.lineas) }; } catch (e) { return { ok: false, msg: e.message }; }
    }

    // ---------------------------------------------------------------- pintado
    function pintarCab() {
      const [pt, ptono] = PREPARACION[doc.estado_preparacion];
      poner(cab, h("h1", { class: "mono", title: "Número interno de borrador: no es un número fiscal" }, doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "Nueva factura"),
        h("div", { class: "celda-tags" }, insignia(pt, ptono), doc.estado_fiscal !== "ninguno" ? insignia(FISCAL[doc.estado_fiscal][0], FISCAL[doc.estado_fiscal][1]) : null, insignia("SIMULADO", "ambar")));
    }
    // Q0.00 se acepta SOLO en la demostración simulada (decisión de DEMO); nunca para certificar de verdad
    const lineasPrecioCero = () => f.lineas.map((l, i) => (RE_MONTO.test(l.precio_unitario) && Number(l.precio_unitario) === 0 ? i + 1 : 0)).filter(Boolean);
    const avisoPrecioCero = () => { const z = lineasPrecioCero(); return z.length ? h("p", { class: "aviso", id: "aviso-precio-cero", role: "status" }, icono("info"), h("span", {}, `Precio Q0.00 en ${z.length === 1 ? "la línea" : "las líneas"} ${z.join(", ")}: se acepta solo en esta DEMO. No es válido para certificar.`)) : null; };
    function pintarReceptor() {
      const ed = editable();
      const selCli = h("select", { "aria-label": "Receptor", disabled: !ed || f.nuevo, onchange: (e) => { f.cliente_id = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } },
        h("option", { value: "" }, "Selecciona un receptor…"), ...est.clientes.map((c) => h("option", { value: c.id }, `${c.nombre} — ${c.tipo_identificacion === "CF" ? "CF" : `${c.tipo_identificacion} ${c.numero_identificacion}`}`)));
      selCli.value = f.cliente_id;
      const selEst = h("select", { "aria-label": "Establecimiento", disabled: !ed, onchange: (e) => { f.establecimiento_id = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } },
        h("option", { value: "" }, "Selecciona un establecimiento…"), ...est.establecimientos.map((x) => h("option", { value: x.id }, `${x.codigo_sat} · ${x.nombre}`)));
      selEst.value = f.establecimiento_id;
      const chkNuevo = h("label", { class: "check" }, h("input", { type: "checkbox", checked: f.nuevo, disabled: !ed, "aria-label": "Receptor nuevo", onchange: (e) => { f.nuevo = e.target.checked; sucio = true; pintarReceptor(); pintarBarra(); pintarTotales(); } }), h("span", {}, "Crear un receptor nuevo"));
      // autollenado del nombre del receptor: CF local, NIT consultado por el SERVIDOR (Digifact TEST o simulador con datos ficticios); nunca se pisa un nombre escrito a mano
      if (f.nuevo && (!ctrl || ctrlModelo !== f)) {
        ctrlModelo = f;
        ctrl = crearAutollenado({ modelo: f, consultar: (n, o) => api.receptorNit(n, o),
          refrescar: () => { if (nit.tipo) nit.tipo.value = f.tipo; if (nit.numero) nit.numero.value = f.numero; if (nit.nombre) { nit.nombre.value = f.nombre; nit.nombre.readOnly = f.tipo === "CF"; } sucio = true; pintarBarra(); pintarTotales(); },
          estado: (info) => { nit.info = info; if (nit.estado) nit.estado.textContent = textoEstado(info); },
          etiqueta: (t) => { nit.et = t; pintarEtiqueta(nit.etiqueta, t); } });
      }
      let nuevo = null;
      if (f.nuevo) {
        const cambio = () => { sucio = true; pintarBarra(); pintarTotales(); };
        nit.tipo = h("select", { "aria-label": "Tipo de identificación", disabled: !ed, onchange: (e) => { ctrl.alElegirTipo(e.target.value); cambio(); } }, ...["NIT", "CUI", "EXT", "CF"].map((t) => h("option", { value: t, selected: f.tipo === t }, t === "EXT" ? "Extranjero / otro" : t)));
        nit.numero = h("input", { value: f.numero, "aria-label": "Identificación del receptor", maxlength: 30, disabled: !ed, autocomplete: "off", oninput: (e) => { ctrl.alEscribirId(e.target.value); cambio(); }, onblur: () => ctrl.alSalirIdentificacion() });
        nit.nombre = h("input", { value: f.nombre, "aria-label": "Nombre del receptor", maxlength: 200, disabled: !ed, readonly: f.tipo === "CF", oninput: (e) => { ctrl.alEscribirNombre(e.target.value); cambio(); } });
        nit.estado = h("small", { class: "nit-estado", role: "status", "aria-live": "polite" }, textoEstado(nit.info));
        nit.etiqueta = h("small", { class: "nit-etiqueta", hidden: true }); pintarEtiqueta(nit.etiqueta, nit.et);
        nuevo = h("div", { class: "grid3" }, campo("Tipo", nit.tipo), h("div", { class: "nit-id" }, campo("Identificación", nit.numero), nit.estado, nit.etiqueta), campo("Nombre", nit.nombre));
      }
      poner(cuerpoReceptor,
        h("div", { class: "grid2" }, campo("Receptor", selCli), campo("Establecimiento", selEst)), chkNuevo, nuevo,
        h("div", { class: "grid2 fila-fo" }, campo("Fecha de emisión", h("input", { type: "date", value: f.fecha, "aria-label": "Fecha de emisión", disabled: !ed, oninput: (e) => { f.fecha = e.target.value; sucio = true; pintarBarra(); } })),
          campo("Observaciones", h("input", { value: f.observaciones, maxlength: 500, "aria-label": "Observaciones", disabled: !ed, oninput: (e) => { f.observaciones = e.target.value; sucio = true; pintarBarra(); } }))));
    }

    // ---------------------------------------------------------------- ítems: filas compactas + editor en hoja
    function abrirEditor(i) {
      if (!editable()) return;
      const nuevo = i < 0;
      editarItem({ item: nuevo ? lineaVacia() : { ...f.lineas[i] }, numero: nuevo ? f.lineas.length + 1 : i + 1, nuevo, conceptos: est.conceptos ?? [],
        onGuardar: (it) => { if (nuevo) f.lineas.push(it); else f.lineas[i] = it; sucio = true; pintarLineas(); pintarBarra(); },
        onQuitar: () => { f.lineas.splice(i, 1); sucio = true; pintarLineas(); pintarBarra(); } });
    }
    function pintarLineas() {
      const ed = editable(), calc = calcularSeguro();
      const filas = f.lineas.map((l, i) => {
        const hijos = [h("span", { class: "it-n" }, String(i + 1)), h("span", { class: "it-m" }, h("strong", { class: "it-d" }, l.descripcion || "Sin descripción"), h("small", { class: "it-s" }, resumenLinea(l))),
          h("span", { class: "it-neto num" }, calc.ok ? quetzales(calc.r.lineas[i]?.neto) : "—")];
        return ed ? h("button", { type: "button", class: "it", "data-linea": String(i + 1), "aria-label": `Editar el ítem ${i + 1}: ${l.descripcion}`, onclick: () => abrirEditor(i) }, ...hijos)
          : h("div", { class: "it it-fijo", "data-linea": String(i + 1) }, ...hijos);
      });
      poner(cuerpoLineas, ...(filas.length ? filas : [h("p", { class: "mut it-vacio" }, ed ? "Aún no hay ítems." : "Sin ítems.")]),
        ed ? boton("Agregar ítem", { tipo: "sec", icon: "plus", id: "agregar-item", onclick: () => abrirEditor(-1) }) : null);
      pintarTotales();
    }
    function cuerpoCatalogo() {
      if (!editable() || !est.conceptos?.length) return null;
      return h("select", { "aria-label": "Agregar un concepto del catálogo", class: "sel-concepto", onchange: (e) => {
        const c = est.conceptos.find((x) => x.id === e.target.value); e.target.value = ""; if (!c) return;
        f.lineas.push({ ...lineaVacia(), descripcion: c.descripcion, precio_unitario: c.precio_unitario }); sucio = true; pintarLineas(); pintarBarra(); } },
        h("option", { value: "" }, "Buscar concepto…"), ...est.conceptos.map((c) => h("option", { value: c.id }, `${c.tipo === "bien" ? "Bien" : "Servicio"} · ${c.descripcion}`)));
    }

    // ---------------------------------------------------------------- resumen compacto
    function pintarTotales() {
      const c = calcularSeguro(), ps = problemas();
      const fila = (et, v, extra) => h("div", { class: `tot${extra ? " " + extra : ""}` }, h("span", {}, et), h("strong", { class: "num" }, v));
      poner(totales,
        ...(c.ok ? [fila("Subtotal", quetzales(c.r.subtotal)), fila("Descuentos", quetzales(c.r.descuento_total)), fila("Total provisional", quetzales(c.r.base_imponible), "tot-base"), h("small", { class: "mut tot-nota" }, "Sin impuestos: pendientes de régimen fiscal verificado. SIMULADO · SIN VALOR FISCAL.")]
          : [h("p", { class: "mut" }, c.vacio ? "Agrega ítems para ver los importes." : "Completa cantidad y precio de cada ítem para ver los importes."), h("small", { class: "mut tot-nota" }, "SIMULADO · SIN VALOR FISCAL.")]),
        avisoPrecioCero(),
        ps.length && (intentoGuardar || !editable()) ? h("div", { class: "validacion", role: "status" }, h("strong", {}, "Antes de guardar:"), h("ul", {}, ...ps.map((x) => h("li", {}, x)))) : ps.length ? h("p", { class: "mut ayuda-val" }, `${ps.length} dato${ps.length > 1 ? "s" : ""} por completar.`) : h("p", { class: "ok-val" }, icono("circleCheck"), h("span", {}, "Datos completos.")));
    }

    // ---------------------------------------------------------------- barra: una acción principal + «Más acciones»
    let cerrarMenu = () => {};
    function pintarBarra() {
      cerrarMenu();
      const ed = editable(), prep = doc.estado_preparacion;
      const abrirPrevia = () => vistaPrevia({ ctx, doc, f, calc: calcularSeguro(), det: d, sucio });
      const puedeRevisar = doc.id && prep === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.revisar");
      let principal;
      if (ed && (sucio || !doc.id)) principal = boton(doc.id ? "Guardar cambios" : "Guardar borrador", { icon: "check", id: "guardar", onclick: guardar });
      else if (puedeRevisar) principal = boton("Marcar como revisado", { icon: "circleCheck", id: "revisar", onclick: () => cambiar("revisado") });
      else principal = boton("Vista previa e impresión", { icon: "eye", id: "ver-previa", onclick: abrirPrevia });
      const items = [{ t: "Vista previa e impresión", i: "eye", id: "mi-previa", f: abrirPrevia }];
      if (puedeRevisar) items.push({ t: "Validar con el proveedor", i: "shield", id: "mi-validar", f: validar, off: sucio, tip: "Guarda los cambios antes de validar" });
      if (puedeRevisar && principal.id !== "revisar") items.push({ t: "Marcar como revisado", i: "circleCheck", id: "mi-revisar", f: () => cambiar("revisado"), off: sucio, tip: "Guarda los cambios antes de revisar" });
      if (doc.id && prep === "revisado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.editar")) items.push({ t: "Volver a borrador", i: "undo", id: "mi-borrador", f: () => cambiar("borrador") });
      if (doc.id && prep !== "archivado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.archivar")) items.push({ t: "Archivar", i: "archive", id: "mi-archivar", f: archivar, peligro: true });
      items.push({ t: "Volver a facturas", i: "undo", id: "mi-volver", f: () => ctx.ir("/") });
      const menu = h("div", { class: "menu-mas", role: "menu", "aria-label": "Más acciones", hidden: true },
        ...items.map((x) => h("button", { type: "button", role: "menuitem", class: `mi${x.peligro ? " mi-peligro" : ""}`, id: x.id, disabled: !!x.off, title: x.off ? x.tip : null, onclick: () => { cerrar(); x.f(); } }, icono(x.i), h("span", {}, x.t))));
      const bMas = h("button", { type: "button", class: "btn btn-sec btn-mas", id: "mas-acciones", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Más acciones", onclick: (e) => { e.stopPropagation(); menu.hidden ? abrir() : cerrar(); } }, h("span", {}, "Más"), h("span", { class: "mas-largo" }, " acciones"), h("span", { "aria-hidden": "true", class: "mas-flecha" }, "▴"));
      const fuera = (e) => { if (!wrap.contains(e.target)) cerrar(); }, tecla = (e) => { if (e.key === "Escape") { cerrar(); bMas.focus(); } };
      function abrir() { menu.hidden = false; bMas.setAttribute("aria-expanded", "true"); document.addEventListener("click", fuera); document.addEventListener("keydown", tecla); menu.querySelector("button:not([disabled])")?.focus(); }
      function cerrar() { menu.hidden = true; bMas.setAttribute("aria-expanded", "false"); document.removeEventListener("click", fuera); document.removeEventListener("keydown", tecla); }
      cerrarMenu = cerrar;
      const wrap = h("div", { class: "mas-wrap" }, bMas, menu);
      poner(barra, sucio && doc.id ? h("span", { class: "sucio" }, "Cambios sin guardar") : null, principal, wrap);
    }
    function pintarProceso() {
      poner(proceso, doc.id ? panelProceso({ ctx, det: d, sucio: () => sucio, recargar, avisar: (t, tipo) => toast(t, tipo), mostrarError: (e) => { err.textContent = mensajeError(e); } }) : h("div", { class: "card" }, h("h2", { class: "card-t" }, "Proceso"), h("p", { class: "mut" }, "Guarda el borrador para poder validarlo, revisarlo y enviarlo a la certificación simulada.")));
    }

    // ---------------------------------------------------------------- acciones
    async function recargar(nuevo) {
      d = nuevo ?? await api.documento(doc.id); doc = d.documento; f = inicial(); sucio = false; intentoGuardar = false; err.textContent = "";
      await ctx.recargarEstado(); todo();
    }
    async function guardar() {
      err.textContent = ""; intentoGuardar = true; const ps = problemas(); pintarTotales();
      if (ps.length) { err.textContent = ps[0]; return; }
      const b = document.getElementById("guardar"); if (b) b.disabled = true;
      try {
        const nuevo = !doc.id;
        const cuerpo = { id: doc.id, version: doc.version, establecimiento_id: f.establecimiento_id, fecha: f.fecha, observaciones: f.observaciones, lineas: f.lineas,
          ...(f.nuevo ? { cliente_nuevo: { tipo_identificacion: f.tipo, numero_identificacion: f.numero, nombre: f.nombre } } : { cliente_id: f.cliente_id }) };
        const r = await api.guardar(cuerpo); await ctx.recargarEstado(); toast(`Borrador ${codigoBorrador(r.documento.numero_borrador)} guardado`);
        if (nuevo) { ctx.ir(`/f/${r.documento.id}`, { reemplazar: true }); return; }
        await recargar(r);
      } catch (e) { err.textContent = mensajeError(e); if (e.codigo === "FEL_CONFLICTO" || e.status === 409) err.append(" ", h("button", { type: "button", class: "link", onclick: () => recargar() }, "Recargar")); if (b) b.disabled = false; }
    }
    async function validar() {
      err.textContent = "";
      try { const r = await api.validar(doc.id); r.ok ? toast("El proveedor simulado valida el documento") : (err.textContent = `El proveedor no valida el documento: ${r.errores.map((x) => x.mensaje).join(" · ")}`); } catch (e) { err.textContent = mensajeError(e); }
    }
    async function cambiar(estado, motivo) {
      err.textContent = "";
      try { const r = await api.estadoPreparacion(doc.id, estado, doc.version, motivo); toast(estado === "revisado" ? "Marcado como revisado: el contenido queda congelado" : estado === "archivado" ? "Factura archivada" : "Vuelve a ser borrador"); await recargar(r); } catch (e) { err.textContent = mensajeError(e); }
    }
    async function archivar() { const m = await pedirMotivo({ titulo: "Archivar factura", texto: "Archivar es una decisión interna: no es una anulación fiscal.", confirmar: "Archivar" }); if (m) cambiar("archivado", m); }

    function todo() {
      pintarCab(); pintarReceptor(); pintarLineas(); pintarBarra(); pintarProceso();
      poner(cardDatos, cuerpoReceptor);
      poner(cardItems, h("div", { class: "card-fila" }, h("h2", { class: "card-t" }, "Ítems"), cuerpoCatalogo()), cuerpoLineas);
    }
    todo();
    // no perder lo escrito por un cierre o una recarga accidental de la página
    const avisoSalir = (e) => { if (!document.body.contains(raiz)) { window.removeEventListener("beforeunload", avisoSalir); return; } if (sucio && editable()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", avisoSalir);
    return h("div", {}, cab,
      !editable() && doc.id ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, doc.estado_fiscal !== "ninguno" ? "Este documento tiene vida fiscal (simulada) y su contenido ya no se puede editar." : doc.estado_preparacion === "borrador" ? "Tu rol no permite editar este borrador." : "El contenido está congelado porque fue revisado. Vuelve a borrador para editarlo.")) : null,
      h("div", { class: "doc-grid" }, cardDatos, cardItems, totales, err, proceso), barra);
  }
}
