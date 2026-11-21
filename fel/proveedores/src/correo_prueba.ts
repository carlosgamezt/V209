// Correo de la factura enviado por DIGIFACT en una certificación de PRUEBA (TEST) lanzada a mano (digifact_prueba.ts · «certificar-test»). Mismas ideas que el resto de pasos privados:
//  · El correo del destinatario NO se escribe en ninguna entrada de la ejecución: viene de un SECRETO del entorno (DIGIFACT_CORREO_PRUEBA), así que ni las entradas ni el registro lo muestran.
//  · Lista CERRADA de destinatarios (secreto DIGIFACT_CORREO_DESTINATARIOS): solo se permite un buzón de esa lista; sin lista, nada.
//  · Doble confirmación: «con_correo = si» + el texto literal ENVIAR-CORREO-TEST. Sin ambos, el comportamiento es EXACTAMENTE el de siempre (sin Buyer.Contact).
//  · Verifica que el NUC enviado contiene Buyer.Contact.EmailList.Email con UN solo elemento, igual al correo autorizado, y que NADA más cambió respecto al NUC sin correo.
//  · Salida solo con banderas y el correo ENMASCARADO (c***@dominio). Nunca el correo completo.
//  · Antes de enviar consulta (solo lectura) si la referencia ya está certificada: repetir la ejecución con la misma referencia NO manda un segundo NUC (ni un segundo correo).
//  · «Solicitado» no es «entregado»: Digifact no confirma la entrega; la comprobación final es mirar el buzón.
import type { FacturaGt } from "./nuc_gt.ts";
import type { ResultadoConciliacionGt } from "./digifact_gt.ts";

