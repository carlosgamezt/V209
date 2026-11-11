// Adaptador «portal_playwright» (canal asistido con AGENTE LOCAL). Cumple el contrato EmissionProvider sin red ni credenciales:
// «enviar» NO emite nada; crea una ORDEN para el agente y devuelve «requiere_accion_humana» (D3: la emisión final la confirma una persona).
// SOLO ambiente simulado (separación estricta: cualquier otro ambiente se rechaza con NO_SOPORTADO antes de crear nada).
// Diseño: fel/docs/agente-arquitectura.md y agente-protocolo.md.
import { ErrorProveedor } from "./tipos.ts";
import type { ArtefactoRef, CapacidadesProveedor, Contexto, DocumentoCongelado, EmissionProvider, OperacionRef, ResultadoConciliacion, ResultadoEnvio, ResultadoValidacion, SolicitudCertificacion } from "./tipos.ts";
import { validarDocumento } from "./validacion.ts";
import type { Rpc } from "./rpc.ts";

export type EstadoOrden = "pendiente" | "reclamada" | "llenada" | "completada" | "descartada" | "fallida" | "incierta" | "cancelada";
export interface OrdenConsultada { id: string; estado: EstadoOrden; serie?: string | null; numero?: string | null; autorizacion?: string | null }

/** Puerto hacia la cola de órdenes (la base de datos en producción local; un doble en memoria en las pruebas de contrato). */
export interface PuertoOrdenes {
  crearOrden(empresaId: string, operacionId: string): Promise<string>;
  consultarOrden(empresaId: string, operacionId: string): Promise<OrdenConsultada | null>;
}
export function puertoOrdenesRpc(rpc: Rpc): PuertoOrdenes {
  return {
    crearOrden: async (empresaId, operacionId) => String(await rpc("fel_sys_orden_crear", { p_empresa: empresaId, p_op: operacionId })),
    consultarOrden: async (empresaId, operacionId) => (await rpc("fel_sys_orden_por_operacion", { p_empresa: empresaId, p_op: operacionId })) as OrdenConsultada | null,
  };
}

const INSTRUCCION = "Abre el agente local de NEXA en el equipo de la empresa: llenará el formulario del simulador y se detendrá en la vista previa para que confirmes tú. NEXA no confirma nada por ti.";

export class PortalPlaywrightProvider implements EmissionProvider {
  readonly capacidades: CapacidadesProveedor = {
    id: "portal_playwright", ambientes: ["simulado"], tiposDte: ["SIM"],
    emiteSinHumano: false,            // la persona confirma dentro del simulador
    idempotenciaNativa: false,        // la protección está de nuestro lado (clave, orden única, token, libro local)
    consultaPorReferencia: true,      // se consulta el estado de NUESTRA orden
    entregaXml: false, entregaPdf: false, soportaAnulacion: false, soportaNotaCredito: false,
    tiempoMaximoMs: 15000,
  };
  constructor(private puerto: PuertoOrdenes) {}

  private exigirSimulado(ctx: Contexto, ambiente: string = ctx.ambiente) {
    if (ctx.ambiente !== "simulado" || ambiente !== "simulado") throw new ErrorProveedor("NO_SOPORTADO", "el canal con agente local solo existe en el ambiente simulado");
  }

  async validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion> { this.exigirSimulado(ctx); return validarDocumento(doc); }

  async enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio> {
    this.exigirSimulado(ctx, sol.ambiente);
    const ordenId = await this.puerto.crearOrden(sol.empresaId, sol.operacionId);   // una orden por operación: la base rechaza duplicados
    return { tipo: "requiere_accion_humana", instruccion: INSTRUCCION, ordenId };
  }

  /** Solo lectura. Lo que la orden prueba: completada ⇒ certificado simulado; sin orden / descartada / fallida / cancelada ⇒ no existe; todo lo demás ⇒ indeterminado. */
  async conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion> {
    this.exigirSimulado(ctx, op.ambiente);
    const o = await this.puerto.consultarOrden(op.empresaId, op.operacionId);
    if (!o) return { tipo: "no_existe_confirmado" };                       // nunca se creó una orden: nada pudo presentarse
    switch (o.estado) {
      case "completada":
        if (!o.serie || !o.numero || !o.autorizacion) return { tipo: "indeterminado", motivo: "orden completada sin datos fiscales" };
        return { tipo: "certificado", serie: o.serie, numero: o.numero, autorizacion: o.autorizacion, fechaCertificacion: ctx.ahora().toISOString().slice(0, 10), artefactos: [] };
      case "descartada": case "fallida": case "cancelada": return { tipo: "no_existe_confirmado" };
      case "incierta": return { tipo: "indeterminado", motivo: "orden_incierta" };
      default: return { tipo: "indeterminado", motivo: "orden_en_curso" };
    }
  }

  async obtenerArtefactos(_op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]> { this.exigirSimulado(ctx); return []; }
  async salud(ctx: Contexto): Promise<{ ok: boolean; detalle: string }> { this.exigirSimulado(ctx); return { ok: true, detalle: "adaptador listo (no consulta al agente)" }; }
}
