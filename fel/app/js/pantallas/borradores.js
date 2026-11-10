import { h, boton, insignia, campo, toast, vacio, cabecera, quetzales, fechaLarga, pedirMotivo, mensajeError, poner } from "../ui.js";
import { icono } from "../icons.js";
import { calcular } from "../calculo.js";
import { PREPARACION, FISCAL, codigoBorrador } from "../formato.js";

const FILTROS = [["todos", "Todos"], ["borrador", "Borradores"], ["revisado", "Revisados"], ["archivado", "Archivados"]];

// ============================================================================ lista
export function pantallaBorradores(ctx) {
  const { api, empresa, tiene, ir } = ctx;
  const puedeCrear = tiene("borradores.crear");
  let filtro = "todos";
  const chips = h("div", { class: "chips", role: "tablist" });
  const lista = h("div", { class: "lista", "aria-live": "polite" });

  function pintarChips() {
    poner(chips, ...FILTROS.map(([v, t]) => h("button", { type: "button", role: "tab", "aria-selected": String(filtro === v), class: `chip${filtro === v ? " on" : ""}`, onclick: () => { filtro = v; pintarChips(); cargar(); } }, t)));
  }
  async function cargar() {
    try {
      const todos = await api.listarDocumentos(empresa.id);
      const datos = todos.filter((d) => filtro === "todos" || d.estado_preparacion === filtro);
      poner(lista, ...(datos.length ? [
        h("div", { class: "fila fila-cab fila-doc", "aria-hidden": "true" }, h("span", {}, "Borrador"), h("span", {}, "Cliente"), h("span", {}, "Fecha prevista"), h("span", { class: "der" }, "Base imponible"), h("span", {}, "Estado"), h("span", {})),
        ...datos.map(fila)] : [vacio("file", "No hay borradores", filtro === "todos" ? "Crea un borrador para preparar un documento. No se certifica nada." : "No hay documentos en este estado.",
          puedeCrear && filtro === "todos" ? boton("Nuevo borrador", { icon: "plus", onclick: () => ir("/borradores/nuevo") }) : null)]));
    } catch (e) { poner(lista, h("p", { class: "err", role: "alert" }, mensajeError(e))); }
  }
  const fila = (d) => {
    const [pt, ptono] = PREPARACION[d.estado_preparacion];
    const [ft, ftono] = FISCAL[d.estado_fiscal];
    return h("a", { class: "fila fila-doc fila-link", href: `#/borradores/${d.id}`, "aria-label": `Abrir ${codigoBorrador(d.numero_borrador)}` },
      h("div", { class: "celda celda-main", "data-et": "Borrador" }, h("strong", { class: "mono" }, codigoBorrador(d.numero_borrador)), h("small", {}, "Número interno · no fiscal")),
      h("div", { class: "celda", "data-et": "Cliente" }, d.cliente_snapshot ? [h("span", {}, d.cliente_snapshot.nombre), h("small", { class: "mono" }, d.cliente_snapshot.tipo_identificacion === "CF" ? "CF" : `${d.cliente_snapshot.tipo_identificacion} ${d.cliente_snapshot.numero_identificacion}`)] : h("span", { class: "mut" }, "Sin cliente")),
      h("div", { class: "celda", "data-et": "Fecha prevista" }, fechaLarga(d.fecha_emision_prevista)),
      h("div", { class: "celda der num", "data-et": "Base imponible" }, quetzales(d.base_imponible)),
      h("div", { class: "celda celda-tags", "data-et": "Estado" }, insignia(pt, ptono), d.estado_fiscal !== "ninguno" ? insignia(ft, ftono) : null),
      h("div", { class: "celda celda-ac" }, icono("eye")));
  };

  pintarChips(); cargar();
  return h("section", { class: "pantalla" },
    cabecera({ icon: "file", titulo: "Borradores", subtitulo: "Prepara documentos. Un borrador no es una factura ni se envía a SAT.", accion: puedeCrear ? boton("Nuevo borrador", { icon: "plus", onclick: () => ir("/borradores/nuevo") }) : null }),
    h("div", { class: "barra" }, chips),
    h("p", { class: "aviso aviso-azul" }, icono("lock"), h("span", {}, "Vista previa NO certificada: sin serie, número ni autorización de SAT. La emisión real está bloqueada.")), lista);
}

// ============================================================================ editor
const vaciaLinea = () => ({ concepto_id: "", descripcion: "", cantidad: "1", precio_unitario: "", descuento_tipo: "ninguno", descuento_valor: "0" });
const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;

