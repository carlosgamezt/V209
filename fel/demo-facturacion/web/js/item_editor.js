// Editor de UN ítem de factura, en una hoja que sube desde abajo (móvil) o un diálogo (escritorio). Pensado para capturar muchos ítems seguidos:
// el foco avanza de campo en campo con «Siguiente»/Intro del teclado, «Agregar y otro» guarda y deja la hoja lista para el siguiente ítem sin cerrarla,
// y en el último campo Intro hace lo mismo. Las reglas de validación son EXACTAMENTE las de la pantalla de factura (el servidor y la base vuelven a validar).
import { h, boton, modal, quetzales } from "/app/js/ui.js";
import { calcular } from "/app/js/calculo.js";

export const RE_MONTO = /^\d{1,12}(\.\d{1,6})?$/;
export const lineaVacia = () => ({ descripcion: "", cantidad: "1", precio_unitario: "", descuento_tipo: "ninguno", descuento_valor: "0" });

/** Primer problema de una línea como { campo, msg } (o null si es válida). `n` es su número (para los mensajes). */
export function problemaLinea(l, n) {
  if (!String(l.descripcion).trim()) return { campo: "descripcion", msg: `Línea ${n}: falta la descripción.` };
  if (!RE_MONTO.test(l.cantidad) || Number(l.cantidad) <= 0) return { campo: "cantidad", msg: `Línea ${n}: la cantidad debe ser un número mayor que cero (hasta 6 decimales).` };
  if (!RE_MONTO.test(l.precio_unitario)) return { campo: "precio_unitario", msg: `Línea ${n}: el precio debe ser un número (hasta 6 decimales).` };
  if (l.descuento_tipo !== "ninguno" && !RE_MONTO.test(l.descuento_valor)) return { campo: "descuento_valor", msg: `Línea ${n}: el descuento no es un número válido.` };
  if (l.descuento_tipo === "porcentaje" && Number(l.descuento_valor) > 100) return { campo: "descuento_valor", msg: `Línea ${n}: el porcentaje no puede superar 100.` };
  try { calcular([l]); } catch (e) { return { campo: "descuento_valor", msg: `Línea ${n}: ${e.message}` }; }
  return null;
}

/** «2 × Q 10.00 · −10 %» — resumen corto de una línea para la lista compacta. */
export function resumenLinea(l) {
  const cant = String(l.cantidad).replace(/\.?0+$/, "") || "0";
  const d = l.descuento_tipo === "porcentaje" ? ` · −${l.descuento_valor}%` : l.descuento_tipo === "monto" ? ` · −${quetzales(l.descuento_valor)}` : "";
  return `${cant} × ${quetzales(l.precio_unitario)}${d}`;
}

/**
 * Abre el editor. `item` es una copia editable; `onGuardar(item)` recibe cada ítem confirmado (en modo «nuevo» puede llamarse varias veces).
 * `onQuitar()` solo se ofrece al editar uno existente.
 */
