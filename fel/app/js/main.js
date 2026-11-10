// NEXA FEL · Fase 1.1 · interfaz de Clientes, Conceptos y Borradores. JavaScript modular sin dependencias ni paso de compilación.
import { crearApi } from "./api.js";
import { h, boton, toast, campo, mensajeError, poner } from "./ui.js";
import { icono } from "./icons.js";
import { pantallaClientes } from "./pantallas/clientes.js";
import { pantallaConceptos } from "./pantallas/conceptos.js";
import { pantallaBorradores, pantallaEditor } from "./pantallas/borradores.js";

const NAV = [
  { ruta: "/clientes", titulo: "Clientes", icon: "users", permiso: "clientes.ver" },
  { ruta: "/conceptos", titulo: "Conceptos", icon: "package", permiso: "conceptos.ver" },
  { ruta: "/borradores", titulo: "Borradores", icon: "file", permiso: "borradores.ver" },
];
const raiz = document.getElementById("app");

async function iniciar() {
  const api = await crearApi(window.FEL_CONFIG ?? { modo: "demo" });
  if (api.modo === "remoto" && !api.haySesion()) return pantallaLogin(api);
  let sesion;
  try { sesion = await api.sesion(); }
  catch (e) { return e.codigo === "sin_sesion" ? pantallaLogin(api) : pantallaSinAcceso(api, e); }
  if (!sesion.empresas?.length) return pantallaSinAcceso(api, null);
  arrancar(api, sesion);
}

function pantallaLogin(api) {
  const mail = h("input", { type: "email", autocomplete: "username", required: true });
  const pass = h("input", { type: "password", autocomplete: "current-password", required: true });
  const err = h("p", { class: "err", role: "alert" });
  const entrar = boton("Entrar", { onclick: async () => {
    err.textContent = ""; entrar.disabled = true;
    try { await api.iniciarSesion(mail.value.trim(), pass.value); pass.value = ""; iniciar(); } catch (e) { err.textContent = mensajeError(e); entrar.disabled = false; }
  } });
  poner(raiz, h("main", { class: "login" }, h("form", { class: "login-card", onsubmit: (e) => { e.preventDefault(); entrar.click(); } },
    marca(), h("h1", {}, "Inicia sesión"), h("p", { class: "mut" }, "Acceso solo por invitación."), campo("Correo", mail), campo("Contraseña", pass), err, entrar)));
}

function pantallaSinAcceso(api, e) {
  poner(raiz, h("main", { class: "login" }, h("div", { class: "login-card" }, marca(), h("h1", {}, "Sin acceso"),
    h("p", { class: "mut" }, e ? mensajeError(e) : "Tu cuenta todavía no pertenece a ninguna empresa habilitada. Pide una invitación a tu administrador."),
    api.modo === "remoto" ? boton("Salir", { tipo: "sec", icon: "logout", onclick: () => { api.cerrarSesion(); iniciar(); } }) : null)));
}

const marca = () => h("div", { class: "marca" }, h("span", { class: "marca-logo", "aria-hidden": "true" }, "N"), h("div", {}, h("strong", {}, "NEXA FEL"), h("small", {}, "Facturación electrónica")));

function arrancar(api, sesion) {
  let actual = sesion.empresas[0];
  const contenido = h("div", { class: "contenido", id: "contenido", tabindex: "-1" });
  const nav = h("nav", { class: "nav", "aria-label": "Secciones" });
  const lateral = h("aside", { class: "lateral" }, marca(), nav);
  const demoBar = api.modo === "demo" ? h("div", { class: "demo" }, icono("info"), h("span", {}, "Modo demostración · datos de ejemplo, nada se guarda"),
    h("label", {}, "Rol: ", h("select", { "aria-label": "Rol de demostración", onchange: async (e) => { api.cambiarRol(e.target.value); const s = await api.sesion(); actual = s.empresas[0]; pintar(); } },
      api.roles.map((r) => h("option", { value: r, selected: r === actual.rol }, r))))) : null;
  const info = h("div", { class: "usuario" });

  const ctx = () => ({ api, empresa: actual.empresa, rol: actual.rol, tiene: (p) => actual.permisos.includes(p),
    ir: (ruta, o = {}) => { if (o.reemplazar) history.replaceState(null, "", `#${ruta}`); else location.hash = ruta; pintar(); } });

  function pintar() {
    const ruta = location.hash.slice(1) || "/clientes";
    const c = ctx();
    poner(nav, ...NAV.filter((n) => c.tiene(n.permiso)).map((n) => h("a", { href: `#${n.ruta}`, class: `nv${ruta.startsWith(n.ruta) ? " act" : ""}`, "aria-current": ruta.startsWith(n.ruta) ? "page" : null }, icono(n.icon), h("span", {}, n.titulo))));
    poner(info, h("span", { class: "usuario-ik" }, icono("building")), h("div", {}, h("strong", {}, actual.empresa.nombre_comercial), h("small", {}, `${actual.rol} · ${sesion.usuario.email}`)),
      api.modo === "remoto" ? h("button", { type: "button", class: "icon-btn", title: "Salir", "aria-label": "Cerrar sesión", onclick: () => { api.cerrarSesion(); iniciar(); } }, icono("logout")) : null);
    let vista;
    if (ruta.startsWith("/clientes") && c.tiene("clientes.ver")) vista = pantallaClientes(c);
    else if (ruta.startsWith("/conceptos") && c.tiene("conceptos.ver")) vista = pantallaConceptos(c);
    else if (ruta === "/borradores/nuevo" && c.tiene("borradores.crear")) vista = pantallaEditor(c, null);
    else if (ruta.startsWith("/borradores/") && c.tiene("borradores.ver")) vista = pantallaEditor(c, ruta.split("/")[2]);
    else if (ruta.startsWith("/borradores") && c.tiene("borradores.ver")) vista = pantallaBorradores(c);
    else { const primero = NAV.find((n) => c.tiene(n.permiso)); if (primero && ruta !== primero.ruta) { history.replaceState(null, "", `#${primero.ruta}`); return pintar(); } vista = h("p", { class: "mut" }, "Tu rol no tiene secciones disponibles."); }
    poner(contenido, vista); document.title = `NEXA FEL · ${NAV.find((n) => ruta.startsWith(n.ruta))?.titulo ?? ""}`;
  }
  lateral.append(info);
  poner(raiz, demoBar, h("div", { class: "shell" }, lateral, h("main", { class: "principal" }, contenido)),
    h("nav", { class: "nav-movil", "aria-label": "Secciones" }));
  const movil = raiz.querySelector(".nav-movil");
  const pintarMovil = () => poner(movil, ...[...nav.children].map((a) => a.cloneNode(true)));
  window.addEventListener("hashchange", () => { pintar(); pintarMovil(); contenido.focus({ preventScroll: true }); });
  pintar(); pintarMovil();
}

iniciar().catch((e) => { console.error(e); toast("No se pudo iniciar la aplicación", "error"); });
