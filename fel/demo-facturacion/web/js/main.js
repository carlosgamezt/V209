// Arranque de la demostración: estructura (menú lateral + barra superior), persona de la demostración, rutas y aviso permanente de simulación.
// Rutas: #/ (facturas), #/nueva, #/f/<id>, #/clientes, #/conceptos, #/config
import { h, poner, toast, mensajeError } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api, cambiarUsuario, usuarioActual, escrituras } from "./api.js";
import { pantallaLista } from "./lista.js";
import { pantallaLogin } from "./login.js";

// Carga diferida de pantallas: el navegador solo descarga el código de la pantalla que se abre (la carga inicial trae solo el marco, la lista y el inicio de sesión).
const MODULOS = { pantallaFactura: "./factura.js", pantallaClientes: "./clientes.js", pantallaConceptos: "./conceptos.js", pantallaConfig: "./config.js", pantallaPlan: "./plan.js", pantallaPanel: "./panel.js", pantallaCuenta: "./cuenta.js", pantallaUsuarios: "./usuarios.js", pantallaEstablecimientos: "./establecimientos.js",
  pantallaEmpresas: "./plataforma.js", pantallaEmpresa: "./plataforma.js", pantallaPlanes: "./plataforma.js", pantallaBolson: "./plataforma.js" };
// «Nueva factura» arrastra una cadena de módulos (factura + proceso + vista previa + …): se piden TODOS en paralelo desde que carga la página (el usuario aún está escribiendo su clave), así que al abrirla ya están.
const CADENA_FACTURA = ["factura", "proceso", "vista_previa", "emitido", "iva", "item_editor", "tipos", "receptor_nit", "anular", "correo", "descarga", "digifact", "dinero"].map((m) => `/web/js/${m}.js`).concat(["/app/js/calculo.js"]);
setTimeout(() => { for (const u of CADENA_FACTURA) { const l = document.createElement("link"); l.rel = "modulepreload"; l.href = u; document.head.append(l); } }, 0);
let moduloPrecargado = false;
function precargarPantallas() {   // tras pintar la primera pantalla y con el navegador libre: se descargan EN PARALELO (con sus dependencias) las pantallas diferidas, para que abrirlas no espere una cascada de archivos
  if (moduloPrecargado) return; moduloPrecargado = true;
  const poner = () => { for (const m of new Set(Object.values(MODULOS))) { const l = document.createElement("link"); l.rel = "modulepreload"; l.href = m.replace("./", "/web/js/"); document.head.append(l); } };
  if ("requestIdleCallback" in globalThis) requestIdleCallback(poner, { timeout: 2500 }); else setTimeout(poner, 800);
}
const perezosa = (nombre, ...args) => {
  const marco = h("section", { class: "pantalla", "aria-busy": "true" }, h("p", { class: "mut" }, "Cargando…"));
  import(MODULOS[nombre]).then((m) => { if (marco.isConnected) marco.replaceWith(m[nombre](...args)); }).catch(() => { marco.replaceChildren(h("p", { class: "err", role: "alert" }, "No se pudo cargar la pantalla. Revisa tu conexión e inténtalo de nuevo.")); });
  return marco;
};

