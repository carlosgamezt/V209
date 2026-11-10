import { h, boton, insignia, modal, campo, toast, vacio, cabecera, fechaLarga, mensajeError, poner } from "../ui.js";
import { icono } from "../icons.js";

const ROLES = ["propietario", "administrador", "emisor", "lector"];
const RANGO = { propietario: 4, administrador: 3, emisor: 2, lector: 1 };
const ETIQUETA_ROL = { propietario: "Propietario", administrador: "Administrador", emisor: "Emisor", lector: "Lector" };
const TONO_ROL = { propietario: "lila", administrador: "azul", emisor: "verde", lector: "gris" };
const ESTADO_INV = { pendiente: ["Pendiente", "ambar"], aceptada: ["Aceptada", "verde"], revocada: ["Revocada", "gris"], vencida: ["Vencida", "gris"] };
const TABS = [["/usuarios", "Usuarios"], ["/usuarios/invitaciones", "Invitaciones"], ["/usuarios/roles", "Roles y permisos"], ["/usuarios/recuperacion", "Recuperación de acceso"]];

const conjunto = (a) => new Set(a ?? []);
// Roles que esta persona puede asignar: el propietario, todos; los demás, solo los de rango menor al suyo (la base lo vuelve a exigir).
const rolesAsignables = (rol) => ROLES.filter((r) => rol === "propietario" || RANGO[r] < RANGO[rol]);

