// PDF de DEMOSTRACIÓN de un documento (borrador, revisado o certificado en simulación). SIEMPRE lleva visible «DOCUMENTO NO FISCAL · DEMOSTRACIÓN · SIN VALOR»:
// no es un DTE, no tiene firma ni autorización de SAT y no debe confundirse con uno. Escritor de PDF mínimo (Helvetica, A4), sin dependencias.
export interface DatosPdf { empresa: string; nit: string; receptor: string; receptorId: string; fecha: string; numeroBorrador: string; estado: string; serie?: string | null; numero?: string | null; autorizacion?: string | null;
  lineas: { descripcion: string; cantidad: string; precio: string; neto: string }[]; subtotal: string; descuento: string; base: string }
const latin1 = (s: string) => { let o = ""; for (const ch of s) { const c = ch.codePointAt(0)!; const b = c < 256 ? c : 63; o += b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 ? " " : b > 126 ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b); } return o; };
const q = (t: string) => { const [e, d = ""] = String(t).split("."); return `Q ${e.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d.replace(/0+$/, "").padEnd(2, "0")}`; };
export function pdfDemo(d: DatosPdf): Uint8Array {
  const ops: string[] = [];
  const texto = (x: number, y: number, t: string, tam = 10, negrita = false, gris = 0) => ops.push(`BT /${negrita ? "F2" : "F1"} ${tam} Tf ${gris} g 1 0 0 1 ${x} ${y} Tm (${latin1(t.slice(0, 110))}) Tj ET`);
  // marca de agua diagonal (bajo el contenido)
  ops.push(`q 0.92 g BT /F2 44 Tf 0.7071 0.7071 -0.7071 0.7071 110 260 Tm (${latin1("DOCUMENTO NO FISCAL")}) Tj ET Q`, `q 0.92 g BT /F2 30 Tf 0.7071 0.7071 -0.7071 0.7071 150 215 Tm (${latin1("DEMOSTRACIÓN · SIN VALOR")}) Tj ET Q`);
  ops.push("q 1 0.93 0.75 rg 40 790 515 30 re f Q"); texto(48, 800, "DOCUMENTO NO FISCAL · DEMOSTRACIÓN · SIN VALOR FISCAL", 12, true, 0.45);
  texto(48, 765, d.empresa, 14, true); texto(48, 750, `NIT ${d.nit}`, 10); texto(380, 765, `Borrador ${d.numeroBorrador}`, 10, true); texto(380, 750, `Fecha prevista: ${d.fecha}`, 10);
  texto(48, 722, "Receptor", 9, true, 0.4); texto(48, 708, d.receptor, 11, true); texto(48, 694, d.receptorId, 10);
  texto(380, 722, "Estado", 9, true, 0.4); texto(380, 708, d.estado, 11, true);
  if (d.serie || d.numero) { texto(380, 694, `Serie ${d.serie ?? "-"} · Número ${d.numero ?? "-"}`, 10); }
  if (d.autorizacion) texto(380, 680, `Autorización simulada: ${d.autorizacion.slice(0, 40)}`, 8, false, 0.3);
  let y = 650; ops.push("0.8 G 0.5 w 40 658 m 555 658 l S"); texto(48, 662, "Descripción", 9, true, 0.4); texto(330, 662, "Cant.", 9, true, 0.4); texto(400, 662, "Precio", 9, true, 0.4); texto(490, 662, "Neto", 9, true, 0.4);
  for (const l of d.lineas.slice(0, 28)) { texto(48, y, l.descripcion.slice(0, 48), 10); texto(330, y, l.cantidad.replace(/\.?0+$/, ""), 10); texto(400, y, q(l.precio), 10); texto(490, y, q(l.neto), 10); y -= 16; }
  if (d.lineas.length > 28) { texto(48, y, `… y ${d.lineas.length - 28} línea(s) más`, 9, false, 0.4); y -= 16; }
  y -= 8; ops.push(`0.8 G 40 ${y + 12} m 555 ${y + 12} l S`);
  texto(380, y - 4, "Subtotal", 10); texto(490, y - 4, q(d.subtotal), 10); texto(380, y - 20, "Descuentos", 10); texto(490, y - 20, q(d.descuento), 10); texto(380, y - 38, "Base imponible", 11, true); texto(490, y - 38, q(d.base), 11, true);
  texto(48, y - 64, "Impuestos y total: pendientes (régimen fiscal sin verificar). Este documento NO es una factura ni un DTE.", 8.5, false, 0.35);
  texto(48, 40, "Generado por NEXA FEL en modo demostración. Sin firma electrónica, sin autorización de SAT, sin certificador. No lo uses como comprobante.", 8, false, 0.45);
  const cont = ops.join("\n"), objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>", `<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  let out = "%PDF-1.4\n"; const pos: number[] = [];
  objs.forEach((o, i) => { pos.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => String(p).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 255);
}
