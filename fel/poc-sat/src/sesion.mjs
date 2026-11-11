// Gestión de la sesión SAT (hipótesis de trabajo: podría cerrarse tras 20–30 min de inactividad; NO está confirmado).
// Este módulo SOLO OBSERVA de forma pasiva (url, presencia/visibilidad de elementos, códigos 401). Nunca hace clic, escribe, recarga,
// navega ni envía peticiones: no existe ningún mecanismo para «mantener viva» la sesión. Tampoco lee cookies ni almacenamiento.
// La sesión SAT vive solo en el Chrome de la persona; NEXA no la ve ni la toca (y esta PoC no tiene sesión de NEXA).
import { construir } from "./localizar.mjs";
import { hostPermitido, sanearRuta } from "./guardia.mjs";

const SI = /^s[ií]?$/i, NO = /^(n|no|cancelar|salir)$/i;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * PURA. Decide el estado a partir de señales ya observadas.
 *  obs: { host, ruta, claveVisible, activos:[{id,presente}], login:[{id,presente}], respuestas401 }
 *  estado: "requiere_login" (hay señal de inicio de sesión) · "activa" (hay un indicador de sesión activa confirmado y ninguna señal de login)
 *          · "desconocida" (no hay prueba ni en un sentido ni en otro). Solo «activa» autoriza reanudar sin preguntar a una persona.
 */
export function evaluarSenales(obs, cfg = {}) {
  const razones = [];
  if ((cfg.hosts_login ?? []).length && hostPermitido(obs.host, cfg.hosts_login)) razones.push("host_de_login");
  if ((cfg.rutas_login ?? []).some((r) => String(obs.ruta ?? "").startsWith(r))) razones.push("ruta_de_login");
  if (cfg.campo_clave_visible !== false && obs.claveVisible) razones.push("campo_de_clave_visible");
  if ((obs.login ?? []).some((x) => x.presente)) razones.push("indicador_de_login");
  if ((obs.respuestas401 ?? 0) > 0) razones.push("respuesta_401");
  if (razones.length) return { estado: "requiere_login", razones };
  const activos = obs.activos ?? [];
  if (activos.length && activos.some((x) => x.presente)) return { estado: "activa", razones: ["indicador_de_sesion_activa"] };
  return { estado: "desconocida", razones: activos.length ? ["indicador_de_sesion_activa_ausente"] : ["sin_indicadores_configurados"] };
}

/** Observación pasiva de la página: solo lecturas. Devuelve señales, no contenido. */
export async function observarSenales(page, cfg, contadores, dominios = null) {
  let host = "", ruta = "";
  try { const u = new URL(page.url()); host = u.hostname; ruta = sanearRuta(u.pathname); } catch { /* about:blank, etc. */ }
  const visible = async (loc) => { try { return (await loc.count()) > 0 && (await loc.first().isVisible()); } catch { return false; } };
  let claveVisible = false;
  if (cfg.campo_clave_visible !== false) for (const f of page.frames()) { try { if ((await f.locator('input[type="password"]:visible').count()) > 0) { claveVisible = true; break; } } catch { /* marco inaccesible */ } }
  const medir = async (lista, pfx) => { const r = []; for (const [i, ind] of (lista ?? []).entries()) r.push({ id: `${pfx}${i}`, presente: await (async () => { try { return await visible(construir(page, ind.localizador, dominios)); } catch { return false; } })() }); return r; };
  return { host, ruta, claveVisible, activos: await medir(cfg.indicadores_sesion_activa, "a"), login: await medir(cfg.indicadores_login, "l"), respuestas401: contadores.n401 };
}

/**
 * Monitor de sesión SAT. Opciones: config (el bloque «sesion» del mapeo), dominios (para contar 401 solo del portal), reloj, sleep, salida.
 * No guarda nada en disco ni conserva cookies/cabeceras/cuerpos: solo un contador de respuestas 401 desde la última verificación.
 */
