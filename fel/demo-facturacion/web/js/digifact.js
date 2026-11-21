// Panel «Digifact TEST» de una factura. El navegador SOLO habla con la API de NEXA (misma sesión); jamás con Digifact, y nunca recibe credenciales ni tokens.
// Certificar exige tres pasos manuales: Validar → Preparar (muestra referencia y huella) → escribir la confirmación y repetir referencia y huella.
import { h, boton, insignia, campo, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { api } from "./api.js";
import { descargarArchivo } from "./descarga.js";

const TONO = { preparada: "azul", enviando: "ambar", certificada: "verde", rechazada: "rojo", desconocida: "ambar", no_enviada: "gris" };
const NOMBRE = { preparada: "Preparada (nada enviado)", enviando: "Enviando", certificada: "Certificada en TEST", rechazada: "Rechazada (confirmado)", desconocida: "Por verificar", no_enviada: "No enviada" };

export function panelDigifact({ ctx, doc, recargar, mostrarError }) {
  const cuerpo = h("div", {});
  const tarjeta = h("div", { class: "card", "data-panel": "digifact-test" }, h("h2", { class: "card-t" }, "Digifact TEST · certificación real de pruebas"), cuerpo);
  const puedeVer = ctx.tiene("fiscal.ver"), puedeCert = ctx.tiene("fiscal.certificar");
  let ocupado = false, preparacion = null, resultadoValidar = null, aviso = "";
  const conf = { texto: "", referencia: "", huella: "" };
  // «Enviar factura por correo»: lo envía DIGIFACT al certificar, con su plantilla. Apagado por defecto; el correo sale del cliente y se puede editar. El servidor valida el permiso, la lista de destinatarios de prueba y el formato.
  const correo = { activo: false, texto: doc.cliente_email ?? "" };
  const RE_CORREO = /^[^\s@<>,;'"()\[\]\\]{1,40}@[A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,10}$/;
  const correoOk = () => correo.texto.trim().length <= 50 && RE_CORREO.test(correo.texto.trim());
  const extraCorreo = () => (correo.activo ? { enviar_correo: true, correo: correo.texto.trim() } : {});
  const sinCorreoValido = () => correo.activo && !correoOk();
  const mascara = (c) => { const [u, dm] = c.split("@"); return `${(u ?? "").slice(0, 1)}***@${dm ?? ""}`; };
  const cuandoGt = (iso) => { const f = new Date(iso); return Number.isNaN(f.getTime()) ? "—" : `${f.toLocaleString("es-GT", { timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} (hora de Guatemala)`; };
  const reglas = [];   // [elemento, () => deshabilitado]: se reevalúan al escribir el correo, sin volver a pintar
  const textos = [];   // funciones que repintan textos que dependen del correo (p. ej. el resumen de la preparación)
  const refrescarReglas = () => { reglas.forEach(([el, f]) => { el.disabled = f(); }); textos.forEach((f) => f()); };
  const controlCorreo = () => {
    const entrada = h("input", { type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", spellcheck: "false", maxlength: 50, id: "digifact-correo", "aria-label": "Correo del destinatario", placeholder: "correo@ejemplo.com", value: correo.texto });
    const nota = h("small", { class: "campo-ayuda", id: "digifact-correo-nota", role: "status" });
    const bloque = h("div", { class: "form", id: "digifact-correo-campo", hidden: !correo.activo }, campo("Correo del destinatario", entrada), nota);
    const pintarNota = () => { const t = correo.texto.trim(); nota.className = correoOk() ? "campo-ayuda" : "err"; nota.textContent = !t ? "Escribe el correo del destinatario." : !correoOk() ? "Escribe un correo válido (hasta 50 caracteres)." : t === (doc.cliente_email ?? "") ? "Tomado del cliente: puedes editarlo." : "Correo escrito por ti."; };
    entrada.addEventListener("input", () => { correo.texto = entrada.value; pintarNota(); refrescarReglas(); });
    const chk = h("input", { type: "checkbox", id: "digifact-correo-chk", checked: correo.activo, onchange: (e) => { correo.activo = e.target.checked; bloque.hidden = !correo.activo; chkCaja.classList.toggle("on", correo.activo); pintarNota(); refrescarReglas(); } });
    const chkCaja = h("label", { class: `chk-correo${correo.activo ? " on" : ""}` }, chk, h("span", {}, h("b", {}, "Enviar factura por correo"), h("small", {}, "Digifact envía el correo al certificar, con su plantilla. Solo se puede pedir ahora: después no se puede reenviar desde NEXA. En pruebas solo a correos autorizados.")));
    pintarNota();
    return h("div", { class: "correo-dg" }, chkCaja, bloque);
  };

  const correr = (f) => async () => {
    if (ocupado) return; ocupado = true; mostrarError(""); aviso = "";
    try { await f(); } catch (e) { mostrarError(e); aviso = mensajeError(e); if (e?.detalle?.errores) resultadoValidar = { ok: false, errores: e.detalle.errores }; }
    finally { ocupado = false; await pintar(); }
  };

  async function pintar() {
    let est, ops = [];
    try { est = await api.digifactEstado(); if (est.habilitado && puedeVer) ops = (await api.digifactDocumento(doc.id)).operaciones; }
    catch (e) { poner(cuerpo, h("p", { class: "err", role: "alert" }, mensajeError(e))); return; }
    if (!est.habilitado) { poner(cuerpo, h("p", { class: "mut", id: "digifact-no-habilitado" }, "Digifact TEST no está habilitado en este servidor. Las llamadas a Digifact solo ocurren en el servidor y requieren habilitarlo y autorizar cada prueba.")); return; }
    const activa = ops.find((o) => ["enviando", "certificada", "desconocida"].includes(o.estado));
    const puedeElegirCorreo = !!est.correoDigifact?.habilitado && puedeCert && !activa;
    let cs = null; if (puedeVer && ops.some((o) => ["enviando", "certificada", "desconocida", "rechazada"].includes(o.estado))) { try { cs = await api.correoDeDigifact(doc.id); } catch { cs = null; } }
    reglas.length = 0; textos.length = 0;
    const prep = preparacion ?? ops.find((o) => o.estado === "preparada" && o.documentoId === doc.id) ?? null;
    const partes = [h("p", { class: "mut" }, "Ambiente de PRUEBAS de Digifact. Producción, anulación y nota de crédito están cerradas. Cada certificación real necesita tu confirmación y la autorización expresa de esa prueba.")];
    if (aviso) partes.push(h("p", { class: "err", role: "alert", id: "digifact-aviso" }, aviso));
    if (resultadoValidar) partes.push(resultadoValidar.ok
      ? h("p", { class: "ok", id: "digifact-validacion" }, `Factura válida para Digifact. Total: Q${resultadoValidar.total}.`)
      : h("div", { id: "digifact-validacion", role: "alert" }, h("strong", {}, "La factura no cumple:"), h("ul", {}, ...resultadoValidar.errores.map((x) => h("li", {}, `${x.campo}: ${x.mensaje}`)))));
    if (puedeElegirCorreo) partes.push(controlCorreo());
    if (puedeVer) { const bv = boton("Validar factura", { tipo: "sec", id: "digifact-validar", disabled: ocupado || (puedeElegirCorreo && sinCorreoValido()), onclick: correr(async () => { resultadoValidar = await api.digifactValidar(doc.id, puedeElegirCorreo ? extraCorreo() : {}); }) }); reglas.push([bv, () => ocupado || (puedeElegirCorreo && sinCorreoValido())]); partes.push(h("div", { class: "acciones-fila" }, bv)); }
    // operaciones reales de ESTE documento
    for (const o of ops) {
      partes.push(h("div", { class: "bloqueo bloqueo-azul", "data-digifact-op": o.estado },
        h("div", {}, h("div", { class: "celda-tags" }, insignia(NOMBRE[o.estado] ?? o.estado, TONO[o.estado] ?? "gris")), h("small", { class: "mono" }, `Referencia ${o.referencia}`),
          o.resultado?.autorizacion ? h("dl", { class: "datos-sim" }, h("dt", {}, "Serie"), h("dd", { class: "mono" }, o.resultado.serie ?? ""), h("dt", {}, "Número"), h("dd", { class: "mono" }, o.resultado.numero ?? ""), h("dt", {}, "Autorización"), h("dd", { class: "mono" }, o.resultado.autorizacion)) : null,
          o.estado === "certificada" ? h("p", { class: "aviso aviso-azul", id: "digifact-certificada" }, icono("info"), h("span", {}, "Certificada en el ambiente de PRUEBAS de Digifact (TEST): los datos de arriba los entregó el certificador. No tiene valor fiscal.")) : null,
          o.estado === "certificada" && puedeVer ? h("div", { class: "acciones-fila" },
            boton("Descargar XML", { tipo: "sec", icon: "file", id: "digifact-xml", disabled: ocupado, onclick: correr(async () => { await descargarArchivo(`/api/documentos/${doc.id}/digifact/xml`, `DTE-${o.resultado.serie}-${o.resultado.numero}.xml`); }) }),
            boton("Descargar PDF", { tipo: "sec", icon: "file", id: "digifact-pdf", disabled: ocupado, onclick: correr(async () => { await descargarArchivo(`/api/documentos/${doc.id}/digifact/pdf`, `DTE-${o.resultado.serie}-${o.resultado.numero}.pdf`); }) })) : null,
          o.estado === "desconocida" && o.resultado?.motivoDesconocido === "resultado_no_registrable" ? h("small", { class: "err" }, "Digifact respondió, pero el resultado no se pudo registrar (autorización repetida). No se modificó el documento: requiere revisión manual.") : null,
          o.estado === "rechazada" ? h("small", {}, `Digifact rechazó el documento: ${o.resultado?.mensaje ?? ""}`) : null,
          o.estado === "desconocida" ? h("small", {}, "No se sabe si Digifact lo certificó. NO se reenvía: consulta por la referencia.") : null),
        o.estado === "desconocida" || o.estado === "enviando" ? boton("Consultar a Digifact", { tipo: "sec", id: "digifact-conciliar", disabled: ocupado || !puedeVer, onclick: correr(async () => { const r = await api.digifactConciliar(doc.id, o.id); aviso = r.aviso ?? ""; }) }) : null));
    }
    // qué sabe NEXA del correo: «envío solicitado a Digifact», nunca «entregado» (Digifact no da confirmación de entrega)
    if (cs?.solicitado) {
      const u = [...ops].reverse().find((o) => ["certificada", "desconocida", "rechazada", "enviando"].includes(o.estado));
      const est2 = u?.estado === "rechazada" ? ["Correo · no se envió", "gris", "Digifact rechazó el documento: no se envió ningún correo."] : u?.estado === "desconocida" || u?.estado === "enviando" ? ["Correo · solicitado, resultado incierto", "ambar", "No se sabe si Digifact certificó el documento; si lo hizo, el correo pudo enviarse. No se reenvía."] : ["Correo · envío solicitado a Digifact", "azul", "Digifact envió o enviará el correo con su plantilla. NEXA no recibe confirmación de entrega: revisa el buzón. No se puede reenviar desde NEXA."];
      partes.push(h("div", { class: "bloqueo bloqueo-azul", id: "digifact-correo-solicitado", "data-correo": u?.estado ?? "" }, h("div", { class: "celda-tags" }, insignia(est2[0], est2[1])),
        u?.estado === "rechazada" ? null : h("dl", { class: "datos-sim" }, h("dt", {}, "Para"), h("dd", {}, cs.destinatario || "—"), h("dt", {}, "Cuándo"), h("dd", {}, cuandoGt(cs.cuando))), h("small", {}, est2[2])));
    }
    // preparar / certificar (solo si no hay operación que bloquee)
    if (!activa && puedeCert) {
      if (!prep) { const regla = () => ocupado || doc.estado_preparacion !== "revisado" || (puedeElegirCorreo && sinCorreoValido());
        const bp = boton("Preparar certificación en TEST", { id: "digifact-preparar", disabled: regla(), title: doc.estado_preparacion !== "revisado" ? "Primero marca el documento como revisado" : null,
          onclick: correr(async () => { preparacion = await api.digifactPreparar(doc.id, puedeElegirCorreo ? extraCorreo() : {}); resultadoValidar = null; conf.texto = conf.referencia = conf.huella = ""; }) });
        reglas.push([bp, regla]); partes.push(h("div", { class: "acciones-fila" }, bp)); }
      else {
        const btn = boton("Certificar en TEST (una sola vez)", { tipo: "peligro", id: "digifact-certificar", disabled: true, onclick: correr(async () => {
          const r = await api.digifactCertificar(doc.id, { operacionId: prep.operacionId ?? prep.id, confirmacion: conf.texto, referencia: conf.referencia, huellaEmisor: conf.huella }, puedeElegirCorreo ? extraCorreo() : {});
          preparacion = null; aviso = r.reutilizada ? "Ya había una operación: no se envió nada nuevo." : r.error ? `No se envió: ${r.error.mensaje}` : ""; await recargar?.();
        }) });
        const habilitar = () => { btn.disabled = ocupado || conf.texto !== "CERTIFICAR-TEST" || conf.referencia.trim() !== (prep.referencia) || conf.huella.trim() !== (prep.huellaEmisor) || (puedeElegirCorreo && sinCorreoValido()); }; reglas.push([btn, () => { habilitar(); return btn.disabled; }]);
        const inp = (k, et, ph) => h("input", { "aria-label": et, placeholder: ph, autocomplete: "off", spellcheck: "false", value: conf[k], oninput: (e) => { conf[k] = e.target.value; habilitar(); } });
        const ddCorreo = h("dd", { id: "digifact-correo-resumen" }); const pintarResumen = () => { ddCorreo.textContent = correo.activo ? (correoOk() ? `Digifact enviará a ${mascara(correo.texto.trim())} al certificar` : "Correo no válido") : "No se enviará correo"; }; pintarResumen(); textos.push(pintarResumen);
        partes.push(h("div", { class: "form", id: "digifact-preparada" },
          h("dl", { class: "datos-sim" }, h("dt", {}, "Referencia"), h("dd", { class: "mono" }, prep.referencia), h("dt", {}, "Total"), h("dd", {}, `Q${prep.total}`), h("dt", {}, "Fecha de emisión"), h("dd", { class: "mono" }, prep.fechaEmision), h("dt", {}, "Huella del emisor"), h("dd", { class: "mono" }, prep.huellaEmisor), ...(puedeElegirCorreo ? [h("dt", {}, "Correo"), ddCorreo] : [])),
          h("p", { class: "mut" }, "Revisa lo anterior. Para enviar UNA vez a Digifact TEST escribe CERTIFICAR-TEST y repite la referencia y la huella."),
          campo("Confirmación", inp("texto", "Confirmación escrita", "CERTIFICAR-TEST")), campo("Referencia", inp("referencia", "Referencia repetida", "pega la referencia")), campo("Huella del emisor", inp("huella", "Huella repetida", "pega la huella")), btn));
        habilitar();
      }
    }
    if (!puedeCert && !puedeVer) partes.push(h("p", { class: "mut" }, "Tu rol no puede usar Digifact TEST."));
    partes.push(h("small", { class: "campo-ayuda" }, "El resultado real de Digifact aún no cambia el estado simulado del documento ni guarda el XML/PDF: eso llega con el almacenamiento persistente y privado."));
    poner(cuerpo, ...partes);
  }
  pintar();
  return tarjeta;
}