export type Env = (k: string) => string | undefined;
export const CONFIRMACION_CORREO_TEST = "ENVIAR-CORREO-TEST";
/** Misma regla estricta que el NUC para el receptor: sin signos de lista o marcado, dominio de letras/dígitos/puntos/guiones, hasta 50 caracteres. */
const FORMATO = /^[^\s@<>,;'"()\[\]\\]{1,40}@[A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,10}$/;

export const enmascarar = (c: string) => { const [u, d] = c.split("@"); return `${(u ?? "").slice(0, 1)}***@${d ?? ""}`; };

/** Lista cerrada: direcciones exactas y/o «@dominio». null si algún elemento no es válido (falla cerrado). */
export function listaCerrada(texto: string | undefined): ((c: string) => boolean) | null {
  const items = (texto ?? "").split(/[,\n;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!items.length || items.length > 50) return null;
  const exactos = new Set<string>(), dominios = new Set<string>();
  for (const x of items) {
    if (x.startsWith("@")) { if (!/^@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(x)) return null; dominios.add(x); }
    else { if (!FORMATO.test(x)) return null; exactos.add(x); }
  }
  return (c) => { const k = c.trim().toLowerCase(); return exactos.has(k) || dominios.has(k.slice(k.lastIndexOf("@"))); };
}

export type MotivoCorreo = "falta_confirmacion_correo" | "falta_correo_de_prueba" | "correo_no_valido" | "falta_lista_de_destinatarios" | "lista_no_valida" | "destinatario_no_autorizado";
export type CorreoDePrueba = { estado: "no_solicitado" } | { estado: "listo"; correo: string; enmascarado: string } | { estado: "bloqueado"; motivo: MotivoCorreo };

/** Decide si esta ejecución lleva correo y, si lo lleva, que TODO esté en regla. «no_solicitado» = comportamiento de siempre. «bloqueado» = no se envía nada. */
export function resolverCorreoDePrueba(env: Env): CorreoDePrueba {
  if ((env("DIGIFACT_CON_CORREO") ?? "no") !== "si") return { estado: "no_solicitado" };
  if (env("DIGIFACT_CONFIRMAR_CORREO") !== CONFIRMACION_CORREO_TEST) return { estado: "bloqueado", motivo: "falta_confirmacion_correo" };
  const correo = (env("DIGIFACT_CORREO_PRUEBA") ?? "").trim(); if (!correo) return { estado: "bloqueado", motivo: "falta_correo_de_prueba" };
  if (correo.length > 50 || !FORMATO.test(correo)) return { estado: "bloqueado", motivo: "correo_no_valido" };
  const texto = env("DIGIFACT_CORREO_DESTINATARIOS"); if (!(texto ?? "").trim()) return { estado: "bloqueado", motivo: "falta_lista_de_destinatarios" };
  const permitido = listaCerrada(texto); if (!permitido) return { estado: "bloqueado", motivo: "lista_no_valida" };
  if (!permitido(correo)) return { estado: "bloqueado", motivo: "destinatario_no_autorizado" };
  return { estado: "listo", correo, enmascarado: enmascarar(correo) };
}
/** Solo presencia (sí/no): sirve para comprobar los secretos antes de la prueba, sin valores ni longitudes. */
export const presenciaCorreoPrueba = (env: Env) => ({ correoDePrueba: !!(env("DIGIFACT_CORREO_PRUEBA") ?? "").trim(), listaDeDestinatarios: !!(env("DIGIFACT_CORREO_DESTINATARIOS") ?? "").trim() });

/** La factura de prueba con el correo del receptor (el resto, idéntico). */
export const conCorreo = (f: FacturaGt, correo: string): FacturaGt => ({ ...f, receptor: { ...f.receptor, correo } });

type Nuc = Record<string, unknown>;
/** Comprueba lo que el usuario pidió confirmar: el nodo Buyer.Contact.EmailList.Email tiene EXACTAMENTE un elemento, igual al correo autorizado, y nada más cambió respecto al NUC sin correo. */
export function verificarNucConCorreo(sin: Nuc, con: Nuc, correo: string): { ok: boolean; problemas: string[]; cantidad: number } {
  const p: string[] = []; const b = (con.Buyer ?? {}) as Nuc, c = (b.Contact ?? null) as Nuc | null;
  const lista = ((c?.EmailList as Nuc | undefined)?.Email ?? null) as unknown;
  if (!Array.isArray(lista)) p.push("falta Buyer.Contact.EmailList.Email");
  const cantidad = Array.isArray(lista) ? lista.length : 0;
  if (Array.isArray(lista) && lista.length !== 1) p.push(`Buyer.Contact.EmailList.Email debe tener exactamente 1 elemento (tiene ${lista.length})`);
  if (Array.isArray(lista) && lista.length === 1 && lista[0] !== correo) p.push("el correo del NUC no es el autorizado");
  if (c && Object.keys(c).some((k) => k !== "EmailList")) p.push("Buyer.Contact trae algo más que EmailList");
  const { Buyer: bs, ...restoSin } = sin; const { Buyer: bc, ...restoCon } = con;
  if (JSON.stringify(restoSin) !== JSON.stringify(restoCon)) p.push("el NUC cambió fuera de Buyer");
  const { Contact: _x, ...buyerSinContacto } = (bc ?? {}) as Nuc;
  if (JSON.stringify(bs) !== JSON.stringify(buyerSinContacto)) p.push("los datos fiscales del receptor cambiaron");
  return { ok: p.length === 0, problemas: p, cantidad };
}
/** Copia del NUC para MOSTRAR en el registro: el correo va enmascarado. */
export function nucParaMostrar(nuc: Nuc): Nuc {
  const b = nuc.Buyer as Nuc | undefined; const lista = ((b?.Contact as Nuc | undefined)?.EmailList as Nuc | undefined)?.Email as unknown;
  if (!b || !Array.isArray(lista)) return nuc;
  return { ...nuc, Buyer: { ...b, Contact: { EmailList: { Email: lista.map((x) => enmascarar(String(x))) } } } };
}

export type EstadoReferencia = "ya_certificada" | "no_encontrada" | "consulta_fallida";
/** Solo lectura: ¿el reporte de acuses de hoy ya trae esta referencia? «ya_certificada» y «consulta_fallida» BLOQUEAN el envío (falla cerrado: «no encontrada» no prueba que no exista, pero sí evita el caso común de repetir la ejecución). */
export async function estadoDeLaReferencia(c: { conciliarPorReferencia(fecha: string, ref: string, establecimiento?: number): Promise<ResultadoConciliacionGt> }, fecha: string, ref: string, establecimiento: number): Promise<EstadoReferencia> {
  try { const r = await c.conciliarPorReferencia(fecha, ref, establecimiento); return r.tipo === "encontrado" ? "ya_certificada" : r.tipo === "no_encontrado" ? "no_encontrada" : "consulta_fallida"; }
  catch { return "consulta_fallida"; }
}
export const sha256Hex = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