export function pantallaUsuarios(ctx, ruta) {
  const { tiene, rol, sesion } = ctx;
  const puedeGestionar = tiene("usuarios.gestionar");
  const aal2 = ctx.aal2;
  const tab = TABS.find(([r]) => r === ruta)?.[0] ?? "/usuarios";
  const visibles = TABS.filter(([r]) => r !== "/usuarios/recuperacion" || puedeGestionar);
  const cont = h("div", {}, h("p", { class: "mut" }, "Cargando…"));
  const barraTabs = h("nav", { class: "tabs", "aria-label": "Administración de usuarios" }, visibles.map(([r, t]) =>
    h("a", { href: `#${r}`, class: `tab${r === tab ? " on" : ""}`, "aria-current": r === tab ? "page" : null }, t)));

  const avisoMfa = puedeGestionar && !aal2 ? h("p", { class: "aviso aviso-ambar", role: "status" }, icono("lock"),
    h("span", {}, "Para invitar o modificar usuarios necesitas verificación en dos pasos. "), h("a", { href: "#/seguridad" }, "Activarla en Seguridad")) : null;

  if (tab === "/usuarios") tabUsuarios(); else if (tab === "/usuarios/invitaciones") tabInvitaciones(); else if (tab === "/usuarios/roles") tabRoles(); else tabRecuperacion();

  // ============================================================ Usuarios
  async function tabUsuarios() {
    try {
      const [miembros, rp] = await Promise.all([ctx.api.listarMiembros(ctx.empresa.id), ctx.api.listarRolesPermisos()]);
      const fila = (m) => {
        const yo = m.user_id === sesion.usuario.id;
        const quitados = m.permisos_revocados.length, extra = m.permisos_extra.length;
        const gestionable = puedeGestionar && aal2 && !yo && (rol === "propietario" || RANGO[m.rol] < RANGO[rol]);
        return h("div", { class: `fila fila-usr${m.activo ? "" : " inactivo"}` },
          h("div", { class: "celda celda-main", "data-et": "Persona" }, h("strong", {}, m.nombre || m.email), h("small", {}, m.nombre ? m.email : (yo ? "Tú" : "")), yo && m.nombre ? h("small", {}, "Tú") : null),
          h("div", { class: "celda", "data-et": "Rol" }, insignia(ETIQUETA_ROL[m.rol], TONO_ROL[m.rol])),
          h("div", { class: "celda", "data-et": "Permisos" }, h("span", {}, `${m.permisos_efectivos.length} activos`), extra || quitados ? h("small", {}, [extra ? `+${extra} extra` : "", quitados ? `−${quitados} quitados` : ""].filter(Boolean).join(" · ")) : null),
          h("div", { class: "celda", "data-et": "Estado" }, m.cuenta === "sin_perfil" ? insignia("Sin acceso", "ambar") : m.cuenta === "bloqueada" ? insignia("Cuenta bloqueada", "rojo") : insignia(m.activo ? "Activo" : "Desactivado", m.activo ? "verde" : "gris")),
          h("div", { class: "celda celda-ac" }, gestionable ? [
            h("button", { type: "button", class: "icon-btn", title: "Cambiar rol y permisos", "aria-label": `Cambiar rol y permisos de ${m.email}`, onclick: () => editar(m, rp) }, icono("pencil")),
            h("button", { type: "button", class: "icon-btn", title: m.activo ? "Desactivar en esta empresa" : "Reactivar", "aria-label": `${m.activo ? "Desactivar" : "Reactivar"} a ${m.email}`, onclick: () => alternar(m) }, icono(m.activo ? "archive" : "undo"))] : null));
      };
      poner(cont, h("div", { class: "lista" },
        h("div", { class: "fila fila-usr fila-cab", "aria-hidden": "true" }, h("span", {}, "Persona"), h("span", {}, "Rol"), h("span", {}, "Permisos"), h("span", {}, "Estado"), h("span", {})),
        ...miembros.map(fila)),
        h("p", { class: "mut nota" }, "Solo ves a las personas de esta empresa. Desactivar a alguien le quita el acceso a esta empresa al instante; su cuenta no se borra."));
    } catch (e) { poner(cont, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  async function alternar(m) {
    try { await ctx.api.actualizarMiembro(ctx.empresa.id, m.user_id, { activo: !m.activo }); toast(m.activo ? "Persona desactivada en esta empresa" : "Persona reactivada"); tabUsuarios(); }
    catch (e) { toast(mensajeError(e), "error"); }
  }
  function editar(m, rp) {
    let rolSel = m.rol; const extra = conjunto(m.permisos_extra), rev = conjunto(m.permisos_revocados);
    const miosPermisos = conjunto(ctx.permisos);
    const selRol = h("select", { "aria-label": "Rol" }, [...new Set([m.rol, ...rolesAsignables(rol)])].map((r) => h("option", { value: r, selected: r === m.rol }, ETIQUETA_ROL[r])));
    const rejilla = h("div", { class: "rejilla-permisos" });
    const err = h("p", { class: "err", role: "alert" });
    const base = () => conjunto(rp.roles[rolSel]);
    const marcado = (p) => (base().has(p) || extra.has(p)) && !rev.has(p);
    const pintar = () => poner(rejilla, ...rp.catalogo.map((c) => {
      const chk = h("input", { type: "checkbox", checked: marcado(c.codigo), disabled: !marcado(c.codigo) && !miosPermisos.has(c.codigo), "aria-label": c.codigo,
        onchange: (ev) => { const b = base().has(c.codigo);
          if (ev.target.checked) { b ? rev.delete(c.codigo) : extra.add(c.codigo); } else { b ? rev.add(c.codigo) : extra.delete(c.codigo); } pintar(); } });
      const dif = base().has(c.codigo) ? (rev.has(c.codigo) ? "quitado" : "") : (extra.has(c.codigo) ? "extra" : "");
      return h("label", { class: `permiso${dif ? " permiso-" + dif : ""}` }, chk, h("span", {}, h("strong", {}, c.codigo), h("small", {}, c.descripcion), dif ? h("span", { class: "permiso-tag" }, insignia(dif === "extra" ? "Extra" : "Quitado", dif === "extra" ? "azul" : "ambar")) : null));
    }));
    selRol.addEventListener("change", () => { rolSel = selRol.value; pintar(); });
    pintar();
    let m_; let guardando = false;
    const ok = boton("Guardar cambios", { onclick: async () => {
      if (guardando) return; guardando = true; ok.disabled = true; err.textContent = "";
      const b = base();
      // solo diferencias respecto del rol base elegido
      const permisos_extra = [...extra].filter((p) => !b.has(p)), permisos_revocados = [...rev].filter((p) => b.has(p));
      try { await ctx.api.actualizarMiembro(ctx.empresa.id, m.user_id, { ...(rolSel !== m.rol ? { rol: rolSel } : {}), permisos_extra, permisos_revocados });
        m_.cerrar(); toast("Cambios guardados"); tabUsuarios(); }
      catch (e) { err.textContent = mensajeError(e); } finally { guardando = false; ok.disabled = false; }
    } });
    m_ = modal({ titulo: `Rol y permisos de ${m.nombre || m.email}`, ancho: "lg", contenido: [
      campo("Rol en esta empresa", selRol, { ayuda: "Solo puedes asignar roles inferiores al tuyo (el propietario puede asignar cualquiera)." }),
      h("p", { class: "mut" }, "Ajusta permisos sueltos sobre el rol. No puedes conceder permisos que tú no tienes."), rejilla, err],
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m_.cerrar() }), ok] });
  }

  // ============================================================ Invitaciones (a la EMPRESA)
  async function tabInvitaciones() {
    try {
      if (!puedeGestionar) { poner(cont, vacio("lock", "Sin permiso", "Tu rol no puede ver ni crear invitaciones.")); return; }
      const [lista, rp] = await Promise.all([ctx.api.listarInvitaciones(ctx.empresa.id), ctx.api.listarRolesPermisos()]);
      const fila = (i) => { const [t, tono] = ESTADO_INV[i.estado] ?? [i.estado, "gris"]; return h("div", { class: "fila fila-inv" },
        h("div", { class: "celda celda-main", "data-et": "Correo" }, h("strong", {}, i.email), h("small", {}, `Creada el ${fechaLarga(i.creado_en?.slice(0, 10))}`)),
        h("div", { class: "celda", "data-et": "Rol" }, insignia(ETIQUETA_ROL[i.rol] ?? i.rol, TONO_ROL[i.rol] ?? "gris")),
        h("div", { class: "celda", "data-et": "Estado" }, insignia(t, tono)),
        h("div", { class: "celda", "data-et": "Vence" }, i.estado === "pendiente" ? fechaLarga(i.expira_en?.slice(0, 10)) : "—"),
        h("div", { class: "celda celda-ac" }, i.estado === "pendiente" && aal2 ? h("button", { type: "button", class: "icon-btn", title: "Revocar", "aria-label": `Revocar la invitación de ${i.email}`, onclick: () => revocar(i) }, icono("x")) : null)); };
      poner(cont,
        h("div", { class: "card explica" }, h("h2", { class: "card-t" }, "Dos cosas distintas"),
          h("div", { class: "dos-col" },
            h("div", {}, h("strong", {}, "Invitación a esta empresa"), h("p", { class: "mut" }, "La crea NEXA FEL con un rol y permisos. Sin ella, nadie entra a la empresa. No da acceso hasta que la persona inicia sesión con ese correo ya confirmado.")),
            h("div", {}, h("strong", {}, "Correo de cuenta (Supabase Auth)"), h("p", { class: "mut" }, "Si la persona todavía no tiene cuenta, Supabase le envía un correo para crear su contraseña. Una cuenta sin invitación vigente no tiene acceso a nada.")))),
        h("div", { class: "barra" }, h("span", { class: "mut" }, `${lista.length} invitaciones`), puedeGestionar ? h("span", { class: "ph-ac" }, boton("Invitar a la empresa", { icon: "plus", disabled: !aal2, title: aal2 ? null : "Requiere verificación en dos pasos", onclick: () => nueva(rp) })) : null),
        lista.length ? h("div", { class: "lista" }, h("div", { class: "fila fila-inv fila-cab", "aria-hidden": "true" }, h("span", {}, "Correo"), h("span", {}, "Rol"), h("span", {}, "Estado"), h("span", {}, "Vence"), h("span", {})), ...lista.map(fila))
          : vacio("users", "No hay invitaciones", "Invita a una persona para que se una a esta empresa."));
    } catch (e) { poner(cont, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  async function revocar(i) {
    try { await ctx.api.revocarInvitacion(ctx.empresa.id, i.id); toast("Invitación revocada. La cuenta de Auth, si existe, no se borra."); tabInvitaciones(); }
    catch (e) { toast(mensajeError(e), "error"); }
  }
  function nueva(rp) {
    const mail = h("input", { type: "email", autocomplete: "off", maxlength: 200, "aria-label": "Correo de la persona" });
    const selRol = h("select", { "aria-label": "Rol" }, rolesAsignables(rol).map((r) => h("option", { value: r, selected: r === "lector" }, ETIQUETA_ROL[r])));
    const err = h("p", { class: "err", role: "alert" });
    let m_, guardando = false;
    const ok = boton("Enviar invitación", { onclick: async () => {
      if (guardando) return; guardando = true; ok.disabled = true; err.textContent = "";
      try {
        const r = await ctx.api.invitarMiembro(ctx.empresa.id, { email: mail.value.trim(), rol: selRol.value, permisos_extra: [] });
        m_.cerrar(); toast(r.correo_enviado ? "Invitación registrada y correo de cuenta enviado" : `Invitación registrada. ${r.aviso ?? "No se envió correo de cuenta."}`); tabInvitaciones();
      } catch (e) { err.textContent = mensajeError(e); } finally { guardando = false; ok.disabled = false; }
    } });
    m_ = modal({ titulo: "Invitar a la empresa", contenido: h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); ok.click(); } },
      campo("Correo", mail), campo("Rol", selRol, { ayuda: "Los permisos sueltos se ajustan después, en Usuarios." }),
      h("p", { class: "mut nota" }, "Se crea la invitación a esta empresa. Si esa persona aún no tiene cuenta, Supabase le enviará además un correo para crear su contraseña."), err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m_.cerrar() }), ok] });
  }

  // ============================================================ Roles y permisos (solo lectura)
  async function tabRoles() {
    try {
      const rp = await ctx.api.listarRolesPermisos();
      poner(cont, h("p", { class: "mut nota" }, "Los roles base son fijos. Los ajustes por persona (permisos extra o quitados) se hacen en la pestaña Usuarios."),
        h("div", { class: "lista matriz-caja" }, h("table", { class: "matriz" },
          h("thead", {}, h("tr", {}, h("th", {}, "Permiso"), ROLES.map((r) => h("th", { class: "der" }, ETIQUETA_ROL[r])))),
          h("tbody", {}, rp.catalogo.map((c) => h("tr", {}, h("td", {}, h("strong", {}, c.codigo), h("small", {}, c.descripcion)),
            ROLES.map((r) => h("td", { class: "der", "aria-label": `${c.codigo} para ${ETIQUETA_ROL[r]}: ${rp.roles[r].includes(c.codigo) ? "sí" : "no"}` }, rp.roles[r].includes(c.codigo) ? h("span", { class: "si" }, icono("check")) : h("span", { class: "no" }, "—")))))))));
    } catch (e) { poner(cont, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }

  // ============================================================ Recuperación de acceso (MFA perdido)
  async function tabRecuperacion() {
    if (!aal2) { poner(cont, h("p", { class: "aviso aviso-ambar" }, icono("lock"), h("span", {}, "Resolver solicitudes exige verificación en dos pasos. "), h("a", { href: "#/seguridad" }, "Activarla en Seguridad"))); return; }
    try {
      const sol = await ctx.api.listarSolicitudesMfa();
      poner(cont,
        h("div", { class: "card explica" }, h("h2", { class: "card-t" }, "Cuando alguien pierde su dispositivo TOTP"),
          h("p", { class: "mut" }, "Nadie puede saltarse la verificación en dos pasos por su cuenta. La persona pide la recuperación; tú verificas su identidad por otro canal (videollamada, en persona…) y la apruebas dejando constancia. Se eliminan sus dispositivos TOTP y debe activar uno nuevo.")),
        sol.length ? h("div", { class: "lista" }, h("div", { class: "fila fila-sol fila-cab", "aria-hidden": "true" }, h("span", {}, "Persona"), h("span", {}, "Motivo"), h("span", {}, "Solicitada"), h("span", {}, "Estado"), h("span", {})),
          ...sol.map((s) => h("div", { class: "fila fila-sol" },
            h("div", { class: "celda celda-main", "data-et": "Persona" }, h("strong", {}, s.email)),
            h("div", { class: "celda", "data-et": "Motivo" }, s.motivo),
            h("div", { class: "celda", "data-et": "Solicitada" }, fechaLarga(s.solicitada_en?.slice(0, 10))),
            h("div", { class: "celda", "data-et": "Estado" }, insignia(s.estado === "aprobada" ? "Aprobada · falta ejecutar" : "Pendiente", "ambar")),
            h("div", { class: "celda celda-ac" }, h("button", { type: "button", class: "btn btn-sec btn-chico", onclick: () => resolver(s) }, s.estado === "aprobada" ? "Reintentar" : "Revisar")))))
          : vacio("circleCheck", "Sin solicitudes", "No hay solicitudes de recuperación pendientes que puedas resolver."));
    } catch (e) { poner(cont, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  function resolver(s) {
    const ver = h("textarea", { rows: 3, maxlength: 500, "aria-label": "Cómo verificaste su identidad", placeholder: "Ej.: videollamada con documento en mano; confirmé nombre, cargo y número de teléfono registrado." });
    const chk = h("input", { type: "checkbox", "aria-label": "Confirmo la verificación" });
    const err = h("p", { class: "err", role: "alert" });
    let m_, ocupado = false;
    const aprobar = boton(s.estado === "aprobada" ? "Reintentar eliminación" : "Aprobar y eliminar dispositivos", { tipo: "peligro", onclick: async () => {
      if (ocupado) return; err.textContent = "";
      if (!chk.checked) { err.textContent = "Confirma que verificaste la identidad por otro canal."; return; }
      if (ver.value.trim().length < 20) { err.textContent = "Describe cómo verificaste la identidad (mínimo 20 caracteres)."; return; }
      ocupado = true; aprobar.disabled = true;
      try { const r = await ctx.api.aprobarSolicitudMfa(s.id, ver.value.trim()); m_.cerrar(); toast(`Recuperación aplicada (${r.factores_eliminados} dispositivo/s eliminados). La persona debe activar uno nuevo.`); tabRecuperacion(); }
      catch (e) { err.textContent = mensajeError(e); } finally { ocupado = false; aprobar.disabled = false; }
    } });
    const rechazar = boton("Rechazar", { tipo: "sec", onclick: async () => {
      if (ocupado) return; ocupado = true;
      try { await ctx.api.rechazarSolicitudMfa(s.id, ver.value.trim().length >= 5 ? ver.value.trim() : "No se pudo verificar la identidad"); m_.cerrar(); toast("Solicitud rechazada"); tabRecuperacion(); }
      catch (e) { err.textContent = mensajeError(e); } finally { ocupado = false; }
    } });
    m_ = modal({ titulo: `Recuperar acceso de ${s.email}`, ancho: "md", contenido: [
      h("p", { class: "aviso aviso-ambar" }, icono("lock"), h("span", {}, "Esta acción elimina los dispositivos de verificación de la persona. Hazla solo si estás seguro de quién es.")),
      h("p", {}, h("strong", {}, "Motivo que dio: "), s.motivo),
      campo("Cómo verificaste su identidad (queda en la auditoría)", ver),
      h("label", { class: "check" }, chk, h("span", {}, "Verifiqué su identidad por un canal distinto de esta aplicación")), err],
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m_.cerrar() }), s.estado === "pendiente" ? rechazar : null, aprobar] });
  }

  return h("section", { class: "pantalla" },
    cabecera({ icon: "users", titulo: "Usuarios", subtitulo: "Personas, invitaciones, roles y permisos de esta empresa." }), barraTabs, avisoMfa, cont);
}
