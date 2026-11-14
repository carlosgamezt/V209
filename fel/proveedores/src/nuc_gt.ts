// Constructor y validador del NUC JSON de Guatemala (Digifact) — V2.0.3, documentación oficial leída el 14/11/2026:
//   https://documentacion.digifact.com/gt/nuc/json.md  ·  esquema: https://documentacion.digifact.com/schemas/gt/NUCSchema.json (copia en fel/proveedores/digifact/).
// REGLAS DE ESTE ARCHIVO
//  · NO calcula impuestos ni redondeos: NEXA no aplica reglas fiscales sin verificar (V1/V2). Recibe los montos YA calculados, los da con 6 decimales y solo COMPRUEBA que sean coherentes entre sí.
//  · Todo importe viaja como TEXTO decimal (nunca float). Aritmética con enteros escalados a 10^6 (BigInt).
//  · Solo el tipo de documento FACT está habilitado; los demás exigen complementos propios (FCAM, NCRE…) y se habilitarán uno por uno tras validarlos con Digifact.
//  · Los nombres de campo son EXACTOS y distinguen mayúsculas (la API es case-sensitive); «AdditionlInfo» y «AditionalData/AditionalInfo» llevan la errata del esquema oficial a propósito.
//  · No decide si el documento «es válido» para la SAT: la API valida además reglas de negocio (identificaciones, catálogos, totales). Esto evita enviar lo que ya se sabe incorrecto.

export type TipoDocGt = "FACT";
export type AfiliacionIva = "GEN" | "PEQ" | "PEE" | "EXE" | "PRI" | "PEC";
const AFILIACIONES: AfiliacionIva[] = ["GEN", "PEQ", "PEE", "EXE", "PRI", "PEC"];

export interface DireccionGt { direccion: string; codigoPostal: string; municipio: string; departamento: string; pais?: string }
export interface FraseGt { tipo: number; escenario: number; numeroResolucion?: string; fechaResolucion?: string }
export interface EmisorGt {
  nit: string; nombre: string; afiliacionIva: AfiliacionIva; frases: FraseGt[]; correo?: string;
  establecimiento: { codigo: number; nombre?: string; direccion: DireccionGt };
}
export interface ReceptorGt { tipoId: "NIT" | "CUI" | "CF"; id: string; nombre: string; direccion?: DireccionGt }
export interface ImpuestoItemGt { codigoUnidadGravable: number; nombre: "IVA"; gravable: string; monto: string }
export interface ItemGt {
  tipo: "Bien" | "Servicio"; descripcion: string; cantidad: string; unidad?: string; precioUnitario: string; descuento?: string;
  impuestos: ImpuestoItemGt[]; totalItem: string;
}
export interface FacturaGt {
  tipoDoc: TipoDocGt; fechaEmision: string;      // 2026-11-14T10:30:00-06:00
  moneda: string;                                // ISO 4217 (GTQ)
  emisor: EmisorGt; receptor: ReceptorGt; items: ItemGt[];
  /** Referencia interna única de la operación (GUID de 36 caracteres): va en la Adenda y permite CONCILIAR por ella (reporte diario de acuses). */
  referenciaInterna: string;
  validarReferenciaInterna?: boolean;            // VALIDAR | NO_VALIDAR (su efecto exacto está pendiente de confirmar con Digifact)
}
export interface ErrorNuc { campo: string; mensaje: string }
export class NucInvalido extends Error { constructor(public errores: ErrorNuc[]) { super("El documento no cumple el NUC: " + errores.map((e) => `${e.campo}: ${e.mensaje}`).join(" · ")); this.name = "NucInvalido"; } }

/* ---------- decimales exactos (enteros escalados a 10^6) ---------- */
const ESC = 1_000_000n;
/** «12.5» → 12500000n. Rechaza más de 6 decimales, signos, exponentes y texto no numérico. */
export function aMicro(v: string): bigint | null {
  const m = /^(\d{1,11})(?:\.(\d{1,6}))?$/.exec(String(v).trim()); if (!m) return null;
  return BigInt(m[1]) * ESC + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}
