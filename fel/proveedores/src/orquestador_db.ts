// ORQUESTADOR sobre la BASE DE DATOS (Fase 2). Mismas reglas que el orquestador de referencia, pero con persistencia real y recuperación:
//  1. se persiste la operación ANTES de enviar (fel_op_certificacion_solicitar) y se MARCA el envío antes de salir (fel_sys_operacion_marcar_envio);
//  2. un solo envío por operación (la marca falla la segunda vez); NUNCA hay reintentos automáticos;
//  3. lo desconocido bloquea (por_verificar); se libera solo con eventos verificables del proveedor o con conciliación manual aprobada por OTRA persona;
//  4. un proceso caído se recupera sin reenviar: sin marca de envío → se prueba que nada salió; con marca → desconocida y a conciliar.
// Nada de esto toca red ni credenciales: el único proveedor disponible es el simulado.
import type { ArtefactoRef, Contexto, DocumentoCongelado, EmissionProvider, OperacionRef, ResultadoConciliacion, ResultadoEnvio } from "./tipos.ts";
import { ErrorBd, type Rpc } from "./rpc.ts";

export interface OperacionBd {
  id: string; empresa_id: string; documento_id: string; tipo: string; clave_idempotencia: string; hash_contenido: string; estado: string;
  proveedor: string | null; canal_id: string | null; ambiente: string | null; enviada_en: string | null; orden_externa: string | null; motivo_desconocido: string | null;
  resolucion: string | null;
}
export interface PendienteBd { operacion_id: string; empresa_id: string; documento_id: string; estado: string; enviada: boolean; orden_externa: string | null; clave_idempotencia: string; ambiente: string | null }
export interface ResultadoSolicitudDb { operacion: OperacionBd; reutilizada: boolean; enCurso: boolean }
export interface ResumenRecuperacion { liberadas_sin_envio: number; marcadas_desconocidas: number; conciliadas: number; resueltas: number; alertas: number; esperando_humano: number; artefactos_completados: number }

/** Puntos de inyección de fallos para probar caídas del proceso (solo pruebas). Lanzar desde el gancho simula que el proceso muere ahí. */
export interface Ganchos { despuesDeSolicitar?: () => Promise<void> | void; despuesDeMarcarEnvio?: () => Promise<void> | void; despuesDeEnviar?: (r: ResultadoEnvio) => Promise<void> | void; despuesDeEvento?: () => Promise<void> | void }
export class ProcesoCaido extends Error { constructor(donde: string) { super(`proceso caído (simulado) ${donde}`); this.name = "ProcesoCaido"; } }

const enc = new TextEncoder();
async function sha256(t: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t) as unknown as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
}
class TiempoAgotado extends Error {}

/** Convierte la instantánea de la base al documento que entiende el proveedor. */
// deno-lint-ignore no-explicit-any
export function aDocumentoCongelado(i: any): DocumentoCongelado {
  const tipo = i.cliente?.tipo_identificacion === "CF" ? "CF" : i.cliente?.tipo_identificacion === "NIT" ? "NIT" : "EXT";
  return {
    id: i.documento_id, empresaId: i.empresa_id, establecimientoId: i.establecimiento?.id ?? "", tipoDte: "SIM", moneda: "GTQ",
    fechaEmision: String(i.fecha_emision_prevista ?? ""),
    receptor: { tipoId: tipo, id: String(i.cliente?.numero_identificacion ?? ""), nombre: i.cliente?.nombre },
    // deno-lint-ignore no-explicit-any
    lineas: (i.lineas ?? []).map((l: any) => ({ tipo: "Servicio" as const, descripcion: String(l.descripcion), cantidad: String(l.cantidad), precioUnitario: String(l.precio_unitario), descuento: String(l.importes?.descuento ?? "0") })),
    total: String(i.base_imponible ?? "0"),
  };
}

export class OrquestadorDb {
  private ctx: Contexto;
  constructor(private rpc: Rpc, private proveedor: EmissionProvider, private opciones: { ambiente?: Contexto["ambiente"]; ahora?: () => Date; ganchos?: Ganchos } = {}) {
    this.ctx = { ambiente: opciones.ambiente ?? "simulado", ahora: opciones.ahora ?? (() => new Date()) };
  }
  private g() { return this.opciones.ganchos ?? {}; }
  private op(empresa: string, id: string) { return this.rpc("fel_sys_operacion", { p_empresa: empresa, p_op: id }) as Promise<OperacionBd>; }

