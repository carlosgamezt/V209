// Registro de la prueba: cada paso (automático o manual), errores, bloqueos y tiempos. Formato JSONL + resumen.
// NUNCA se registran valores de campos, cookies, cabeceras ni contenido de la página: solo nombres de paso, tipos y tiempos.
import fs from "node:fs";
import path from "node:path";

export function crearRegistro({ dir = null, empresa = "sin-alias", reloj = () => Date.now(), salida = (s) => console.log(s) } = {}) {
  const ev = [], t0 = reloj();
  let archivo = null;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); archivo = path.join(dir, `${new Date(t0).toISOString().replace(/[:.]/g, "-")}.jsonl`); }
  const guardar = (o) => { const x = { t: new Date(reloj()).toISOString(), empresa, ...o }; ev.push(x); if (archivo) fs.appendFileSync(archivo, JSON.stringify(x) + "\n"); return x; };
  return {
    archivo: () => archivo,
    eventos: () => ev,
    /** modo: "auto" | "manual". resultado: "ok" | "error" | "bloqueado". */
    paso({ id, tipo, modo, ms, resultado, detalle = "" }) { guardar({ evento: "paso", id, tipo, modo, ms, resultado, detalle }); salida(`${resultado === "ok" ? "OK     " : resultado === "bloqueado" ? "BLOQUEO" : "ERROR  "} ${String(modo).padEnd(6)} ${String(id).padEnd(22)} ${String(tipo).padEnd(16)} ${String(ms).padStart(6)} ms ${detalle}`); },
    solicitudBloqueada({ metodo, host, ruta, razon }) { guardar({ evento: "solicitud_bloqueada", metodo, host, ruta, razon }); },
    navegacion({ host, ruta }) { guardar({ evento: "navegacion", host, ruta }); },
    nota(texto) { guardar({ evento: "nota", texto }); },
    resumen({ detenidoAntesDeEmitir }) {
      const pasos = ev.filter((x) => x.evento === "paso"), suma = (l) => l.reduce((a, x) => a + x.ms, 0);
      const auto = pasos.filter((x) => x.modo === "auto"), manual = pasos.filter((x) => x.modo === "manual");
      const r = {
        empresa, pasos: pasos.length,
        automaticos: { n: auto.length, ms: suma(auto) }, manuales: { n: manual.length, ms: suma(manual) },
        errores: pasos.filter((x) => x.resultado === "error").map((x) => ({ id: x.id, tipo: x.tipo, detalle: x.detalle })),
        bloqueos_de_guardia: pasos.filter((x) => x.resultado === "bloqueado").map((x) => ({ id: x.id, detalle: x.detalle })),
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
