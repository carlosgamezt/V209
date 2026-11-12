// Enruta la CONCILIACIÓN y la recuperación de artefactos al proveedor que realizó cada operación.
// El orquestador de recuperación trabaja sobre todas las operaciones pendientes de la plataforma, que pueden ser de proveedores distintos:
// consultar a un proveedor por una operación de otro sería una respuesta inventada («no existe»). Aquí cada operación se consulta SOLO a su proveedor;
// si no se sabe cuál es, el resultado es «indeterminado» (nunca «no existe»). El envío NO se enruta: cada canal se envía con su propio orquestador.
import type { ArtefactoRef, CapacidadesProveedor, Contexto, DocumentoCongelado, EmissionProvider, OperacionRef, ResultadoConciliacion, ResultadoEnvio, ResultadoValidacion, SolicitudCertificacion } from "./tipos.ts";
import type { Rpc } from "./rpc.ts";

export class ProveedorEnrutado implements EmissionProvider {
  constructor(private rpc: Rpc, private mapa: Record<string, EmissionProvider>, private porDefecto: EmissionProvider) {}
  get capacidades(): CapacidadesProveedor { return this.porDefecto.capacidades; }
  private async de(op: OperacionRef): Promise<EmissionProvider | null> {
    try {
      const o = await this.rpc("fel_sys_operacion", { p_empresa: op.empresaId, p_op: op.operacionId }) as { proveedor?: string | null } | null;
      if (o?.proveedor && this.mapa[o.proveedor]) return this.mapa[o.proveedor];
      return o?.proveedor ? null : this.porDefecto;   // proveedor desconocido: no se adivina
    } catch { return null; }
  }
  validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion> { return this.porDefecto.validar(doc, ctx); }
  enviar(_sol: SolicitudCertificacion, _ctx: Contexto): Promise<ResultadoEnvio> { return Promise.reject(new Error("el proveedor enrutado no envía: cada canal se envía con su propio orquestador")); }
  async conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion> {
    const p = await this.de(op); if (!p) return { tipo: "indeterminado", motivo: "no se pudo determinar el proveedor de la operación" };
    return await p.conciliar(op, ctx);
  }
  async obtenerArtefactos(op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]> { const p = await this.de(op); return p ? await p.obtenerArtefactos(op, ctx) : []; }
  salud(ctx: Contexto) { return this.porDefecto.salud(ctx); }
}