const raiz = document.getElementById("app");
const VERSION_DEMO = "demo-ea1";   // acceso anticipado, 1.ª iteración
// Registro mínimo de errores de la sesión (solo mensajes técnicos; nunca datos de facturas) para el botón «Reportar un problema»
const ERRORES = [];
const anotar = (t) => { ERRORES.push(`${new Date().toISOString().slice(11, 19)} ${String(t).slice(0, 160)}`); if (ERRORES.length > 8) ERRORES.shift(); };
window.addEventListener("error", (e) => anotar(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => anotar(`promesa: ${e.reason?.message ?? e.reason}`));
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso: alternativa */ }
  try { const t = h("textarea", { style: "position:fixed;opacity:0" }); t.value = texto; document.body.append(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; } catch { return false; }
}
let alCambiarRuta = null;
const NAV = [
  { ruta: "/panel", titulo: "Panel", icon: "file", permiso: "borradores.ver", practico: true },
  { ruta: "/nueva", titulo: "Nueva factura", corto: "Nueva", icon: "plus", permiso: "borradores.crear" },
  { ruta: "/", titulo: "Facturas emitidas", icon: "file", permiso: "borradores.ver", exacta: true, tambien: ["/f/"] },
  { ruta: "/clientes", titulo: "Clientes", icon: "users", permiso: "clientes.ver" },
  { ruta: "/conceptos", titulo: "Conceptos", icon: "package", permiso: "conceptos.ver" },
  { ruta: "/usuarios", titulo: "Usuarios", icon: "users", permiso: "usuarios.ver", practico: true },
  { ruta: "/establecimientos", titulo: "Establecimientos", corto: "Sucursales", icon: "building", permiso: "establecimientos.asignar", practico: true },
  { ruta: "/plan", titulo: "Plan y consumo", icon: "package", permiso: "facturacion.ver", practico: true },
  { ruta: "/config", titulo: "Configuración", icon: "building", permiso: "empresa.ver" },
  { ruta: "/cuenta", titulo: "Mi cuenta", icon: "lock", permiso: "borradores.ver", practico: true, login: true },
];
const NAV_MAESTRO = [
  { ruta: "/", titulo: "Empresas", icon: "building", exacta: true, tambien: ["/empresa/"] },
  { ruta: "/planes", titulo: "Planes y tarifas", icon: "package" },
  { ruta: "/bolso" + "n", titulo: "Bolsón global", icon: "shield" },
];
const iniciales = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

