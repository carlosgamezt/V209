// Adaptador portal_playwright: suite de contrato para adaptadores asistidos con un doble en memoria de la cola de órdenes (sin base de datos, sin red).
import { ErrorBd } from "../src/rpc.ts";
import { PortalPlaywrightProvider, type EstadoOrden, type OrdenConsultada, type PuertoOrdenes } from "../src/portal_playwright.ts";
import { ejecutarSuiteContratoAsistido } from "./suite_contrato.ts";

function puertoMemoria() {
  const ordenes = new Map<string, OrdenConsultada>();
  const puerto: PuertoOrdenes = {
    crearOrden: (_e, op) => { if (ordenes.has(op)) return Promise.reject(new ErrorBd("FEL_ORDEN_DUPLICADA: ya existe una orden para esta operación")); const id = `ord-${ordenes.size + 1}`; ordenes.set(op, { id, estado: "pendiente" }); return Promise.resolve(id); },
    consultarOrden: (_e, op) => Promise.resolve(ordenes.get(op) ?? null),
  };
  return { puerto, ordenes };
}
ejecutarSuiteContratoAsistido("portal_playwright (doble en memoria)", () => {
  const { puerto, ordenes } = puertoMemoria();
  return { proveedor: new PortalPlaywrightProvider(puerto), ordenesCreadas: () => ordenes.size,
    fijarOrden: (op, estado, datos) => { const o = ordenes.get(op)!; ordenes.set(op, { id: o.id, estado: estado as EstadoOrden, ...(datos ?? { serie: null, numero: null, autorizacion: null }) }); } };
});
