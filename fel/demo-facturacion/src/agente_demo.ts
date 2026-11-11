// Montaje del PLANO DE CONTROL del agente local en la demostración: manejador HTTP firmado + supervisor periódico de órdenes.
// Todo SIMULADO: el único canal posible es portal_playwright en ambiente «simulado»; no hay conexión con SAT ni con certificadores.
import { OrquestadorDb } from "../../proveedores/src/orquestador_db.ts";
import { PortalPlaywrightProvider, puertoOrdenesRpc } from "../../proveedores/src/portal_playwright.ts";
import { cerrarOrdenes } from "../../proveedores/src/cierre_ordenes.ts";
import { crearPlanoControl } from "../../proveedores/src/plano_control_agente.ts";
import { crearSupervisor } from "../../proveedores/src/supervisor_ordenes.ts";
import type { BdDemo } from "./bd.ts";

export function montarAgente(bd: BdDemo, o: { intervaloMs?: number; silencio?: boolean } = {}) {
  const orq = new OrquestadorDb(bd.rpc, new PortalPlaywrightProvider(puertoOrdenesRpc(bd.rpc)));
  const plano = crearPlanoControl({ rpc: bd.rpc });
  const supervisor = crearSupervisor({ rpc: bd.rpc, cerrar: () => cerrarOrdenes(bd.rpc, orq), intervaloMs: o.intervaloMs,
    registrar: (e) => { if (!o.silencio && e.evento !== "error") console.log(`  Supervisor de órdenes ${e.evento}${e.detalle ? ` (${e.detalle})` : ""}`); } });
  return { plano, supervisor };
}
