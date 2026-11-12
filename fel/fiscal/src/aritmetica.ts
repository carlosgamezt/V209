// VERIFICACIÓN ARITMÉTICA (no cálculo) con racionales exactos. Cada comprobación sigue el texto de un mensaje oficial (catalogoMensajes-0.3.0). La TOLERANCIA es un parámetro OBLIGATORIO: el anexo
// oficial que la define no está disponible (V2), por lo que no existe valor predeterminado. Lo que no está respaldado por fuente oficial se devuelve como «noVerificable», nunca como correcto.
import { ErrorFiscal } from "./error.ts";
import { esTextoDecimal, Racional } from "./decimal.ts";
import type { Recursos } from "./recursos.ts";
import type { Dte, NoVerificable, Violacion } from "./modelo.ts";

export interface OpcionesAritmetica { tolerancia: string }
export interface ResultadoAritmetico { violaciones: Violacion[]; noVerificable: NoVerificable[]; comprobaciones: number }

export function exigirTolerancia(t: unknown): Racional {
  if (t === undefined || t === null) throw new ErrorFiscal("TOLERANCIA_OBLIGATORIA", "La tolerancia de cálculo es un parámetro obligatorio y no tiene valor predeterminado (V2)");
  if (!esTextoDecimal(t)) throw new ErrorFiscal("TOLERANCIA_INVALIDA", "La tolerancia debe ser un texto decimal (no un número de coma flotante)");
  const r = Racional.desdeTexto(t); if (r.esNegativo()) throw new ErrorFiscal("TOLERANCIA_INVALIDA", "La tolerancia no puede ser negativa");
  return r;
}
const cero = (t?: string) => (t === undefined ? Racional.CERO : Racional.desdeTexto(t));

