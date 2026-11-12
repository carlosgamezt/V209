// Crear, editar, revisar y procesar UNA factura simulada. El cálculo local es solo una vista previa: el servidor recalcula siempre.
import { h, boton, insignia, campo, toast, cabecera, quetzales, mensajeError, pedirMotivo, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { calcular } from "/app/js/calculo.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";
import { api } from "./api.js";
import { vistaPrevia, papel } from "./vista_previa.js";
import { panelProceso } from "./proceso.js";

const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
const linea = () => ({ descripcion: "", cantidad: "1", precio_unitario: "", descuento_tipo: "ninguno", descuento_valor: "0" });

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
      lineas: d?.lineas?.length ? d.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) })) : [linea()],
    });
    let f = inicial(), sucio = !doc.id, intentoGuardar = false, paso = 1;
    const editable = () => doc.estado_preparacion === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene(doc.id ? "borradores.editar" : "borradores.crear");

    const pasosEl = h("ol", { class: "stepper", "aria-label": "Pasos de la factura" }), cardDatos = h("div", { class: "card", "data-paso": "1" }), cardItems = h("div", { class: "card", "data-paso": "2" }), cardPrev = h("div", { class: "card", "data-paso": "3" });
    const cab = h("div", { class: "doc-cab" }), err = h("p", { class: "err", role: "alert" });
    const cuerpoReceptor = h("div", { class: "form" }), cuerpoLineas = h("div", { class: "lineas-d" }), totales = h("aside", { class: "totales" }), barra = h("div", { class: "barra-acciones" }), proceso = h("div", { class: "proceso" });

    // ---------------------------------------------------------------- validación local (vista previa; el servidor y la base vuelven a validar)
    function problemas() {
      const p = [];
      if (!f.nuevo && !f.cliente_id) p.push("Elige el receptor o crea uno nuevo.");
      if (f.nuevo && f.tipo !== "CF" && !f.numero.trim()) p.push("Escribe la identificación del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !f.nombre.trim()) p.push("Escribe el nombre del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !/^[0-9A-Za-z-]{1,30}$/.test(f.numero.trim())) p.push("La identificación solo admite letras, números y guion (máximo 30).");
      if (!f.establecimiento_id) p.push("Elige el establecimiento.");
      if (!f.fecha) p.push("Indica la fecha de emisión.");
      f.lineas.forEach((l, i) => {
        const n = i + 1;
        if (!l.descripcion.trim()) p.push(`Línea ${n}: falta la descripción.`);
        if (!RE_MONTO.test(l.cantidad) || Number(l.cantidad) <= 0) p.push(`Línea ${n}: la cantidad debe ser un número mayor que cero (hasta 6 decimales).`);
        if (!RE_MONTO.test(l.precio_unitario)) p.push(`Línea ${n}: el precio debe ser un número (hasta 6 decimales).`);
        if (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor)) p.push(`Línea ${n}: el descuento no es un número válido.`);
        if (l.descuento_tipo === "porcentaje" && RE_MONTO.test(l.descuento_valor) && Number(l.descuento_valor) > 100) p.push(`Línea ${n}: el porcentaje no puede superar 100.`);
      });
      const c = calcularSeguro(); if (!c.ok && c.msg && !p.length) p.push(c.msg);
      return p;
    }
    function calcularSeguro() {
      for (const l of f.lineas) if (!RE_MONTO.test(l.cantidad) || !RE_MONTO.test(l.precio_unitario) || (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor))) return { ok: false };
      try { return { ok: true, r: calcular(f.lineas) }; } catch (e) { return { ok: false, msg: e.message }; }
    }

    // ---------------------------------------------------------------- pintado
    function pintarCab() {
      const [pt, ptono] = PREPARACION[doc.estado_preparacion];
      poner(cab, h("div", {}, h("h1", { class: "mono" }, doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "Nueva factura"), h("p", { class: "mut" }, "Número interno de borrador · no es un número fiscal")),
        h("div", { class: "celda-tags" }, insignia(pt, ptono), doc.estado_fiscal !== "ninguno" ? insignia(FISCAL[doc.estado_fiscal][0], FISCAL[doc.estado_fiscal][1]) : null, insignia("SIMULADO", "ambar")));
    }
    const irPaso = (n) => { paso = n; todo(); };
    function pintarPasos() {
      const nombres = ["Datos", "Ítems", "Vista previa"];
      poner(pasosEl, ...(editable() ? nombres.map((t, i) => h("li", { class: `paso${paso === i + 1 ? " on" : ""}${paso > i + 1 ? " hecho" : ""}` }, h("div", { role: "link", tabindex: "0", class: "paso-i", "aria-current": paso === i + 1 ? "step" : null, "data-ir-paso": String(i + 1), onclick: () => irPaso(i + 1), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); irPaso(i + 1); } } }, h("span", { class: "paso-n" }, String(i + 1)), h("span", {}, t)))) : []));
    }
    function pintarPrevia() {
      if (!editable() || paso !== 3) return poner(cardPrev);
      poner(cardPrev, h("h2", { class: "card-t" }, "Vista previa"), h("p", { class: "aviso aviso-azul" }, icono("info"), h("span", {}, "Revisa la información antes de continuar. Es una vista previa NO certificada, sin valor fiscal.")), papel({ ctx, doc, f, calc: calcularSeguro(), det: d }));
    }
    function mostrar() {
      const ed = editable(); cardDatos.hidden = ed && paso !== 1; cardItems.hidden = ed && paso !== 2; cardPrev.hidden = !(ed && paso === 3);
    }
    function pintarReceptor() {
      const ed = editable();
      const selCli = h("select", { "aria-label": "Receptor", disabled: !ed || f.nuevo, onchange: (e) => { f.cliente_id = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } },
        h("option", { value: "" }, "Selecciona un receptor…"), ...est.clientes.map((c) => h("option", { value: c.id }, `${c.nombre} — ${c.tipo_identificacion === "CF" ? "CF" : `${c.tipo_identificacion} ${c.numero_identificacion}`}`)));
      selCli.value = f.cliente_id;
      const selEst = h("select", { "aria-label": "Establecimiento", disabled: !ed, onchange: (e) => { f.establecimiento_id = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } },
        h("option", { value: "" }, "Selecciona un establecimiento…"), ...est.establecimientos.map((x) => h("option", { value: x.id }, `${x.codigo_sat} · ${x.nombre}`)));
      selEst.value = f.establecimiento_id;
      const chkNuevo = h("label", { class: "check" }, h("input", { type: "checkbox", checked: f.nuevo, disabled: !ed, "aria-label": "Receptor nuevo", onchange: (e) => { f.nuevo = e.target.checked; sucio = true; pintarReceptor(); pintarBarra(); pintarTotales(); } }), h("span", {}, "Crear un receptor nuevo"));
      const nuevo = f.nuevo ? h("div", { class: "grid3" },
        campo("Tipo", h("select", { "aria-label": "Tipo de identificación", disabled: !ed, onchange: (e) => { f.tipo = e.target.value; sucio = true; pintarReceptor(); pintarBarra(); } }, ...["NIT", "CUI", "EXT", "CF"].map((t) => h("option", { value: t, selected: f.tipo === t }, t === "EXT" ? "Extranjero / otro" : t)))),
        f.tipo === "CF" ? h("p", { class: "mut" }, "Consumidor final: no requiere identificación ni nombre.") : [
          campo("Identificación", h("input", { value: f.numero, "aria-label": "Identificación del receptor", maxlength: 30, disabled: !ed, oninput: (e) => { f.numero = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } })),
          campo("Nombre", h("input", { value: f.nombre, "aria-label": "Nombre del receptor", maxlength: 200, disabled: !ed, oninput: (e) => { f.nombre = e.target.value; sucio = true; pintarBarra(); pintarTotales(); } }))]) : null;
      poner(cuerpoReceptor,
        h("div", { class: "grid2" }, campo("Receptor", selCli), campo("Establecimiento", selEst)), chkNuevo, nuevo,
        h("div", { class: "grid2" }, campo("Fecha de emisión", h("input", { type: "date", value: f.fecha, "aria-label": "Fecha de emisión", disabled: !ed, oninput: (e) => { f.fecha = e.target.value; sucio = true; pintarBarra(); } })),
          campo("Observaciones", h("input", { value: f.observaciones, maxlength: 500, "aria-label": "Observaciones", disabled: !ed, oninput: (e) => { f.observaciones = e.target.value; sucio = true; pintarBarra(); } }))));
    }
    function pintarLineas() {
      const ed = editable(), calc = calcularSeguro();
      const filas = f.lineas.map((l, i) => {
        const txt = (k, et, extra = {}) => h("input", { value: l[k], "aria-label": `${et} de la línea ${i + 1}`, disabled: !ed, ...extra, oninput: (e) => { l[k] = e.target.value; sucio = true; refrescar(); } });
        const dt = h("select", { "aria-label": `Tipo de descuento de la línea ${i + 1}`, disabled: !ed, onchange: (e) => { l.descuento_tipo = e.target.value; if (l.descuento_tipo === "ninguno") l.descuento_valor = "0"; sucio = true; pintarLineas(); pintarBarra(); } },
          ...[["ninguno", "Sin descuento"], ["monto", "En quetzales"], ["porcentaje", "En porcentaje"]].map(([v, t]) => h("option", { value: v, selected: l.descuento_tipo === v }, t)));
        return h("div", { class: "ln", "data-linea": String(i + 1) },
          h("div", { class: "ln-c ln-desc", "data-et": "Descripción" }, txt("descripcion", "Descripción", { maxlength: 300, placeholder: "Escribe una descripción o selecciona un concepto…", list: "conceptos-dl", onchange: (e) => { const c = est.conceptos?.find((x) => x.descripcion === e.target.value); if (c && !l.precio_unitario) { l.precio_unitario = c.precio_unitario; sucio = true; const pr = e.target.closest(".ln")?.querySelector('input[aria-label^="Precio de la línea"]'); if (pr) pr.value = l.precio_unitario; refrescar(); } } })),
          h("div", { class: "ln-c", "data-et": "Cantidad" }, txt("cantidad", "Cantidad", { inputmode: "decimal" })),
          h("div", { class: "ln-c", "data-et": "Precio (Q)" }, txt("precio_unitario", "Precio", { inputmode: "decimal", placeholder: "0.00" })),
          h("div", { class: "ln-c", "data-et": "Descuento" }, dt, l.descuento_tipo !== "ninguno" ? txt("descuento_valor", "Valor del descuento", { inputmode: "decimal" }) : null),
          h("div", { class: "ln-c ln-neto num", "data-et": "Neto" }, h("span", { class: "neto" }, calc.ok ? quetzales(calc.r.lineas[i]?.neto) : "—"),
            ed && f.lineas.length > 1 ? h("button", { type: "button", class: "icon-btn", title: "Quitar línea", "aria-label": `Quitar la línea ${i + 1}`, onclick: () => { f.lineas.splice(i, 1); sucio = true; pintarLineas(); pintarBarra(); } }, icono("trash")) : null));
      });
      poner(cuerpoLineas, h("div", { class: "ln ln-cab", "aria-hidden": "true" }, ...["Descripción", "Cantidad", "Precio (Q)", "Descuento", "Neto"].map((t) => h("span", {}, t))), ...filas, h("datalist", { id: "conceptos-dl" }, ...(est.conceptos ?? []).map((c) => h("option", { value: c.descripcion }))),
        ed ? boton("Agregar ítem", { tipo: "sec", icon: "plus", onclick: () => { f.lineas.push(linea()); sucio = true; pintarLineas(); pintarBarra(); } }) : null);
      pintarTotales();
    }
    function refrescar() { const c = calcularSeguro(); cuerpoLineas.querySelectorAll(".ln:not(.ln-cab) .neto").forEach((el, i) => { el.textContent = c.ok ? quetzales(c.r.lineas[i]?.neto) : "—"; }); pintarTotales(); pintarBarra(); }
    function pintarTotales() {
      const c = calcularSeguro(), ps = problemas();
      const fila = (et, v, extra) => h("div", { class: `tot${extra ? " " + extra : ""}` }, h("span", {}, et), h("strong", { class: "num" }, v));
      poner(totales, h("h2", { class: "card-t" }, "Resumen"),
        h("div", { class: "sello" }, icono("lock"), h("div", {}, h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("small", {}, "Vista previa no certificada: sin serie, número ni autorización oficiales."))),
        ...(c.ok ? [fila("Subtotal", quetzales(c.r.subtotal)), fila("Descuentos", quetzales(c.r.descuento_total)), fila("Base imponible", quetzales(c.r.base_imponible), "tot-base")] : [h("p", { class: "mut" }, "Completa cantidad y precio de cada línea para ver los importes.")]),
        h("div", { class: "pend" }, icono("info"), h("div", {}, h("strong", {}, "Impuestos y total: pendientes"), h("small", {}, "Se calcularán cuando exista un régimen fiscal verificado con un contador. Hoy no se aplica ninguna fórmula fiscal."))),
        ps.length && (intentoGuardar || !editable()) ? h("div", { class: "validacion", role: "status" }, h("strong", {}, "Antes de guardar:"), h("ul", {}, ...ps.map((x) => h("li", {}, x)))) : ps.length ? h("p", { class: "mut ayuda-val" }, `${ps.length} dato${ps.length > 1 ? "s" : ""} por completar.`) : h("p", { class: "ok-val" }, icono("circleCheck"), h("span", {}, "Datos completos.")));
    }
    function pintarBarra() {
      const ed = editable(), prep = doc.estado_preparacion, btns = [];
      btns.push(boton("Volver", { tipo: "sec", onclick: () => ctx.ir("/") }));
      if (ed && paso > 1) btns.push(boton("Atrás", { tipo: "sec", icon: "undo", id: "paso-atras", onclick: () => irPaso(paso - 1) }));
      if (!ed) btns.push(boton("Vista previa", { tipo: "sec", icon: "eye", onclick: () => vistaPrevia({ ctx, doc, f, calc: calcularSeguro(), det: d }) }));
      else if (paso < 3) btns.push(boton("Vista previa", { tipo: "sec", icon: "eye", id: "ver-previa", onclick: () => irPaso(3) }));
      if (ed) btns.push(boton(doc.id ? "Guardar cambios" : "Guardar borrador", { tipo: paso === 3 ? "sec" : "sec", icon: "check", id: "guardar", onclick: guardar }));
      if (ed && paso < 3) btns.push(boton("Continuar", { icon: "check", id: "paso-siguiente", onclick: () => irPaso(paso + 1) }));
      if (doc.id && prep === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.revisar")) btns.push(boton("Validar con el proveedor", { tipo: "sec", icon: "shield", disabled: sucio, title: sucio ? "Guarda los cambios antes de validar" : null, onclick: validar }),
        boton("Marcar como revisado", { tipo: "sec", icon: "circleCheck", disabled: sucio, title: sucio ? "Guarda los cambios antes de revisar" : null, onclick: () => cambiar("revisado") }));
      if (doc.id && prep === "revisado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.editar")) btns.push(boton("Volver a borrador", { tipo: "sec", icon: "undo", onclick: () => cambiar("borrador") }));
      if (doc.id && prep !== "archivado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.archivar")) btns.push(boton("Archivar", { tipo: "peligro", icon: "archive", onclick: archivar }));
      poner(barra, sucio && doc.id ? h("span", { class: "sucio" }, "Cambios sin guardar") : null, ...btns);
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
      pintarCab(); pintarPasos(); pintarReceptor(); pintarLineas(); pintarBarra(); pintarProceso();
      poner(cardDatos, h("h2", { class: "card-t" }, "Datos de la factura y del comprador"), cuerpoReceptor);
      poner(cardItems, h("div", { class: "card-fila" }, h("h2", { class: "card-t" }, "Ítems de la factura"), cuerpoCatalogo()), cuerpoLineas);
      pintarPrevia(); mostrar();
    }
    function cuerpoCatalogo() {
      if (!editable() || !est.conceptos?.length) return null;
      const sel = h("select", { "aria-label": "Agregar un concepto del catálogo", class: "sel-concepto", onchange: (e) => {
        const c = est.conceptos.find((x) => x.id === e.target.value); e.target.value = ""; if (!c) return;
        const vacia = f.lineas.length === 1 && !f.lineas[0].descripcion.trim() && !f.lineas[0].precio_unitario;
        const nueva = { ...linea(), descripcion: c.descripcion, precio_unitario: c.precio_unitario }; if (vacia) f.lineas[0] = nueva; else f.lineas.push(nueva);
        sucio = true; pintarLineas(); pintarBarra(); pintarPrevia(); } },
        h("option", { value: "" }, "Buscar concepto…"), ...est.conceptos.map((c) => h("option", { value: c.id }, `${c.tipo === "bien" ? "Bien" : "Servicio"} · ${c.descripcion}`)));
      return sel;
    }
    todo();
    return h("div", {}, cab,
      !editable() && doc.id ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, doc.estado_fiscal !== "ninguno" ? "Este documento tiene vida fiscal (simulada) y su contenido ya no se puede editar." : doc.estado_preparacion === "borrador" ? "Tu rol no permite editar este borrador." : "El contenido está congelado porque fue revisado. Vuelve a borrador para editarlo.")) : null,
      pasosEl,
      h("div", { class: "doc-grid" },
        h("div", { class: "doc-main" }, cardDatos, cardItems, cardPrev, err, proceso),
        totales), barra);
  }
}
