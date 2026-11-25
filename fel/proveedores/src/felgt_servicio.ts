// Servicio de NEXA FEL para Digifact Guatemala (TEST): consulta de NIT, validación, preparación y certificación con CONFIRMACIÓN MANUAL, y conciliación.
// SOLO se ejecuta en el servidor. El navegador nunca llama a Digifact: habla con la API de NEXA, que llama a este servicio.
//
// GARANTÍAS (cada una tiene prueba en pruebas/felgt_servicio_test.ts):
//  · Aislamiento multiempresa: toda operación, consulta y permiso lleva el empresaId; una empresa jamás ve ni toca operaciones de otra, y las credenciales se resuelven POR empresa (sin canal → nada se envía).
//  · Un documento, un envío: la operación se guarda ANTES de enviar (estado «enviando»), la referencia interna es única y determinista, y un documento con operación enviando/certificada/desconocida nunca se vuelve a enviar.
//  · Un resultado incierto (tiempo agotado, corte, 5xx, respuesta ilegible) queda «desconocida»: solo se CONCILIA por la referencia interna; nunca se reenvía.
//  · Confirmación manual: certificar exige un paso de preparación previo, la confirmación literal «CERTIFICAR-TEST», el eco de la referencia y de la huella del emisor, y que el contenido NO haya cambiado desde que se preparó.
//  · Autorización por prueba: aunque todo lo anterior esté en regla, solo se envía la referencia que la persona responsable autorizó expresamente para esa prueba (autorizaPrueba). Sin ella, no sale nada.
//  · Sin almacén persistente no hay envío real (si el proceso se reiniciara, no habría memoria de lo enviado): falla cerrado.
//  · Producción bloqueada, anulación y nota de crédito cerradas (las impone el cliente DigifactGt; aquí ni siquiera se exponen).
//  · Una certificación válida se APLICA al documento (estado fiscal, serie, número y autorización del certificador; nunca inventados) de forma atómica e idempotente, y los XML/PDF REALES se guardan y se sirven solo a su empresa.
//  · Nada de credenciales, tokens ni cuerpos crudos en los resultados ni en la auditoría.
import { fechaHoraEmisionGt, validarFechaEmision } from "./fecha_emision.ts";
import { ErrorDigifact, type ArtefactosB64, type DigifactGt } from "./digifact_gt.ts";
import { puedeCertificar, tipoDte } from "./catalogo_dte.ts";
import { construirNuc, aMicro, deMicro, validarFactura, totalFactura, type EmisorGt, type FacturaGt, type ItemGt, type ReceptorGt } from "./nuc_gt.ts";

export type CodigoFelGt = "TIPO_NO_HABILITADO" | "FECHA_EMISION" | "NO_AUTORIZADO" | "SIN_CANAL" | "VALIDACION" | "ESTADO" | "CONFIRMACION" | "PRUEBA_NO_AUTORIZADA" | "ALMACEN_NO_PERSISTENTE" | "DOCUMENTO_CAMBIO" | "NO_ENCONTRADO" | "LIMITE" | "EMISOR" | "ENTRADA" | "ARTEFACTO_INVALIDO" | "PREVUELO";
const STATUS: Record<CodigoFelGt, number> = { TIPO_NO_HABILITADO: 422, FECHA_EMISION: 422, NO_AUTORIZADO: 403, SIN_CANAL: 422, VALIDACION: 422, ESTADO: 409, CONFIRMACION: 400, PRUEBA_NO_AUTORIZADA: 403, ALMACEN_NO_PERSISTENTE: 503, DOCUMENTO_CAMBIO: 409, NO_ENCONTRADO: 404, LIMITE: 429, EMISOR: 422, ENTRADA: 400, ARTEFACTO_INVALIDO: 502, PREVUELO: 503 };
export class ErrorFelGt extends Error {
  constructor(public codigo: CodigoFelGt, mensaje: string, public errores?: { campo: string; mensaje: string }[]) { super(mensaje); this.name = "ErrorFelGt"; }
  get status(): number { return STATUS[this.codigo]; }
}

/** Quién pide y qué puede hacer (la API lo arma desde la sesión y la base; NUNCA desde lo que mande el navegador). */
export interface ContextoFel { empresaId: string; actorId: string; permisos: readonly string[] }

/** Documento ya leído de la base, de la empresa del contexto. */
export interface DocumentoFel {
  id: string; empresaId: string; estadoPreparacion: string; estadoFiscal: string;
  receptor: ReceptorGt;
  /** Tipo de DTE del documento (catálogo central). Ausente = «FACT» (documentos de antes de existir el selector). */
  tipoDte?: "FACT" | "NCRE" | "NDEB" | "RECI" | string;
  /** Solo notas: referencia al documento CERTIFICADO de origen (leída de la base, no escrita por el usuario) y motivo del ajuste. Solo recibos: su tipo. */
  origen?: FacturaGt["origen"]; motivoAjuste?: string; tipoRecibo?: string;
  /** Fecha de emisión ELEGIDA para el documento (AAAA-MM-DD, columna fecha_emision_prevista). Es la que viaja en Header.IssuedDateTime; la fecha de certificación la asigna el certificador. Ausente = hoy (documentos de antes de existir el selector). */
  fechaEmisionPrevista?: string;
  lineas: { tipo: "Bien" | "Servicio"; descripcion: string; cantidad: string; precioUnitario: string; descuento: string; unidad?: string }[];
}