export function verificarAritmetica(dte: Dte, rec: Recursos, op: OpcionesAritmetica): ResultadoAritmetico {
  const tol = exigirTolerancia(op?.tolerancia), V: Violacion[] = [], N: NoVerificable[] = []; let n = 0;
  const difiere = (a: Racional, b: Racional) => a.restar(b).abs().mayor(tol);
  const viola = (regla: string, ruta: string, mensaje: string, esperado: Racional, hallado: Racional) => V.push({ regla, severidad: "error", ruta, mensaje, esperado: esperado.aTextoExacto(), encontrado: hallado.aTextoExacto() });
  const noVer = (regla: string, ruta: string, motivo: string, puntos: string[]) => N.push({ regla, ruta, motivo, puntos });
  const iva = rec.unidades.get("IVA"), ivaFactor1 = iva?.unidades.get(1)?.factor;
  if (ivaFactor1 === undefined || ivaFactor1 === null) throw new ErrorFiscal("CATALOGO_INCOMPLETO", "El catálogo de unidades gravables no define el IVA 1");
  const factorIva = Racional.desdeTexto(ivaFactor1), divisorIva = Racional.UNO.sumar(factorIva); // «factor 1.12» de RCP226 = 1 + porcentaje del catálogo
  const totalesItems: Racional[] = []; const sumaIva: Racional[] = []; let hayIva = false, ivaVerificable = true;

  dte.Items.forEach((it, i) => {
    const R = `Items/${i}`, precio = Racional.desdeTexto(it.Precio);
    n++; const esperadoPrecio = Racional.desdeTexto(it.Cantidad).multiplicar(Racional.desdeTexto(it.PrecioUnitario));
    if (difiere(precio, esperadoPrecio)) viola("ARI-PRECIO", `${R}/Precio`, "Precio ≠ Cantidad × PrecioUnitario", esperadoPrecio, precio);
    const desc = cero(it.Descuento), otros = cero(it.OtrosDescuento);
    n++; if (desc.mayor(precio)) viola("ARI-DESCUENTO", `${R}/Descuento`, "Descuento mayor que Precio", precio, desc);
    let totalVerificable = it.Idp === undefined;
    if (it.Idp !== undefined) noVer("ARI-TOTAL-ITEM", `${R}/Idp`, "La fuente oficial consultada no define el tratamiento de Idp en el Total", ["V11"]);
    for (const [j, im] of (it.Impuestos ?? []).entries()) {
      const RI = `${R}/Impuestos/${j}`, cat = rec.unidades.get(im.NombreCorto);
      if (!cat) continue; // ya reportado como fuera de enumeración por la estructura
      const u = cat.unidades.get(im.CodigoUnidadGravable);
      if (!u) { V.push({ regla: "CAT-UG-EXISTE", severidad: "error", ruta: `${RI}/CodigoUnidadGravable`, mensaje: "La unidad gravable no existe en el catálogo del impuesto", encontrado: `${im.NombreCorto}/${im.CodigoUnidadGravable}` }); totalVerificable = false; continue; }
      n++;
      if (u.operaSobre === "MontoGravable" && im.MontoGravable === undefined) V.push({ regla: "CAT-UG-CASILLA", severidad: "error", ruta: `${RI}/MontoGravable`, mensaje: "El catálogo indica que opera sobre MontoGravable y no está presente" });
      if (u.operaSobre === "CantidadUnidadesGravables" && im.CantidadUnidadesGravables === undefined) V.push({ regla: "CAT-UG-CASILLA", severidad: "error", ruta: `${RI}/CantidadUnidadesGravables`, mensaje: "El catálogo indica que opera sobre CantidadUnidadesGravables y no está presente" });
      if (u.operaSobre === "MontoGravable" && im.CantidadUnidadesGravables !== undefined) V.push({ regla: "CAT-UG-CASILLA", severidad: "error", ruta: `${RI}/CantidadUnidadesGravables`, mensaje: "Presente una casilla que el catálogo no usa para este impuesto" });
      if (u.operaSobre === "CantidadUnidadesGravables" && im.MontoGravable !== undefined) V.push({ regla: "CAT-UG-CASILLA", severidad: "error", ruta: `${RI}/MontoGravable`, mensaje: "Presente una casilla que el catálogo no usa para este impuesto" });
      if (im.NombreCorto !== "IVA") { noVer("ARI-TOTAL-ITEM", RI, `Impuesto ${im.NombreCorto}: sin fuente oficial leída sobre su cálculo ni sobre si se suma al Total`, ["V11"]); totalVerificable = false; continue; }
      hayIva = true;
      if (im.CodigoUnidadGravable !== 1) { noVer("ARI-IVA-BASE", RI, "IVA con unidad gravable distinta de 1: RCP226 solo define la base para la unidad 1", ["V1", "V3"]); ivaVerificable = false; sumaIva.push(Racional.desdeTexto(im.MontoImpuesto)); continue; }
      if (!otros.esCero()) { noVer("ARI-IVA-BASE", RI, "OtrosDescuento distinto de cero: RCP226 y SEC500 difieren en si lo restan; no se verifica", ["V1", "V2"]); ivaVerificable = false; sumaIva.push(Racional.desdeTexto(im.MontoImpuesto)); continue; }
      if (im.MontoGravable === undefined) { ivaVerificable = false; continue; }
      const base = Racional.desdeTexto(im.MontoGravable), baseEsperada = precio.restar(desc).restar(otros).dividir(divisorIva);
      if (difiere(base, baseEsperada)) viola("ARI-IVA-BASE", `${RI}/MontoGravable`, "MontoGravable ≠ (Precio − Descuento − OtrosDescuento) / 1.12", baseEsperada, base);
      n++; const monto = Racional.desdeTexto(im.MontoImpuesto), montoEsperado = base.multiplicar(factorIva);
      if (difiere(monto, montoEsperado)) viola("ARI-IVA-IMPUESTO", `${RI}/MontoImpuesto`, "MontoImpuesto ≠ MontoGravable × 0.12", montoEsperado, monto);
      sumaIva.push(monto);
    }
    if (totalVerificable) {
      n++; const totalEsperado = precio.restar(desc), total = Racional.desdeTexto(it.Total); // el IVA no se suma (RCP348); sin otros impuestos sumables verificados
      if (difiere(total, totalEsperado)) viola("ARI-TOTAL-ITEM", `${R}/Total`, "Total ≠ Precio − Descuento (+ impuestos sumables distintos del IVA)", totalEsperado, total);
    }
    totalesItems.push(Racional.desdeTexto(it.Total));
  });

  // Totales por impuesto (RCP332): solo IVA
  const ti = dte.Totales.TotalImpuestos ?? [];
  if (hayIva && !ti.some((x) => x.NombreCorto === "IVA")) noVer("ARI-TOTAL-IMPUESTO", "Totales/TotalImpuestos", "Hay IVA en los ítems y no hay TotalImpuesto de IVA: no se puede verificar RCP332", ["V1"]);
  ti.forEach((x, i) => {
    if (x.NombreCorto !== "IVA") { noVer("ARI-TOTAL-IMPUESTO", `Totales/TotalImpuestos/${i}`, `Total de ${x.NombreCorto}: sin fuente oficial leída`, ["V11"]); return; }
    if (!ivaVerificable) { noVer("ARI-TOTAL-IMPUESTO", `Totales/TotalImpuestos/${i}`, "Algún IVA de los ítems no es verificable; la suma no se puede dar por correcta", ["V1"]); return; }
    n++; const esperado = Racional.suma(sumaIva), hallado = Racional.desdeTexto(x.TotalMontoImpuesto);
    if (difiere(hallado, esperado)) viola("ARI-TOTAL-IMPUESTO", `Totales/TotalImpuestos/${i}/TotalMontoImpuesto`, "TotalMontoImpuesto ≠ suma de MontoImpuesto del IVA", esperado, hallado);
  });
  n++; const gt = Racional.desdeTexto(dte.Totales.GranTotal), sumaTotales = Racional.suma(totalesItems);
  if (difiere(gt, sumaTotales)) viola("ARI-GRAN-TOTAL", "Totales/GranTotal", "GranTotal ≠ suma de los Total de los ítems", sumaTotales, gt);
  return { violaciones: V, noVerificable: N, comprobaciones: n };
}
