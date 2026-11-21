// Plantilla del correo de una factura certificada. Identidad NEXA FEL (minimalista, violeta #4654F5) con el NOMBRE COMERCIAL del emisor como protagonista.
// Compatible con Gmail, Outlook (Word) y teléfonos: maquetación con TABLAS, estilos EN LÍNEA, sin imágenes externas ni fuentes web (una pila de fuentes del sistema), ancho fluido de hasta 600 px,
// textos de 14 px o más y botones/áreas de lectura holgadas. Un correo sin imágenes cargadas se ve igual: el logotipo es texto.
// Todo dato variable se ESCAPA: un nombre con «<» o comillas no puede romper el HTML ni inyectar nada.
// En TEST/simulación el correo lo dice con un rótulo visible (no se altera ni se falsifica el PDF/XML adjunto: solo se rotula este mensaje).

export interface DatosCorreo {
  emisor: string;              // nombre comercial del emisor (si no hay, la razón social)
  receptor: string;            // nombre del receptor
  serie: string; numero: string;
  fecha: string;               // dd/mm/aaaa
  total: string;               // ya formateado: «Q 1,234.50»
  autorizacion?: string;       // número de autorización (UUID); opcional
  /** true en TEST y en simulación: añade el rótulo «DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL». */
  prueba: boolean;
  adjuntos: string[];          // nombres de archivo adjuntos (solo se listan)
}
export interface CorreoRender { asunto: string; html: string; texto: string }

export const ROTULO_PRUEBA = "DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL";
const C = { pri: "#4654F5", txt: "#19191D", mut: "#666876", linea: "#E7E8F3", fondo: "#F4F5FB", sup: "#FFFFFF", aviso: "#B35208", avisoFondo: "#FFF4E8" };
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** Un valor que va en el asunto (una sola línea, sin saltos que permitan inyectar cabeceras) y acotado. */
const linea = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function plantillaFactura(d: DatosCorreo): CorreoRender {
  const emisor = linea(d.emisor, 80) || "Emisor", receptor = linea(d.receptor, 120) || "Cliente", id = `${linea(d.serie, 30)}-${linea(d.numero, 30)}`.replace(/^-|-$/g, "") || "—";
  const asunto = `${d.prueba ? "[PRUEBA] " : ""}Factura ${id} de ${emisor}`;
  const pre = `${d.prueba ? "Documento de prueba sin validez fiscal. " : ""}Tu factura ${id} por ${linea(d.total, 30)} está lista: adjuntamos el PDF y el XML certificados.`;
  const fila = (k: string, v: string) => `<tr><td style="padding:9px 0;border-top:1px solid ${C.linea};font:13px/1.4 ${FUENTE};color:${C.mut};width:42%;vertical-align:top">${esc(k)}</td><td align="right" style="padding:9px 0;border-top:1px solid ${C.linea};font:600 14px/1.4 ${FUENTE};color:${C.txt};vertical-align:top">${esc(v)}</td></tr>`;
  const filas = [fila("Factura", id), fila("Fecha de emisión", linea(d.fecha, 12)), fila("Receptor", receptor), ...(d.autorizacion ? [fila("Autorización", linea(d.autorizacion, 40))] : [])].join("");
  const aviso = d.prueba ? `<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.avisoFondo}" style="background:${C.avisoFondo};border:1px solid #F0C9A0;border-radius:10px;padding:11px 14px;font:700 13px/1.4 ${FUENTE};color:${C.aviso};letter-spacing:.02em;text-align:center">${esc(ROTULO_PRUEBA)}</td></tr></table></td></tr>` : "";
  const adj = d.adjuntos.length ? `<tr><td style="padding:18px 0 0;font:13px/1.5 ${FUENTE};color:${C.mut}">Adjuntos (certificados, sin modificar):<br><span style="color:${C.txt};font-weight:600">${d.adjuntos.map((a) => esc(linea(a, 80))).join(" &nbsp;·&nbsp; ")}</span></td></tr>` : "";
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="x-apple-disable-message-reformatting"><title>${esc(asunto)}</title></head>
<body style="margin:0;padding:0;background:${C.fondo};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fondo};font-size:1px;line-height:1px">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background:${C.fondo}"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
<tr><td style="padding:0 4px 14px;font:800 15px/1 ${FUENTE};letter-spacing:.04em;color:${C.pri}">NEXA&nbsp;FEL</td></tr>
${aviso}
<tr><td bgcolor="${C.sup}" style="background:${C.sup};border:1px solid ${C.linea};border-radius:16px;padding:26px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font:13px/1.4 ${FUENTE};color:${C.mut}">Factura electrónica de</td></tr>
<tr><td style="padding:2px 0 18px;font:700 22px/1.25 ${FUENTE};color:${C.txt};word-break:break-word">${esc(emisor)}</td></tr>
<tr><td style="font:15px/1.55 ${FUENTE};color:${C.txt};padding:0 0 18px">Hola ${esc(receptor)}, te compartimos tu factura. Encontrarás el <strong>PDF</strong> y el <strong>XML</strong> certificados como archivos adjuntos.</td></tr>
<tr><td bgcolor="#F4F5FF" style="background:#F4F5FF;border-radius:12px;padding:16px 18px;margin:0">
<div style="font:12px/1.4 ${FUENTE};color:${C.mut};letter-spacing:.04em;text-transform:uppercase">Total</div>
<div style="font:800 30px/1.2 ${FUENTE};color:${C.pri};padding-top:2px">${esc(linea(d.total, 30))}</div></td></tr>
<tr><td style="padding:14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table></td></tr>
${adj}
</table></td></tr>
<tr><td style="padding:16px 8px 0;font:12px/1.55 ${FUENTE};color:${C.mut};text-align:center">Esta es una comunicación automática enviada por NEXA&nbsp;FEL en nombre de ${esc(emisor)}. Por favor no respondas a este mensaje.${d.prueba ? "<br>Este documento se generó en un ambiente de pruebas y no tiene validez fiscal." : ""}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  const texto = [
    ...(d.prueba ? [ROTULO_PRUEBA, ""] : []),
    `Factura electrónica de ${emisor}`, "",
    `Hola ${receptor}, te compartimos tu factura. Encontrarás el PDF y el XML certificados como archivos adjuntos.`, "",
    `Factura: ${id}`, `Fecha de emisión: ${linea(d.fecha, 12)}`, `Receptor: ${receptor}`, ...(d.autorizacion ? [`Autorización: ${linea(d.autorizacion, 40)}`] : []), `Total: ${linea(d.total, 30)}`, "",
    `Esta es una comunicación automática enviada por NEXA FEL en nombre de ${emisor}. Por favor no respondas a este mensaje.`,
    ...(d.prueba ? ["Este documento se generó en un ambiente de pruebas y no tiene validez fiscal."] : []),
  ].join("\n");
  return { asunto, html, texto };
}
