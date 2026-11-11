// ORQUESTADOR DE REFERENCIA (en memoria). Fija la SEMÁNTICA anti-duplicados y de estados que la Fase 2 reimplementará sobre la base de datos
// con estas mismas pruebas. No es código de producción: no persiste, no tiene red, no usa credenciales.
// Reglas: (1) escribir antes de enviar; (2) un solo envío por clave; (3) lo desconocido es un estado (por_verificar), nunca éxito ni fallo;
// (4) sin reintentos automáticos; (5) una sola operación abierta por documento; (6) un DTE certificado es inmutable.
import type { ArtefactoRef, Contexto, DatosFiscales, DocumentoCongelado, EmissionProvider, OperacionRef, ResultadoEnvio } from "./tipos.ts";
import { validarDocumento } from "./validacion.ts";

export type EstadoPreparacion = "borrador" | "revisado";
export type EstadoFiscal = "ninguno" | "pendiente_certificacion" | "por_verificar" | "certificado" | "rechazado";
export type EstadoOperacion = "iniciada" | "confirmada_exitosa" | "confirmada_fallida" | "desconocida";
export type CodigoOrquestador = "DOCUMENTO_INEXISTENTE" | "ESTADO_INVALIDO" | "VALIDACION" | "OPERACION_ABIERTA" | "CLAVE_CON_OTRO_CONTENIDO" | "POR_VERIFICAR" | "EVIDENCIA_REQUERIDA" | "SIN_OPERACION" | "CLAVE_INVALIDA";
export class ErrorOrquestador extends Error { constructor(public codigo: CodigoOrquestador, mensaje: string) { super(mensaje); this.name = "ErrorOrquestador"; } }

