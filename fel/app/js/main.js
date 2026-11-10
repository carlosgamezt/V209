// NEXA FEL · interfaz: Clientes, Conceptos, Borradores, Usuarios y Seguridad. JavaScript modular sin dependencias ni paso de compilación.
import { crearApi } from "./api.js";
import { h, boton, toast, campo, mensajeError, poner, pedirCodigoTotp } from "./ui.js";
import { icono } from "./icons.js";
import { pantallaClientes } from "./pantallas/clientes.js";
import { pantallaConceptos } from "./pantallas/conceptos.js";
import { pantallaBorradores, pantallaEditor } from "./pantallas/borradores.js";
import { pantallaSeguridad } from "./pantallas/seguridad.js";
import { pantallaUsuarios } from "./pantallas/usuarios.js";

const NAV = [
  { ruta: "/clientes", titulo: "Clientes", icon: "users", permiso: "clientes.ver" },
  { ruta: "/conceptos", titulo: "Conceptos", icon: "package", permiso: "conceptos.ver" },
  { ruta: "/borradores", titulo: "Borradores", icon: "file", permiso: "borradores.ver" },
  { ruta: "/usuarios", titulo: "Usuarios", icon: "shield", permiso: "usuarios.ver", soloRemoto: false },
  { ruta: "/seguridad", titulo: "Seguridad", icon: "lock", soloRemoto: true },
];
const raiz = document.getElementById("app");

// Los enlaces de Supabase Auth (recuperar contraseña / invitación de cuenta) llegan con el token en el #fragmento.
// Se leen UNA vez y se borran de la barra de direcciones de inmediato (que no queden en el historial ni se copien por error).
function leerEnlaceAuth() {
  const crudo = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!/(^|&)(access_token|error|error_code)=/.test(crudo)) return null;
  const p = new URLSearchParams(crudo);
  history.replaceState(null, "", location.pathname + location.search);
  const tipo = p.get("type");
  if (p.get("error") || p.get("error_code") || !p.get("access_token") || !["recovery", "invite"].includes(tipo)) return { error: true };
  return { tipo, access_token: p.get("access_token"), refresh_token: p.get("refresh_token") ?? "" };
}
let enlaceInicial = leerEnlaceAuth();

