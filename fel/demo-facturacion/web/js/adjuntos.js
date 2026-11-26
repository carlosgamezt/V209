// Preferencia de ADJUNTOS de una factura, reutilizable por cualquier canal de envío (correo hoy; WhatsApp en el futuro, NO implementado): el PDF va siempre y el XML fiscal solo si la persona lo pide («Adjuntar también XML»,
// apagado por defecto). Este módulo solo decide QUÉ se adjunta y obtiene los archivos reales del servidor; cada canal decide CÓMO enviarlos y avisa si no puede (nunca se simula un adjunto). El XML fiscal se conserva siempre en NEXA.
export const preferencia = { xml: false };

const nombreBase = (doc) => `${doc.serie ?? ""}-${doc.numero_fiscal ?? "factura"}`.replace(/[^A-Za-z0-9._-]/g, "_");

/** Archivos a adjuntar según la preferencia: { archivos: File[], avisos: string[] }. Si se pidió el XML y no hay uno certificado, se avisa y se envía solo el PDF. */
export async function archivosParaEnviar(doc, { xml = preferencia.xml } = {}) {
  const avisos = [], archivos = [], base = nombreBase(doc);
  const rp = await fetch(`/api/documentos/${doc.id}/pdf-demo?formato=carta`, { headers: { "x-demo": "1" } }); if (!rp.ok) throw new Error("No se pudo generar el PDF.");
  archivos.push(new File([await rp.blob()], `${base}.pdf`, { type: "application/pdf" }));
  if (xml) {
    const rx = await fetch(`/api/documentos/${doc.id}/digifact/xml`, { headers: { "x-demo": "1" } }).catch(() => null);
    if (rx && rx.ok) archivos.push(new File([await rx.blob()], `${base}.xml`, { type: "application/xml" })); else avisos.push("Esta factura no tiene un XML certificado disponible: se adjunta solo el PDF.");
  }
  return { archivos, avisos };
}

/** ¿Puede este dispositivo compartir TODOS esos archivos juntos? (algunos navegadores solo aceptan ciertos tipos). */
export const puedeCompartirTodos = (archivos) => { try { return !!navigator.canShare?.({ files: archivos }); } catch { return false; } };
