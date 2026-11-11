import { hostPermitido } from "./guardia.mjs";
export class ErrorDominio extends Error {}
// Convierte un «localizador» del mapeo en un Locator de Playwright. Exige que coincida con EXACTAMENTE un elemento.
export function construir(page, l, dominios = null) {
  let ambito = page;
  if (l.marco?.url_contiene) { const hp = (u) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`; } catch { return ""; } };   // host + ruta, sin puerto ni parámetros
    const f = page.frames().find((x) => hp(x.url()).includes(l.marco.url_contiene)); if (!f) throw new Error(`no se encontró el marco que contiene «${l.marco.url_contiene}»`);
    if (dominios) { let h = ""; try { h = new URL(f.url()).hostname; } catch { /* about:blank */ } if (!hostPermitido(h, dominios)) throw new ErrorDominio(`el marco «${h || "?"}» no está en dominios_permitidos`); }
    ambito = f; }
  const exacto = l.exacto !== false;
  switch (l.estrategia) {
    case "etiqueta": return ambito.getByLabel(l.valor, { exact: exacto });
    case "rol": return ambito.getByRole(l.rol, { name: l.valor, exact: exacto });
    case "nombre": case "ng_model": { const attr = l.estrategia === "nombre" ? "name" : "ng-model", q = String(l.valor).replace(/"/g, '\\"'); return ambito.locator(`${l.tag ?? ""}[${attr}="${q}"]${l.visible === true ? ":visible" : ""}`); }
    case "id": return ambito.locator(`[id="${String(l.valor).replace(/"/g, '\\"')}"]`);
    case "marcador": return ambito.getByPlaceholder(l.valor, { exact: exacto });
    case "clase": return ambito.locator(`${l.tag ?? ""}.${l.valor}${l.visible === true ? ":visible" : ""}`);
    case "texto": return ambito.getByText(l.valor, { exact: exacto });
    default: throw new Error(`estrategia desconocida: ${l.estrategia}`);
  }
}
export async function resolver(page, l, { timeout = 5000, dominios = null } = {}) {
  const loc = construir(page, l, dominios);
  const fin = Date.now() + timeout;
  let n = await loc.count();
  while (n === 0 && Date.now() < fin) { await new Promise((r) => setTimeout(r, 150)); n = await loc.count(); }
  if (n === 0) throw new Error(`el localizador (${l.estrategia}: «${l.valor}») no encontró ningún elemento`);
  if (n > 1) throw new Error(`el localizador (${l.estrategia}: «${l.valor}») es ambiguo: coincide con ${n} elementos`);
  return loc;
}