let apiUnica = null;
async function iniciar(mensaje) {
  apiUnica ??= await crearApi(window.FEL_CONFIG ?? { modo: "demo" });
  const api = apiUnica;
  if (api.modo === "remoto") {
    api.alPerderSesion = (m) => iniciar(m ?? "Tu sesión venció. Inicia sesión de nuevo.");
    api.pedirCodigoMfa = pedirCodigoTotp;
    if (enlaceInicial) { const e = enlaceInicial; enlaceInicial = null; return e.error ? pantallaLogin(api, "El enlace venció o no es válido. Pide uno nuevo.") : pantallaNuevaContrasena(api, e); }
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

const marca = () => h("div", { class: "marca" }, h("span", { class: "marca-logo", "aria-hidden": "true" }, "N"), h("div", {}, h("strong", {}, "NEXA FEL"), h("small", {}, "Facturación electrónica")));
const tarjeta = (...hijos) => h("main", { class: "login" }, h("form", { class: "login-card", onsubmit: (e) => e.preventDefault() }, marca(), ...hijos));

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
  const c = tarjeta(h("h1", {}, "Inicia sesión"), h("p", { class: "mut" }, "Acceso solo por invitación."),
    mensaje ? h("p", { class: "aviso aviso-ambar", role: "status" }, icono("info"), h("span", {}, mensaje)) : null,
    campo("Correo", mail), campo("Contraseña", pass), err, entrar,
    h("button", { type: "button", class: "link", onclick: () => pantallaOlvido(api) }, "¿Olvidaste tu contraseña?"));
  c.firstChild.onsubmit = (e) => { e.preventDefault(); entrar.click(); };
  poner(raiz, c); mail.focus();
}

// Recuperación de contraseña: respuesta idéntica exista o no la cuenta (no se revela quién tiene cuenta).
function pantallaOlvido(api) {
  const mail = h("input", { type: "email", autocomplete: "username", required: true, "aria-label": "Correo" });
  const err = h("p", { class: "err", role: "alert" });
  const enviar = boton("Enviar enlace", { onclick: async () => {
    err.textContent = ""; if (!mail.value.trim()) { err.textContent = "Escribe tu correo."; return; }
    enviar.disabled = true;
    try { await api.solicitarRestablecimiento(mail.value.trim()); } catch (e) { if (e.codigo === "limite_excedido") { err.textContent = mensajeError(e); enviar.disabled = false; return; } }
    const c = tarjeta(h("h1", {}, "Revisa tu correo"), h("p", { class: "mut" }, "Si ese correo pertenece a una cuenta, recibirás un enlace para crear una contraseña nueva. Revisa también la carpeta de correo no deseado. El enlace vence en poco tiempo."),
      boton("Volver al inicio de sesión", { tipo: "sec", onclick: () => pantallaLogin(api) }));
    poner(raiz, c);
  } });
  const c = tarjeta(h("h1", {}, "Recuperar contraseña"), h("p", { class: "mut" }, "Te enviaremos un enlace para crear una contraseña nueva."), campo("Correo", mail), err, enviar,
    h("button", { type: "button", class: "link", onclick: () => pantallaLogin(api) }, "Volver"));
  c.firstChild.onsubmit = (e) => { e.preventDefault(); enviar.click(); };
  poner(raiz, c); mail.focus();
}

// Llegada desde el correo (recuperación o invitación de cuenta). Esta sesión NO entra a la aplicación: solo fija la contraseña.
async function pantallaNuevaContrasena(api, enlace) {
  const invitacion = enlace.tipo === "invite";
  let r;
  try { r = await api.iniciarRestablecimiento(enlace); } catch (e) { return pantallaLogin(api, "El enlace venció o no es válido. Pide uno nuevo."); }
  const titulo = invitacion ? "Crea tu contraseña" : "Nueva contraseña";
  const pintarClave = () => {
    const a = h("input", { type: "password", autocomplete: "new-password", required: true, "aria-label": "Contraseña nueva" });
    const b = h("input", { type: "password", autocomplete: "new-password", required: true, "aria-label": "Repite la contraseña" });
    const err = h("p", { class: "err", role: "alert" });
    const ok = boton("Guardar contraseña", { onclick: async () => {
      err.textContent = "";
      if (a.value !== b.value) { err.textContent = "Las contraseñas no coinciden."; return; }
      ok.disabled = true;
      try { await api.fijarContrasena(a.value); a.value = b.value = ""; pantallaLogin(api, invitacion ? "Contraseña creada. Inicia sesión." : "Contraseña actualizada. Inicia sesión con la nueva."); }
      catch (e) { err.textContent = mensajeError(e); ok.disabled = false; }
    } });
    const c = tarjeta(h("h1", {}, titulo), h("p", { class: "mut" }, "Mínimo 12 caracteres, con mayúsculas, minúsculas y números."), campo("Contraseña nueva", a), campo("Repite la contraseña", b), err, ok);
    c.firstChild.onsubmit = (e) => { e.preventDefault(); ok.click(); };
    poner(raiz, c); a.focus();
  };
  if (!r.requiereMfa) return pintarClave();
  const codigo = h("input", { class: "codigo", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Código de 6 dígitos" });
  const err = h("p", { class: "err", role: "alert" });
  const ok = boton("Verificar", { onclick: async () => {
    err.textContent = ""; ok.disabled = true;
    try { await api.verificarMfaRestablecimiento(codigo.value.trim()); pintarClave(); }
    catch (e) { codigo.value = ""; ok.disabled = false; err.textContent = mensajeError(e); codigo.focus(); }
  } });
  const c = tarjeta(h("h1", {}, "Confirma que eres tú"), h("p", { class: "mut" }, "Esta cuenta tiene verificación en dos pasos. Escribe el código de tu app autenticadora para cambiar la contraseña."),
    campo("Código", codigo), err, ok, h("button", { type: "button", class: "link", onclick: () => pantallaPerdiDispositivo(api, () => pantallaNuevaContrasena(api, enlace)) }, "Perdí mi dispositivo"));
  c.firstChild.onsubmit = (e) => { e.preventDefault(); ok.click(); };
  poner(raiz, c); codigo.focus();
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
  const c = tarjeta(h("h1", {}, "Verificación en dos pasos"), h("p", { class: "mut" }, "Escribe el código de 6 dígitos de tu app autenticadora."),
    campo("Código", codigo), err, ok,
    h("button", { type: "button", class: "link", onclick: () => pantallaPerdiDispositivo(api, () => pantallaMfa(api)) }, "Perdí mi dispositivo"),
    h("button", { type: "button", class: "link", onclick: () => salir(api) }, "Usar otra cuenta"));
  c.firstChild.onsubmit = (e) => { e.preventDefault(); ok.click(); };
  poner(raiz, c); codigo.focus();
}

// Pérdida del dispositivo TOTP: se registra una SOLICITUD. Nada cambia hasta que otra persona verifique tu identidad y la apruebe.
function pantallaPerdiDispositivo(api, volver) {
  const motivo = h("textarea", { rows: 3, maxlength: 500, "aria-label": "Qué ocurrió", placeholder: "Ej.: perdí mi teléfono y no tengo copia de la clave de la app." });
  const err = h("p", { class: "err", role: "alert" });
  const enviar = boton("Solicitar recuperación", { onclick: async () => {
    err.textContent = ""; if (motivo.value.trim().length < 10) { err.textContent = "Cuéntanos qué ocurrió (mínimo 10 caracteres)."; return; }
    enviar.disabled = true;
    try {
      await api.solicitarRecuperacionMfa(motivo.value.trim());
      poner(raiz, tarjeta(h("h1", {}, "Solicitud enviada"), h("p", { class: "mut" }, "Un administrador de tu empresa verificará tu identidad por otro canal (por ejemplo, una videollamada) antes de aprobarla. Hasta entonces tu cuenta sigue protegida y no podrás entrar. Cuando la apruebe, inicia sesión con tu contraseña y activa un dispositivo nuevo."),
        boton("Volver", { tipo: "sec", onclick: volver })));
    } catch (e) { err.textContent = mensajeError(e); enviar.disabled = false; }
  } });
  const c = tarjeta(h("h1", {}, "Perdí mi dispositivo"),
    h("p", { class: "mut" }, "Por seguridad, nadie puede saltarse la verificación en dos pasos: ni tú ni el sistema. Puedes pedir que un administrador verifique tu identidad y restablezca tu verificación."),
    campo("¿Qué ocurrió?", motivo), err, enviar, h("button", { type: "button", class: "link", onclick: volver }, "Volver"));
  c.firstChild.onsubmit = (e) => { e.preventDefault(); enviar.click(); };
  poner(raiz, c); motivo.focus();
}

function pantallaSinAcceso(api, e) {
  poner(raiz, h("main", { class: "login" }, h("div", { class: "login-card" }, marca(), h("h1", {}, "Sin acceso"),
    h("p", { class: "mut" }, e ? mensajeError(e) : "Tu cuenta todavía no pertenece a ninguna empresa habilitada. Pide una invitación a tu administrador."),
    api.modo === "remoto" ? boton("Salir", { tipo: "sec", icon: "logout", onclick: () => salir(api) }) : null)));
}

let manejadores = null;
function arrancar(api, sesion) {
  if (manejadores) { window.removeEventListener("hashchange", manejadores.hash); document.removeEventListener("visibilitychange", manejadores.vis); }
  let actual = sesion.empresas[0];
  const contenido = h("div", { class: "contenido", id: "contenido", tabindex: "-1" });
  const nav = h("nav", { class: "nav", "aria-label": "Secciones" });
  const lateral = h("aside", { class: "lateral" }, marca(), nav);
  const demoBar = api.modo === "demo" ? h("div", { class: "demo" }, icono("info"), h("span", {}, "Modo demostración · datos de ejemplo, nada se guarda"),
    h("label", {}, "Rol: ", h("select", { "aria-label": "Rol de demostración", onchange: async (e) => { api.cambiarRol(e.target.value); const s = await api.sesion(); actual = s.empresas[0]; pintar(); } },
      api.roles.map((r) => h("option", { value: r, selected: r === actual.rol }, r))))) : null;
  const info = h("div", { class: "usuario" });
  const selEmpresa = sesion.empresas.length > 1 ? h("select", { class: "sel-empresa", "aria-label": "Empresa activa", onchange: (e) => { actual = sesion.empresas.find((x) => x.empresa.id === e.target.value); pintar(); } },
    sesion.empresas.map((x) => h("option", { value: x.empresa.id }, x.empresa.nombre_comercial))) : null;

  const aal2 = () => api.modo === "demo" || sesion.mfa === "aal2";
  const ctx = () => ({ api, sesion, aal2: aal2(), alCambiarSeguridad: () => pintar(), empresa: actual.empresa, rol: actual.rol, permisos: actual.permisos, tiene: (p) => actual.permisos.includes(p),
    ir: (ruta, o = {}) => { if (o.reemplazar) history.replaceState(null, "", `#${ruta}`); else location.hash = ruta; pintar(); } });

  function pintar() {
    const ruta = location.hash.slice(1) || "/clientes";
    const c = ctx();
    const visible = (n) => (!n.permiso || c.tiene(n.permiso)) && (!n.soloRemoto || api.modo === "remoto");
    poner(nav, selEmpresa, ...NAV.filter(visible).map((n) => h("a", { href: `#${n.ruta}`, class: `nv${ruta.startsWith(n.ruta) ? " act" : ""}`, "aria-current": ruta.startsWith(n.ruta) ? "page" : null }, icono(n.icon), h("span", {}, n.titulo))));
    if (selEmpresa) selEmpresa.value = actual.empresa.id;
    poner(info, h("span", { class: "usuario-ik" }, icono("building")), h("div", {}, h("strong", {}, actual.empresa.nombre_comercial), h("small", {}, `${actual.rol} · ${sesion.usuario.email}`)),
      api.modo === "remoto" ? h("button", { type: "button", class: "icon-btn", title: "Salir", "aria-label": "Cerrar sesión", onclick: () => salir(api) }, icono("logout")) : null);
    let vista;
    if (ruta.startsWith("/clientes") && c.tiene("clientes.ver")) vista = pantallaClientes(c);
    else if (ruta.startsWith("/conceptos") && c.tiene("conceptos.ver")) vista = pantallaConceptos(c);
    else if (ruta === "/borradores/nuevo") { if (!c.tiene("borradores.crear")) { history.replaceState(null, "", "#/borradores"); return pintar(); } vista = pantallaEditor(c, null); }
    else if (ruta.startsWith("/borradores/") && c.tiene("borradores.ver")) vista = pantallaEditor(c, ruta.split("/")[2]);
    else if (ruta.startsWith("/borradores") && c.tiene("borradores.ver")) vista = pantallaBorradores(c);
    else if (ruta.startsWith("/usuarios") && c.tiene("usuarios.ver")) vista = pantallaUsuarios(c, ruta.replace(/\/$/, ""));
    else if (ruta.startsWith("/seguridad") && api.modo === "remoto") vista = pantallaSeguridad(c);
    else { const primero = NAV.find(visible); if (primero && ruta !== primero.ruta) { history.replaceState(null, "", `#${primero.ruta}`); return pintar(); } vista = h("p", { class: "mut" }, "Tu rol no tiene secciones disponibles."); }
    const sinAal2 = api.modo === "remoto" && sesion.mfa !== "aal2";
    poner(contenido, sinAal2 && !ruta.startsWith("/seguridad") ? h("p", { class: "aviso aviso-ambar", role: "status" }, icono("lock"), h("span", {}, sesion.plataforma ? "Administrador maestro: activa la verificación en dos pasos para ejecutar acciones administrativas. " : "Protege tu cuenta con verificación en dos pasos. "), h("a", { href: "#/seguridad" }, "Ir a Seguridad")) : null, vista);
    document.title = `NEXA FEL · ${NAV.find((n) => ruta.startsWith(n.ruta))?.titulo ?? ""}`;
  }
  lateral.append(info);
  poner(raiz, demoBar, h("div", { class: "shell" }, lateral, h("main", { class: "principal" }, contenido)),
    h("nav", { class: "nav-movil", "aria-label": "Secciones" }));
  const movil = raiz.querySelector(".nav-movil");
  const pintarMovil = () => poner(movil, ...[...nav.querySelectorAll("a")].map((a) => a.cloneNode(true)));

  // Los permisos se revisan en el servidor en cada operación; aquí se recargan cuando cambian (revocación, cambio de rol…).
  async function recargarAcceso(avisar = true) {
    try {
      const s = await api.revalidar?.(); if (!s) return;
      if (!s.empresas?.length) { await api.cerrarSesion(); return iniciar("Tu acceso fue revocado. Contacta a tu administrador."); }
      const nuevo = s.empresas.find((x) => x.empresa.id === actual.empresa.id) ?? s.empresas[0];
      const cambio = JSON.stringify([nuevo.rol, [...nuevo.permisos].sort(), nuevo.empresa.id]) !== JSON.stringify([actual.rol, [...actual.permisos].sort(), actual.empresa.id]);
      sesion.empresas = s.empresas; sesion.mfa = s.mfa; sesion.plataforma = s.plataforma;
      if (cambio) { actual = nuevo; pintar(); pintarMovil(); if (avisar) toast("Tus permisos cambiaron.", "error"); }
    } catch { /* si fue revocación, la propia API ya cerró la sesión */ }
  }
  api.alCambiarPermisos = () => recargarAcceso();
  manejadores = {
    hash: () => { pintar(); pintarMovil(); contenido.focus({ preventScroll: true }); if (api.modo === "remoto") recargarAcceso(); },
    vis: () => { if (!document.hidden && api.modo === "remoto") recargarAcceso(); },
  };
  window.addEventListener("hashchange", manejadores.hash); document.addEventListener("visibilitychange", manejadores.vis);
  pintar(); pintarMovil();
}

iniciar().catch((e) => { console.error(e); toast("No se pudo iniciar la aplicación", "error"); });