export function pantallaEditor(ctx, id) {
  const { api, empresa, tiene, ir } = ctx;
  const raiz = h("section", { class: "pantalla" }, h("p", { class: "mut" }, "Cargando…"));
  (async () => {
    try {
      const [clientes, conceptos, doc] = await Promise.all([
        tiene("clientes.ver") ? api.listarClientes(empresa.id, {}) : [], tiene("conceptos.ver") ? api.listarConceptos(empresa.id, {}) : [],
        id ? api.obtenerDocumento(empresa.id, id) : null]);
      poner(raiz, construir(clientes, conceptos, doc));
    } catch (e) { poner(raiz, h("p", { class: "err", role: "alert" }, mensajeError(e)), boton("Volver", { tipo: "sec", onclick: () => ir("/borradores") })); }
  })();
  return raiz;

  function construir(clientes, conceptos, doc0) {
    let doc = doc0 ?? { id: null, version: null, estado_preparacion: "borrador", estado_fiscal: "ninguno", numero_borrador: null, cliente_id: "", cliente_snapshot: null,
      fecha_emision_prevista: new Date().toISOString().slice(0, 10), observaciones: "", lineas: [vaciaLinea()] };
    let lineas = doc.lineas.map((l) => ({ concepto_id: l.concepto_id ?? "", descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) }));
    let sucio = !doc.id;
    const editable = () => doc.estado_preparacion === "borrador" && doc.estado_fiscal === "ninguno" && tiene(doc.id ? "borradores.editar" : "borradores.crear");

    const cuerpoLineas = h("div", { class: "lineas" });
    const totales = h("aside", { class: "totales" });
    const barra = h("div", { class: "barra-acciones" });
    const cab = h("div", { class: "doc-cab" });
    const err = h("p", { class: "err", role: "alert" });
    const selCliente = h("select", { "aria-label": "Cliente", onchange: (e) => { doc.cliente_id = e.target.value; sucio = true; pintarBarra(); } });
    const fecha = h("input", { type: "date", value: doc.fecha_emision_prevista ?? "", oninput: (e) => { doc.fecha_emision_prevista = e.target.value; sucio = true; pintarBarra(); } });
    const obs = h("textarea", { rows: 2, maxlength: 500, "aria-label": "Observaciones", oninput: (e) => { doc.observaciones = e.target.value; sucio = true; pintarBarra(); } }); obs.value = doc.observaciones ?? "";

    function pintarClientes() {
      const opciones = [h("option", { value: "" }, "Selecciona un cliente…"), ...clientes.map((c) => h("option", { value: c.id }, `${c.nombre} — ${c.tipo_identificacion === "CF" ? "CF" : `${c.tipo_identificacion} ${c.numero_identificacion}`}`))];
      if (doc.cliente_id && !clientes.some((c) => c.id === doc.cliente_id) && doc.cliente_snapshot) opciones.push(h("option", { value: doc.cliente_id }, `${doc.cliente_snapshot.nombre} (inactivo)`));
      poner(selCliente, ...opciones); selCliente.value = doc.cliente_id ?? "";
    }

    function pintarCab() {
      const [pt, ptono] = PREPARACION[doc.estado_preparacion];
      poner(cab, h("div", {}, h("h1", { class: "mono" }, doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "Nuevo borrador"), h("p", { class: "mut" }, "Número interno de borrador · no es un número fiscal")),
        h("div", { class: "celda-tags" }, insignia(pt, ptono), doc.estado_fiscal !== "ninguno" ? insignia(FISCAL[doc.estado_fiscal][0], FISCAL[doc.estado_fiscal][1]) : null));
    }

    function pintarLineas() {
      const ed = editable();
      const calc = calcularSeguro();
      const encabezado = h("div", { class: "lin lin-cab", "aria-hidden": "true" }, ["Concepto", "Descripción", "Cant.", "Precio (Q)", "Descuento", "", "Neto"].map((t) => h("span", {}, t)));
      const filas = lineas.map((l, i) => {
        const selC = h("select", { "aria-label": `Concepto de la línea ${i + 1}`, disabled: !ed, onchange: (e) => {
          const c = conceptos.find((x) => x.id === e.target.value); l.concepto_id = e.target.value;
          if (c) { l.descripcion = c.descripcion; l.precio_unitario = c.precio_unitario; }
          sucio = true; pintarLineas(); pintarBarra(); } },
          h("option", { value: "" }, "Línea libre"), ...conceptos.map((c) => h("option", { value: c.id }, `${c.codigo} · ${c.descripcion}`)));
        selC.value = l.concepto_id ?? "";
        const campoTxt = (k, et, extra = {}) => h("input", { value: l[k], "aria-label": `${et} de la línea ${i + 1}`, disabled: !ed, ...extra, oninput: (e) => { l[k] = e.target.value; sucio = true; refrescarTotales(); pintarBarra(); } });
        const dtipo = h("select", { "aria-label": `Tipo de descuento de la línea ${i + 1}`, disabled: !ed, onchange: (e) => { l.descuento_tipo = e.target.value; if (l.descuento_tipo === "ninguno") l.descuento_valor = "0"; sucio = true; pintarLineas(); pintarBarra(); } },
          [["ninguno", "Ninguno"], ["monto", "Monto Q"], ["porcentaje", "%"]].map(([v, t]) => h("option", { value: v, selected: l.descuento_tipo === v }, t)));
        return h("div", { class: "lin" },
          h("div", { class: "lin-c", "data-et": "Concepto" }, selC),
          h("div", { class: "lin-c", "data-et": "Descripción" }, campoTxt("descripcion", "Descripción", { maxlength: 300 })),
          h("div", { class: "lin-c", "data-et": "Cantidad" }, campoTxt("cantidad", "Cantidad", { inputmode: "decimal" })),
          h("div", { class: "lin-c", "data-et": "Precio" }, campoTxt("precio_unitario", "Precio", { inputmode: "decimal" })),
          h("div", { class: "lin-c", "data-et": "Descuento" }, dtipo),
          h("div", { class: "lin-c" }, l.descuento_tipo !== "ninguno" ? campoTxt("descuento_valor", "Valor del descuento", { inputmode: "decimal" }) : null),
          h("div", { class: "lin-c lin-neto num", "data-et": "Neto" }, calc.ok ? quetzales(calc.r.lineas[i]?.neto) : "—",
            ed && lineas.length > 1 ? h("button", { type: "button", class: "icon-btn", title: "Quitar línea", "aria-label": `Quitar la línea ${i + 1}`, onclick: () => { lineas.splice(i, 1); sucio = true; pintarLineas(); pintarBarra(); } }, icono("x")) : null));
      });
      poner(cuerpoLineas, encabezado, ...filas, ed ? boton("Agregar línea", { tipo: "sec", icon: "plus", onclick: () => { lineas.push(vaciaLinea()); sucio = true; pintarLineas(); pintarBarra(); } }) : null);
      pintarTotales(calc);
    }
    const refrescarTotales = () => { const calc = calcularSeguro(); pintarTotales(calc);
      cuerpoLineas.querySelectorAll(".lin-neto").forEach((el, i) => { const t = calc.ok ? quetzales(calc.r.lineas[i]?.neto) : "—"; el.firstChild.nodeValue = t; }); };

    function calcularSeguro() {
      for (const [i, l] of lineas.entries()) {
        if (l.cantidad.trim() === "" || l.precio_unitario.trim() === "") return { ok: false, suave: true, msg: "Completa la cantidad y el precio de cada línea para ver los importes." };
        if (!RE_MONTO.test(l.cantidad) || !RE_MONTO.test(l.precio_unitario)) return { ok: false, msg: `Línea ${i + 1}: cantidad y precio deben ser números no negativos con hasta 6 decimales.` };
        if (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor)) return { ok: false, msg: `Línea ${i + 1}: el descuento no es un número válido.` };
      }
      try { return { ok: true, r: calcular(lineas) }; } catch (e) { return { ok: false, msg: e.message }; }
    }

    function pintarTotales(calc) {
      const fila = (et, v, extra) => h("div", { class: `tot${extra ? " " + extra : ""}` }, h("span", {}, et), h("strong", { class: "num" }, v));
      poner(totales, ...[
        h("div", { class: "sello" }, icono("lock"), h("div", {}, h("strong", {}, "Vista previa NO certificada"), h("small", {}, "Sin serie, número ni autorización de SAT."))),
        ...(calc.ok ? [fila("Subtotal", quetzales(calc.r.subtotal)), fila("Descuentos", quetzales(calc.r.descuento_total)), fila("Base imponible", quetzales(calc.r.base_imponible), "tot-base")]
          : [h("p", { class: calc.suave ? "mut" : "err" }, calc.msg)]),
        h("div", { class: "pend" }, icono("info"), h("div", {}, h("strong", {}, "Impuestos y total: pendientes"), h("small", {}, "Se calcularán cuando exista un régimen fiscal verificado con tu contador. Hoy no se aplica ninguna tasa ni redondeo."))),
        h("dl", { class: "fiscales" }, ["Serie", "Número fiscal", "Autorización SAT"].flatMap((t) => [h("dt", {}, t), h("dd", { class: "mut" }, doc.serie && t === "Serie" ? doc.serie : "Vacío hasta confirmación verificable")])),
      ]);
    }

    function pintarBarra() {
      const prep = doc.estado_preparacion, ed = editable();
      const btns = [];
      btns.push(boton("Volver", { tipo: "sec", onclick: () => ir("/borradores") }));
      if (ed) btns.push(boton(doc.id ? "Guardar cambios" : "Guardar borrador", { icon: "check", onclick: guardar }));
      if (doc.id && prep === "borrador" && tiene("borradores.revisar")) btns.push(boton("Marcar como revisado", { tipo: "sec", icon: "circleCheck", disabled: sucio, title: sucio ? "Guarda los cambios antes de revisar" : null, onclick: () => cambiar("revisado") }));
      if (doc.id && prep === "revisado" && tiene("borradores.editar")) btns.push(boton("Volver a borrador", { tipo: "sec", icon: "undo", onclick: () => cambiar("borrador") }));
      if (doc.id && prep === "archivado" && tiene("borradores.editar")) btns.push(boton("Restaurar como borrador", { tipo: "sec", icon: "undo", onclick: () => cambiar("borrador") }));
      if (doc.id && prep !== "archivado" && doc.estado_fiscal === "ninguno" && tiene("borradores.archivar")) btns.push(boton("Archivar", { tipo: "peligro", icon: "archive", onclick: archivar }));
      poner(barra, sucio && doc.id ? h("span", { class: "sucio" }, "Cambios sin guardar") : null, ...btns);
    }

    async function guardar() {
      err.textContent = "";
      const calc = calcularSeguro(); if (!calc.ok) { err.textContent = calc.msg; return; }
      if (lineas.some((l) => !l.descripcion.trim())) { err.textContent = "Cada línea necesita una descripción."; return; }
      try {
        const r = await api.guardarDocumento(empresa.id, { id: doc.id, version: doc.version, cliente_id: doc.cliente_id, fecha_emision_prevista: doc.fecha_emision_prevista, observaciones: doc.observaciones, lineas });
        const nuevo = !doc.id; sucio = false; toast(`Borrador ${codigoBorrador(r.numero_borrador)} guardado`);
        if (nuevo) { ir(`/borradores/${r.id}`, { reemplazar: true }); return; }
        recargar();
      } catch (e) { err.textContent = mensajeError(e); if (e.codigo === "conflicto") err.append(" ", h("button", { type: "button", class: "link", onclick: recargar }, "Recargar")); }
    }
    async function recargar() { doc = await api.obtenerDocumento(empresa.id, doc.id); lineas = doc.lineas.map((l) => ({ concepto_id: l.concepto_id ?? "", descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) })); todo(); }
    async function cambiar(estado, motivo) {
      err.textContent = "";
      try { await api.cambiarPreparacion(empresa.id, doc.id, estado, motivo, doc.version); toast(estado === "revisado" ? "Marcado como revisado" : estado === "archivado" ? "Borrador archivado" : "Vuelve a ser borrador"); await recargar(); }
      catch (e) { err.textContent = mensajeError(e); }
    }
    async function archivar() {
      const m = await pedirMotivo({ titulo: "Archivar borrador", texto: "Archivar es una decisión interna: el borrador deja de estar activo. No es una anulación fiscal.", confirmar: "Archivar" });
      if (m) cambiar("archivado", m);
    }

    function todo() {
      pintarCab(); pintarClientes(); fecha.value = doc.fecha_emision_prevista ?? ""; obs.value = doc.observaciones ?? "";
      for (const c of [selCliente, fecha, obs]) c.disabled = !editable();
      pintarLineas(); pintarBarra();
    }
    todo();
    return h("div", {}, cab,
      !editable() && doc.id ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, doc.estado_preparacion === "borrador" ? "Tu rol no permite editar este borrador." : "Este documento no se puede editar en su estado actual. Vuélvelo a borrador para modificarlo.")) : null,
      h("div", { class: "doc-grid" }, h("div", { class: "doc-main" },
        h("div", { class: "card" }, h("div", { class: "grid2" }, campo("Cliente", selCliente), campo("Fecha prevista de emisión", fecha)), campo("Observaciones", obs)),
        h("div", { class: "card" }, h("h2", { class: "card-t" }, "Detalle"), cuerpoLineas), err), totales), barra);
  }
}
