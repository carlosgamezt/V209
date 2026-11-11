// Panel de proceso de una factura: estado de la operación, línea de tiempo, envío simulado, conciliación (automática y manual de dos personas),
// alertas y descargas. Todo se ejecuta en el servidor con el orquestador real; esta pantalla solo muestra y pide.
import { h, boton, insignia, campo, mensajeError, poner } from "/app/js/ui.js";
import { icono } from "/app/js/icons.js";
import { PREPARACION, FISCAL } from "/app/js/formato.js";
import { api, llamar, usuarioActual } from "./api.js";
import { vistaPrevia } from "./vista_previa.js";

let demoAbierto = false;   // los controles de la demostración permanecen abiertos mientras se usan
const claves = new Map();   // una clave de idempotencia por intención: se conserva si repites el envío por un fallo de red
const claveDe = (docId, nOps) => { const k = `${docId}:${nOps}`; if (!claves.has(k)) claves.set(k, crypto.randomUUID()); return claves.get(k); };
const hora = (t) => (t ? new Date(t).toLocaleTimeString("es-GT") : "");
const MOTIVOS = { timeout: "tiempo agotado", corte: "conexión cortada", respuesta_ilegible: "respuesta ilegible", codigo_no_mapeado: "código no reconocido", limite_o_caida: "límite o caída del servicio", excepcion_del_adaptador: "error del adaptador", proceso_caido: "el proceso se cayó", respuesta_no_aceptada: "respuesta no aceptada" };
const RESOLUCION = { proveedor: "resuelta por un evento verificable del proveedor", conciliacion_manual: "resuelta por conciliación manual de dos personas", sistema_no_enviada: "liberada: se probó que nunca se envió" };
const etiquetaEvento = (e) => ({
  "envio/certificado": "El proveedor respondió: certificado", "envio/rechazado_confirmado": "El proveedor rechazó el documento (confirmado)", "envio/requiere_accion_humana": "Pendiente de una persona (canal asistido)",
  "envio/desconocido": `Sin respuesta utilizable${e.motivo ? ` (${MOTIVOS[e.motivo] ?? e.motivo})` : ""}`,
  "conciliacion/certificado": "Consulta al proveedor: el documento existe", "conciliacion/no_existe_confirmado": "Consulta al proveedor: confirma que NO existe", "conciliacion/indeterminado": "Consulta al proveedor: no puede confirmar ni descartar",
}[`${e.tipo}/${e.resultado}`] ?? `${e.tipo}: ${e.resultado}`);

