// «Certificador B» SIMULADO: un segundo certificador de demostración que prueba la arquitectura multiproveedor. NO es un certificador autorizado y no existe integración real.
// Implementa el mismo contrato (EmissionProvider + ProveedorAnulacion) con otra «API» (in-memory); añadirlo no requirió cambios en el orquestador ni en las pantallas.
import { MockProvider, type Escenario } from "./mock.ts";
import type { Persistible } from "./persistible.ts";
import type { LineaConsumoProveedor, ProveedorAnulacion, ResultadoAnulacion, ResultadoConciliacionAnulacion, SolicitudAnulacion } from "./digifact.ts";
import type { CapacidadesProveedor, Contexto, DocumentoCongelado, OperacionRef, ResultadoConciliacion, ResultadoEnvio, ResultadoValidacion, SolicitudCertificacion } from "./tipos.ts";

export type EscenarioAnulacionB = "exito" | "rechazo" | "timeout_antes" | "timeout_despues";
export class CertificadorBSimulado implements ProveedorAnulacion, Persistible {
  readonly capacidades: CapacidadesProveedor;
  private base = new MockProvider({ prefijoSerie: "SIMB", idempotenciaNativa: true });
  private anuladas = new Map<string, string>();                 // autorización → fecha
  private escAnul: Record<string, EscenarioAnulacionB> = {};
  private porClaveAnulacion = new Map<string, string>();        // clave de la anulación → autorización
  private ajenos: LineaConsumoProveedor[] = [];
  private omitidos = new Set<string>();
  saldo: number;
  constructor(saldoInicial = 5000) { this.saldo = saldoInicial; this.capacidades = { ...this.base.capacidades, id: "certificador_b" as never, soportaAnulacion: true }; }   // ProveedorId (tipos.ts, protegido) no lista el id nuevo: el registro y la base son la fuente de verdad
  get certificaciones() { return this.base.servidor.length; }
  base_certificacionesDe(documentoId: string) { return this.base.certificacionesDe(documentoId); }
  get llamadas() { return this.base.llamadasEnviar.length; }
  exportar() { return { base: this.base.exportar(), anuladas: this.anuladas, escAnul: this.escAnul, porClaveAnulacion: this.porClaveAnulacion, ajenos: this.ajenos, omitidos: this.omitidos, saldo: this.saldo }; }
  // deno-lint-ignore no-explicit-any
  importar(x: any) { this.base.importar(x.base ?? {}); this.anuladas = x.anuladas ?? new Map(); this.escAnul = x.escAnul ?? {}; this.porClaveAnulacion = x.porClaveAnulacion ?? new Map(); this.ajenos = x.ajenos ?? []; this.omitidos = x.omitidos ?? new Set(); this.saldo = x.saldo ?? this.saldo; }
  fijarEscenario(doc: string, e: Escenario) { this.base.fijarEscenario(doc, e); }
  escenarioDe(doc: string) { return this.base.escenarioDeDocumento(doc); }
  fijarEscenarioAnulacion(doc: string, e: EscenarioAnulacionB) { this.escAnul[doc] = e; }
  inyectarConsumoAjeno(ref: string) { this.ajenos.push({ referencia: ref, evento: "AJENO", unidades: "1.000000", fecha: new Date().toISOString() }); this.saldo -= 1; }
  omitirUltimoConsumo(): boolean { const u = [...this.base.servidor].reverse().find((c) => !this.omitidos.has(c.autorizacion)); if (!u) return false; this.omitidos.add(u.autorizacion); return true; }

  validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion> { return this.base.validar(doc, ctx); }
  async enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio> { const antes = this.base.servidor.length; const r = await this.base.enviar(sol, ctx); this.saldo -= this.base.servidor.length - antes; return r; }
  conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion> { return this.base.conciliar(op, ctx); }
  obtenerArtefactos(op: OperacionRef, ctx: Contexto) { return this.base.obtenerArtefactos(op, ctx); }
  salud(ctx: Contexto) { return this.base.salud(ctx); }

  private exigirSimulado(ctx: Contexto) { if (ctx.ambiente !== "simulado") throw new Error("Certificador B solo opera en el ambiente simulado"); }
  async anular(sol: SolicitudAnulacion, ctx: Contexto): Promise<ResultadoAnulacion> {
    this.exigirSimulado(ctx);
    const cert = this.base.servidor.find((c) => c.referencia === sol.referenciaCertificacion);
    if (!cert) return { tipo: "rechazado_confirmado", codigo: "NO_EXISTE_DTE", mensaje: "No existe el documento a anular" };
    const e = this.escAnul[sol.documentoId] ?? "exito";
    const aplicar = () => { if (!this.anuladas.has(cert.autorizacion)) { this.anuladas.set(cert.autorizacion, ctx.ahora().toISOString()); this.saldo -= 1; } this.porClaveAnulacion.set(sol.claveIdempotencia, cert.autorizacion); };
    switch (e) {
      case "exito": aplicar(); return { tipo: "anulado", fechaAnulacion: this.anuladas.get(cert.autorizacion)! };
      case "rechazo": return { tipo: "rechazado_confirmado", codigo: "ANULACION_NO_PERMITIDA", mensaje: "Anulación rechazada por el certificador simulado" };
      case "timeout_antes": return { tipo: "desconocido", motivo: "timeout" };
      case "timeout_despues": aplicar(); return { tipo: "desconocido", motivo: "timeout" };
    }
  }
  async conciliarAnulacion(ref: SolicitudAnulacion | OperacionRef, ctx: Contexto): Promise<ResultadoConciliacionAnulacion> {
    this.exigirSimulado(ctx); const aut = this.porClaveAnulacion.get(ref.claveIdempotencia); const f = aut ? this.anuladas.get(aut) : undefined;
    return f ? { tipo: "anulado", fechaAnulacion: f } : { tipo: "no_anulado_confirmado" };
  }
  async obtenerConsumos(_desde: string, _hasta: string, ctx: Contexto): Promise<LineaConsumoProveedor[]> {
    this.exigirSimulado(ctx);
    const certs = this.base.servidor.filter((c) => !this.omitidos.has(c.autorizacion)).map((c) => ({ referencia: c.autorizacion, evento: "CERTIFICACION", unidades: "1.000000", fecha: c.fechaCertificacion }));
    const anul = [...this.anuladas].map(([aut, fecha]) => ({ referencia: `${aut}:ANULACION`, evento: "ANULACION", unidades: "1.000000", fecha }));
    return [...certs, ...anul, ...this.ajenos];
  }
}