export function deMicro(n: bigint): string { const e = n / ESC, d = (n % ESC).toString().padStart(6, "0"); return `${e}.${d}`; }
/** (cantidad × precio) / 10^6, redondeado al micro más cercano (mitad hacia arriba). */
const prod = (a: bigint, b: bigint): bigint => (a * b + ESC / 2n) / ESC;

const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const CORREO = /^[^\s@]{1,40}@[^\s@]{1,40}\.[^\s@]{2,10}$/;
const dentro = (s: string, min: number, max: number) => typeof s === "string" && s.trim().length >= min && s.length <= max;

function validarDireccion(d: DireccionGt | undefined, base: string, e: ErrorNuc[], paisObligatorio: boolean) {
  if (!d) { e.push({ campo: base, mensaje: "falta la dirección" }); return; }
  if (!dentro(d.direccion, 1, 100)) e.push({ campo: `${base}.direccion`, mensaje: "1 a 100 caracteres" });
  if (!dentro(d.codigoPostal, 1, 50)) e.push({ campo: `${base}.codigoPostal`, mensaje: "obligatorio (código postal válido, hasta 50 caracteres)" });
  if (!dentro(d.municipio, 1, 50)) e.push({ campo: `${base}.municipio`, mensaje: "obligatorio, hasta 50 caracteres" });
  if (!dentro(d.departamento, 1, 50)) e.push({ campo: `${base}.departamento`, mensaje: "obligatorio, hasta 50 caracteres" });
  if (paisObligatorio && (d.pais ?? "GT") !== "GT") e.push({ campo: `${base}.pais`, mensaje: "debe ser GT" });
}

