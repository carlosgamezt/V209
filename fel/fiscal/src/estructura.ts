// VALIDACIÓN ESTRUCTURAL y de cardinalidad contra el esquema oficial (GT_Documento-0.2.1.xsd). Acumula violaciones (no se detiene en la primera). No calcula nada.
import { digitosDecimal, esTextoDecimal, Racional } from "./decimal.ts";
import type { Esquema } from "./esquema.ts";
import type { Dte, Violacion } from "./modelo.ts";

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esEntero = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const LARGO = (v: unknown, min: number, max: number) => typeof v === "string" && v.length >= min && v.length <= max;

export function fechaCalendarioValida(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const bis = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  return d <= [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
const RE_FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
export function analizarFechaHora(t: unknown): { a: number; m: number; d: number; hh: number; mm: number; ss: number; zona: string | null } | null {
  if (typeof t !== "string") return null; const r = RE_FECHA_HORA.exec(t); if (!r) return null;
  const [a, m, d, hh, mm, ss] = r.slice(1, 7).map(Number);
  if (!fechaCalendarioValida(a, m, d) || hh > 23 || mm > 59 || ss > 59) return null;
  if (r[7] && r[7] !== "Z") { const [zh, zm] = r[7].slice(1).split(":").map(Number); if (zh > 14 || zm > 59) return null; }
  return { a, m, d, hh, mm, ss, zona: r[7] ?? null };
}
export function fechaSimpleValida(t: unknown): boolean { if (typeof t !== "string") return false; const r = RE_FECHA.exec(t); return !!r && fechaCalendarioValida(+r[1], +r[2], +r[3]); }

/** xs:decimal NumeroNDecimales: ≥ 0, hasta 10 decimales y 22 dígitos en total. Un `number` se rechaza (PRY-SIN-FLOTANTES). */
export function validarImporte(v: unknown, ruta: string, regla: string, v_: Violacion[]): boolean {
  if (typeof v === "number") { v_.push({ regla: "PRY-SIN-FLOTANTES", severidad: "error", ruta, mensaje: "El importe es un número de coma flotante; debe ser texto decimal", encontrado: String(v) }); return false; }
  if (!esTextoDecimal(v)) { v_.push({ regla, severidad: "error", ruta, mensaje: "Importe no es un texto decimal válido", encontrado: String(v).slice(0, 40) }); return false; }
  const dd = digitosDecimal(v)!;
  if (Racional.desdeTexto(v).esNegativo()) { v_.push({ regla, severidad: "error", ruta, mensaje: "NumeroNDecimales no admite valores negativos", encontrado: v }); return false; }
  if (dd.decimales > 10 || dd.total > 22) { v_.push({ regla, severidad: "error", ruta, mensaje: "Excede 10 decimales o 22 dígitos (NumeroNDecimales)", encontrado: v }); return false; }
  return true;
}

export function validarEstructura(entrada: unknown, esq: Esquema): Violacion[] {
  const V: Violacion[] = [];
  const err = (regla: string, ruta: string, mensaje: string, encontrado?: unknown) => V.push({ regla, severidad: "error", ruta, mensaje, ...(encontrado !== undefined ? { encontrado: String(encontrado).slice(0, 60) } : {}) });
  const aviso = (regla: string, ruta: string, mensaje: string, encontrado?: unknown) => V.push({ regla, severidad: "aviso", ruta, mensaje, ...(encontrado !== undefined ? { encontrado: String(encontrado).slice(0, 60) } : {}) });
  if (!esObj(entrada)) { err("ESQ-RAIZ", "", "El DTE debe ser un objeto"); return V; }
  const d = entrada as Record<string, unknown>;
  for (const k of ["DatosGenerales", "Emisor", "Receptor", "Items", "Totales"]) if (d[k] === undefined) err("ESQ-RAIZ", k, `Falta el elemento obligatorio ${k}`);
  // ---- DatosGenerales
  if (esObj(d.DatosGenerales)) {
    const g = d.DatosGenerales, R = "DatosGenerales";
    if (typeof g.Tipo !== "string" || !esq.tiposDte.includes(g.Tipo)) err("ESQ-TIPO", `${R}/Tipo`, "Tipo de DTE fuera de la enumeración del esquema", g.Tipo);
    const f = analizarFechaHora(g.FechaHoraEmision);
    if (!f) err("ESQ-FECHA-EMISION", `${R}/FechaHoraEmision`, "xs:dateTime no válido", g.FechaHoraEmision);
    else if (f.zona !== "-06:00") aviso("ESQ-FECHA-EMISION", `${R}/FechaHoraEmision`, "Zona horaria distinta de -06:00 (hora de Guatemala)", f.zona ?? "(sin zona)");
    if (typeof g.CodigoMoneda !== "string" || !esq.monedas.includes(g.CodigoMoneda)) err("ESQ-MONEDA", `${R}/CodigoMoneda`, "Moneda fuera de la enumeración", g.CodigoMoneda);
    if (g.NumeroAcceso !== undefined && !(esEntero(g.NumeroAcceso) && g.NumeroAcceso >= 100000000 && g.NumeroAcceso <= 999999999)) err("ESQ-NUMERO-ACCESO", `${R}/NumeroAcceso`, "Debe ser un entero entre 100000000 y 999999999", g.NumeroAcceso);
    for (const k of ["Exp", "EmisionUbicacionTemporal", "Espectaculo"]) if (g[k] !== undefined && g[k] !== "SI") err("ESQ-MARCAS", `${R}/${k}`, "Solo se admite «SI»", g[k]);
    if (g.Servicio !== undefined && g.Servicio !== "Residencial") err("ESQ-MARCAS", `${R}/Servicio`, "Solo se admite «Residencial»", g.Servicio);
    if (g.Dispositivo !== undefined && !["APP", "AV", "APPVOZ"].includes(g.Dispositivo as string)) err("ESQ-MARCAS", `${R}/Dispositivo`, "Debe ser APP, AV o APPVOZ", g.Dispositivo);
    if (g.TipoPersoneria !== undefined && !(esEntero(g.TipoPersoneria) && g.TipoPersoneria >= 0)) err("ESQ-MARCAS", `${R}/TipoPersoneria`, "Entero ≥ 0", g.TipoPersoneria);
  }
  // ---- Emisor
  if (esObj(d.Emisor)) {
    const e = d.Emisor, R = "Emisor";
    if (!(LARGO(e.NITEmisor, 1, 13) && esq.patrones.nitEmisor.test(e.NITEmisor as string))) err("ESQ-EMISOR-NIT", `${R}/NITEmisor`, "NIT del emisor no cumple el patrón del esquema (máx. 13)", e.NITEmisor);
    if (!LARGO(e.NombreEmisor, 1, 400)) err("ESQ-EMISOR-TEXTOS", `${R}/NombreEmisor`, "Nombre del emisor: 1–400 caracteres");
    if (!LARGO(e.NombreComercial, 1, 255)) err("ESQ-EMISOR-TEXTOS", `${R}/NombreComercial`, "Nombre comercial: 1–255 caracteres");
    if (!(esEntero(e.CodigoEstablecimiento) && e.CodigoEstablecimiento >= 1 && e.CodigoEstablecimiento <= 9999)) err("ESQ-EMISOR-ESTABLECIMIENTO", `${R}/CodigoEstablecimiento`, "Entero entre 1 y 9999", e.CodigoEstablecimiento);
    if (typeof e.AfiliacionIVA !== "string" || !esq.afiliacionesIva.includes(e.AfiliacionIVA)) err("ESQ-EMISOR-AFILIACION", `${R}/AfiliacionIVA`, "Afiliación al IVA fuera de la enumeración", e.AfiliacionIVA);
    if (e.AfiliacionOmiso !== undefined && !["GEN", "PEQ"].includes(e.AfiliacionOmiso as string)) err("ESQ-EMISOR-AFILIACION", `${R}/AfiliacionOmiso`, "Debe ser GEN o PEQ", e.AfiliacionOmiso);
    if (e.ClasificacionEmisor !== undefined && e.ClasificacionEmisor !== 1674) err("ESQ-EMISOR-AFILIACION", `${R}/ClasificacionEmisor`, "Solo se admite 1674", e.ClasificacionEmisor);
    if (e.CorreoEmisor !== undefined && !(typeof e.CorreoEmisor === "string" && e.CorreoEmisor.length <= 255 && esq.patrones.correo.test(e.CorreoEmisor))) err("ESQ-CORREO", `${R}/CorreoEmisor`, "Correo no válido", e.CorreoEmisor);
    if (!esObj(e.DireccionEmisor)) err("ESQ-DIRECCION-EMISOR", `${R}/DireccionEmisor`, "La dirección del emisor es obligatoria");
    else {
      const x = e.DireccionEmisor, RD = `${R}/DireccionEmisor`;
      if (!LARGO(x.Direccion, 1, 200)) err("ESQ-DIRECCION-EMISOR", `${RD}/Direccion`, "Dirección: 1–200 caracteres");
      if (!esEntero(x.CodigoPostal) || (x.CodigoPostal as number) < 0) err("ESQ-DIRECCION-EMISOR", `${RD}/CodigoPostal`, "Código postal entero", x.CodigoPostal);
      if (!LARGO(x.Municipio, 1, 100)) err("ESQ-DIRECCION-EMISOR", `${RD}/Municipio`, "Municipio: 1–100 caracteres");
      if (!LARGO(x.Departamento, 1, 100)) err("ESQ-DIRECCION-EMISOR", `${RD}/Departamento`, "Departamento: 1–100 caracteres");
      if (typeof x.Pais !== "string" || !esq.paises.has(x.Pais)) err("ESQ-DIRECCION-EMISOR", `${RD}/Pais`, "País fuera de la enumeración", x.Pais);
    }
  }
  // ---- Receptor
  if (esObj(d.Receptor)) {
    const r = d.Receptor, R = "Receptor";
    if (!(LARGO(r.IDReceptor, 1, 18) && esq.patrones.nitReceptor.test(r.IDReceptor as string))) err("ESQ-RECEPTOR-ID", `${R}/IDReceptor`, "ID del receptor no cumple el patrón del esquema (1–18)", r.IDReceptor);
    if (!LARGO(r.NombreReceptor, 1, 400)) err("ESQ-RECEPTOR-TEXTOS", `${R}/NombreReceptor`, "Nombre del receptor: 1–400 caracteres");
    if (r.TipoEspecial !== undefined && !["CUI", "EXT"].includes(r.TipoEspecial as string)) err("ESQ-RECEPTOR-TEXTOS", `${R}/TipoEspecial`, "Debe ser CUI o EXT", r.TipoEspecial);
    if (r.DestinodelaVenta !== undefined && (typeof r.DestinodelaVenta !== "string" || !esq.destinosVenta.includes(r.DestinodelaVenta))) err("ESQ-RECEPTOR-TEXTOS", `${R}/DestinodelaVenta`, "Fuera de la enumeración", r.DestinodelaVenta);
    if (r.CorreoReceptor !== undefined && !(typeof r.CorreoReceptor === "string" && r.CorreoReceptor.length <= 255 && esq.patrones.correo.test(r.CorreoReceptor))) err("ESQ-CORREO", `${R}/CorreoReceptor`, "Correo no válido", r.CorreoReceptor);
    if (r.DireccionReceptor !== undefined) {
      if (!esObj(r.DireccionReceptor)) err("ESQ-RECEPTOR-TEXTOS", `${R}/DireccionReceptor`, "Debe ser un objeto");
      else {
        const x = r.DireccionReceptor;
        if (!LARGO(x.Direccion, 1, 200)) err("ESQ-RECEPTOR-TEXTOS", `${R}/DireccionReceptor/Direccion`, "Dirección: 1–200 caracteres");
        if (x.Pais !== undefined && (typeof x.Pais !== "string" || !esq.paises.has(x.Pais))) err("ESQ-RECEPTOR-TEXTOS", `${R}/DireccionReceptor/Pais`, "País fuera de la enumeración", x.Pais);
      }
    }
  }
  // ---- Frases
  if (d.Frases !== undefined) {
    if (!Array.isArray(d.Frases) || d.Frases.length < 1 || d.Frases.length > 100) err("ESQ-FRASES-CARDINALIDAD", "Frases", "Si existe Frases debe tener entre 1 y 100 frases");
    else d.Frases.forEach((f, i) => {
      const R = `Frases/${i}`; if (!esObj(f)) { err("ESQ-FRASE-CAMPOS", R, "Frase no es un objeto"); return; }
      if (!(esEntero(f.TipoFrase) && f.TipoFrase >= 1 && f.TipoFrase <= 12)) err("ESQ-FRASE-CAMPOS", `${R}/TipoFrase`, "Entero entre 1 y 12", f.TipoFrase);
      if (!(esEntero(f.CodigoEscenario) && f.CodigoEscenario >= 1 && f.CodigoEscenario <= 99)) err("ESQ-FRASE-CAMPOS", `${R}/CodigoEscenario`, "Entero entre 1 y 99", f.CodigoEscenario);
      if (f.NumeroResolucion !== undefined && !LARGO(f.NumeroResolucion, 4, 50)) err("ESQ-FRASE-CAMPOS", `${R}/NumeroResolucion`, "4–50 caracteres");
      if (f.FechaResolucion !== undefined && !fechaSimpleValida(f.FechaResolucion)) err("ESQ-FRASE-CAMPOS", `${R}/FechaResolucion`, "Fecha AAAA-MM-DD no válida", f.FechaResolucion);
    });
  }
  // ---- Items
  if (d.Items !== undefined) {
    if (!Array.isArray(d.Items) || d.Items.length < 1 || d.Items.length > 9999) err("ESQ-ITEMS-CARDINALIDAD", "Items", "Debe haber entre 1 y 9999 ítems");
    else d.Items.forEach((it, i) => {
      const R = `Items/${i}`; if (!esObj(it)) { err("ESQ-ITEM-CAMPOS", R, "Ítem no es un objeto"); return; }
      if (!(esEntero(it.NumeroLinea) && it.NumeroLinea >= 1 && it.NumeroLinea <= 9999)) err("ESQ-ITEM-CAMPOS", `${R}/NumeroLinea`, "Entero entre 1 y 9999", it.NumeroLinea);
      if (it.BienOServicio !== "B" && it.BienOServicio !== "S") err("ESQ-ITEM-CAMPOS", `${R}/BienOServicio`, "Debe ser B o S", it.BienOServicio);
      if (it.CodigoProducto !== undefined && (typeof it.CodigoProducto !== "string" || !esq.codigosProducto.includes(it.CodigoProducto))) err("ESQ-ITEM-CAMPOS", `${R}/CodigoProducto`, "Fuera de la enumeración", it.CodigoProducto);
      if (it.UnidadMedida !== undefined && !LARGO(it.UnidadMedida, 1, 3)) err("ESQ-ITEM-CAMPOS", `${R}/UnidadMedida`, "1–3 caracteres");
      if (!LARGO(it.Descripcion, 1, 10000)) err("ESQ-ITEM-CAMPOS", `${R}/Descripcion`, "1–10000 caracteres");
      if (it.Observaciones !== undefined && !LARGO(it.Observaciones, 0, 50)) err("ESQ-ITEM-CAMPOS", `${R}/Observaciones`, "Máximo 50 caracteres");
      if (it.Afecto !== undefined && it.Afecto !== "Si" && it.Afecto !== "No") err("ESQ-ITEM-CAMPOS", `${R}/Afecto`, "Debe ser Si o No", it.Afecto);
      for (const k of ["Cantidad", "PrecioUnitario", "Precio", "Total"]) if (it[k] === undefined) err("ESQ-ITEM-IMPORTES", `${R}/${k}`, `Falta ${k}`); else validarImporte(it[k], `${R}/${k}`, "ESQ-ITEM-IMPORTES", V);
      for (const k of ["Descuento", "OtrosDescuento", "Idp"]) if (it[k] !== undefined) validarImporte(it[k], `${R}/${k}`, "ESQ-ITEM-IMPORTES", V);
      if (it.Impuestos !== undefined) {
        if (!Array.isArray(it.Impuestos) || it.Impuestos.length < 1 || it.Impuestos.length > 2) err("ESQ-IMPUESTOS-CARDINALIDAD", `${R}/Impuestos`, "Debe haber 1 o 2 impuestos");
        else it.Impuestos.forEach((im, j) => {
          const RI = `${R}/Impuestos/${j}`; if (!esObj(im)) { err("ESQ-IMPUESTO-CAMPOS", RI, "Impuesto no es un objeto"); return; }
          if (typeof im.NombreCorto !== "string" || !esq.tiposImpuesto.includes(im.NombreCorto)) err("ESQ-IMPUESTO-CAMPOS", `${RI}/NombreCorto`, "Fuera de la enumeración", im.NombreCorto);
          if (!(esEntero(im.CodigoUnidadGravable) && im.CodigoUnidadGravable >= 1 && im.CodigoUnidadGravable <= 9999999)) err("ESQ-IMPUESTO-CAMPOS", `${RI}/CodigoUnidadGravable`, "Entero entre 1 y 9999999", im.CodigoUnidadGravable);
          if (im.MontoImpuesto === undefined) err("ESQ-IMPUESTO-CAMPOS", `${RI}/MontoImpuesto`, "Falta MontoImpuesto"); else validarImporte(im.MontoImpuesto, `${RI}/MontoImpuesto`, "ESQ-IMPUESTO-CAMPOS", V);
          for (const k of ["MontoGravable", "CantidadUnidadesGravables"]) if (im[k] !== undefined) validarImporte(im[k], `${RI}/${k}`, "ESQ-IMPUESTO-CAMPOS", V);
        });
      }
    });
  }
  // ---- Totales
  if (esObj(d.Totales)) {
    const t = d.Totales;
    if (t.GranTotal === undefined) err("ESQ-TOTALES", "Totales/GranTotal", "Falta GranTotal"); else validarImporte(t.GranTotal, "Totales/GranTotal", "ESQ-TOTALES", V);
    if (t.TotalImpuestos !== undefined) {
      if (!Array.isArray(t.TotalImpuestos) || t.TotalImpuestos.length < 1 || t.TotalImpuestos.length > 20) err("ESQ-TOTALES", "Totales/TotalImpuestos", "Debe haber entre 1 y 20 totales por impuesto");
      else t.TotalImpuestos.forEach((ti, i) => {
        const R = `Totales/TotalImpuestos/${i}`; if (!esObj(ti)) { err("ESQ-TOTALES", R, "No es un objeto"); return; }
        if (typeof ti.NombreCorto !== "string" || !esq.tiposImpuesto.includes(ti.NombreCorto)) err("ESQ-TOTALES", `${R}/NombreCorto`, "Fuera de la enumeración", ti.NombreCorto);
        if (ti.TotalMontoImpuesto === undefined) err("ESQ-TOTALES", `${R}/TotalMontoImpuesto`, "Falta TotalMontoImpuesto"); else validarImporte(ti.TotalMontoImpuesto, `${R}/TotalMontoImpuesto`, "ESQ-TOTALES", V);
      });
    }
  } else if (d.Totales !== undefined) err("ESQ-TOTALES", "Totales", "Totales no es un objeto");
  return V;
}
export type { Dte };
