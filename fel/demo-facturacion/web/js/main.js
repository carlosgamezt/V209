// Arranque de la demostración: estructura (menú lateral + barra superior), persona de la demostración, rutas y aviso permanente de simulación.
// Rutas: #/ (facturas), #/nueva, #/f/<id>, #/clientes, #/conceptos, #/config
import { h, poner, toast, mensajeError } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api, cambiarUsuario, usuarioActual } from "./api.js";
import { pantallaLista } from "./lista.js";
import { pantallaFactura } from "./factura.js";
import { pantallaClientes } from "./clientes.js";
import { pantallaConceptos } from "./conceptos.js";
import { pantallaConfig } from "./config.js";
import { pantallaLogin } from "./login.js";
import { pantallaPlan } from "./plan.js";
import { pantallaPanel } from "./panel.js";
import { pantallaCuenta } from "./cuenta.js";
import { pantallaUsuarios } from "./usuarios.js";
import { pantallaEmpresas, pantallaEmpresa, pantallaPlanes, pantallaBolson } from "./plataforma.js";

const raiz = document.getElementById("app");
let alCambiarRuta = null;
const NAV = [
  { ruta: "/panel", titulo: "Panel", icon: "file", permiso: "borradores.ver", practico: true },
  { ruta: "/nueva", titulo: "Nueva factura", icon: "plus", permiso: "borradores.crear" },
  { ruta: "/", titulo: "Facturas", icon: "file", permiso: "borradores.ver", exacta: true, tambien: ["/f/"] },
  { ruta: "/clientes", titulo: "Clientes", icon: "users", permiso: "clientes.ver" },
  { ruta: "/conceptos", titulo: "Conceptos", icon: "package", permiso: "conceptos.ver" },
  { ruta: "/usuarios", titulo: "Usuarios", icon: "users", permiso: "usuarios.ver", practico: true },
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
  let estado = estadoInicial ?? await api.estado(), pendientes = [];
  const maestro = !!estado.esMaestro, conLogin = !!estado.login;
  const salir = async () => { try { await api.salir(); } catch { /* sesión ya cerrada */ } location.hash = ""; await arrancar(); };
  const contenido = h("div", { class: "contenido", tabindex: "-1" });
  const selUsuario = h("select", { "aria-label": "Persona de la demostración", class: "sel-usuario", onchange: async (e) => {
    cambiarUsuario(e.target.value);
    try { estado = await api.estado(); await pintarTodo(); toast(`Ahora actúas como ${estado.usuario.nombre} (${estado.usuario.rol})`); } catch (x) { toast(mensajeError(x), "error"); }
  } });
  const cab = h("header", { class: "cab-demo" }), nav = h("nav", { class: "nav", "aria-label": "Secciones" }), usuarioCard = h("div", { class: "usuario" }), movil = h("nav", { class: "nav-movil", "aria-label": "Secciones" });
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

  async function cargarPendientes() {
    if (maestro) { pendientes = []; return; }
    try { const ds = await api.documentos(); pendientes = ds.filter((d) => d.estado_fiscal === "por_verificar" || d.alertas > 0 || (d.estado_fiscal === "pendiente_certificacion")); } catch { pendientes = []; }
  }
  function pintarMenu() {
    const r = rutaActual(), items = maestro ? NAV_MAESTRO : NAV.filter((n) => ctx.tiene(n.permiso) && (!n.practico || estado.practico) && (!n.login || conLogin));
    const enlaces = (clase) => items.map((n) => h("a", { href: `#${n.ruta}`, class: `nv${activa(n, r) ? " act" : ""}`, "aria-current": activa(n, r) ? "page" : null }, icono(n.icon), h("span", {}, n.titulo)));
    poner(nav, ...enlaces()); poner(movil, ...enlaces());
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
    poner(cab,
      h("div", { class: "cab-fila" },
        h("div", { class: "cab-tit" }, h("strong", {}, "Nexa FEL"), h("span", { class: "mut" }, "Facturación electrónica")),
        h("div", { class: "cab-der" },
          h("div", { class: "emp-sel", title: maestro ? "Plataforma" : "Empresa ficticia de la demostración" }, icono("building"), h("strong", {}, (maestro ? "PLATAFORMA" : estado.empresa.nombre_comercial).toUpperCase())),
          campana,
          conLogin ? h("span", { class: "cab-usuario", id: "usuario-actual" }, estado.usuario.nombre, h("button", { type: "button", class: "btn btn-sec cab-salir", id: "cerrar-sesion-cab", onclick: salir }, "Salir")) : h("label", { class: "cab-usuario" }, h("span", { class: "mut" }, "Actuar como"), selUsuario))),
      h("div", { class: "banda-simulado", role: "status" }, icono("lock"), h("strong", {}, "SIMULADO - SIN VALOR FISCAL"), h("span", {}, "No se conecta a SAT ni a ningún certificador; nada de lo que ves se emite de verdad.")));
  }
  function pintar() {
    const ruta = rutaActual();
    let vista;
    if (maestro) {
      if (ruta.startsWith("/empresa/")) vista = pantallaEmpresa(ctx, ruta.split("/")[2]); else if (ruta === "/planes") vista = pantallaPlanes(ctx); else if (ruta === "/bolson") vista = pantallaBolson(ctx); else vista = pantallaEmpresas(ctx);
      poner(contenido, vista); pintarMenu(); document.title = "NEXA FEL · Plataforma (SIMULADO)"; return;
    }
    if (ruta === "/nueva") vista = pantallaFactura(ctx, null);
    else if (ruta.startsWith("/f/")) vista = pantallaFactura(ctx, ruta.split("/")[2]);
    else if (ruta === "/clientes") vista = pantallaClientes(ctx);
    else if (ruta === "/conceptos") vista = pantallaConceptos(ctx);
    else if (ruta === "/plan" && estado.practico) vista = pantallaPlan(ctx);
    else if (ruta === "/panel" && estado.practico) vista = pantallaPanel(ctx);
    else if (ruta === "/cuenta" && conLogin) vista = pantallaCuenta(ctx);
    else if (ruta === "/usuarios" && estado.practico) vista = pantallaUsuarios(ctx);
    else if (ruta === "/config") vista = pantallaConfig(ctx);
    else vista = pantallaLista(ctx);
    poner(contenido, vista); pintarMenu();
    document.title = `NEXA FEL · Demostración (SIMULADO)`;
    cargarPendientes().then(pintarCab);
  }
  async function pintarTodo() { pintarCab(); pintar(); }
  pintarCab();
  poner(raiz, h("div", { class: "shell" }, lateral, h("main", { class: "principal" }, cab, contenido, h("footer", { class: "pie-demo" }, "Empresa y personas ficticias. Los datos viven solo en la memoria de este programa y se pierden al cerrarlo."))), movil);
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
  if (sesion && !sesion.autenticado) return pantallaLogin(raiz, sesion, arrancar);
  await iniciar();
}
const mostrar = (e) => { console.error(e); poner(raiz, h("p", { class: "err", role: "alert", style: "padding:24px" }, mensajeError(e))); };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* sin service worker la aplicación funciona igual */ });
arrancar().catch(mostrar);