async function descargar(a) {
  const r = await fetch(`/api/artefactos/${a.id}`, { headers: { "x-demo-usuario": usuarioActual() } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensaje || "No se pudo descargar el archivo.");
  const url = URL.createObjectURL(await r.blob()), l = h("a", { href: url, download: `SIMULADO-${a.nombre}` }); document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function panelProceso({ ctx, det, sucio, recargar, avisar, mostrarError }) {
  const { documento: doc, operaciones, eventos, conciliaciones, alertas, artefactos, nombresUsuario } = det;
  const yo = ctx.estado.usuario.id;
  const abierta = operaciones.find((o) => o.estado === "iniciada" || o.estado === "desconocida");
  const alertaAbierta = alertas.find((a) => !a.resuelta_en);
  const exitosa = operaciones.find((o) => o.estado === "confirmada_exitosa");
  const ultEvCon = abierta ? [...eventos].reverse().find((e) => e.operacion_id === abierta.id && e.tipo === "conciliacion") : null;
  const propuesta = conciliaciones.find((c) => c.estado === "propuesta");
  let escenario = det.escenario ?? "exito", ocupado = false;
  const accion = (f, ok) => async () => { if (ocupado) return; ocupado = true; mostrarError(""); try { const r = await f(); ok?.(r); await recargar(r?.documento ? r : undefined); } catch (e) { mostrarError(e); } finally { ocupado = false; } };

  // ------------------------------------------------------------ estado
  const estadoCard = (() => {
    const [pt, ptono] = PREPARACION[doc.estado_preparacion], [ft, ftono] = FISCAL[doc.estado_fiscal];
    const partes = [h("div", { class: "celda-tags" }, insignia(pt, ptono), insignia(ft, ftono), insignia("SIMULADO - SIN VALOR FISCAL", "ambar"))];
    if (alertaAbierta) partes.push(h("div", { class: "bloqueo bloqueo-rojo", role: "alert", "data-estado": "alerta" }, icono("info"), h("div", {}, h("strong", {}, "Certificación huérfana: el proveedor certificó DESPUÉS de dar la operación por fallida"), h("small", {}, "Se bloquea cualquier operación nueva hasta resolver la alerta. Nada se reenvía."))));
    if (doc.estado_fiscal === "por_verificar") partes.push(h("div", { class: "bloqueo", role: "alert", "data-estado": "por_verificar" }, icono("lock"), h("div", {}, h("strong", {}, "Por verificar: resultado desconocido"), h("small", {}, "Los envíos nuevos están BLOQUEADOS hasta confirmar qué ocurrió con el proveedor. Marcar la operación como «fallida» no la libera."))));
    if (doc.estado_fiscal === "pendiente_certificacion") partes.push(h("div", { class: "bloqueo bloqueo-azul", role: "status", "data-estado": "pendiente" }, icono("info"), h("div", {}, h("strong", {}, abierta?.orden_externa ? "Esperando a una persona (canal asistido)" : "Operación en curso"), h("small", {}, abierta?.orden_externa ? "Así funcionará el futuro llenado asistido con Playwright: el sistema llena y una persona emite en el portal. Aquí es una simulación." : "La operación está abierta; no se permite otra mientras tanto."))));
    if (doc.estado_fiscal === "certificado") partes.push(h("div", { class: "resultado resultado-ok", "data-estado": "certificado" }, icono("circleCheck"), h("div", {}, h("strong", {}, "Certificado en SIMULACIÓN"),
      h("dl", { class: "datos-sim" }, h("dt", {}, "Serie"), h("dd", { class: "mono" }, doc.serie), h("dt", {}, "Número"), h("dd", { class: "mono" }, doc.numero_fiscal), h("dt", {}, "Autorización (simulada)"), h("dd", { class: "mono" }, doc.autorizacion_sat)),
      h("small", {}, "Estos datos NO son de SAT: llevan el prefijo SIM y no tienen valor fiscal."))));
    if (doc.estado_fiscal === "rechazado") partes.push(h("div", { class: "bloqueo bloqueo-rojo", role: "status", "data-estado": "rechazado" }, icono("info"), h("div", {}, h("strong", {}, "Rechazado (confirmado)"), h("small", {}, "Se confirmó que no existe documento. Puedes corregirlo o reintentar con otra clave."))));
    return h("div", { class: "card" }, h("h2", { class: "card-t" }, "Estado de la operación"), ...partes);
  })();

  // ------------------------------------------------------------ envío
  const puedeEnviar = doc.estado_preparacion === "revisado" && ["ninguno", "rechazado"].includes(doc.estado_fiscal) && !abierta && !alertaAbierta;
  const envio = (() => {
    if (!puedeEnviar) {
      const motivo = doc.estado_fiscal === "certificado" ? "Ya está certificado (simulación): no se puede volver a enviar."
        : doc.estado_fiscal === "por_verificar" ? "Bloqueado hasta conciliar el resultado desconocido."
        : doc.estado_fiscal === "pendiente_certificacion" ? "Hay una operación abierta."
        : alertaAbierta ? "Bloqueado por una alerta abierta."
        : doc.estado_preparacion !== "revisado" ? "Primero hay que guardar y marcar el documento como revisado."
        : "No disponible en este estado.";
      return h("div", { class: "card" }, h("h2", { class: "card-t" }, "Envío a certificación simulada"), h("p", { class: "mut", id: "motivo-sin-envio" }, motivo));
    }
    const sel = h("select", { "aria-label": "Comportamiento del proveedor simulado", onchange: (e) => { escenario = e.target.value; ayuda.textContent = ctx.estado.escenarios.find((x) => x.id === escenario)?.explicacion ?? ""; } },
      ...ctx.estado.escenarios.map((x) => h("option", { value: x.id, selected: x.id === escenario }, x.nombre)));
    const ayuda = h("small", { class: "campo-ayuda" }, ctx.estado.escenarios.find((x) => x.id === escenario)?.explicacion ?? "");
    const clave = claveDe(doc.id, operaciones.length);
    const permitido = ctx.tiene("fiscal.certificar");
    const b = boton("Enviar a certificación simulada", { icon: "check", id: "enviar", disabled: !permitido || sucio(), title: !permitido ? "Tu rol no puede certificar" : sucio() ? "Guarda los cambios primero" : null,
      onclick: accion(() => { b.disabled = true; return api.certificar(doc.id, clave, escenario); }, (r) => avisar(r.resultado.reutilizada ? "Esa clave ya tenía una operación: no se envió de nuevo" : r.resultado.estado === "confirmada_exitosa" ? "Certificado (simulación)" : r.resultado.estado === "confirmada_fallida" ? "El proveedor simulado rechazó el documento" : r.resultado.estado === "desconocida" ? "Resultado desconocido: queda por verificar" : "Operación en curso", r.resultado.estado === "confirmada_exitosa" ? "ok" : "error")) });
    return h("div", { class: "card" }, h("h2", { class: "card-t" }, "Envío a certificación simulada"),
      h("p", { class: "mut" }, "El documento se guarda como operación ANTES de enviarse y el envío se marca antes de salir. Solo se envía una vez por operación."),
      !permitido ? h("p", { class: "aviso" }, icono("lock"), h("span", {}, "Tu rol no puede certificar. Cambia de persona arriba (por ejemplo, Ana Torres).")) : null,
      campo("Comportamiento del proveedor simulado (solo para la demostración)", sel, {}), ayuda,
      h("p", { class: "mut clave-idem" }, "Clave de idempotencia de este intento: ", h("span", { class: "mono" }, `${clave.slice(0, 8)}…`), " · si repites el envío con la misma clave no se duplica."), b);
  })();

  // ------------------------------------------------------------ conciliación
  const conciliacion = (() => {
    if (!abierta || abierta.estado !== "desconocida") return null;
    const partes = [h("h2", { class: "card-t" }, "Conciliación")];
    partes.push(h("p", { class: "mut" }, "Para liberar el bloqueo hace falta un evento verificable del proveedor o una conciliación manual propuesta por una persona y aprobada por OTRA."));
    partes.push(boton("Consultar al proveedor", { icon: "search", id: "consultar", disabled: !ctx.tiene("fiscal.conciliar"), title: !ctx.tiene("fiscal.conciliar") ? "Tu rol no puede conciliar" : null,
      onclick: accion(() => api.conciliar(abierta.id), (r) => avisar(r.conciliacion.aplicado === "certificado" ? "El proveedor confirma que el documento existe: certificado (simulación)" : r.conciliacion.aplicado === "rechazado" ? "El proveedor confirma que NO existe: ya se puede reintentar" : "El proveedor no puede confirmar ni descartar: sigue bloqueado", r.conciliacion.aplicado === "sin_cambio" ? "error" : "ok")) }));
    if (ultEvCon?.resultado === "indeterminado") {
      partes.push(h("hr", { class: "sep" }), h("h3", { class: "sub" }, "Conciliación manual (dos personas)"));
      if (propuesta) {
        const esMia = propuesta.propuesta_por === yo, puede = ctx.tiene("conciliacion.aprobar") && !esMia;
        partes.push(h("div", { class: "propuesta", "data-estado": "propuesta" }, h("p", {}, h("strong", {}, `Propuesta de ${nombresUsuario[propuesta.propuesta_por] ?? "otra persona"}: `), propuesta.tipo === "manual_fallida" ? "el documento NO figura en el proveedor" : "el documento SÍ figura en el proveedor", ` · fuente: ${propuesta.evidencia.fuente} · referencia: ${propuesta.evidencia.referencia}`),
          esMia ? h("p", { class: "mut" }, "La aprueba otra persona: cambia de usuario arriba (por ejemplo, Luis Méndez).") : null,
          h("div", { class: "acciones-fila" }, boton("Aprobar", { id: "aprobar", icon: "check", disabled: !puede, onclick: accion(() => api.decidir(propuesta.id, true, "Verificado por una segunda persona"), () => avisar("Conciliación aprobada")) }),
            boton("Rechazar", { tipo: "peligro", disabled: !puede, onclick: accion(() => api.decidir(propuesta.id, false, "Rechazada por la segunda persona"), () => avisar("Conciliación rechazada")) }))));
      } else if (ctx.tiene("fiscal.conciliar")) {
        const fuente = h("select", { "aria-label": "Fuente de la evidencia" }, ...[["portal_sat_consulta", "Consulta en el portal de SAT"], ["certificador_consulta", "Consulta al certificador"], ["documento_fisico", "Documento físico"]].map(([v, t]) => h("option", { value: v }, t)));
        const ref = h("input", { "aria-label": "Referencia de la consulta", placeholder: "Referencia (mínimo 5 caracteres)", maxlength: 80 });
        const tipo = h("select", { "aria-label": "Conclusión", onchange: () => { datos.hidden = tipo.value !== "manual_certificada"; } }, h("option", { value: "manual_fallida" }, "El documento NO figura (liberar)"), h("option", { value: "manual_certificada" }, "El documento SÍ figura (certificar)"));
        const serie = h("input", { "aria-label": "Serie", placeholder: "Serie" }), num = h("input", { "aria-label": "Número", placeholder: "Número" }), aut = h("input", { "aria-label": "Autorización", placeholder: "Autorización (SIM-…)" });
        const datos = h("div", { class: "grid3", hidden: true }, serie, num, aut);
        partes.push(h("div", { class: "form" }, campo("Fuente", fuente), campo("Referencia", ref), campo("Conclusión", tipo), datos,
          boton("Proponer conciliación manual", { id: "proponer", tipo: "sec", icon: "check", onclick: accion(() => api.proponer(abierta.id, tipo.value, { fuente: fuente.value, referencia: ref.value }, tipo.value === "manual_certificada" ? { serie: serie.value, numero: num.value, autorizacion: aut.value } : null), () => avisar("Propuesta registrada: ahora la debe aprobar otra persona")) })));
      } else partes.push(h("p", { class: "mut" }, "Tu rol no puede proponer conciliaciones."));
    } else partes.push(h("p", { class: "mut" }, "La conciliación manual solo se habilita cuando el proveedor ya fue consultado y respondió «indeterminado»."));
    return h("div", { class: "card", "data-panel": "conciliacion" }, ...partes);
  })();

  // ------------------------------------------------------------ alerta, corrección, orden humana, descargas
  const extra = [];
  if (alertaAbierta) {
    const nota = h("input", { "aria-label": "Nota de resolución", placeholder: "Qué se hizo (mínimo 10 caracteres)", maxlength: 300 });
    extra.push(h("div", { class: "card" }, h("h2", { class: "card-t" }, "Resolver la alerta"), h("p", { class: "mut" }, "Una persona con permiso debe documentar la acción tomada (por ejemplo, anular la certificación huérfana con el proveedor)."),
      nota, boton("Resolver alerta", { icon: "check", disabled: !ctx.tiene("conciliacion.aprobar"), onclick: accion(() => api.resolverAlerta(alertaAbierta.id, nota.value), () => avisar("Alerta resuelta")) })));
  }
  if (doc.estado_fiscal === "rechazado" && ctx.tiene("borradores.editar")) extra.push(h("div", { class: "card" }, h("h2", { class: "card-t" }, "Corregir"), h("p", { class: "mut" }, "Si el contenido no necesita cambios, puedes reintentar el envío con otra clave. Si necesita cambios, vuelve a borrador."),
    boton("Volver a borrador para corregir", { tipo: "sec", icon: "undo", id: "reabrir", onclick: accion(() => api.reabrir(doc.id, doc.version), () => avisar("El documento vuelve a borrador")) })));
  if (abierta?.orden_externa) extra.push(h("div", { class: "card" }, h("h2", { class: "card-t" }, "Simulación de la persona en el portal"), h("p", { class: "mut" }, "Solo demostración: imita que la persona terminó la emisión en el portal y el agente leyó el resultado."),
    boton("La persona terminó la emisión (simular)", { icon: "check", id: "completar-humana", onclick: accion(() => api.completarHumana(abierta.id), () => avisar("Resultado leído: certificado (simulación)")) })));
  if (artefactos.length && ctx.tiene("artefactos.descargar")) extra.push(h("div", { class: "card" }, h("h2", { class: "card-t" }, "Archivos simulados"), h("div", { class: "acciones-fila" },
    ...artefactos.map((a) => boton(`Descargar ${a.tipo.toUpperCase()}`, { tipo: "sec", icon: "file", "data-archivo": a.tipo, onclick: async () => { try { await descargar(a); } catch (e) { mostrarError(e); } } })),
    boton("Ver documento", { tipo: "sec", icon: "eye", onclick: () => vistaPrevia({ ctx, doc, f: null, calc: null, det }) })), h("p", { class: "mut" }, "Cada archivo lleva la marca «SIMULADO - SIN VALOR FISCAL» y un resumen criptográfico (SHA-256) verificado por la base de datos.")));

  // ------------------------------------------------------------ línea de tiempo
  const linea = (() => {
    if (!operaciones.length) return null;
    return h("div", { class: "card", "data-panel": "linea-tiempo" }, h("h2", { class: "card-t" }, "Línea de tiempo"),
      ...operaciones.map((o, i) => h("div", { class: "op" }, h("div", { class: "op-cab" }, h("strong", {}, `Operación ${i + 1}`), insignia(o.estado.replaceAll("_", " "), o.estado === "confirmada_exitosa" ? "verde" : o.estado === "confirmada_fallida" ? "rojo" : "ambar"),
        o.resolucion ? h("small", { class: "mut" }, RESOLUCION[o.resolucion] ?? o.resolucion) : null),
        h("ul", { class: "tl" }, h("li", {}, h("span", { class: "mono mut" }, hora(o.iniciada_en)), " Operación registrada (antes de enviar)"), o.enviada_en ? h("li", {}, h("span", { class: "mono mut" }, hora(o.enviada_en)), " Envío marcado (un solo envío por operación)") : h("li", { class: "mut" }, "Envío todavía no marcado"),
          ...eventos.filter((e) => e.operacion_id === o.id).map((e) => h("li", {}, h("span", { class: "mono mut" }, hora(e.creado_en)), ` ${etiquetaEvento(e)}`)),
          ...conciliaciones.filter((c) => c.operacion_id === o.id).map((c) => h("li", {}, h("span", { class: "mono mut" }, hora(c.propuesta_en)), ` Conciliación manual ${c.estado}${c.decidida_por ? ` por ${nombresUsuario[c.decidida_por] ?? "otra persona"}` : ""}`))))));
  })();

  // ------------------------------------------------------------ controles de la demostración
  const demo = (() => {
    const selCaida = h("select", { "aria-label": "Punto de la caída" }, ...[["a", "Tras guardar la operación y antes de marcar el envío"], ["b", "Tras marcar el envío y antes de llamar al proveedor"], ["c", "Después de que el proveedor responde (antes de registrarlo)"], ["d", "Tras registrar el resultado (antes de guardar PDF/XML)"]].map(([v, t]) => h("option", { value: v }, t)));
    return h("details", { class: "card demo-controles", "data-panel": "demo", open: demoAbierto, ontoggle: (e) => { demoAbierto = e.target.open; } }, h("summary", {}, icono("shield"), h("strong", {}, " Controles de la demostración"), h("small", { class: "mut" }, " · reproducen lo que en la realidad hacen el proveedor, el tiempo o una caída del proceso")),
      h("div", { class: "form" },
        h("div", { class: "acciones-fila" },
          boton("El proveedor procesa las solicitudes tardías", { tipo: "sec", id: "demo-tardios", onclick: accion(() => api.liberarTardios(), () => avisar("El proveedor simulado procesó las solicitudes tardías")) }),
          boton("Auditar al proveedor (respuestas tardías)", { tipo: "sec", id: "demo-auditar", onclick: accion(() => api.auditar(), (r) => avisar(r.alertas ? `¡Se detectó ${r.alertas} certificación huérfana!` : `Auditoría hecha (${r.revisadas} operaciones revisadas)`, r.alertas ? "error" : "ok")) }),
          boton("Reiniciar y recuperar", { tipo: "sec", id: "demo-recuperar", onclick: accion(() => api.recuperar(), (r) => avisar(`Recuperación: ${r.liberadas_sin_envio} liberadas sin envío, ${r.marcadas_desconocidas} marcadas desconocidas, ${r.resueltas} resueltas, ${r.esperando_humano} esperan a una persona, ${r.artefactos_completados} archivos completados`)) })),
        puedeEnviar ? h("div", { class: "form" }, campo("Simular que el proceso se cae mientras envía", selCaida), boton("Enviar y simular la caída", { tipo: "peligro", id: "demo-caida", disabled: !ctx.tiene("fiscal.certificar") || sucio(),
          onclick: accion(() => api.caida(doc.id, claveDe(doc.id, operaciones.length), escenario, selCaida.value), (r) => avisar(r.caido ? "El proceso se cayó (simulado). Usa «Reiniciar y recuperar»." : "No hubo caída en ese punto", "error")) }),
          h("small", { class: "campo-ayuda" }, "Usa el comportamiento del proveedor elegido arriba. Tras la caída, el sistema NO reenvía: la recuperación prueba qué ocurrió.")) : null));
  })();

  return h("div", { class: "proceso-col" }, estadoCard, envio, conciliacion, ...extra, linea, demo);
}
