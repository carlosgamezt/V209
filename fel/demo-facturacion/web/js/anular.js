// Confirmación REFORZADA de una anulación (simulada): resumen del documento, aviso de que es definitiva, motivo obligatorio y la palabra ANULAR escrita a mano.
// El botón queda deshabilitado hasta cumplir las tres cosas, y el servidor vuelve a exigir el motivo y la palabra (no depende de esta pantalla).
import { h, boton, modal } from "/app/js/ui.js";

export const PALABRA_ANULAR = "ANULAR";
export const MOTIVO_MIN = 5, MOTIVO_MAX = 300;

/** Resuelve con { motivo } si la persona confirma, o con null si cancela o cierra el diálogo. */
export function confirmarAnulacion({ resumen, nombreCert }) {
  return new Promise((resolve) => {
    let hecho = false, m; const fin = (v) => { if (hecho) return; hecho = true; obs.disconnect(); resolve(v); };
    const filas = [["Documento", resumen.codigo], ["Receptor", resumen.receptor], ["Total", resumen.total], ["Autorización", resumen.autorizacion]].filter(([, v]) => v);
    const ficha = h("dl", { class: "anu-ficha" }, ...filas.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))]));
    const aviso = h("p", { class: "anu-aviso", role: "note" }, `La anulación es definitiva: el documento no vuelve a emitirse ni se puede editar. Es una simulación ante ${nombreCert}; el plazo normativo no se verifica aquí.`);
    const motivo = h("textarea", { rows: 3, maxlength: MOTIVO_MAX, "aria-label": "Motivo de la anulación", placeholder: "Por qué se anula (obligatorio)", oninput: () => validar(true) });
    const cuenta = h("small", { class: "mut anu-cuenta" }, `0 / ${MOTIVO_MAX}`);
    const palabra = h("input", { "aria-label": `Escribe ${PALABRA_ANULAR} para confirmar`, placeholder: PALABRA_ANULAR, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", enterkeyhint: "done", oninput: () => validar(true),
      onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); if (!ok.disabled) ok.click(); } } });
    const err = h("p", { class: "err", role: "alert" });
    const ok = boton("Anular documento", { tipo: "peligro", id: "anular-confirmar", disabled: true, onclick: () => { if (!validar(false)) return; m.cerrar(); fin({ motivo: motivo.value.trim() }); } });
    function validar(suave) {
      const mot = motivo.value.trim(), pal = palabra.value.trim();
      cuenta.textContent = `${motivo.value.length} / ${MOTIVO_MAX}`;
      const faltaMotivo = mot.length < MOTIVO_MIN, faltaPalabra = pal !== PALABRA_ANULAR;
      ok.disabled = faltaMotivo || faltaPalabra;
      err.textContent = suave ? "" : faltaMotivo ? `Escribe un motivo de al menos ${MOTIVO_MIN} caracteres.` : faltaPalabra ? `Escribe ${PALABRA_ANULAR} para confirmar.` : "";
      return !ok.disabled;
    }
    m = modal({ titulo: "Anular documento (simulado)", ancho: "sm",
      contenido: [ficha, aviso, h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Motivo de la anulación"), motivo, cuenta),
        h("label", { class: "campo" }, h("span", { class: "campo-et" }, `Para confirmar, escribe ${PALABRA_ANULAR}`), palabra), err],
      pie: [boton("Cancelar", { tipo: "sec", id: "anular-cancelar", onclick: () => { m.cerrar(); fin(null); } }), ok] });
    m.caja.classList.add("anu-dialogo");
    const obs = new MutationObserver(() => { if (!m.caja.isConnected) fin(null); });   // cerrar con la X, Escape o tocando fuera también cancela
    obs.observe(document.body, { childList: true }); motivo.focus();
  });
}