async function iniciar(estadoInicial) {
  // Lecturas independientes en PARALELO con el estado (antes iban una tras otra): la primera página de «Emitidos», los tipos y los pendientes. Quedan en una «precarga» de un solo uso que las pantallas consumen.
  const precarga = (p) => p.catch(() => null);
  // Solo lo NECESARIO para la primera pantalla viaja junto al estado (la primera página de «Emitidos»); el resto se pide justo después, para que no compita por el ancho de banda del teléfono con lo que se necesita para pintar.
  if (!estadoInicial) globalThis.__felPrecarga = { t: Date.now(), emitidos: precarga(api.documentosPagina(`pagina=1&tam=25&categoria=emitidos`)) };
  let estado = estadoInicial ?? await api.estado(), pendientes = [];
  if (!estadoInicial && globalThis.__felPrecarga) { const pc = globalThis.__felPrecarga; pc.pendientes = precarga(api.documentosPagina("pagina=1&tam=25&categoria=pendientes")); pc.tipos = precarga(api.tiposDocumento()); for (const f of [() => api.correoEstado(), () => api.digifactEstado(), () => api.ventanaFecha()]) precarga(f()); }   // catálogos de TTL corto: los guarda la caché segura en memoria
  const maestro = !!estado.esMaestro, conLogin = !!estado.login;
  const salir = async () => { try { await api.salir(); } catch { /* sesión ya cerrada */ } location.hash = ""; await arrancar(); };
  const contenido = h("div", { class: "contenido", tabindex: "-1" });
  const selUsuario = h("select", { "aria-label": "Persona de la demostración", class: "sel-usuario", onchange: async (e) => {
    cambiarUsuario(e.target.value);
    try { estado = await api.estado(); await pintarTodo(); toast(`Ahora actúas como ${estado.usuario.nombre} (${estado.usuario.rol})`); } catch (x) { toast(mensajeError(x), "error"); }
  } });
  let masAbierto = false, cerrarCuentaFn = () => {};
  const cerrarCuenta = () => cerrarCuentaFn();
  const reportar = async () => {
    const texto = ["REPORTE NEXA FEL (DEMO)", `versión: ${VERSION_DEMO}`, `pantalla: #${rutaActual()}`, `persona/rol: ${estado.usuario?.nombre ?? "?"} / ${estado.usuario?.rol ?? "plataforma"}`,
      `ventana: ${innerWidth}x${innerHeight} · ${navigator.userAgent}`, `hora: ${new Date().toISOString()}`, `errores recientes: ${ERRORES.length ? "" : "ninguno"}`, ...ERRORES, "(no incluye datos de facturas ni clientes) · ¿Qué esperabas y qué pasó? →"].join("\n");
    toast((await copiar(texto)) ? "Datos del problema copiados. Pégalos en el chat con tu descripción." : "No pude copiar automáticamente; indica pantalla, rol y qué pasó.", "ok");
  };
  const cab = h("header", { class: "cab-demo" }), nav = h("nav", { class: "nav", "aria-label": "Secciones" }), usuarioCard = h("div", { class: "usuario" }), movil = h("nav", { class: "nav-movil", "aria-label": "Secciones" });
  try { new ResizeObserver(() => document.documentElement.style.setProperty("--nav-movil-h", `${movil.offsetHeight}px`)).observe(movil); } catch { /* sin ResizeObserver: queda el valor por defecto */ }   // la barra de acciones se apoya justo encima de la navegación inferior, sea cual sea su altura
  const lateral = h("aside", { class: "lateral" }, h("a", { class: "marca", href: "#/", "aria-label": "Inicio" }, h("span", { class: "marca-logo" }, "N"), h("strong", {}, "Nexa")), h("p", { class: "lat-seccion" }, "FEL"), nav, usuarioCard);
  const ctx = {
    get estado() { return estado; },
    tiene: (p) => estado.permisos.includes(p),
    ir: (ruta, o = {}) => { if (o.reemplazar) history.replaceState(null, "", `#${ruta}`); else location.hash = ruta; if (o.reemplazar) pintar(); },
    recargarEstado: async () => { estado = await api.estado(); },
    repintar: () => pintar(),
  };
  const rutaActual = () => location.hash.slice(1) || "/";
  const activa = (n, r) => (n.exacta ? r === n.ruta || (n.tambien ?? []).some((t) => r.startsWith(t)) : r.startsWith(n.ruta));

  let pendEn = 0, pendEscr = -1;
  async function cargarPendientes() {
    if (maestro) { pendientes = []; return; }
    if (pendEscr === escrituras && Date.now() - pendEn < 15000) return;   // sin escrituras recientes no se vuelve a pedir en cada cambio de pantalla
    pendEn = Date.now(); pendEscr = escrituras;
    try { const pre = globalThis.__felPrecarga; const r = (pre && Date.now() - pre.t < 10000 && pre.pendientes && !pre.pendUsado ? (pre.pendUsado = true, await pre.pendientes) : null) ?? await api.documentosPagina("pagina=1&tam=25&categoria=pendientes"); pendientes = r.items; pendientes.total = r.total; } catch { pendientes = []; }   // solo la primera página de pendientes (no todos los documentos)
  }
  function pintarMenu() {
    const r = rutaActual(), items = maestro ? NAV_MAESTRO : NAV.filter((n) => ctx.tiene(n.permiso) && (!n.practico || estado.practico) && (!n.login || conLogin));
    const enlaces = (clase) => items.map((n) => h("a", { href: `#${n.ruta}`, class: `nv${activa(n, r) ? " act" : ""}`, "aria-current": activa(n, r) ? "page" : null }, icono(n.icon), h("span", {}, n.titulo)));
    const enlacesMovil = () => items.map((n) => h("a", { href: `#${n.ruta}`, class: `nv${activa(n, r) ? " act" : ""}`, "aria-current": activa(n, r) ? "page" : null, "aria-label": n.titulo }, icono(n.icon), h("span", {}, n.corto ?? n.titulo)));
    const todos = enlaces(), movilTodos = enlacesMovil(), principales = movilTodos.slice(0, 4), resto = todos.slice(4), restoActivo = items.slice(4).some((n) => activa(n, r));
    poner(nav, ...enlaces());
    const masBtn = h("button", { type: "button", class: `nv nv-mas${restoActivo || masAbierto ? " act" : ""}`, id: "nav-mas", "aria-expanded": String(masAbierto), "aria-label": "Más secciones", onclick: () => { masAbierto = !masAbierto; pintarMenu(); } }, icono("info"), h("span", {}, "Más"));
    const hoja = h("div", { class: "hoja-mas", role: "menu", hidden: !masAbierto, onclick: () => { masAbierto = false; } }, ...resto, h("button", { type: "button", class: "nv", id: "reportar-problema-mas", onclick: reportar }, icono("info"), h("span", {}, "Reportar un problema")));
    poner(movil, ...principales, ...(resto.length ? [masBtn, hoja] : []));
    poner(usuarioCard, h("span", { class: "avatar" }, iniciales(estado.usuario.nombre)), h("div", {}, h("strong", {}, estado.usuario.nombre), h("small", {}, maestro ? "Administrador de la plataforma" : estado.usuario.rol)),
      conLogin ? h("button", { type: "button", class: "icon-btn", id: "cerrar-sesion", title: "Cerrar sesión", "aria-label": "Cerrar sesión", onclick: salir }, icono("logout")) : null);
  }
  function pintarCab() {
    if (!conLogin) poner(selUsuario, ...estado.usuarios.map((u) => h("option", { value: u.clave, selected: u.clave === estado.usuario.clave }, `${u.nombre} · ${u.rol}`)));
    if (!conLogin) selUsuario.value = usuarioActual();
    const campana = h("div", { class: "campana" });
    const panel = h("div", { class: "campana-panel", hidden: true, role: "region", "aria-label": "Pendientes" },
      h("strong", {}, "Requieren atención"),
      pendientes.length ? pendientes.map((d) => h("a", { href: `#/f/${d.id}`, onclick: () => { panel.hidden = true; } },
        h("span", {}, `BR-${String(d.numero_borrador).padStart(4, "0")} · ${d.cliente_nombre ?? "Sin receptor"}`),
        h("small", {}, d.alertas > 0 ? "Alerta fiscal abierta" : d.estado_fiscal === "por_verificar" ? "Por verificar con el proveedor" : "Envío en curso"))) : h("p", { class: "mut" }, "No hay nada pendiente."));
    const btn = h("button", { type: "button", class: "icon-circ", "aria-label": `Pendientes: ${pendientes.length}`, "aria-expanded": "false", onclick: () => { panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden)); } }, icono("info"), pendientes.length ? h("span", { class: "punto" }, String(pendientes.length)) : null);
    poner(campana, btn, panel);
    // móvil (≤ 900 px): marca + avatar con el menú de la cuenta (nombre, empresa, estado de la demostración, pendientes y «Cerrar sesión»); en PC se conserva el encabezado de siempre
    cerrarCuenta();
    const selUsuarioMovil = !conLogin ? h("select", { "aria-label": "Actuar como", class: "sel-usuario", onchange: (e) => { selUsuario.value = e.target.value; selUsuario.dispatchEvent(new Event("change")); } }, ...estado.usuarios.map((u) => h("option", { value: u.clave, selected: u.clave === estado.usuario.clave }, `${u.nombre} · ${u.rol}`))) : null;
    const itemsPend = pendientes.length ? pendientes.map((d) => h("a", { href: `#/f/${d.id}`, class: "mc-pend", onclick: () => cerrarCuenta() },
      h("span", {}, `BR-${String(d.numero_borrador).padStart(4, "0")} · ${d.cliente_nombre ?? "Sin receptor"}`), h("small", {}, d.alertas > 0 ? "Alerta fiscal abierta" : d.estado_fiscal === "por_verificar" ? "Por verificar con el proveedor" : "Envío en curso"))) : [h("p", { class: "mut mc-nada" }, "No hay nada pendiente.")];
    const menuCuenta = h("div", { class: "menu-cuenta", id: "menu-cuenta-panel", role: "menu", "aria-label": "Cuenta", hidden: true },
      h("div", { class: "mc-id" }, h("strong", {}, estado.usuario.nombre), h("small", {}, maestro ? "Administrador de la plataforma" : `${estado.usuario.rol} · ${estado.empresa.nombre_comercial}`)),
      h("p", { class: "mc-demo" }, estado.persistente ? "DEMO · datos persistentes de prueba" : "DEMO · datos NO persistentes"),
      selUsuarioMovil ? h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Actuar como"), selUsuarioMovil) : null,
      maestro ? null : h("div", { class: "mc-pendientes" }, h("strong", { class: "et" }, `Requieren atención${pendientes.length ? ` (${pendientes.length})` : ""}`), ...itemsPend),
      conLogin ? h("button", { type: "button", class: "mc-salir", id: "cerrar-sesion-cab", role: "menuitem", onclick: salir }, icono("logout"), h("span", {}, "Cerrar sesión")) : null);
    const bAvatar = h("button", { type: "button", class: "avatar-btn", id: "menu-cuenta", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `Cuenta de ${estado.usuario.nombre}${pendientes.length ? ` · ${pendientes.length} pendiente(s)` : ""}`,
      onclick: (e) => { e.stopPropagation(); menuCuenta.hidden ? abrirCuenta() : cerrarCuenta(); } }, h("span", { class: "avatar" }, iniciales(estado.usuario.nombre)), pendientes.length ? h("span", { class: "punto-av", "aria-hidden": "true" }) : null);
    const cuentaWrap = h("div", { class: "cuenta-wrap" }, bAvatar, menuCuenta);
    const fueraCuenta = (e) => { if (!cuentaWrap.contains(e.target)) cerrarCuenta(); }, teclaCuenta = (e) => { if (e.key === "Escape") { cerrarCuenta(); bAvatar.focus(); } };
    function abrirCuenta() { menuCuenta.hidden = false; bAvatar.setAttribute("aria-expanded", "true"); document.addEventListener("click", fueraCuenta); document.addEventListener("keydown", teclaCuenta); }
    cerrarCuentaFn = () => { menuCuenta.hidden = true; bAvatar.setAttribute("aria-expanded", "false"); document.removeEventListener("click", fueraCuenta); document.removeEventListener("keydown", teclaCuenta); };
    poner(cab,
      h("div", { class: "cab-fila" },
        h("div", { class: "cab-marca" }, h("span", { class: "marca-logo" }, "N"), h("strong", {}, "Nexa FEL")),
        h("div", { class: "cab-tit" }, h("strong", {}, "Nexa FEL"), h("span", { class: "mut" }, "Facturación electrónica")),
        h("div", { class: "cab-der" },
          h("div", { class: "emp-sel", title: maestro ? "Plataforma" : "Empresa ficticia de la demostración" }, icono("building"), h("strong", {}, (maestro ? "PLATAFORMA" : estado.empresa.nombre_comercial).toUpperCase())),
          campana,
          conLogin ? h("span", { class: "cab-usuario", id: "usuario-actual" }, estado.usuario.nombre) : h("label", { class: "cab-usuario" }, h("span", { class: "mut" }, "Actuar como"), selUsuario)),
        cuentaWrap),
      h("div", { class: "banda-simulado", role: "status" }, icono("lock"), h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("span", { class: "tag-demo" }, estado.persistente ? "DEMO · datos persistentes de prueba" : "DEMO · datos NO persistentes"), h("span", { class: "banda-det" }, "No se conecta a SAT ni a ningún certificador; nada de lo que ves se emite de verdad.")));
  }
  function pintar() {
    const ruta = rutaActual();
    let vista;
    if (maestro) {
      if (ruta.startsWith("/empresa/")) vista = perezosa("pantallaEmpresa", ctx, ruta.split("/")[2]); else if (ruta === "/planes") vista = perezosa("pantallaPlanes", ctx); else if (ruta === "/bolson") vista = perezosa("pantallaBolson", ctx); else vista = perezosa("pantallaEmpresas", ctx);
      poner(contenido, vista); pintarMenu(); document.title = "NEXA FEL · Plataforma (SIMULADO)"; return;
    }
    if (ruta === "/nueva") vista = perezosa("pantallaFactura", ctx, null);
    else if (ruta.startsWith("/f/")) vista = perezosa("pantallaFactura", ctx, ruta.split("/")[2]);
    else if (ruta === "/clientes") vista = perezosa("pantallaClientes", ctx);
    else if (ruta === "/conceptos") vista = perezosa("pantallaConceptos", ctx);
    else if (ruta === "/plan" && estado.practico) vista = perezosa("pantallaPlan", ctx);
    else if (ruta === "/panel" && estado.practico) vista = perezosa("pantallaPanel", ctx);
    else if (ruta === "/cuenta" && conLogin) vista = perezosa("pantallaCuenta", ctx);
    else if (ruta === "/usuarios" && estado.practico) vista = perezosa("pantallaUsuarios", ctx);
    else if (ruta === "/establecimientos" && estado.practico && (estado.permisos ?? []).includes("establecimientos.asignar")) vista = perezosa("pantallaEstablecimientos", ctx);
    else if (ruta === "/config") vista = perezosa("pantallaConfig", ctx);
    else vista = pantallaLista(ctx);
    poner(contenido, vista); pintarMenu(); precargarPantallas();
    document.title = `NEXA FEL · Demostración (SIMULADO)`;
    cargarPendientes().then(pintarCab);
  }
  async function pintarTodo() { pintarCab(); pintar(); }
  pintarCab();
  poner(raiz, h("div", { class: "shell" }, lateral, h("main", { class: "principal" }, cab, contenido, h("footer", { class: "pie-demo" }, estado.persistente ? "Empresa y personas ficticias. Datos de prueba persistentes." : "Empresa y personas ficticias. Los datos viven solo en la memoria de este programa y se pierden al cerrarlo.", " · ", h("button", { type: "button", class: "enlace-btn", id: "reportar-problema", onclick: reportar }, "Reportar un problema"), ` · ${VERSION_DEMO}`))), movil);
  if (alCambiarRuta) window.removeEventListener("hashchange", alCambiarRuta);
  alCambiarRuta = () => { pintar(); contenido.focus({ preventScroll: true }); }; window.addEventListener("hashchange", alCambiarRuta);
  pintar();
}
let escuchando = false;
async function arrancar() {
  if (!escuchando) { escuchando = true; document.addEventListener("fel-sesion-vencida", () => { toast("Tu sesión terminó. Inicia sesión de nuevo.", "error"); if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* sin service worker la aplicación funciona igual */ });
arrancar().catch(mostrar); }); }
  let sesion = null;
  try { sesion = await api.sesion(); } catch (e) { if (e.status !== 404) throw e; }   // 404: modo de pruebas (selector de personas, sin contraseña)
  if (sesion && !sesion.autenticado) return pantallaLogin(raiz, sesion, () => iniciar().catch(mostrar));   // al entrar no se vuelve a pedir la sesión: ya se sabe que está autenticada
  await iniciar();
}
const mostrar = (e) => { console.error(e); poner(raiz, h("p", { class: "err", role: "alert", style: "padding:24px" }, mensajeError(e))); };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* sin service worker la aplicación funciona igual */ });
arrancar().catch(mostrar);
