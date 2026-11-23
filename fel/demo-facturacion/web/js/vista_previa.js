// Vista previa del documento. Siempre marcada «SIMULADO - SIN VALOR FISCAL». Con un formulario abierto muestra lo escrito; con un documento certificado
// (simulado) muestra lo guardado, incluidos serie, número y autorización SIMULADOS (prefijo SIM). Estructura de la referencia aprobada (emisor con contacto,
// comprador, líneas, observaciones y totales).
import { h, boton, modal, quetzales, fechaLarga } from "/app/js/ui.js";
import { descargarArchivo } from "./descarga.js";
import { calcular } from "/app/js/calculo.js";
import { codigoBorrador } from "/app/js/formato.js";
import { tipoPorCodigo } from "./tipos.js";

export function papel({ ctx, doc, f, calc, det, formato = "carta" }) {
  const est = ctx.estado, emp = est.empresa;
  let cliente, establecimiento, fecha, lineas, c, observaciones;
  if (f) {
    const cli = est.clientes.find((x) => x.id === f.cliente_id);
    cliente = f.nuevo ? { nombre: f.tipo === "CF" ? (f.nombre || "CONSUMIDOR FINAL") : f.nombre || "—", id: f.tipo === "CF" ? "CF" : f.numero || "—", direccion: "" }
      : cli ? { nombre: cli.nombre, id: cli.tipo_identificacion === "CF" ? "CF" : cli.numero_identificacion, direccion: cli.direccion ?? "" } : null;
    establecimiento = est.establecimientos.find((x) => x.id === f.establecimiento_id); fecha = f.fecha; lineas = f.lineas; observaciones = f.observaciones;
    c = calc?.ok ? calc.r : null;
  } else {
    const d = det.documento, cli = est.clientes.find((x) => x.id === d.cliente_id);
    cliente = d.cliente_nombre ? { nombre: d.cliente_nombre, id: d.cliente_tipo === "CF" ? "CF" : d.cliente_numero, direccion: cli?.direccion ?? "" } : null;
    establecimiento = est.establecimientos.find((x) => x.id === d.establecimiento_id); fecha = d.fecha_emision_prevista ? String(d.fecha_emision_prevista).slice(0, 10) : ""; observaciones = d.observaciones ?? "";
    lineas = det.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) }));
    try { c = calcular(lineas); } catch { c = null; }
  }
  // tipo de documento: título (Factura por defecto), referencia de las notas y aviso del recibo
  const codTipo = f?.tipo_dte ?? doc.tipo_dte ?? "FACT", tp = tipoPorCodigo(ctx.tiposDoc, codTipo), tit = tp?.titulo ?? "Factura", distinto = codTipo !== "FACT";
  const ro = f ? (f.origen ? { serie: f.origen.serie, numero: f.origen.numero, fecha: f.origen.fecha_emision, tipo: f.origen.tipo ?? "FACT" } : null)
    : doc.referencia_origen ? { serie: doc.referencia_origen.serie, numero: doc.referencia_origen.numero, fecha: doc.referencia_origen.fecha_emision, tipo: doc.referencia_origen.tipo } : null;
  const motivoAj = f ? f.motivo_ajuste : doc.motivo_ajuste, tipoRec = f ? f.tipo_recibo : doc.tipo_recibo;
  const bloqueTipo = distinto ? h("div", { class: "pp-tipo-bloque", "data-tipo-doc": codTipo },
    ro ? h("div", { class: "pp-ref-origen" }, h("strong", {}, `${tit} · hace referencia a `), `${ro.tipo} serie ${ro.serie} · número ${ro.numero}${ro.fecha ? ` · ${ro.fecha}` : ""}`, motivoAj ? ` · Motivo: ${motivoAj}` : "") : null,
    codTipo === "RECI" ? h("div", { class: "pp-ref-origen" }, h("strong", {}, `Recibo${tipoRec ? " " + tipoRec : ""} · `), "este documento NO es una factura") : null,
    tp?.disponibilidad === "en_pruebas" ? h("div", { class: "pp-en-pruebas" }, "EN PRUEBAS · no certificable todavía") : null) : null;
  const anu = doc.estado_fiscal === "anulado" ? "anulado" : doc.estado_fiscal === "anulacion_solicitada" ? "solicitada" : null;   // marca visible de anulación (hecho confirmado / pendiente de conciliar)
  const certificado = ["certificado", "anulacion_solicitada", "anulado"].includes(doc.estado_fiscal) && doc.autorizacion_sat;
  const textoAnu = anu === "anulado" ? "DOCUMENTO ANULADO" : "ANULACIÓN SOLICITADA · PENDIENTE";
  const bandaAnu = anu ? h("div", { class: `anu-banda anu-${anu}`, "data-anulacion": anu, role: "status" }, h("strong", {}, textoAnu), anu === "anulado" ? h("small", {}, "Definitivo · simulación") : h("small", {}, "Sin confirmar todavía")) : null;
  const selloAnu = anu ? h("div", { class: `sello-anu sello-${anu}`, "aria-hidden": "true" }, anu === "anulado" ? "ANULADO" : "ANULACIÓN PENDIENTE") : null;
  const referencia = doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "BR-????";
  const dato = (et, v) => h("div", { class: "pp-dato" }, h("span", {}, et), h("strong", {}, v));
  const sim = !certificado || String(doc.autorizacion_sat).toUpperCase().startsWith("SIM-");
  if (formato === "ticket") {   // ticket térmico de 80 mm: una sola columna, cada ítem en dos líneas (descripción / cantidad × precio y neto)
    const fila = (et, v, cls) => h("div", { class: `tk-fila${cls ? " " + cls : ""}` }, h("span", {}, et), h("strong", { class: "num" }, v));
    return h("div", { class: `papel papel-ticket${anu ? " papel-" + anu : ""}`, "data-vista": "previa", "data-formato": "ticket" }, bandaAnu, selloAnu,
      h("div", { class: "tk-banda" }, h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("small", {}, certificado ? (sim ? "Certificado en SIMULACIÓN" : "Certificado en PRUEBAS (TEST)") + (anu === "anulado" ? " · ANULADO" : anu ? " · anulación pendiente" : "") : "Vista previa NO certificada")),
      h("strong", { class: "tk-razon" }, emp.nombre), h("small", {}, `NIT ${emp.nit} (ficticio)`), h("small", {}, establecimiento?.direccion ?? emp.direccion ?? ""),
      h("div", { class: "tk-meta" }, h("strong", { class: "pp-ref" }, referencia), h("small", {}, fecha ? fechaLarga(fecha) : "—")), distinto ? h("strong", { class: "tk-tipo" }, tit.toUpperCase()) : null, bloqueTipo,
      certificado ? h("small", { class: "mono" }, `Serie ${doc.serie} · Número ${doc.numero_fiscal}`) : null, certificado ? h("small", { class: "mono" }, `${sim ? "Autorización simulada" : "Autorización (pruebas)"} ${doc.autorizacion_sat}`) : null,
      h("hr", {}), h("small", { class: "mut" }, "Receptor"), h("strong", {}, cliente ? cliente.nombre : "— sin receptor —"), cliente ? h("small", {}, cliente.id) : null, h("hr", {}),
      ...lineas.map((l, i) => h("div", { class: "tk-it" }, h("strong", {}, l.descripcion || "—"), h("div", { class: "tk-nn" }, h("span", {}, `${String(l.cantidad).replace(/\.?0+$/, "") || "0"} × ${l.precio_unitario ? quetzales(l.precio_unitario) : "—"}${l.descuento_tipo === "ninguno" ? "" : l.descuento_tipo === "porcentaje" ? ` · −${l.descuento_valor}%` : ` · −${quetzales(l.descuento_valor)}`}`), h("strong", { class: "num" }, c ? quetzales(c.lineas[i]?.neto) : "—")))),
      h("hr", {}), c ? [fila("Subtotal", quetzales(c.subtotal)), fila("Descuentos", quetzales(c.descuento_total)), fila("Base imponible", quetzales(c.base_imponible), "tk-base")] : h("p", { class: "mut" }, "Completa los importes."),
      h("small", { class: "mut" }, "Impuestos y total: pendientes (sin régimen fiscal verificado). NO es una factura ni un DTE."), h("div", { class: "tk-banda tk-pie" }, h("strong", {}, "SIN VALOR FISCAL")));
  }
  return h("div", { class: `papel papel-carta${anu ? " papel-" + anu : ""}`, "data-vista": "previa", "data-formato": "carta" },
    h("div", { class: "marca-agua", "aria-hidden": "true" }, "SIMULADO - SIN VALOR FISCAL"), selloAnu, bandaAnu,
    h("div", { class: "papel-cab" },
      h("div", { class: "pp-emisor" }, h("span", { class: "pp-logo", "aria-hidden": "true" }, "N"),
        h("div", {}, h("strong", { class: "pp-razon" }, emp.nombre), dato("NIT", `${emp.nit} (ficticio)`), dato("Dirección", establecimiento?.direccion ?? emp.direccion), dato("Teléfono", emp.telefono), dato("Correo", emp.correo),
          dato("Establecimiento", establecimiento ? `${establecimiento.codigo_sat} · ${establecimiento.nombre}` : "Sin establecimiento"))),
      h("div", { class: "papel-tipo" }, h("span", { class: "pp-tipo" }, anu === "anulado" ? `${tit} · ANULADA (simulación)` : anu ? `${tit} · anulación pendiente (simulación)` : certificado ? `${tit} · certificada en SIMULACIÓN` : `${tit} · vista previa NO certificada`),
        h("strong", { class: "pp-ref" }, referencia), h("small", {}, "Número interno de borrador"),
        dato("Fecha de emisión", fecha ? fechaLarga(fecha) : "—"), dato("Moneda", "GTQ – Quetzal"),
        certificado ? h("small", { class: "mono" }, `Serie ${doc.serie} · Número ${doc.numero_fiscal}`) : h("small", {}, "Sin serie, número ni autorización oficiales"),
        certificado ? h("small", { class: "mono" }, `Autorización ${doc.autorizacion_sat}`) : null)),
    bloqueTipo,
    h("div", { class: "pp-banda" }, "Datos del comprador"),
    h("div", { class: "papel-rec" }, cliente ? [dato("Identificación", cliente.id), dato("Nombre / Razón social", cliente.nombre), dato("Dirección", cliente.direccion || "—")] : h("p", { class: "mut" }, "— sin receptor —")),
    h("div", { class: "papel-scroll" }, h("table", { class: "papel-tabla" }, h("thead", {}, h("tr", {}, ...["No.", "Descripción", "Cantidad", "Precio unitario (Q)", "Descuento", "Total (Q)"].map((t, i) => h("th", { class: i > 1 ? "der" : "" }, t)))),
      h("tbody", {}, ...lineas.map((l, i) => h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, l.descripcion || "—"), h("td", { class: "der num" }, l.cantidad), h("td", { class: "der num" }, l.precio_unitario ? quetzales(l.precio_unitario) : "—"),
        h("td", { class: "der num" }, l.descuento_tipo === "ninguno" ? "—" : l.descuento_tipo === "porcentaje" ? `${l.descuento_valor}%` : quetzales(l.descuento_valor)), h("td", { class: "der num" }, c ? quetzales(c.lineas[i]?.neto) : "—")))))),
    h("div", { class: "pp-pie" },
      h("div", { class: "pp-obs" }, h("strong", {}, "Observaciones:"), h("p", {}, observaciones || "—")),
      h("div", { class: "papel-tot" }, c ? [h("div", {}, h("span", {}, "Subtotal"), h("strong", { class: "num" }, quetzales(c.subtotal))), h("div", {}, h("span", {}, "Descuentos"), h("strong", { class: "num" }, quetzales(c.descuento_total))), h("div", { class: "papel-base" }, h("span", {}, "Base imponible"), h("strong", { class: "num" }, quetzales(c.base_imponible)))] : h("p", { class: "mut" }, "Completa los importes para ver los totales."),
        h("p", { class: "mut" }, "Impuestos y total: pendientes (no hay régimen fiscal verificado)."))),
    h("p", { class: "papel-pie" }, "Documento de demostración. No es una factura, no fue enviado a SAT ni a ningún certificador y no tiene validez fiscal."));
}

