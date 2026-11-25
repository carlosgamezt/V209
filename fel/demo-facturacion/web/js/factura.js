// Crear, editar, revisar y procesar UNA factura simulada. El cálculo local es solo una vista previa: el servidor recalcula siempre.
// UNA sola pantalla: receptor y establecimiento, ítems como filas compactas (se editan en una hoja, ver item_editor.js), resumen y una barra con la acción principal + «Más acciones».
import { h, boton, insignia, campo, toast, quetzales, mensajeError, pedirMotivo, poner, modal } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { calcular, aInterno } from "/app/js/calculo.js";
import { PREPARACION, FISCAL, codigoBorrador } from "/app/js/formato.js";
import { api } from "./api.js";
import { vistaPrevia } from "./vista_previa.js";
import { ivaIncluido } from "./iva.js";
import { panelProceso } from "./proceso.js";
import { editarItem, problemaLinea, resumenLinea, RE_MONTO, lineaVacia } from "./item_editor.js";
import { selectorTipo, panelTipo, problemasTipo, tipoInicial, aplicarTipo, tipoPorCodigo, tituloDocumento } from "./tipos.js";
import { crearAutollenado, textoEstado, ETIQUETAS, RE_CUI, RE_NIT, normalizarCui, normalizarId } from "./receptor_nit.js";
/** Etiqueta del origen del nombre (Digifact TEST / simulado / manual / consumidor final). */
const pintarEtiqueta = (el, t) => { if (!el) return; el.hidden = !t; el.textContent = t ? ETIQUETAS[t] : ""; el.className = `nit-etiqueta${t ? ` nit-et-${t}` : ""}`; };

// Fecha de emisión: el servidor dice qué día es hoy en Guatemala y hasta cuántos días atrás se admite (api.ventanaFecha). Si no responde, se calcula con la zona de Guatemala (NUNCA con UTC: desde las 18:00 de Guatemala, UTC ya marca el día siguiente).
const hoyGuatemala = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumarDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const ventanaLocal = () => { const hoy = hoyGuatemala(); return { hoy, minima: sumarDias(hoy, -5), maxDias: 5 }; };
const dmy = (iso) => String(iso ?? "").slice(0, 10).split("-").reverse().join("/");
/** Problema de la fecha de emisión frente a la ventana, o "" si está bien. La regla definitiva la aplica el servidor. */
const problemaFecha = (f, v) => !f ? "Indica la fecha de emisión." : f > v.hoy ? `La fecha de emisión no puede ser futura (hoy es ${dmy(v.hoy)}).` : f < v.minima ? `La fecha de emisión no puede ser anterior al ${dmy(v.minima)} (hasta ${v.maxDias} días atrás desde hoy).` : "";

const TOPE_CF = "2500";   // SAT: «Consumidor final» solo en facturas por montos MENORES a Q2,500.00 (Reglamento de la Ley del IVA, art. 30 núm. 9, reformado por el Acuerdo Gubernativo 12-2023; preguntas frecuentes del portal SAT)
const MENSAJE_TOPE_CF = "Consumidor final solo se admite en facturas menores a Q2,500.00. Identifica al receptor con su NIT (o con su CUI si es persona individual sin NIT).";

// Tras guardar un documento NUEVO la pantalla se reconstruye con su id: estas banderas continúan lo que la persona pidió (abrir la vista previa, o certificar en TEST).
let previaPendiente = null, certificarPendiente = null;
const CONFIRMACION_TEST = "CERTIFICAR-TEST";

