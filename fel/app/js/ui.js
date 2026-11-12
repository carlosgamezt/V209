// Utilidades de interfaz. Todo el texto de usuario se inserta con textContent (nunca innerHTML) para evitar XSS.
import { icono } from "./icons.js";

export function h(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "style") e.style.cssText = v;   // por CSSOM: la política de seguridad (style-src sin 'unsafe-inline') bloquea el atributo escrito con setAttribute en WebKit
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const boton = (texto, { tipo = "pri", icon, onclick, ...r } = {}) =>
  h("button", { type: "button", class: `btn btn-${tipo}`, onclick, ...r }, icon ? icono(icon) : null, texto ? h("span", {}, texto) : null);

export function insignia(texto, tono = "gris") { return h("span", { class: `tag tag-${tono}` }, texto); }

// Importes EXACTOS (texto decimal): no se redondea; mínimo 2 decimales visibles; separador de miles.
export function quetzales(t) {
  if (t === null || t === undefined || t === "") return "—";
  const [e, d = ""] = String(t).split(".");
  return `Q ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d.padEnd(2, "0")}`;
}
export const fechaLarga = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

export function toast(texto, tipo = "ok") {
  const cont = document.getElementById("toasts");
  const t = h("div", { class: `toast toast-${tipo}`, role: tipo === "error" ? "alert" : "status" }, icono(tipo === "error" ? "info" : "circleCheck"), h("span", {}, texto));
  cont.append(t);
  setTimeout(() => t.remove(), tipo === "error" ? 6000 : 3200);
}

// Modal accesible: Escape y clic fuera cierran; devuelve { cerrar, cuerpo }.
export function modal({ titulo, ancho = "md", contenido, pie }) {
  const previo = document.activeElement;
  const fondo = h("div", { class: "modal-fondo" });
  const caja = h("div", { class: `modal modal-${ancho}`, role: "dialog", "aria-modal": "true", "aria-label": titulo },
    h("div", { class: "modal-cab" }, h("h2", {}, titulo), h("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar", onclick: () => cerrar() }, icono("x"))),
    h("div", { class: "modal-cuerpo" }, contenido), pie ? h("div", { class: "modal-pie" }, pie) : null);
  fondo.append(caja);
  const tecla = (ev) => { if (ev.key === "Escape") cerrar(); };
  function cerrar() { document.removeEventListener("keydown", tecla); fondo.remove(); previo?.focus?.(); }
  fondo.addEventListener("mousedown", (ev) => { if (ev.target === fondo) cerrar(); });
  document.addEventListener("keydown", tecla);
  document.body.append(fondo);
  caja.querySelector("input,select,textarea,button.btn")?.focus();
  return { cerrar, caja };
}

export function pedirMotivo({ titulo, texto, confirmar = "Confirmar", min = 5 }) {
  return new Promise((resolve) => {
    const campo = h("textarea", { rows: 3, maxlength: 300, "aria-label": "Motivo" });
    const err = h("p", { class: "err", role: "alert" });
    let m;
    const ok = boton(confirmar, { tipo: "pri", onclick: () => {
      if (campo.value.trim().length < min) { err.textContent = `Escribe un motivo de al menos ${min} caracteres.`; return; }
      m.cerrar(); resolve(campo.value.trim());
    } });
    m = modal({ titulo, ancho: "sm", contenido: [h("p", { class: "mut" }, texto), campo, err],
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => { m.cerrar(); resolve(null); } }), ok] });
  });
}

export function vacio(icon, titulo, texto, accion) {
  return h("div", { class: "vacio" }, h("span", { class: "vacio-ik" }, icono(icon)), h("h3", {}, titulo), h("p", {}, texto), accion ?? null);
}

export function campo(etiqueta, control, { ayuda, error } = {}) {
  return h("label", { class: "campo" }, h("span", { class: "campo-et" }, etiqueta), control,
    ayuda ? h("small", { class: "campo-ayuda" }, ayuda) : null, error ? h("small", { class: "campo-err", role: "alert" }, error) : null);
}

export function cabecera({ icon, titulo, subtitulo, accion }) {
  return h("header", { class: "ph" }, h("span", { class: "ph-ik" }, icono(icon)),
    h("div", { class: "ph-tx" }, h("h1", {}, titulo), subtitulo ? h("p", {}, subtitulo) : null), accion ? h("div", { class: "ph-ac" }, accion) : null);
}

export function mensajeError(e) {
  const base = e?.message || "No se pudo completar la operación.";
  return e?.reintentarEn ? `${base} Reintenta en ${e.reintentarEn} s.` : base;
}

// replaceChildren que ignora null/false (replaceChildren nativo escribiría "null" como texto).
export function poner(el, ...hijos) { el.replaceChildren(...hijos.flat().filter((x) => x !== null && x !== undefined && x !== false)); }

// Paso intermedio de seguridad: pide el código TOTP y lo verifica con `verificar(codigo)` (que lanza si es incorrecto). Devuelve true/false.
export function pedirCodigoTotp(verificar) {
  return new Promise((resolve) => {
    const codigo = h("input", { class: "codigo", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Código de 6 dígitos" });
    const err = h("p", { class: "err", role: "alert" });
    let m, ocupado = false, terminado = false;
    const fin = (v) => { if (terminado) return; terminado = true; m.cerrar(); resolve(v); };
    const ok = boton("Confirmar", { onclick: async () => {
      if (ocupado) return; ocupado = true; ok.disabled = true; err.textContent = "";
      try { await verificar(codigo.value.trim()); fin(true); } catch (e) { err.textContent = mensajeError(e); codigo.value = ""; ok.disabled = false; codigo.focus(); } finally { ocupado = false; }
    } });
    m = modal({ titulo: "Confirma tu código", ancho: "sm", contenido: h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); ok.click(); } },
      h("p", { class: "mut" }, "Por seguridad, esta operación necesita un código reciente de tu app autenticadora."), codigo, err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => fin(false) }), ok] });
    // si se cierra con Escape o clic fuera, cuenta como cancelado
    const obs = new MutationObserver(() => { if (!document.body.contains(m.caja)) { obs.disconnect(); fin(false); } });
    obs.observe(document.body, { childList: true });
    codigo.focus();
  });
}
