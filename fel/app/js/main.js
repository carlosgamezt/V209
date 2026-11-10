// NEXA FEL · Fase 1.1 · interfaz de Clientes, Conceptos y Borradores. JavaScript modular sin dependencias ni paso de compilación.
import { crearApi } from "./api.js";
import { h, boton, toast, campo, mensajeError, poner } from "./ui.js";
import { icono } from "./icons.js";
import { pantallaClientes } from "./pantallas/clientes.js";
import { pantallaConceptos } from "./pantallas/conceptos.js";
import { pantallaBorradores, pantallaEditor } from "./pantallas/borradores.js";
import { pantallaSeguridad } from "./pantallas/seguridad.js";

const NAV = [
  { ruta: "/clientes", titulo: "Clientes", icon: "users", permiso: "clientes.ver" },
  { ruta: "/conceptos", titulo: "Conceptos", icon: "package", permiso: "conceptos.ver" },
  { ruta: "/borradores", titulo: "Borradores", icon: "file", permiso: "borradores.ver" },
  { ruta: "/seguridad", titulo: "Seguridad", icon: "lock", soloRemoto: true },
];
const raiz = document.getElementById("app");

let apiUnica = null;
async function iniciar(mensaje) {
  apiUnica ??= await crearApi(window.FEL_CONFIG ?? { modo: "demo" });
  const api = apiUnica;
  if (api.modo === "remoto") {
    api.alPerderSesion = () => iniciar("Tu sesión venció. Inicia sesión de nuevo.");
    if (!api.haySesion()) {
      if (api.fase() === "mfa_pendiente") return pantallaMfa(api);
      if (!(await api.recuperarSesion())) return pantallaLogin(api, mensaje);
    }
  }
  let sesion;
  try { sesion = await api.sesion(); }
  catch (e) { return e.codigo === "sin_sesion" ? pantallaLogin(api, "Tu sesión venció. Inicia sesión de nuevo.") : pantallaSinAcceso(api, e); }
  if (!sesion.empresas?.length) return pantallaSinAcceso(api, null);
  arrancar(api, sesion);
}

async function salir(api) {
  await api.cerrarSesion();
  history.replaceState(null, "", location.pathname + location.search); // no se arrastra la ruta del usuario anterior
  iniciar();
}

function pantallaLogin(api, mensaje) {
  const mail = h("input", { type: "email", autocomplete: "username", required: true, "aria-label": "Correo" });
  const pass = h("input", { type: "password", autocomplete: "current-password", required: true, "aria-label": "Contraseña" });
  const err = h("p", { class: "err", role: "alert" });
  const entrar = boton("Entrar", { onclick: async () => {
    err.textContent = ""; if (!mail.value.trim() || !pass.value) { err.textContent = "Escribe tu correo y tu contraseña."; return; }
    entrar.disabled = true;
    try {
      const r = await api.iniciarSesion(mail.value.trim(), pass.value); pass.value = "";
      r.mfa ? pantallaMfa(api) : iniciar();
    } catch (e) { pass.value = ""; err.textContent = mensajeError(e); entrar.disabled = false; pass.focus(); }
  } });
  poner(raiz, h("main", { class: "login" }, h("form", { class: "login-card", onsubmit: (e) => { e.preventDefault(); entrar.click(); } },
    marca(), h("h1", {}, "Inicia sesión"), h("p", { class: "mut" }, "Acceso solo por invitación."),
    mensaje ? h("p", { class: "aviso aviso-ambar", role: "status" }, icono("info"), h("span", {}, mensaje)) : null,
    campo("Correo", mail), campo("Contraseña", pass), err, entrar)));
  mail.focus();
}

