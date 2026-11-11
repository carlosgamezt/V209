// Vista previa del documento. Siempre marcada «SIMULADO - SIN VALOR FISCAL». Con un formulario abierto muestra lo escrito; con un documento certificado
// (simulado) muestra lo guardado, incluidos serie, número y autorización SIMULADOS (prefijo SIM). Estructura de la referencia aprobada (emisor con contacto,
// comprador, líneas, observaciones y totales).
import { h, boton, modal, quetzales, fechaLarga } from "/app/js/ui.js";
import { calcular } from "/app/js/calculo.js";
import { codigoBorrador } from "/app/js/formato.js";

export function papel({ ctx, doc, f, calc, det }) {
  const est = ctx.estado, emp = est.empresa;
  let cliente, establecimiento, fecha, lineas, c, observaciones;
  if (f) {
    const cli = est.clientes.find((x) => x.id === f.cliente_id);
    cliente = f.nuevo ? { nombre: f.tipo === "CF" ? "Consumidor final" : f.nombre || "—", id: f.tipo === "CF" ? "CF" : f.numero || "—", direccion: "" }
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
  const certificado = doc.estado_fiscal === "certificado" && doc.autorizacion_sat;
  const referencia = doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "BR-????";
  const dato = (et, v) => h("div", { class: "pp-dato" }, h("span", {}, et), h("strong", {}, v));
  return h("div", { class: "papel", "data-vista": "previa" },
    h("div", { class: "marca-agua", "aria-hidden": "true" }, "SIMULADO - SIN VALOR FISCAL"),
    h("div", { class: "papel-cab" },
      h("div", { class: "pp-emisor" }, h("span", { class: "pp-logo", "aria-hidden": "true" }, "N"),
        h("div", {}, h("strong", { class: "pp-razon" }, emp.nombre), dato("NIT", `${emp.nit} (ficticio)`), dato("Dirección", establecimiento?.direccion ?? emp.direccion), dato("Teléfono", emp.telefono), dato("Correo", emp.correo),
          dato("Establecimiento", establecimiento ? `${establecimiento.codigo_sat} · ${establecimiento.nombre}` : "Sin establecimiento"))),
      h("div", { class: "papel-tipo" }, h("span", { class: "pp-tipo" }, certificado ? "Factura · certificada en SIMULACIÓN" : "Factura · vista previa NO certificada"),
        h("strong", { class: "pp-ref" }, referencia), h("small", {}, "Número interno de borrador"),
        dato("Fecha de emisión", fecha ? fechaLarga(fecha) : "—"), dato("Moneda", "GTQ – Quetzal"),
        certificado ? h("small", { class: "mono" }, `Serie ${doc.serie} · Número ${doc.numero_fiscal}`) : h("small", {}, "Sin serie, número ni autorización oficiales"),
        certificado ? h("small", { class: "mono" }, `Autorización ${doc.autorizacion_sat}`) : null)),
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

export function vistaPrevia(args) {
  modal({ titulo: "Vista previa del documento", ancho: "lg", contenido: papel(args), pie: [boton("Imprimir", { tipo: "sec", onclick: () => window.print() })] });
}
