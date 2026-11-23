// Tipos de documento (DTE) en el formulario: selector compacto, campos propios de cada tipo (nota: documento de origen y motivo; recibo: su tipo), avisos y validaciones locales.
// El catálogo, la habilitación por empresa y las reglas viven en el SERVIDOR (proveedores/src/catalogo_dte.ts y la base): aquí solo se muestran y se avisa antes de guardar;
// el servidor y la base vuelven a validarlo todo. «En pruebas» = se elabora, valida y previsualiza, pero NO se certifica.
import { h, quetzales } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";

export const TIPOS_RECIBO = ["Universidad", "Colegio", "Inmobiliaria"];
const DISPONIBILIDAD = { implementado: "Disponible", en_pruebas: "En pruebas", pendiente: "Pendiente" };
export const etiquetaDisponibilidad = (d) => DISPONIBILIDAD[d] ?? d;
export const tipoPorCodigo = (tipos, c) => tipos?.tipos?.find((t) => t.codigo === c) ?? null;
/** Tipos que se pueden ELEGIR hoy en este formulario: habilitados para la empresa y no pendientes. */
export const tiposElegibles = (tipos) => (tipos?.tipos ?? []).filter((t) => t.habilitado && t.disponibilidad !== "pendiente");

/** Estado inicial de los campos de tipo del formulario (de un documento existente o del predeterminado de la empresa). */
export function tipoInicial(tipos, doc) {
  const codigo = doc?.tipo_dte ?? tipos?.predeterminado ?? "FACT";
  return { tipo_dte: codigo, documento_origen_id: doc?.documento_origen_id ?? "", motivo_ajuste: doc?.motivo_ajuste ?? "", tipo_recibo: doc?.tipo_recibo ?? "", origen: doc?.referencia_origen ?? null };
}
/** Al cambiar de tipo se limpia lo que el nuevo tipo no usa (la base también lo descarta). */
export function aplicarTipo(f, tipos, codigo) {
  const t = tipoPorCodigo(tipos, codigo); f.tipo_dte = codigo;
  if (!t?.requiere_origen) { f.documento_origen_id = ""; f.motivo_ajuste = ""; f.origen = null; }
  if (codigo !== "RECI") f.tipo_recibo = "";
}
/** Texto para el título según el tipo (nuevo o existente). */
export const tituloDocumento = (tipos, f) => tipoPorCodigo(tipos, f.tipo_dte)?.titulo ?? "Factura";

/** Problemas propios del tipo, en lenguaje claro (se suman a los de siempre). */
export function problemasTipo(f, tipos, { receptorCF = false, base = null } = {}) {
  const p = [], t = tipoPorCodigo(tipos, f.tipo_dte); if (!t) return ["Tipo de documento no válido."];
  if (t.disponibilidad === "pendiente") p.push(`${t.nombre} aún no está disponible.`);
  else if (!t.habilitado) p.push(t.motivo_no_habilitado ?? `${t.nombre} no está habilitado para esta empresa.`);
  if (t.requiere_origen) {
    if (!f.documento_origen_id) p.push(`${t.nombre}: elige el documento certificado al que hace referencia.`);
    const m = (f.motivo_ajuste ?? "").trim(); if (m.length < 3 || m.length > 50) p.push("Indica el motivo del ajuste (3 a 50 caracteres).");
    if (f.origen && base !== null && t.codigo === "NCRE") {
      const tope = Number(f.origen.total) - Number(f.origen.acreditado ?? 0);
      if (Number.isFinite(tope) && Number(base) > tope + 0.000001) p.push(`El importe supera lo que queda por acreditar del documento de origen (${quetzales(String(Math.max(tope, 0)))}).`);
    }
  }
  if (t.codigo === "RECI") { if (!TIPOS_RECIBO.includes(f.tipo_recibo)) p.push(`El recibo exige su tipo: ${TIPOS_RECIBO.join(", ")}.`); if (receptorCF) p.push("Un recibo no se emite a consumidor final."); }
  return p;
}

/** Selector compacto en la parte superior. Con un solo tipo habilitado queda como etiqueta (captura rápida de siempre); con varios, un desplegable. */
export function selectorTipo({ tipos, f, editable, alCambiar }) {
  const el = h("div", { class: "tipo-bar", "data-tipo-bar": "1" }), disp = tiposElegibles(tipos), actual = tipoPorCodigo(tipos, f.tipo_dte);
  const enLista = disp.some((t) => t.codigo === f.tipo_dte);
  const opciones = enLista || !actual ? disp : [actual, ...disp];   // un documento ya guardado con un tipo que hoy no está habilitado se sigue mostrando
  if (opciones.length <= 1 || !editable) {
    el.append(h("span", { class: "tipo-et" }, "Documento"), h("strong", { class: "tipo-chip", id: "tipo-actual" }, actual?.nombre ?? "Factura"));
  } else {
    const sel = h("select", { id: "tipo-documento", class: "tipo-sel", "aria-label": "Tipo de documento", onchange: (e) => alCambiar(e.target.value) },
      ...opciones.map((t) => h("option", { value: t.codigo, selected: t.codigo === f.tipo_dte }, `${t.corto}${t.disponibilidad === "en_pruebas" ? " (en pruebas)" : ""}`)));
    sel.value = f.tipo_dte; el.append(h("label", { class: "tipo-et", for: "tipo-documento" }, "Documento"), sel);
  }
  if (actual?.disponibilidad === "en_pruebas") el.append(h("span", { class: "tag tag-test", title: actual.motivo_pendiente ?? "", "data-en-pruebas": "1" }, "En pruebas"));
  return el;
}

