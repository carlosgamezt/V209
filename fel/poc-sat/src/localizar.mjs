// Convierte un «localizador» del mapeo en un Locator de Playwright. Exige que coincida con EXACTAMENTE un elemento.
export function construir(page, l) {
  let ambito = page;
  if (l.marco?.url_contiene) { const f = page.frames().find((x) => x.url().includes(l.marco.url_contiene)); if (!f) throw new Error(`no se encontró el marco que contiene «${l.marco.url_contiene}»`); ambito = f; }
  const exacto = l.exacto !== false;
  switch (l.estrategia) {
    case "etiqueta": return ambito.getByLabel(l.valor, { exact: exacto });
    case "rol": return ambito.getByRole(l.rol, { name: l.valor, exact: exacto });
    case "nombre": case "ng_model": { const attr = l.estrategia === "nombre" ? "name" : "ng-model", q = String(l.valor).replace(/"/g, '\\"'); return ambito.locator(`${l.tag ?? ""}[${attr}="${q}"]`); }
    case "id": return ambito.locator(`[id="${String(l.valor).replace(/"/g, '\\"')}"]`);
    case "marcador": return ambito.getByPlaceholder(l.valor, { exact: exacto });
    case "texto": return ambito.getByText(l.valor, { exact: exacto });
    default: throw new Error(`estrategia desconocida: ${l.estrategia}`);
  }
}
export async function resolver(page, l, { timeout = 5000 } = {}) {
  const loc = construir(page, l);
  const fin = Date.now() + timeout;
  let n = await loc.count();
  while (n === 0 && Date.now() < fin) { await new Promise((r) => setTimeout(r, 150)); n = await loc.count(); }
  if (n === 0) throw new Error(`el localizador (${l.estrategia}: «${l.valor}») no encontró ningún elemento`);
  if (n > 1) throw new Error(`el localizador (${l.estrategia}: «${l.valor}») es ambiguo: coincide con ${n} elementos`);
  return loc;
}
