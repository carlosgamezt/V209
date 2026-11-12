// Plan, saldo y consumo de una empresa (la misma pantalla la usa el administrador de la plataforma para ver a cualquier empresa).
// Todo es simulado: sin pasarela de pago; NEXA no calcula impuestos de sus propias facturas.
import { h, boton, insignia, vacio, cabecera, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { quetzales } from "./dinero.js";
import { api } from "./api.js";
import { codigoBorrador } from "/app/js/formato.js";

export const fechaCorta = (t) => { if (!t) return "—"; const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }); };
export const fechaHora = (t) => { if (!t) return "—"; const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t) : `${d.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" })}`; };
const MODALIDAD = { prepago: "Prepago", consumo_mensual: "Consumo mensual", suscripcion: "Suscripción" };
const EVENTO = { certificacion: "Certificación", anulacion: "Anulación", rechazo_proveedor: "Rechazo del proveedor", consulta: "Consulta" };
const ESTADO_CONSUMO = { reservado: ["Retenido", "ambar"], confirmado: ["Confirmado", "verde"], liberado: ["Liberado", "gris"] };
const num = (t) => String(Number(t));   // 2.000000 → 2

export const tablaSimple = (cols, filas, vacioTxt = "Sin movimientos.") => filas.length
  ? h("div", { class: "tabla-simple", role: "region", "aria-label": "Tabla", tabindex: "0" }, h("table", {}, h("thead", {}, h("tr", {}, ...cols.map(([t, cl]) => h("th", { class: cl ?? "", scope: "col" }, t)))),
      h("tbody", {}, ...filas.map((f) => h("tr", {}, ...f.map((c, i) => h("td", { class: cols[i][1] ?? "", "data-et": cols[i][0] }, c)))))))
  : h("p", { class: "mut" }, vacioTxt);

