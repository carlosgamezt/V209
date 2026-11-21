// Ayudas de las pruebas de navegador para el receptor INTELIGENTE de «Nueva factura»: tipo con control segmentado, un solo campo de identificación y sugerencias de clientes guardados.
const ID = 'input[aria-label="Identificación del receptor"]', NOMBRE = '[aria-label="Nombre del receptor"]';
const SEG = (t) => `.seg-tipo [role="radio"][data-tipo="${t}"]`;
/** Espera a que cargue «Nueva factura» (el campo de identificación del receptor). */
const esperarNueva = (p) => p.waitForSelector(ID);
/** Tipo de identificación seleccionado en el control segmentado («NIT», «CUI», «CF» o «EXT»). */
const tipoActual = (p) => p.locator('.seg-tipo [role="radio"][aria-checked="true"]').getAttribute("data-tipo");
const elegirTipo = (p, t) => p.click(SEG(t));
/** Receptor GUARDADO: se busca por nombre (como lo hace la persona) y se toca la sugerencia «Existente». `arg`: RegExp sobre el nombre, o nada para el primero que no sea consumidor final. */
async function elegirReceptor(p, arg) {
  const clientes = await p.evaluate(async () => (await (await fetch("/api/estado", { headers: { "x-demo": "1" } })).json()).clientes);
  const c = clientes.find((x) => x.tipo_identificacion !== "CF" && (arg instanceof RegExp ? arg.test(x.nombre) : true)); if (!c) throw new Error(`no hay un cliente que coincida con ${arg}`);
  await p.fill(ID, c.nombre.slice(0, 8)); const fila = p.locator(".rc-sug .sg-ex", { hasText: c.nombre }).first(); await fila.waitFor({ state: "visible" }); await fila.click();
  await p.waitForSelector('.rc-card[data-modo="existente"]'); return c;
}
/** Receptor NUEVO: elige el tipo, escribe la identificación y, si se indica, el nombre. */
async function receptorNuevo(p, tipo, id, nombre) {
  await elegirTipo(p, tipo); await p.fill(ID, id); if (nombre !== undefined) { await p.waitForSelector(`${NOMBRE}`); await p.fill(NOMBRE, nombre); }
}
/** Escribe el nombre del receptor: si ya hay uno confirmado (se ve como texto), primero se toca para editarlo, igual que haría la persona. */
async function escribirNombre(p, texto) {
  const t = p.locator(NOMBRE); if (!(await t.isVisible())) await p.click("#receptor-nombre-ver");
  await t.fill(texto); await t.blur();
}
module.exports = { escribirNombre, ID, NOMBRE, SEG, esperarNueva, tipoActual, elegirTipo, elegirReceptor, receptorNuevo };
