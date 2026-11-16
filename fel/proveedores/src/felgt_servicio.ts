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
//  · Nada de credenciales, tokens ni cuerpos crudos en los resultados ni en la auditoría.
import { ErrorDigifact, type DigifactGt } from "./digifact_gt.ts";
import { construirNuc, aMicro, deMicro, validarFactura, totalFactura, type EmisorGt, type FacturaGt, type ItemGt, type ReceptorGt } from "./nuc_gt.ts";

export type CodigoFelGt = "NO_AUTORIZADO" | "SIN_CANAL" | "VALIDACION" | "ESTADO" | "CONFIRMACION" | "PRUEBA_NO_AUTORIZADA" | "ALMACEN_NO_PERSISTENTE" | "DOCUMENTO_CAMBIO" | "NO_ENCONTRADO" | "LIMITE" | "EMISOR" | "ENTRADA";
const STATUS: Record<CodigoFelGt, number> = { NO_AUTORIZADO: 403, SIN_CANAL: 422, VALIDACION: 422, ESTADO: 409, CONFIRMACION: 400, PRUEBA_NO_AUTORIZADA: 403, ALMACEN_NO_PERSISTENTE: 503, DOCUMENTO_CAMBIO: 409, NO_ENCONTRADO: 404, LIMITE: 429, EMISOR: 422, ENTRADA: 400 };
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
  lineas: { tipo: "Bien" | "Servicio"; descripcion: string; cantidad: string; precioUnitario: string; descuento: string; unidad?: string }[];
}

export type EstadoOpGt = "preparada" | "enviando" | "certificada" | "rechazada" | "desconocida" | "no_enviada";
export interface OperacionGt {
  id: string; empresaId: string; documentoId: string; referencia: string; hash: string; huellaEmisor: string; fechaEmision: string; establecimiento: number; total: string;
  estado: EstadoOpGt; creada: number; actualizada: number; actorId: string; intentoDelDocumento: number; intentosConciliacion: number;
  resultado?: { autorizacion?: string; serie?: string; numero?: string; fechaCertificacion?: string; codigo?: string; mensaje?: string; motivoDesconocido?: string };
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
}
const BLOQUEAN: EstadoOpGt[] = ["enviando", "certificada", "desconocida"];

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
  /** Solo para pruebas: un almacén «persistente» simulado (lo que será el de la base de datos). */
  static persistenteSimulado(): AlmacenGtMemoria { const a = new AlmacenGtMemoria(); (a as { persistente: boolean }).persistente = true; return a; }
}

/** Lo único que el servicio necesita del cliente de Digifact (así las pruebas usan el cliente REAL con un transporte falso). */
export type ClienteGt = Pick<DigifactGt, "consultarNit" | "certificar" | "conciliarPorReferencia">;

export interface DatosEmisorEmpresa { emisor: EmisorGt; huella: string }
export interface DepsFelGt {
  /** Cliente de Digifact TEST de ESA empresa, o null si la empresa no tiene canal habilitado. Las credenciales se resuelven aquí, por empresa. */
  clienteDe: (empresaId: string) => ClienteGt | null;
  /** Datos del emisor APROBADOS para esa empresa (y su huella), o null. */
  emisorDe: (empresaId: string) => DatosEmisorEmpresa | null;
  almacen: AlmacenGt;
  /** Referencia que la persona responsable autorizó para ESTA prueba (nada más se envía). null = ninguna autorizada. */
  autorizaPrueba: () => string | null;
  ahora?: () => Date;
  auditar?: (evento: string, ctx: ContextoFel, detalle: Record<string, unknown>) => Promise<void> | void;
  /** Política de impuestos. Por defecto: IVA 12 % INCLUIDO en el precio, solo para afiliación GEN; pendiente de validación fiscal. */
  impuestos?: (totalItem: bigint, emisor: EmisorGt) => ItemGt["impuestos"];
  /** Un envío que lleva más de esto en «enviando» se considera interrumpido (proceso caído) y pasa a «desconocida» para conciliar. */
  enviandoCaducaMs?: number; preparadaCaducaMs?: number;
  limiteNitPorMinuto?: number;
}