// El ticket es de ancho fijo (80 mm) y ALTO VARIABLE: los navegadores no admiten «size: 80mm auto», así que justo antes de imprimir se inserta (por CSSOM) una regla @page con el alto real del contenido.
let reglaPagina = null;
export function ajustarPagina() {
  const papel = document.querySelector(".previa-modal .papel"), css = [...document.styleSheets].find((s) => (s.href ?? "").endsWith("/web/css/demo.css")); if (!papel || !css) return;
  if (reglaPagina !== null) { try { css.deleteRule(reglaPagina); } catch { /* ya no existe */ } reglaPagina = null; }
  if (papel.dataset.formato === "ticket") { const mm = Math.ceil((papel.offsetHeight * 1.05 * 25.4) / 96) + 10; try { reglaPagina = css.insertRule(`@page ticket{size:80mm ${mm}mm;margin:3mm}`, css.cssRules.length); } catch { /* queda el respaldo del CSS */ } }
}
window.addEventListener("beforeprint", ajustarPagina);   // también cuando se imprime con Ctrl+P / el menú del navegador

/**
 * Vista previa limpia con impresión: elige HOJA CARTA o TICKET 80 mm; «Imprimir» usa el navegador (PC y móvil) con el tamaño de página del formato elegido;
 * «PDF» y «Compartir» usan el PDF del servidor (solo con el documento guardado y sin cambios pendientes, para que el PDF coincida con lo que se ve).
 */