export function crearMonitorSesion({ config = {}, dominios = [], reloj = () => Date.now(), sleep = dormir, salida = (s) => console.log(s) } = {}) {
  const contadores = { n401: 0 };
  const monitor = {
    config,
    contadores,
    adjuntar(page) { page.on("response", (r) => { try { if (r.status() === 401 && hostPermitido(new URL(r.url()).hostname, dominios)) contadores.n401++; } catch { /* ignora */ } }); },
    reiniciarContadores() { contadores.n401 = 0; },
    /** Lectura pasiva → {estado, razones}. */
    async evaluar(page) { return evaluarSenales(await observarSenales(page, config, contadores, dominios), config); },
    /**
     * ¿Está activa la sesión? Con indicadores confirmados: automático. Sin indicadores: exige que NO haya señales de login y que una persona lo confirme.
     * Devuelve {activa, via, razones}.
     */
    async verificarActiva(page, { esperarUsuario } = {}) {
      const ev = await monitor.evaluar(page);
      if (ev.estado === "activa") return { activa: true, via: "indicador", razones: ev.razones };
      if (ev.estado === "requiere_login") return { activa: false, via: "indicador", razones: ev.razones };
      if ((config.indicadores_sesion_activa ?? []).length) return { activa: false, via: "indicador", razones: ev.razones };   // hay indicadores y no aparecen: probablemente otra pantalla; no se asume
      if (!esperarUsuario) return { activa: false, via: "manual", razones: ["falta_confirmacion_humana"] };
      const r = await esperarUsuario("¿Ya iniciaste sesión en el portal oficial y ves tu sesión activa (sin pantalla de inicio de sesión)? (si/no)");
      if (!SI.test(String(r).trim())) return { activa: false, via: "manual", razones: ["la_persona_no_confirmo"] };
      const de = await monitor.evaluar(page);   // la confirmación humana no basta si todavía hay señales de login
      return de.estado === "requiere_login" ? { activa: false, via: "manual", razones: de.razones } : { activa: true, via: "manual", razones: ["confirmacion_humana"] };
    },
    /**
     * Espera, SIN tocar la página, a que la persona inicie sesión en el portal oficial y se verifique. Con indicadores consulta cada intervalo_ms (lectura pasiva);
     * sin indicadores le pregunta a la persona. Devuelve {via, ms}. Lanza si se agota la espera o la persona cancela.
     */
    async esperarSesionActiva(page, { esperarUsuario }) {
      const t0 = reloj(), max = config.espera_max_ms ?? 30 * 60 * 1000, paso = config.intervalo_ms ?? 5000;
      salida("\n=== SESIÓN SAT REQUERIDA ===\nInicia sesión TÚ directamente en el portal oficial (en la ventana de Chrome). No escribas credenciales aquí.\nNo se hace ningún clic ni acción por ti. Se reanudará solo después de verificar que la sesión está activa.\n");
      monitor.reiniciarContadores();
      if ((config.indicadores_sesion_activa ?? []).length) {
        let ultimoAviso = t0;
        while (reloj() - t0 < max) {
          const v = await monitor.verificarActiva(page);
          if (v.activa) return { via: v.via, ms: reloj() - t0 };
          if (reloj() - ultimoAviso >= 60000) { salida(`  …sigo esperando el inicio de sesión (${Math.round((reloj() - t0) / 60000)} min)`); ultimoAviso = reloj(); }
          await sleep(paso);
        }
        throw new Error("se agotó la espera del inicio de sesión");
      }
      for (let i = 0; i < 10 && reloj() - t0 < max; i++) {
        const r = await esperarUsuario("Inicia sesión en el portal oficial. Escribe «si» cuando termines (o «no» para cancelar)");
        if (NO.test(String(r).trim())) throw new Error("la persona canceló la espera de inicio de sesión");
        if (!SI.test(String(r).trim())) continue;
        const v = await monitor.verificarActiva(page, { esperarUsuario: async () => "si" });   // ya confirmó; se comprueba que no queden señales de login
        if (v.activa) { monitor.reiniciarContadores(); return { via: v.via, ms: reloj() - t0 }; }
        salida(`  La sesión aún no se ve activa (${v.razones.join(", ")}).`);
      }
      throw new Error("no se pudo verificar la sesión activa");
    },
  };
  return monitor;
}
