// PDF de un documento en dos formatos: HOJA CARTA (612×792 pt) y TICKET TÉRMICO DE 80 MM (ancho fijo 226 pt, alto variable según el contenido). Escritor de PDF mínimo (Helvetica), sin dependencias.
// Modos (rotulado fiscal, nunca ambiguo):
//  · «simulado» (por defecto): SIEMPRE lleva «DOCUMENTO NO FISCAL · DEMOSTRACIÓN · SIN VALOR FISCAL». No es un DTE, no tiene firma ni autorización de SAT. Serie, número y autorización, si existen, son SIMULADOS (SIM-…).
//  · «prueba»: certificado en el ambiente de PRUEBAS de un certificador (Digifact TEST): «DOCUMENTO DE PRUEBAS · SIN VALOR FISCAL».
//  · «oficial»: solo para documentos certificados DE VERDAD cuando exista la certificación real. Exige serie, número, autorización e importes entregados por el certificador y NUNCA admite una autorización simulada (SIM-…):
//    este programa no inventa ningún dato fiscal. El servidor no lo usa mientras la emisión real esté deshabilitada.
export type FormatoPdf = "carta" | "ticket";
export type ModoPdf = "simulado" | "prueba" | "oficial";
export interface DatosPdf { empresa: string; nit: string; receptor: string; receptorId: string; fecha: string; numeroBorrador: string; estado: string; serie?: string | null; numero?: string | null; autorizacion?: string | null;
  lineas: { descripcion: string; cantidad: string; precio: string; neto: string }[]; subtotal: string; descuento: string; base: string;
  formato?: FormatoPdf; modo?: ModoPdf; impuestos?: string; total?: string;
  /** Marca de anulación: «anulado» (hecho confirmado, definitivo) o «solicitada» (pendiente de conciliar). `fechaAnulacion` ya viene formateada dd/mm/aaaa. */
  anulacion?: "anulado" | "solicitada"; fechaAnulacion?: string;
  /** Tipo de documento (catálogo central). Sin él se rotula «Factura» como siempre. `enPruebas`: el tipo se puede elaborar y ver, pero NO se certifica todavía. */
  tipo?: { codigo: string; titulo: string; enPruebas?: boolean;
    /** Solo notas: referencia al documento certificado de origen (copiada por la base) y motivo del ajuste. */ origen?: { serie: string; numero: string; fecha: string; tipo: string; motivo?: string };
    /** Solo recibos. */ tipoRecibo?: string } }

