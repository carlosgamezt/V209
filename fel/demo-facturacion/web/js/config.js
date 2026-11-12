// Configuración FEL (demostración): empresa, establecimientos, canal de emisión, numeración, impuestos y preferencias.
// Reemplaza al «Datos FEL (SAT)» de la referencia: aquí NO hay usuario ni contraseña de SAT ni «Conectado a SAT» (decisión D2); se muestra el estado REAL del canal.
import { h, boton, insignia, vacio, cabecera, modal, campo, toast, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";

const PESTANAS = [["empresa", "Empresa", "building"], ["establecimientos", "Establecimientos", "building"], ["canal", "Canal de emisión", "shield"], ["numeracion", "Numeración", "file"], ["impuestos", "Impuestos", "info"], ["preferencias", "Preferencias", "pencil"]];
const ETIQUETA_PARAM = { espera_conciliacion_manual_min: "Espera mínima antes de una conciliación manual", ventana_tardia_min: "Ventana de respuestas tardías tras una conciliación manual", umbral_recuperacion_min: "Antigüedad para recuperar operaciones tras una caída", ventana_auditoria_min: "Ventana de auditoría de respuestas tardías" };

export function pantallaConfig(ctx) {
  let pestana = "empresa", cfg = null;
  const tabs = h("div", { class: "tabs", role: "tablist" }), cuerpo = h("div", { class: "tab-cuerpo" });
  const puedeEst = ctx.tiene("establecimientos.gestionar"), puedeEmp = ctx.tiene("empresa.editar");
  const dato = (et, v) => h("div", { class: "dato" }, h("small", {}, et), h("strong", {}, v || "—"));
  const solo = (t) => h("p", { class: "aviso aviso-azul" }, icono("info"), h("span", {}, t));

  function pintarTabs() {
    poner(tabs, ...PESTANAS.map(([id, t, ik]) => h("button", { type: "button", role: "tab", "aria-selected": String(pestana === id), class: `tab${pestana === id ? " on" : ""}`, "data-tab": id, onclick: () => { pestana = id; pintarTabs(); pintarCuerpo(); } }, icono(ik), h("span", {}, t))));
  }
  function formEstablecimiento(e) {
    const f = { codigo: e?.codigo_sat ?? "", nombre: e?.nombre ?? "", direccion: e?.direccion ?? "", estado: e?.estado ?? "activo" }; const err = h("p", { class: "err", role: "alert" }); let m;
    const guardar = boton("Guardar", { id: "guardar-establecimiento", onclick: async () => {
      err.textContent = ""; if (!f.codigo.trim() || !f.nombre.trim()) { err.textContent = "El código y el nombre son obligatorios."; return; }
      guardar.disabled = true;
      try { await api.guardarEstablecimiento({ id: e?.id, codigo_sat: f.codigo, nombre: f.nombre, direccion: f.direccion, estado: f.estado }); await ctx.recargarEstado(); m.cerrar(); toast(e ? "Establecimiento actualizado" : "Establecimiento creado"); await cargar(); }
      catch (x) { err.textContent = mensajeError(x); guardar.disabled = false; }
    } });
    m = modal({ titulo: e ? "Editar establecimiento" : "Nuevo establecimiento", contenido: h("div", { class: "form" },
      h("div", { class: "grid2" }, campo("Código SAT", h("input", { value: f.codigo, maxlength: 10, "aria-label": "Código del establecimiento", oninput: (x) => { f.codigo = x.target.value; } }), { ayuda: "Ficticio en la demostración." }),
        campo("Estado", h("select", { "aria-label": "Estado del establecimiento", onchange: (x) => { f.estado = x.target.value; } }, ...[["activo", "Activo"], ["inactivo", "Inactivo"]].map(([v, t]) => h("option", { value: v, selected: f.estado === v }, t))))),
      campo("Nombre", h("input", { value: f.nombre, maxlength: 120, "aria-label": "Nombre del establecimiento", oninput: (x) => { f.nombre = x.target.value; } })),
      campo("Dirección", h("input", { value: f.direccion, maxlength: 300, "aria-label": "Dirección del establecimiento", oninput: (x) => { f.direccion = x.target.value; } })), err),
      pie: [boton("Cancelar", { tipo: "sec", onclick: () => m.cerrar() }), guardar] });
  }
  function pintarCuerpo() {
    if (!cfg) return poner(cuerpo, h("p", { class: "mut" }, "Cargando…"));
    const e = cfg.empresa;
    if (pestana === "empresa") {
      const f = { nombre: e.nombre_comercial ?? "", direccion: e.direccion ?? "", telefono: e.telefono ?? "", correo: e.correo ?? "" }, err = h("p", { class: "err", role: "alert" });
      const inp = (k, et, extra = {}) => h("input", { value: f[k], "aria-label": et, disabled: !puedeEmp, oninput: (x) => { f[k] = x.target.value; }, ...extra });
      const guardar = boton("Guardar datos", { id: "guardar-empresa", onclick: async () => {
        err.textContent = ""; if (!f.nombre.trim()) { err.textContent = "El nombre comercial es obligatorio."; return; }
        if (f.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.correo.trim())) { err.textContent = "El correo no es válido."; return; }
        guardar.disabled = true;
        try { await api.guardarEmpresa({ nombre_comercial: f.nombre, direccion: f.direccion, telefono: f.telefono, correo: f.correo }); toast("Datos de la empresa guardados"); await ctx.recargarEstado(); await cargar(); }
        catch (x) { err.textContent = mensajeError(x); guardar.disabled = false; }
      } });
      return poner(cuerpo, h("div", { class: "cfg-grid" },
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Datos de la empresa"),
          h("div", { class: "datos" }, dato("Razón social", e.razon_social), dato("NIT (ficticio)", e.nit),
            h("div", { class: "dato" }, h("small", {}, "Estado"), insignia(e.estado === "habilitada" ? "Empresa activa" : e.estado, e.estado === "habilitada" ? "verde" : "ambar"))),
          h("div", { class: "form" }, h("div", { class: "grid2" }, campo("Nombre comercial", inp("nombre", "Nombre comercial", { maxlength: 120 })), campo("Teléfono", inp("telefono", "Teléfono de la empresa", { maxlength: 40 }))),
            h("div", { class: "grid2" }, campo("Correo de facturación", inp("correo", "Correo de facturación", { maxlength: 200, type: "email" })), campo("Dirección fiscal", inp("direccion", "Dirección fiscal", { maxlength: 300 }))), err,
            puedeEmp ? h("div", { class: "acciones-fila" }, guardar) : h("p", { class: "aviso" }, icono("lock"), h("span", {}, "Tu rol solo permite consultar estos datos."))),
          h("p", { class: "nota-fiscal" }, icono("lock"), h("span", {}, "Razón social, NIT, régimen y estado son datos fiscales críticos: los gestiona la plataforma."))),
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Régimen tributario"), h("div", { class: "datos" }, dato("Régimen", e.regimen), dato("Moneda", "GTQ – Quetzal"), h("div", { class: "dato" }, h("small", {}, "Verificación del régimen"), insignia(e.regimen_estado === "verificado" ? "Verificado" : "Sin verificar", e.regimen_estado === "verificado" ? "verde" : "ambar"))),
          h("p", { class: "aviso aviso-ambar" }, icono("info"), h("span", {}, "Régimen sin verificar con un contador: la demostración no calcula impuestos ni total."))))); }
    if (pestana === "establecimientos") return poner(cuerpo, h("div", { class: "barra" }, h("p", { class: "mut" }, "Cada factura se emite desde un establecimiento."), puedeEst ? boton("Nuevo establecimiento", { icon: "plus", id: "nuevo-establecimiento", onclick: () => formEstablecimiento(null) }) : null),
      h("div", { class: "lista" }, cfg.establecimientos.length ? [h("div", { class: "fila fila-est fila-cab", "aria-hidden": "true" }, ...["Código", "Nombre", "Dirección", "Facturas", "Estado", ""].map((t) => h("span", {}, t))),
        ...cfg.establecimientos.map((x) => h("div", { class: "fila fila-est", "data-establecimiento": x.codigo_sat }, h("div", { class: "celda mono", "data-et": "Código" }, x.codigo_sat), h("div", { class: "celda celda-main", "data-et": "Nombre" }, h("strong", {}, x.nombre)),
          h("div", { class: "celda", "data-et": "Dirección" }, x.direccion ?? "—"), h("div", { class: "celda num", "data-et": "Facturas" }, String(x.documentos)), h("div", { class: "celda", "data-et": "Estado" }, insignia(x.estado === "activo" ? "Activo" : "Inactivo", x.estado === "activo" ? "verde" : "gris")),
          h("div", { class: "celda celda-ac" }, puedeEst ? h("button", { type: "button", class: "icon-btn", title: "Editar", "aria-label": `Editar ${x.nombre}`, onclick: () => formEstablecimiento(x) }, icono("pencil")) : null)))] : vacio("building", "Sin establecimientos", "Crea uno para poder emitir.")));
    if (pestana === "canal") {
      const PRIORIDAD = { portal_playwright: ["Principal previsto", "azul"], digifact: ["Secundario previsto", "lila"], mock: ["Simulación", "ambar"] };
      return poner(cuerpo,
        h("p", { class: "aviso aviso-ambar", role: "status" }, icono("lock"), h("span", {}, "SIMULADO: en esta versión solo puede estar habilitado el proveedor simulado. La base de datos rechaza habilitar cualquier canal real.")),
        h("div", { class: "lista" }, cfg.proveedores.map((p) => {
          const c = cfg.canales.find((x) => x.proveedor_id === p.id && x.habilitado), [pt, pton] = PRIORIDAD[p.id] ?? ["", "gris"];
          return h("div", { class: "fila fila-canal", "data-canal": p.id }, h("div", { class: "celda celda-main" }, h("strong", {}, p.nombre), h("small", {}, p.nota ?? "")),
            h("div", { class: "celda" }, h("small", {}, "Ambientes"), h("span", {}, p.ambientes.join(", "))),
            h("div", { class: "celda celda-tags" }, insignia(pt, pton), c ? insignia("Habilitado · simulado", "verde") : insignia(p.id === "mock" ? "Sin configurar" : "Bloqueado en esta fase", "gris")));
        })),
        h("div", { class: "card", "data-panel": "agente" }, h("h2", { class: "card-t" }, "Agente local (canal de portal)"),
          h("div", { class: "agente-estado" }, h("span", { class: "dato" }, h("small", {}, "Estado actual")), h("span", { class: "tag tag-gris tag-actual", "data-estado-agente": "no_registrado" }, "No registrado")),
          h("div", { class: "acciones-fila" }, h("button", { type: "button", class: "btn btn-sec", id: "registrar-agente", disabled: true, title: "Bloqueado: el agente local llega en una fase posterior" }, icono("lock"), h("span", {}, "Registrar agente")),
            h("button", { type: "button", class: "btn btn-sec", id: "activar-canal-real", disabled: true, title: "Bloqueado: ningún canal real puede activarse en esta fase" }, icono("lock"), h("span", {}, "Activar canal real"))),
          h("p", { class: "mut" }, "El agente local aún no existe; no hay conexión real ni simulada. Los demás estados se añadirán cuando se implemente.")));
    }
    if (pestana === "numeracion") return poner(cuerpo, h("div", { class: "card" }, h("h2", { class: "card-t" }, "Numeración"), h("div", { class: "datos" }, dato("Último número de borrador", String(cfg.ultimo_borrador)), dato("Serie y número fiscales", "Los asigna el proveedor al certificar (en simulación: serie SIMA, autorización SIM-…)")),
      solo("El número de borrador es interno y no es un número fiscal.")));
    if (pestana === "impuestos") return poner(cuerpo, h("div", { class: "card" }, h("h2", { class: "card-t" }, "Impuestos"), solo("Pendiente: IVA y otros impuestos se calcularán cuando exista un régimen fiscal verificado con un contador. Hoy no se aplica ninguna fórmula fiscal y por eso solo se muestra la base imponible.")));
    return poner(cuerpo, h("div", { class: "card" }, h("h2", { class: "card-t" }, "Preferencias de la demostración"),
      h("div", { class: "datos" }, ...cfg.parametros.filter((p) => ETIQUETA_PARAM[p.clave]).map((p) => dato(ETIQUETA_PARAM[p.clave], `${p.valor} min`))),
      solo("Solo lectura. En la demostración las tres primeras esperas son 0 minutos para poder recorrer el proceso; los valores del producto son 120 / 1440 / 10 minutos.")));
  }
  async function cargar() { try { cfg = await api.configuracion(); pintarCuerpo(); } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); } }
  pintarTabs(); pintarCuerpo(); cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "building", titulo: "Configuración FEL", subtitulo: "Datos fiscales, establecimientos y parámetros de facturación." }), tabs, cuerpo);
}
