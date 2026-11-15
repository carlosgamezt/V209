// Lee los DATOS DEL EMISOR (nombre, afiliación IVA, establecimiento, dirección y frases) de un DTE que SAT YA ACEPTÓ para el mismo NIT, para no usar datos inventados al armar una factura de prueba.
// El DTE viene en el XML estándar de SAT («dte:Emisor», «dte:DireccionEmisor», «dte:Frases»). Si la estructura no coincide, NO se adivina: se devuelven solo los NOMBRES de las etiquetas vistas.
export interface DatosEmisor {
  nit: string; nombre: string; nombreComercial: string; afiliacionIva: string; codigoEstablecimiento: string; correo: string;
  direccion: { direccion: string; codigoPostal: string; municipio: string; departamento: string; pais: string };
  frases: Array<{ tipo: number; escenario: number }>;
}
export type ResultadoEmisor = { ok: true; datos: DatosEmisor } | { ok: false; motivo: string; etiquetasVistas: string[] };

const decodificar = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const noEsc = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const atributo = (tag: string, nombre: string): string => { const m = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*"([^"]*)"`, "i").exec(tag); return m ? noEsc(m[1]).trim() : ""; };
const hijo = (xml: string, nombre: string): string => { const m = new RegExp(`<(?:[\\w.-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nombre}>`, "i").exec(xml); return m ? noEsc(m[1]).trim() : ""; };

export function extraerEmisorDeDte(xmlB64: string): ResultadoEmisor {
  let xml: string; try { xml = decodificar(xmlB64); } catch { return { ok: false, motivo: "el DTE no es base64 válido", etiquetasVistas: [] }; }
  const etiquetas = [...new Set([...xml.matchAll(/<\/?((?:[\w.-]+:)?[\w.-]+)/g)].map((m) => m[1]))].slice(0, 60);
  const em = /<(?:[\w.-]+:)?Emisor\s([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Emisor>/i.exec(xml);
  if (!em) return { ok: false, motivo: "no se encontró el elemento Emisor", etiquetasVistas: etiquetas };
  const a = (n: string) => atributo(em[1], n), dir = em[2];
  const d: DatosEmisor = {
    nit: a("NITEmisor"), nombre: a("NombreEmisor"), nombreComercial: a("NombreComercial"), afiliacionIva: a("AfiliacionIVA"), codigoEstablecimiento: a("CodigoEstablecimiento"), correo: a("CorreoEmisor"),
    direccion: { direccion: hijo(dir, "Direccion"), codigoPostal: hijo(dir, "CodigoPostal"), municipio: hijo(dir, "Municipio"), departamento: hijo(dir, "Departamento"), pais: hijo(dir, "Pais") },
    frases: [...xml.matchAll(/<(?:[\w.-]+:)?Frase\s([^>]*?)\/?>/gi)].map((m) => ({ tipo: Number(atributo(m[1], "TipoFrase")), escenario: Number(atributo(m[1], "CodigoEscenario")) })).filter((f) => Number.isInteger(f.tipo) && Number.isInteger(f.escenario) && f.tipo > 0),
  };
  const falta = [["NITEmisor", d.nit], ["NombreEmisor", d.nombre], ["AfiliacionIVA", d.afiliacionIva], ["CodigoEstablecimiento", d.codigoEstablecimiento], ["Direccion", d.direccion.direccion], ["CodigoPostal", d.direccion.codigoPostal], ["Municipio", d.direccion.municipio], ["Departamento", d.direccion.departamento]].filter(([, v]) => !v).map(([k]) => k);
  if (falta.length) return { ok: false, motivo: `faltan datos en el DTE: ${falta.join(", ")}`, etiquetasVistas: etiquetas };
  return { ok: true, datos: d };
}
/** Huella corta de los datos del emisor: lo que el usuario aprueba es exactamente lo que se usa al certificar. */
export async function huellaEmisor(d: DatosEmisor): Promise<string> {
  const canon = JSON.stringify([d.nit, d.nombre, d.nombreComercial, d.afiliacionIva, d.codigoEstablecimiento, d.direccion, [...d.frases].sort((x, y) => x.tipo - y.tipo || x.escenario - y.escenario)]);
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(h).slice(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
}
