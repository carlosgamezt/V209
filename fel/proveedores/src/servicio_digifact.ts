// Servicio de orquestación de Digifact SIMULADO: certificación con cobertura (bolsón + monedero) y anulación simulada.
// No modifica orquestador_db.ts ni tipos.ts: envuelve al proveedor (decorador) y usa funciones SQL fel_sys_*.
// Todo es simulado: el adaptador se niega a operar fuera del ambiente «simulado» y la base lo exige con barreras propias.
import { OrquestadorDb, type ResultadoSolicitudDb } from "./orquestador_db.ts";
import { ErrorBd, type Rpc } from "./rpc.ts";
import type { Contexto, EmissionProvider, ResultadoEnvio, SolicitudCertificacion } from "./tipos.ts";
import type { ProveedorAnulacion } from "./digifact.ts";

async function sha256Hex(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Reserva la cobertura ANTES de llamar al proveedor. Si no hay plan, saldo o cupo, NO se envía nada: es un rechazo propio y confirmado (nada salió de NEXA). */
class ProveedorConCobertura implements EmissionProvider {
  constructor(private base: ProveedorAnulacion, private rpc: Rpc, private cuenta: string) {}
  get capacidades() { return this.base.capacidades; }
  validar(doc: Parameters<EmissionProvider["validar"]>[0], ctx: Contexto) { return this.base.validar(doc, ctx); }
  conciliar(op: Parameters<EmissionProvider["conciliar"]>[0], ctx: Contexto) { return this.base.conciliar(op, ctx); }
  obtenerArtefactos(op: Parameters<EmissionProvider["obtenerArtefactos"]>[0], ctx: Contexto) { return this.base.obtenerArtefactos(op, ctx); }
  salud(ctx: Contexto) { return this.base.salud(ctx); }
  async enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio> {
    try {
      await this.rpc("fel_sys_cobertura_reservar", { p_empresa: sol.empresaId, p_cuenta: this.cuenta, p_evento: "certificacion", p_operacion: sol.operacionId, p_documento: sol.documentoId,
        p_clave: `cobertura-${sol.operacionId}`, p_hash: sol.hashContenido });
    } catch (e) {
      const codigo = e instanceof ErrorBd ? e.codigo : "BD";
      return { tipo: "rechazado_confirmado", codigo: `COBERTURA_${codigo}`.slice(0, 60), mensaje: e instanceof Error ? e.message.replace(/^FEL_[A-Z_]+:\s*/, "") : "No se pudo reservar la cobertura. No se envió nada al proveedor." };
    }
    return await this.base.enviar(sol, ctx);
  }
}

export interface ResultadoAnulacionDb { operacion: Record<string, unknown>; estado: string; reutilizada: boolean }

export class ServicioDigifact {
  constructor(private rpc: Rpc, private proveedor: ProveedorAnulacion, private ctx: Contexto = { ambiente: "simulado", ahora: () => new Date() }) {}

  private async cuenta(): Promise<string> {
    const c = await this.rpc("fel_sys_bolson_cuenta_simulada", { p_proveedor: "digifact" }) as string | null;
    if (!c) throw new ErrorBd("FEL_REGLA: no hay una cuenta del bolsón simulada para Digifact");
    return c;
  }

  /** Certificación con cobertura. Devuelve el resultado del orquestador; la cobertura queda cerrada según el resultado confirmado (o retenida si es desconocido). */
  async certificar(p: { actor: string; empresa: string; documento: string; clave: string; canal: string }): Promise<ResultadoSolicitudDb> {
    const prov = new ProveedorConCobertura(this.proveedor, this.rpc, await this.cuenta());
    const r = await new OrquestadorDb(this.rpc, prov, { ambiente: "simulado", ahora: this.ctx.ahora }).solicitar(p);
    await this.cerrarCobertura(p.empresa, r.operacion.id);
    return r;
  }

  /** Aplica el resultado confirmado de una operación a su consumo y cargo. Seguro de repetir; no hace nada mientras la operación esté abierta. */
  async cerrarCobertura(empresa: string, operacion: string): Promise<unknown> {
    return await this.rpc("fel_sys_cobertura_cerrar", { p_empresa: empresa, p_op: operacion });
  }

  /** Anulación SIMULADA de un documento certificado en simulación. No inventa el plazo normativo (V12 sigue bloqueado). */
  async anular(p: { actor: string; empresa: string; documento: string; clave: string; motivo: string; canal: string; certificacion: { clave: string; autorizacion: string } }): Promise<ResultadoAnulacionDb> {
    const hash = await sha256Hex(`anulacion|${p.documento}|${p.motivo.trim()}`);
    const op = await this.rpc("fel_op_anulacion_simulada_iniciar", { p_actor: p.actor, p_empresa: p.empresa, p_doc: p.documento, p_clave: p.clave, p_hash: hash, p_motivo: p.motivo, p_canal: p.canal }) as Record<string, unknown>;
    if (op.estado !== "iniciada") return { operacion: op, estado: String(op.estado), reutilizada: true };
    const id = String(op.id);
    try {
      await this.rpc("fel_sys_cobertura_reservar", { p_empresa: p.empresa, p_cuenta: await this.cuenta(), p_evento: "anulacion", p_operacion: id, p_documento: p.documento, p_clave: `cobertura-${id}`, p_hash: hash });
    } catch (e) {   // nada salió hacia el proveedor: la anulación termina rechazada y el documento sigue certificado
      await this.rpc("fel_sys_anulacion_cerrar", { p_empresa: p.empresa, p_op: id, p_exitosa: false, p_evidencia: { origen: "nexa", motivo: "sin cobertura", detalle: e instanceof Error ? e.message.slice(0, 200) : "error" } });
      return { operacion: await this.operacion(p.empresa, id), estado: "confirmada_fallida", reutilizada: false };
    }
    await this.aplicar(p.empresa, id, await this.proveedor.anular(
      { empresaId: p.empresa, documentoId: p.documento, operacionId: id, claveIdempotencia: p.clave, referenciaCertificacion: p.certificacion.clave, autorizacion: p.certificacion.autorizacion, motivo: p.motivo.trim(), ambiente: "simulado" }, this.ctx)
      .catch(() => ({ tipo: "desconocido" as const, motivo: "excepcion_del_adaptador" as const })));
    await this.cerrarCobertura(p.empresa, id);
    const fin = await this.operacion(p.empresa, id);
    return { operacion: fin, estado: String(fin.estado), reutilizada: false };
  }

  /** Consulta a Digifact (simulado) el resultado de una anulación desconocida y la cierra solo si el proveedor lo garantiza. */
  async conciliarAnulacion(p: { empresa: string; operacion: string; documento: string; clave: string; certificacion: { clave: string; autorizacion: string }; motivo: string }): Promise<{ resultado: string; estado: string }> {
    const op = await this.operacion(p.empresa, p.operacion);
    if (op.estado !== "desconocida") return { resultado: "sin_cambios", estado: String(op.estado) };
    const r = await this.proveedor.conciliarAnulacion({ empresaId: p.empresa, documentoId: p.documento, operacionId: p.operacion, claveIdempotencia: p.clave, referenciaCertificacion: p.certificacion.clave, autorizacion: p.certificacion.autorizacion, motivo: p.motivo, ambiente: "simulado" }, this.ctx);
    if (r.tipo === "anulado") await this.rpc("fel_sys_anulacion_cerrar", { p_empresa: p.empresa, p_op: p.operacion, p_exitosa: true, p_evidencia: { fuente: "digifact_simulado", fecha_anulacion: r.fechaAnulacion, conciliacion: true } });
    else if (r.tipo === "no_anulado_confirmado") await this.rpc("fel_sys_anulacion_cerrar", { p_empresa: p.empresa, p_op: p.operacion, p_exitosa: false, p_evidencia: { fuente: "digifact_simulado", conciliacion: true, resultado: "no_anulado" } });
    await this.cerrarCobertura(p.empresa, p.operacion);
    return { resultado: r.tipo, estado: String((await this.operacion(p.empresa, p.operacion)).estado) };
  }

  private async aplicar(empresa: string, id: string, r: Awaited<ReturnType<ProveedorAnulacion["anular"]>>): Promise<void> {
    if (r.tipo === "anulado") await this.rpc("fel_sys_anulacion_cerrar", { p_empresa: empresa, p_op: id, p_exitosa: true, p_evidencia: { fuente: "digifact_simulado", fecha_anulacion: r.fechaAnulacion } });
    else if (r.tipo === "rechazado_confirmado") await this.rpc("fel_sys_anulacion_cerrar", { p_empresa: empresa, p_op: id, p_exitosa: false, p_evidencia: { fuente: "digifact_simulado", codigo: r.codigo.slice(0, 60) } });
    else await this.rpc("fel_sys_anulacion_desconocida", { p_empresa: empresa, p_op: id, p_motivo: r.motivo });
  }
  private async operacion(empresa: string, id: string) { return await this.rpc("fel_sys_operacion", { p_empresa: empresa, p_op: id }) as Record<string, unknown>; }
}
