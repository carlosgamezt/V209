// Panel del ADMINISTRADOR DE LA PLATAFORMA (demostración): empresas, planes y tarifas, contratos, pagos simulados, cobros y bolsón global.
// Todo simulado: no hay pasarela de pago ni conexión con Digifact; el bolsón es el de un simulador local.
import { h, boton, insignia, vacio, cabecera, campo, modal, toast, mensajeError, poner, pedirMotivo } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { quetzales } from "./dinero.js";
import { api } from "./api.js";
import { vistaPlan, tablaSimple, fechaHora, fechaCorta } from "./plan.js";

const MODALIDAD = { prepago: "Prepago", consumo_mensual: "Consumo mensual", suscripcion: "Suscripción" };
const ESTADO_EMP = { habilitada: ["Habilitada", "verde"], suspendida: ["Suspendida", "rojo"], pendiente: ["Pendiente", "ambar"] };
const num = (t) => String(Number(t));
const claveNueva = () => crypto.randomUUID();
const input = (a = {}) => h("input", { autocomplete: "off", ...a });

export function formulario({ titulo, campos, accion, textoBoton = "Guardar", ancho = "md" }) {
  const err = h("p", { class: "err", role: "alert" }); let m;
  const b = boton(textoBoton, { id: "guardar-formulario", onclick: async () => {
    err.textContent = ""; b.disabled = true;
    try { await accion(); m.cerrar(); } catch (e) { err.textContent = mensajeError(e); b.disabled = false; }
  } });
  m = modal({ titulo, ancho, contenido: h("div", { class: "form" }, ...campos, err, b) });
  return m;
}

// ------------------------------------------------------------------ empresas
export function pantallaEmpresas(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando…"));
  async function cargar() {
    try {
      const { empresas, verificacion } = await api.pl.resumen();
      poner(cuerpo,
        h("div", { class: "indicadores" },
          ...[["building", String(empresas.length), "Empresas", "azul"], ["file", String(empresas.reduce((s, e) => s + e.certificaciones, 0)), "Certificaciones (simuladas)", "lila"], ["lock", num(empresas.reduce((s, e) => s + Number(e.unidades), 0)), "Unidades consumidas", "ambar"],
            ["circleCheck", verificacion.fallos === 0 ? "Coherente" : `${verificacion.fallos} fallos`, `${verificacion.comprobaciones} comprobaciones de saldos`, verificacion.fallos === 0 ? "azul" : "ambar"]]
            .map(([ik, v, et, t]) => h("div", { class: `indicador ind-${t}` }, h("span", { class: "ind-ik" }, icono(ik)), h("div", {}, h("strong", { class: "num" }, v), h("small", {}, et))))),
        h("div", { class: "card", "data-panel": "empresas" }, tablaSimple([["Empresa"], ["NIT"], ["Estado"], ["Plan"], ["Saldo", "der"], ["Certif.", "der"], [""]],
          empresas.map((e) => [h("strong", {}, e.nombre_comercial), e.nit, insignia(...(ESTADO_EMP[e.estado] ?? [e.estado, "gris"])), e.plan ? `${e.plan} · ${MODALIDAD[e.modalidad]}` : insignia("Sin plan", "ambar"),
            e.modalidad === "prepago" && e.disponible ? quetzales(e.disponible) : e.pendiente && Number(e.pendiente) ? `${quetzales(e.pendiente)} por cobrar` : "—", String(e.certificaciones),
            boton("Administrar", { tipo: "sec", "data-empresa": e.nombre_comercial, onclick: () => { location.hash = `/empresa/${e.id}`; } })]))));
    } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const f = { nombre_comercial: "", razon_social: "", nit: "", propietario_nombre: "", propietario_usuario: "", propietario_clave: "" };
  const alta = () => formulario({ titulo: "Nueva empresa", textoBoton: "Crear empresa", campos: [
    campo("Nombre comercial", input({ "aria-label": "Nombre comercial", maxlength: 120, oninput: (x) => { f.nombre_comercial = x.target.value; } })),
    campo("Razón social", input({ "aria-label": "Razón social", maxlength: 200, oninput: (x) => { f.razon_social = x.target.value; } })),
    campo("NIT", input({ "aria-label": "NIT", maxlength: 20, oninput: (x) => { f.nit = x.target.value; } }), { ayuda: "Ficticio en la demostración." }),
    h("p", { class: "mut" }, "Persona propietaria (tendrá acceso con su usuario y contraseña):"),
    campo("Nombre del propietario", input({ "aria-label": "Nombre del propietario", maxlength: 80, oninput: (x) => { f.propietario_nombre = x.target.value; } })),
    h("div", { class: "grid2" }, campo("Usuario", input({ "aria-label": "Usuario del propietario", maxlength: 20, autocapitalize: "none", oninput: (x) => { f.propietario_usuario = x.target.value; } })),
      campo("Contraseña (8 o más)", input({ "aria-label": "Contraseña del propietario", type: "password", maxlength: 80, autocomplete: "new-password", oninput: (x) => { f.propietario_clave = x.target.value; } })))],
    accion: async () => { const r = await api.pl.crearEmpresa(f); toast(r.aviso); await cargar(); } });
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "building", titulo: "Empresas", subtitulo: "Alta, plan, saldo y consumo de cada empresa.", accion: boton("Nueva empresa", { icon: "plus", id: "nueva-empresa", onclick: alta }) }), cuerpo);
}