export function validarFactura(f: FacturaGt): ErrorNuc[] {
  const e: ErrorNuc[] = [];
  if (f.tipoDoc !== "FACT") e.push({ campo: "tipoDoc", mensaje: "solo FACT está habilitado; los demás tipos se habilitarán tras validarlos con Digifact" });
  if (!FECHA.test(f.fechaEmision)) e.push({ campo: "fechaEmision", mensaje: "formato AAAA-MM-DDThh:mm:ss±hh:mm (ej. 2026-11-14T10:30:00-06:00)" });
  if (!/^[A-Z]{3}$/.test(f.moneda)) e.push({ campo: "moneda", mensaje: "código ISO 4217 de 3 letras" });
  if (!GUID.test(f.referenciaInterna)) e.push({ campo: "referenciaInterna", mensaje: "GUID de 36 caracteres (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)" });
  const s = f.emisor;
  if (!/^\d{1,12}$/.test(s.nit)) e.push({ campo: "emisor.nit", mensaje: "NIT sin guiones, hasta 12 dígitos" });
  if (!dentro(s.nombre, 2, 100)) e.push({ campo: "emisor.nombre", mensaje: "2 a 100 caracteres" });
  if (!AFILIACIONES.includes(s.afiliacionIva)) e.push({ campo: "emisor.afiliacionIva", mensaje: `uno de ${AFILIACIONES.join(", ")}` });
  if (s.correo !== undefined && !CORREO.test(s.correo)) e.push({ campo: "emisor.correo", mensaje: "correo no válido (hasta 50 caracteres)" });
  s.frases.forEach((fr, i) => {
    if (!Number.isInteger(fr.tipo) || fr.tipo < 1 || fr.tipo > 9) e.push({ campo: `emisor.frases[${i}].tipo`, mensaje: "entero de 1 a 9" });
    if (!Number.isInteger(fr.escenario) || fr.escenario < 1 || fr.escenario > 99) e.push({ campo: `emisor.frases[${i}].escenario`, mensaje: "entero de 1 a 99" });
  });
  if (!s.frases.some((fr) => fr.tipo === 1)) e.push({ campo: "emisor.frases", mensaje: "una factura exige la frase tipo 1 (la SAT rechaza el documento sin ella)" });
  const b = s.establecimiento;
  if (!Number.isInteger(b.codigo) || b.codigo < 1 || b.codigo > 9999) e.push({ campo: "emisor.establecimiento.codigo", mensaje: "entero de 1 a 9999" });
  validarDireccion(b.direccion, "emisor.establecimiento.direccion", e, true);
  const r = f.receptor;
  if (r.tipoId === "CF") { if (r.id !== "CF") e.push({ campo: "receptor.id", mensaje: "para Consumidor Final el id es «CF»" }); }
  else if (r.tipoId === "CUI") { if (!/^\d{13}$/.test(r.id)) e.push({ campo: "receptor.id", mensaje: "el CUI tiene 13 dígitos" }); }
  else if (r.tipoId === "NIT") { if (!/^\d{1,12}$|^\d{1,11}K$/i.test(r.id)) e.push({ campo: "receptor.id", mensaje: "NIT sin guiones" }); }
  else e.push({ campo: "receptor.tipoId", mensaje: "NIT, CUI o CF" });
  if (!dentro(r.nombre, 2, 100)) e.push({ campo: "receptor.nombre", mensaje: "2 a 100 caracteres" });
  if (r.direccion) validarDireccion(r.direccion, "receptor.direccion", e, false);
  if (!f.items.length || f.items.length > 1000) e.push({ campo: "items", mensaje: "de 1 a 1000 ítems" });

  f.items.forEach((it, i) => {
    const c = `items[${i}]`;
    if (it.tipo !== "Bien" && it.tipo !== "Servicio") e.push({ campo: `${c}.tipo`, mensaje: "Bien o Servicio" });
    if (!dentro(it.descripcion, 2, 500)) e.push({ campo: `${c}.descripcion`, mensaje: "2 a 500 caracteres" });
    if (it.unidad !== undefined && !dentro(it.unidad, 1, 20)) e.push({ campo: `${c}.unidad`, mensaje: "1 a 20 caracteres" });
    const q = aMicro(it.cantidad), p = aMicro(it.precioUnitario), d = it.descuento === undefined ? 0n : aMicro(it.descuento), t = aMicro(it.totalItem);
    if (q === null || q <= 0n) e.push({ campo: `${c}.cantidad`, mensaje: "decimal mayor que 0, hasta 6 decimales" });
    if (p === null) e.push({ campo: `${c}.precioUnitario`, mensaje: "decimal, hasta 6 decimales" });
    if (d === null) e.push({ campo: `${c}.descuento`, mensaje: "decimal, hasta 6 decimales" });
    if (t === null) e.push({ campo: `${c}.totalItem`, mensaje: "decimal, hasta 6 decimales" });
    if (!it.impuestos.length || it.impuestos.length > 15) e.push({ campo: `${c}.impuestos`, mensaje: "de 1 a 15 impuestos (NEXA no los calcula: se reciben ya resueltos)" });
    if (q !== null && p !== null && d !== null && t !== null) {
      const esperado = prod(q, p) - d;
      // los impuestos que SUMAN al total (no el IVA incluido en el precio) no se infieren aquí: se admite solo la diferencia exacta con lo declarado por los otros impuestos
      const otros = it.impuestos.filter((x) => x.nombre !== "IVA").reduce((a, x) => a + (aMicro(x.monto) ?? 0n), 0n);
      if (t !== esperado + otros) e.push({ campo: `${c}.totalItem`, mensaje: `no coincide con cantidad × precio − descuento (esperado ${deMicro(esperado + otros)}, declarado ${it.totalItem})` });
    }
    it.impuestos.forEach((x, k) => {
      const ci = `${c}.impuestos[${k}]`;
      if (x.nombre !== "IVA") e.push({ campo: `${ci}.nombre`, mensaje: "solo IVA está habilitado por ahora" });
      if (!Number.isInteger(x.codigoUnidadGravable) || x.codigoUnidadGravable < 1) e.push({ campo: `${ci}.codigoUnidadGravable`, mensaje: "entero positivo" });
      const g = aMicro(x.gravable), m = aMicro(x.monto);
      if (g === null) e.push({ campo: `${ci}.gravable`, mensaje: "decimal, hasta 6 decimales" });
      if (m === null) e.push({ campo: `${ci}.monto`, mensaje: "decimal, hasta 6 decimales" });
      if (g !== null && m !== null && t !== null && x.nombre === "IVA" && g + m !== t && g + m !== t + 1n && g + m + 1n !== t) e.push({ campo: `${ci}`, mensaje: "monto gravable + IVA no suma el total del ítem (tolerancia: 1 millonésima)" });
    });
  });
  return e;
}
/** El total de la factura es la suma de los totales de ítem (E031). Se calcula aquí solo como suma, nunca con reglas fiscales. */
export function totalFactura(f: FacturaGt): string { return deMicro(f.items.reduce((a, it) => a + (aMicro(it.totalItem) ?? 0n), 0n)); }
export function totalIva(f: FacturaGt): string { return deMicro(f.items.reduce((a, it) => a + it.impuestos.filter((x) => x.nombre === "IVA").reduce((b, x) => b + (aMicro(x.monto) ?? 0n), 0n), 0n)); }