export function vistaPrevia(args) {
  const guardado = !!args.doc?.id && !args.sucio;
  let formato = "carta";
  const cont = h("div", { class: "previa-cont" }), aviso = h("p", { class: "mut previa-nota", role: "status" });
  const pintar = () => { cont.replaceChildren(papel({ ...args, formato })); aviso.textContent = guardado ? "" : "Guarda el borrador para generar el PDF; mientras tanto puedes imprimir esta vista."; };
  const opcion = (v, et) => h("label", { class: "seg-op" }, h("input", { type: "radio", name: "formato-impresion", value: v, checked: v === formato, onchange: () => { formato = v; pintar(); } }), h("span", {}, et));
  const selector = h("div", { class: "seg", role: "radiogroup", "aria-label": "Formato de impresión" }, opcion("carta", "Hoja carta"), opcion("ticket", "Ticket 80 mm"));
  const nombre = () => `NO-FISCAL-DEMO-${formato.toUpperCase()}-${args.doc.numero_borrador ? codigoBorrador(args.doc.numero_borrador) : "BR"}.pdf`;
  const ruta = () => `/api/documentos/${args.doc.id}/pdf-demo?formato=${formato}`;
  const imprimir = () => {
    document.body.classList.add("imprimiendo"); const hecho = () => { document.body.classList.remove("imprimiendo"); window.removeEventListener("afterprint", hecho); };
    window.addEventListener("afterprint", hecho); window.print(); setTimeout(hecho, 1500);
  };
  const compartir = async () => {
    try {
      const r = await fetch(ruta(), { headers: { "x-demo": "1" } }); if (!r.ok) throw new Error("No se pudo generar el PDF.");
      const archivo = new File([await r.blob()], nombre(), { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) await navigator.share({ files: [archivo], title: nombre() }); else await descargarArchivo(ruta(), nombre());
    } catch (e) { if (e?.name !== "AbortError") aviso.textContent = e.message || "No se pudo compartir."; }
  };
  const bPdf = boton("PDF", { tipo: "sec", id: "previa-pdf", disabled: !guardado, title: guardado ? null : "Guarda el borrador primero", onclick: async () => { try { await descargarArchivo(ruta(), nombre()); } catch (e) { aviso.textContent = e.message; } } });
  const bComp = boton("Compartir", { tipo: "sec", id: "previa-compartir", disabled: !guardado, title: guardado ? null : "Guarda el borrador primero", onclick: compartir });
  const m = modal({ titulo: "Vista previa", ancho: "lg", contenido: [selector, aviso, cont], pie: [bPdf, bComp, boton("Imprimir", { id: "previa-imprimir", onclick: imprimir })] });
  m.caja.classList.add("previa-modal"); pintar();
}
