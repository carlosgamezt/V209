// Constantes del esquema XSD oficial (GT_Documento-0.2.1.xsd) EXTRAÍDAS del propio archivo versionado (enumeraciones y patrones), para no copiarlas a mano.
// Los límites numéricos (longitudes, cardinalidades) están en estructura.ts y una prueba los contrasta con las facetas del XSD.
import { ErrorFiscal } from "./error.ts";

export interface Esquema {
  tiposDte: string[]; afiliacionesIva: string[]; monedas: string[]; tiposImpuesto: string[]; paises: Set<string>; destinosVenta: string[]; codigosProducto: string[];
  patrones: { nitReceptor: RegExp; nitEmisor: RegExp; uuid: RegExp; correo: RegExp };
  textoPatron: { nitReceptor: string; nitEmisor: string; uuid: string; correo: string };
}
const decodificar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const sinComentarios = (t: string) => t.replace(/<!--[\s\S]*?-->/g, "");

/** Convierte un patrón de XML Schema a RegExp de JS: anclado (los patrones del XSD abarcan todo el valor) y con `\w` de XSD (todo salvo puntuación, separadores y controles). */
export function xsdRegexAJs(p: string): RegExp {
  const W = "[^\\p{P}\\p{Z}\\p{C}]";
  let salida = "", i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "\\") { const s = p[i + 1]; if (s === "w") { salida += W; i += 2; continue; } salida += c + (s ?? ""); i += 2; continue; }
    if (c === "[") {
      let j = i + 1; while (j < p.length && p[j] !== "]") { if (p[j] === "\\") j++; j++; }
      const cuerpo = p.slice(i + 1, j);
      if (cuerpo.includes("\\w")) { const resto = cuerpo.replace(/\\w/g, ""); salida += resto ? `(?:[${resto}]|${W})` : W; } else salida += `[${cuerpo}]`;
      i = j + 1; continue;
    }
    salida += c; i++;
  }
  return new RegExp(`^(?:${salida})$`, "u");
}

export function extraerEsquema(xsdTexto: string): Esquema {
  const t = sinComentarios(xsdTexto);
  const bloque = (re: RegExp, que: string) => { const m = re.exec(t); if (!m) throw new ErrorFiscal("XSD_INCOMPLETO", `No se encontró en el XSD: ${que}`); return m[0]; };
  const tipoSimple = (nombre: string) => bloque(new RegExp(`<xs:simpleType name="${nombre}"[^>]*>[\\s\\S]*?</xs:simpleType>`), nombre);
  const enumeracion = (b: string) => [...b.matchAll(/<xs:enumeration value="([^"]*)"/g)].map((m) => decodificar(m[1]));
  const patron = (nombre: string) => { const m = /<xs:pattern value="([^"]*)"/.exec(tipoSimple(nombre)); if (!m) throw new ErrorFiscal("XSD_INCOMPLETO", `Sin patrón: ${nombre}`); return decodificar(m[1]); };
  const atributo = (nombre: string) => bloque(new RegExp(`<xs:attribute name="${nombre}"[^>]*>[\\s\\S]*?</xs:attribute>`), `atributo ${nombre}`);
  const textoPatron = { nitReceptor: patron("tipoNITReceptor"), nitEmisor: patron("tipoNITDelEFACE"), uuid: patron("tipoUUID"), correo: patron("TipoCorreoElectronico") };
  return {
    tiposDte: enumeracion(atributo("Tipo")), afiliacionesIva: enumeracion(atributo("AfiliacionIVA")), monedas: enumeracion(tipoSimple("tipoMoneda")), tiposImpuesto: enumeracion(tipoSimple("TipoImpuesto")),
    paises: new Set(enumeracion(tipoSimple("tipoCodigoPais"))), destinosVenta: enumeracion(tipoSimple("DestinoDeLaVentaCondicion")), codigosProducto: enumeracion(tipoSimple("CodigoProducto")),
    patrones: { nitReceptor: xsdRegexAJs(textoPatron.nitReceptor), nitEmisor: xsdRegexAJs(textoPatron.nitEmisor), uuid: xsdRegexAJs(textoPatron.uuid), correo: xsdRegexAJs(textoPatron.correo) },
    textoPatron,
  };
}
