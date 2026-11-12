// REGLAS DE FRASES respaldadas por el catálogo oficial de frases (CatalogoFrases-0.6.0) y por los textos del catálogo de mensajes (catalogoMensajes-0.3.0).
// NO se implementa qué frases corresponden a cada régimen (V4 bloqueado): solo existencia en catálogo, unicidad y las condiciones literales de RCP487, RCP325, RCP323 y RCP112 (cláusulas 1 y 2).
import type { Recursos } from "./recursos.ts";
import type { Dte, Violacion } from "./modelo.ts";

/** Código del tipo de frase «exento o no afecto al IVA»: se obtiene del catálogo (por su nombre oficial), no se asume. */
export function tipoFraseExento(rec: Recursos): number {
  const r = [...rec.frases.values()].filter((t) => /exento o no afecto al IVA/i.test(t.nombre));
  if (r.length !== 1) throw new Error("El catálogo de frases no identifica de forma única el tipo «exento o no afecto al IVA»");
  return r[0].codigo;
}
const tieneIva = (it: Dte["Items"][number]) => (it.Impuestos ?? []).some((i) => i.NombreCorto === "IVA");

export function validarFrases(dte: Dte, rec: Recursos): Violacion[] {
  const V: Violacion[] = [], tipo = dte.DatosGenerales.Tipo, frases = dte.Frases ?? [];
  const err = (regla: string, ruta: string, mensaje: string, encontrado?: string) => V.push({ regla, severidad: "error", ruta, mensaje, ...(encontrado ? { encontrado } : {}) });
  frases.forEach((f, i) => {
    const t = rec.frases.get(f.TipoFrase);
    if (!t || !t.escenarios.has(f.CodigoEscenario)) err("FRA-CATALOGO", `Frases/${i}`, "El tipo de frase o su escenario no existe en el catálogo oficial de frases", `${f.TipoFrase}/${f.CodigoEscenario}`);
    // RCP112 cláusulas 1 y 2 (la tercera cláusula del texto oficial es ambigua y NO se implementa)
    if (f.TipoFrase === 9) {
      if (f.CodigoEscenario === 15 && !["FACT", "FCAM", "FPEQ", "FCAP"].includes(tipo)) err("FRA-ESCENARIOS-9", `Frases/${i}`, "Frase 9 escenario 15 solo en FACT, FCAM, FPEQ o FCAP", tipo);
      if ((f.CodigoEscenario === 16 || f.CodigoEscenario === 17) && tipo !== "NABN") err("FRA-ESCENARIOS-9", `Frases/${i}`, "Frase 9 escenarios 16 y 17 solo en NABN", tipo);
    }
  });
  if (tipo !== "RANT") {
    const vistos = new Set<number>();
    frases.forEach((f, i) => { if (vistos.has(f.TipoFrase)) err("FRA-UNICA", `Frases/${i}`, "El mismo tipo de frase no puede repetirse (salvo en RANT)", String(f.TipoFrase)); vistos.add(f.TipoFrase); });
  }
  const exento = tipoFraseExento(rec), hayExento = frases.some((f) => f.TipoFrase === exento), exportacion = dte.DatosGenerales.Exp === "SI";
  if (["FACT", "FCAM", "FACP", "NDEB", "NCRE"].includes(tipo) && exportacion && !hayExento) err("FRA-EXENTO-EXPORTACION", "Frases", "Con exportación debe estar la frase de exento o no afecto al IVA (tipo " + exento + ")");
  if (["FACT", "FCAM"].includes(tipo) && !exportacion && dte.Items.some((it) => !tieneIva(it)) && !hayExento) err("FRA-EXENTO-ITEMS-SIN-IVA", "Frases", "Hay ítems sin IVA: debe estar la frase de exento o no afecto al IVA (tipo " + exento + ")");
  return V;
}
