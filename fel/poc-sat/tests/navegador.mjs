// Navegador SOLO para las pruebas locales y simuladas. No lo usa el motor de ejecución real (src/, bin/) y no cambia ningún control de seguridad.
// Por defecto: el Chromium de Playwright (CI). Con FEL_NAVEGADOR=chrome: el Google Chrome instalado (channel «chrome»), p. ej. en Windows.
// Opcional: FEL_NAVEGADOR_RUTA=ruta\al\ejecutable para un Chrome/Chromium instalado en otro lugar (tiene prioridad sobre el canal).
import { chromium } from "../src/playwright.mjs";

/** PURA: opciones de lanzamiento según el entorno. */
export function opcionesNavegador(env = process.env) {
  const nombre = String(env.FEL_NAVEGADOR ?? "chromium").trim().toLowerCase() || "chromium";
  if (!["chromium", "chrome"].includes(nombre)) throw new Error(`FEL_NAVEGADOR no válido: «${env.FEL_NAVEGADOR}» (usa «chromium» o «chrome»)`);
  const ruta = String(env.FEL_NAVEGADOR_RUTA ?? "").trim();
  if (ruta) return { executablePath: ruta };
  return nombre === "chrome" ? { channel: "chrome" } : {};
}
export const descripcionNavegador = (env = process.env) => { const o = opcionesNavegador(env); return o.executablePath ? `ejecutable ${o.executablePath}` : o.channel ? `Google Chrome instalado (channel «${o.channel}»)` : "Chromium de Playwright (predeterminado)"; };
export const lanzar = (opciones = {}) => chromium.launch({ ...opciones, ...opcionesNavegador() });
export const lanzarPersistente = (dir, opciones = {}) => chromium.launchPersistentContext(dir, { ...opciones, ...opcionesNavegador() });
