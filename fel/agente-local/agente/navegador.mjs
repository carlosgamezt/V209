// Navegador del agente: Chromium con un PERFIL INDEPENDIENTE (carpeta propia del agente; nunca el Chrome ni las sesiones del usuario) que solo puede abrir el
// origen exacto del simulador. El agente llena el formulario y se DETIENE en la vista previa. Este módulo no contiene ninguna acción de confirmación a propósito:
// la confirmación exige una concesión de NEXA (fel/docs/agente-confirmacion-humana.md) y la hace la persona.
import { ErrorRed, peticionPermitida } from "./seguridad_red.mjs";

export class ErrorOrden extends Error { constructor(codigo, mensaje) { super(mensaje ?? codigo); this.codigo = codigo; } }
const TIPOS = new Set(["NIT", "CUI", "EXT", "CF"]);
const hoy = () => new Date().toISOString().slice(0, 10);

/** Traduce la instantánea CONGELADA de la orden al formulario del simulador. Lanza ErrorOrden si algo no es representable (antes de tocar nada). */
export function aFormulario(i) {
  if (!i || typeof i !== "object") throw new ErrorOrden("ORDEN_INVALIDA", "La orden no trae datos");
  const tipo = i.cliente?.tipo_identificacion;
  if (!TIPOS.has(tipo)) throw new ErrorOrden("RECEPTOR_NO_SOPORTADO", `Tipo de identificación no soportado: ${String(tipo)}`);
  if (!Array.isArray(i.lineas) || i.lineas.length < 1 || i.lineas.length > 50) throw new ErrorOrden("ORDEN_INVALIDA", "La orden debe tener de 1 a 50 conceptos");
  return {
    tipo_documento: "FACT-SIM", fecha: String(i.fecha_emision_prevista ?? hoy()).slice(0, 10), moneda: "GTQ",
    establecimiento: { codigo: String(i.establecimiento?.codigo_sat ?? "") },
    receptor: { tipo_id: tipo, id: tipo === "CF" ? "CF" : String(i.cliente.numero_identificacion ?? ""), nombre: tipo === "CF" ? "" : String(i.cliente.nombre ?? ""), direccion: "" },
    lineas: i.lineas.map((l) => ({ tipo: "Servicio", descripcion: String(l.descripcion ?? ""), cantidad: String(l.cantidad), precio_unitario: String(l.precio_unitario), descuento: String(l.importes?.descuento ?? "0") })),
    observaciones: "",
  };
}

/** Abre Chromium (perfil propio) y devuelve un manejador. `chromium` viene de Playwright (inyectado para poder probar). */
export async function abrirNavegador({ chromium, perfil, origenSimulador, headless = true, majorEsperado = 131, bloqueadas = [] }) {
  const contexto = await chromium.launchPersistentContext(perfil, {
    headless, acceptDownloads: false, serviceWorkers: "block", locale: "es-GT", viewport: { width: 1200, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update"],
  });
  try {
    await contexto.route("**/*", (r) => { const u = r.request().url(); if (peticionPermitida(u, origenSimulador)) return r.continue(); bloqueadas.push(u); return r.abort("blockedbyclient"); });
    const pagina = contexto.pages()[0] ?? await contexto.newPage();
    const ua = await pagina.evaluate(() => navigator.userAgent).catch(() => "");
    const mayor = Number(/Chrome\/(\d+)\./.exec(ua)?.[1] ?? 0);
    if (majorEsperado && mayor !== majorEsperado) throw new ErrorRed("NAVEGADOR", `Se esperaba Chromium ${majorEsperado} y se encontró ${mayor || "desconocido"}`);
    return {
      pagina, version: mayor,
      /** Llena el formulario y llega a la vista previa. Si el simulador rechaza algún dato, lanza ErrorOrden con los mensajes (nada se emitió). */
      async llenarYPrevisualizar(url, f) {
        if (!peticionPermitida(url, origenSimulador)) throw new ErrorRed("BLOQUEADO", "La dirección no es la del simulador local");
        await pagina.goto(url, { waitUntil: "load" });
        await pagina.selectOption("#tipo_documento", f.tipo_documento); await pagina.fill("#fecha", f.fecha); await pagina.fill("#establecimiento_codigo", f.establecimiento.codigo);
        await pagina.selectOption("#receptor_tipo", f.receptor.tipo_id); await pagina.fill("#receptor_id", f.receptor.id); await pagina.fill("#receptor_nombre", f.receptor.nombre); await pagina.fill("#receptor_direccion", f.receptor.direccion);
        for (let n = 0; n < f.lineas.length; n++) {
          if (n > 0) await pagina.click("#btn-agregar");
          const l = pagina.locator(".linea").nth(n), v = f.lineas[n];
          await l.locator('[data-k="tipo"]').selectOption(v.tipo); await l.locator('[data-k="descripcion"]').fill(v.descripcion);
          await l.locator('[data-k="cantidad"]').fill(v.cantidad); await l.locator('[data-k="precio_unitario"]').fill(v.precio_unitario); await l.locator('[data-k="descuento"]').fill(v.descuento);
        }
        await pagina.fill("#observaciones", f.observaciones);
        await pagina.click("#btn-previa");
        await Promise.race([pagina.waitForSelector("#seccion-previa:not([hidden])", { timeout: 15000 }), pagina.waitForSelector("#errores:not([hidden])", { timeout: 15000 })]);
        if (await pagina.locator("#errores").isVisible()) throw new ErrorOrden("VALIDACION_SIMULADOR", (await pagina.locator("#errores").innerText()).slice(0, 300));
      },
      cerrar: () => contexto.close().catch(() => {}),
    };
  } catch (e) { await contexto.close().catch(() => {}); throw e; }
}