const dir = (d: DireccionGt, paisObligatorio: boolean) => ({ Address: d.direccion, City: d.codigoPostal, District: d.municipio, State: d.departamento, ...(paisObligatorio || d.pais ? { Country: d.pais ?? "GT" } : {}) });
const seisDec = (v: string) => deMicro(aMicro(v) ?? 0n);

/** Construye el NUC JSON. Lanza NucInvalido (con la lista completa de errores) si algo no cumple. */
export function construirNuc(f: FacturaGt): Record<string, unknown> {
  const errores = validarFactura(f); if (errores.length) throw new NucInvalido(errores);
  const s = f.emisor, r = f.receptor, b = s.establecimiento;
  const frases: Array<{ Name: string; Data: string; Value: string }> = [];
  s.frases.forEach((fr, i) => {
    const g = String(i + 1);   // «Data» agrupa los Info de una misma frase
    frases.push({ Name: "TipoFrase", Data: g, Value: String(fr.tipo) }, { Name: "Escenario", Data: g, Value: String(fr.escenario) });
    if (fr.numeroResolucion) frases.push({ Name: "NumeroResolucion", Data: g, Value: fr.numeroResolucion });
    if (fr.fechaResolucion) frases.push({ Name: "FechaResolucion", Data: g, Value: fr.fechaResolucion });
  });
  return {
    Version: "1.00", CountryCode: "GT",
    Header: { DocType: f.tipoDoc, IssuedDateTime: f.fechaEmision, Currency: f.moneda },
    Seller: {
      TaxID: s.nit,
      TaxIDAdditionalInfo: [{ Name: "AfiliacionIVA", Data: null, Value: s.afiliacionIva }],
      Name: s.nombre,
      ...(s.correo ? { Contact: { EmailList: { Email: [s.correo] } } } : {}),
      AdditionlInfo: frases,
      BranchInfo: { Code: String(b.codigo), ...(b.nombre ? { Name: b.nombre } : {}), AddressInfo: dir(b.direccion, true) },
    },
    Buyer: { TaxID: r.id, ...(r.tipoId === "CUI" ? { TaxIDType: "CUI" } : {}), Name: r.nombre, ...(r.direccion ? { AddressInfo: dir(r.direccion, false) } : {}) },
    Items: f.items.map((it, i) => ({
      Number: String(i + 1), Type: it.tipo, Description: it.descripcion, Qty: seisDec(it.cantidad),
      ...(it.unidad ? { UnitOfMeasure: it.unidad } : {}), Price: seisDec(it.precioUnitario),
      ...(it.descuento && aMicro(it.descuento) !== 0n ? { Discounts: { Discount: [{ Amount: seisDec(it.descuento) }] } } : {}),
      Taxes: { Tax: it.impuestos.map((x) => ({ Code: String(x.codigoUnidadGravable), Description: x.nombre, TaxableAmount: seisDec(x.gravable), Amount: seisDec(x.monto) })) },
      Totals: { TotalItem: seisDec(it.totalItem) },
    })),
    Totals: { TotalTaxes: { TotalTax: [{ Description: "IVA", Amount: totalIva(f) }] }, GrandTotal: { InvoiceTotal: totalFactura(f) } },
    // «AdditionalDocumentInfo» es OBLIGATORIO siempre (la API lo exige aunque el PDF no lo diga): Adenda mínima cuyo «Code» es nuestra referencia interna.
    AdditionalDocumentInfo: { AdditionalInfo: [{ Code: f.referenciaInterna, Type: "ADENDA", AditionalInfo: [{ Name: "VALIDAR_REFERENCIA_INTERNA", Data: null, Value: f.validarReferenciaInterna ? "VALIDAR" : "NO_VALIDAR" }] }] },
  };
}
