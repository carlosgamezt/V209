import { h, boton, toast, campo, cabecera, insignia, mensajeError, poner } from "../ui.js";
import { icono } from "../icons.js";

// Seguridad de la cuenta: activar la verificación en dos pasos (TOTP). Solo existe en modo remoto.
export function pantallaSeguridad(ctx) {
  const { api, sesion } = ctx;
  const cont = h("div", { class: "card" }, h("p", { class: "mut" }, "Cargando…"));

  async function cargar() {
    try {
      const e = await api.estadoMfa();
      const activo = e.factores.some((f) => f.verificado);
      poner(cont,
        h("div", { class: "seg-fila" }, h("div", {}, h("strong", {}, "Verificación en dos pasos (TOTP)"), h("p", { class: "mut" }, activo ? "Cada inicio de sesión pide un código de tu app autenticadora." : "Añade una capa extra: además de la contraseña, un código de 6 dígitos de tu app autenticadora.")),
          insignia(activo ? "Activa" : "Inactiva", activo ? "verde" : "ambar")),
        h("div", { class: "seg-fila" }, h("div", {}, h("strong", {}, "Nivel de la sesión actual"), h("p", { class: "mut" }, e.aal === "aal2" ? "Verificada con código (aal2)." : "Solo contraseña (aal1).")),
          insignia(e.aal === "aal2" ? "aal2" : "aal1", e.aal === "aal2" ? "verde" : "gris")),
        sesion.plataforma && e.aal !== "aal2" ? h("p", { class: "aviso aviso-ambar" }, icono("lock"), h("span", {}, "Eres administrador maestro: sin verificación en dos pasos no puedes ejecutar acciones administrativas ni ver datos de plataforma.")) : null,
        !activo ? boton("Activar verificación en dos pasos", { icon: "lock", onclick: iniciarActivacion }) : null);
    } catch (e) { poner(cont, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }

  async function iniciarActivacion() {
    try {
      const t = await api.iniciarEnrolamientoTotp();
      const codigo = h("input", { class: "codigo", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Código de 6 dígitos" });
      const err = h("p", { class: "err", role: "alert" });
      const ok = boton("Confirmar y activar", { onclick: async () => {
        err.textContent = ""; ok.disabled = true;
        try { await api.confirmarEnrolamientoTotp(t.factorId, codigo.value.trim()); toast("Verificación en dos pasos activada"); ctx.sesion.mfa = "aal2"; await cargar(); ctx.alCambiarSeguridad?.(); }
        catch (e) { err.textContent = mensajeError(e); ok.disabled = false; codigo.select(); }
      } });
      poner(cont,
        h("h2", { class: "card-t" }, "Activar verificación en dos pasos"),
        h("ol", { class: "pasos" },
          h("li", {}, "Abre tu app autenticadora (Google Authenticator, Microsoft Authenticator, Authy…) y añade una cuenta nueva."),
          h("li", {}, "Escanea este código QR o escribe la clave manualmente."),
          h("li", {}, "Escribe el código de 6 dígitos que muestra la app y confirma.")),
        h("div", { class: "qr-caja" }, t.qr ? h("img", { class: "qr", src: t.qr, alt: "Código QR para la app autenticadora", width: 180, height: 180 }) : h("p", { class: "mut" }, "No se pudo mostrar el código QR; usa la clave manual."),
          h("div", {}, h("small", { class: "mut" }, "Clave manual"), h("code", { class: "clave-manual" }, t.secreto), h("small", { class: "mut" }, "No la compartas ni la guardes en lugares inseguros."))),
        campo("Código de 6 dígitos", codigo), err,
        h("div", { class: "acciones-fila" }, boton("Cancelar", { tipo: "sec", onclick: cargar }), ok));
      codigo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } });
      codigo.focus();
    } catch (e) { toast(mensajeError(e), "error"); }
  }

  cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "lock", titulo: "Seguridad", subtitulo: "Protege tu cuenta con verificación en dos pasos." }), cont);
}
