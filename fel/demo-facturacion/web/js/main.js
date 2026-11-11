// Arranque de la demostración: estructura, usuario de la demostración, rutas (#/, #/nueva, #/f/<id>) y aviso permanente de simulación.
import { h, poner, toast, mensajeError } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api, cambiarUsuario, usuarioActual } from "./api.js";
import { pantallaLista } from "./lista.js";
import { pantallaFactura } from "./factura.js";

const raiz = document.getElementById("app");

async function iniciar() {
  let estado = await api.estado();
  const contenido = h("main", { class: "principal", tabindex: "-1" });
  const selUsuario = h("select", { "aria-label": "Persona de la demostración", class: "sel-usuario", onchange: async (e) => {
    cambiarUsuario(e.target.value);
    try { estado = await api.estado(); pintarCab(); pintar(); toast(`Ahora actúas como ${estado.usuario.nombre} (${estado.usuario.rol})`); } catch (x) { toast(mensajeError(x), "error"); }
  } });
  const cab = h("header", { class: "cab-demo" });
  const ctx = {
    get estado() { return estado; },
    tiene: (p) => estado.permisos.includes(p),
    ir: (ruta, o = {}) => { if (o.reemplazar) history.replaceState(null, "", `#${ruta}`); else location.hash = ruta; if (o.reemplazar) pintar(); },
    recargarEstado: async () => { estado = await api.estado(); },
    repintar: () => pintar(),
  };
  function pintarCab() {
    poner(selUsuario, ...estado.usuarios.map((u) => h("option", { value: u.clave, selected: u.clave === estado.usuario.clave }, `${u.nombre} · ${u.rol}`)));
    selUsuario.value = usuarioActual();
    poner(cab,
      h("div", { class: "cab-fila" },
        h("a", { class: "marca", href: "#/", "aria-label": "Inicio" }, h("span", { class: "marca-logo" }, "N"), h("div", {}, h("strong", {}, "NEXA FEL"), h("small", {}, "Demostración · facturación individual"))),
        h("div", { class: "cab-der" }, h("label", { class: "cab-usuario" }, h("span", { class: "mut" }, "Actuar como"), selUsuario))),
      h("div", { class: "banda-simulado", role: "status" }, icono("lock"), h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("span", {}, "No se conecta a SAT ni a ningún certificador; nada de lo que ves se emite de verdad.")));
  }
  function pintar() {
    const ruta = location.hash.slice(1) || "/";
    let vista;
    if (ruta === "/nueva") vista = pantallaFactura(ctx, null);
    else if (ruta.startsWith("/f/")) vista = pantallaFactura(ctx, ruta.split("/")[2]);
    else vista = pantallaLista(ctx);
    poner(contenido, vista);
    document.title = `NEXA FEL · Demostración (SIMULADO)`;
  }
  pintarCab();
  poner(raiz, cab, contenido, h("footer", { class: "pie-demo" }, "Empresa y personas ficticias. Los datos viven solo en la memoria de este programa y se pierden al cerrarlo."));
  window.addEventListener("hashchange", () => { pintar(); contenido.focus({ preventScroll: true }); });
  pintar();
}
iniciar().catch((e) => { console.error(e); poner(raiz, h("p", { class: "err", role: "alert", style: "padding:24px" }, mensajeError(e))); });