  /** Instantánea y hash vigentes del documento (calculados por la base). */
  async instantanea(empresa: string, doc: string): Promise<{ instantanea: unknown; hash: string; congelado: DocumentoCongelado }> {
    const r = await this.rpc("fel_sys_documento_instantanea", { p_empresa: empresa, p_doc: doc }) as { instantanea: unknown; hash: string };
    return { ...r, congelado: aDocumentoCongelado(r.instantanea) };
  }
  async validar(empresa: string, doc: string) { return await this.proveedor.validar((await this.instantanea(empresa, doc)).congelado, this.ctx); }

  /** Solicita la certificación y, si procede, envía UNA vez. Idempotente por (documento, clave). */
  async solicitar(p: { actor: string; empresa: string; documento: string; clave: string; canal: string }): Promise<ResultadoSolicitudDb> {
    const inst = await this.instantanea(p.empresa, p.documento);
    const v = await this.proveedor.validar(inst.congelado, this.ctx);
    if (!v.ok) throw new ErrorBd(`FEL_REGLA: el proveedor no valida el documento (${v.errores.map((e) => e.codigo).join(", ")})`);
    const op = await this.rpc("fel_op_certificacion_solicitar", { p_actor: p.actor, p_empresa: p.empresa, p_doc: p.documento, p_clave: p.clave, p_hash: inst.hash, p_canal: p.canal }) as OperacionBd;
    await this.g().despuesDeSolicitar?.();
    // Una operación que ya tiene envío marcado, orden o resultado NO se envía de nuevo (repetición o proceso concurrente).
    if (op.estado !== "iniciada" || op.enviada_en || op.orden_externa) return { operacion: await this.op(p.empresa, op.id), reutilizada: true, enCurso: op.estado === "iniciada" };
    try { await this.rpc("fel_sys_operacion_marcar_envio", { p_empresa: p.empresa, p_op: op.id }); }
    catch (e) { if (e instanceof ErrorBd && e.codigo === "FEL_YA_ENVIADA") return { operacion: await this.op(p.empresa, op.id), reutilizada: true, enCurso: true }; throw e; }
    await this.g().despuesDeMarcarEnvio?.();
    let res: ResultadoEnvio;
    try { res = await this.conTiempo(this.proveedor.enviar({ empresaId: p.empresa, establecimientoId: inst.congelado.establecimientoId, documentoId: p.documento, operacionId: op.id, claveIdempotencia: p.clave, hashContenido: inst.hash, instantanea: inst.congelado, ambiente: this.ctx.ambiente }, this.ctx)); }
    catch (e) { if (e instanceof ProcesoCaido) throw e; res = { tipo: "desconocido", motivo: e instanceof TiempoAgotado ? "timeout" : "excepcion_del_adaptador" }; }
    await this.g().despuesDeEnviar?.(res);
    await this.aplicarEnvio(p.empresa, op.id, res, p.documento);
    return { operacion: await this.op(p.empresa, op.id), reutilizada: false, enCurso: false };
  }