export function pantallaFactura(ctx, id) {
  const raiz = h("section", { class: "pantalla" }, h("p", { class: "mut" }, "Cargando…"));
  (async () => {
    try { const tipos = await api.tiposDocumento(); ctx.tiposDoc = tipos; const ventana = await api.ventanaFecha().catch(() => null), dg = await api.digifactEstado().catch(() => null); poner(raiz, construir(id ? await api.documento(id) : null, tipos, ventana, dg)); }
    catch (e) { poner(raiz, h("p", { class: "err", role: "alert" }, mensajeError(e)), boton("Volver", { tipo: "sec", onclick: () => ctx.ir("/") })); }
  })();
  return raiz;

  function construir(det, tipos, ventana, dg) {
    const est = ctx.estado;
    let VEN = ventana && ventana.hoy ? ventana : ventanaLocal();
    let d = det, doc = det?.documento ?? { id: null, version: null, estado_preparacion: "borrador", estado_fiscal: "ninguno" };
    const inicial = () => ({
      cliente_id: doc.cliente_id ?? "", nuevo: false, tipo: "NIT", numero: "", nombre: "", establecimiento_id: doc.establecimiento_id ?? "",
      fecha: doc.fecha_emision_prevista ? String(doc.fecha_emision_prevista).slice(0, 10) : VEN.hoy, observaciones: doc.observaciones ?? "",
      ...tipoInicial(tipos, det?.documento),
      lineas: d?.lineas?.length ? d.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento_tipo: l.descuento_tipo, descuento_valor: String(l.descuento_valor) })) : [],
    });
    let f = inicial(), sucio = !doc.id, intentoGuardar = false;
    let ctrl = null, ctrlModelo = null; const nit = {};   // autollenado del receptor nuevo (un controlador por modelo) y referencias vivas a sus campos
    const tipoActual = () => tipoPorCodigo(tipos, f.tipo_dte), esNota = () => !!tipoActual()?.requiere_origen;
    const editable = () => doc.estado_preparacion === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene(doc.id ? "borradores.editar" : "borradores.crear");

    const cardDatos = h("div", { class: "card card-datos" }), cardItems = h("div", { class: "card card-items" });
    const cab = h("div", { class: "doc-cab" }), err = h("p", { class: "err area-msg", role: "alert" });
    const cuerpoReceptor = h("div", { class: "form" }), cuerpoLineas = h("div", { class: "lineas-d" }), totales = h("aside", { class: "totales" }), barra = h("div", { class: "barra-acciones" }), proceso = h("div", { class: "area-proceso" });

    // ---------------------------------------------------------------- validación local (vista previa; el servidor y la base vuelven a validar)
    function problemas() {
      const p = [];
      p.push(...problemasTipo(f, tipos, { receptorCF: f.nuevo ? f.tipo === "CF" : est.clientes.find((x) => x.id === f.cliente_id)?.tipo_identificacion === "CF", base: (() => { const c0 = calcularSeguro(); return c0.ok ? c0.r.base_imponible : null; })() }));
      if (!f.nuevo && !f.cliente_id) p.push(esNota() ? "Elige el documento de origen: la nota se dirige a su mismo receptor." : "Indica el receptor: escribe su NIT o CUI, o elige CF.");
      if (f.nuevo && f.tipo !== "CF" && !f.numero.trim()) p.push("Escribe la identificación del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !f.nombre.trim()) p.push("Escribe el nombre del receptor.");
      if (f.nuevo && f.tipo !== "CF" && !/^[0-9A-Za-z-]{1,30}$/.test(f.numero.trim())) p.push("La identificación solo admite letras, números y guion (máximo 30).");
      if (f.nuevo && f.tipo === "CUI" && f.numero.trim() && !RE_CUI.test(normalizarCui(f.numero))) p.push("El CUI debe tener 13 dígitos (solo números).");
      if (!f.establecimiento_id) p.push("Elige el establecimiento.");
      { const pf = problemaFecha(f.fecha, VEN); if (pf) p.push(pf); }
      if (!f.lineas.length) p.push("Agrega al menos un ítem.");
      f.lineas.forEach((l, i) => { const x = problemaLinea(l, i + 1); if (x) p.push(x.msg); });
      const c = calcularSeguro(); if (!c.ok && c.msg && !p.length) p.push(c.msg);
      const esCf = f.nuevo ? f.tipo === "CF" : est.clientes.find((x) => x.id === f.cliente_id)?.tipo_identificacion === "CF";
      if (esCf && f.tipo_dte === "FACT" && c.ok && aInterno(c.r.base_imponible) >= aInterno(TOPE_CF)) p.push(MENSAJE_TOPE_CF);
      return p;
    }
    function calcularSeguro() {
      if (!f.lineas.length) return { ok: false, vacio: true, msg: "Agrega al menos un ítem." };
      for (const l of f.lineas) if (!RE_MONTO.test(l.cantidad) || !RE_MONTO.test(l.precio_unitario) || (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor))) return { ok: false, msg: "Las cantidades, precios y descuentos deben ser números (hasta 6 decimales)." };
      try { return { ok: true, r: calcular(f.lineas) }; } catch (e) { return { ok: false, msg: e.message }; }
    }

    const mostrarPrevia = () => vistaPrevia({ ctx, doc, f, calc: calcularSeguro(), det: d, sucio, tipos });
    // La vista previa se abre con el documento GUARDADO (con su BR-####, y PDF y Compartir disponibles). Si hay cambios y los datos están completos, se guardan primero; si faltan datos se
    // muestra lo escrito (solo imprimir) y se dice qué falta.
    const abrirPrevia = async () => {
      if (editable() && (sucio || !doc.id) && problemas().length === 0) { const r = await guardar({ previa: true }); if (!r) return; if (!doc.id || previaPendiente) return; }
      mostrarPrevia();
    };

    // ---------------------------------------------------------------- pintado
    function pintarCab() {
      const [pt, ptono] = PREPARACION[doc.estado_preparacion];
      const sim = insignia("SIMULADO", "ambar"); sim.classList.add("tag-solo-pc");   // en el teléfono la franja de simulación ya lo dice
      poner(cab, h("div", { class: "doc-tit" }, h("h1", { class: "mono", title: "Número interno de borrador: no es un número fiscal" }, doc.numero_borrador ? codigoBorrador(doc.numero_borrador) : "Nuevo documento"),
        h("div", { class: "celda-tags" }, doc.numero_borrador && f.tipo_dte !== "FACT" ? insignia(tituloDocumento(tipos, f), "gris") : null, insignia(pt, ptono), doc.estado_fiscal !== "ninguno" ? insignia(FISCAL[doc.estado_fiscal][0], FISCAL[doc.estado_fiscal][1]) : null, sim)),
        h("button", { type: "button", class: "btn btn-sec btn-previa", id: "previa-titulo", "aria-label": "Vista previa", title: "Vista previa e impresión", onclick: abrirPrevia }, icono("eye"), h("span", { class: "bp-txt" }, "Vista previa")));
    }
    // Q0.00 se acepta SOLO en la demostración simulada (decisión de DEMO); nunca para certificar de verdad
    const lineasPrecioCero = () => f.lineas.map((l, i) => (RE_MONTO.test(l.precio_unitario) && Number(l.precio_unitario) === 0 ? i + 1 : 0)).filter(Boolean);
    const avisoPrecioCero = () => { const z = lineasPrecioCero(); return z.length ? h("p", { class: "aviso", id: "aviso-precio-cero", role: "status" }, icono("info"), h("span", {}, `Precio Q0.00 en ${z.length === 1 ? "la línea" : "las líneas"} ${z.join(", ")}: se acepta solo en esta DEMO. No es válido para certificar.`)) : null; };
    // Receptor INTELIGENTE: un solo campo de identificación con el tipo (NIT · CUI · CF · Otro) a un toque. Si lo escrito coincide con un cliente guardado se ofrece (o se elige si es idéntico) y se marca «Existente»;
    // si no, es un receptor «Nuevo» y el autollenado de siempre (controlador de receptor_nit.js, consultas por el SERVIDOR) trae el nombre. Nada de esto cambia lo que se guarda: cliente_id o cliente_nuevo.
    const TIPOS = [["NIT", "NIT"], ["CUI", "CUI"], ["CF", "CF"], ["EXT", "Otro"]];
    const textoDe = (t) => (t === "CUI" ? "CUI (13 dígitos)" : t === "CF" ? "CF" : t === "EXT" ? "Identificación del extranjero" : "NIT del receptor");
    let verObs = false;
    function pintarReceptor() {
      const ed = editable() && !esNota(); nit.render = null;   // en una nota el receptor es el del documento de origen
      const cambio = () => { sucio = true; pintarBarra(); pintarTotales(); };
      const asegurarCtrl = () => {
        if (ctrl && ctrlModelo === f) return; ctrlModelo = f;
        ctrl = crearAutollenado({ modelo: f, consultar: (n, o) => (o.tipo === "CUI" ? api.receptorCui(n, o) : api.receptorNit(n, o)),
          refrescar: () => { sincronizar(); cambio(); },
          estado: (info) => { nit.info = info; if (nit.estado) nit.estado.textContent = textoEstado(info); actualizarOk(); },
          etiqueta: (t) => { nit.et = t; pintarEtiqueta(nit.etiqueta, t); } });
      };
      const clienteActual = () => (f.cliente_id ? est.clientes.find((c) => c.id === f.cliente_id) : null);
      const modo = () => (f.cliente_id ? "existente" : f.nuevo ? "nuevo" : "vacio");

      // ---- tipo de identificación (control segmentado)
      nit.seg = h("div", { class: "seg-tipo", role: "radiogroup", "aria-label": "Tipo de identificación" },
        ...TIPOS.map(([v, t]) => h("button", { type: "button", role: "radio", class: "st-op", "data-tipo": v, disabled: !ed, "aria-checked": String(f.tipo === v), title: v === "EXT" ? "Extranjero u otro tipo de identificación" : null, onclick: () => elegirTipo(v) }, t)));
      // ---- identificación
      nit.numero = h("input", { value: f.numero, "aria-label": "Identificación del receptor", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "rc-sug", maxlength: 30, disabled: !ed, autocomplete: "off", enterkeyhint: "next", placeholder: textoDe(f.tipo),
        oninput: (e) => alEscribir(e.target.value), onfocus: () => mostrarSugerencias(), onblur: () => { setTimeout(ocultarSugerencias, 120); if (f.nuevo && ctrl) ctrl.alSalirIdentificacion(); },
        onkeydown: (e) => { if (e.key === "Escape") { ocultarSugerencias(); return; } if (e.key !== "Enter" || e.isComposing) return; e.preventDefault(); ocultarSugerencias(); if (f.nuevo && ctrl) { ctrl.alConfirmarIdentificacion(); nit.nombre?.focus(); } } });
      nit.ok = h("span", { class: "rc-ok", hidden: true, "aria-hidden": "true" }, icono("check"));
      nit.sug = h("div", { class: "rc-sug", id: "rc-sug", role: "listbox", "aria-label": "Clientes y opciones", hidden: true });
      nit.ayuda = h("small", { class: "rc-ayuda" }, "Escribe el NIT o CUI: busco entre tus clientes o lo consulto.");
      // ---- receptor elegido o nuevo (tarjeta sin marco: nombre, etiqueta Existente/Nuevo, origen y «Cambiar»)
      // el nombre se muestra como información CONFIRMADA (texto, sin recuadro); solo se vuelve campo si está vacío (hay que escribirlo) o si la persona lo toca para corregirlo
      nit.editando = false;
      nit.nombre = h("textarea", { class: "rc-nombre", rows: 1, maxlength: 200, "aria-label": "Nombre del receptor", placeholder: "Nombre del receptor", disabled: !ed, readonly: f.tipo === "CF", spellcheck: "false",
        onfocus: () => { nit.editando = true; },
        onblur: () => { nit.editando = false; actualizarNombre(); },
        oninput: (e) => { const v = e.target.value.replace(/[\r\n]+/g, " "); if (v !== e.target.value) e.target.value = v; ctrl?.alEscribirNombre(v); crecer(); cambio(); },
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } } });
      nit.nombre.value = f.nombre;
      nit.nombreVer = h("button", { type: "button", class: "rc-nombre-ver", id: "receptor-nombre-ver", "aria-label": "Editar el nombre del receptor", disabled: !ed || f.tipo === "CF", onclick: () => { nit.editando = true; actualizarNombre(); nit.nombre.focus(); nit.nombre.setSelectionRange(nit.nombre.value.length, nit.nombre.value.length); } });
      function actualizarNombre() {
        const v = f.nombre.trim(), texto = v !== "" && !nit.editando;
        nit.nombreVer.textContent = f.nombre; nit.nombreVer.hidden = !texto; nit.nombre.hidden = texto; nit.nombreVer.disabled = !ed || f.tipo === "CF"; if (!texto) crecer();
      }
      nit.estado = h("small", { class: "nit-estado", role: "status", "aria-live": "polite" }, textoEstado(nit.info));
      nit.etiqueta = h("small", { class: "nit-etiqueta", hidden: true }); pintarEtiqueta(nit.etiqueta, nit.et);
      nit.chip = h("span", { class: "tg" }); nit.cuando = h("span", { class: "rc-meta" }, "· se creará al guardar"); nit.nombreFijo = h("strong", { class: "rc-nombre-fijo" }); nit.meta = h("span", { class: "rc-meta" });
      nit.cambiar = h("button", { type: "button", class: "rc-cambiar", id: "receptor-cambiar", hidden: !ed, onclick: cambiarReceptor }, "Cambiar");
      nit.tarjeta = h("div", { class: "rc-card", "data-modo": modo() });
      const crecer = () => { if (!nit.nombre.isConnected || nit.nombre.offsetParent === null) return; nit.nombre.style.height = "auto"; nit.nombre.style.height = `${nit.nombre.scrollHeight}px`; };

      function pintarTarjeta() {
        const m = modo(), c = clienteActual(); nit.tarjeta.dataset.modo = m; nit.tarjeta.hidden = m === "vacio"; nit.ayuda.hidden = m !== "vacio";
        if (nit.render === m && m === "nuevo") { nit.chip.hidden = nit.cuando.hidden = f.tipo === "CF"; actualizarNombre(); return; }   // mismo modo: no se reconstruye (así no se pierde el foco del nombre)
        nit.render = m;
        if (m === "existente") {
          nit.chip.className = "tg t-ex"; nit.chip.textContent = "Existente"; nit.chip.hidden = false; nit.nombreFijo.textContent = c?.nombre ?? "Receptor"; nit.meta.textContent = c ? `Cliente guardado · ${c.tipo_identificacion === "CF" ? "CF" : `${c.tipo_identificacion} ${c.numero_identificacion}`}` : "";
          poner(nit.tarjeta, h("div", { class: "rc-l1" }, nit.nombreFijo, nit.cambiar), h("div", { class: "rc-l2" }, nit.chip, nit.meta));
        } else if (m === "nuevo") {
          nit.chip.className = "tg t-nu"; nit.chip.textContent = "Nuevo"; nit.chip.hidden = nit.cuando.hidden = f.tipo === "CF";
          poner(nit.tarjeta, h("div", { class: "rc-l1" }, nit.nombreVer, nit.nombre, nit.cambiar), h("div", { class: "rc-l2" }, nit.chip, nit.etiqueta, nit.cuando), nit.estado);
          actualizarNombre();
        } else poner(nit.tarjeta);
      }
      function actualizarOk() { nit.ok.hidden = !(f.cliente_id || nit.info?.fase === "ok" || (f.tipo === "CF" && f.nuevo)); }
      function sincronizar() {   // vuelca el modelo en los campos (lo llama el controlador y las acciones de esta función)
        for (const b of nit.seg.querySelectorAll(".st-op")) b.setAttribute("aria-checked", String(b.dataset.tipo === f.tipo));
        nit.numero.placeholder = textoDe(f.tipo); nit.numero.setAttribute("inputmode", f.tipo === "CUI" ? "numeric" : "text");
        if (f.nuevo && nit.numero.value !== f.numero) nit.numero.value = f.numero;
        nit.nombre.value = f.nombre; nit.nombre.readOnly = f.tipo === "CF"; nit.chip.hidden = f.tipo === "CF" && modo() === "nuevo";
        pintarTarjeta(); actualizarOk(); actualizarNombre();
      }
      // ---- acciones
      function elegirTipo(t) {
        if (!ed) return;
        if (f.cliente_id) { f.cliente_id = ""; f.numero = ""; f.nombre = ""; nit.numero.value = ""; ctrl = null; }
        f.nuevo = true; asegurarCtrl(); ctrl.alElegirTipo(t); if (t === "CF") nit.numero.value = f.numero;
        ocultarSugerencias(); sincronizar(); cambio(); if (t !== "CF") nit.numero.focus();
      }
      function alEscribir(valor) {
        if (!ed) return;
        if (f.cliente_id) { f.cliente_id = ""; f.nombre = ""; ctrl = null; }
        if (!f.nuevo) { f.nuevo = true; f.nombre = ""; }
        asegurarCtrl();
        const n = normalizarId(valor), tipoBusca = f.tipo === "CF" ? "NIT" : f.tipo;
        const exacto = n.length >= 4 && est.clientes.find((c) => c.tipo_identificacion === tipoBusca && normalizarId(c.numero_identificacion) === n);
        if (exacto) { elegirExistente(exacto); return; }   // idéntico a un cliente guardado: no se consulta nada fuera
        ctrl.alEscribirId(valor); sincronizar(); mostrarSugerencias(); cambio();
      }
      function elegirExistente(c) {
        ctrl?.cancelar(); ctrl = null; f.cliente_id = c.id; f.nuevo = false; f.tipo = c.tipo_identificacion === "CF" ? "NIT" : c.tipo_identificacion; f.numero = ""; f.nombre = ""; nit.info = null; nit.et = null;
        nit.numero.value = c.tipo_identificacion === "CF" ? "CF" : c.numero_identificacion; ocultarSugerencias(); sincronizar(); cambio();
      }
      function cambiarReceptor() {
        if (!ed) return; ctrl?.cancelar(); ctrl = null; f.cliente_id = ""; f.nuevo = false; f.numero = ""; f.nombre = ""; nit.info = null; nit.et = null;
        nit.numero.value = ""; nit.estado.textContent = ""; pintarEtiqueta(nit.etiqueta, null); ocultarSugerencias(); sincronizar(); cambio(); nit.numero.focus();
      }
      function coincidencias() {
        const q = nit.numero.value.trim(), qn = normalizarId(q), ql = q.toLowerCase(); if (!q || f.tipo === "CF") return [];
        const soloLetras = /[a-záéíóúñ]/i.test(q) && !/\d/.test(q);
        return est.clientes.filter((c) => c.tipo_identificacion !== "CF" && (soloLetras ? c.nombre.toLowerCase().includes(ql) : c.tipo_identificacion === f.tipo && normalizarId(c.numero_identificacion).includes(qn))).slice(0, 4);
      }
      function mostrarSugerencias() {
        if (!ed || f.cliente_id || f.tipo === "CF") { ocultarSugerencias(); return; }
        const q = nit.numero.value.trim(), lista = coincidencias();
        // la fila «consultar y crear nuevo» solo mientras la identificación está incompleta: con una completa (CUI de 13 dígitos, NIT con formato válido) la lista no debe tapar el nombre
        const completa = f.tipo === "CUI" ? RE_CUI.test(normalizarCui(q)) : f.tipo === "NIT" ? RE_NIT.test(normalizarId(q)) && normalizarId(q).length >= 5 : false;
        const crear = q && !completa && (/\d/.test(q) || f.tipo === "EXT");
        if (!lista.length && !crear) { ocultarSugerencias(); return; }
        poner(nit.sug, ...lista.map((c) => h("button", { type: "button", role: "option", class: "sg sg-ex", onmousedown: (e) => e.preventDefault(), onclick: () => elegirExistente(c) },
            h("span", { class: "sg-t" }, h("strong", {}, c.nombre), h("small", {}, `${c.tipo_identificacion} ${c.numero_identificacion}`)), h("span", { class: "tg t-ex" }, "Existente"))),
          crear ? h("button", { type: "button", role: "option", class: "sg sg-nu", id: "receptor-crear", onmousedown: (e) => e.preventDefault(), onclick: () => { ocultarSugerencias(); asegurarCtrl(); f.nuevo = true; ctrl.alConfirmarIdentificacion(); nit.nombre?.focus(); } },
            h("span", { class: "sg-t" }, h("strong", {}, f.tipo === "EXT" ? `Crear con «${q}»` : `Consultar «${q}» y crear nuevo`), h("small", {}, f.tipo === "EXT" ? "El nombre se escribe a mano" : "Se busca el nombre en Digifact TEST al confirmar")), h("span", { class: "tg t-nu" }, "Nuevo")) : null);
        nit.sug.hidden = false; nit.numero.setAttribute("aria-expanded", "true");
      }
      function ocultarSugerencias() { if (!nit.sug) return; nit.sug.hidden = true; nit.numero.setAttribute("aria-expanded", "false"); }
      if (f.cliente_id) { const c = clienteActual(); nit.numero.value = c ? (c.tipo_identificacion === "CF" ? "CF" : c.numero_identificacion) : ""; if (c && c.tipo_identificacion !== "CF") f.tipo = c.tipo_identificacion; for (const b of nit.seg.querySelectorAll(".st-op")) b.setAttribute("aria-checked", String(b.dataset.tipo === f.tipo)); }
      if (f.nuevo) asegurarCtrl();
      nit.numero.setAttribute("inputmode", f.tipo === "CUI" ? "numeric" : "text");
      pintarTarjeta(); actualizarOk();

      // ---- establecimiento y fecha en una fila; observaciones plegadas
      const selEst = h("select", { "aria-label": "Establecimiento", class: "sv-in", disabled: !ed, onchange: (e) => { f.establecimiento_id = e.target.value; try { if (e.target.value) localStorage.setItem("fel.establecimiento", e.target.value); } catch { /* opcional */ } pintarEstab(); sucio = true; pintarBarra(); pintarTotales(); } },
        h("option", { value: "" }, "Selecciona…"), ...est.establecimientos.map((x) => h("option", { value: x.id }, `${x.codigo_sat} · ${x.nombre}`)));
      selEst.value = f.establecimiento_id;
      // lo VISIBLE es una presentación compacta («1 · Casa matriz»; con muy poco ancho, solo «Casa matriz»); el valor elegido y la lista de opciones son los del <select> nativo, sin cambios
      const vistaEst = h("span", { class: "sv-t", id: "establecimiento-vista" }), icoEst = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>', "image/svg+xml").documentElement; icoEst.classList.add("sv-i"); icoEst.setAttribute("aria-hidden", "true");
      function pintarEstab() { const x = est.establecimientos.find((e) => e.id === f.establecimiento_id); vistaEst.classList.toggle("sv-vacio", !x); poner(vistaEst, x ? [h("span", { class: "sv-cod" }, `${x.codigo_sat} · `), h("span", { class: "sv-nom" }, x.nombre)] : "Selecciona…"); }
      const campoEst = h("div", { class: `sv${ed ? "" : " sv-off"}` }, vistaEst, icoEst, selEst);
      if (!f.establecimiento_id && ed && !doc.id && est.establecimientos.length) {   // factura nueva: viene elegido el único establecimiento, el último que usaste o, si no, el principal (código SAT más bajo); se puede cambiar
        let elegido = est.establecimientos.length === 1 ? est.establecimientos[0].id : "";
        if (!elegido) { try { const g = localStorage.getItem("fel.establecimiento"); if (g && est.establecimientos.some((x) => x.id === g)) elegido = g; } catch { /* sin almacenamiento: se usa el principal */ } }
        if (!elegido) elegido = [...est.establecimientos].sort((a, b) => Number(a.codigo_sat) - Number(b.codigo_sat))[0].id;
        f.establecimiento_id = elegido; selEst.value = elegido;
      }
      pintarEstab();
      // la fecha se MUESTRA día/mes/año (formato de Guatemala) sin importar el idioma del navegador; el campo de fecha nativo, transparente encima, conserva el valor AAAA-MM-DD y abre el selector del dispositivo
      const ddmmaaaa = (iso) => { const [y, m, d] = String(iso ?? "").slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : "dd/mm/aaaa"; };
      const vistaFecha = h("span", { class: "fv-t", id: "fecha-vista" }, ddmmaaaa(f.fecha));
      const aviso = h("p", { class: "rc-aviso-fecha", id: "fecha-aviso", role: "status", hidden: true });
      // aviso discreto: una fecha anterior se emite con ESA fecha; la de certificación la asigna el certificador (no se escribe aquí). Una fecha fuera del plazo se señala sin cambiarla sola.
      const pintarAviso = () => {
        if (!ed) { aviso.hidden = true; return; }   // un documento ya revisado o certificado no se edita: sin avisos
        const pf = f.fecha ? problemaFecha(f.fecha, VEN) : "", n = f.fecha ? diasEntre(f.fecha, VEN.hoy) : 0;
        aviso.className = `rc-aviso-fecha${pf ? " err" : ""}`;
        aviso.textContent = pf ? `${pf} Elige otra fecha.` : n > 0 ? `Fecha anterior (hace ${n} ${n === 1 ? "día" : "días"}). La fecha de certificación la asigna el certificador.${f.fecha.slice(0, 7) !== VEN.hoy.slice(0, 7) ? " Pertenece a un mes anterior: cuenta para el período de IVA de ese mes." : ""}` : "";
        aviso.hidden = !aviso.textContent;
      };
      const nativo = h("input", { type: "date", class: "fv-in", value: f.fecha, min: VEN.minima, max: VEN.hoy, "aria-label": "Fecha de emisión", disabled: !ed, oninput: (e) => { f.fecha = e.target.value; vistaFecha.textContent = ddmmaaaa(f.fecha); pintarAviso(); sucio = true; pintarBarra(); } });
      pintarAviso();
      const icoFecha = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>', "image/svg+xml").documentElement; icoFecha.classList.add("fv-i"); icoFecha.setAttribute("aria-hidden", "true");
      const fecha = h("div", { class: `fv${ed ? "" : " fv-off"}`, onclick: () => { if (!ed) return; try { nativo.showPicker(); } catch { nativo.focus(); } api.ventanaFecha().then((v) => { if (v && v.hoy) { VEN = v; nativo.min = v.minima; nativo.max = v.hoy; pintarAviso(); } }).catch(() => {}); } }, vistaFecha, icoFecha, nativo);
      const obs = h("input", { value: f.observaciones, maxlength: 500, "aria-label": "Observaciones", disabled: !ed, placeholder: "Observaciones (opcional)", oninput: (e) => { f.observaciones = e.target.value; sucio = true; pintarBarra(); } });
      const bloqueObs = (f.observaciones || verObs) ? obs : (ed ? h("button", { type: "button", class: "rc-obs-btn", id: "agregar-observaciones", onclick: () => { verObs = true; pintarReceptor(); document.querySelector('input[aria-label="Observaciones"]')?.focus(); } }, "+ Agregar observaciones") : null);
      poner(cuerpoReceptor,
        h("div", { class: "rc-sec" }, h("span", { class: "rc-et" }, "Receptor"), nit.seg, h("div", { class: "rc-campo" }, nit.numero, nit.ok, nit.sug), nit.ayuda, nit.tarjeta),
        h("div", { class: "rc-emision" }, h("label", { class: "rc-mini" }, h("span", {}, "Establecimiento"), campoEst), h("label", { class: "rc-mini" }, h("span", {}, "Fecha"), fecha)),
        aviso,
        bloqueObs);
    }

    // ---------------------------------------------------------------- ítems: filas compactas + editor en hoja
    function abrirEditor(i) {
      if (!editable()) return;
      const nuevo = i < 0;
      editarItem({ item: nuevo ? lineaVacia() : { ...f.lineas[i] }, numero: nuevo ? f.lineas.length + 1 : i + 1, nuevo, conceptos: est.conceptos ?? [],
        onGuardar: (it) => { if (nuevo) f.lineas.push(it); else f.lineas[i] = it; sucio = true; pintarLineas(); pintarBarra(); },
        onQuitar: () => { f.lineas.splice(i, 1); sucio = true; pintarLineas(); pintarBarra(); } });
    }
    function pintarLineas() {
      const ed = editable(), calc = calcularSeguro();
      const filas = f.lineas.map((l, i) => {
        const hijos = [h("span", { class: "it-n" }, String(i + 1)), h("span", { class: "it-m" }, h("strong", { class: "it-d" }, l.descripcion || "Sin descripción"), h("small", { class: "it-s" }, resumenLinea(l))),
          h("span", { class: "it-neto num" }, calc.ok ? quetzales(calc.r.lineas[i]?.neto) : "—")];
        return ed ? h("button", { type: "button", class: "it", "data-linea": String(i + 1), "aria-label": `Editar el ítem ${i + 1}: ${l.descripcion}`, onclick: () => abrirEditor(i) }, ...hijos)
          : h("div", { class: "it it-fijo", "data-linea": String(i + 1) }, ...hijos);
      });
      poner(cuerpoLineas, ...(filas.length ? filas : [h("p", { class: "mut it-vacio" }, ed ? "Aún no hay ítems." : "Sin ítems.")]),
        ed ? boton("Agregar ítem", { tipo: "sec", icon: "plus", id: "agregar-item", onclick: () => abrirEditor(-1) }) : null);
      pintarTotales();
    }
    function cuerpoCatalogo() {
      if (!editable() || !est.conceptos?.length) return null;
      return h("select", { "aria-label": "Agregar un concepto del catálogo", class: "sel-concepto", onchange: (e) => {
        const c = est.conceptos.find((x) => x.id === e.target.value); e.target.value = ""; if (!c) return;
        f.lineas.push({ ...lineaVacia(), descripcion: c.descripcion, precio_unitario: c.precio_unitario }); sucio = true; pintarLineas(); pintarBarra(); } },
        h("option", { value: "" }, "Buscar concepto…"), ...est.conceptos.map((c) => h("option", { value: c.id }, `${c.tipo === "bien" ? "Bien" : "Servicio"} · ${c.descripcion}`)));
    }

    // ---------------------------------------------------------------- resumen compacto
    function pintarTotales() {
      const c = calcularSeguro(), ps = problemas();
      const fila = (et, v, extra) => h("div", { class: `tot${extra ? " " + extra : ""}` }, h("span", {}, et), h("strong", { class: "num" }, v));
      poner(totales,
        ...(c.ok ? [fila("Subtotal", quetzales(c.r.subtotal)), fila("Descuentos", quetzales(c.r.descuento_total)), fila("Total provisional", quetzales(c.r.base_imponible), "tot-base"), fila("IVA 12 % incluido (estimado)", quetzales(ivaIncluido(c.r.lineas.map((x) => x.neto)).iva), "tot-iva"), h("small", { class: "mut tot-nota" }, "El importe definitivo lo fija el certificador. SIMULADO · SIN VALOR FISCAL.")]
          : [h("p", { class: "mut" }, c.vacio ? "Agrega ítems para ver los importes." : "Completa cantidad y precio de cada ítem para ver los importes."), h("small", { class: "mut tot-nota" }, "SIMULADO · SIN VALOR FISCAL.")]),
        avisoPrecioCero(),
        ps.length && (intentoGuardar || !editable()) ? h("div", { class: "validacion", role: "status" }, h("strong", {}, "Antes de guardar:"), h("ul", {}, ...ps.map((x) => h("li", {}, x)))) : ps.length ? h("p", { class: "mut ayuda-val" }, `${ps.length} dato${ps.length > 1 ? "s" : ""} por completar.`) : h("p", { class: "ok-val" }, icono("circleCheck"), h("span", {}, "Datos completos.")));
    }

    // ---------------------------------------------------------------- Digifact TEST: «Guardar y certificar»
    // Solo si el servidor lo habilitó para ESTA empresa con el ciclo de pruebas autorizado, el almacén es persistente y el rol puede certificar. El documento se guarda SIEMPRE antes y
    // queda guardado (y revisado) pase lo que pase con la certificación.
    const infoTipoCert = () => tipoPorCodigo(tipos, f.tipo_dte);
    const certificaEnTest = () => !!dg && dg.habilitado && dg.certificacion && dg.empresaConCanal && dg.ciclo && dg.almacenamiento === "persistente" && ctx.tiene("fiscal.certificar")
      && (f.tipo_dte === "FACT" || !!infoTipoCert()?.certificacion_habilitada);
    const puedeCertificarAhora = () => certificaEnTest() && doc.estado_fiscal === "ninguno" && ["borrador", "revisado"].includes(doc.estado_preparacion) && (doc.id || editable());
    function confirmarCertificacion(prep, ocupadaPor) {
      return new Promise((resolve) => {
        const c0 = calcularSeguro(), iv = c0.ok ? ivaIncluido(c0.r.lineas.map((x) => x.neto)) : null, q2 = (t) => quetzales(Number(t).toFixed(2));
        const fila = (et, v) => h("div", { class: "cc-fila" }, h("span", {}, et), h("strong", { class: "mono" }, v));
        let m;
        const si = boton("Certificar en TEST", { id: "confirmar-certificar-test", onclick: () => { m.cerrar(); resolve(true); } });
        m = modal({ titulo: "Certificar en Digifact TEST", ancho: "sm",
          contenido: [h("p", { class: "aviso aviso-azul", role: "note" }, icono("info"), h("span", {}, "Se enviará UNA sola vez al ambiente de PRUEBAS de Digifact. Es un documento de prueba: no tiene valor fiscal.")),
            fila("Receptor", prep.receptor?.nombre ?? "—"), fila("Fecha de emisión", dmy(String(prep.fechaEmision ?? "").slice(0, 10))), fila("Total", q2(prep.total)), iv ? fila("IVA 12 % incluido (estimado)", quetzales(iv.iva)) : null, fila("Referencia", String(prep.referencia ?? "").slice(0, 8) + "…")],
          pie: [boton("Ahora no", { tipo: "sec", id: "cancelar-certificar-test", onclick: () => { m.cerrar(); resolve(false); } }), si] });
      });
    }
    let certificando = false;
    async function certificarEnTest() {
      if (certificando) return; certificando = true; err.textContent = "";
      const bc = document.getElementById("guardar-certificar") ?? document.getElementById("certificar-test"); if (bc) bc.disabled = true;
      try {
        if (doc.estado_preparacion === "borrador") {   // revisar congela el contenido, requisito para preparar
          if (!ctx.tiene("borradores.revisar")) { err.textContent = "Tu rol no puede marcar el documento como revisado, paso previo a certificar. El borrador quedó guardado."; return; }
          const r = await api.estadoPreparacion(doc.id, "revisado", doc.version); await recargar(r);
        }
        const prep = await api.digifactPreparar(doc.id, {});   // no envía nada
        if (!(await confirmarCertificacion(prep))) { toast("No se certificó. El documento quedó guardado y revisado."); await recargar(); return; }
        const r = await api.digifactCertificar(doc.id, { operacionId: prep.operacionId ?? prep.id, confirmacion: CONFIRMACION_TEST, referencia: prep.referencia, huellaEmisor: prep.huellaEmisor });
        await recargar();
        const op = r.operacion?.estado;
        if (r.error) err.textContent = `No se envió a Digifact: ${r.error.mensaje} El documento quedó guardado.`;
        else if (op === "certificada") toast(r.reutilizada ? "Este documento ya estaba certificado en TEST." : "Certificado en Digifact TEST");
        else if (op === "rechazada") err.textContent = `Digifact TEST rechazó el documento: ${r.operacion?.resultado?.mensaje ?? ""} El documento quedó guardado.`;
        else err.textContent = "No se sabe si Digifact TEST lo certificó. El documento quedó guardado y BLOQUEADO para no duplicarlo: usa «Consultar a Digifact» en el panel de abajo.";
      } catch (e) { try { await recargar(); } catch { /* se queda la pantalla */ } err.textContent = `${mensajeError(e)} El documento quedó guardado.`; }   // primero se recarga (limpia los mensajes) y después se explica
      finally { certificando = false; const b2 = document.getElementById("guardar-certificar") ?? document.getElementById("certificar-test"); if (b2) b2.disabled = false; }
    }
    async function guardarYCertificar() {
      const r = await guardar({ certificar: true }); if (!r || certificarPendiente) return;   // documento nuevo: la pantalla se reconstruye y continúa sola
      await certificarEnTest();
    }

    // ---------------------------------------------------------------- barra: una acción principal + «Más acciones»
    let cerrarMenu = () => {};
    function pintarBarra() {
      cerrarMenu();
      const ed = editable(), prep = doc.estado_preparacion;
      const puedeRevisar = doc.id && prep === "borrador" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.revisar");
      let principal;
      let secundaria = null;
      if (ed && (sucio || !doc.id) && puedeCertificarAhora()) {   // dos acciones claras: guardar solo, o guardar y certificar en TEST
        principal = boton("Guardar y certificar en TEST", { icon: "shield", id: "guardar-certificar", onclick: guardarYCertificar });
        secundaria = boton(doc.id ? "Guardar cambios" : "Guardar borrador", { tipo: "sec", icon: "check", id: "guardar", onclick: () => guardar() });
      } else if (ed && (sucio || !doc.id)) principal = boton(doc.id ? "Guardar cambios" : "Guardar borrador", { icon: "check", id: "guardar", onclick: () => guardar() });
      else if (doc.id && !sucio && puedeCertificarAhora() && ["borrador", "revisado"].includes(prep)) principal = boton("Certificar en TEST", { icon: "shield", id: "certificar-test", onclick: certificarEnTest });
      else if (puedeRevisar) principal = boton("Marcar como revisado", { icon: "circleCheck", id: "revisar", onclick: () => cambiar("revisado") });
      else principal = boton("Vista previa e impresión", { icon: "eye", id: "ver-previa", onclick: abrirPrevia });
      const items = [{ t: "Vista previa e impresión", i: "eye", id: "mi-previa", f: abrirPrevia }];
      if (puedeRevisar) items.push({ t: "Validar con el proveedor", i: "shield", id: "mi-validar", f: validar, off: sucio, tip: "Guarda los cambios antes de validar" });
      if (puedeRevisar && principal.id !== "revisar") items.push({ t: "Marcar como revisado", i: "circleCheck", id: "mi-revisar", f: () => cambiar("revisado"), off: sucio, tip: "Guarda los cambios antes de revisar" });
      if (doc.id && prep === "revisado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.editar")) items.push({ t: "Volver a borrador", i: "undo", id: "mi-borrador", f: () => cambiar("borrador") });
      if (doc.id && prep !== "archivado" && doc.estado_fiscal === "ninguno" && ctx.tiene("borradores.archivar")) items.push({ t: "Archivar", i: "archive", id: "mi-archivar", f: archivar, peligro: true });
      items.push({ t: "Volver a documentos", i: "undo", id: "mi-volver", f: () => ctx.ir("/") });
      const menu = h("div", { class: "menu-mas", role: "menu", "aria-label": "Más acciones", hidden: true },
        ...items.map((x) => h("button", { type: "button", role: "menuitem", class: `mi${x.peligro ? " mi-peligro" : ""}`, id: x.id, disabled: !!x.off, title: x.off ? x.tip : null, onclick: () => { cerrar(); x.f(); } }, icono(x.i), h("span", {}, x.t))));
      const bMas = h("button", { type: "button", class: "btn btn-sec btn-mas", id: "mas-acciones", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Más acciones", onclick: (e) => { e.stopPropagation(); menu.hidden ? abrir() : cerrar(); } }, h("span", {}, "Más"), h("span", { class: "mas-largo" }, " acciones"), h("span", { "aria-hidden": "true", class: "mas-flecha" }, "▴"));
      const fuera = (e) => { if (!wrap.contains(e.target)) cerrar(); }, tecla = (e) => { if (e.key === "Escape") { cerrar(); bMas.focus(); } };
      function abrir() { menu.hidden = false; bMas.setAttribute("aria-expanded", "true"); document.addEventListener("click", fuera); document.addEventListener("keydown", tecla); menu.querySelector("button:not([disabled])")?.focus(); }
      function cerrar() { menu.hidden = true; bMas.setAttribute("aria-expanded", "false"); document.removeEventListener("click", fuera); document.removeEventListener("keydown", tecla); }
      cerrarMenu = cerrar;
      const wrap = h("div", { class: "mas-wrap" }, bMas, menu);
      poner(barra, sucio && doc.id ? h("span", { class: "sucio" }, "Cambios sin guardar") : null, secundaria, principal, wrap);
    }
    function pintarProceso() {
      poner(proceso, doc.id ? panelProceso({ ctx, det: d, sucio: () => sucio, recargar, avisar: (t, tipo) => toast(t, tipo), mostrarError: (e) => { err.textContent = mensajeError(e); } }) : h("div", { class: "card" }, h("h2", { class: "card-t" }, "Proceso"), h("p", { class: "mut" }, "Guarda el borrador para poder validarlo, revisarlo y enviarlo a la certificación simulada.")));
    }

    // ---------------------------------------------------------------- acciones
    async function recargar(nuevo) {
      d = nuevo ?? await api.documento(doc.id); doc = d.documento; f = inicial(); sucio = false; intentoGuardar = false; err.textContent = "";
      await ctx.recargarEstado(); todo();
    }
    async function guardar(opc = {}) {
      err.textContent = ""; intentoGuardar = true; const ps = problemas(); pintarTotales();
      if (ps.length) { err.textContent = ps[0]; return null; }
      const b = document.getElementById("guardar"); if (b) b.disabled = true;
      try {
        const nuevo = !doc.id;
        const cuerpo = { id: doc.id, version: doc.version, establecimiento_id: f.establecimiento_id, fecha: f.fecha, observaciones: f.observaciones, lineas: f.lineas,
          tipo_dte: f.tipo_dte, documento_origen_id: f.documento_origen_id || undefined, motivo_ajuste: f.motivo_ajuste || undefined, tipo_recibo: f.tipo_recibo || undefined,
          ...(f.nuevo ? { cliente_nuevo: { tipo_identificacion: f.tipo, numero_identificacion: f.numero, nombre: f.nombre } } : { cliente_id: f.cliente_id }) };
        const r = await api.guardar(cuerpo); await ctx.recargarEstado(); toast(`Borrador ${codigoBorrador(r.documento.numero_borrador)} guardado`);
        if (nuevo) { if (opc.previa) previaPendiente = r.documento.id; if (opc.certificar) certificarPendiente = r.documento.id; ctx.ir(`/f/${r.documento.id}`, { reemplazar: true }); return r; }
        await recargar(r); return r;
      } catch (e) { err.textContent = mensajeError(e); if (e.codigo === "FEL_CONFLICTO" || e.status === 409) err.append(" ", h("button", { type: "button", class: "link", onclick: () => recargar() }, "Recargar")); if (b) b.disabled = false; return null; }
    }
    async function validar() {
      err.textContent = "";
      try { const r = await api.validar(doc.id); r.ok ? toast(f.tipo_dte === "FACT" ? "El proveedor simulado valida el documento" : `El proveedor simulado valida el documento (${tipoActual()?.nombre ?? ""}: en pruebas, aún no se certifica)`) : (err.textContent = `El proveedor no valida el documento: ${r.errores.map((x) => x.mensaje).join(" · ")}`); } catch (e) { err.textContent = mensajeError(e); }
    }
    async function cambiar(estado, motivo) {
      err.textContent = "";
      try { const r = await api.estadoPreparacion(doc.id, estado, doc.version, motivo); toast(estado === "revisado" ? "Marcado como revisado: el contenido queda congelado" : estado === "archivado" ? "Factura archivada" : "Vuelve a ser borrador"); await recargar(r); } catch (e) { err.textContent = mensajeError(e); }
    }
    async function archivar() { const m = await pedirMotivo({ titulo: "Archivar factura", texto: "Archivar es una decisión interna: no es una anulación fiscal.", confirmar: "Archivar" }); if (m) cambiar("archivado", m); }

    const barraTipo = h("div", { class: "tipo-fila" }), cardTipo = h("div", { class: "tipo-card-cont" });
    function pintarTipo() {
      poner(barraTipo, selectorTipo({ tipos, f, editable: editable(), alCambiar: (c) => { aplicarTipo(f, tipos, c); if (!tipoPorCodigo(tipos, c)?.requiere_origen) nit.render = null; sucio = true; todo(); } }));
      poner(cardTipo, panelTipo({ tipos, f, editable: editable(), ctx, cambio: () => { sucio = true; pintarBarra(); pintarTotales(); },
        aplicarOrigen: (c) => { if (c) { f.cliente_id = c.cliente_id; f.nuevo = false; } nit.render = null; pintarReceptor(); poner(cardDatos, cuerpoReceptor); } }));
    }
    const avisoDoc = h("div", { class: "aviso-doc" });   // se vuelve a pintar con cada cambio de estado (anulación, conciliación…)
    function pintarAviso() { poner(avisoDoc, !editable() && doc.id ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, doc.estado_fiscal === "anulado" ? "Documento ANULADO (simulación): es definitivo y no se puede editar ni volver a emitir." : doc.estado_fiscal === "anulacion_solicitada" ? "Anulación solicitada: queda pendiente de conciliar con el proveedor. El documento no se puede editar." : doc.estado_fiscal !== "ninguno" ? "Este documento tiene vida fiscal (simulada) y su contenido ya no se puede editar." : doc.estado_preparacion === "borrador" ? "Tu rol no permite editar este borrador." : "El contenido está congelado porque fue revisado. Vuelve a borrador para editarlo.")) : null); }
    function todo() {
      pintarAviso(); pintarCab(); pintarTipo(); pintarReceptor(); pintarLineas(); pintarBarra(); pintarProceso();
      poner(cardDatos, cuerpoReceptor);
      poner(cardItems, h("div", { class: "card-fila" }, h("h2", { class: "card-t" }, "Ítems"), cuerpoCatalogo()), cuerpoLineas);
    }
    todo();
    // no perder lo escrito por un cierre o una recarga accidental de la página
    const avisoSalir = (e) => { if (!document.body.contains(raiz)) { window.removeEventListener("beforeunload", avisoSalir); return; } if (sucio && editable()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", avisoSalir);
    if (doc.id && previaPendiente === doc.id) { previaPendiente = null; setTimeout(mostrarPrevia, 0); }   // venía de «Vista previa» con un documento nuevo: ya está guardado
    if (doc.id && certificarPendiente === doc.id) { certificarPendiente = null; setTimeout(certificarEnTest, 0); }   // venía de «Guardar y certificar»
    return h("div", { class: "pf" }, cab, barraTipo,
      avisoDoc,
      h("div", { class: "doc-grid" }, cardTipo, cardDatos, cardItems, totales, err, proceso), barra);
  }
}