// ------------------------------------------------------------------ detalle de una empresa
export function pantallaEmpresa(ctx, id) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando…")), acciones = h("div", { class: "acciones-fila" });
  let planes = null, resumen = null;
  async function cargar() {
    try {
      [resumen, planes] = await Promise.all([api.pl.resumen(), planes ?? api.pl.planes()]); const e = resumen.empresas.find((x) => x.id === id);
      if (!e) { poner(cuerpo, vacio("building", "Empresa no encontrada", "Vuelve al listado.")); return; }
      const p = await api.pl.empresaPlan(id);
      poner(acciones,
        boton("Asignar plan", { tipo: "sec", icon: "package", id: "asignar-plan", onclick: asignar }), boton("Registrar pago (simulado)", { tipo: "sec", icon: "plus", id: "registrar-pago", onclick: pago }),
        boton("Generar cobro", { tipo: "sec", icon: "file", id: "generar-cobro", onclick: cobro }),
        boton(e.estado === "habilitada" ? "Suspender empresa" : "Habilitar empresa", { tipo: "peligro", id: "estado-empresa", onclick: () => estado(e) }));
      poner(cuerpo, h("div", { class: "card" }, h("h2", { class: "card-t" }, e.nombre_comercial), h("p", { class: "mut" }, `${e.razon_social} · NIT ${e.nit} · `, insignia(...(ESTADO_EMP[e.estado] ?? [e.estado, "gris"]))), acciones), vistaPlan(p, { maestro: true }));
    } catch (x) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(x))); }
  }
  const asignar = () => {
    const vers = planes.versiones; let sel = vers[0]?.id;
    formulario({ titulo: "Asignar plan", textoBoton: "Asignar", campos: [campo("Plan y versión", h("select", { "aria-label": "Plan y versión", onchange: (x) => { sel = x.target.value; } },
      ...vers.map((v) => h("option", { value: v.id }, `${v.plan_codigo} · v${v.version} · ${MODALIDAD[planes.planes.find((p) => p.codigo === v.plan_codigo)?.modalidad]} (desde ${fechaCorta(v.vigente_desde)})`))), { ayuda: "El contrato anterior se cierra; las tarifas ya cobradas no cambian." })],
      accion: async () => { await api.pl.contrato(id, sel); toast("Plan asignado"); await cargar(); } });
  };
  const pago = () => { const f = { monto: "", referencia: "", clave: claveNueva() };
    formulario({ titulo: "Registrar pago (simulado)", textoBoton: "Registrar", campos: [h("p", { class: "aviso aviso-ambar" }, icono("lock"), h("span", {}, "Pago SIMULADO: no hay pasarela ni cobro real.")),
      campo("Monto (Q)", input({ "aria-label": "Monto", inputmode: "decimal", placeholder: "100.00", oninput: (x) => { f.monto = x.target.value; } })),
      campo("Referencia del pago", input({ "aria-label": "Referencia del pago", maxlength: 120, oninput: (x) => { f.referencia = x.target.value; } }), { ayuda: "Una referencia no se puede usar dos veces." })],
      accion: async () => { await api.pl.pago(id, f.monto, f.referencia, f.clave); toast("Pago registrado (simulado)"); await cargar(); } }); };
  const cobro = () => formulario({ titulo: "Generar cobro del periodo", textoBoton: "Generar", campos: [h("p", { class: "mut" }, "Agrupa los cargos pendientes del periodo en un cobro (monto neto). NEXA no calcula impuestos de sus propias facturas: tras emitir el documento fuera de este sistema, registra su referencia y su total.")],
    accion: async () => { const c = await api.pl.cobroGenerar(id); toast(`Cobro ${c.estado}: ${quetzales(c.monto_neto)}`); if (c.estado === "borrador") emitir(c); await cargar(); } });
  const emitir = (c) => { const f = { ref: "", total: "" };
    formulario({ titulo: "Registrar el documento del cobro", textoBoton: "Registrar", campos: [campo("Referencia del documento emitido", input({ "aria-label": "Referencia del documento", maxlength: 120, oninput: (x) => { f.ref = x.target.value; } })),
      campo(`Total del documento (neto ${quetzales(c.monto_neto)})`, input({ "aria-label": "Total del documento", inputmode: "decimal", oninput: (x) => { f.total = x.target.value; } }))],
      accion: async () => { await api.pl.cobroEmitir(c.id, f.ref, f.total); toast("Cobro emitido"); await cargar(); } }); };
  const estado = (e) => { const f = { motivo: "" }; const nuevo = e.estado === "habilitada" ? "suspendida" : "habilitada";
    formulario({ titulo: nuevo === "suspendida" ? "Suspender empresa" : "Habilitar empresa", textoBoton: "Confirmar", campos: [campo("Motivo (mínimo 5 caracteres)", input({ "aria-label": "Motivo", maxlength: 300, oninput: (x) => { f.motivo = x.target.value; } }))],
      accion: async () => { await api.pl.estadoEmpresa(id, nuevo, f.motivo); toast("Estado actualizado"); await cargar(); } }); };
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "building", titulo: "Empresa", subtitulo: "Plan, pagos, consumo y cobros.", accion: h("a", { class: "btn btn-sec", href: "#/" }, "Volver") }), cuerpo);
}

