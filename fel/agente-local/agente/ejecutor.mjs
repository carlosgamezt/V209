// EJECUTOR de una orden: reclama, llena el simulador, se detiene en la vista previa, espera la decisión de la PERSONA y resuelve el resultado SIEMPRE contra el libro del simulador.
// Reglas (Fase 4): sin reintento automático después de presentar; ante un resultado desconocido se consulta el libro y, si no es concluyente, queda INCIERTO (NEXA lo pasa
// a «por verificar» y lo concilian dos personas); revocación, arrendamiento vencido o token viejo ⇒ el agente se detiene y no cambia nada más. Ver agente-protocolo.md.
import { ErrorNexa } from "./cliente_nexa.mjs";
import { ErrorOrden, aFormulario } from "./navegador.mjs";
import { ErrorRed } from "./seguridad_red.mjs";

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms));
/** Solo para pruebas: simula la muerte del proceso en un punto. Nunca se captura ni se informa: el diario y la sesión quedan como los dejaría una caída real. */
export class CaidaSimulada extends Error { constructor(punto) { super(`caída simulada en ${punto}`); this.punto = punto; } }

/** Decide a partir del estado de la sesión y del libro (la FUENTE DE VERDAD del resultado). null = todavía esperando a la persona. */
export function decidirDesdeLibro(sesion, libro, sesionId) {
  const mias = libro.filter((x) => x.sesion === sesionId);
  if (libro.length > 1) return { tipo: "incierta", motivo: "libro_con_duplicados" };
  if (sesion.estado === "confirmada") return mias.length === 1 && libro.length === 1 ? { tipo: "emitida", emision: mias[0] } : { tipo: "incierta", motivo: "libro_no_coincide" };
  if (libro.length > 0) return { tipo: "incierta", motivo: "emision_sin_sesion_confirmada" };
  if (["descartada", "interrumpida", "error"].includes(sesion.estado)) return { tipo: "descartada", motivo: sesion.estado };
  return null;
}