export const ANCHO_TICKET = 226;   // 80 mm ≈ 226,8 pt
export const CARTA = { w: 612, h: 792 };
const latin1 = (s: string) => { let o = ""; for (const ch of s) { const c = ch.codePointAt(0)!; const b = c < 256 ? c : 63; o += b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : ch; } return o; };
const q = (t: string) => { const [e, d = ""] = String(t).split("."); return `Q ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d.replace(/0+$/, "").padEnd(2, "0")}`; };
/** Ancho aproximado (Helvetica) de un texto de cifras, para alinear a la derecha. */
const ancho = (t: string, tam: number) => { let w = 0; for (const c of t) w += c >= "0" && c <= "9" ? 556 : c === "." || c === "," || c === " " ? 278 : c === "Q" ? 778 : c === "-" ? 333 : 556; return (w * tam) / 1000; };
/** Ajuste de línea por número de caracteres (palabras largas se parten). */
export function envolver(t: string, n: number): string[] {
  const out: string[] = []; let cur = "";
  for (const palabra of String(t).replace(/\s+/g, " ").trim().split(" ")) {
    let p = palabra;
    while (p.length > n) { if (cur) { out.push(cur); cur = ""; } out.push(p.slice(0, n)); p = p.slice(n); }
    if (!p) continue;
    if (!cur) cur = p; else if ((cur + " " + p).length <= n) cur += " " + p; else { out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

type Cmd = (H: number) => string;   // cada orden dibuja con la altura final de la página (el ticket la conoce al terminar el diseño)
const T = (x: number, top: number, t: string, tam = 10, neg = false, gris = 0): Cmd => (H) => `BT /${neg ? "F2" : "F1"} ${tam} Tf ${gris} g 1 0 0 1 ${x} ${(H - top).toFixed(2)} Tm (${latin1(t.slice(0, 110))}) Tj ET`;
const TD = (xd: number, top: number, t: string, tam = 10, neg = false, gris = 0): Cmd => T(Math.max(0, xd - ancho(t, tam)), top, t, tam, neg, gris);   // alineado a la derecha
const L = (x1: number, x2: number, top: number, g = 0.5, color = 0.8): Cmd => (H) => `${color} G ${g} w ${x1} ${(H - top).toFixed(2)} m ${x2} ${(H - top).toFixed(2)} l S`;
/** Texto en color (RGB 0–1) y rotado opcional: se usa solo para las marcas de anulación. */
const TC = (x: number, top: number, t: string, tam: number, rgb: string, rot = 0): Cmd => (H) => { const a = (rot * Math.PI) / 180, co = Math.cos(a).toFixed(4), si = Math.sin(a).toFixed(4); return `q BT /F2 ${tam} Tf ${rgb} rg ${co} ${si} ${(-Math.sin(a)).toFixed(4)} ${co} ${x} ${(H - top).toFixed(2)} Tm (${latin1(t)}) Tj ET Q`; };
const ROJO = "0.85 0.12 0.18", ROJO_CLARO = "0.97 0.72 0.74", AMBAR = "0.7 0.33 0.04", AMBAR_CLARO = "0.98 0.84 0.6";
const R = (x: number, top: number, w: number, h: number, rgb: string): Cmd => (H) => `q ${rgb} rg ${x} ${(H - top - h).toFixed(2)} ${w} ${h} re f Q`;

function ensamblar(W: number, H: number, cmds: Cmd[], pie: Cmd[] = []): Uint8Array {
  const cont = [...cmds, ...pie].map((c) => c(H)).join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`, `<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  let out = "%PDF-1.4\n"; const pos: number[] = [];
  objs.forEach((o, i) => { pos.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => String(p).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 255);
}

function rotulos(d: DatosPdf) {
  const modo = d.modo ?? "simulado", sim = String(d.autorizacion ?? "").toUpperCase().startsWith("SIM-");
  if (modo === "oficial") {
    if (!d.serie || !d.numero || !d.autorizacion || !d.total) throw new Error("Un documento oficial necesita serie, número, autorización e importes del certificador: no se genera ninguno.");
    if (sim) throw new Error("Una autorización simulada (SIM-) nunca puede presentarse como oficial.");
  }
  return { modo, sim };
}

export function pdfDemo(d: DatosPdf): Uint8Array {
  const { modo, sim } = rotulos(d);
  return (d.formato ?? "carta") === "ticket" ? ticket(d, modo, sim) : carta(d, modo, sim);
}

const BANDA: Record<ModoPdf, string> = { simulado: "DOCUMENTO NO FISCAL · DEMOSTRACIÓN · SIN VALOR FISCAL", prueba: "DOCUMENTO DE PRUEBAS (TEST) · SIN VALOR FISCAL", oficial: "" };
const ROT_AUT = (modo: ModoPdf, sim: boolean) => (modo === "oficial" ? "Autorización" : sim ? "Autorización simulada" : "Autorización (pruebas)");

function carta(d: DatosPdf, modo: ModoPdf, sim: boolean): Uint8Array {
  const W = CARTA.w, H = CARTA.h, c: Cmd[] = [], oficial = modo === "oficial";
  // distancias desde el borde superior (la misma disposición que el diseño anterior; la página es 50 pt más baja que A4)
  if (!oficial) {
    c.push((h) => `q 0.92 g BT /F2 44 Tf 0.7071 0.7071 -0.7071 0.7071 110 ${(h * 0.31).toFixed(0)} Tm (${latin1(modo === "simulado" ? "DOCUMENTO NO FISCAL" : "SOLO PRUEBAS")}) Tj ET Q`, (h) => `q 0.92 g BT /F2 30 Tf 0.7071 0.7071 -0.7071 0.7071 150 ${(h * 0.31 - 45).toFixed(0)} Tm (${latin1(modo === "simulado" ? "DEMOSTRACIÓN" : "SIN VALOR FISCAL")}) Tj ET Q`);
    c.push(R(40, 22, 515, 30, "1 0.93 0.75"), T(48, 42, BANDA[modo], 12, true, 0.45));
  }
  if (d.anulacion) {   // marca de anulación: sello diagonal tenue (detrás del contenido) y una línea explícita junto al receptor
    c.push(TC(d.anulacion === "anulado" ? 70 : 60, d.anulacion === "anulado" ? 560 : 540, d.anulacion === "anulado" ? "ANULADO" : "ANULACION PENDIENTE", d.anulacion === "anulado" ? 96 : 44, d.anulacion === "anulado" ? ROJO_CLARO : AMBAR_CLARO, 28));
    c.push(TC(48, 168, d.anulacion === "anulado" ? `DOCUMENTO ANULADO${d.fechaAnulacion ? ` el ${d.fechaAnulacion}` : ""} (simulación)` : "ANULACIÓN SOLICITADA · pendiente de conciliar", 10, d.anulacion === "anulado" ? ROJO : AMBAR));
  }
  c.push(T(48, 77, d.empresa, 14, true), T(48, 92, `NIT ${d.nit}`, 10), T(380, 77, oficial ? "Documento tributario electrónico" : `Borrador ${d.numeroBorrador}`, 10, true), T(380, 92, `Fecha: ${d.fecha}`, 10));
  c.push(T(48, 120, "Receptor", 9, true, 0.4), T(48, 134, d.receptor, 11, true), T(48, 148, d.receptorId, 10), T(380, 120, "Estado", 9, true, 0.4), T(380, 134, d.estado, 11, true));
  if (d.tipo && d.tipo.codigo !== "FACT") {   // tipo distinto de Factura: se rotula con claridad (nota, recibo) y, en una nota, la referencia al documento de origen
    c.push(T(380, 106, d.tipo.titulo.toUpperCase(), 10, true));
    if (d.tipo.origen) { c.push(T(48, 162, `Hace referencia a ${d.tipo.origen.tipo} · Serie ${d.tipo.origen.serie} · Número ${d.tipo.origen.numero} · ${d.tipo.origen.fecha}`, 8.5, true, 0.3)); if (d.tipo.origen.motivo) c.push(T(48, 174, `Motivo: ${d.tipo.origen.motivo}`, 8.5, false, 0.3)); }
    if (d.tipo.tipoRecibo) c.push(T(48, 162, `Recibo ${d.tipo.tipoRecibo} · este documento NO es una factura`, 8.5, true, 0.3));
    if (d.tipo.enPruebas) c.push(T(380, 162, "EN PRUEBAS · no certificable", 8.5, true, 0.3));
  }
  if (d.serie || d.numero) c.push(T(380, 148, `Serie ${d.serie ?? "-"} · Número ${d.numero ?? "-"}`, 10));
  if (d.autorizacion) c.push(T(380, 162, `${ROT_AUT(modo, sim)}: ${d.autorizacion.slice(0, 40)}`, 8, false, 0.3));
  let t = 206; c.push(L(40, 555, 188), T(48, 180, "Descripción", 9, true, 0.4), T(330, 180, "Cant.", 9, true, 0.4), T(400, 180, "Precio", 9, true, 0.4), T(490, 180, "Neto", 9, true, 0.4));
  const limite = CARTA.h - 150; let omitidas = 0;   // las descripciones largas ocupan varias líneas; lo que no cabe en la hoja se resume en «… y N línea(s) más»
  d.lineas.forEach((l, i) => {
    const partes = envolver(l.descripcion, 52), alto = partes.length * 13 + 5;
    if (omitidas || t + alto > limite) { omitidas++; return; }
    partes.forEach((x, k) => c.push(T(48, t + k * 13, x, 10)));
    c.push(T(330, t, l.cantidad.replace(/\.?0+$/, ""), 10), T(400, t, q(l.precio), 10), T(490, t, q(l.neto), 10)); t += alto;
  });
  if (omitidas) { c.push(T(48, t, `… y ${omitidas} línea(s) más`, 9, false, 0.4)); t += 16; }
  t += 8; c.push(L(40, 555, t - 12));
  c.push(T(380, t + 4, "Subtotal", 10), T(490, t + 4, q(d.subtotal), 10), T(380, t + 20, "Descuentos", 10), T(490, t + 20, q(d.descuento), 10));
  if (oficial) c.push(T(380, t + 38, "Impuestos", 10), T(490, t + 38, q(d.impuestos ?? "0"), 10), T(380, t + 56, "Total", 11, true), T(490, t + 56, q(d.total!), 11, true));
  else c.push(T(380, t + 38, "Base imponible", 11, true), T(490, t + 38, q(d.base), 11, true), T(48, t + 64, "Impuestos y total: pendientes (régimen fiscal sin verificar). Este documento NO es una factura ni un DTE.", 8.5, false, 0.35));
  const textoPie = modo === "simulado" ? "Generado por NEXA FEL en modo demostración. Sin firma electrónica, sin autorización de SAT, sin certificador. No lo uses como comprobante." : "Generado por NEXA FEL con un certificador de PRUEBAS. Sin valor fiscal. No lo uses como comprobante.";
  const pie: Cmd[] = oficial ? [] : envolver(textoPie, 100).map((x, k) => (h: number) => T(48, h - 52 + k * 11, x, 8, false, 0.45)(h));
  return ensamblar(W, H, c, pie);
}

function ticket(d: DatosPdf, modo: ModoPdf, sim: boolean): Uint8Array {
  const W = ANCHO_TICKET, M = 8, X2 = W - M, c: Cmd[] = [], oficial = modo === "oficial", N = 44, NL = 38;   // N: caracteres por línea (tamaño 8); NL: para descripciones
  let t = 8;
  const lineas = (txt: string, n: number, tam = 8, neg = false, gris = 0, paso = tam + 3) => { for (const s of envolver(txt, n)) { c.push(T(M, t + tam, s, tam, neg, gris)); t += paso; } };
  if (!oficial) {
    c.push(R(M, t, W - 2 * M, 34, "1 0.93 0.75"), T(M + 6, t + 14, modo === "simulado" ? "DOCUMENTO NO FISCAL" : "DOCUMENTO DE PRUEBAS", 10, true, 0.3), T(M + 6, t + 27, modo === "simulado" ? "DEMOSTRACIÓN · SIN VALOR FISCAL" : "AMBIENTE TEST · SIN VALOR FISCAL", 7.5, true, 0.4)); t += 42;
  }
  if (d.anulacion) { c.push(R(M, t, W - 2 * M, 22, d.anulacion === "anulado" ? "1 0.88 0.9" : "0.99 0.93 0.8"), TC(M + 6, t + 15, d.anulacion === "anulado" ? "DOCUMENTO ANULADO" : "ANULACION PENDIENTE", 10, d.anulacion === "anulado" ? ROJO : AMBAR)); t += 30;
    if (d.fechaAnulacion && d.anulacion === "anulado") { c.push(T(M, t + 4, `Anulado el ${d.fechaAnulacion} (simulación)`, 8, true, 0.3)); t += 14; } }
  lineas(d.empresa, 34, 10, true, 0, 13); lineas(`NIT ${d.nit}`, N); lineas(oficial ? "Documento tributario electrónico" : `Borrador ${d.numeroBorrador}`, N, 8, true); lineas(`Fecha: ${d.fecha}`, N);
  lineas(`Estado: ${d.estado}`, N);
  if (d.tipo && d.tipo.codigo !== "FACT") {
    lineas(d.tipo.titulo.toUpperCase(), N, 9, true);
    if (d.tipo.origen) { lineas(`Referencia: ${d.tipo.origen.tipo} serie ${d.tipo.origen.serie} no. ${d.tipo.origen.numero} (${d.tipo.origen.fecha})`, 40, 7, false, 0.3, 9); if (d.tipo.origen.motivo) lineas(`Motivo: ${d.tipo.origen.motivo}`, 40, 7, false, 0.3, 9); }
    if (d.tipo.tipoRecibo) lineas(`Recibo ${d.tipo.tipoRecibo}: NO es una factura`, 40, 7, true, 0.3, 9);
    if (d.tipo.enPruebas) lineas("EN PRUEBAS · no certificable", 40, 7, true, 0.3, 9);
  }
  if (d.serie || d.numero) lineas(`Serie ${d.serie ?? "-"} · Número ${d.numero ?? "-"}`, N);
  if (d.autorizacion) lineas(`${ROT_AUT(modo, sim)}: ${d.autorizacion}`, 36, 7, false, 0.3, 9);
  t += 2; c.push(L(M, X2, t, 0.6)); t += 8;
  lineas("Receptor", N, 7, true, 0.4, 9); lineas(d.receptor, N, 8, true); lineas(d.receptorId, N);
  t += 2; c.push(L(M, X2, t, 0.6)); t += 10;
  for (const l of d.lineas.slice(0, 200)) {
    lineas(l.descripcion, NL, 8, true);
    const izq = `${l.cantidad.replace(/\.?0+$/, "") || "0"} x ${q(l.precio)}`; c.push(T(M + 6, t + 8, izq, 8), TD(X2, t + 8, q(l.neto), 8, true)); t += 14;
  }
  t += 0; c.push(L(M, X2, t, 0.6)); t += 10;
  const fila = (et: string, v: string, neg = false) => { c.push(T(M, t + 9, et, neg ? 9 : 8, neg), TD(X2, t + 9, v, neg ? 9 : 8, neg)); t += neg ? 15 : 12; };
  fila("Subtotal", q(d.subtotal)); fila("Descuentos", q(d.descuento));
  if (oficial) { fila("Impuestos", q(d.impuestos ?? "0")); fila("Total", q(d.total!), true); } else fila("Base imponible", q(d.base), true);
  t += 4;
  if (!oficial) { lineas("Impuestos y total: pendientes (régimen fiscal sin verificar). NO es una factura ni un DTE.", 50, 7, false, 0.35, 9); t += 2;
    lineas(modo === "simulado" ? "Generado por NEXA FEL en modo demostración. Sin firma electrónica, sin autorización de SAT, sin certificador. No lo uses como comprobante." : "Generado por NEXA FEL con un certificador de PRUEBAS. Sin valor fiscal.", 54, 6.5, false, 0.45, 8);
    t += 4; c.push(R(M, t, W - 2 * M, 16, "1 0.93 0.75"), T(M + 6, t + 11, "SIN VALOR FISCAL", 8.5, true, 0.3)); t += 16; }
  t += 10;
  return ensamblar(W, Math.ceil(t), c);
}