// ------------------------------------------------------------------ planes
export function pantallaPlanes(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando…"));
  let datos = null;
  async function cargar() {
    try {
      datos = await api.pl.planes();
      poner(cuerpo, ...datos.planes.map((pl) => h("div", { class: "card", "data-plan": pl.codigo }, h("div", { class: "barra" }, h("div", {}, h("h2", { class: "card-t" }, pl.nombre), h("small", { class: "mut" }, `${pl.codigo} · ${MODALIDAD[pl.modalidad]}`)),
        boton("Nueva versión", { tipo: "sec", icon: "plus", "data-nueva-version": pl.codigo, onclick: () => version(pl) })),
        tablaSimple([["Versión"], ["Desde"], ["Cuota fija", "der"], ["Incluidas", "der"], ["Sobregiro"], ["Tarifas"]], datos.versiones.filter((v) => v.plan_codigo === pl.codigo).map((v) => [`v${v.version}`, fechaCorta(v.vigente_desde), quetzales(v.cuota_fija), num(v.unidades_incluidas), v.permite_sobregiro ? `hasta ${quetzales(v.limite_sobregiro)}` : "No",
          (v.tarifas ?? []).map((t) => `${t.evento}: ${t.cargable ? quetzales(t.precio) : "no se cobra"}`).join(" · ")])))));
    } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const nuevoPlan = () => { const f = { codigo: "", nombre: "", modalidad: "prepago" };
    formulario({ titulo: "Nuevo plan", textoBoton: "Crear plan", campos: [campo("Código", input({ "aria-label": "Código del plan", maxlength: 40, autocapitalize: "none", oninput: (x) => { f.codigo = x.target.value; } }), { ayuda: "Minúsculas, números y guion bajo." }),
      campo("Nombre", input({ "aria-label": "Nombre del plan", maxlength: 80, oninput: (x) => { f.nombre = x.target.value; } })),
      campo("Modalidad", h("select", { "aria-label": "Modalidad", onchange: (x) => { f.modalidad = x.target.value; } }, ...Object.entries(MODALIDAD).map(([v, t]) => h("option", { value: v }, t))))],
      accion: async () => { await api.pl.crearPlan(f); toast("Plan creado"); await cargar(); } }); };
  const version = (pl) => {
    const f = { cuota_fija: "0", unidades_incluidas: "0", permite_sobregiro: false, limite_sobregiro: "0" }, tar = {}; const eventos = ["certificacion", "anulacion", "rechazo_proveedor", "consulta"].filter((e) => datos.eventos.some((x) => x.codigo === e));
    for (const e of eventos) tar[e] = { precio: e === "certificacion" ? "2.50" : "0", cargable: e === "certificacion" };
    formulario({ titulo: `Nueva versión de ${pl.nombre}`, textoBoton: "Crear versión", campos: [h("p", { class: "mut" }, "Las versiones no se modifican: una versión nueva rige desde hoy y no cambia lo ya cobrado."),
      h("div", { class: "grid2" }, campo("Cuota fija (Q)", input({ "aria-label": "Cuota fija", inputmode: "decimal", value: "0", oninput: (x) => { f.cuota_fija = x.target.value; } })), campo("Unidades incluidas", input({ "aria-label": "Unidades incluidas", inputmode: "decimal", value: "0", oninput: (x) => { f.unidades_incluidas = x.target.value; } }))),
      h("label", { class: "login-recordar" }, input({ type: "checkbox", "aria-label": "Permite sobregiro", onchange: (x) => { f.permite_sobregiro = x.target.checked; } }), h("span", {}, "Permite sobregiro")),
      campo("Límite de sobregiro (Q)", input({ "aria-label": "Límite de sobregiro", inputmode: "decimal", value: "0", oninput: (x) => { f.limite_sobregiro = x.target.value; } })),
      h("p", { class: "mut" }, "Tarifas por evento (lo que se cobra al cliente por unidad):"),
      ...eventos.map((e) => h("div", { class: "grid2" }, campo(`Precio · ${e}`, input({ "aria-label": `Precio de ${e}`, inputmode: "decimal", value: tar[e].precio, oninput: (x) => { tar[e].precio = x.target.value; } })),
        h("label", { class: "login-recordar" }, input({ type: "checkbox", checked: tar[e].cargable, "aria-label": `Se cobra ${e}`, onchange: (x) => { tar[e].cargable = x.target.checked; } }), h("span", {}, "Se cobra"))))],
      accion: async () => { await api.pl.crearVersion(pl.codigo, { ...f, tarifas: eventos.map((e) => ({ evento: e, precio: tar[e].cargable ? tar[e].precio : "0", cargable: tar[e].cargable })) }); toast("Versión creada"); await cargar(); } });
  };
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "package", titulo: "Planes y tarifas", subtitulo: "Catálogo comercial versionado. Una versión nunca se edita.", accion: boton("Nuevo plan", { icon: "plus", id: "nuevo-plan", onclick: nuevoPlan }) }), cuerpo);
}

