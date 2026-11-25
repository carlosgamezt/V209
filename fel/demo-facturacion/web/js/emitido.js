// Pantalla posterior a la certificación: una tarjeta compacta con el resultado (total, serie, número, UUID, ambiente) y las acciones de entrega.
// Nada se simula: cada acción llama al servidor o al dispositivo; si no está disponible se muestra deshabilitada y se dice por qué.
import { h, boton, quetzales, toast, mensajeError } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { descargarArchivo } from "./descarga.js";
import { codigoBorrador } from "/app/js/formato.js";

export const ambienteDe = (doc) => (String(doc.autorizacion_sat ?? "").toUpperCase().startsWith("SIM-") || !doc.autorizacion_sat ? "SIMULADO" : "TEST");

export function tarjetaEmitido({ ctx, doc, abrirPrevia, nueva, volver }) {
  if (doc.estado_fiscal !== "certificado") return null;
  const amb = ambienteDe(doc), esTest = amb === "TEST";
  const nombre = (f) => `${esTest ? "PRUEBA-TEST" : "NO-FISCAL-DEMO"}-${f.toUpperCase()}-${doc.serie ?? ""}-${doc.numero_fiscal ?? codigoBorrador(doc.numero_borrador)}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  const ruta = (f) => `/api/documentos/${doc.id}/pdf-demo?formato=${f}`;
  const aviso = h("p", { class: "mut emitido-aviso", role: "status", "aria-live": "polite" });
  const descargar = (f) => async () => { try { aviso.textContent = ""; await descargarArchivo(ruta(f), nombre(f)); } catch (e) { aviso.textContent = e.message; } };
  const puedeCompartir = typeof navigator.share === "function";
  const compartir = async () => {
    try {
      aviso.textContent = "";
      const r = await fetch(ruta("carta"), { headers: { "x-demo": "1" } }); if (!r.ok) throw new Error("No se pudo generar el PDF.");
      const archivo = new File([await r.blob()], nombre("carta"), { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) await navigator.share({ files: [archivo], title: nombre("carta") });
      else { aviso.textContent = "Este dispositivo no permite compartir archivos; usa «Descargar PDF»."; }
    } catch (e) { if (e?.name !== "AbortError") aviso.textContent = e.message || "No se pudo compartir."; }
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(String(doc.autorizacion_sat)); toast("UUID copiado"); } catch { aviso.textContent = "No se pudo copiar; selecciona el UUID manualmente."; } };
  // correo: el panel «Enviar por correo» del detalle (más abajo) decide permisos, destinatarios autorizados, duplicados y límites; este botón solo lleva hasta él
  const alPanelCorreo = () => { const p = document.querySelector('[data-panel="correo"]'); if (!p || p.hidden) { aviso.textContent = "El envío por correo no está disponible para este documento."; return; } p.scrollIntoView?.({ block: "center", behavior: "smooth" }); setTimeout(() => document.getElementById("correo-destinatario")?.focus({ preventScroll: true }), 350); };
  const bCorreo = boton("Enviar por correo", { tipo: "sec", icon: "mail", id: "emitido-correo-btn", disabled: true, title: "Comprobando…", onclick: alPanelCorreo });
  api.correoEstado().then((e) => { const ok = e.habilitado && e.puedeEnviar; bCorreo.disabled = !ok; bCorreo.title = ok ? "" : (!e.habilitado ? "El envío por correo no está habilitado en esta demostración" : "Tu rol no puede enviar correos"); }).catch(() => { bCorreo.title = "No se pudo comprobar el correo"; });
  const dato = (et, v, clase = "") => h("div", { class: `em-dato ${clase}` }, h("span", { class: "mut" }, et), h("strong", { class: "mono" }, v ?? "—"));
  return h("div", { class: "card card-emitido", "data-panel": "emitido" },
    h("div", { class: "em-cab" }, h("span", { class: "em-ok", "aria-hidden": "true" }, icono("circleCheck")), h("div", {}, h("h2", { class: "card-t" }, "Documento emitido"), h("span", { class: `tag ${esTest ? "tag-test" : "tag-sim"}`, "data-ambiente": amb, title: "Sin valor fiscal" }, esTest ? "TEST · sin valor fiscal" : "SIMULADO · sin valor fiscal"))),
    h("div", { class: "em-total" }, h("span", { class: "mut" }, "Total"), h("strong", { class: "num" }, quetzales(doc.total ?? doc.base_imponible))),
    h("div", { class: "em-datos" }, dato("Serie", doc.serie), dato("Número fiscal", doc.numero_fiscal)),
    h("div", { class: "em-uuid" }, h("span", { class: "mut" }, "UUID (autorización)"), h("div", { class: "em-uuid-fila" }, h("strong", { class: "mono", id: "emitido-uuid" }, doc.autorizacion_sat ?? "—"), h("button", { type: "button", class: "icon-btn", "aria-label": "Copiar UUID", title: "Copiar UUID", id: "emitido-copiar", onclick: copiar }, icono("copy")))),
    h("div", { class: "em-acciones" },
      bCorreo,
      boton("Descargar PDF", { tipo: "sec", icon: "download", id: "emitido-pdf", onclick: descargar("carta") }),
      boton("Imprimir", { tipo: "sec", icon: "printer", id: "emitido-imprimir", onclick: abrirPrevia }),
      boton("Ticket 80 mm", { tipo: "sec", icon: "receipt", id: "emitido-ticket", onclick: descargar("ticket") }),
      boton("Compartir", { tipo: "sec", icon: "share", id: "emitido-compartir", disabled: !puedeCompartir, title: puedeCompartir ? "" : "Este navegador no permite compartir", onclick: compartir }),
      ctx.tiene("borradores.crear") ? boton("Nueva factura", { icon: "plus", id: "emitido-nueva", onclick: nueva }) : null),
    aviso,
    h("div", { class: "em-pie" }, h("button", { type: "button", class: "enlace-doc", id: "emitido-volver", onclick: volver }, "Volver a documentos")));
}
