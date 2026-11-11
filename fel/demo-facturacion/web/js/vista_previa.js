// Vista previa del documento. Siempre marcada «SIMULADO - SIN VALOR FISCAL». Con un formulario abierto muestra lo escrito; con un documento certificado
// (simulado) muestra lo guardado, incluidos serie, número y autorización SIMULADOS (prefijo SIM).
import { h, boton, modal, quetzales, fechaLarga } from "/app/js/ui.js";
import { calcular } from "/app/js/calculo.js";

export function vistaPrevia({ ctx, doc, f, calc, det }) {
  const est = ctx.estado;
  let receptor, establecimiento, fecha, lineas, c;
  if (f) {
    const cli = est.clientes.find((x) => x.id === f.cliente_id);
    receptor = f.nuevo ? (f.tipo === "CF" ? "Consumidor final (CF)" : `${f.nombre || "—"} · ${f.tipo} ${f.numero || "—"}`) : cli ? `${cli.nombre} · ${cli.tipo_identificacion === "CF" ? "CF" : `${cli.tipo_identificacion} ${cli.numero_identificacion}`}` : "— sin receptor —";
    establecimiento = est.establecimientos.find((x) => x.id === f.establecimiento_id); fecha = f.fecha; lineas = f.lineas;
    c = calc?.ok ? calc.r : null;
  } else {
    receptor = det.documento.cliente_nombre ? `${det.documento.cliente_nombre} · ${det.documento.cliente_tipo === "CF" ? "CF" : `${det.documento.cliente_tipo} ${det.documento.cliente_numero}`}` : "— sin receptor —";
    establecimiento = est.establecimientos.find((x) => x.id === det.documento.establecimiento_id); fecha = det.documento.fecha_emision_prevista ? String(det.documento.fecha_emision_prevista).slice(0, 10) : "";
    lineas = det.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) }));
    try { c = calcular(lineas); } catch { c = null; }
  }
  const certificado = doc.estado_fiscal === "certificado" && doc.autorizacion_sat;
  const papel = h("div", { class: "papel", "data-vista": "previa" },
    h("div", { class: "marca-agua", "aria-hidden": "true" }, "SIMULADO - SIN VALOR FISCAL"),
    h("div", { class: "papel-cab" }, h("div", {}, h("strong", {}, est.empresa.nombre), h("small", {}, `NIT ${est.empresa.nit} (ficticio)`), h("small", {}, establecimiento ? `Establecimiento ${establecimiento.codigo_sat} · ${establecimiento.nombre}` : "Sin establecimiento")),
      h("div", { class: "papel-tipo" }, h("strong", {}, certificado ? "Factura (certificada en SIMULACIÓN)" : "Factura · vista previa NO certificada"), h("small", {}, `Fecha de emisión: ${fecha ? fechaLarga(fecha) : "—"}`),
        certificado ? h("small", { class: "mono" }, `Serie ${doc.serie} · Número ${doc.numero_fiscal}`) : h("small", {}, "Sin serie, número ni autorización"),
        certificado ? h("small", { class: "mono" }, `Autorización ${doc.autorizacion_sat}`) : null)),
    h("div", { class: "papel-rec" }, h("small", { class: "mut" }, "Receptor"), h("strong", {}, receptor)),
    h("table", { class: "papel-tabla" }, h("thead", {}, h("tr", {}, ...["Descripción", "Cant.", "Precio", "Descuento", "Neto"].map((t, i) => h("th", { class: i ? "der" : "" }, t)))),
      h("tbody", {}, ...lineas.map((l, i) => h("tr", {}, h("td", {}, l.descripcion || "—"), h("td", { class: "der num" }, l.cantidad), h("td", { class: "der num" }, l.precio_unitario ? quetzales(l.precio_unitario) : "—"),
        h("td", { class: "der num" }, l.descuento_tipo === "ninguno" ? "—" : l.descuento_tipo === "porcentaje" ? `${l.descuento_valor}%` : quetzales(l.descuento_valor)), h("td", { class: "der num" }, c ? quetzales(c.lineas[i]?.neto) : "—"))))),
    h("div", { class: "papel-tot" }, c ? [h("div", {}, h("span", {}, "Subtotal"), h("strong", { class: "num" }, quetzales(c.subtotal))), h("div", {}, h("span", {}, "Descuentos"), h("strong", { class: "num" }, quetzales(c.descuento_total))), h("div", { class: "papel-base" }, h("span", {}, "Base imponible"), h("strong", { class: "num" }, quetzales(c.base_imponible)))] : h("p", { class: "mut" }, "Completa los importes para ver los totales."),
      h("p", { class: "mut" }, "Impuestos y total: pendientes (no hay régimen fiscal verificado).")),
    h("p", { class: "papel-pie" }, "Documento de demostración. No es una factura, no fue enviado a SAT ni a ningún certificador y no tiene validez fiscal."));
  modal({ titulo: "Vista previa del documento", ancho: "lg", contenido: papel, pie: [boton("Imprimir", { tipo: "sec", onclick: () => window.print() })] });
}
