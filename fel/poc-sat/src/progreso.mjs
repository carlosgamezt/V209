// Progreso del llenado: un punto de control (checkpoint) por ejecución, escrito de forma atómica tras cada paso.
// Contiene SOLO ids de pasos, marcas de tiempo y estado. Nunca valores de campos, cookies, tokens ni credenciales.
// Ojo: esto NO guarda el borrador del portal (eso lo conserva —o no— el propio portal; está por verificar). Guarda qué pasos ya se aplicaron.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const canonico = (o) => JSON.stringify(o, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
export const hash = (o) => crypto.createHash("sha256").update(canonico(o)).digest("hex");
export const TIPOS_IDEMPOTENTES = new Set(["llenar", "seleccionar", "marcar", "leer", "esperar_visible"]);
/** Un paso es idempotente (repetirlo no duplica nada) si es de llenado/lectura. clic_seguro y manual NO lo son salvo que una persona lo declare en el plan. */
export const esIdempotente = (p) => (p.idempotente != null ? p.idempotente : TIPOS_IDEMPOTENTES.has(p.tipo));

export function crearProgreso({ dir, plan, datos, reloj = () => Date.now() }) {
  fs.mkdirSync(dir, { recursive: true });
  const ph = hash(plan.pasos), dh = hash(datos), archivo = path.join(dir, `progreso-${ph.slice(0, 8)}-${dh.slice(0, 8)}.json`);
  let s = null;
  const guardar = () => { const tmp = `${archivo}.tmp`; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, archivo); };
  return {
    archivo,
    /** Estado guardado de una ejecución anterior de ESTE plan y ESTOS datos (o null). */
    cargar() { try { return JSON.parse(fs.readFileSync(archivo, "utf8")); } catch { return null; } },
    iniciar({ desde = null } = {}) { s = desde ? { ...desde, estado: "en_curso", reanudaciones: (desde.reanudaciones ?? 0) + 1 } : { version: 1, plan: ph, datos: dh, inicio: new Date(reloj()).toISOString(), estado: "en_curso", pausas_por_sesion: 0, reanudaciones: 0, completados: [] }; guardar(); },
    archivarPrevio() { if (fs.existsSync(archivo)) fs.renameSync(archivo, `${archivo}.previo-${Date.now()}`); },
    completados: () => (s?.completados ?? []).map((x) => x.id),
    marcarPaso(p) { if (!s.completados.some((x) => x.id === p.id)) s.completados.push({ id: p.id, tipo: p.tipo, idempotente: esIdempotente(p), t: new Date(reloj()).toISOString() }); guardar(); },
    desmarcarPasos(ids) { s.completados = s.completados.filter((x) => !ids.includes(x.id)); guardar(); },
    pausaPorSesion() { s.pausas_por_sesion++; s.estado = "pausado_por_sesion"; guardar(); },
    estado(nuevo) { s.estado = nuevo; s.actualizado = new Date(reloj()).toISOString(); guardar(); },
    snapshot: () => structuredClone(s),
  };
}

/**
 * PURA. Qué hacer al reanudar, dado qué pasos ya estaban hechos y qué muestra una verificación de SOLO LECTURA de cada uno.
 *  pasos: plan.pasos · completados: ids hechos · verificacion: { id: "ok" | "distinto" | "ausente" } para los pasos de llenado hechos
 * Reglas:
 *  - todo «ok» → continuar sin repetir nada;
 *  - algo distinto/ausente → solo se puede reaplicar si TODOS los afectados están después del último paso NO idempotente hecho (p. ej. un clic que
 *    abrió una pestaña o agregó una línea): repetir un clic podría duplicar líneas, así que si el portal perdió algo anterior a ese punto
 *    se exige reiniciar a mano desde un formulario vacío.
 */
export function planificarReanudacion(pasos, completados, verificacion) {
  const hechos = pasos.filter((p) => completados.includes(p.id));
  let ultimoNoIdem = -1; hechos.forEach((p, i) => { if (!esIdempotente(p) && p.tipo !== "manual") ultimoNoIdem = i; });
  const malos = hechos.map((p, i) => ({ p, i })).filter(({ p }) => verificacion[p.id] && verificacion[p.id] !== "ok");
  if (!malos.length) return { accion: "continuar", reaplicar: [] };
  if (malos.some(({ i }) => i <= ultimoNoIdem)) return { accion: "reinicio_manual", reaplicar: [], razon: "el portal perdió datos anteriores a un paso que no se puede repetir sin riesgo de duplicar (clic de apertura/agregado)" };
  return { accion: "reaplicar", reaplicar: malos.map(({ p }) => p.id) };
}