export function vistaPlan(p, { maestro = false } = {}) {
  if (!p.cuenta && !p.contrato) return vacio("package", "Sin plan contratado", "Esta empresa todavía no tiene un plan. El administrador de la plataforma debe asignarlo.");
  const c = p.contrato, m = p.monedero, r = p.resumen;
  const indic = (icon, valor, et, tono = "azul") => h("div", { class: `indicador ind-${tono}` }, h("span", { class: "ind-ik" }, icono(icon)), h("div", {}, h("strong", { class: "num" }, valor), h("small", {}, et)));
  const bloques = [h("div", { class: "indicadores", "data-panel": "plan-resumen" },
    indic("package", c ? c.nombre : "—", `${c ? MODALIDAD[c.modalidad] : ""} · cuenta ${p.cuenta?.estado ?? "—"}`),
    c?.modalidad === "prepago" && m ? indic("circleCheck", quetzales(m.disponible), "Saldo disponible", Number(m.disponible) <= 10 ? "ambar" : "azul") : indic("file", String(r.certificaciones), "Certificaciones del periodo", "lila"),
    indic("file", String(r.certificaciones), "Documentos certificados (total)", "lila"), indic("lock", num(r.unidades), `Unidades consumidas · ${r.reservadas} retenidas`, "ambar"))];
  if (m && c?.modalidad === "prepago") bloques.push(h("div", { class: "card", "data-panel": "monedero" }, h("h2", { class: "card-t" }, "Monedero (simulado)"),
    h("div", { class: "datos" }, ...[["Recargado", m.recargado], ["Consumido", m.consumido], ["Retenido por operaciones abiertas", m.reservado], ["Disponible", m.disponible]].map(([t, v]) => h("div", { class: "dato" }, h("small", {}, t), h("strong", { class: "num" }, quetzales(v))))),
    h("p", { class: "mut" }, "Una certificación retiene su importe antes de enviarse; si el resultado es desconocido, la retención se mantiene hasta conocerlo.")));
  if (c) bloques.push(h("div", { class: "card", "data-panel": "tarifas" }, h("h2", { class: "card-t" }, `Plan ${c.nombre} · versión ${c.version}`),
    h("div", { class: "datos" }, ...[["Modalidad", MODALIDAD[c.modalidad]], ["Cuota fija", quetzales(c.cuota_fija)], ["Unidades incluidas", num(c.unidades_incluidas)], ["Sobregiro", c.permite_sobregiro ? `hasta ${quetzales(c.limite_sobregiro)}` : "No permitido"], ["Vigente desde", fechaCorta(c.desde)], ["Cupo mensual", p.cuenta?.cupo ? `${num(p.cuenta.cupo)} unidades` : "Sin límite"]].map(([t, v]) => h("div", { class: "dato" }, h("small", {}, t), h("strong", {}, v)))),
    tablaSimple([["Evento"], ["Precio por unidad", "der"], ["¿Se cobra?"]], p.tarifas.map((t) => [EVENTO[t.evento_tipo] ?? t.evento_tipo, quetzales(t.precio_unitario), t.cargable ? "Sí" : "No (por política)"]))));
  bloques.push(h("div", { class: "card", "data-panel": "consumos" }, h("h2", { class: "card-t" }, "Consumo por documento"),
    tablaSimple([["Fecha"], ["Evento"], ["Documento"], ["Estado"], ["Unidades", "der"], ["Cargado", "der"]],
      p.consumos.map((x) => [fechaHora(x.reservado_en), EVENTO[x.evento_tipo] ?? x.evento_tipo, x.documento_id && !maestro ? h("a", { href: `#/f/${x.documento_id}` }, codigoBorrador(x.numero_borrador)) : x.numero_borrador ? codigoBorrador(x.numero_borrador) : "—", insignia(...(ESTADO_CONSUMO[x.estado] ?? [x.estado, "gris"])),
        num(x.estado === "confirmado" ? x.unidades_consumidas : x.unidades_reservadas), Number(x.cargado) ? quetzales(x.cargado) : "—"]), "Todavía no hay consumo."),
    h("p", { class: "mut" }, "Un rechazo o una anulación no se cobran al cliente por política, aunque el proveedor consuma unidades de su bolsón.")));
  bloques.push(h("div", { class: "card", "data-panel": "pagos" }, h("h2", { class: "card-t" }, "Pagos (simulados)"),
    tablaSimple([["Fecha"], ["Referencia"], ["Estado"], ["Monto", "der"]], p.pagos.map((x) => [fechaHora(x.confirmado_en), x.referencia_pago, insignia(x.estado === "confirmado" ? "Confirmado" : "Revertido", x.estado === "confirmado" ? "verde" : "gris"), quetzales(x.monto)]), "Sin pagos registrados.")));
  bloques.push(h("div", { class: "card", "data-panel": "cobros" }, h("h2", { class: "card-t" }, "Cargos y cobros"),
    tablaSimple([["Fecha"], ["Concepto"], ["Cantidad", "der"], ["Precio", "der"], ["Monto", "der"], ["Estado"]], p.cargos.map((x) => [fechaHora(x.creado_en), x.concepto === "evento" ? "Certificación" : x.concepto, num(x.cantidad), quetzales(x.precio_unitario), quetzales(x.monto), insignia(x.estado === "pendiente" ? "Pendiente" : "En un cobro", x.estado === "pendiente" ? "ambar" : "verde")]), "Sin cargos."),
    p.cobros.length ? tablaSimple([["Periodo"], ["Neto", "der"], ["Documento de cobro"], ["Total del documento", "der"], ["Estado"]], p.cobros.map((x) => [fechaCorta(x.periodo), quetzales(x.monto_neto), x.referencia_documento ?? "—", x.monto_total_documento ? quetzales(x.monto_total_documento) : "—", insignia(x.estado === "emitido" ? "Emitido" : x.estado === "borrador" ? "Borrador" : "Anulado", x.estado === "emitido" ? "verde" : "gris")])) : null,
    h("p", { class: "aviso aviso-azul" }, icono("info"), h("span", {}, p.aviso))));
  return h("div", { class: "plan-col" }, ...bloques);
}

export function pantallaPlan(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando plan y consumo…"));
  api.plan().then((p) => poner(cuerpo, vistaPlan(p))).catch((e) => poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))));
  return h("section", { class: "pantalla" }, cabecera({ icon: "package", titulo: "Plan y consumo", subtitulo: "Tu plan, saldo, consumo por documento, cargos y cobros (simulados)." }), cuerpo);
}
export { boton };