function pantallaMfa(api) {
  let fallos = 0;
  const codigo = h("input", { class: "codigo", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Código de 6 dígitos" });
  const err = h("p", { class: "err", role: "alert" });
  const ok = boton("Verificar", { onclick: async () => {
    err.textContent = ""; ok.disabled = true;
    try { await api.verificarMfa(codigo.value.trim()); iniciar(); }
    catch (e) {
      fallos++; codigo.value = ""; ok.disabled = false;
      if (fallos >= 5 || e.codigo === "sin_sesion") { await api.cerrarSesion(); return pantallaLogin(api, "Demasiados intentos fallidos. Inicia sesión de nuevo."); }
      err.textContent = mensajeError(e); codigo.focus();
    }
  } });
  poner(raiz, h("main", { class: "login" }, h("form", { class: "login-card", onsubmit: (e) => { e.preventDefault(); ok.click(); } },
    marca(), h("h1", {}, "Verificación en dos pasos"), h("p", { class: "mut" }, "Escribe el código de 6 dígitos de tu app autenticadora."),
    campo("Código", codigo), err, ok,
    h("button", { type: "button", class: "link", onclick: () => salir(api) }, "Usar otra cuenta"))));
  codigo.focus();
}

function pantallaSinAcceso(api, e) {
  poner(raiz, h("main", { class: "login" }, h("div", { class: "login-card" }, marca(), h("h1", {}, "Sin acceso"),
    h("p", { class: "mut" }, e ? mensajeError(e) : "Tu cuenta todavía no pertenece a ninguna empresa habilitada. Pide una invitación a tu administrador."),
    api.modo === "remoto" ? boton("Salir", { tipo: "sec", icon: "logout", onclick: () => salir(api) }) : null)));
}

const marca = () => h("div", { class: "marca" }, h("span", { class: "marca-logo", "aria-hidden": "true" }, "N"), h("div", {}, h("strong", {}, "NEXA FEL"), h("small", {}, "Facturación electrónica")));

let manejadorHash = null;
function arrancar(api, sesion) {
  if (manejadorHash) window.removeEventListener("hashchange", manejadorHash);
  let actual = sesion.empresas[0];
  const contenido = h("div", { class: "contenido", id: "contenido", tabindex: "-1" });
  const nav = h("nav", { class: "nav", "aria-label": "Secciones" });
  const lateral = h("aside", { class: "lateral" }, marca(), nav);
  const demoBar = api.modo === "demo" ? h("div", { class: "demo" }, icono("info"), h("span", {}, "Modo demostración · datos de ejemplo, nada se guarda"),
    h("label", {}, "Rol: ", h("select", { "aria-label": "Rol de demostración", onchange: async (e) => { api.cambiarRol(e.target.value); const s = await api.sesion(); actual = s.empresas[0]; pintar(); } },
      api.roles.map((r) => h("option", { value: r, selected: r === actual.rol }, r))))) : null;
  const info = h("div", { class: "usuario" });

  const ctx = () => ({ api, sesion, alCambiarSeguridad: () => pintar(), empresa: actual.empresa, rol: actual.rol, tiene: (p) => actual.permisos.includes(p),
    ir: (ruta, o = {}) => { if (o.reemplazar) history.replaceState(null, "", `#${ruta}`); else location.hash = ruta; pintar(); } });

  function pintar() {
    const ruta = location.hash.slice(1) || "/clientes";
    const c = ctx();
    const visible = (n) => (!n.permiso || c.tiene(n.permiso)) && (!n.soloRemoto || api.modo === "remoto");
    poner(nav, ...NAV.filter(visible).map((n) => h("a", { href: `#${n.ruta}`, class: `nv${ruta.startsWith(n.ruta) ? " act" : ""}`, "aria-current": ruta.startsWith(n.ruta) ? "page" : null }, icono(n.icon), h("span", {}, n.titulo))));
    poner(info, h("span", { class: "usuario-ik" }, icono("building")), h("div", {}, h("strong", {}, actual.empresa.nombre_comercial), h("small", {}, `${actual.rol} · ${sesion.usuario.email}`)),
      api.modo === "remoto" ? h("button", { type: "button", class: "icon-btn", title: "Salir", "aria-label": "Cerrar sesión", onclick: () => salir(api) }, icono("logout")) : null);
    let vista;
    if (ruta.startsWith("/clientes") && c.tiene("clientes.ver")) vista = pantallaClientes(c);
    else if (ruta.startsWith("/conceptos") && c.tiene("conceptos.ver")) vista = pantallaConceptos(c);
    else if (ruta === "/borradores/nuevo" && c.tiene("borradores.crear")) vista = pantallaEditor(c, null);
    else if (ruta === "/borradores/nuevo") { history.replaceState(null, "", "#/borradores"); return pintar(); } // sin permiso para crear
    else if (ruta.startsWith("/borradores/") && c.tiene("borradores.ver")) vista = pantallaEditor(c, ruta.split("/")[2]);
    else if (ruta.startsWith("/borradores") && c.tiene("borradores.ver")) vista = pantallaBorradores(c);
    else if (ruta.startsWith("/seguridad") && api.modo === "remoto") vista = pantallaSeguridad(c);
    else { const primero = NAV.find(visible); if (primero && ruta !== primero.ruta) { history.replaceState(null, "", `#${primero.ruta}`); return pintar(); } vista = h("p", { class: "mut" }, "Tu rol no tiene secciones disponibles."); }
    const sinAal2 = api.modo === "remoto" && sesion.mfa !== "aal2";
    poner(contenido, sinAal2 && !ruta.startsWith("/seguridad") ? h("p", { class: "aviso aviso-ambar", role: "status" }, icono("lock"), h("span", {}, sesion.plataforma ? "Administrador maestro: activa la verificación en dos pasos para ejecutar acciones administrativas. " : "Protege tu cuenta con verificación en dos pasos. "), h("a", { href: "#/seguridad" }, "Ir a Seguridad")) : null, vista); document.title = `NEXA FEL · ${NAV.find((n) => ruta.startsWith(n.ruta))?.titulo ?? ""}`;
  }
  lateral.append(info);
  poner(raiz, demoBar, h("div", { class: "shell" }, lateral, h("main", { class: "principal" }, contenido)),
    h("nav", { class: "nav-movil", "aria-label": "Secciones" }));
  const movil = raiz.querySelector(".nav-movil");
  const pintarMovil = () => poner(movil, ...[...nav.children].map((a) => a.cloneNode(true)));
  manejadorHash = () => { pintar(); pintarMovil(); contenido.focus({ preventScroll: true }); };
  window.addEventListener("hashchange", manejadorHash);
  pintar(); pintarMovil();
}

iniciar().catch((e) => { console.error(e); toast("No se pudo iniciar la aplicación", "error"); });
