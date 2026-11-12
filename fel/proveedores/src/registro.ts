// Registro de certificadores: lo ÚNICO que una pantalla, la API o el orquestador necesitan saber de un certificador. Añadir uno = implementar el contrato,
// describirlo aquí (nombre, escenarios de simulación, controles) y registrarlo; las pantallas se dibujan a partir de esta descripción.
import { DigifactProvider, type ProveedorAnulacion } from "./digifact.ts";
import { DigifactSimulador } from "./digifact_simulador.ts";
import { CertificadorBSimulado } from "./certificador_b.ts";
import { ServicioCertificador } from "./servicio_digifact.ts";
import type { Rpc } from "./rpc.ts";

export interface Escenario { id: string; nombre: string; explicacion?: string }
/** Controles de la SIMULACIÓN de un certificador (no existen en un certificador real). */
export interface Simulacion {
  fijarEscenario(documentoId: string, id: string): void; fijarEscenarioAnulacion(documentoId: string, id: string): void; escenarioDe(documentoId: string): string | null;
  saldoReportado(): number; sumarSaldo(unidades: number): void; certificaciones(): number; llamadas(): number;
  consumoAjeno(): void; omitirUltimoConsumo(): boolean;
}
export interface DescriptorCertificador { id: string; nombre: string; simulado: true; soportaAnulacion: boolean; escenarios: Escenario[]; escenariosAnulacion: Escenario[]; proveedor: ProveedorAnulacion; simulacion: Simulacion; servicio: ServicioCertificador }

export const ESCENARIOS_ENVIO: Escenario[] = [
  { id: "exito", nombre: "Éxito", explicacion: "El certificador (simulado) certifica y responde bien." },
  { id: "rechazo", nombre: "Rechazo confirmado", explicacion: "Garantiza que NO hay documento: se puede corregir. No se cobra al cliente." },
  { id: "timeout_antes", nombre: "Tiempo agotado · no procesó", explicacion: "Sin respuesta y nada se certificó. Queda «por verificar»; la reserva sigue retenida." },
  { id: "timeout_despues", nombre: "Tiempo agotado · sí certificó", explicacion: "Sin respuesta pero certificó. Al conciliar se confirma y se cobra." },
  { id: "corte_despues", nombre: "Conexión cortada tras certificar", explicacion: "La respuesta se perdió aunque certificó." },
  { id: "respuesta_ilegible", nombre: "Respuesta ilegible", explicacion: "Certificó pero la respuesta no se entiende; nunca se toma por éxito." },
  { id: "timeout_indeterminado", nombre: "Sin forma de saberlo", explicacion: "Ni consultando se puede decidir: exige conciliación manual." },
  { id: "caida", nombre: "Servicio caído", explicacion: "No es un rechazo garantizado." },
];
export const ESCENARIOS_ANULACION: Escenario[] = [{ id: "exito", nombre: "Anulación aceptada" }, { id: "rechazo", nombre: "Anulación rechazada" }, { id: "timeout_antes", nombre: "Tiempo agotado · no procesó" }, { id: "timeout_despues", nombre: "Tiempo agotado · sí anuló" }];

export class RegistroCertificadores {
  private m = new Map<string, DescriptorCertificador>();
  registrar(d: DescriptorCertificador) { if (this.m.has(d.id)) throw new Error(`certificador duplicado: ${d.id}`); if (!d.simulado) throw new Error("en esta versión solo se registran certificadores SIMULADOS"); this.m.set(d.id, d); return this; }
  obtener(id: string): DescriptorCertificador | undefined { return this.m.get(id); }
  tiene(id: unknown): id is string { return typeof id === "string" && this.m.has(id); }
  ids(): string[] { return [...this.m.keys()]; }
  listar(): DescriptorCertificador[] { return [...this.m.values()]; }
}

/** Registro de la demostración: Digifact (simulador HTTP local) y Certificador B (simulado en memoria). */
export function registroSimulado(rpc: Rpc): RegistroCertificadores {
  const sim = new DigifactSimulador({ saldoInicial: 5000 }), prov = new DigifactProvider(sim.transporte, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" });
  const b = new CertificadorBSimulado(5000);
  const esc = (x: string[]) => ESCENARIOS_ENVIO.filter((e) => x.includes(e.id));
  return new RegistroCertificadores()
    .registrar({ id: "digifact", nombre: "Digifact (simulado)", simulado: true, soportaAnulacion: true, escenarios: ESCENARIOS_ENVIO, escenariosAnulacion: [...ESCENARIOS_ANULACION, { id: "indeterminado", nombre: "Sin forma de saberlo" }], proveedor: prov, servicio: new ServicioCertificador(rpc, prov, undefined, "digifact"),
      simulacion: { fijarEscenario: (d, i) => sim.fijarEscenario(d, i as never), fijarEscenarioAnulacion: (d, i) => sim.fijarEscenarioAnulacion(d, i as never), escenarioDe: (d) => sim.escenarioDe(d), saldoReportado: () => sim.saldo, sumarSaldo: (n) => { sim.saldo += n; },
        certificaciones: () => sim.certificados.length, llamadas: () => sim.llamadas.length, consumoAjeno: () => sim.inyectarConsumoAjeno(`AJENO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, "1.000000"),
        omitirUltimoConsumo: () => { const u = [...sim.consumos].reverse().find((c) => c.evento === "CERTIFICACION"); if (!u) return false; sim.omitirConsumo(u.referencia); return true; } } })
    .registrar({ id: "certificador_b", nombre: "Certificador B (simulado)", simulado: true, soportaAnulacion: true, escenarios: esc(["exito", "rechazo", "timeout_antes", "timeout_despues", "corte_despues", "respuesta_ilegible", "timeout_indeterminado", "caida"]), escenariosAnulacion: ESCENARIOS_ANULACION.filter((e) => e.id !== "indeterminado"), proveedor: b, servicio: new ServicioCertificador(rpc, b, undefined, "certificador_b"),
      simulacion: { fijarEscenario: (d, i) => b.fijarEscenario(d, i as never), fijarEscenarioAnulacion: (d, i) => b.fijarEscenarioAnulacion(d, i as never), escenarioDe: (d) => b.escenarioDe(d), saldoReportado: () => b.saldo, sumarSaldo: (n) => { b.saldo += n; },
        certificaciones: () => b.certificaciones, llamadas: () => b.llamadas, consumoAjeno: () => b.inyectarConsumoAjeno(`AJENO-B-${crypto.randomUUID().slice(0, 8).toUpperCase()}`), omitirUltimoConsumo: () => b.omitirUltimoConsumo() } });
}
