// Etiquetas y tonos de los estados. Dos ejes: preparación (interno de NEXA) y fiscal (refleja lo oficial).
export const PREPARACION = { borrador: ["Borrador", "azul"], revisado: ["Revisado", "lila"], archivado: ["Archivado", "gris"] };
export const FISCAL = {
  ninguno: ["Sin estado fiscal", "gris"], pendiente_certificacion: ["Pendiente de certificación", "ambar"], por_verificar: ["Por verificar", "ambar"],
  certificado: ["Certificado", "verde"], rechazado: ["Rechazado", "rojo"], anulacion_solicitada: ["Anulación solicitada", "ambar"], anulado: ["Anulado", "rojo"],
};
export const codigoBorrador = (n) => `BR-${String(n).padStart(4, "0")}`;
export const TIPOS_IDENTIFICACION_ES = { NIT: "NIT", CUI: "CUI", CF: "CF", EXT: "Extranjero / otro" };
export const MENSAJES_ERROR = {
  conflicto: "Alguien más cambió este registro mientras lo editabas. Recarga y vuelve a intentar.",
  duplicado: "Ya existe un registro con esos datos.",
  no_autorizado: "No tienes permiso para esta operación.",
  limite_excedido: "Demasiadas solicitudes seguidas. Espera un momento.",
  cuenta_desactivada: "Tu cuenta está desactivada.",
  sin_perfil: "Tu cuenta todavía no tiene acceso. Necesitas una invitación vigente.",
};
