// Panel de la empresa: indicadores de la simulación, certificaciones de los últimos 14 días, principales receptores, pendientes, saldo y reportes en CSV.
import { h, boton, insignia, cabecera, toast, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { quetzales } from "./dinero.js";
import { api } from "./api.js";
import { tablaSimple } from "./plan.js";
import { descargarArchivo } from "./descarga.js";
import { codigoBorrador } from "/app/js/formato.js";

export function pantallaPanel(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando el panel…"));
  const ind = (ik, v, et, tono = "azul", extra = {}) => h("div", { class: `indicador ind-${tono}`, ...extra }, h("span", { class: "ind-ik" }, icono(ik)), h("div", {}, h("strong", { class: "num" }, v), h("small", {}, et)));
  const bajar = (ruta, nombre) => async () => { try { await descargarArchivo(ruta, nombre); } catch (e) { toast(mensajeError(e), "error"); } };
  api.panel().then((p) => {
    const d = p.documentos, max = Math.max(1, ...p.serie.map((s) => s.certificados));
    poner(cuerpo,
      h("div", { class: "indicadores", "data-panel": "indicadores" }, ind("file", String(d.total), "Documentos"), ind("circleCheck", String(d.certificados), "Certificados (simulación)", "lila"), ind("lock", String(d.por_verificar), "Por verificar", d.por_verificar ? "ambar" : "azul"), ind("package", quetzales(d.base_certificada), "Base certificada (simulada)")),
      h("div", { class: "indicadores" }, ind("pencil", String(d.borradores), "Borradores"), ind("eye", String(d.revisados), "Revisados, listos para enviar"), ind("trash", String(d.anulados), "Anulados"), ind("info", String(d.rechazados), "Rechazados")),
      h("div", { class: "card", "data-panel": "serie" }, h("h2", { class: "card-t" }, "Certificaciones de los últimos 14 días"),
        h("div", { class: "barras", role: "img", "aria-label": `Certificaciones por día: ${p.serie.map((s) => `${s.dia.slice(5)}: ${s.certificados}`).join(", ")}` },
          ...p.serie.map((s) => h("div", { class: "barra-col", title: `${s.dia.split("-").reverse().join("/")}: ${s.certificados}` }, h("span", { class: "barra-n" }, s.certificados || ""), h("span", { class: "barra-v", style: `height:${Math.round((s.certificados / max) * 100)}%` }), h("small", {}, s.dia.slice(8)))))),
      h("div", { class: "grid2" },
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Principales receptores"), tablaSimple([["Receptor"], ["Docs.", "der"], ["Base", "der"]], p.clientes.map((c) => [c.nombre, String(c.documentos), quetzales(c.base)]), "Todavía no hay documentos certificados.")),
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Requieren atención"), p.pendientes.length ? h("ul", { class: "tl" }, ...p.pendientes.map((x) => h("li", {}, h("a", { href: `#/f/${x.id}` }, codigoBorrador(x.numero_borrador)), " · ", x.estado_fiscal === "por_verificar" ? "por verificar con el proveedor" : x.estado_fiscal === "pendiente_certificacion" ? "envío en curso" : "alerta fiscal abierta"))) : h("p", { class: "mut" }, "No hay nada pendiente."),
          p.plan?.monedero && p.plan.contrato?.modalidad === "prepago" ? h("p", {}, "Saldo disponible: ", insignia(quetzales(p.plan.monedero.disponible), Number(p.plan.monedero.disponible) <= 10 ? "ambar" : "verde")) : null)),
      h("div", { class: "card", "data-panel": "reportes" }, h("h2", { class: "card-t" }, "Reportes"), h("p", { class: "mut" }, "Archivos CSV de la simulación (se abren en Excel). Llevan la marca «SIMULADO - SIN VALOR FISCAL»."),
        h("div", { class: "acciones-fila" }, ctx.tiene("borradores.ver") ? boton("Documentos (CSV)", { tipo: "sec", icon: "file", id: "reporte-documentos", onclick: bajar("/api/reportes/documentos.csv", "SIMULADO-documentos.csv") }) : null,
          ctx.tiene("facturacion.ver") ? boton("Consumo y cargos (CSV)", { tipo: "sec", icon: "package", id: "reporte-consumos", onclick: bajar("/api/reportes/consumos.csv", "SIMULADO-consumos.csv") }) : null)));
  }).catch((e) => poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))));
  return h("section", { class: "pantalla" }, cabecera({ icon: "file", titulo: "Panel", subtitulo: "Indicadores y reportes de tu facturación (simulada)." }), cuerpo);
}
