// Ejecutor del plan: llena campos con datos FICTICIOS y SE DETIENE. No existe ningún tipo de paso que emita, certifique o envíe.
// Falla cerrado: ante cualquier error o bloqueo de la guardia, la ejecución termina (no continúa con el resto del plan).
// Sesión SAT: si el portal pide iniciar sesión, se PAUSA (sin tocar nada), la persona se autentica en el portal oficial, se VERIFICA la sesión,
// se RECONCILIA lo ya llenado (solo lectura) y solo entonces se reanuda. No se hace ninguna acción para evitar la expiración por inactividad.
import { validarMapeo, validarDatos, valorDe, clasificarControl, hostPermitido } from "./guardia.mjs";
import { resolver, construir, ErrorDominio } from "./localizar.mjs";
import { planificarReanudacion, esIdempotente } from "./progreso.mjs";
import { claveIdempotencia } from "./libro.mjs";

export class ErrorGuardia extends Error {}
const hostDe = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const rutaDe = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
const CAMPOS = new Set(["llenar", "seleccionar", "marcar"]);

/**
 * @param {object} o  page, plan, datos, registro, empresa, esperarUsuario(pregunta)->Promise<string>, local (solo autoprueba), reloj,
 *   sesion (monitor de sesión SAT, opcional), progreso (checkpoint, opcional), libro + (claveDoc se calcula) (anti-duplicados, opcional),
 *   reanudar (continuar una ejecución interrumpida), hooks.antesDePaso (solo pruebas), salida
 */
