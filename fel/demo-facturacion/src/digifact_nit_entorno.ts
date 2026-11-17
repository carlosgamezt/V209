// Consulta de NIT por Digifact TEST: habilitación INDEPENDIENTE de la certificación.
// Variables del SERVIDOR (nunca del navegador):
//   FEL_DIGIFACT_NIT=habilitado          interruptor propio. NO depende de FEL_DIGIFACT_TEST y NO lo habilita.
//   FEL_DIGIFACT_NIT_EMPRESA=<uuid>      la ÚNICA empresa que puede consultar con estas credenciales; las demás usan el simulador
//   DIGIFACT_TEST_USERNAME / _PASSWORD / _NIT   credenciales de TEST (secretos del entorno)
// Lo que se construye es un cliente de Digifact TEST (ambiente fijo «test») del que SOLO se expone «consultar»: ni certificar, ni anular, ni notas de crédito, ni descargar.
// Falla cerrado: cualquier variable ausente o incoherente lo deja deshabilitado y lo explica SIN mostrar valores.
import { crearDigifactGt } from "../../proveedores/src/digifact_gt.ts";

export interface ResultadoConsultorNit { encontrado: boolean; nit?: string; nombre?: string }
/** Lo ÚNICO que el resto del sistema ve de Digifact para consultar NIT. No tiene certificar, anular ni ninguna otra operación. */
export interface ConsultorNit { readonly empresaId: string; consultar(nit: string): Promise<ResultadoConsultorNit> }
export type Entorno = (k: string) => string | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Espera máxima de una consulta de NIT: corta, para que la persona pueda escribir el nombre a mano sin esperar medio minuto. */
export const TIEMPO_MAXIMO_NIT_MS = 8_000;

export function crearConsultorNitDesdeEntorno(env: Entorno, o: { fetchImpl?: typeof fetch; tiempoMaximoMs?: number } = {}): { consultor?: ConsultorNit; motivo: string } {
  if (env("FEL_DIGIFACT_NIT") !== "habilitado") return { motivo: "La consulta de NIT por Digifact TEST no está habilitada (FEL_DIGIFACT_NIT)." };
  const empresa = (env("FEL_DIGIFACT_NIT_EMPRESA") ?? "").toLowerCase(); if (!UUID.test(empresa)) return { motivo: "Falta FEL_DIGIFACT_NIT_EMPRESA (UUID de la única empresa que consulta con las credenciales de TEST)." };
  const usuario = env("DIGIFACT_TEST_USERNAME"), nit = env("DIGIFACT_TEST_NIT"), clave = env("DIGIFACT_TEST_PASSWORD");
  if (!usuario || !clave || !nit) return { motivo: "Faltan las credenciales de Digifact TEST (usuario, contraseña o NIT)." };
  let cliente; try { cliente = crearDigifactGt({ ambiente: "test", nit, usuario, obtenerClave: () => clave, fetchImpl: o.fetchImpl, tiempoMaximoMs: o.tiempoMaximoMs ?? TIEMPO_MAXIMO_NIT_MS }); }
  catch { return { motivo: "No se pudo crear el cliente de Digifact TEST (revisa el usuario y el NIT)." }; }   // sin el mensaje original: podría citar valores
  const consultor: ConsultorNit = Object.freeze({ empresaId: empresa, consultar: async (n: string) => { const r = await cliente.consultarNit(n); return r.encontrado ? { encontrado: true, nit: r.nit, nombre: r.nombre } : { encontrado: false }; } });
  return { consultor, motivo: "Consulta de NIT por Digifact TEST habilitada para una empresa (la certificación no se habilita)" };
}
