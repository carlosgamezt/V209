// Correo de la factura enviado por DIGIFACT al certificar (nodo Buyer.Contact.EmailList del NUC): habilitación INDEPENDIENTE de la certificación, de la consulta de NIT y de la de CUI.
// NEXA solo indica el destinatario; Digifact envía el correo con su plantilla (configurada en su portal). El módulo de correo propio (Resend) es otra cosa y sigue apagado.
// Variables del SERVIDOR (nunca del navegador):
//   FEL_DIGIFACT_CORREO=habilitado             interruptor propio. NO depende de FEL_DIGIFACT_TEST/NIT/CUI y NO los habilita (si la certificación está apagada, no hay nada que enviar).
//   FEL_DIGIFACT_CORREO_EMPRESA=<uuid>         la ÚNICA empresa que puede pedirlo en esta etapa de pruebas.
//   FEL_DIGIFACT_CORREO_DESTINATARIOS=a@x.com, @dominio.com   lista CERRADA de destinatarios de prueba: no sabemos si los certificados de TEST salen a la dirección real, así que solo se permiten buzones propios.
// Falla cerrado: cualquier variable ausente o incoherente lo deja deshabilitado y lo explica SIN mostrar valores. Apagado por defecto.
import { listaDestinatarios } from "./correo/entorno.ts";

export type Entorno = (k: string) => string | undefined;
export type VeredictoCorreo = { ok: true } | { ok: false; codigo: "CORREO_INVALIDO" | "DESTINATARIO_NO_AUTORIZADO"; mensaje: string };
/** Lo ÚNICO que el resto del sistema ve: para qué empresa rige y si un destinatario se puede usar. */
export interface PoliticaCorreoDigifact { readonly empresaId: string; evaluar(correo: string): VeredictoCorreo }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATO = /^[^\s@<>,;'"()\[\]\\]{1,40}@[A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,10}$/;   // la misma regla estricta del NUC (hasta 50 caracteres)
/** ¿Tiene el formato que acepta el NUC (una sola dirección, hasta 50 caracteres)? Lo usa también la API para no ofrecer como destinatario un correo registrado que Digifact no aceptaría. */
export const correoConFormatoNuc = (c: string): boolean => { const x = String(c ?? "").trim(); return x.length > 0 && x.length <= 50 && FORMATO.test(x); };

export function crearPoliticaCorreoDigifactDesdeEntorno(env: Entorno): { politica?: PoliticaCorreoDigifact; motivo: string } {
  if (env("FEL_DIGIFACT_CORREO") !== "habilitado") return { motivo: "El correo de la factura por Digifact no está habilitado (FEL_DIGIFACT_CORREO)." };
  const empresa = (env("FEL_DIGIFACT_CORREO_EMPRESA") ?? "").toLowerCase(); if (!UUID.test(empresa)) return { motivo: "Falta FEL_DIGIFACT_CORREO_EMPRESA (UUID de la única empresa que puede pedirlo)." };
  const permitido = listaDestinatarios(env("FEL_DIGIFACT_CORREO_DESTINATARIOS")); if (!permitido) return { motivo: "Falta FEL_DIGIFACT_CORREO_DESTINATARIOS (o tiene un elemento no válido): sin lista de destinatarios de prueba no se envía nada." };
  const politica: PoliticaCorreoDigifact = Object.freeze({
    empresaId: empresa,
    evaluar(correo: string): VeredictoCorreo {
      const c = String(correo ?? "").trim();
      if (!correoConFormatoNuc(c)) return { ok: false, codigo: "CORREO_INVALIDO", mensaje: "El correo electrónico no es válido (hasta 50 caracteres)." };
      if (!permitido(c.toLowerCase())) return { ok: false, codigo: "DESTINATARIO_NO_AUTORIZADO", mensaje: "En el ambiente de pruebas solo se puede enviar a los correos autorizados." };
      return { ok: true };
    },
  });
  return { politica, motivo: "Correo por Digifact habilitado para una empresa y destinatarios de prueba autorizados (la certificación no se habilita)." };
}