export const CONFIRMACION_TEST = "CERTIFICAR-TEST";
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
  fechaEmision: string; huellaEmisor: string; establecimiento: number; caducaEnMs: number; reutilizada: boolean;
  aviso: string;
}

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
  async validar(ctx: ContextoFel, doc: DocumentoFel, o: { fechaEmision?: string; referencia?: string } = {}) {
    this.#exigir(ctx, "borradores.ver");
    this.#mismaEmpresa(ctx, doc);
    const e = this.d.emisorDe(ctx.empresaId); if (!e) throw new ErrorFelGt("SIN_CANAL", "Esta empresa no tiene datos de emisor aprobados para Digifact TEST");
    const errores: { campo: string; mensaje: string }[] = [];
    if (doc.estadoPreparacion !== "revisado") errores.push({ campo: "documento", mensaje: "El documento debe estar revisado antes de certificarlo" });
    if (!["ninguno", "rechazado"].includes(doc.estadoFiscal)) errores.push({ campo: "documento", mensaje: `El documento ya está en estado fiscal «${doc.estadoFiscal}»` });
    const referencia = o.referencia ?? "00000000-0000-5000-8000-000000000000";   // marcador: la referencia real se fija al preparar
    let factura: FacturaGt | null = null;
    try { factura = this.#factura(doc, e.emisor, referencia, o.fechaEmision ?? fechaGt(this.#ahora())); }
    catch (x) { if (x instanceof ErrorFelGt && x.errores) errores.push(...x.errores); else throw x; }
    if (factura) errores.push(...validarFactura(factura));
    return { ok: errores.length === 0, errores, total: factura ? totalFactura(factura) : null, huellaEmisor: e.huella };
  }

  /* ---------------------------------------------------------------- 3. preparación (guarda la operación; NO envía) */
  async preparar(ctx: ContextoFel, doc: DocumentoFel): Promise<ResumenPreparacion> {
    this.#exigir(ctx, "fiscal.certificar"); this.#mismaEmpresa(ctx, doc);
    const { emisor } = this.#canal(ctx);
    const previas = await this.d.almacen.deDocumento(ctx.empresaId, doc.id);
    const bloquea = previas.find((o) => BLOQUEAN.includes(o.estado));
    if (bloquea) throw new ErrorFelGt("ESTADO", bloquea.estado === "certificada" ? "Este documento ya fue certificado" : `Este documento tiene una operación «${bloquea.estado}»: no se prepara otra (concilia primero)`);
    const fecha = fechaGt(this.#ahora());
    const intento = previas.filter((o) => o.estado === "rechazada" || o.estado === "no_enviada").length;   // solo los intentos ya resueltos: preparar dos veces lo mismo da la MISMA referencia
    const hash = hex(await sha256(JSON.stringify([ctx.empresaId, doc.id, doc.receptor, doc.lineas, emisor.huella])));
    const referencia = await guidDe("nexa-fel-gt", ctx.empresaId, doc.id, hash, String(intento));
    const v = await this.validar(ctx, doc, { fechaEmision: fecha, referencia });
    if (!v.ok) throw new ErrorFelGt("VALIDACION", "El documento no cumple los requisitos de Digifact", v.errores);
    const ahora = this.#ahora().getTime();
    const nueva: OperacionGt = { id: crypto.randomUUID(), empresaId: ctx.empresaId, documentoId: doc.id, referencia, hash, huellaEmisor: emisor.huella, fechaEmision: fecha, establecimiento: emisor.emisor.establecimiento.codigo,
      total: v.total!, estado: "preparada", creada: ahora, actualizada: ahora, actorId: ctx.actorId, intentoDelDocumento: intento, intentosConciliacion: 0 };
    const { op, creada } = await this.d.almacen.crear(nueva);
    if (op.estado !== "preparada") throw new ErrorFelGt("ESTADO", `Este documento tiene una operación «${op.estado}»`);
    await this.#aud("digifact_test.preparada", ctx, { documento: doc.id, referencia: op.referencia, total: op.total });
    return { operacionId: op.id, referencia: op.referencia, documentoId: op.documentoId, total: op.total, receptor: { tipoId: doc.receptor.tipoId, id: doc.receptor.id, nombre: doc.receptor.nombre }, fechaEmision: op.fechaEmision,
      huellaEmisor: op.huellaEmisor, establecimiento: op.establecimiento, caducaEnMs: Math.max(0, op.creada + (this.d.preparadaCaducaMs ?? 30 * 60_000) - ahora), reutilizada: !creada,
      aviso: "Preparada: NO se envió nada a Digifact. Para certificar en TEST escribe la confirmación y repite la referencia y la huella del emisor." };
  }

  /* ---------------------------------------------------------------- 4. certificación en TEST (confirmación manual) */
  async certificar(ctx: ContextoFel, doc: DocumentoFel, c: { operacionId: unknown; confirmacion: unknown; referencia: unknown; huellaEmisor: unknown }) {
    this.#exigir(ctx, "fiscal.certificar"); this.#mismaEmpresa(ctx, doc);
    if (typeof c.operacionId !== "string") throw new ErrorFelGt("ENTRADA", "Falta la operación preparada");
    const op0 = await this.d.almacen.obtener(ctx.empresaId, c.operacionId); if (!op0 || op0.documentoId !== doc.id) throw new ErrorFelGt("NO_ENCONTRADO", "Operación no encontrada");
    // reutilización: lo que ya se envió NO se vuelve a enviar nunca
    if (BLOQUEAN.includes(op0.estado)) { await this.#aud("digifact_test.reutilizada", ctx, { operacion: op0.id, estado: op0.estado }); return { reutilizada: true as const, operacion: this.#publica(op0) }; }
    if (op0.estado !== "preparada") throw new ErrorFelGt("ESTADO", `La operación está «${op0.estado}»: prepara el documento de nuevo`);
    if (this.#ahora().getTime() - op0.creada > (this.d.preparadaCaducaMs ?? 30 * 60_000)) throw new ErrorFelGt("ESTADO", "La preparación caducó: vuelve a prepararla");
    const { cliente, emisor } = this.#canal(ctx);
    if (c.confirmacion !== CONFIRMACION_TEST) throw new ErrorFelGt("CONFIRMACION", `Falta la confirmación explícita: escribe ${CONFIRMACION_TEST}`);
    if (c.referencia !== op0.referencia) throw new ErrorFelGt("CONFIRMACION", "La referencia escrita no coincide con la de la operación preparada");
    if (c.huellaEmisor !== op0.huellaEmisor) throw new ErrorFelGt("CONFIRMACION", "La huella del emisor escrita no coincide con la aprobada");
    if (emisor.huella !== op0.huellaEmisor) throw new ErrorFelGt("EMISOR", "Los datos del emisor cambiaron desde que se prepararon");
    // el contenido que se envía es EXACTAMENTE el que se preparó
    const hash = hex(await sha256(JSON.stringify([ctx.empresaId, doc.id, doc.receptor, doc.lineas, emisor.huella])));
    if (hash !== op0.hash) throw new ErrorFelGt("DOCUMENTO_CAMBIO", "El documento cambió desde que se preparó: vuelve a prepararlo");
    if (doc.estadoPreparacion !== "revisado" || !["ninguno", "rechazado"].includes(doc.estadoFiscal)) throw new ErrorFelGt("ESTADO", "El documento ya no está en un estado que permita certificar");
    if (!this.d.almacen.persistente) throw new ErrorFelGt("ALMACEN_NO_PERSISTENTE", "No hay almacén persistente de operaciones: no se envía nada real (si el proceso se reiniciara, se perdería la memoria de lo enviado)");
    if (this.d.autorizaPrueba() !== op0.referencia) throw new ErrorFelGt("PRUEBA_NO_AUTORIZADA", "Esta prueba no fue autorizada expresamente por la persona responsable: no se envió nada");
    const factura = this.#factura(doc, emisor.emisor, op0.referencia, op0.fechaEmision);
    let nuc: Record<string, unknown>; try { nuc = construirNuc(factura); } catch (e) { throw new ErrorFelGt("VALIDACION", "El documento no cumple el NUC", (e as { errores?: { campo: string; mensaje: string }[] }).errores); }

    // write-ahead: el estado «enviando» se guarda ANTES de la llamada; si otro proceso ganó la carrera, no se envía
    const ganada = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["preparada"], { estado: "enviando", actualizada: this.#ahora().getTime() });
    if (!ganada) { const ya = await this.d.almacen.obtener(ctx.empresaId, op0.id); return { reutilizada: true as const, operacion: this.#publica(ya ?? op0) }; }
    await this.#aud("digifact_test.envio_iniciado", ctx, { operacion: op0.id, referencia: op0.referencia });

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
    if (res.tipo === "certificado") n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "certificada", actualizada: ahora, resultado: { autorizacion: res.autorizacion, serie: res.serie, numero: res.numero, fechaCertificacion: res.fechaCertificacion } });
    else if (res.tipo === "rechazado_confirmado") n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "rechazada", actualizada: ahora, resultado: { codigo: res.codigo, mensaje: res.mensaje } });
    else n = await this.d.almacen.transicion(ctx.empresaId, op0.id, ["enviando"], { estado: "desconocida", actualizada: ahora, resultado: { motivoDesconocido: res.motivo } });
    await this.#aud(`digifact_test.${res.tipo === "certificado" ? "certificada" : res.tipo === "rechazado_confirmado" ? "rechazada" : "desconocida"}`, ctx, { operacion: op0.id, referencia: op0.referencia });
    // los artefactos (XML/PDF) NO se guardan aquí: el almacenamiento privado es la siguiente fase y requiere autorización; solo se conservan los datos fiscales
    return { reutilizada: false as const, operacion: this.#publica(n ?? op0) };
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
    if (op.estado !== "desconocida") return { resultado: "sin_cambios" as const, operacion: this.#publica(op) };
    const { cliente } = this.#canal(ctx);
    let r; try { r = await cliente.conciliarPorReferencia(op.fechaEmision.slice(0, 10), op.referencia, op.establecimiento); } catch (e) { throw this.#traducir(e); }
    if (r.tipo === "encontrado") {
      if (r.documento.referenciaInterna.toUpperCase() !== op.referencia.toUpperCase()) throw new ErrorFelGt("ESTADO", "El reporte devolvió otra referencia: no se concilia");
      const n = await this.d.almacen.transicion(ctx.empresaId, op.id, ["desconocida"], { estado: "certificada", actualizada: ahora, resultado: { autorizacion: r.documento.autorizacion, serie: r.documento.serie, numero: r.documento.numero, fechaCertificacion: r.documento.fechaCertificacion } });
      await this.#aud("digifact_test.conciliada", ctx, { operacion: op.id, resultado: "encontrado" });
      return { resultado: "certificada" as const, operacion: this.#publica(n ?? op) };
    }
    const n = await this.d.almacen.transicion(ctx.empresaId, op.id, ["desconocida"], { intentosConciliacion: op.intentosConciliacion + 1, actualizada: ahora });
    await this.#aud("digifact_test.conciliacion_sin_resultado", ctx, { operacion: op.id, resultado: r.tipo });
    return { resultado: r.tipo === "no_encontrado" ? "no_encontrado" as const : "indeterminado" as const, operacion: this.#publica(n ?? op),
      aviso: "Digifact aún no muestra este documento. Puede haber demora: NO se reenvía; repite la consulta más tarde. Si no aparece, decide una persona." };
  }

  /** Estado de las operaciones de UN documento de la empresa del contexto. */
  async estadoDocumento(ctx: ContextoFel, documentoId: string) {
    this.#exigir(ctx, "fiscal.ver");
    return (await this.d.almacen.deDocumento(ctx.empresaId, documentoId)).sort((a, b) => a.creada - b.creada).map((o) => this.#publica(o));
  }

  /* ---------------------------------------------------------------- internos */
  #mismaEmpresa(ctx: ContextoFel, doc: DocumentoFel) { if (doc.empresaId !== ctx.empresaId) throw new ErrorFelGt("NO_ENCONTRADO", "Documento no encontrado"); }
  #publica(o: OperacionGt) {
    return { id: o.id, documentoId: o.documentoId, referencia: o.referencia, estado: o.estado, total: o.total, fechaEmision: o.fechaEmision, huellaEmisor: o.huellaEmisor, intentoDelDocumento: o.intentoDelDocumento,
      intentosConciliacion: o.intentosConciliacion, resultado: o.resultado ?? null };
  }
  #traducir(e: unknown): ErrorFelGt {
    if (e instanceof ErrorFelGt) return e;
    if (e instanceof ErrorDigifact) return new ErrorFelGt(e.tipo === "limite" ? "LIMITE" : "ENTRADA", e.message);   // los mensajes de ErrorDigifact ya están limpios de secretos
    return new ErrorFelGt("ENTRADA", "No se pudo consultar a Digifact");
  }
  #factura(doc: DocumentoFel, emisor: EmisorGt, referencia: string, fechaEmision: string): FacturaGt {
    const politica = this.d.impuestos ?? ivaIncluidoGeneral;
    const items: ItemGt[] = doc.lineas.map((l, i) => {
      const q = aMicro(l.cantidad), p = aMicro(l.precioUnitario), dsc = aMicro(l.descuento || "0");
      if (q === null || p === null || dsc === null) throw new ErrorFelGt("VALIDACION", `Línea ${i + 1}: importes con más de 6 decimales o no numéricos`, [{ campo: `lineas[${i}]`, mensaje: "importes no válidos (máximo 6 decimales)" }]);
      const total = prod(q, p) - dsc;
      if (total < 0n) throw new ErrorFelGt("VALIDACION", `Línea ${i + 1}: el descuento supera el importe`, [{ campo: `lineas[${i}].descuento`, mensaje: "supera el importe de la línea" }]);
      return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, ...(l.unidad ? { unidad: l.unidad } : {}), precioUnitario: l.precioUnitario, descuento: l.descuento || "0", impuestos: politica(total, emisor), totalItem: deMicro(total) };
    });
    return { tipoDoc: "FACT", fechaEmision, moneda: "GTQ", emisor, receptor: doc.receptor, items, referenciaInterna: referencia };
  }
}