export function editarItem({ item, numero, nuevo, conceptos = [], onGuardar, onQuitar }) {
  let n = numero, l = { ...item }, agregados = 0, m;
  const aviso = h("p", { class: "ed-ok", role: "status", "aria-live": "polite" }), err = h("p", { class: "err", role: "alert" }), neto = h("strong", { class: "num", id: "ed-neto" }, "—");
  const dl = h("datalist", { id: "conceptos-dl" }, ...conceptos.map((c) => h("option", { value: c.descripcion })));
  const campoTxt = (k, et, extra = {}) => h("input", { value: l[k], "aria-label": et, "data-campo": k, autocomplete: "off", ...extra,
    oninput: (e) => { l[k] = e.target.value; err.textContent = ""; actualizar(); }, onfocus: (e) => { if (extra.inputmode) e.target.select(); }, onkeydown: siguiente });
  const desc = campoTxt("descripcion", "Descripción", { maxlength: 300, list: "conceptos-dl", placeholder: "Descripción o concepto", enterkeyhint: "next", autocapitalize: "sentences",
    onchange: (e) => { const c = conceptos.find((x) => x.descripcion === e.target.value); if (c && !String(l.precio_unitario).trim()) { l.precio_unitario = c.precio_unitario; precio.value = l.precio_unitario; actualizar(); } } });
  const cant = campoTxt("cantidad", "Cantidad", { inputmode: "decimal", enterkeyhint: "next" }), precio = campoTxt("precio_unitario", "Precio unitario (Q)", { inputmode: "decimal", placeholder: "0.00", enterkeyhint: "next" });
  const dtipo = h("select", { "aria-label": "Tipo de descuento", "data-campo": "descuento_tipo", onchange: (e) => { l.descuento_tipo = e.target.value; if (l.descuento_tipo === "ninguno") l.descuento_valor = "0"; dval.hidden = l.descuento_tipo === "ninguno"; mostrarValor(); err.textContent = ""; actualizar(); if (!dval.hidden) dval.focus(); } },
    ...[["ninguno", "Sin descuento"], ["monto", "Descuento en Q"], ["porcentaje", "Descuento en %"]].map(([v, t]) => h("option", { value: v, selected: l.descuento_tipo === v }, t)));
  const dval = campoTxt("descuento_valor", "Valor del descuento", { inputmode: "decimal", enterkeyhint: "done", placeholder: "0" }); dval.hidden = l.descuento_tipo === "ninguno";
  const lblVal = h("label", { class: "campo", hidden: dval.hidden }, h("span", { class: "campo-et" }, "Valor"), dval), filaDesc = h("div", { class: `ed-fila${dval.hidden ? " ed-solo" : ""}` });
  const mostrarValor = () => { lblVal.hidden = dval.hidden; filaDesc.classList.toggle("ed-solo", dval.hidden); };
  // «Siguiente»/Intro: descripción → cantidad → precio; en el precio, Intro guarda (o pasa al valor del descuento si se eligió uno); en el valor del descuento, Intro guarda.
  const orden = () => [desc, cant, precio, ...(dval.hidden ? [] : [dval])];
  function siguiente(ev) {
    if (ev.key !== "Enter" || ev.isComposing) return; ev.preventDefault();
    const o = orden(), i = o.indexOf(ev.target);
    if (i >= 0 && i < o.length - 1) { o[i + 1].focus(); return; }
    guardar(nuevo);   // último campo: guarda (y en modo nuevo, deja lista la hoja para el siguiente ítem)
  }
  function actualizar() { try { neto.textContent = quetzales(calcular([l]).lineas[0].neto); } catch { neto.textContent = "—"; } }
  function guardar(otro) {
    if (agregados > 0 && !String(l.descripcion).trim() && !String(l.precio_unitario).trim()) { m.cerrar(); return; }   // la hoja quedó en blanco tras «Agregar y otro»: Agregar/Intro = terminar
    const p = problemaLinea(l, n);
    if (p) { err.textContent = p.msg; m.caja.querySelector(`[data-campo="${p.campo}"]`)?.focus(); return; }
    onGuardar({ ...l }); agregados++;
    if (otro) { n++; l = lineaVacia(); desc.value = ""; cant.value = l.cantidad; precio.value = ""; dtipo.value = "ninguno"; dval.value = "0"; dval.hidden = true; mostrarValor(); err.textContent = "";
      aviso.textContent = `Ítem ${n - 1} agregado.`; titulo.textContent = `Ítem ${n}`; actualizar(); desc.focus(); }
    else m.cerrar();
  }
  const titulo = h("span", {}, `Ítem ${n}`);
  const cuerpo = h("form", { class: "ed-form", onsubmit: (e) => { e.preventDefault(); guardar(nuevo); } },
    h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Descripción"), desc), dl,
    h("div", { class: "ed-fila" }, h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Cantidad"), cant), h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Precio (Q)"), precio)),
    (filaDesc.append(h("label", { class: "campo" }, h("span", { class: "campo-et" }, "Descuento"), dtipo), lblVal), filaDesc),
    h("div", { class: "ed-neto" }, h("span", {}, "Neto del ítem"), neto), aviso, err);
  const pie = [
    !nuevo && onQuitar ? boton("Quitar", { tipo: "peligro", id: "ed-quitar", onclick: () => { m.cerrar(); onQuitar(); } }) : null,
    boton("Cancelar", { tipo: "sec", id: "ed-cancelar", onclick: () => m.cerrar() }),
    nuevo ? boton("Agregar y otro", { tipo: "sec", id: "ed-otro", onclick: () => guardar(true) }) : null,
    boton(nuevo ? "Agregar" : "Guardar", { id: "ed-guardar", onclick: () => guardar(false) }),
  ].filter(Boolean);
  m = modal({ titulo: "Ítem", ancho: "md", contenido: cuerpo, pie });
  const cab = m.caja.querySelector(".modal-cab h2"); cab.replaceChildren(titulo); m.caja.setAttribute("aria-label", "Editor de ítem");
  m.caja.parentElement.classList.add("hoja"); m.caja.classList.add("hoja-item");
  actualizar(); desc.focus();
  return m;
}