export async function ejecutarPlan({ page, plan, datos, registro, empresa = { alias: "sin-alias" }, esperarUsuario, local = false, reloj = () => Date.now(), timeout = 5000, sesion = null, progreso = null, libro = null, reanudar = false, soloComprobar = false, hooks = {}, salida = (s) => console.log(s) }) {
  const vm = validarMapeo(plan, { local }), vd = validarDatos(datos), errVal = [...vm.errores, ...vd.errores];
  const claveDoc = claveIdempotencia(empresa.alias, datos);
  if (!errVal.length && libro) { const pe = libro.puedeEjecutar(claveDoc); if (!pe.permitir) errVal.push(pe.razon); }
  if (errVal.length) { for (const m of errVal) registro.nota(`validación: ${m}`); return { ok: false, detenido: false, resumen: registro.resumen({ detenidoAntesDeEmitir: true, estadoFinal: "no_inicio" }), errores_validacion: errVal }; }

  const dominios = plan.dominios_permitidos;
  const comprobarHost = () => { const h = hostDe(page.url()); if (!hostPermitido(h, dominios)) throw new ErrorGuardia(`la pestaña está en «${h || "?"}», que no está en dominios_permitidos`); };
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) registro.navegacion({ host: hostDe(f.url()), ruta: rutaDe(f.url()) }); });
  page.on("dialog", (d) => { registro.nota(`diálogo ${d.type()} descartado`); d.dismiss().catch(() => {}); });   // descartar = cancelar: nunca se acepta nada
  sesion?.adjuntar(page);
  if (soloComprobar) registro.nota("modo solo-comprobar: se resuelven y comprueban los localizadores; NO se escribe, ni se pulsa, ni se sale de ningún campo");

  let detenido = false, ok = true, estadoFinal = "interrumpido";
  const hechos = new Set();   // pasos ya aplicados (en una reanudación se cargan del progreso)
  const marcar = (p) => { hechos.add(p.id); progreso?.marcarPaso(p); };
  const paso = async (p, modo, fn) => {
    const t = reloj();
    try { const detalle = (await fn()) ?? ""; const ms = reloj() - t; registro.paso({ id: p.id, tipo: p.tipo, modo, ms, resultado: "ok", detalle }); if (modo === "auto" && p.tipo !== "detener" && !String(p.id).startsWith("p-")) registro.fase("llenado", ms); }
    catch (e) {
      const guardia = e instanceof ErrorGuardia || e instanceof ErrorDominio; let res = guardia ? "bloqueado" : "error";
      if (!guardia && sesion) { const ev = await sesion.evaluar(page).catch(() => null); if (ev?.estado === "requiere_login") { res = "sesion"; e.sesionPerdida = ev.razones; } }
      registro.paso({ id: p.id, tipo: p.tipo, modo, ms: reloj() - t, resultado: res, detalle: res === "sesion" ? "la sesión SAT se cerró durante el paso" : String(e.message ?? e).slice(0, 200) });
      throw e;
    }
  };
  const espera = async (p, instruccion) => { const t = reloj(); await paso(p, "manual", async () => { await esperarUsuario(instruccion); }); registro.fase("espera", reloj() - t); };

  // ---- lectura pasiva de un paso de llenado ya hecho (no escribe nada)
  const verificarPaso = async (p) => {
    try {
      const loc = await resolver(page, p.localizador, { timeout: 1500, dominios }), v = valorDe(datos, p.dato);
      if (p.tipo === "llenar") return (await loc.inputValue()) === String(v) ? "ok" : "distinto";
      if (p.tipo === "seleccionar") return (await loc.evaluate((el) => el.options?.[el.selectedIndex]?.label ?? "")) === String(v) ? "ok" : "distinto";
      return (await loc.isChecked()) === (v === true || v === "true") ? "ok" : "distinto";
    } catch { return "ausente"; }
  };
  // ---- reconciliar tras una pausa o una reanudación: ¿el portal conserva lo que ya llenamos?
  const reconciliar = async () => {
    if (!progreso) return;
    await paso({ id: "p-reconciliar", tipo: "leer" }, "auto", async () => {
      const hechos_ = plan.pasos.filter((p) => hechos.has(p.id) && CAMPOS.has(p.tipo)), ver = {};
      for (const p of hechos_) ver[p.id] = await verificarPaso(p);
      const r = planificarReanudacion(plan.pasos, [...hechos], ver);
      if (r.accion === "reinicio_manual") { estadoFinal = "requiere_reinicio_manual"; throw new ErrorGuardia(`REINICIO MANUAL: ${r.razon}. Descarta lo que quede en el portal, vuelve a un formulario vacío y ejecuta con --reiniciar`); }
      if (r.accion === "reaplicar") { for (const id of r.reaplicar) hechos.delete(id); progreso?.desmarcarPasos(r.reaplicar); return `el portal perdió ${r.reaplicar.length} campo(s): se volverán a llenar (solo campos, sin repetir clics)`; }
      return `sin cambios: ${hechos_.length} campo(s) conservados, no se repite nada`;
    });
  };
  // ---- pausa por cierre de sesión: esperar a la persona, verificar, volver al formulario, reconciliar
  const pausarPorSesion = async (razones) => {
    const t0 = reloj();
    registro.sesion({ estado: "requiere_login", razones }); progreso?.pausaPorSesion();
    const r = await sesion.esperarSesionActiva(page, { esperarUsuario, salida });
    registro.sesion({ estado: "activa", via: r.via });
    await esperarUsuario(plan.sesion?.reanudar_instruccion ?? "Vuelve TÚ al formulario donde estabas (sin emitir) y pulsa Enter.");
    comprobarHost();
    const ms = reloj() - t0; registro.fase("autenticacion", ms);
    registro.paso({ id: "p-reautenticacion", tipo: "manual", modo: "manual", ms, resultado: "ok", detalle: `sesión SAT verificada (${r.via})` });
    progreso?.estado("en_curso");
    await reconciliar();
  };
  const protegerSesion = async () => { if (!sesion) return; const ev = await sesion.evaluar(page); if (ev.estado === "requiere_login") await pausarPorSesion(ev.razones); };

  try {
    progreso?.iniciar(reanudar ? { desde: progreso.cargar() } : {});
    if (reanudar) for (const id of progreso?.completados() ?? []) hechos.add(id);
    if (!reanudar) libro?.registrar(claveDoc, "preparado");
    // 0) La sesión la inició una persona. Se confirma que corresponde a ESTA empresa (no hay forma automática segura de saberlo todavía).
    if (empresa.identidad?.confirmacion_manual !== false) {
      const t = reloj();
      await paso({ id: "p-identidad", tipo: "manual" }, "manual", async () => {
        const r = await esperarUsuario(`¿La sesión abierta en Chrome corresponde a la empresa «${empresa.alias}»? (si/no)`);
        if (!/^s[ií]?$/i.test(String(r).trim())) throw new ErrorGuardia("la persona indicó que la sesión NO corresponde a esta empresa");
      });
      registro.fase("espera", reloj() - t);
    }
    await paso({ id: "p-host", tipo: "leer" }, "auto", async () => { comprobarHost(); return "la pestaña está en un dominio permitido"; });
    if (reanudar) {   // solo se reanuda con la sesión verificada
      if (sesion) { const v = await sesion.verificarActiva(page, { esperarUsuario }); registro.sesion({ estado: v.activa ? "activa" : "requiere_login", razones: v.razones, via: v.via }); if (v.activa) await reconciliar(); else await pausarPorSesion(v.razones); }
      else await reconciliar();
    } else if (sesion) { const ev = await sesion.evaluar(page); registro.sesion({ estado: ev.estado, razones: ev.razones, via: "inicial" }); if (ev.estado === "requiere_login") await pausarPorSesion(ev.razones); }

    const reintentos = {};   // un solo reintento por paso tras un cierre de sesión
    for (let p; (p = plan.pasos.find((x) => !hechos.has(x.id))); ) {   // siempre el primer paso pendiente: si una reconciliación obliga a re-llenar, se hace en orden
      if (p.tipo === "manual") { await espera(p, p.instruccion); marcar(p); continue; }
      if (p.tipo === "detener") {
        await paso(p, "auto", async () => { detenido = true; return "DETENIDO: la prueba termina aquí. No se emitió, certificó ni envió nada."; });
        break;
      }
      await hooks.antesDePaso?.(p);
      await protegerSesion();
      await hooks.antesDeEjecutar?.(p);
      try { await paso(p, "auto", () => ejecutarUno(p)); marcar(p); }
      catch (e) {
        if (!e.sesionPerdida || reintentos[p.id]) throw e;
        reintentos[p.id] = true;
        await pausarPorSesion(e.sesionPerdida);
        if (!esIdempotente(p)) { estadoFinal = "requiere_decision_manual"; throw new ErrorGuardia(`el paso «${p.id}» no es repetible y la sesión se cerró durante él: revisa a mano en el portal si se aplicó y reinicia`); }
      }
    }
    if (detenido) { estadoFinal = "detenido"; libro?.registrar(claveDoc, "detenido_antes_de_emitir"); }
  } catch (e) { ok = false; if (process.env.FEL_POC_DEBUG) console.error(e); /* el detalle ya quedó en el registro; se termina sin seguir */ }
  progreso?.estado(ok && detenido ? "detenido" : estadoFinal);
  return { ok: ok && detenido, detenido, estado: ok && detenido ? "detenido" : estadoFinal, resumen: registro.resumen({ detenidoAntesDeEmitir: true, estadoFinal: ok && detenido ? "detenido" : estadoFinal }) };

  async function ejecutarUno(p) {
    comprobarHost();
    if (soloComprobar && p.tipo === "verificar_ausente") return "omitido en modo comprobación (los campos vacíos aún no son válidos)";
    if (p.tipo === "verificar_ausente") {   // detección de errores de validación: no debe haber ningún elemento VISIBLE que coincida (p. ej. clase ng-invalid o un mensaje de error)
      const l = construir(page, p.localizador, dominios), fin = reloj() + (p.espera_ms ?? 400); let n = 0;
      for (;;) { n = await l.evaluateAll((els) => els.filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).length); if (n === 0 || reloj() >= fin) break; await new Promise((r) => setTimeout(r, 80)); }   // sin .catch: un fallo de lectura es un error, nunca un «sin errores»
      if (n > 0) throw new Error(`hay ${n} elemento(s) visible(s) de error de validación (${p.localizador.estrategia}: ${p.localizador.valor})`);
      return "sin errores de validación visibles";
    }
    if (soloComprobar && p.aparece_tras && (await construir(page, p.localizador, dominios).count()) === 0) return `no comprobable en frío: el campo aparece tras «${p.aparece_tras}»`;
    const loc = await resolver(page, p.localizador, { timeout, dominios });
    switch (p.tipo) {
      case "esperar_visible": await loc.waitFor({ state: "visible", timeout }); return "";
      case "llenar": {
        const v = valorDe(datos, p.dato); if (v == null) throw new Error(`el dato «${p.dato}» no existe en los datos ficticios`);
        const info = await loc.evaluate((el) => ({ type: (el.getAttribute("type") || "").toLowerCase(), ac: (el.getAttribute("autocomplete") || "").toLowerCase() }));
        if (info.type === "password" || /(current-password|new-password|one-time-code)/.test(info.ac)) throw new ErrorGuardia("campo de credenciales: nunca se automatiza (la persona se autentica en el portal oficial)");
        if (!(await loc.isVisible()) || !(await loc.isEnabled()) || !(await loc.isEditable())) throw new Error("el campo no está visible, habilitado y editable");
        if (soloComprobar) return `comprobado sin escribir (${p.dato})`;
        await loc.fill(String(v));
        if (p.verificar !== false && (await loc.inputValue()) !== String(v)) throw new Error("el campo no conservó el valor escrito (el portal lo modificó o lo rechazó)");
        return `campo llenado (${p.dato})`;
      }
      case "seleccionar": {
        const v = valorDe(datos, p.dato); if (v == null) throw new Error(`el dato «${p.dato}» no existe`);
        if ((await loc.evaluate((el) => el.tagName)) !== "SELECT") throw new Error("no es un <select> nativo (los desplegables personalizados necesitan observación aparte)");
        if (soloComprobar) { if (!(await loc.evaluate((el, l) => [...el.options].some((o) => o.label === l), String(v)))) throw new Error("la opción pedida no existe en la lista"); return `comprobado sin elegir (${p.dato})`; }
        await loc.selectOption({ label: String(v) }); return `opción elegida (${p.dato})`;
      }
      case "salir_del_campo": if (soloComprobar) return "comprobado sin salir del campo"; await loc.blur(); return "se salió del campo (evento blur)";
      case "marcar": { if (soloComprobar) return `comprobado sin marcar (${p.dato})`; const v = valorDe(datos, p.dato); await loc.setChecked(v === true || v === "true"); return `casilla (${p.dato})`; }
      case "leer": {
        if (soloComprobar) return "comprobado: el campo es legible (no se compara el valor)";
        const v = valorDe(datos, p.dato), leerValor = () => loc.evaluate((el) => ("value" in el && el.value !== "" ? el.value : el.textContent) ?? "");
        let real = await leerValor(); const fin = reloj() + (p.espera_ms ?? 1500);   // valores calculados de forma asíncrona (AngularJS/debounce): se reintenta la LECTURA hasta el límite
        while (String(real).trim() !== String(v) && reloj() < fin) { await new Promise((r) => setTimeout(r, 80)); real = await leerValor(); }
        if (String(real).trim() !== String(v)) throw new Error(`lo leído no coincide con lo esperado (longitudes ${String(real).trim().length} vs ${String(v).length})`);
        return "lectura coincide";
      }
      case "clic_seguro": {
        const info = await loc.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase(), texto: (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 80), etiqueta: el.getAttribute("aria-label") || "", titulo: el.getAttribute("title") || "", id: el.id, nombre: el.getAttribute("name") || "", enFormulario: !!el.closest("form"), href: el.tagName === "A" ? (el.getAttribute("href") || "") : "", ngclick: el.getAttribute("ng-click") || el.getAttribute("data-ng-click") || "" }));
        const c = clasificarControl(info);
        if (c.nivel === "prohibido") throw new ErrorGuardia(`clic RECHAZADO: el control ${c.razones.join("; ")}`);
        if (c.envia_formulario && p.permitir_envia_formulario !== true) throw new ErrorGuardia("clic RECHAZADO: el control puede enviar un formulario");
        if (c.nivel === "ambiguo" && !c.envia_formulario && p.ambiguo_aprobado !== true) throw new ErrorGuardia(`clic RECHAZADO: control ambiguo (${c.razones.join("; ")}) sin ambiguo_aprobado`);
        if (soloComprobar) return "clasificado como permitido; NO se pulsa en modo comprobación";
        await loc.click({ timeout }); return `clic: ${p.motivo}`;
      }
      default: throw new Error(`tipo sin implementar: ${p.tipo}`);
    }
  }
}
