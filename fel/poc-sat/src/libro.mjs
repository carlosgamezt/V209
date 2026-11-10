// Libro anti-duplicados. En esta PoC NUNCA se emite, así que el libro solo llega a «preparado» y «detenido_antes_de_emitir».
// Existe para dejar resuelta, probada y documentada la regla que cualquier fase futura con emisión tendría que cumplir:
//   1) la intención de emitir se ESCRIBE en disco ANTES de pulsar nada («emision_solicitada»);
//   2) tras cualquier interrupción, error o cierre de sesión, un documento en «emision_solicitada/emision_desconocida/emitido» NO se reintenta
//      automáticamente; una persona debe conciliar en el portal y marcarlo («descartado» solo si comprobó que NO existe).
// Este módulo no emite ni puede emitir: solo registra estados y decide si una ejecución puede empezar.
import fs from "node:fs";
import path from "node:path";
import { hash } from "./progreso.mjs";

export const ESTADOS = ["preparado", "detenido_antes_de_emitir", "emision_solicitada", "emision_desconocida", "emitido", "emitido_manual", "descartado"];
export const ESTADOS_BLOQUEANTES = new Set(["emision_solicitada", "emision_desconocida", "emitido", "emitido_manual"]);
/** Clave estable del documento: misma empresa + mismos datos → misma clave (así un reintento no parece un documento nuevo). */
export const claveIdempotencia = (alias, documento) => hash({ alias, documento }).slice(0, 24);

export function crearLibro({ dir, reloj = () => Date.now() }) {
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, "libro-emisiones.json");
  const leer = () => { try { return JSON.parse(fs.readFileSync(archivo, "utf8")); } catch { return {}; } };
  const escribir = (o) => { const tmp = `${archivo}.tmp`; fs.writeFileSync(tmp, JSON.stringify(o, null, 2)); fs.renameSync(tmp, archivo); };
  return {
    archivo,
    estado: (clave) => { const h = leer()[clave]?.historial; return h?.length ? h[h.length - 1].estado : null; },
    registrar(clave, estado, nota = "") {
      if (!ESTADOS.includes(estado)) throw new Error(`estado no válido: ${estado}`);
      const o = leer(); (o[clave] ??= { historial: [] }).historial.push({ estado, t: new Date(reloj()).toISOString(), nota: String(nota).slice(0, 120) }); escribir(o);
    },
    /** ¿Puede empezar una ejecución sobre este documento? No si hay una emisión solicitada, desconocida o ya hecha sin conciliar. */
    puedeEjecutar(clave) {
      const e = this.estado(clave);
      if (e && ESTADOS_BLOQUEANTES.has(e)) return { permitir: false, razon: `el documento figura como «${e}»: concilia en el portal (¿existe ya?) y márcalo («descartado» solo si NO existe) antes de volver a ejecutar` };
      return { permitir: true, razon: e ? `último estado: ${e}` : "sin antecedentes" };
    },
  };
}