/** Tarjeta con los campos propios del tipo. Devuelve null para Factura (nada cambia en la captura rápida). */
export function panelTipo({ tipos, f, editable, cambio, aplicarOrigen, ctx }) {
  const t = tipoPorCodigo(tipos, f.tipo_dte); if (!t || t.codigo === "FACT") return null;
  const hijos = [];
  if (t.disponibilidad === "en_pruebas") hijos.push(h("p", { class: "aviso", role: "status", id: "aviso-en-pruebas" }, icono("info"), h("span", {}, `${t.nombre} está EN PRUEBAS: puedes elaborarlo, validarlo y verlo en vista previa, pero todavía no se puede certificar. ${t.motivo_pendiente ?? ""}`.trim())));
  if (t.requiere_origen) hijos.push(origenCampos({ t, f, editable, cambio, aplicarOrigen, ctx }));
  if (t.codigo === "RECI") {
    const sel = h("select", { id: "tipo-recibo", "aria-label": "Tipo de recibo", disabled: !editable, onchange: (e) => { f.tipo_recibo = e.target.value; cambio(); } },
      h("option", { value: "" }, "Elige el tipo…"), ...TIPOS_RECIBO.map((x) => h("option", { value: x, selected: x === f.tipo_recibo }, x)));
    sel.value = f.tipo_recibo;
    hijos.push(h("label", { class: "rc-mini" }, h("span", {}, "Tipo de recibo"), sel), h("p", { class: "mut tipo-nota" }, "Un recibo NO es una factura y no la sustituye. La empresa debe estar fiscalmente habilitada para emitirlo."));
  }
  return h("div", { class: "card card-tipo", "data-tipo": t.codigo }, h("h2", { class: "card-t" }, t.nombre), ...hijos);
}

function origenCampos({ t, f, editable, cambio, aplicarOrigen, ctx }) {
  const res = h("div", { class: "origen-res", id: "origen-res" }), lista = h("select", { id: "origen-lista", "aria-label": "Documento de origen", disabled: !editable }, h("option", { value: "" }, "Cargando documentos certificados…"));
  const buscar = h("input", { id: "origen-buscar", type: "search", placeholder: "Buscar por serie, número o cliente…", "aria-label": "Buscar el documento de origen", disabled: !editable, autocomplete: "off" });
  let candidatos = [], reloj = null;
  const resumen = () => {
    const o = f.origen;
    if (!o) { res.replaceChildren(h("small", { class: "mut" }, "Solo aparecen documentos ya certificados de esta empresa.")); return; }
    res.replaceChildren(h("div", { class: "origen-datos", "data-origen": "1" },
      h("span", {}, h("b", {}, "Serie "), o.serie), h("span", {}, h("b", {}, "Número "), o.numero), h("span", {}, h("b", {}, "Fecha "), o.fecha_emision ?? o.fechaEmision ?? "—"), h("span", {}, h("b", {}, "Total "), quetzales(String(o.total ?? "0"))),
      t.codigo === "NCRE" && o.acreditado !== undefined ? h("span", {}, h("b", {}, "Ya acreditado "), quetzales(String(o.acreditado))) : null),
      h("small", { class: "mut" }, "Los datos fiscales vienen del documento certificado; la nota se dirige a su mismo receptor."));
  };
  const texto = (c) => `Serie ${c.serie} · No. ${c.numero_fiscal} · ${c.cliente_nombre ?? "—"} · ${quetzales(String(c.total ?? "0"))} · ${c.fecha_emision ?? ""}`;
  const pintarLista = () => {
    const op = candidatos.map((c) => h("option", { value: c.id, selected: c.id === f.documento_origen_id }, texto(c)));
    lista.replaceChildren(h("option", { value: "" }, candidatos.length ? "Elige el documento certificado…" : "No hay documentos certificados que coincidan"), ...op); lista.value = f.documento_origen_id || "";
  };
  const cargar = async () => {
    try { candidatos = await api.origenes(t.codigo, null, buscar.value.trim()); pintarLista(); } catch { lista.replaceChildren(h("option", { value: "" }, "No se pudo cargar la lista")); }
  };
  lista.onchange = (e) => { const c = candidatos.find((x) => x.id === e.target.value); f.documento_origen_id = c ? c.id : ""; f.origen = c ? { serie: c.serie, numero: c.numero_fiscal, fecha_emision: c.fecha_emision, total: c.total, acreditado: c.acreditado, tipo: c.tipo_dte } : null; aplicarOrigen(c ?? null); resumen(); cambio(); };
  buscar.oninput = () => { clearTimeout(reloj); reloj = setTimeout(cargar, 250); };
  const motivo = h("input", { id: "motivo-ajuste", maxlength: 50, value: f.motivo_ajuste, placeholder: "Ej.: devolución de mercadería", "aria-label": "Motivo del ajuste", disabled: !editable, oninput: (e) => { f.motivo_ajuste = e.target.value; cambio(); } });
  resumen(); if (editable) cargar(); else pintarLista();
  return h("div", { class: "tipo-origen" }, h("label", { class: "rc-mini" }, h("span", {}, "Documento de origen (certificado)"), lista), editable ? buscar : null, res, h("label", { class: "rc-mini" }, h("span", {}, "Motivo del ajuste"), motivo));
}
