// Usuarios, roles y permisos de la empresa. Las reglas de jerarquía (quién puede dar qué rol) las valida la base de datos; esta pantalla solo muestra y pide.
import { h, boton, insignia, cabecera, campo, toast, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { tablaSimple } from "./plan.js";
import { formulario } from "./plataforma.js";

const ROL = { propietario: "Propietario", administrador: "Administrador", emisor: "Emisor", lector: "Lector" };
const TONO = { propietario: "lila", administrador: "azul", emisor: "verde", lector: "gris" };

export function pantallaUsuarios(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando usuarios…" ));
  let datos = null;
  async function cargar() {
    try {
      datos = await api.usuarios(); const gest = datos.puedeGestionar;
      const cambiar = async (m, cuerpoReq) => { try { await api.actualizarUsuario(m.user_id, cuerpoReq); toast("Usuario actualizado"); await cargar(); } catch (e) { toast(mensajeError(e), "error"); await cargar(); } };
      poner(cuerpo,
        h("div", { class: "card", "data-panel": "usuarios" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Personas con acceso"), gest ? boton("Nuevo usuario", { icon: "plus", id: "nuevo-usuario", onclick: alta }) : null),
          tablaSimple([["Nombre"], ["Usuario"], ["Correo"], ["Rol"], ["Estado"], [""]], datos.miembros.map((m) => [h("strong", {}, m.nombre ?? "—"), m.usuario ?? "—", m.email,
            gest && m.rol !== "propietario" && m.user_id !== datos.yo ? h("select", { "aria-label": `Rol de ${m.nombre ?? m.email}`, onchange: (e) => cambiar(m, { rol: e.target.value }) }, ...["administrador", "emisor", "lector"].map((r) => h("option", { value: r, selected: r === m.rol }, ROL[r]))) : insignia(ROL[m.rol] ?? m.rol, TONO[m.rol] ?? "gris"),
            insignia(m.activo ? "Activo" : "Desactivado", m.activo ? "verde" : "gris"),
            gest && m.rol !== "propietario" && m.user_id !== datos.yo ? boton(m.activo ? "Desactivar" : "Reactivar", { tipo: m.activo ? "peligro" : "sec", "data-usuario": m.usuario ?? "", onclick: () => cambiar(m, { activo: !m.activo }) }) : ""]))),
        datos.invitaciones.length ? h("div", { class: "card" }, h("h2", { class: "card-t" }, "Invitaciones pendientes"), tablaSimple([["Correo"], ["Rol"]], datos.invitaciones.map((i) => [i.email, ROL[i.rol] ?? i.rol]))) : null,
        h("details", { class: "card", "data-panel": "roles" }, h("summary", {}, h("strong", {}, "Roles y permisos")),
          h("p", { class: "mut" }, "Cada rol agrupa permisos. Lo que cada persona puede hacer se decide en la base de datos, no en esta pantalla."),
          tablaSimple([["Permiso"], ...datos.roles.map((r) => [ROL[r.rol] ?? r.rol, "der"])], datos.catalogo.map((p) => [h("span", {}, h("code", {}, p.codigo), " ", h("small", { class: "mut" }, p.descripcion)), ...datos.roles.map((r) => r.permisos.includes(p.codigo) ? "✓" : "—")]))));
    } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const alta = () => { const f = { nombre: "", usuario: "", clave: "", rol: "emisor" };
    formulario({ titulo: "Nuevo usuario", textoBoton: "Crear usuario", campos: [campo("Nombre", h("input", { "aria-label": "Nombre del usuario", maxlength: 80, autocomplete: "off", oninput: (x) => { f.nombre = x.target.value; } })),
      h("div", { class: "grid2" }, campo("Usuario", h("input", { "aria-label": "Usuario nuevo", maxlength: 20, autocapitalize: "none", autocomplete: "off", oninput: (x) => { f.usuario = x.target.value; } })), campo("Contraseña (8 o más)", h("input", { "aria-label": "Contraseña del usuario nuevo", type: "password", maxlength: 80, autocomplete: "new-password", oninput: (x) => { f.clave = x.target.value; } }))),
      campo("Rol", h("select", { "aria-label": "Rol del usuario nuevo", onchange: (x) => { f.rol = x.target.value; } }, ...["administrador", "emisor", "lector"].map((r) => h("option", { value: r, selected: r === f.rol }, ROL[r]))), { ayuda: "Emisor crea borradores; Administrador certifica y concilia; Lector solo consulta." })],
      accion: async () => { await api.crearUsuario(f); toast("Usuario creado"); await cargar(); } }); };
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "users", titulo: "Usuarios", subtitulo: "Quién accede a tu empresa y con qué rol." }), cuerpo);
}
