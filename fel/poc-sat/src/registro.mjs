// Registro de la prueba: cada paso (automático o manual), errores, bloqueos y tiempos. Formato JSONL + resumen.
// NUNCA se registran valores de campos, cookies, cabeceras ni contenido de la página: solo nombres de paso, tipos y tiempos.
import fs from "node:fs";
import path from "node:path";
import { sanearRuta } from "./guardia.mjs";

export function crearRegistro({ dir = null, empresa = "sin-alias", reloj = () => Date.now(), salida = (s) => console.log(s) } = {}) {
  const ev = [], t0 = reloj();
  let archivo = null;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); archivo = path.join(dir, `${new Date(t0).toISOString().replace(/[:.]/g, "-")}.jsonl`); }
  const guardar = (o) => { const x = { t: new Date(reloj()).toISOString(), empresa, ...o }; ev.push(x); if (archivo) fs.appendFileSync(archivo, JSON.stringify(x) + "\n"); return x; };
  return {
    archivo: () => archivo,
    eventos: () => ev,
    /** modo: "auto" | "manual". resultado: "ok" | "error" | "bloqueado" | "sesion" (el paso falló porque la sesión SAT se cerró). */
    paso({ id, tipo, modo, ms, resultado, detalle = "" }) { guardar({ evento: "paso", id, tipo, modo, ms, resultado, detalle }); salida(`${{ ok: "OK     ", bloqueado: "BLOQUEO", sesion: "SESIÓN ", error: "ERROR  " }[resultado]} ${String(modo).padEnd(6)} ${String(id).padEnd(22)} ${String(tipo).padEnd(16)} ${String(ms).padStart(6)} ms ${detalle}`); },
    /** Tiempo por fase: "autenticacion" (pausa hasta verificar la sesión), "llenado" (pasos automáticos) o "espera" (esperas por una persona). Solo nombre y milisegundos. */
    fase(nombre, ms) { guardar({ evento: "fase", nombre, ms }); },
    /** Cambio de estado de la sesión SAT: solo estado y códigos de razón (nunca URLs completas, cookies ni credenciales). */
    sesion({ estado, razones = [], via = "" }) { guardar({ evento: "sesion_sat", estado, razones, via }); },
    solicitudBloqueada({ metodo, host, ruta, razon }) { guardar({ evento: "solicitud_bloqueada", metodo, host, ruta: sanearRuta(ruta), razon }); },
    /** Lectura dinámica permitida (fetch/XHR): solo método, host y ruta saneada; nunca parámetros, cabeceras ni cuerpos. */
    lecturaXhr({ metodo, host, ruta }) { guardar({ evento: "lectura_xhr", metodo, host, ruta: sanearRuta(ruta) }); },
    navegacion({ host, ruta }) { guardar({ evento: "navegacion", host, ruta: sanearRuta(ruta) }); },
    nota(texto) { guardar({ evento: "nota", texto }); },
    resumen({ detenidoAntesDeEmitir, estadoFinal = null }) {
      const fases = {}; for (const x of ev.filter((x) => x.evento === "fase")) { fases[x.nombre] ??= { n: 0, ms: 0 }; fases[x.nombre].n++; fases[x.nombre].ms += x.ms; }
      const pasos = ev.filter((x) => x.evento === "paso"), suma = (l) => l.reduce((a, x) => a + x.ms, 0);
      const auto = pasos.filter((x) => x.modo === "auto"), manual = pasos.filter((x) => x.modo === "manual");
      const r = {
        empresa, pasos: pasos.length,
        automaticos: { n: auto.length, ms: suma(auto) }, manuales: { n: manual.length, ms: suma(manual) },
        fases, interrupciones_de_sesion: ev.filter((x) => x.evento === "sesion_sat" && x.estado === "requiere_login").length, estado_final: estadoFinal,
        errores: pasos.filter((x) => x.resultado === "error").map((x) => ({ id: x.id, tipo: x.tipo, detalle: x.detalle })),
        bloqueos_de_guardia: pasos.filter((x) => x.resultado === "bloqueado").map((x) => ({ id: x.id, detalle: x.detalle })),
        lecturas_xhr: [...new Set(ev.filter((x) => x.evento === "lectura_xhr").map((x) => `${x.metodo} ${x.host}${x.ruta}`))].slice(0, 50),
        solicitudes_bloqueadas: ev.filter((x) => x.evento === "solicitud_bloqueada").map((x) => `${x.metodo} ${x.host}${x.ruta}`),
        duracion_total_ms: reloj() - t0, detenido_antes_de_emitir: !!detenidoAntesDeEmitir, emitio: false,
      };
      guardar({ evento: "resumen", ...r });
      if (archivo) fs.writeFileSync(archivo.replace(/\.jsonl$/, ".resumen.json"), JSON.stringify(r, null, 2));
      return r;
    },
  };
}
export const formatoMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