export function crearEjecutor(dep) {
  const { nexa, sim, almacen, config, log = () => {}, abrirNavegador, reloj = () => Date.now(), dormir = dormirReal, ganchos = {}, cierreSolicitado = () => false } = dep;   // «ganchos»: solo pruebas
  const guardar = (o, extra) => almacen.guardarDiario({ orden: o.orden, token: o.token, referencia: o.orden, t: new Date().toISOString(), ...extra });
  const seguro = async (f) => { try { return await f(); } catch (e) { log("aviso", String(e?.codigo ?? e?.message ?? e)); return null; } };

  async function informar(o, d, sesionId) {
    try {
      if (d.tipo === "emitida") { const e = d.emision; await nexa.resultado(o.orden, o.token, { tipo: "emitido_simulado", serie: e.serie, numero: e.numero, autorizacion: e.autorizacion }); log("resultado", "emitida"); almacen.borrarDiario(); return { estado: "emitida", emision: e }; }
      if (d.tipo === "descartada") { await nexa.resultado(o.orden, o.token, { tipo: "descartado", detalle: String(d.motivo).slice(0, 60) }); log("resultado", `descartada:${d.motivo}`); almacen.borrarDiario(); return { estado: "descartada", motivo: d.motivo }; }
      await seguro(() => sim.interrumpir(sesionId));                                    // incierta: ninguna otra confirmación posible sobre esta sesión
      await nexa.resultado(o.orden, o.token, { tipo: "error", detalle: String(d.motivo).slice(0, 60) }); log("resultado", `incierta:${d.motivo}`); almacen.borrarDiario();
      return { estado: "incierta", motivo: d.motivo };
    } catch (e) {
      if (e instanceof ErrorNexa && (e.esRevocado || e.esFencing)) { log("resultado", `NEXA no aceptó el resultado (${e.codigo}); se deja a NEXA/conciliación`); almacen.borrarDiario(); return { estado: e.esRevocado ? "revocado" : "perdida", codigo: e.codigo }; }
      throw e;                                                                          // fallo transitorio: el diario se conserva para recuperar
    }
  }

  async function abortarPorNexa(o, e, sesionId) {
    if (sesionId) await seguro(() => sim.interrumpir(sesionId));                        // nadie puede confirmar algo que NEXA ya no sigue
    almacen.borrarDiario(); log("aborto", e.codigo);
    return { estado: e.esRevocado ? "revocado" : "perdida", codigo: e.codigo };
  }

  /** Espera la decisión de la persona. Renueva el arrendamiento; todo se resuelve con el libro. */
  async function esperar(o, sesion) {
    const inicio = reloj(); let ultimoRenovar = inicio, fallos = 0;
    for (;;) {
      if (cierreSolicitado()) { log("cierre", "cierre ordenado con la vista previa abierta: se cierra la sesión y se resuelve con el libro"); return recuperarPresentada(o, sesion.id); }   // nunca queda una confirmación posible sin agente
      if (reloj() - inicio > config.esperaMaxMs) {
        await seguro(() => sim.interrumpir(sesion.id));
        const [s, libro] = await Promise.all([sim.sesion(sesion.id), sim.libro(o.orden)]);
        return informar(o, decidirDesdeLibro(s, libro, sesion.id) ?? { tipo: "descartada", motivo: "sin_confirmacion" }, sesion.id);
      }
      try {
        const [s, libro] = await Promise.all([sim.sesion(sesion.id), sim.libro(o.orden)]); fallos = 0;
        const d = decidirDesdeLibro(s, libro, sesion.id);
        if (d) return await informar(o, d, sesion.id);
      } catch (e) {
        if (e instanceof ErrorNexa) throw e;
        if (++fallos >= config.maxFallosSimulador) { log("aviso", "el simulador no responde: resultado sin verificar; no se repite nada"); return { estado: "sin_verificar" }; }
      }
      if (reloj() - ultimoRenovar >= config.renovarMs) {
        try { await nexa.progreso(o.orden, o.token, "detenido_en_vista_previa"); ultimoRenovar = reloj(); }
        catch (e) { if (e instanceof ErrorNexa && (e.esRevocado || e.esFencing)) return abortarPorNexa(o, e, sesion.id); log("aviso", `no se pudo renovar: ${e.codigo ?? e.message}`); }
      }
      await dormir(config.sondeoMs);
    }
  }

  /** Procesa UNA orden ya reclamada. */
  async function procesar(o) {
    let sesion = null, nav = null, presentada = false;
    try {
      if (o.ambiente !== "simulado") throw new ErrorOrden("AMBIENTE", "Solo se admiten órdenes del ambiente simulado");
      await guardar(o, { fase: "reclamada" });
      const previas = await sim.libro(o.orden);
      if (previas.length > 0) {                                                         // operación duplicada: el libro ya tiene una emisión de ESTA orden ⇒ no se crea otra, se verifica
        await nexa.progreso(o.orden, o.token, "detenido_en_vista_previa"); presentada = true;
        return await informar(o, { tipo: "incierta", motivo: "duplicado_en_libro" }, null);
      }
      const formulario = aFormulario(o.instantanea);
      await nexa.progreso(o.orden, o.token, "llenando");
      sesion = await sim.crearSesion(o.orden); await guardar(o, { fase: "llenando", sesion: sesion.id });
      await ganchos.punto?.("sesion_creada", { orden: o, sesion });
      nav = await abrirNavegador({ origenSimulador: sim.origen });
      await nav.llenarYPrevisualizar(sesion.url, formulario);
      const s = await sim.sesion(sesion.id);
      if (s.estado !== "previsualizada" || !s.hash || !s.resumen) throw new ErrorOrden("VISTA_PREVIA", "El simulador no llegó a la vista previa");
      await ganchos.punto?.("antes_de_presentar", { orden: o, sesion, pagina: nav.pagina });
      await nexa.progreso(o.orden, o.token, "detenido_en_vista_previa"); presentada = true;   // desde aquí: NUNCA se repite
      await guardar(o, { fase: "presentada", sesion: sesion.id, hash: s.hash });
      await nexa.vistaPrevia(o.orden, o.token, s.resumen, s.hash);
      log("presentada", `orden ${o.orden} · hash ${s.hash.slice(0, 12)} · esperando a la persona`);
      await ganchos.punto?.("despues_de_presentar", { orden: o, sesion, pagina: nav.pagina });
      return await esperar(o, sesion);
    } catch (e) {
      if (e instanceof CaidaSimulada) throw e;
      if (e instanceof ErrorNexa && (e.esRevocado || e.esFencing)) return abortarPorNexa(o, e, sesion?.id);
      if (!presentada) {                                                               // error ANTES de presentar: se prueba que nada salió ⇒ NEXA la marca fallida
        if (sesion) await seguro(() => sim.interrumpir(sesion.id));
        const codigo = e instanceof ErrorOrden || e instanceof ErrorRed ? e.codigo : "ERROR_AGENTE";
        log("error_antes", `${codigo}: ${e.message}`);
        try { await nexa.resultado(o.orden, o.token, { tipo: "error", detalle: String(codigo).slice(0, 60) }); almacen.borrarDiario(); }
        catch (e2) { if (e2 instanceof ErrorNexa && (e2.esRevocado || e2.esFencing)) { almacen.borrarDiario(); return { estado: e2.esRevocado ? "revocado" : "perdida", codigo: e2.codigo }; } throw e2; }
        return { estado: "fallida", codigo };
      }
      // error DESPUÉS de presentar (p. ej. no se pudo informar la vista previa): nunca se repite; se interrumpe la sesión y se resuelve con el libro
      log("error_despues", String(e?.codigo ?? e?.message));
      return recuperarPresentada(o, sesion?.id ?? null);
    } finally { if (nav) { await dormir(config.demoraCierreMs ?? 0); await nav.cerrar(); } }   // la ventana queda unos segundos para que la persona vea el resultado
  }

  /** Orden presentada cuyo resultado es desconocido (caída, error de red…): interrumpe la sesión, CONSULTA EL LIBRO y resuelve. Nunca repite la operación. */
  async function recuperarPresentada(o, sesionId) {
    if (sesionId) await seguro(() => sim.interrumpir(sesionId));
    let d;
    try {
      const libro = await sim.libro(o.orden);
      const s = sesionId ? await sim.sesion(sesionId) : { estado: "desconocida" };
      d = decidirDesdeLibro(s, libro, sesionId) ?? { tipo: libro.length === 0 ? "descartada" : "incierta", motivo: libro.length === 0 ? "interrumpida_sin_emision" : "libro_no_coincide" };
    } catch (e) { log("aviso", `no se pudo consultar el libro: ${e.message}`); return { estado: "sin_verificar" }; }
    return informar(o, d, sesionId);
  }

  /** Al arrancar: si quedó una orden a medias, se resuelve con el libro (o se descarta lo no presentado). */
  async function recuperar() {
    const d = almacen.diario(); if (!d) return null;
    if (d.fase === "presentada") { log("recuperacion", `orden ${d.orden} presentada antes de la caída`); return recuperarPresentada({ orden: d.orden, token: d.token }, d.sesion); }
    if (d.sesion) await seguro(() => sim.interrumpir(d.sesion));                        // no presentada: la sesión vieja se cierra; NEXA devuelve la orden a la cola al vencer
    almacen.borrarDiario(); log("recuperacion", `orden ${d.orden} no presentada: sesión anterior cerrada`);
    return { estado: "limpiada" };
  }

  return { procesar, recuperar, recuperarPresentada };
}
