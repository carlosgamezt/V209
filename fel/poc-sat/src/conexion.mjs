// Conexión con Chrome. Dos modos, ninguno guarda ni teclea credenciales:
//  - cdp:    te conectas a UN Chrome que TÚ abriste y en el que iniciaste sesión a mano (puerto de depuración local).
//  - perfil: Playwright abre Chrome con un perfil propio de la empresa (fuera del repositorio); inicias sesión a mano en esa ventana.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./playwright.mjs";
import { validarEndpointCdp, rutaDentroDe, evaluarSolicitud } from "./guardia.mjs";

export const RAIZ_REPO = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Bloqueo por perfil: impide dos ejecuciones a la vez sobre la misma sesión. */
export function tomarBloqueo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "fel-poc.lock");
  if (fs.existsSync(f)) {
    const pid = Number(fs.readFileSync(f, "utf8"));
    let vivo = false; try { process.kill(pid, 0); vivo = pid !== process.pid; } catch { /* no existe */ }
    if (vivo) throw new Error(`ya hay una ejecución en curso (pid ${pid}) sobre este perfil/empresa`);
  }
  fs.writeFileSync(f, String(process.pid));
  return () => { try { fs.unlinkSync(f); } catch { /* ya no está */ } };
}

export async function conectar(empresa, { lanzar = {} } = {}) {
  if (empresa.modo === "cdp") {
    const v = validarEndpointCdp(empresa.cdp);
    if (!v.ok) throw new Error(`cdp no válido: ${v.razon}`);
    const browser = await chromium.connectOverCDP(empresa.cdp);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome no tiene ningún contexto abierto");
    return { browser, context, cerrar: async () => { /* NO se cierra el Chrome de la persona: solo se suelta la conexión */ await browser.close().catch(() => {}); } };
  }
  if (empresa.modo === "perfil") {
    if (!empresa.perfil_dir) throw new Error("modo perfil: falta perfil_dir");
    if (rutaDentroDe(empresa.perfil_dir, RAIZ_REPO)) throw new Error("perfil_dir no puede estar dentro del repositorio (contiene cookies de sesión)");
    const context = await chromium.launchPersistentContext(path.resolve(empresa.perfil_dir), { channel: "chrome", headless: false, ...lanzar });
    return { browser: context.browser(), context, cerrar: async () => context.close().catch(() => {}) };
  }
  throw new Error(`modo desconocido: ${empresa.modo}`);
}

/** Instala la política de red de solo lectura en TODO el contexto (incluye pestañas nuevas). */
export async function bloquearEscrituras(context, politica, registro) {
  await context.route("**/*", async (route) => {
    const r = route.request(), tipo = r.resourceType(), d = evaluarSolicitud({ metodo: r.method(), url: r.url(), tipoRecurso: tipo }, politica);
    if (d.permitir) { if (tipo === "fetch" || tipo === "xhr") { try { const u = new URL(r.url()); registro.lecturaXhr({ metodo: r.method(), host: u.hostname, ruta: u.pathname }); } catch { /* ignora */ } } return route.continue(); }
    let u; try { u = new URL(r.url()); } catch { u = { hostname: "?", pathname: "?" }; }
    registro.solicitudBloqueada({ metodo: r.method(), host: u.hostname, ruta: u.pathname, razon: d.razon });
    return route.abort("blockedbyclient");
  });
}
