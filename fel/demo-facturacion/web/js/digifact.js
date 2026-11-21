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
  let ocupado = false, preparacion = null, resultadoValidar = null, aviso = "", info = "", temporizador = null;
  const conf = { texto: "", referencia: "", huella: "" };
  // «Enviar factura por correo»: lo envía DIGIFACT al certificar, con su plantilla. Apagado por defecto; el correo sale del cliente (lo trae el SERVIDOR, solo de la empresa de la sesión) y se puede editar. El servidor valida el permiso, la lista de destinatarios de prueba y el formato.
  // «clienteVisto»: el cliente del que se tomó el correo. Si el cliente del documento cambia, se descarta el correo anterior (escrito o prellenado), se apaga la casilla y se pide preparar de nuevo: nunca se conserva el correo de otro cliente.
  const correo = { activo: false, texto: "", editado: false }; let origen = null, clienteVisto = "?";
  const RE_CORREO = /^[^\s@<>,;'"()\[\]\\]{1,40}@[A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,10}$/;
  const correoOk = () => correo.texto.trim().length <= 50 && RE_CORREO.test(correo.texto.trim());
  const extraCorreo = () => (correo.activo ? { enviar_correo: true, correo: correo.texto.trim() } : {});
  const sinCorreoValido = () => correo.activo && !correoOk();
  const mascara = (c) => { const [u, dm] = c.split("@"); return `${(u ?? "").slice(0, 1)}***@${dm ?? ""}`; };
  const cuandoGt = (iso) => { const f = new Date(iso); return Number.isNaN(f.getTime()) ? "—" : `${f.toLocaleString("es-GT", { timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} (hora de Guatemala)`; };
  const conVigencia = (p) => ({ ...p, vigenteHasta: Date.now() + (p.caducaEnMs ?? 0) });
  const vencida = (p) => !!p?.vigenteHasta && Date.now() > p.vigenteHasta;
  const horaGt = (ms) => new Date(ms).toLocaleTimeString("es-GT", { timeZone: "America/Guatemala", hour: "2-digit", minute: "2-digit", hour12: false });
  const vigenciaTexto = (p) => (p?.vigenteHasta ? `${horaGt(p.vigenteHasta)} (hora de Guatemala)${p.renovaciones ? ` · renovada ${p.renovaciones} ${p.renovaciones === 1 ? "vez" : "veces"}` : ""}` : "—");
  const infoPrep = (p) => (p.renovada ? "La preparación había vencido y se RENOVÓ: misma operación, referencia y huella. No se envió nada ni se autorizó nada." : "");
  const reglas = [];   // [elemento, () => deshabilitado]: se reevalúan al escribir el correo, sin volver a pintar
  const textos = [];   // funciones que repintan textos que dependen del correo (p. ej. el resumen de la preparación)
  const refrescarReglas = () => { reglas.forEach(([el, f]) => { el.disabled = f(); }); textos.forEach((f) => f()); };
  const controlCorreo = () => {
    const entrada = h("input", { type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", spellcheck: "false", maxlength: 50, id: "digifact-correo", "aria-label": "Correo del destinatario", placeholder: "correo@ejemplo.com", value: correo.texto });
    const nota = h("small", { class: "campo-ayuda", id: "digifact-correo-nota", role: "status" });
    const bloque = h("div", { class: "form", id: "digifact-correo-campo", hidden: !correo.activo }, campo("Correo del destinatario", entrada), nota);
    const pintarNota = () => { const t = correo.texto.trim(); nota.className = correoOk() ? "campo-ayuda" : "err"; nota.textContent = !t ? (origen?.consumidorFinal ? "Consumidor Final: el correo es opcional. Escríbelo si quieres enviar la factura." : origen?.registradoNoValido ? "El correo registrado del cliente no es válido: escribe otro." : "El cliente no tiene correo registrado: escríbelo.") : !correoOk() ? "Escribe un correo válido (hasta 50 caracteres)." : !correo.editado && origen?.correo && t === origen.correo ? "Tomado del cliente: puedes editarlo." : "Correo escrito por ti."; };
    entrada.addEventListener("input", () => { correo.texto = entrada.value; correo.editado = correo.texto.trim() !== (origen?.correo ?? ""); pintarNota(); refrescarReglas(); });
    const chk = h("input", { type: "checkbox", id: "digifact-correo-chk", checked: correo.activo, onchange: (e) => { correo.activo = e.target.checked; bloque.hidden = !correo.activo; chkCaja.classList.toggle("on", correo.activo); pintarNota(); refrescarReglas(); } });
    const chkCaja = h("label", { class: `chk-correo${correo.activo ? " on" : ""}` }, chk, h("span", {}, h("b", {}, "Enviar factura por correo"), h("small", {}, "Digifact envía el correo al certificar, con su plantilla. Solo se puede pedir ahora: después no se puede reenviar desde NEXA. En pruebas solo a correos autorizados.")));
    pintarNota();
    return h("div", { class: "correo-dg" }, chkCaja, bloque);
  };

  const correr = (f) => async () => {
    if (ocupado) return; ocupado = true; mostrarError(""); aviso = ""; info = "";
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
    if (puedeElegirCorreo) {   // el correo registrado del cliente de ESTE documento, desde el servidor (no se confía en lo que el navegador tenía de antes)
      try { origen = await api.destinatarioDigifact(doc.id); } catch { origen = null; }
      const vistoAhora = origen ? String(origen.clienteId) : "?";
      if (origen && vistoAhora !== clienteVisto) {
        const habiaCliente = clienteVisto !== "?"; clienteVisto = vistoAhora;
        correo.texto = origen.correo ?? ""; correo.activo = false; correo.editado = false;   // otro cliente: ni su correo ni la casilla se arrastran
        if (habiaCliente) { preparacion = null; resultadoValidar = null; aviso = "El cliente del documento cambió: revisa el correo del destinatario y vuelve a preparar la certificación."; }
      }
    }
    let cs = null; if (puedeVer && ops.some((o) => ["enviando", "certificada", "desconocida", "rechazada"].includes(o.estado))) { try { cs = await api.correoDeDigifact(doc.id); } catch { cs = null; } }
    reglas.length = 0; textos.length = 0;
    const prep = preparacion ?? ops.find((o) => o.estado === "preparada" && o.documentoId === doc.id) ?? null;
    const persistente = est.almacenamiento === "persistente";
    const partes = [h("p", { class: "mut", id: "digifact-estado-real" }, `Ambiente de PRUEBAS de Digifact. Certificación: ${est.certificacion ? "habilitada" : "apagada"}. Almacenamiento: ${persistente ? "persistente (la base guarda el resultado)" : "TEMPORAL (no se certifica)"}. Producción, anulación y nota de crédito están cerradas.`)];
    if (!persistente) partes.push(h("p", { class: "err", role: "alert", id: "digifact-sin-almacen" }, "El almacén de Digifact no es persistente: sin la migración 29 no se envía nada real a Digifact. Es una protección, no un fallo."));
    if (aviso) partes.push(h("p", { class: "err", role: "alert", id: "digifact-aviso" }, aviso));
    if (info) partes.push(h("p", { class: "aviso aviso-azul", role: "status", id: "digifact-info" }, icono("info"), h("span", {}, info)));
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
          o.estado === "desconocida" && o.resultado?.motivoDesconocido === "ya_existia_en_digifact" ? h("small", { class: "err", id: "digifact-ya-existia" }, "Digifact YA tiene un documento con esta referencia: NO se envió nada. Usa «Consultar a Digifact» para registrar su resultado (UUID, serie, número, XML y PDF).") : null,
          o.estado === "no_enviada" ? h("small", { id: "digifact-no-enviada" }, o.resultado?.codigo === "preparacion_caducada" ? "Preparación descartada: agotó sus renovaciones y NUNCA se envió. Se prepara una nueva con otra referencia." : "No se envió nada a Digifact.") : null,
          o.estado === "rechazada" ? h("small", {}, `Digifact rechazó el documento: ${o.resultado?.mensaje ?? ""}`) : null,
          o.estado === "desconocida" && !o.resultado?.motivoDesconocido?.match(/^(resultado_no_registrable|ya_existia_en_digifact)$/) ? h("small", { id: "digifact-bloqueo" }, "No se sabe si Digifact lo certificó. Mientras tanto el documento queda BLOQUEADO: no se prepara ni se envía otro. NO se reenvía: consulta por la referencia.") : null,
          o.estado === "enviando" ? h("small", { id: "digifact-bloqueo" }, "Hay un envío en curso (o se interrumpió). El documento queda BLOQUEADO y NO se reenvía: consulta a Digifact por la referencia.") : null),
        o.estado === "desconocida" || o.estado === "enviando" ? boton("Consultar a Digifact", { tipo: "sec", id: "digifact-conciliar", disabled: ocupado || !puedeVer, onclick: correr(async () => { const r = await api.digifactConciliar(doc.id, o.id); info = r.aviso ?? (r.resultado === "certificada" ? "Digifact certificó el documento: se registró su UUID, serie, número, XML y PDF." : r.resultado === "sin_cambios" ? "Sin cambios: Digifact aún no informa este documento." : ""); }) }) : null));
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
          onclick: correr(async () => { preparacion = conVigencia({ ...(await api.digifactPreparar(doc.id, puedeElegirCorreo ? extraCorreo() : {})), _correo: correo.activo ? correo.texto.trim().toLowerCase() : "" }); resultadoValidar = null; conf.texto = conf.referencia = conf.huella = ""; info = infoPrep(preparacion); }) });
        reglas.push([bp, regla]); partes.push(h("div", { class: "acciones-fila" }, bp)); }
      else {
        const btn = boton("Certificar en TEST (una sola vez)", { tipo: "peligro", id: "digifact-certificar", disabled: true, onclick: correr(async () => {
          const r = await api.digifactCertificar(doc.id, { operacionId: prep.operacionId ?? prep.id, confirmacion: conf.texto, referencia: conf.referencia, huellaEmisor: conf.huella }, puedeElegirCorreo ? { ...extraCorreo(), ...(correo.activo ? { correo_ref: prep.correoRef } : {}) } : {});
          preparacion = null; if (r.reutilizada) info = "Ya había una operación: no se envió nada nuevo."; else if (r.error) aviso = `No se envió: ${r.error.mensaje}`; else if (r.aviso) info = r.aviso; await recargar?.();
        }) });
        // con el correo marcado, la preparación debe haberse hecho con ESTE mismo correo: si se cambió o se marcó después, hay que actualizarla (el servidor lo exige con la huella «correo_ref»)
        const prepCorreoOk = () => !(puedeElegirCorreo && correo.activo) || (!!prep.correoRef && prep._correo === correo.texto.trim().toLowerCase());
        const habilitar = () => { btn.disabled = ocupado || vencida(prep) || conf.texto !== "CERTIFICAR-TEST" || conf.referencia.trim() !== (prep.referencia) || conf.huella.trim() !== (prep.huellaEmisor) || (puedeElegirCorreo && (sinCorreoValido() || !prepCorreoOk())); };
        const brep = boton("Actualizar la preparación con este correo", { tipo: "sec", id: "digifact-repreparar", disabled: true, onclick: correr(async () => { preparacion = conVigencia({ ...(await api.digifactPreparar(doc.id, extraCorreo())), _correo: correo.texto.trim().toLowerCase() }); info = infoPrep(preparacion); }) });
        const bloqueRep = h("div", { class: "form", id: "digifact-repreparar-bloque", hidden: true }, h("p", { class: "err", role: "status" }, "La preparación se hizo con otro correo (o sin correo). Actualízala antes de certificar."), brep);
        reglas.push([brep, () => ocupado || !correo.activo || !correoOk()]); textos.push(() => { bloqueRep.hidden = prepCorreoOk(); }); reglas.push([btn, () => { habilitar(); return btn.disabled; }]);
        const inp = (k, et, ph) => h("input", { "aria-label": et, placeholder: ph, autocomplete: "off", spellcheck: "false", value: conf[k], oninput: (e) => { conf[k] = e.target.value; habilitar(); } });
        const ddCorreo = h("dd", { id: "digifact-correo-resumen" }); const pintarResumen = () => { ddCorreo.textContent = correo.activo ? (!correoOk() ? "Correo no válido" : !prepCorreoOk() ? "Correo distinto al preparado: actualiza la preparación" : `Digifact enviará a ${mascara(correo.texto.trim())} al certificar`) : "No se enviará correo"; }; pintarResumen(); textos.push(pintarResumen); bloqueRep.hidden = prepCorreoOk();
        partes.push(h("div", { class: "form", id: "digifact-preparada" },
          h("dl", { class: "datos-sim" }, h("dt", {}, "Referencia"), h("dd", { class: "mono" }, prep.referencia), h("dt", {}, "Total"), h("dd", {}, `Q${prep.total}`), h("dt", {}, "Fecha de emisión"), h("dd", { class: "mono" }, prep.fechaEmision), h("dt", {}, "Huella del emisor"), h("dd", { class: "mono" }, prep.huellaEmisor), h("dt", {}, "Vigente hasta"), h("dd", { id: "digifact-vigencia" }, vigenciaTexto(prep)), ...(puedeElegirCorreo ? [h("dt", {}, "Correo"), ddCorreo] : [])),
          h("p", { class: "mut" }, "Revisa lo anterior. Para enviar UNA vez a Digifact TEST escribe CERTIFICAR-TEST y repite la referencia y la huella. Renovar la vigencia no autoriza nada: sigue haciendo falta la autorización expresa de esta referencia."), ...(vencida(prep) ? [h("div", { class: "form", id: "digifact-vencida" }, h("p", { class: "err", role: "status" }, "La preparación venció. Renuévala (misma referencia y huella; no se envía nada)."), boton("Renovar la preparación", { tipo: "sec", id: "digifact-renovar", disabled: ocupado || (puedeElegirCorreo && sinCorreoValido()), onclick: correr(async () => { preparacion = conVigencia({ ...(await api.digifactPreparar(doc.id, puedeElegirCorreo ? extraCorreo() : {})), _correo: correo.activo ? correo.texto.trim().toLowerCase() : "" }); conf.texto = conf.referencia = conf.huella = ""; info = infoPrep(preparacion); }) }))] : []), ...(puedeElegirCorreo ? [bloqueRep] : []),
          campo("Confirmación", inp("texto", "Confirmación escrita", "CERTIFICAR-TEST")), campo("Referencia", inp("referencia", "Referencia repetida", "pega la referencia")), campo("Huella del emisor", inp("huella", "Huella repetida", "pega la huella")), btn));
        habilitar();
      }
    }
    if (!puedeCert && !puedeVer) partes.push(h("p", { class: "mut" }, "Tu rol no puede usar Digifact TEST."));
    partes.push(h("small", { class: "campo-ayuda", id: "digifact-pie" }, persistente ? "Al certificar, NEXA guarda en el documento el estado fiscal, la serie, el número y la autorización que entregó Digifact, y conserva el XML y el PDF reales (solo de tu empresa, con su SHA-256). Es el ambiente de pruebas: no tiene valor fiscal." : "Sin almacén persistente no se guarda ni se envía nada real."));
    if (temporizador) clearTimeout(temporizador); const pr = preparacion ?? ops.find((o) => o.estado === "preparada") ?? null;   // al vencer la preparación se repinta sola (se ofrece renovarla)
    if (pr?.vigenteHasta && !vencida(pr)) temporizador = setTimeout(() => { if (tarjeta.isConnected) pintar(); }, Math.min(2_147_000_000, pr.vigenteHasta - Date.now() + 500));
    poner(cuerpo, ...partes);
  }
  pintar();
  return tarjeta;
}