// ------------------------------------------------------------------ bolsón global
export function pantallaBolson(ctx) {
  const cuerpo = h("div", { class: "plan-col" }, h("p", { class: "cargando" }, "Cargando…"));
  async function cargar() {
    try {
      const b = await api.pl.bolson(); const suma = (k) => b.cuentas.reduce((s, x) => s + Number(x[k]), 0), cuenta = b.cuentas.length ? { disponible: suma("disponible"), reservado: suma("reservado"), consumido: suma("consumido") } : null;
      poner(cuerpo,
        h("div", { class: "indicadores" }, ...[["package", cuenta ? num(cuenta.disponible) : "—", "Unidades disponibles", "azul"], ["lock", cuenta ? num(cuenta.reservado) : "—", "Retenidas por operaciones abiertas", "ambar"], ["file", cuenta ? num(cuenta.consumido) : "—", "Consumidas", "lila"],
          ["circleCheck", b.verificacion.fallos === 0 ? "Coherente" : `${b.verificacion.fallos} fallos`, "Saldos vs. libros", "azul"]].map(([ik, v, et, t]) => h("div", { class: `indicador ind-${t}` }, h("span", { class: "ind-ik" }, icono(ik)), h("div", {}, h("strong", { class: "num" }, v), h("small", {}, et))))),
        h("p", { class: "aviso aviso-ambar" }, icono("lock"), h("span", {}, `Bolsones SIMULADOS (sin conexión con ningún certificador real): ${b.simuladores.map((s) => `${s.nombre}: ${s.certificaciones} certificaciones simuladas, saldo que informa el simulador ${num(s.saldo_reportado)}`).join(" · ")}.`)),
        h("div", { class: "card", "data-panel": "bolson-cuentas" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Cuentas de los certificadores")),
          tablaSimple([["Certificador"], ["Ambiente"], ["Referencia"], ["Costo por unidad", "der"], ["Comprado", "der"], ["Consumido", "der"], ["Retenido", "der"], ["Disponible", "der"], [""]], b.cuentas.map((c) => [c.certificador_nombre, insignia(c.ambiente === "simulado" ? "Simulado" : c.ambiente, "ambar"), c.referencia_externa, c.costo_unitario ? quetzales(c.costo_unitario) : "—", num(c.comprado), num(c.consumido), num(c.reservado), num(c.disponible), boton("Registrar lote", { tipo: "sec", icon: "plus", "data-lote": c.proveedor_id, onclick: () => lote(c) })]))),
        h("div", { class: "card", "data-panel": "bolson-empresas" }, h("h2", { class: "card-t" }, "Consumo, cobro y costo por empresa y certificador"), tablaSimple([["Empresa"], ["Certificador"], ["Confirmados", "der"], ["Retenidos", "der"], ["Unidades", "der"], ["Cobrado al cliente", "der"], ["Costo estimado", "der"], ["Margen", "der"]], b.porEmpresa.map((e) => [e.nombre_comercial, e.certificador_nombre ?? "—", String(e.confirmados), String(e.reservados), num(e.unidades), quetzales(e.cargado), quetzales(e.costo_estimado), quetzales(String(Number(e.cargado) - Number(e.costo_estimado)))])),
          h("p", { class: "mut" }, "Costo estimado = unidades consumidas × costo por unidad de los lotes comprados a ese certificador (aproximación de la demostración). El cobro al cliente sale de su plan, no del costo.")),
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Reglas de consumo vigentes"), tablaSimple([["Evento"], ["¿Consume?"], ["Unidades", "der"]], b.reglas.map((r) => [r.evento_tipo, r.consume === "no" ? "No" : r.consume === "si" ? "Sí" : r.consume, num(r.unidades)])),
          h("p", { class: "mut" }, "Todo evento sin regla se trata como que consume (prudencia). Las reglas reales de Digifact se cargarán con su documentación oficial.")),
        h("div", { class: "card", "data-panel": "bolson-lotes" }, h("h2", { class: "card-t" }, "Lotes comprados"), tablaSimple([["Fecha"], ["Referencia"], ["Unidades", "der"], ["Costo", "der"]], b.lotes.map((l) => [fechaHora(l.registrado_en), l.referencia_proveedor, num(l.unidades), quetzales(l.costo_total)]))),
        h("div", { class: "card", "data-panel": "bolson-alertas" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Alertas"), boton("Revisar ahora", { tipo: "sec", id: "revisar-bolson", onclick: async () => { try { await api.pl.revisar(); toast("Revisión hecha"); await cargar(); } catch (e) { toast(mensajeError(e), "error"); } } })),
          b.alertas.length ? tablaSimple([["Fecha"], ["Tipo"], ["Empresa"], ["Estado"], [""]], b.alertas.map((a) => [fechaHora(a.creada_en), a.tipo.replaceAll("_", " "), a.nombre_comercial ?? "—", a.resuelta_en ? insignia("Resuelta", "verde") : insignia("Abierta", "rojo"),
            a.resuelta_en ? "" : boton("Resolver", { tipo: "sec", "data-alerta": a.tipo, onclick: async () => { const n = await pedirMotivo({ titulo: "Resolver la alerta", texto: "Anota qué se hizo (mínimo 5 caracteres).", confirmar: "Resolver" }); if (n) { try { await api.pl.resolverAlerta(a.id, n); toast("Alerta resuelta"); await cargar(); } catch (e) { toast(mensajeError(e), "error"); } } } })])) : h("p", { class: "mut" }, "Sin alertas.")));
      const cc = await api.pl.conciliaciones(); cuerpo.append(tarjetaConciliacion(b, cc));
    } catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const CLASE = { coincide: ["Coincide", "verde"], faltante_en_nexa: ["El proveedor cobró y NEXA no lo midió", "rojo"], sobrante_en_nexa: ["NEXA lo midió y el proveedor no lo informa", "ambar"], diferencia_unidades: ["Diferencia de unidades", "ambar"] };
  const ACCION = { ajustar_saldo: "Ajuste de saldo", atribuir_empresa: "Consumo extraordinario atribuido", justificar: "Justificada sin ajuste" };
  function tarjetaConciliacion(b, cc) {
    const nom = (id) => cc.nombres[id] ?? "otra persona", act = async (f, ok) => { try { await f(); if (ok) toast(ok); await cargar(); } catch (e) { toast(mensajeError(e), "error"); } };
    const resolver = (pa) => { const f = { accion: pa.clasificacion === "faltante_en_nexa" ? "atribuir_empresa" : "ajustar_saldo", empresa: cc.empresas[0]?.id, motivo: "" };
      const selE = h("select", { "aria-label": "Empresa a la que se atribuye", onchange: (x) => { f.empresa = x.target.value; } }, ...cc.empresas.map((e) => h("option", { value: e.id }, e.nombre_comercial))); const campoE = campo("Empresa", selE); campoE.hidden = f.accion !== "atribuir_empresa";
      const opciones = [["ajustar_saldo", "Ajustar el saldo de NEXA al del proveedor"], ...(pa.clasificacion !== "sobrante_en_nexa" ? [["atribuir_empresa", "Atribuir a una empresa (consumo extraordinario)"]] : []), ["justificar", "Justificar sin ajustar"]];
      formulario({ titulo: `Resolver ${pa.referencia ?? "partida"}`, textoBoton: "Resolver", campos: [h("p", { class: "mut" }, `${CLASE[pa.clasificacion][0]}: extracto ${num(pa.unidades_extracto)} · NEXA ${num(pa.unidades_nexa)}. Una partida se resuelve una sola vez y deja un movimiento en el libro.`),
        campo("Qué hacer", h("select", { "aria-label": "Acción", onchange: (x) => { f.accion = x.target.value; campoE.hidden = f.accion !== "atribuir_empresa"; } }, ...opciones.map(([v, t]) => h("option", { value: v, selected: v === f.accion }, t)))), campoE,
        campo("Motivo (mínimo 10 caracteres)", input({ "aria-label": "Motivo de la resolución", maxlength: 300, oninput: (x) => { f.motivo = x.target.value; } }))],
        accion: async () => { await api.pl.resolverPartida(pa.id, f.accion, f.accion === "atribuir_empresa" ? f.empresa : undefined, f.motivo); toast("Partida resuelta"); await cargar(); } }); };
    const concs = cc.conciliaciones.map((c) => {
      const ps = cc.partidas.filter((x) => x.conciliacion_id === c.id), mia = c.propuesta_por === cc.yo, r = c.resumen ?? {};
      const [et, tono] = { propuesta: ["Propuesta", "ambar"], aprobada: ["Aprobada", "verde"], rechazada: ["Rechazada", "rojo"] }[c.estado];
      return h("div", { class: "op", "data-conciliacion": c.estado }, h("div", { class: "barra" }, h("strong", {}, `Conciliación · ${fechaHora(c.propuesta_en)}`), insignia(et, tono)),
        h("p", { class: "mut" }, `Proveedor: ${num(r.unidades_extracto)} unidades · NEXA: ${num(r.unidades_nexa)} · coinciden ${r.coinciden} · diferencias ${r.faltantes_en_nexa + r.sobrantes_en_nexa + r.diferencias_unidades} · propuesta de ${nom(c.propuesta_por)}${c.decidida_por ? ` · ${c.estado} por ${nom(c.decidida_por)}` : ""}`),
        c.estado === "propuesta" ? h("div", { class: "acciones-fila" }, boton("Aprobar", { id: "aprobar-conciliacion", icon: "check", disabled: mia, title: mia ? "La decide otra persona: entra como Nora Maestra" : null, onclick: async () => { const n = await pedirMotivo({ titulo: "Aprobar la conciliación", texto: "Escribe la nota de revisión.", confirmar: "Aprobar" }); if (n) act(() => api.pl.decidir(c.id, true, n), "Conciliación aprobada"); } }),
          boton("Rechazar", { tipo: "peligro", disabled: mia, onclick: async () => { const n = await pedirMotivo({ titulo: "Rechazar la conciliación", texto: "Escribe el motivo.", confirmar: "Rechazar" }); if (n) act(() => api.pl.decidir(c.id, false, n), "Conciliación rechazada"); } }), mia ? h("small", { class: "mut" }, "La decide otra persona: entra como Nora Maestra (usuario maestro2).") : null) : null,
        tablaSimple([["Referencia"], ["Situación"], ["Empresa"], ["Extracto", "der"], ["NEXA", "der"], ["Resolución"]], ps.filter((x) => x.clasificacion !== "coincide").map((x) => [x.referencia ?? "—", insignia(...CLASE[x.clasificacion]), x.nombre_comercial ?? "—", num(x.unidades_extracto), num(x.unidades_nexa),
          x.accion ? `${ACCION[x.accion]}${x.resolucion_empresa ? ` · ${x.resolucion_empresa}` : ""}` : c.estado === "aprobada" ? boton("Resolver", { tipo: "sec", "data-resolver": x.referencia ?? "", onclick: () => resolver(x) }) : "Pendiente"]), "Sin diferencias: todo coincide."));
    });
    return h("div", { class: "card", "data-panel": "conciliacion-bolson" }, h("div", { class: "barra" }, h("h2", { class: "card-t" }, "Conciliación con el proveedor"),
      h("div", { class: "acciones-fila" }, ...b.cuentas.map((c) => boton(`Importar extracto de ${b.simuladores.find((s) => s.id === c.proveedor_id)?.nombre ?? c.proveedor_id}`, { icon: "file", id: `importar-extracto-${c.proveedor_id}`, onclick: () => act(() => api.pl.importarExtracto(c.id), "Extracto importado") })))),
      h("p", { class: "mut" }, "Compara lo que informa el proveedor con lo que midió NEXA. Las diferencias no se corrigen solas: una persona propone, OTRA aprueba y cada resolución deja un ajuste auditable."),
      cc.extractos.length ? tablaSimple([["Extracto"], ["Líneas", "der"], ["Saldo del proveedor", "der"], [""]], cc.extractos.map((x) => [`${fechaCorta(x.periodo_desde)} – ${fechaCorta(x.periodo_hasta)}`, String(x.lineas), num(x.saldo_final),
        x.conciliacion_id ? insignia("Con conciliación", "gris") : boton("Proponer conciliación", { tipo: "sec", "data-extracto": x.id, onclick: () => act(() => api.pl.proponer(x.id), "Conciliación propuesta") })])) : h("p", { class: "mut" }, "Todavía no hay extractos."),
      ...concs,
      h("details", { class: "demo-controles" }, h("summary", {}, icono("shield"), h("strong", {}, " Controles de la demostración")), h("p", { class: "mut" }, "Reproducen lo que en la realidad hace el proveedor por su cuenta."),
        ...b.simuladores.map((s) => h("div", { class: "acciones-fila" }, h("strong", {}, s.nombre), boton("Consume por su cuenta", { tipo: "sec", id: `sim-ajeno-${s.id}`, onclick: () => act(() => api.pl.simulador("consumo_ajeno", s.id), "Consumo ajeno simulado") }), boton("No informa su último consumo", { tipo: "sec", id: `sim-omitir-${s.id}`, onclick: () => act(() => api.pl.simulador("omitir_ultimo", s.id), "Consumo omitido del reporte") })))));
  }
  const lote = (cuenta) => { const f = { unidades: "", costo: "0", ref: "" };
    formulario({ titulo: "Registrar lote comprado (simulado)", textoBoton: "Registrar", campos: [campo("Unidades", input({ "aria-label": "Unidades del lote", inputmode: "decimal", oninput: (x) => { f.unidades = x.target.value; } })), campo("Costo total (Q)", input({ "aria-label": "Costo del lote", inputmode: "decimal", value: "0", oninput: (x) => { f.costo = x.target.value; } })),
      campo("Referencia del proveedor", input({ "aria-label": "Referencia del lote", maxlength: 120, oninput: (x) => { f.ref = x.target.value; } }))],
      accion: async () => { await api.pl.lote(cuenta.id, f.unidades, f.costo, f.ref); toast("Lote registrado"); await cargar(); } }); };
  cargar();
  return h("section", { class: "pantalla" }, cabecera({ icon: "shield", titulo: "Bolsón global", subtitulo: "Unidades compradas al proveedor y su consumo por empresa. Solo la plataforma lo ve." }), cuerpo);
}