export interface Operacion {
  id: string; documentoId: string; empresaId: string; clave: string; hash: string; estado: EstadoOperacion;
  ordenId?: string; motivoDesconocido?: string; resolucion?: "proveedor" | "conciliacion_manual"; evidencia?: string; codigoRechazo?: string;
}
export interface DocumentoRegistro {
  doc: DocumentoCongelado; estadoPreparacion: EstadoPreparacion; estadoFiscal: EstadoFiscal;
  instantanea?: DocumentoCongelado; hash?: string; datosFiscales?: DatosFiscales; artefactos: ArtefactoRef[]; operaciones: string[];
}
export interface ResultadoSolicitud { operacionId: string; estadoOperacion: EstadoOperacion; estadoFiscal: EstadoFiscal; reutilizada: boolean }
export type ResultadoConciliar = { tipo: "certificado" | "rechazado" } | { tipo: "indeterminado"; motivo: string };

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export async function hashContenido(doc: DocumentoCongelado): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonico(doc)) as unknown as BufferSource));
  return Array.from(buf, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class OrquestadorReferencia {
  private documentos = new Map<string, DocumentoRegistro>();
  private operaciones = new Map<string, Operacion>();
  private autorizaciones = new Map<string, string>();   // autorizacion → documentoId (unicidad)
  private seq = 0;
  /** Cuántas veces se llamó a proveedor.enviar (nunca más de una por clave). */
  enviosAlProveedor = 0;
  private ctx: Contexto;

  constructor(private proveedor: EmissionProvider, opciones: { ambiente?: Contexto["ambiente"]; ahora?: () => Date } = {}) {
    this.ctx = { ambiente: opciones.ambiente ?? "simulado", ahora: opciones.ahora ?? (() => new Date("2026-01-01T12:00:00Z")) };
  }
  private reg(id: string): DocumentoRegistro { const r = this.documentos.get(id); if (!r) throw new ErrorOrquestador("DOCUMENTO_INEXISTENTE", `No existe el documento ${id}`); return r; }
  documento(id: string): Readonly<DocumentoRegistro> { return this.reg(id); }
  operacion(id: string): Readonly<Operacion> { const o = this.operaciones.get(id); if (!o) throw new ErrorOrquestador("SIN_OPERACION", `No existe la operación ${id}`); return o; }
  operacionesDe(docId: string): Operacion[] { return this.reg(docId).operaciones.map((i) => this.operaciones.get(i)!); }
  private abierta(r: DocumentoRegistro): Operacion | undefined { return r.operaciones.map((i) => this.operaciones.get(i)!).find((o) => o.estado === "iniciada" || o.estado === "desconocida"); }

  crearBorrador(doc: DocumentoCongelado): string {
    if (this.documentos.has(doc.id)) throw new ErrorOrquestador("ESTADO_INVALIDO", "El documento ya existe");
    this.documentos.set(doc.id, { doc: structuredClone(doc), estadoPreparacion: "borrador", estadoFiscal: "ninguno", artefactos: [], operaciones: [] }); return doc.id;
  }
  editarBorrador(id: string, doc: DocumentoCongelado): void {
    const r = this.reg(id);
    if (r.estadoFiscal !== "ninguno" || r.estadoPreparacion !== "borrador") throw new ErrorOrquestador("ESTADO_INVALIDO", "Solo se edita un borrador sin vida fiscal");
    r.doc = structuredClone({ ...doc, id });
  }
  async validar(id: string) { return await this.proveedor.validar(this.reg(id).doc, this.ctx); }
  /** Congela una instantánea y su hash. Cualquier cambio posterior exige volver a borrador (solo posible sin vida fiscal o tras rechazo confirmado). */
  async revisar(id: string): Promise<string> {
    const r = this.reg(id);
    if (r.estadoPreparacion !== "borrador" || (r.estadoFiscal !== "ninguno")) throw new ErrorOrquestador("ESTADO_INVALIDO", "Solo se revisa un borrador sin vida fiscal");
    const local = validarDocumento(r.doc), prov = await this.proveedor.validar(r.doc, this.ctx);
    if (!local.ok || !prov.ok) throw new ErrorOrquestador("VALIDACION", `Validación fallida: ${[...local.errores, ...prov.errores].map((e) => e.codigo).join(", ")}`);
    r.instantanea = structuredClone(r.doc); r.hash = await hashContenido(r.instantanea); r.estadoPreparacion = "revisado"; return r.hash;
  }
  volverABorrador(id: string): void {
    const r = this.reg(id);
    if (r.estadoFiscal === "rechazado") { r.estadoFiscal = "ninguno"; r.estadoPreparacion = "borrador"; r.instantanea = undefined; r.hash = undefined; return; }
    if (r.estadoFiscal === "ninguno" && r.estadoPreparacion === "revisado") { r.estadoPreparacion = "borrador"; r.instantanea = undefined; r.hash = undefined; return; }
    throw new ErrorOrquestador("ESTADO_INVALIDO", "Un documento con vida fiscal solo vuelve a borrador tras un rechazo confirmado");
  }

  /** Inicia una certificación. Idempotente por (documento, clave). NUNCA reintenta. */
  async solicitarCertificacion(id: string, clave: string): Promise<ResultadoSolicitud> {
    const r = this.reg(id);
    if (clave.length < 16 || clave.length > 80) throw new ErrorOrquestador("CLAVE_INVALIDA", "La clave de idempotencia debe tener entre 16 y 80 caracteres");
    // — Todo lo que sigue hasta crear la operación es SÍNCRONO: no hay ventana para dos envíos simultáneos. —
    const previa = r.operaciones.map((i) => this.operaciones.get(i)!).find((o) => o.clave === clave);
    if (previa) {
      if (r.hash !== undefined && previa.hash !== r.hash && r.estadoPreparacion === "revisado") throw new ErrorOrquestador("CLAVE_CON_OTRO_CONTENIDO", "Esa clave ya se usó con otro contenido");
      if (r.hash === undefined) throw new ErrorOrquestador("CLAVE_CON_OTRO_CONTENIDO", "Esa clave ya se usó con otro contenido");
      return { operacionId: previa.id, estadoOperacion: previa.estado, estadoFiscal: r.estadoFiscal, reutilizada: true };   // misma clave y mismo contenido: la misma operación
    }
    if (r.estadoFiscal === "certificado") throw new ErrorOrquestador("ESTADO_INVALIDO", "El documento ya está certificado");
    if (r.estadoFiscal === "por_verificar") throw new ErrorOrquestador("POR_VERIFICAR", "Hay un resultado desconocido: concilia antes de cualquier operación nueva");
    const abierta = this.abierta(r); if (abierta) throw new ErrorOrquestador("OPERACION_ABIERTA", "Ya hay una operación abierta para este documento");
    if (r.estadoPreparacion !== "revisado" || !r.instantanea || !r.hash) throw new ErrorOrquestador("ESTADO_INVALIDO", "El documento debe estar revisado");
    if (r.estadoFiscal !== "ninguno") throw new ErrorOrquestador("ESTADO_INVALIDO", "Tras un rechazo el documento vuelve a borrador y se revisa de nuevo");
    const op: Operacion = { id: `OP-${++this.seq}`, documentoId: id, empresaId: r.doc.empresaId, clave, hash: r.hash, estado: "iniciada" };
    this.operaciones.set(op.id, op); r.operaciones.push(op.id); r.estadoFiscal = "pendiente_certificacion";   // write-ahead: persistido ANTES de enviar
    let resultado: ResultadoEnvio;
    this.enviosAlProveedor++;
    try { resultado = await this.conTiempo(this.proveedor.enviar({ empresaId: op.empresaId, establecimientoId: r.doc.establecimientoId, documentoId: id, operacionId: op.id, claveIdempotencia: clave, hashContenido: r.hash, instantanea: r.instantanea, ambiente: this.ctx.ambiente }, this.ctx)); }
    catch (e) { resultado = { tipo: "desconocido", motivo: e instanceof TiempoAgotado ? "timeout" : "excepcion_del_adaptador" }; }
    this.aplicar(op, r, resultado);
    return { operacionId: op.id, estadoOperacion: op.estado, estadoFiscal: r.estadoFiscal, reutilizada: false };
  }
  private conTiempo<T>(p: Promise<T>): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TiempoAgotado()), this.proveedor.capacidades.tiempoMaximoMs); });
    return Promise.race([p, limite]).finally(() => clearTimeout(t));
  }
  private datosValidos(x: DatosFiscales): boolean { return [x.serie, x.numero, x.autorizacion, x.fechaCertificacion].every((v) => typeof v === "string" && v.trim().length > 0); }
  private aplicar(op: Operacion, r: DocumentoRegistro, res: ResultadoEnvio, resolucion: "proveedor" | "conciliacion_manual" = "proveedor"): void {
    if (op.estado === "confirmada_exitosa" || op.estado === "confirmada_fallida") return;   // una operación confirmada no se reabre ni se modifica
    switch (res.tipo) {
      case "certificado": {
        const otro = this.autorizaciones.get(res.autorizacion);
        if (!this.datosValidos(res) || (otro !== undefined && otro !== op.documentoId)) { op.estado = "desconocida"; op.motivoDesconocido = "respuesta_ilegible"; r.estadoFiscal = "por_verificar"; return; }   // dato incompleto o autorización ya usada: sospechoso → no se asume éxito
        this.autorizaciones.set(res.autorizacion, op.documentoId);
        r.datosFiscales = { serie: res.serie, numero: res.numero, autorizacion: res.autorizacion, fechaCertificacion: res.fechaCertificacion }; r.artefactos = res.artefactos;
        op.estado = "confirmada_exitosa"; op.resolucion = resolucion; r.estadoFiscal = "certificado"; return;
      }
      case "rechazado_confirmado": op.estado = "confirmada_fallida"; op.resolucion = resolucion; op.codigoRechazo = res.codigo; r.estadoFiscal = "rechazado"; return;
      case "desconocido": op.estado = "desconocida"; op.motivoDesconocido = res.motivo; r.estadoFiscal = "por_verificar"; return;
      case "requiere_accion_humana": op.ordenId = res.ordenId; return;   // la operación sigue abierta (iniciada) y el documento, pendiente
    }
  }
  /** El canal asistido informa el resultado final de una orden (p. ej. lo que leyó el agente tras la emisión humana). */
  resolverAccionHumana(operacionId: string, res: ResultadoEnvio): void {
    const op = this.operacion(operacionId) as Operacion; const r = this.reg(op.documentoId);
    if (op.estado !== "iniciada" || !op.ordenId) throw new ErrorOrquestador("SIN_OPERACION", "La operación no está esperando una acción humana");
    if (res.tipo === "requiere_accion_humana") throw new ErrorOrquestador("ESTADO_INVALIDO", "Se esperaba un resultado final");
    this.aplicar(op, r, res);
  }
  /** Conciliación de un resultado desconocido (o de una orden humana sin resolver). Manual solo con evidencia. */
  async conciliar(id: string, manual?: { resultado: "certificado" | "fallida"; evidencia: string; datos?: DatosFiscales }): Promise<ResultadoConciliar> {
    const r = this.reg(id); const op = this.abierta(r);
    if (!op) throw new ErrorOrquestador("SIN_OPERACION", "No hay una operación abierta que conciliar");
    if (manual) {
      if (!manual.evidencia?.trim()) throw new ErrorOrquestador("EVIDENCIA_REQUERIDA", "La resolución manual exige evidencia");
      if (manual.resultado === "certificado") { if (!manual.datos) throw new ErrorOrquestador("EVIDENCIA_REQUERIDA", "Certificar manualmente exige serie, número y autorización"); this.aplicar(op, r, { tipo: "certificado", ...manual.datos, artefactos: [] }, "conciliacion_manual"); }
      else this.aplicar(op, r, { tipo: "rechazado_confirmado", codigo: "MANUAL", mensaje: "Confirmado como fallido con evidencia" }, "conciliacion_manual");
      op.evidencia = manual.evidencia; return { tipo: r.estadoFiscal === "certificado" ? "certificado" : r.estadoFiscal === "rechazado" ? "rechazado" : "indeterminado" } as ResultadoConciliar;
    }
    const ref: OperacionRef = { empresaId: op.empresaId, documentoId: id, operacionId: op.id, claveIdempotencia: op.clave, ambiente: this.ctx.ambiente };
    const c = await this.proveedor.conciliar(ref, this.ctx);
    if (c.tipo === "certificado") { this.aplicar(op, r, { ...c }); return { tipo: r.estadoFiscal === "certificado" ? "certificado" : "indeterminado", ...(r.estadoFiscal === "certificado" ? {} : { motivo: "datos de la conciliación no válidos" }) } as ResultadoConciliar; }
    if (c.tipo === "no_existe_confirmado") { if (op.ordenId) return { tipo: "indeterminado", motivo: "Orden humana sin resolver" }; this.aplicar(op, r, { tipo: "rechazado_confirmado", codigo: "NO_EXISTE", mensaje: "El proveedor confirma que no existe el DTE" }); return { tipo: "rechazado" }; }
    return { tipo: "indeterminado", motivo: c.motivo };
  }
  /** Auditoría de «certificaciones huérfanas»: operaciones dadas por fallidas (sobre todo a mano) para las que el proveedor reporta ahora un DTE. Solo lectura. */
  async auditarFallidas(id: string): Promise<Operacion[]> {
    const r = this.reg(id); const huerfanas: Operacion[] = [];
    for (const op of this.operacionesDe(id)) {
      if (op.estado !== "confirmada_fallida") continue;
      const c = await this.proveedor.conciliar({ empresaId: op.empresaId, documentoId: id, operacionId: op.id, claveIdempotencia: op.clave, ambiente: this.ctx.ambiente }, this.ctx);
      if (c.tipo === "certificado") huerfanas.push(op);
    }
    void r; return huerfanas;
  }
  async obtenerArtefactos(id: string): Promise<ArtefactoRef[]> {
    const r = this.reg(id); if (r.estadoFiscal !== "certificado") return [];
    if (r.artefactos.length) return r.artefactos;
    const op = r.operaciones.map((i) => this.operaciones.get(i)!).find((o) => o.estado === "confirmada_exitosa")!;
    const ref: OperacionRef = { empresaId: op.empresaId, documentoId: id, operacionId: op.id, claveIdempotencia: op.clave, ambiente: this.ctx.ambiente };
    r.artefactos = await this.proveedor.obtenerArtefactos(ref, this.ctx); return r.artefactos;
  }
}
class TiempoAgotado extends Error {}
