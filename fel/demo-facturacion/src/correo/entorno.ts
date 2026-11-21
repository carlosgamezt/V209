// Configuración del correo de NEXA FEL desde el ENTORNO DEL SERVIDOR (nunca del navegador). Falla CERRADO: cualquier variable ausente o incoherente deja el correo deshabilitado y explica por qué SIN mostrar valores.
//   FEL_CORREO=habilitado | simulado     «habilitado» envía de verdad por Resend; «simulado» no saca nada a la red (para ensayar). Ausente = sin correo.
//   FEL_CORREO_REMITENTE                 «NEXA FEL <facturas@tu-dominio-verificado>». Obligatoria con «habilitado» (el dominio debe estar verificado en Resend: SPF y DKIM).
//   RESEND_API_KEY                       SECRETO del servidor. Solo con «habilitado». No se registra ni se devuelve jamás.
//   FEL_CORREO_DESTINATARIOS             lista cerrada de destinatarios de PRUEBA, separada por comas: direcciones exactas o «@dominio.com». Obligatoria con «habilitado»: sin lista, nada sale.
//   FEL_CORREO_TOPE_DIARIO               máximo de envíos por empresa y por día con «habilitado» (1–1000; por defecto 50): freno de seguridad de las pruebas reales.
//   FEL_CORREO_AUTOMATICO=habilitado     envío automático tras certificar. APAGADO por defecto; aun así respeta todas las reglas del servicio.
// Este módulo no habilita certificación, consulta de NIT/CUI ni nada fiscal.
import type { BdDemo } from "../bd.ts";
import { CorreoSimulado, ResendCorreo, type ProveedorCorreo } from "./proveedor.ts";
import { RE_CORREO, ServicioCorreo } from "./servicio.ts";

export type Entorno = (k: string) => string | undefined;
const RE_REMITENTE = /^(?:[^<>@\r\n"]{1,60} )?<?[^\s@<>,;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}>?$/;

/** Lista de destinatarios autorizados: direcciones exactas y/o «@dominio». Devuelve null si algún elemento es inválido (falla cerrado). */
export function listaDestinatarios(texto: string | undefined): ((correo: string) => boolean) | null {
  const items = (texto ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!items.length || items.length > 50) return null;
  const exactos = new Set<string>(), dominios = new Set<string>();
  for (const x of items) {
    if (x.startsWith("@")) { if (!/^@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(x)) return null; dominios.add(x); }
    else { if (!RE_CORREO.test(x)) return null; exactos.add(x); }
  }
  return (c) => { const k = c.trim().toLowerCase(); return exactos.has(k) || dominios.has(k.slice(k.lastIndexOf("@"))); };
}

export function crearCorreoDesdeEntorno(env: Entorno, bd: BdDemo, o: { fetchImpl?: typeof fetch; proveedor?: ProveedorCorreo; limites?: { empresa: number; persona: number } } = {}): { servicio?: ServicioCorreo; motivo: string } {
  const modo = env("FEL_CORREO");
  if (modo !== "habilitado" && modo !== "simulado") return { motivo: "El envío por correo no está habilitado (FEL_CORREO)." };
  const automatico = env("FEL_CORREO_AUTOMATICO") === "habilitado";
  if (modo === "simulado") {
    const remitente = env("FEL_CORREO_REMITENTE") || "NEXA FEL <facturas@nexa-fel.example>";
    if (!RE_REMITENTE.test(remitente)) return { motivo: "FEL_CORREO_REMITENTE no tiene un formato válido." };
    return { servicio: new ServicioCorreo(bd, o.proveedor ?? new CorreoSimulado(), { remitente, destinatarioPermitido: () => true, automatico, limites: o.limites }), motivo: "Correo SIMULADO: no se envía nada real." };
  }
  const remitente = env("FEL_CORREO_REMITENTE") ?? ""; if (!RE_REMITENTE.test(remitente)) return { motivo: "Falta FEL_CORREO_REMITENTE (o no es válido): debe ser una dirección de un dominio verificado." };
  const permitido = listaDestinatarios(env("FEL_CORREO_DESTINATARIOS")); if (!permitido) return { motivo: "Falta FEL_CORREO_DESTINATARIOS (o tiene un elemento no válido): sin lista de destinatarios de prueba no se envía nada." };
  const tope = env("FEL_CORREO_TOPE_DIARIO") ? Number(env("FEL_CORREO_TOPE_DIARIO")) : 50; if (!Number.isInteger(tope) || tope < 1 || tope > 1000) return { motivo: "FEL_CORREO_TOPE_DIARIO debe ser un entero entre 1 y 1000." };
  const clave = env("RESEND_API_KEY"); if (!clave) return { motivo: "Falta el secreto RESEND_API_KEY." };
  let proveedor: ProveedorCorreo; try { proveedor = o.proveedor ?? new ResendCorreo({ apiKey: clave, fetchImpl: o.fetchImpl }); } catch { return { motivo: "RESEND_API_KEY no tiene el formato esperado." }; }   // sin citar la clave
  return { servicio: new ServicioCorreo(bd, proveedor, { remitente, destinatarioPermitido: permitido, automatico, limites: o.limites, topeDiario: tope }), motivo: "Correo habilitado por Resend para destinatarios de prueba autorizados." };
}
