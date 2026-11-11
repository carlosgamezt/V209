// Formulario del simulador FEL (SIMULADO - SIN VALOR FISCAL). Todo el contenido dinámico se inserta con textContent (nunca innerHTML).
(() => {
  const id = location.pathname.split("/")[2];
  const $ = (x) => document.getElementById(x);
  let csrf = null, enviando = false, contadorLineas = 0;
  const mostrar = (cual) => { for (const s of ["seccion-edicion", "seccion-previa", "seccion-resultado"]) $(s).hidden = s !== cual; };
  const errores = (lista) => {
    const c = $("errores"); c.replaceChildren();
    document.querySelectorAll(".invalido").forEach((e) => e.classList.remove("invalido"));
    if (!lista || lista.length === 0) { c.hidden = true; return; }
    const ul = document.createElement("ul");
    for (const e of lista) { const li = document.createElement("li"); li.textContent = e.mensaje; ul.append(li); const el = $(e.campo) ?? document.querySelector(`[data-campo="${e.campo}"]`); if (el) el.classList.add("invalido"); }
    c.append(ul); c.hidden = false;
  };
  const estado = (t) => { $("estado-sesion").textContent = t; };
  const llamar = async (ruta, cuerpo) => {
    const r = await fetch(`/f/${id}/${ruta}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { estado: r.status, cuerpo: j };
  };

  function nuevaLinea(v = {}) {
    const n = ++contadorLineas, d = document.createElement("div"); d.className = "linea"; d.dataset.n = String(n);
    const campo = (clave, etiqueta, tipo = "text") => {
      const l = document.createElement("label"); l.textContent = etiqueta;
      const i = tipo === "select" ? document.createElement("select") : document.createElement("input");
      if (tipo === "select") for (const o of ["", "Bien", "Servicio"]) { const op = document.createElement("option"); op.value = o; op.textContent = o || "— elegir —"; i.append(op); } else i.type = "text";
      i.dataset.k = clave; i.dataset.campo = `linea-${n}-${clave}`; i.name = `linea_${n}_${clave}`; i.value = v[clave] ?? ""; l.append(i); d.append(l); return i;
    };
    campo("tipo", "Tipo", "select"); campo("descripcion", "Descripción"); campo("cantidad", "Cantidad"); campo("precio_unitario", "Precio unitario"); campo("descuento", "Descuento");
    const q = document.createElement("button"); q.type = "button"; q.textContent = "Quitar"; q.addEventListener("click", () => { d.remove(); }); d.append(q);
    $("lineas").append(d);
  }
  // Los data-campo de línea usan los mismos nombres que devuelve el servidor (linea-N-tipo|descripcion|cantidad|precio|descuento)
  const alias = { precio_unitario: "precio" };
  function leerFormulario() {
    const lineas = [...document.querySelectorAll(".linea")].map((d) => { const o = {}; d.querySelectorAll("[data-k]").forEach((i) => { o[i.dataset.k] = i.value; }); return o; });
    return {
      tipo_documento: $("tipo_documento").value, fecha: $("fecha").value.trim(), moneda: $("moneda").value,
      establecimiento: { codigo: $("establecimiento_codigo").value.trim() },
      receptor: { tipo_id: $("receptor_tipo").value, id: $("receptor_id").value.trim(), nombre: $("receptor_nombre").value, direccion: $("receptor_direccion").value },
      lineas, observaciones: $("observaciones").value,
    };
  }
  function marcarLineas() { document.querySelectorAll(".linea [data-k]").forEach((i) => { const k = alias[i.dataset.k] ?? i.dataset.k; i.dataset.campo = `linea-${i.closest(".linea").dataset.n}-${k}`; }); }

  function pintarPrevia(r) {
    const dl = $("previa-datos"); dl.replaceChildren();
    const par = (k, v) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); };
    par("Documento", r.tipo_documento); par("Fecha", r.fecha); par("Moneda", r.moneda); par("Establecimiento", r.establecimiento);
    par("Receptor", `${r.receptor.nombre} (${r.receptor.tipo_id} ${r.receptor.id})`); if (r.receptor.direccion) par("Dirección", r.receptor.direccion);
    if (r.observaciones) par("Observaciones", r.observaciones);
    const tb = $("previa-tabla").querySelector("tbody"); tb.replaceChildren();
    for (const l of r.lineas) { const tr = document.createElement("tr"); for (const v of [l.n, l.tipo, l.descripcion, l.cantidad, l.precio_unitario, l.importe, l.descuento, l.neto]) { const td = document.createElement("td"); td.textContent = String(v); tr.append(td); } tb.append(tr); }
    $("previa-subtotal").textContent = r.subtotal; $("previa-descuentos").textContent = r.descuentos; $("previa-total").textContent = r.total;
  }

  $("btn-agregar").addEventListener("click", () => { nuevaLinea(); marcarLineas(); });
  $("formulario").addEventListener("submit", async (ev) => {
    ev.preventDefault(); if (enviando) return; enviando = true; marcarLineas();
    try {
      const r = await llamar("vista-previa", { formulario: leerFormulario() });
      if (r.estado === 200 && r.cuerpo.ok) { errores([]); csrf = r.cuerpo.csrf; pintarPrevia(r.cuerpo.resumen); mostrar("seccion-previa"); estado("Vista previa lista. Falta la confirmación de una persona."); }
      else if (r.estado === 422) { errores(r.cuerpo.errores); estado("Hay datos por corregir."); }
      else { errores([{ campo: "formulario", mensaje: r.cuerpo?.mensaje ?? "No se pudo generar la vista previa" }]); }
    } finally { enviando = false; }
  });
  $("btn-editar").addEventListener("click", async () => { const r = await llamar("editar"); if (r.estado === 200) { csrf = null; mostrar("seccion-edicion"); estado("Editando."); } else errores([{ campo: "formulario", mensaje: r.cuerpo?.mensaje ?? "Error" }]); });
  $("btn-descartar").addEventListener("click", async () => {
    const r = await llamar("descartar", { csrf });
    if (r.estado === 200) { mostrar("seccion-resultado"); $("resultado-titulo").textContent = "Operación descartada"; $("resultado-detalle").textContent = "No se registró ninguna emisión."; estado("Descartada."); }
    else errores([{ campo: "formulario", mensaje: r.cuerpo?.mensaje ?? "Error" }]);
  });
  $("btn-confirmar").addEventListener("click", async () => {
    if (enviando) return; enviando = true; $("btn-confirmar").disabled = true;           // un solo envío por clic: se evita el doble clic
    try {
      let r; try { r = await llamar("confirmar", { csrf }); } catch { r = null; }
      if (r === null) { mostrar("seccion-resultado"); $("resultado-titulo").textContent = "Conexión interrumpida"; $("resultado-detalle").textContent = "No se recibió respuesta. NO repita la operación: primero verifique si la emisión simulada quedó registrada."; estado("Resultado incierto."); }
      else if (r.estado === 200) { mostrar("seccion-resultado"); const e = r.cuerpo.emision; $("resultado-titulo").textContent = "Emisión simulada registrada"; $("resultado-detalle").textContent = `Serie ${e.serie} · Número ${e.numero} · Autorización ${e.autorizacion} · SIMULADO - SIN VALOR FISCAL`; estado("Confirmada."); }
      else if (r.estado === 409 && r.cuerpo?.error === "YA_CONFIRMADA") { mostrar("seccion-resultado"); $("resultado-titulo").textContent = "La sesión ya estaba confirmada"; $("resultado-detalle").textContent = "Una confirmación anterior sí quedó registrada (por ejemplo, tras un corte de conexión). NO repita la operación: verifique el libro de emisiones simuladas."; estado("Ya confirmada."); }
      else { errores([{ campo: "formulario", mensaje: r.cuerpo?.mensaje ?? "Error del servidor simulado" }]); $("btn-confirmar").disabled = r.estado !== 500 ? false : true; estado("La confirmación no se completó."); }
    } finally { enviando = false; }
  });
  nuevaLinea(); marcarLineas(); mostrar("seccion-edicion"); estado("Formulario listo.");
})();
