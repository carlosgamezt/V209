// Panel «Digifact TEST» de una factura. El navegador SOLO habla con la API de NEXA (misma sesión); jamás con Digifact, y nunca recibe credenciales ni tokens.
// Certificar exige tres pasos manuales: Validar → Preparar (muestra referencia y huella) → escribir la confirmación y repetir referencia y huella.
import { h, boton, insignia, campo, mensajeError, poner } from "/app/js/ui.js";
import { api } from "./api.js";

const TONO = { preparada: "azul", enviando: "ambar", certificada: "verde", rechazada: "rojo", desconocida: "ambar", no_enviada: "gris" };
const NOMBRE = { preparada: "Preparada (nada enviado)", enviando: "Enviando", certificada: "Certificada en TEST", rechazada: "Rechazada (confirmado)", desconocida: "Por verificar", no_enviada: "No enviada" };

export function panelDigifact({ ctx, doc, recargar, mostrarError }) {
  const cuerpo = h("div", {});
  const tarjeta = h("div", { class: "card", "data-panel": "digifact-test" }, h("h2", { class: "card-t" }, "Digifact TEST · certificación real de pruebas"), cuerpo);
  const puedeVer = ctx.tiene("fiscal.ver"), puedeCert = ctx.tiene("fiscal.certificar");
  let ocupado = false, preparacion = null, resultadoValidar = null, aviso = "";
  const conf = { texto: "", referencia: "", huella: "" };

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
    const prep = preparacion ?? ops.find((o) => o.estado === "preparada" && o.documentoId === doc.id) ?? null;
    const partes = [h("p", { class: "mut" }, "Ambiente de PRUEBAS de Digifact. Producción, anulación y nota de crédito están cerradas. Cada certificación real necesita tu confirmación y la autorización expresa de esa prueba.")];
    if (aviso) partes.push(h("p", { class: "err", role: "alert", id: "digifact-aviso" }, aviso));
    if (resultadoValidar) partes.push(resultadoValidar.ok
      ? h("p", { class: "ok", id: "digifact-validacion" }, `Factura válida para Digifact. Total: Q${resultadoValidar.total}.`)
      : h("div", { id: "digifact-validacion", role: "alert" }, h("strong", {}, "La factura no cumple:"), h("ul", {}, ...resultadoValidar.errores.map((x) => h("li", {}, `${x.campo}: ${x.mensaje}`)))));
    if (puedeVer) partes.push(h("div", { class: "acciones-fila" }, boton("Validar factura", { tipo: "sec", id: "digifact-validar", disabled: ocupado, onclick: correr(async () => { resultadoValidar = await api.digifactValidar(doc.id); }) })));
    // operaciones reales de ESTE documento
    for (const o of ops) {
      partes.push(h("div", { class: "bloqueo bloqueo-azul", "data-digifact-op": o.estado },
        h("div", {}, h("div", { class: "celda-tags" }, insignia(NOMBRE[o.estado] ?? o.estado, TONO[o.estado] ?? "gris")), h("small", { class: "mono" }, `Referencia ${o.referencia}`),
          o.resultado?.autorizacion ? h("dl", { class: "datos-sim" }, h("dt", {}, "Serie"), h("dd", { class: "mono" }, o.resultado.serie ?? ""), h("dt", {}, "Número"), h("dd", { class: "mono" }, o.resultado.numero ?? ""), h("dt", {}, "Autorización"), h("dd", { class: "mono" }, o.resultado.autorizacion)) : null,
          o.estado === "rechazada" ? h("small", {}, `Digifact rechazó el documento: ${o.resultado?.mensaje ?? ""}`) : null,
          o.estado === "desconocida" ? h("small", {}, "No se sabe si Digifact lo certificó. NO se reenvía: consulta por la referencia.") : null),
        o.estado === "desconocida" || o.estado === "enviando" ? boton("Consultar a Digifact", { tipo: "sec", id: "digifact-conciliar", disabled: ocupado || !puedeVer, onclick: correr(async () => { const r = await api.digifactConciliar(doc.id, o.id); aviso = r.aviso ?? ""; }) }) : null));
    }
    // preparar / certificar (solo si no hay operación que bloquee)
    if (!activa && puedeCert) {
      if (!prep) partes.push(h("div", { class: "acciones-fila" }, boton("Preparar certificación en TEST", { id: "digifact-preparar", disabled: ocupado || doc.estado_preparacion !== "revisado", title: doc.estado_preparacion !== "revisado" ? "Primero marca el documento como revisado" : null,
        onclick: correr(async () => { preparacion = await api.digifactPreparar(doc.id); resultadoValidar = null; conf.texto = conf.referencia = conf.huella = ""; }) })));
      else {
        const btn = boton("Certificar en TEST (una sola vez)", { tipo: "peligro", id: "digifact-certificar", disabled: true, onclick: correr(async () => {
          const r = await api.digifactCertificar(doc.id, { operacionId: prep.operacionId ?? prep.id, confirmacion: conf.texto, referencia: conf.referencia, huellaEmisor: conf.huella });
          preparacion = null; aviso = r.reutilizada ? "Ya había una operación: no se envió nada nuevo." : r.error ? `No se envió: ${r.error.mensaje}` : ""; await recargar?.();
        }) });
        const habilitar = () => { btn.disabled = ocupado || conf.texto !== "CERTIFICAR-TEST" || conf.referencia.trim() !== (prep.referencia) || conf.huella.trim() !== (prep.huellaEmisor); };
        const inp = (k, et, ph) => h("input", { "aria-label": et, placeholder: ph, autocomplete: "off", spellcheck: "false", value: conf[k], oninput: (e) => { conf[k] = e.target.value; habilitar(); } });
        partes.push(h("div", { class: "form", id: "digifact-preparada" },
          h("dl", { class: "datos-sim" }, h("dt", {}, "Referencia"), h("dd", { class: "mono" }, prep.referencia), h("dt", {}, "Total"), h("dd", {}, `Q${prep.total}`), h("dt", {}, "Fecha de emisión"), h("dd", { class: "mono" }, prep.fechaEmision), h("dt", {}, "Huella del emisor"), h("dd", { class: "mono" }, prep.huellaEmisor)),
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