export type EstadoOpGt = "preparada" | "enviando" | "certificada" | "rechazada" | "desconocida" | "no_enviada";
export interface OperacionGt {
  id: string; empresaId: string; documentoId: string; referencia: string; hash: string; huellaEmisor: string; fechaEmision: string; establecimiento: number; total: string;
  estado: EstadoOpGt; creada: number; actualizada: number; actorId: string; intentoDelDocumento: number; intentosConciliacion: number; /** veces que se renovó la vigencia de la preparación (0 si nunca) */ renovaciones?: number;
  resultado?: { autorizacion?: string; serie?: string; numero?: string; fechaCertificacion?: string; codigo?: string; mensaje?: string; motivoDesconocido?: string; fechaReporte?: string };
}
export interface AlmacenGt {
  /** ¿Sobrevive a un reinicio? Sin esto no se envía nada real. */
  readonly persistente: boolean;
  /** Atómico. Si el documento ya tiene una operación que bloquea (enviando, certificada o desconocida) devuelve ESA; si tiene una «preparada» con la misma referencia, la devuelve; si no, crea. */
  crear(op: OperacionGt): Promise<{ op: OperacionGt; creada: boolean }>;
  obtener(empresaId: string, id: string): Promise<OperacionGt | null>;
  deDocumento(empresaId: string, documentoId: string): Promise<OperacionGt[]>;
  /** Compare-and-set: aplica los cambios solo si el estado actual está en «desde». Devuelve la operación nueva o null si otro proceso ya la cambió. */
  transicion(empresaId: string, id: string, desde: EstadoOpGt[], cambios: Partial<OperacionGt>): Promise<OperacionGt | null>;
  /** Aplica al DOCUMENTO una operación «certificada» (estado fiscal, serie, número y autorización). Atómico e idempotente; falla si el documento ya tiene otros datos fiscales. */
  aplicarCertificacion?(empresaId: string, operacionId: string): Promise<"aplicada" | "ya_aplicada">;
  /** Guarda los XML/PDF REALES de una operación certificada. Solo inserción; repetir el mismo tipo no cambia nada. */
  guardarArtefactos?(empresaId: string, op: OperacionGt, artefactos: ArtefactoGt[]): Promise<void>;
  /** Lee un artefacto del documento (solo de esa empresa). */
  artefacto?(empresaId: string, documentoId: string, tipo: "xml" | "pdf"): Promise<(ArtefactoGt & { operacionId: string }) | null>;
}
export interface ArtefactoGt { tipo: "xml" | "pdf"; nombre: string; mime: "application/xml" | "application/pdf"; sha256: string; contenido: Uint8Array }
export const MAX_ARTEFACTO = 5 * 1024 * 1024;
const BLOQUEAN: EstadoOpGt[] = ["enviando", "certificada", "desconocida"];
/** Una preparación vence a los 30 min (preparadaCaducaMs). Se puede RENOVAR (misma operación, misma referencia, sin autorizar nada) como máximo 3 veces y dentro de las 24 h de su creación (la base lo impone también); después se DESCARTA sin enviar y se prepara una nueva. */
export const MAX_RENOVACIONES = 3, MAX_EDAD_PREPARADA_MS = 24 * 3_600_000;