  private conTiempo<T>(p: Promise<T>): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TiempoAgotado()), this.proveedor.capacidades.tiempoMaximoMs); });
    return Promise.race([p, limite]).finally(() => clearTimeout(t));
  }

  /** Registra el evento verificable y aplica el resultado. Cualquier incoherencia de un «certificado» se trata como DESCONOCIDO. */
  private async aplicarEnvio(empresa: string, opId: string, res: ResultadoEnvio, documentoId: string): Promise<void> {
    const ev = (resultado: string, motivo: string | null, d?: { serie: string; numero: string; autorizacion: string }, hash?: string) =>
      this.rpc("fel_sys_evento_registrar", { p_empresa: empresa, p_op: opId, p_tipo: "envio", p_resultado: resultado, p_motivo: motivo, p_serie: d?.serie ?? null, p_numero: d?.numero ?? null, p_autorizacion: d?.autorizacion ?? null, p_hash: hash ?? null }) as Promise<number>;
    const desconocido = async (motivo: string) => { await ev("desconocido", motivo); await this.g().despuesDeEvento?.(); await this.rpc("fel_sys_operacion_desconocida", { p_empresa: empresa, p_op: opId, p_motivo: motivo }); };
    switch (res.tipo) {
      case "certificado": {
        let evento: number;
        try { evento = await ev("certificado", null, { serie: res.serie, numero: res.numero, autorizacion: res.autorizacion }, await sha256(JSON.stringify({ s: res.serie, n: res.numero, a: res.autorizacion, f: res.fechaCertificacion }))); }
        catch (e) { if (e instanceof ErrorBd) { await desconocido("respuesta_ilegible"); return; } throw e; }   // datos incompletos: el proveedor dijo «certificado» pero no podemos probarlo
        await this.g().despuesDeEvento?.();
        try { await this.rpc("fel_sys_operacion_resolver_evento", { p_empresa: empresa, p_op: opId, p_evento: evento }); }
        catch (e) { if (e instanceof ErrorBd) { await this.rpc("fel_sys_operacion_desconocida", { p_empresa: empresa, p_op: opId, p_motivo: "respuesta_no_aceptada" }); return; } throw e; }   // p. ej. autorización repetida
        await this.guardarArtefactos(empresa, opId, res.artefactos);
        return;
      }
      case "rechazado_confirmado": {
        const evento = await ev("rechazado_confirmado", res.codigo.slice(0, 60));
        await this.g().despuesDeEvento?.();
        await this.rpc("fel_sys_operacion_resolver_evento", { p_empresa: empresa, p_op: opId, p_evento: evento }); return;
      }
      case "requiere_accion_humana": {
        await ev("requiere_accion_humana", null); await this.g().despuesDeEvento?.();
        await this.rpc("fel_sys_operacion_orden", { p_empresa: empresa, p_op: opId, p_orden: res.ordenId }); return;
      }
      case "desconocido": await desconocido(res.motivo); return;
    }
    void documentoId;
  }

  private async guardarArtefactos(empresa: string, opId: string, arts: ArtefactoRef[]): Promise<number> {
    let n = 0;
    for (const a of arts) if ((a.tipo === "xml" || a.tipo === "pdf") && a.contenido) { const id = await this.rpc("fel_sys_artefacto_guardar", { p_empresa: empresa, p_op: opId, p_tipo: a.tipo, p_nombre: a.nombre, p_mime: a.mime, p_contenido: a.contenido }); if (id) n++; }
    return n;
  }

  /** Consulta al proveedor (solo lectura) y registra un evento de conciliación; los decisivos resuelven la operación. */
  async conciliar(empresa: string, opId: string): Promise<{ resultado: ResultadoConciliacion["tipo"]; aplicado: string }> {
    const op = await this.op(empresa, opId);
    const ref: OperacionRef = { empresaId: empresa, documentoId: op.documento_id, operacionId: opId, claveIdempotencia: op.clave_idempotencia, ambiente: (op.ambiente as Contexto["ambiente"]) ?? this.ctx.ambiente };
    let c: ResultadoConciliacion;
    try { c = await this.proveedor.conciliar(ref, this.ctx); } catch { c = { tipo: "indeterminado", motivo: "error al consultar al proveedor" }; }
    const d = c.tipo === "certificado" ? { serie: c.serie, numero: c.numero, autorizacion: c.autorizacion } : undefined;
    const evento = await this.rpc("fel_sys_evento_registrar", { p_empresa: empresa, p_op: opId, p_tipo: "conciliacion", p_resultado: c.tipo, p_motivo: c.tipo === "indeterminado" ? c.motivo.slice(0, 120) : null,
      p_serie: d?.serie ?? null, p_numero: d?.numero ?? null, p_autorizacion: d?.autorizacion ?? null, p_hash: null }) as number;
    let aplicado = "sin_cambio";
    try { aplicado = await this.rpc("fel_sys_operacion_resolver_evento", { p_empresa: empresa, p_op: opId, p_evento: evento }) as string; }
    catch (e) { if (!(e instanceof ErrorBd)) throw e; await this.rpc("fel_sys_operacion_desconocida", { p_empresa: empresa, p_op: opId, p_motivo: "respuesta_no_aceptada" }).catch(() => {}); aplicado = "no_aceptada"; }
    if (aplicado === "certificado" && c.tipo === "certificado") await this.guardarArtefactos(empresa, opId, c.artefactos);
    return { resultado: c.tipo, aplicado };
  }

  /** El canal asistido informa el resultado final de una orden (lo que leyó el agente tras la emisión humana). */
  async resolverAccionHumana(empresa: string, opId: string, res: ResultadoEnvio): Promise<void> {
    if (res.tipo === "requiere_accion_humana") throw new ErrorBd("FEL_REGLA: se esperaba un resultado final");
    const op = await this.op(empresa, opId);
    if (op.estado !== "iniciada" || !op.orden_externa) throw new ErrorBd("FEL_REGLA: la operación no espera una acción humana");
    await this.aplicarEnvio(empresa, opId, res, op.documento_id);
  }

  /** Recuperación tras reinicios o caídas. NUNCA reenvía: libera solo lo que se PRUEBA que no salió y concilia lo demás. */
  async recuperar(opciones: { umbralMin?: number } = {}): Promise<ResumenRecuperacion> {
    const r: ResumenRecuperacion = { liberadas_sin_envio: 0, marcadas_desconocidas: 0, conciliadas: 0, resueltas: 0, alertas: 0, esperando_humano: 0, artefactos_completados: 0 };
    const pendientes = await this.rpc("fel_sys_operaciones_pendientes", { p_umbral_min: opciones.umbralMin ?? null }) as PendienteBd[];
    for (const p of pendientes) {
      if (p.estado === "iniciada" && p.orden_externa) { r.esperando_humano++; continue; }                 // espera a una persona: no se toca
      if (p.estado === "iniciada" && !p.enviada) { await this.rpc("fel_sys_operacion_no_enviada", { p_empresa: p.empresa_id, p_op: p.operacion_id }); r.liberadas_sin_envio++; continue; }
      if (p.estado === "iniciada" && p.enviada) { await this.rpc("fel_sys_operacion_desconocida", { p_empresa: p.empresa_id, p_op: p.operacion_id, p_motivo: "proceso_caido" }); r.marcadas_desconocidas++; }
      const c = await this.conciliar(p.empresa_id, p.operacion_id); r.conciliadas++;
      if (c.aplicado === "certificado" || c.aplicado === "rechazado") r.resueltas++;
    }
    const a = await this.auditarFallidas(); r.alertas = a.alertas;
    r.artefactos_completados = await this.completarArtefactos();
    return r;
  }

  /** Respuestas tardías: vuelve a consultar las operaciones dadas por fallidas a mano; un «certificado» genera una alerta bloqueante. Los demás resultados dejan la comprobación posterior exigida para reintentar. */
  async auditarFallidas(): Promise<{ revisadas: number; alertas: number }> {
    const fs = await this.rpc("fel_sys_fallidas_manuales_recientes", {}) as { operacion_id: string; empresa_id: string }[];
    let alertas = 0;
    for (const f of fs) { const c = await this.conciliar(f.empresa_id, f.operacion_id); if (c.aplicado === "alerta") alertas++; }
    return { revisadas: fs.length, alertas };
  }

  /** Caída entre certificar y guardar PDF/XML: se vuelven a pedir al proveedor (solo lectura). */
  async completarArtefactos(): Promise<number> {
    const fs = await this.rpc("fel_sys_artefactos_faltantes", {}) as { operacion_id: string; empresa_id: string; documento_id: string; clave_idempotencia: string; ambiente: string }[];
    let n = 0;
    for (const f of fs) {
      let arts: ArtefactoRef[] = [];
      try { arts = await this.proveedor.obtenerArtefactos({ empresaId: f.empresa_id, documentoId: f.documento_id, operacionId: f.operacion_id, claveIdempotencia: f.clave_idempotencia, ambiente: (f.ambiente as Contexto["ambiente"]) ?? this.ctx.ambiente }, this.ctx); } catch { continue; }
      n += await this.guardarArtefactos(f.empresa_id, f.operacion_id, arts);
    }
    return n;
  }
}
