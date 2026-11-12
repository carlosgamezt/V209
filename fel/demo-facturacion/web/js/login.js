// Pantalla de inicio de sesión de la demostración: usuarios ficticios, contraseña, «Recordar este dispositivo» y mensajes claros.
// En producción el acceso es con Supabase Auth (y MFA para el administrador maestro); aquí es solo para probar el recorrido completo.
import { h, boton, campo, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";

export function pantallaLogin(raiz, sesion, alEntrar) {
  const err = h("p", { class: "err", role: "alert", "aria-live": "assertive" });
  const usuario = h("select", { id: "login-usuario", "aria-label": "Usuario", autocomplete: "username" }, ...sesion.usuarios.map((u) => h("option", { value: u.clave }, `${u.nombre} · ${u.rol === "maestro" ? "administrador de la plataforma" : u.rol}`)));
  usuario.value = "ana";
  const clave = h("input", { id: "login-clave", type: "password", "aria-label": "Contraseña", autocomplete: "current-password", placeholder: "Contraseña", maxlength: 80 });
  const recordar = h("input", { type: "checkbox", id: "login-recordar", "aria-label": "Recordar este dispositivo" });
  const ayuda = h("small", { class: "campo-ayuda", id: "login-ayuda" }, "");
  const describir = () => { ayuda.textContent = sesion.usuarios.find((u) => u.clave === usuario.value)?.descripcion ?? ""; };
  usuario.addEventListener("change", describir); describir();
  let ocupado = false;
  const entrar = async (ev) => {
    ev?.preventDefault(); if (ocupado) return; err.textContent = ""; if (!clave.value) { err.textContent = "Escribe la contraseña."; clave.focus(); return; }
    ocupado = true; b.disabled = true;
    try { await api.entrar(usuario.value, clave.value, recordar.checked); await alEntrar(); }
    catch (e) { err.textContent = mensajeError(e); clave.select(); } finally { ocupado = false; b.disabled = false; }
  };
  const b = boton("Entrar", { id: "login-entrar", icon: "lock", onclick: entrar });
  poner(raiz, h("main", { class: "login-pagina" }, h("form", { class: "login-tarjeta", onsubmit: entrar, "aria-labelledby": "login-titulo" },
    h("div", { class: "login-marca" }, h("span", { class: "marca-logo" }, "N"), h("div", {}, h("h1", { id: "login-titulo" }, "Nexa FEL"), h("p", { class: "mut" }, "Facturación electrónica"))),
    h("div", { class: "banda-simulado login-banda", role: "status" }, icono("lock"), h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("span", {}, "Demostración: no se conecta a SAT ni a ningún certificador.")),
    campo("Usuario", usuario, {}), ayuda, campo("Contraseña", clave, {}),
    h("label", { class: "login-recordar" }, recordar, h("span", {}, "Recordar este dispositivo"), h("small", { class: "mut" }, "Mantiene la sesión hasta 7 días sin actividad (14 como máximo). No lo uses en equipos compartidos.")),
    err, b,
    h("p", { class: "aviso aviso-azul login-demo" }, icono("info"), h("span", {}, "Demostración con personas ficticias. Contraseña de todos los usuarios: ", h("strong", { class: "mono" }, sesion.clave_demo))))));
  clave.focus();
}