/** Almacén en memoria: SOLO para pruebas y demostración sin base. No es persistente: el servicio no enviará nada real con él. */
export class AlmacenGtMemoria implements AlmacenGt {
  readonly persistente: boolean = false;
  #ops = new Map<string, OperacionGt>();
  async crear(op: OperacionGt) {
    const previas = [...this.#ops.values()].filter((o) => o.empresaId === op.empresaId && o.documentoId === op.documentoId);
    const bloquea = previas.find((o) => BLOQUEAN.includes(o.estado)); if (bloquea) return { op: { ...bloquea }, creada: false };
    const igual = previas.find((o) => o.estado === "preparada" && o.referencia === op.referencia); if (igual) return { op: { ...igual }, creada: false };
    this.#ops.set(op.id, { ...op }); return { op: { ...op }, creada: true };
  }
  async obtener(empresaId: string, id: string) { const o = this.#ops.get(id); return o && o.empresaId === empresaId ? { ...o } : null; }
  async deDocumento(empresaId: string, documentoId: string) { return [...this.#ops.values()].filter((o) => o.empresaId === empresaId && o.documentoId === documentoId).map((o) => ({ ...o })); }
  async transicion(empresaId: string, id: string, desde: EstadoOpGt[], cambios: Partial<OperacionGt>) {
    const o = this.#ops.get(id); if (!o || o.empresaId !== empresaId || !desde.includes(o.estado)) return null;
    const n = { ...o, ...cambios, id: o.id, empresaId: o.empresaId, documentoId: o.documentoId }; this.#ops.set(id, n); return { ...n };
  }
  /** Solo para pruebas: registro de lo aplicado y de los artefactos (en la base real lo hacen la función y la tabla de la migración 29). */
  aplicadas = new Set<string>(); #arts = new Map<string, ArtefactoGt & { operacionId: string; documentoId: string; empresaId: string }>();
  async aplicarCertificacion(empresaId: string, operacionId: string) {
    const o = this.#ops.get(operacionId); if (!o || o.empresaId !== empresaId || o.estado !== "certificada") throw new Error("FEL_REGLA: la operación no está certificada");
    if (this.aplicadas.has(operacionId)) return "ya_aplicada" as const; this.aplicadas.add(operacionId); return "aplicada" as const;
  }
  async guardarArtefactos(empresaId: string, op: OperacionGt, artefactos: ArtefactoGt[]) {
    const o = this.#ops.get(op.id); if (!o || o.empresaId !== empresaId || o.estado !== "certificada") throw new Error("FEL_DIGIFACT: solo una operación certificada tiene artefactos");
    for (const a of artefactos) { const k = `${op.id}|${a.tipo}`; if (!this.#arts.has(k)) this.#arts.set(k, { ...a, contenido: a.contenido.slice(), operacionId: op.id, documentoId: op.documentoId, empresaId }); }
  }
  async artefacto(empresaId: string, documentoId: string, tipo: "xml" | "pdf") {
    const a = [...this.#arts.values()].find((x) => x.empresaId === empresaId && x.documentoId === documentoId && x.tipo === tipo);
    return a ? { tipo: a.tipo, nombre: a.nombre, mime: a.mime, sha256: a.sha256, contenido: a.contenido.slice(), operacionId: a.operacionId } : null;
  }
  /** Solo para pruebas: un almacén «persistente» simulado (lo que será el de la base de datos). */
  static persistenteSimulado(): AlmacenGtMemoria { const a = new AlmacenGtMemoria(); (a as { persistente: boolean }).persistente = true; return a; }
}

/** Lo único que el servicio necesita del cliente de Digifact (así las pruebas usan el cliente REAL con un transporte falso). */
export type ClienteGt = Pick<DigifactGt, "consultarNit" | "certificar" | "conciliarPorReferencia" | "obtenerDocumento">;

export interface DatosEmisorEmpresa { emisor: EmisorGt; huella: string }
export interface DepsFelGt {
  /** Cliente de Digifact TEST de ESA empresa, o null si la empresa no tiene canal habilitado. Las credenciales se resuelven aquí, por empresa. */
  clienteDe: (empresaId: string) => ClienteGt | null;
  /** Datos del emisor APROBADOS para esa empresa (y su huella), o null. */
  emisorDe: (empresaId: string) => DatosEmisorEmpresa | null;
  almacen: AlmacenGt;
  /** Referencia que la persona responsable autorizó para ESTA prueba (nada más se envía). null = ninguna autorizada. */
  /** Autorización de la persona responsable: o la referencia de UNA prueba (GUID), o «CICLO-TEST» (ciclo de pruebas en TEST publicado con su aprobación: vale para cualquier documento de la empresa de demostración mientras esté publicado). */
  autorizaPrueba: () => string | null;
  ahora?: () => Date;
  auditar?: (evento: string, ctx: ContextoFel, detalle: Record<string, unknown>) => Promise<void> | void;
  /** Política de impuestos. Por defecto: IVA 12 % INCLUIDO en el precio, solo para afiliación GEN; pendiente de validación fiscal. */
  impuestos?: (totalItem: bigint, emisor: EmisorGt) => ItemGt["impuestos"];
  /** Un envío que lleva más de esto en «enviando» se considera interrumpido (proceso caído) y pasa a «desconocida» para conciliar. */
  enviandoCaducaMs?: number; preparadaCaducaMs?: number;
  /** Días hacia atrás (además del de la emisión) en los que, ANTES de enviar, se busca la referencia en el reporte de acuses de Digifact (solo lectura). 7 por defecto; 0 lo desactiva (solo pruebas). */ prevueloDias?: number;
  limiteNitPorMinuto?: number;
}

export const CONFIRMACION_TEST = "CERTIFICAR-TEST";
/** Valor de «autorizaPrueba» que autoriza el CICLO de pruebas en TEST (todos los documentos de la empresa de demostración, mientras esa publicación esté vigente); el resto de controles sigue igual. */
export const AUTORIZACION_CICLO = "CICLO-TEST";
/** «c***@dominio»: lo único del correo que se registra o devuelve. */
export const enmascararCorreo = (c: string) => { const [u, d] = c.split("@"); return `${(u ?? "").slice(0, 1)}***@${d ?? ""}`; };
const RE_NIT = /^\d{1,11}[0-9K]$/i;

async function sha256(s: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** GUID determinista (formato UUID v5) a partir de textos: la misma entrada da siempre la misma referencia. */
export async function guidDe(...partes: string[]): Promise<string> {
  const b = (await sha256(partes.join("|"))).slice(0, 16); b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const ESC = 1_000_000n;
const prod = (a: bigint, b: bigint) => (a * b + ESC / 2n) / ESC;   // igual que el validador del NUC

/** IVA 12 % incluido en el precio (gravable + IVA = total del ítem), con el redondeo del documento de prueba aprobado (6 decimales, mitad hacia arriba). */
export function ivaIncluidoGeneral(total: bigint, emisor: EmisorGt): ItemGt["impuestos"] {
  if (emisor.afiliacionIva !== "GEN") throw new ErrorFelGt("VALIDACION", `Afiliación IVA «${emisor.afiliacionIva}» sin política de impuestos habilitada (solo GEN, pendiente de validación fiscal)`, [{ campo: "emisor.afiliacionIva", mensaje: "no soportada todavía" }]);
  const monto = (total * 12n + 56n) / 112n;
  return [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: deMicro(total - monto), monto: deMicro(monto) }];
}

/** GT no tiene horario de verano: UTC−6 fijo. */
export function fechaGt(d: Date): string { return new Date(d.getTime() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "-06:00"); }

export interface ResumenPreparacion {
  operacionId: string; referencia: string; documentoId: string; total: string; receptor: { tipoId: string; id: string; nombre: string };
  fechaEmision: string; huellaEmisor: string; establecimiento: number; caducaEnMs: number; reutilizada: boolean; /** true si esta llamada renovó la vigencia de una preparación vencida (la misma operación y referencia) */ renovada?: boolean; renovaciones?: number;
  /** Correo (enmascarado) al que Digifact enviará la factura al certificar, si la persona lo pidió; null si no. Es solo un eco: NO forma parte de la huella ni de la referencia. */ correoSolicitado?: string | null;
  aviso: string;
}

const aBytes = (t: string): Uint8Array | null => { try { const bin = atob(t.replace(/\s+/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch { return null; } };
const limpioNombre = (t: string) => t.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 60);
/** Valida un artefacto REAL recibido del certificador contra la operación certificada. Nunca se acepta ni se sirve algo que no corresponda a la autorización. */
export async function artefactoValido(tipo: "xml" | "pdf", b64: string, op: OperacionGt): Promise<ArtefactoGt> {
  const mal = (m: string) => new ErrorFelGt("ARTEFACTO_INVALIDO", `El ${tipo.toUpperCase()} recibido no es válido: ${m}`);
  const bytes = aBytes(b64); if (!bytes || bytes.length === 0) throw mal("vacío o ilegible");
  if (bytes.length > MAX_ARTEFACTO) throw mal("supera el tamaño máximo");
  const r = op.resultado; if (op.estado !== "certificada" || !r?.autorizacion || !r.serie || !r.numero) throw mal("la operación no está certificada");
  if (tipo === "xml") {
    let t: string; try { t = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw mal("no es UTF-8"); }
    t = t.replace(/^\uFEFF/, "");
    if (!/^\s*<[?!A-Za-z]/.test(t)) throw mal("no parece XML");
    if (/<!DOCTYPE|<!ENTITY/i.test(t)) throw mal("contiene una declaración de tipo de documento");
    if (!t.toUpperCase().includes(r.autorizacion.toUpperCase())) throw mal("no contiene la autorización certificada");
  } else {
    const cab = new TextDecoder("latin1").decode(bytes.slice(0, 8)), cola = new TextDecoder("latin1").decode(bytes.slice(-1024));
    if (!cab.startsWith("%PDF-") || !cola.includes("%%EOF")) throw mal("no es un PDF completo");
  }
  return { tipo, nombre: `DTE-${limpioNombre(r.serie)}-${limpioNombre(r.numero)}.${tipo}`, mime: tipo === "xml" ? "application/xml" : "application/pdf", sha256: hex(await sha256Bytes(bytes)), contenido: bytes };
}
async function sha256Bytes(b: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource)); }

export class ServicioFelGt {
  #nit = new Map<string, number[]>();
  constructor(private d: DepsFelGt) {}
  #ahora() { return (this.d.ahora ?? (() => new Date()))(); }
  async #aud(evento: string, ctx: ContextoFel, detalle: Record<string, unknown>) {
    try { await this.d.auditar?.(evento, ctx, detalle); } catch { /* la auditoría no debe tumbar la operación, pero tampoco expone nada */ }
  }
  #exigir(ctx: ContextoFel, permiso: string) {
    if (!ctx || typeof ctx.empresaId !== "string" || !ctx.empresaId || typeof ctx.actorId !== "string" || !ctx.actorId) throw new ErrorFelGt("NO_AUTORIZADO", "Contexto de empresa no válido");
    if (!ctx.permisos.includes(permiso)) throw new ErrorFelGt("NO_AUTORIZADO", "No tienes permiso para esta operación");
  }
  /** ¿Esta empresa tiene canal Digifact TEST, y está autorizado el CICLO de pruebas (sin fijar una referencia)? No revela nada sensible; solo lo que la interfaz necesita para ofrecer «Guardar y certificar en TEST». */
  estadoCanal(empresaId: string): { canal: boolean; ciclo: boolean } {
    return { canal: !!this.d.clienteDe(empresaId) && !!this.d.emisorDe(empresaId), ciclo: this.d.autorizaPrueba() === AUTORIZACION_CICLO };
  }
  #canal(ctx: ContextoFel): { cliente: ClienteGt; emisor: DatosEmisorEmpresa } {
    const cliente = this.d.clienteDe(ctx.empresaId), emisor = this.d.emisorDe(ctx.empresaId);
    if (!cliente || !emisor) throw new ErrorFelGt("SIN_CANAL", "Esta empresa no tiene un canal Digifact TEST habilitado");
    return { cliente, emisor };
  }

  /* ---------------------------------------------------------------- 1. consulta de NIT (solo lectura) */
  async consultarNit(ctx: ContextoFel, nit: unknown) {
    this.#exigir(ctx, "clientes.ver");
    const n = typeof nit === "string" ? nit.trim().toUpperCase() : ""; if (!RE_NIT.test(n)) throw new ErrorFelGt("ENTRADA", "NIT no válido (sin guiones)");
    const { cliente } = this.#canal(ctx);
    const ahora = this.#ahora().getTime(), v = (this.#nit.get(ctx.empresaId) ?? []).filter((t) => ahora - t < 60_000);
    if (v.length >= (this.d.limiteNitPorMinuto ?? 20)) throw new ErrorFelGt("LIMITE", "Demasiadas consultas de NIT; espera un minuto");
    v.push(ahora); this.#nit.set(ctx.empresaId, v);
    let r; try { r = await cliente.consultarNit(n); } catch (e) { throw this.#traducir(e); }
    await this.#aud("digifact_test.nit_consultado", ctx, { encontrado: r.encontrado });
    return r.encontrado ? { encontrado: true as const, nit: r.nit, nombre: r.nombre } : { encontrado: false as const };
  }

  /* ---------------------------------------------------------------- 2. validación (sin red, sin efectos) */
  /** Arma la factura y la valida. No guarda nada y no llama a Digifact. Devuelve TODOS los errores. */
  async validar(ctx: ContextoFel, doc: DocumentoFel, o: { fechaEmision?: string; referencia?: string; correo?: unknown } = {}) {
    this.#exigir(ctx, "borradores.ver");
    this.#mismaEmpresa(ctx, doc);
    const e = this.d.emisorDe(ctx.empresaId); if (!e) throw new ErrorFelGt("SIN_CANAL", "Esta empresa no tiene datos de emisor aprobados para Digifact TEST");
    const errores: { campo: string; mensaje: string }[] = [];
    if (doc.estadoPreparacion !== "revisado") errores.push({ campo: "documento", mensaje: "El documento debe estar revisado antes de certificarlo" });
    if (!["ninguno", "rechazado"].includes(doc.estadoFiscal)) errores.push({ campo: "documento", mensaje: `El documento ya está en estado fiscal «${doc.estadoFiscal}»` });
    const referencia = o.referencia ?? "00000000-0000-5000-8000-000000000000";   // marcador: la referencia real se fija al preparar
    let factura: FacturaGt | null = null;
    let correoVal: string | undefined; try { correoVal = this.#correo(o.correo); } catch (x) { if (x instanceof ErrorFelGt) errores.push({ campo: "receptor.correo", mensaje: x.message }); else throw x; }
    let fechaDoc = fechaGt(this.#ahora());
    if (o.fechaEmision) fechaDoc = o.fechaEmision;
    else { try { fechaDoc = this.#fechaEmisionDe(doc); } catch (x) { if (x instanceof ErrorFelGt && x.errores) errores.push(...x.errores); else throw x; } }
    try { factura = this.#factura(doc, e.emisor, referencia, fechaDoc, correoVal); }
    catch (x) { if (x instanceof ErrorFelGt && x.errores) errores.push(...x.errores); else throw x; }
    if (factura) errores.push(...validarFactura(factura));
    const tipo = doc.tipoDte ?? "FACT";
    return { ok: errores.length === 0, errores, total: factura ? totalFactura(factura) : null, huellaEmisor: e.huella, tipo, certificable: puedeCertificar(tipo),
      ...(puedeCertificar(tipo) ? {} : { aviso: `${tipoDte(tipo)?.nombre ?? tipo}: solo validación y vista previa; la certificación de este tipo aún no está habilitada (${tipoDte(tipo)?.motivoPendiente ?? "pendiente"})` }) };
  }

  /** ¿Pasó la vigencia de la preparación? Se cuenta desde la última renovación (o la creación). */
  #vencida(op: OperacionGt, ahoraMs: number): boolean { return ahoraMs - op.actualizada > (this.d.preparadaCaducaMs ?? 30 * 60_000); }

  /* ---------------------------------------------------------------- 3. preparación (guarda la operación; NO envía) */
  /** Un tipo que no está «implementado» NO se prepara ni se certifica (ni TEST ni real): solo se valida y se previsualiza. La base repite este bloqueo (fel_tipos_dte.certificacion_habilitada). */
  #exigirTipoCertificable(doc: DocumentoFel) {
    const t = doc.tipoDte ?? "FACT";
    if (!puedeCertificar(t)) throw new ErrorFelGt("TIPO_NO_HABILITADO", `${tipoDte(t)?.nombre ?? t}: la certificación de este tipo de documento aún no está habilitada (solo validación y vista previa)`);
  }
  async preparar(ctx: ContextoFel, doc: DocumentoFel, o: { correo?: unknown } = {}): Promise<ResumenPreparacion> {
    this.#exigir(ctx, "fiscal.certificar"); this.#mismaEmpresa(ctx, doc); this.#exigirTipoCertificable(doc);
    const correo = this.#correo(o.correo);   // solo se valida y se repite enmascarado: el correo NO entra en la huella, así que la referencia y la operación preparada no cambian
    const { emisor } = this.#canal(ctx);
    const previas = await this.d.almacen.deDocumento(ctx.empresaId, doc.id);
    const bloquea = previas.find((o) => BLOQUEAN.includes(o.estado));
    if (bloquea) throw new ErrorFelGt("ESTADO", bloquea.estado === "certificada" ? "Este documento ya fue certificado" : `Este documento tiene una operación «${bloquea.estado}»: no se prepara otra (concilia primero)`);
    const fecha = this.#fechaEmisionDe(doc);   // la fecha ELEGIDA (nunca se cambia sola); si está fuera de la ventana, se rechaza aquí
    const intento = previas.filter((o) => o.estado === "rechazada" || o.estado === "no_enviada").length;   // solo los intentos ya resueltos: preparar dos veces lo mismo da la MISMA referencia
    const hash = await this.#hashDoc(ctx, doc, emisor.huella);
    const referencia = await guidDe("nexa-fel-gt", ctx.empresaId, doc.id, hash, String(intento));
    const v = await this.validar(ctx, doc, { fechaEmision: fecha, referencia, correo });
    if (!v.ok) throw new ErrorFelGt("VALIDACION", "El documento no cumple los requisitos de Digifact", v.errores);
    const ahora = this.#ahora().getTime();
    const nueva: OperacionGt = { id: crypto.randomUUID(), empresaId: ctx.empresaId, documentoId: doc.id, referencia, hash, huellaEmisor: emisor.huella, fechaEmision: fecha, establecimiento: emisor.emisor.establecimiento.codigo,
      total: v.total!, estado: "preparada", creada: ahora, actualizada: ahora, actorId: ctx.actorId, intentoDelDocumento: intento, intentosConciliacion: 0 };
    let { op, creada } = await this.d.almacen.crear(nueva);
    if (op.estado !== "preparada") throw new ErrorFelGt("ESTADO", `Este documento tiene una operación «${op.estado}»`);
    // preparación VENCIDA que se vuelve a preparar: se RENUEVA la vigencia (misma operación, referencia, huella y contenido; NO autoriza nada: certificar sigue exigiendo la confirmación, la referencia, la huella y la autorización expresa)
    // con tope: máximo MAX_RENOVACIONES y MAX_EDAD_PREPARADA_MS desde su creación; agotada, se descarta SIN enviar (nunca se envió) y se prepara otra con referencia nueva
    let renovada = false;
    if (!creada && this.#vencida(op, ahora)) {
      if ((op.renovaciones ?? 0) < MAX_RENOVACIONES && ahora - op.creada <= MAX_EDAD_PREPARADA_MS) {
        const n = await this.d.almacen.transicion(ctx.empresaId, op.id, ["preparada"], { actualizada: Math.max(ahora, op.actualizada + 1), renovaciones: (op.renovaciones ?? 0) + 1 });
        if (!n) { const ya = await this.d.almacen.obtener(ctx.empresaId, op.id); if (!ya || ya.estado !== "preparada") throw new ErrorFelGt("ESTADO", "La operación cambió mientras se renovaba: vuelve a intentarlo"); op = ya; }
        else { op = n; renovada = true; await this.#aud("digifact_test.preparada_renovada", ctx, { documento: doc.id, operacion: op.id, referencia: op.referencia, renovaciones: op.renovaciones ?? 0 }); }
      } else {
        const d = await this.d.almacen.transicion(ctx.empresaId, op.id, ["preparada"], { estado: "no_enviada", actualizada: Math.max(ahora, op.actualizada + 1), resultado: { codigo: "preparacion_caducada", mensaje: "La preparación agotó sus renovaciones; se descartó sin enviar nada" } });
        await this.#aud("digifact_test.preparada_descartada", ctx, { documento: doc.id, operacion: op.id, referencia: op.referencia, enviada: false });
        if (d) return await this.preparar(ctx, doc, o);   // ahora cuenta como intento resuelto: la nueva preparación tiene OTRA referencia
        throw new ErrorFelGt("ESTADO", "La operación cambió mientras se descartaba: vuelve a intentarlo");
      }
    }
    await this.#aud("digifact_test.preparada", ctx, { documento: doc.id, referencia: op.referencia, total: op.total, ...(correo ? { correo_solicitado: true } : {}) });
    return { operacionId: op.id, referencia: op.referencia, documentoId: op.documentoId, total: op.total, receptor: { tipoId: doc.receptor.tipoId, id: doc.receptor.id, nombre: doc.receptor.nombre }, fechaEmision: op.fechaEmision,
      huellaEmisor: op.huellaEmisor, establecimiento: op.establecimiento, caducaEnMs: Math.max(0, op.actualizada + (this.d.preparadaCaducaMs ?? 30 * 60_000) - ahora), reutilizada: !creada, renovada, renovaciones: op.renovaciones ?? 0, correoSolicitado: correo ? enmascararCorreo(correo) : null,
      aviso: "Preparada: NO se envió nada a Digifact. Para certificar en TEST escribe la confirmación y repite la referencia y la huella del emisor." };
  }

  /* ---------------------------------------------------------------- 4. certificación en TEST (confirmación manual) */
  async certificar(ctx: ContextoFel, doc: DocumentoFel, c: { operacionId: unknown; confirmacion: unknown; referencia: unknown; huellaEmisor: unknown; correo?: unknown }) {
    this.#exigir(ctx, "fiscal.certificar"); this.#mismaEmpresa(ctx, doc); this.#exigirTipoCertificable(doc);
    if (typeof c.operacionId !== "string") throw new ErrorFelGt("ENTRADA", "Falta la operación preparada");
    const op0 = await this.d.almacen.obtener(ctx.empresaId, c.operacionId); if (!op0 || op0.documentoId !== doc.id) throw new ErrorFelGt("NO_ENCONTRADO", "Operación no encontrada");
    // reutilización: lo que ya se envió NO se vuelve a enviar nunca
    if (BLOQUEAN.includes(op0.estado)) {
      await this.#aud("digifact_test.reutilizada", ctx, { operacion: op0.id, estado: op0.estado });
      return { reutilizada: true as const, operacion: this.#publica(op0), ...(op0.estado === "certificada" ? await this.#sellar(ctx, op0) : {}) };   // una certificación ya hecha se repara (idempotente), nunca se reenvía
    }
    if (op0.estado !== "preparada") throw new ErrorFelGt("ESTADO", `La operación está «${op0.estado}»: prepara el documento de nuevo`);
    if (this.#vencida(op0, this.#ahora().getTime())) throw new ErrorFelGt("ESTADO", "La preparación caducó: vuelve a prepararla (se renueva sin cambiar la referencia)");
    const { cliente, emisor } = this.#canal(ctx);
    if (c.confirmacion !== CONFIRMACION_TEST) throw new ErrorFelGt("CONFIRMACION", `Falta la confirmación explícita: escribe ${CONFIRMACION_TEST}`);
    if (c.referencia !== op0.referencia) throw new ErrorFelGt("CONFIRMACION", "La referencia escrita no coincide con la de la operación preparada");
    if (c.huellaEmisor !== op0.huellaEmisor) throw new ErrorFelGt("CONFIRMACION", "La huella del emisor escrita no coincide con la aprobada");
    if (emisor.huella !== op0.huellaEmisor) throw new ErrorFelGt("EMISOR", "Los datos del emisor cambiaron desde que se prepararon");
    // el contenido que se envía es EXACTAMENTE el que se preparó
    const hash = await this.#hashDoc(ctx, doc, emisor.huella);
    if (hash !== op0.hash) throw new ErrorFelGt("DOCUMENTO_CAMBIO", "El documento cambió desde que se preparó: vuelve a prepararlo");
    // la fecha de emisión se REVALIDA inmediatamente antes de enviar (el reloj del servidor): un borrador preparado ayer con una fecha que hoy ya excede el plazo NO se certifica ni se cambia solo
    { const v = validarFechaEmision(op0.fechaEmision.slice(0, 10), this.#ahora()); if (!v.ok) throw new ErrorFelGt("FECHA_EMISION", `${v.mensaje} Elige otra fecha de emisión y vuelve a revisar y preparar el documento.`, [{ campo: "fechaEmision", mensaje: v.mensaje }]); }
    if (doc.estadoPreparacion !== "revisado" || !["ninguno", "rechazado"].includes(doc.estadoFiscal)) throw new ErrorFelGt("ESTADO", "El documento ya no está en un estado que permita certificar");
    if (!this.d.almacen.persistente) throw new ErrorFelGt("ALMACEN_NO_PERSISTENTE", "No hay almacén persistente de operaciones: no se envía nada real (si el proceso se reiniciara, se perdería la memoria de lo enviado)");
    { const aut = this.d.autorizaPrueba(); if (aut !== op0.referencia && aut !== AUTORIZACION_CICLO) throw new ErrorFelGt("PRUEBA_NO_AUTORIZADA", "Esta prueba no fue autorizada expresamente por la persona responsable: no se envió nada"); }
    // CHEQUEO PREVIO (solo lectura): Digifact NO deduplica por referencia, y la base de NEXA puede haber perdido la memoria de lo enviado (restauración de un respaldo, reversión). La referencia es DETERMINISTA, así que si Digifact ya la
    // tiene, NO se envía: la operación queda «desconocida» y una persona la concilia (se adopta el resultado que Digifact ya tiene). Si no se puede comprobar, tampoco se envía (falla cerrado; no hay reintento automático).
    const pv = await this.#prevuelo(cliente, op0);
    if (pv.tipo === "indeterminado") throw new ErrorFelGt("PREVUELO", "No se pudo verificar en Digifact que esta referencia sea nueva: no se envió nada. Una persona decide cuándo repetirlo (no hay reintentos automáticos).");
    if (pv.tipo === "encontrado") {
      const w = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["preparada"], { estado: "enviando", actualizada: this.#ahora().getTime() });
      if (!w) { const ya = await this.d.almacen.obtener(ctx.empresaId, op0.id); return { reutilizada: true as const, operacion: this.#publica(ya ?? op0) }; }
      const n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "desconocida", resultado: { motivoDesconocido: "ya_existia_en_digifact", fechaReporte: pv.fecha }, actualizada: this.#ahora().getTime() });
      await this.#aud("digifact_test.ya_existia_en_digifact", ctx, { operacion: op0.id, referencia: op0.referencia });
      return { reutilizada: false as const, operacion: this.#publica(n ?? op0), aviso: "Digifact YA tiene un documento con esta referencia: NO se envió nada. Usa «Consultar a Digifact» para registrar ese resultado (sin reenviar)." };
    }
    const correo = this.#correo(c.correo);   // opcional: lo que se pidió para ESTA certificación (no cambia la huella ni la referencia)
    const factura = this.#factura(doc, emisor.emisor, op0.referencia, op0.fechaEmision, correo);
    let nuc: Record<string, unknown>; try { nuc = construirNuc(factura); } catch (e) { throw new ErrorFelGt("VALIDACION", "El documento no cumple el NUC", (e as { errores?: { campo: string; mensaje: string }[] }).errores); }

    // write-ahead: el estado «enviando» se guarda ANTES de la llamada; si otro proceso ganó la carrera, no se envía
    const ganada = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["preparada"], { estado: "enviando", actualizada: this.#ahora().getTime() });
    if (!ganada) { const ya = await this.d.almacen.obtener(ctx.empresaId, op0.id); return { reutilizada: true as const, operacion: this.#publica(ya ?? op0) }; }
    await this.#aud("digifact_test.envio_iniciado", ctx, { operacion: op0.id, referencia: op0.referencia });
    // «envío SOLICITADO a Digifact»: el correo viaja en el NUC y lo envía Digifact al certificar. NEXA no recibe confirmación de entrega y por eso nunca registra «entregado».
    if (correo) await this.#aud("digifact_test.correo_solicitado", ctx, { documento: doc.id, operacion: op0.id, referencia: op0.referencia, destinatario: enmascararCorreo(correo) });

    let res;
    try { res = await cliente.certificar(nuc, { referencia: op0.referencia, formatos: ["XML", "PDF"] }); }
    catch (e) {
      if (e instanceof ErrorDigifact && ["autenticacion", "no_autorizado", "no_permitido", "solicitud"].includes(e.tipo)) {   // rechazada ANTES de procesar: no salió ningún documento
        const n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "no_enviada", resultado: { codigo: e.tipo, mensaje: e.message.slice(0, 200) }, actualizada: this.#ahora().getTime() });
        await this.#aud("digifact_test.no_enviada", ctx, { operacion: op0.id, tipo: e.tipo });
        return { reutilizada: false as const, operacion: this.#publica(n ?? op0), error: { tipo: e.tipo, mensaje: e.message } };
      }
      const n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "desconocida", resultado: { motivoDesconocido: "excepcion_del_adaptador" }, actualizada: this.#ahora().getTime() });
      await this.#aud("digifact_test.desconocida", ctx, { operacion: op0.id, motivo: "excepcion_del_adaptador" });
      return { reutilizada: false as const, operacion: this.#publica(n ?? op0) };
    }
    const ahora = this.#ahora().getTime();
    let n: OperacionGt | null;
    if (res.tipo === "certificado") {
      try { n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "certificada", actualizada: ahora, resultado: { autorizacion: res.autorizacion, serie: res.serie, numero: res.numero, fechaCertificacion: res.fechaCertificacion } }); }
      catch {   // p. ej. la autorización ya existe en la empresa: el documento SÍ salió, pero el resultado no se puede registrar como certificado ⇒ queda «desconocida» (bloquea otro envío) y lo resuelve una persona
        n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "desconocida", actualizada: ahora, resultado: { motivoDesconocido: "resultado_no_registrable" } });
        await this.#aud("digifact_test.resultado_no_registrable", ctx, { operacion: op0.id, referencia: op0.referencia });
      }
    }
    else if (res.tipo === "rechazado_confirmado") n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "rechazada", actualizada: ahora, resultado: { codigo: res.codigo, mensaje: res.mensaje } });
    else n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "desconocida", actualizada: ahora, resultado: { motivoDesconocido: res.motivo } });
    await this.#aud(`digifact_test.${res.tipo === "certificado" ? "certificada" : res.tipo === "rechazado_confirmado" ? "rechazada" : "desconocida"}`, ctx, { operacion: op0.id, referencia: op0.referencia });
    const sello = res.tipo === "certificado" && n && n.estado === "certificada" ? await this.#sellar(ctx, n, res.artefactos) : {};   // datos fiscales al documento y XML/PDF reales al almacén
    return { reutilizada: false as const, operacion: this.#publica(n ?? op0), ...sello };
  }

  /* ---------------------------------------------------------------- 5. conciliación (solo lectura hacia Digifact) */
  async conciliar(ctx: ContextoFel, operacionId: unknown) {
    this.#exigir(ctx, "fiscal.ver");
    if (typeof operacionId !== "string") throw new ErrorFelGt("ENTRADA", "Falta la operación");
    let op = await this.d.almacen.obtener(ctx.empresaId, operacionId); if (!op) throw new ErrorFelGt("NO_ENCONTRADO", "Operación no encontrada");
    const ahora = this.#ahora().getTime();
    if (op.estado === "enviando" && ahora - op.actualizada > (this.d.enviandoCaducaMs ?? 2 * 60_000)) {   // el proceso cayó a mitad de un envío: no sabemos qué pasó
      op = (await this.d.almacen.transicion(ctx.empresaId, op.id, ["enviando"], { estado: "desconocida", resultado: { motivoDesconocido: "proceso_interrumpido" }, actualizada: ahora })) ?? op;
    }
    if (op.estado !== "desconocida") return { resultado: "sin_cambios" as const, operacion: this.#publica(op), ...(op.estado === "certificada" ? await this.#sellar(ctx, op) : {}) };
    const { cliente } = this.#canal(ctx);
    let r; try { r = await cliente.conciliarPorReferencia(op.resultado?.fechaReporte ?? op.fechaEmision.slice(0, 10), op.referencia, op.establecimiento); } catch (e) { throw this.#traducir(e); }
    if (r.tipo === "encontrado") {
      if (r.documento.referenciaInterna.toUpperCase() !== op.referencia.toUpperCase()) throw new ErrorFelGt("ESTADO", "El reporte devolvió otra referencia: no se concilia");
      let n: OperacionGt | null;
      try { n = await this.d.almacen.transicion(ctx.empresaId, op.id, ["desconocida"], { estado: "certificada", actualizada: ahora, resultado: { autorizacion: r.documento.autorizacion, serie: r.documento.serie, numero: r.documento.numero, fechaCertificacion: r.documento.fechaCertificacion } }); }
      catch { await this.#aud("digifact_test.resultado_no_registrable", ctx, { operacion: op.id, referencia: op.referencia }); throw new ErrorFelGt("ESTADO", "Digifact devolvió una autorización que ya pertenece a otro documento: requiere revisión manual; no se modificó nada"); }
      await this.#aud("digifact_test.conciliada", ctx, { operacion: op.id, resultado: "encontrado" });
      return { resultado: "certificada" as const, operacion: this.#publica(n ?? op), ...(n ? await this.#sellar(ctx, n) : {}) };
    }
    const n = await this.d.almacen.transicion(ctx.empresaId, op.id, ["desconocida"], { intentosConciliacion: op.intentosConciliacion + 1, actualizada: ahora });
    await this.#aud("digifact_test.conciliacion_sin_resultado", ctx, { operacion: op.id, resultado: r.tipo });
    return { resultado: r.tipo === "no_encontrado" ? "no_encontrado" as const : "indeterminado" as const, operacion: this.#publica(n ?? op),
      aviso: "Digifact aún no muestra este documento. Puede haber demora: NO se reenvía; repite la consulta más tarde. Si no aparece, decide una persona." };
  }

  /** Busca la referencia en el reporte de acuses de Digifact (solo lectura), del día de la emisión hacia atrás. «indeterminado» ante cualquier duda: nunca se asume que no existe. */
  async #prevuelo(cliente: ClienteGt, op: OperacionGt): Promise<{ tipo: "no_encontrado" } | { tipo: "encontrado"; fecha: string } | { tipo: "indeterminado" }> {
    const dias = this.d.prevueloDias ?? 7; if (dias <= 0) return { tipo: "no_encontrado" };
    const base = new Date(op.fechaEmision.slice(0, 10) + "T12:00:00Z");
    for (let i = 0; i <= dias; i++) {
      const f = new Date(base.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      let r; try { r = await cliente.conciliarPorReferencia(f, op.referencia, op.establecimiento); } catch { return { tipo: "indeterminado" }; }
      if (r.tipo === "encontrado") return r.documento.referenciaInterna.toUpperCase() === op.referencia.toUpperCase() ? { tipo: "encontrado", fecha: f } : { tipo: "indeterminado" };
      if (r.tipo === "indeterminado") return { tipo: "indeterminado" };
    }
    return { tipo: "no_encontrado" };
  }

  /** Estado de las operaciones de UN documento de la empresa del contexto. */
  async estadoDocumento(ctx: ContextoFel, documentoId: string) {
    this.#exigir(ctx, "fiscal.ver");
    return (await this.d.almacen.deDocumento(ctx.empresaId, documentoId)).sort((a, b) => a.creada - b.creada).map((o) => this.#publica(o));
  }

  /** Tras una certificación válida: la aplica al documento y guarda los XML/PDF reales. Nunca revierte lo fiscal: si algo falla queda «pendiente» y se repara (idempotente) en la siguiente consulta, conciliación o descarga. */
  async #sellar(ctx: ContextoFel, op: OperacionGt, arts?: ArtefactosB64): Promise<{ aplicacion: "aplicada" | "ya_aplicada" | "pendiente" | "no_disponible"; artefactos: "guardados" | "pendientes" | "invalidos" | "no_disponible" }> {
    let aplicacion: "aplicada" | "ya_aplicada" | "pendiente" | "no_disponible" = "no_disponible";
    if (this.d.almacen.aplicarCertificacion) {
      try { aplicacion = await this.d.almacen.aplicarCertificacion(ctx.empresaId, op.id); if (aplicacion === "aplicada") await this.#aud("digifact_test.aplicada_al_documento", ctx, { operacion: op.id, documento: op.documentoId }); }
      catch (e) { aplicacion = "pendiente"; await this.#aud("digifact_test.aplicacion_pendiente", ctx, { operacion: op.id, motivo: String((e as Error)?.message ?? e).slice(0, 80).replace(/[^\w :.-]/g, "") }); }
    }
    let artefactos: "guardados" | "pendientes" | "invalidos" | "no_disponible" = "no_disponible";
    if (this.d.almacen.guardarArtefactos) {
      const lista: ArtefactoGt[] = []; artefactos = "pendientes";
      for (const tipo of ["xml", "pdf"] as const) {
        const b = arts?.[tipo]; if (!b) continue;
        try { lista.push(await artefactoValido(tipo, b, op)); } catch (e) { artefactos = "invalidos"; await this.#aud("digifact_test.artefacto_invalido", ctx, { operacion: op.id, tipo, motivo: (e as Error).message.slice(0, 120) }); }
      }
      if (lista.length) {
        try { await this.d.almacen.guardarArtefactos(ctx.empresaId, op, lista); if (artefactos !== "invalidos" && lista.length === 2) artefactos = "guardados"; await this.#aud("digifact_test.artefactos_guardados", ctx, { operacion: op.id, tipos: lista.map((x) => x.tipo).join(",") }); }
        catch { artefactos = "pendientes"; await this.#aud("digifact_test.artefactos_pendientes", ctx, { operacion: op.id }); }
      }
    }
    return { aplicacion, artefactos };
  }

  /* ---------------------------------------------------------------- 6. descarga del XML o PDF REAL certificado */
  async descargar(ctx: ContextoFel, documentoId: unknown, tipo: unknown): Promise<ArtefactoGt> {
    this.#exigir(ctx, "fiscal.ver");
    if (typeof documentoId !== "string" || !documentoId) throw new ErrorFelGt("ENTRADA", "Falta el documento");
    if (tipo !== "xml" && tipo !== "pdf") throw new ErrorFelGt("ENTRADA", "El tipo debe ser xml o pdf");
    if (!this.d.almacen.persistente || !this.d.almacen.artefacto || !this.d.almacen.guardarArtefactos) throw new ErrorFelGt("ALMACEN_NO_PERSISTENTE", "No hay almacén persistente de artefactos");
    const op = (await this.d.almacen.deDocumento(ctx.empresaId, documentoId)).find((o) => o.estado === "certificada");
    if (!op) throw new ErrorFelGt("NO_ENCONTRADO", "Este documento no tiene una certificación de Digifact");
    let a = await this.d.almacen.artefacto(ctx.empresaId, documentoId, tipo);
    if (!a) {   // no quedó guardado al certificar: se pide a Digifact (solo lectura), se valida y se guarda una vez
      const { cliente } = this.#canal(ctx);
      let r; try { r = await cliente.obtenerDocumento(op.resultado!.autorizacion!, [tipo === "xml" ? "XML" : "PDF"]); } catch (e) { throw this.#traducir(e); }
      const b64 = r.encontrado ? r.artefactos[tipo] : undefined; if (!b64) throw new ErrorFelGt("NO_ENCONTRADO", "Digifact aún no entrega este archivo: intenta de nuevo más tarde");
      const nuevo = await artefactoValido(tipo, b64, op); await this.d.almacen.guardarArtefactos(ctx.empresaId, op, [nuevo]);
      a = (await this.d.almacen.artefacto(ctx.empresaId, documentoId, tipo)) ?? { ...nuevo, operacionId: op.id };
    }
    if (hex(await sha256Bytes(a.contenido)) !== a.sha256) throw new ErrorFelGt("ARTEFACTO_INVALIDO", "El archivo guardado no coincide con su huella: no se entrega");
    await this.#aud("digifact_test.artefacto_descargado", ctx, { operacion: op.id, tipo });
    return a;
  }

  /* ---------------------------------------------------------------- internos */
  #mismaEmpresa(ctx: ContextoFel, doc: DocumentoFel) { if (doc.empresaId !== ctx.empresaId) throw new ErrorFelGt("NO_ENCONTRADO", "Documento no encontrado"); }
  /** ¿El almacén sobrevive a un reinicio? Sin esto no se envía nada real. Solo lo informa la API (nunca un dato de la base). */
  get almacenPersistente(): boolean { return this.d.almacen.persistente; }
  #publica(o: OperacionGt) {
    return { id: o.id, documentoId: o.documentoId, referencia: o.referencia, estado: o.estado, total: o.total, fechaEmision: o.fechaEmision, huellaEmisor: o.huellaEmisor, intentoDelDocumento: o.intentoDelDocumento,
      intentosConciliacion: o.intentosConciliacion, renovaciones: o.renovaciones ?? 0, ...(o.estado === "preparada" ? { vigenteHasta: o.actualizada + (this.d.preparadaCaducaMs ?? 30 * 60_000) } : {}), resultado: o.resultado ?? null };
  }
  #traducir(e: unknown): ErrorFelGt {
    if (e instanceof ErrorFelGt) return e;
    if (e instanceof ErrorDigifact) return new ErrorFelGt(e.tipo === "limite" ? "LIMITE" : "ENTRADA", e.message);   // los mensajes de ErrorDigifact ya están limpios de secretos
    return new ErrorFelGt("ENTRADA", "No se pudo consultar a Digifact");
  }
  /** Correo pedido (texto) o undefined. El formato lo valida validarFactura (y el NUC); aquí solo el tipo. */
  #correo(v: unknown): string | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || v.length > 254) throw new ErrorFelGt("ENTRADA", "El correo no es válido");
    return v.trim() || undefined;
  }
  /** Huella del contenido que se prepara y se envía. Incluye la FECHA de emisión elegida (solo si existe: los documentos sin ella conservan su huella de siempre): cambiar la fecha es cambiar el documento, así que se vuelve a preparar. */
  async #hashDoc(ctx: ContextoFel, doc: DocumentoFel, huellaEmisor: string) {
    return hex(await sha256(JSON.stringify([ctx.empresaId, doc.id, doc.receptor, doc.lineas, huellaEmisor, ...(doc.fechaEmisionPrevista ? [doc.fechaEmisionPrevista] : [])])));
  }
  /** Header.IssuedDateTime del documento: la fecha ELEGIDA (validada contra el reloj del SERVIDOR) con la hora local de Guatemala. Sin fecha elegida, el momento actual. Una fecha fuera de la ventana NO se corrige: se rechaza. */
  #fechaEmisionDe(doc: DocumentoFel): string {
    const ahora = this.#ahora();
    if (!doc.fechaEmisionPrevista) return fechaGt(ahora);
    const v = validarFechaEmision(doc.fechaEmisionPrevista, ahora);
    if (!v.ok) throw new ErrorFelGt("FECHA_EMISION", v.mensaje, [{ campo: "fechaEmision", mensaje: v.mensaje }]);
    return fechaHoraEmisionGt(v.fecha, ahora);
  }
  #factura(doc: DocumentoFel, emisor: EmisorGt, referencia: string, fechaEmision: string, correo?: string): FacturaGt {
    const politica = this.d.impuestos ?? ivaIncluidoGeneral;
    const items: ItemGt[] = doc.lineas.map((l, i) => {
      const q = aMicro(l.cantidad), p = aMicro(l.precioUnitario), dsc = aMicro(l.descuento || "0");
      if (q === null || p === null || dsc === null) throw new ErrorFelGt("VALIDACION", `Línea ${i + 1}: importes con más de 6 decimales o no numéricos`, [{ campo: `lineas[${i}]`, mensaje: "importes no válidos (máximo 6 decimales)" }]);
      if (p === 0n) throw new ErrorFelGt("VALIDACION", `Línea ${i + 1}: el precio Q0.00 solo se acepta en la demostración simulada; no es válido para certificar`, [{ campo: `lineas[${i}].precioUnitario`, mensaje: "precio cero no admitido al certificar" }]);   // decisión de DEMO: no se extiende a la certificación real
      const total = prod(q, p) - dsc;
      if (total < 0n) throw new ErrorFelGt("VALIDACION", `Línea ${i + 1}: el descuento supera el importe`, [{ campo: `lineas[${i}].descuento`, mensaje: "supera el importe de la línea" }]);
      return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, ...(l.unidad ? { unidad: l.unidad } : {}), precioUnitario: l.precioUnitario, descuento: l.descuento || "0", impuestos: politica(total, emisor), totalItem: deMicro(total) };
    });
    const tipo = (doc.tipoDte ?? "FACT") as FacturaGt["tipoDoc"];
    return { tipoDoc: tipo, fechaEmision, moneda: "GTQ", emisor, receptor: correo ? { ...doc.receptor, correo } : doc.receptor, items, referenciaInterna: referencia,
      ...(doc.origen ? { origen: doc.origen } : {}), ...(doc.motivoAjuste ? { motivoAjuste: doc.motivoAjuste } : {}), ...(doc.tipoRecibo ? { tipoRecibo: doc.tipoRecibo } : {}) };
  }
}
