// Envío de la factura certificada por correo desde el detalle del documento. El servidor decide TODO (permisos, estado, destinatarios autorizados, duplicados, límites):
// esta pantalla solo pide el envío, muestra el resultado real y el historial. Digifact no interviene: solo certificó. En TEST el correo lleva el rótulo «DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL».
import { h, boton, campo, insignia, modal } from "/app/js/ui.js";
import { api } from "./api.js";
import { fechaHora } from "./plan.js";

// Lo que sabemos de verdad: «aceptado» = el proveedor de correo recibió la solicitud (NO prueba que llegó). «Entregado» solo si un webhook lo confirmara (no implementado).
const ESTADO = { solicitado: ["Solicitado", "gris"], aceptado: ["Aceptado por el proveedor", "verde"], entregado: ["Entregado", "verde"], rechazado: ["Rechazado por el proveedor", "rojo"], fallido: ["Falló el envío (resultado incierto)", "ambar"] };
const ORIGEN = { manual: "Manual", reenvio: "Reenvío", automatico: "Automático" };
const RE_CORREO = /^[^\s@<>,;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const clave = (p) => `${p}-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

/** Tarjeta «Enviar por correo». Devuelve null si no aplica (no es la versión práctica o el documento no es una factura certificada/anulada). */
export function panelCorreo({ ctx, doc, mostrarError, avisar }) {
  if (!ctx.estado.practico || !["certificado", "anulado", "anulacion_solicitada"].includes(doc.estado_fiscal)) return null;
  const certificado = doc.estado_fiscal === "certificado";
  const cuerpo = h("div", { class: "correo-cuerpo" }), raiz = h("div", { class: "card card-correo", "data-panel": "correo", hidden: true }, h("h2", { class: "card-t" }, "Enviar por correo"), cuerpo);
  let estado = null, envios = [], ocupado = false;

  async function cargar() {
    try { estado = await api.correoEstado(); } catch { estado = { habilitado: false }; }
    if (!estado.habilitado || (!estado.puedeVer && !estado.puedeEnviar)) { raiz.hidden = true; return; }
    try { envios = estado.puedeVer ? (await api.correos(doc.id)).envios : []; } catch (e) { envios = []; mostrarError(e); }
    raiz.hidden = false; pintar();
  }
  const yaEnviado = () => envios.some((e) => e.estado === "aceptado" || e.estado === "entregado");

  function pintar() {
    const entrada = h("input", { type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", spellcheck: "false", maxlength: 254, id: "correo-destinatario", "aria-label": "Correo del destinatario", placeholder: "correo@ejemplo.com", value: doc.cliente_email ?? "" });
    const aviso = h("p", { class: "correo-aviso", role: "status", "aria-live": "polite" });
    const valido = () => RE_CORREO.test(entrada.value.trim());
    const refrescar = () => { if (btn) btn.disabled = ocupado || !valido(); };
    entrada.addEventListener("input", () => { aviso.textContent = ""; refrescar(); });
    const accion = async (extra = {}) => {
      if (ocupado) return; ocupado = true; refrescar(); mostrarError(""); aviso.textContent = "Enviando…";
      try {
        const r = await api.enviarCorreo(doc.id, { destinatario: entrada.value.trim(), clave: clave("envio"), ...extra });
        const [t] = ESTADO[r.envio.estado] ?? [r.envio.estado];
        if (r.repetido) avisar("Esa solicitud ya se había enviado: no se repitió.", "ok"); else if (r.envio.estado === "aceptado") avisar("Correo aceptado por el proveedor (no garantiza la entrega).", "ok"); else avisar(`${t}. Revisa el historial.`, "error");
      } catch (e) { mostrarError(e); aviso.textContent = ""; }
      finally { ocupado = false; try { envios = (await api.correos(doc.id)).envios; } catch { /* se conserva el historial anterior */ } pintar(); }
    };
    const reenviar = () => {
      const palabra = h("input", { "aria-label": "Escribe REENVIAR para confirmar", placeholder: "REENVIAR", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", id: "correo-palabra" });
      let m; const ok = boton("Reenviar factura", { tipo: "pri", id: "correo-reenviar-ok", disabled: true, onclick: () => { m.cerrar(); accion({ reenvio: true, confirmacion: "REENVIAR" }); } });
      palabra.addEventListener("input", () => { ok.disabled = palabra.value.trim() !== "REENVIAR"; });
      m = modal({ titulo: "Reenviar factura por correo", ancho: "sm", contenido: [h("p", { class: "mut" }, `Ya se envió esta factura. Se enviará de nuevo a ${entrada.value.trim()}, con los mismos archivos adjuntos.`), campo("Para confirmar, escribe REENVIAR", palabra)],
        pie: [boton("Cancelar", { tipo: "sec", id: "correo-reenviar-cancelar", onclick: () => m.cerrar() }), ok] });
    };
    const reenvio = yaEnviado();
    let btn = null;
    if (certificado && !reenvio && estado.puedeEnviar) btn = boton(ocupado ? "Enviando…" : "Enviar por correo", { tipo: "pri", id: "correo-enviar", onclick: () => accion() });
    else if (certificado && reenvio && estado.puedeReenviar) btn = boton("Reenviar", { tipo: "sec", id: "correo-reenviar", onclick: reenviar });
    if (btn) btn.disabled = ocupado || !valido();
    const filas = envios.map((e) => { const [t, tono] = ESTADO[e.estado] ?? [e.estado, "gris"];
      return h("li", { class: "correo-fila", "data-estado": e.estado }, h("span", { class: "correo-dest" }, e.destinatario), insignia(t, tono), h("small", { class: "mut" }, `${ORIGEN[e.origen] ?? e.origen} · ${fechaHora(e.creado_en)}`)); });
    cuerpo.replaceChildren(
      h("p", { class: "mut correo-nota" }, "Ambiente de pruebas: el correo sale con el rótulo «DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL» y solo a destinatarios autorizados. Lleva el PDF y el XML certificados, sin modificar."),
      certificado ? (btn ? h("div", { class: "form" }, campo("Correo del destinatario", entrada), h("div", { class: "acciones-fila" }, btn), aviso) : h("p", { class: "mut" }, "Tu rol no puede enviar facturas por correo.")) : h("p", { class: "aviso" }, "La factura está anulada o con anulación solicitada: no se envía por correo."),
      filas.length ? h("div", { class: "correo-hist" }, h("h3", { class: "correo-sub" }, "Historial de envíos"), h("ul", { class: "correo-lista", "aria-label": "Historial de envíos por correo" }, ...filas)) : h("p", { class: "mut" }, "Todavía no se ha enviado por correo."));
  }
  cargar();
  return raiz;
}
