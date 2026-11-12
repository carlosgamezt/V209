// «Mi cuenta»: cambio de la propia contraseña. Al cambiarla se cierran todas las sesiones de la persona y se vuelve a iniciar.
import { h, boton, cabecera, campo, mensajeError, poner, toast } from "/app/js/ui.js";
import { api } from "./api.js";

export function pantallaCuenta(ctx) {
  const f = { actual: "", nueva: "", repetir: "" }, err = h("p", { class: "err", role: "alert" });
  const inp = (et, k, auto) => campo(et, h("input", { type: "password", "aria-label": et, maxlength: 80, autocomplete: auto, oninput: (e) => { f[k] = e.target.value; } }));
  const b = boton("Cambiar contraseña", { id: "cambiar-clave", onclick: async () => {
    err.textContent = ""; if (f.nueva.length < 8) { err.textContent = "La contraseña nueva debe tener 8 caracteres o más."; return; } if (f.nueva !== f.repetir) { err.textContent = "Las contraseñas nuevas no coinciden."; return; }
    b.disabled = true; try { await api.cambiarClave(f.actual, f.nueva); toast("Contraseña cambiada. Inicia sesión de nuevo."); document.dispatchEvent(new Event("fel-sesion-vencida")); } catch (e) { err.textContent = mensajeError(e); b.disabled = false; } } });
  return h("section", { class: "pantalla" }, cabecera({ icon: "lock", titulo: "Mi cuenta", subtitulo: `${ctx.estado.usuario.nombre} · ${ctx.estado.usuario.rol}` }),
    h("div", { class: "card", "data-panel": "cuenta" }, h("h2", { class: "card-t" }, "Contraseña"), h("div", { class: "form" }, inp("Contraseña actual", "actual", "current-password"), inp("Contraseña nueva (8 o más)", "nueva", "new-password"), inp("Repite la contraseña nueva", "repetir", "new-password"), err, b),
      h("p", { class: "mut" }, "Al cambiarla se cierran todas tus sesiones (también en otros dispositivos).")));
}
