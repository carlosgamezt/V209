// Consulta de CUI/DPI por Digifact TEST (SHARED_GETINFOCUI): habilitación INDEPENDIENTE de la consulta de NIT y de la certificación. Un CUI es un dato personal: tiene su propio interruptor.
// Variables del SERVIDOR (nunca del navegador):
//   FEL_DIGIFACT_CUI=habilitado          interruptor propio. NO depende de FEL_DIGIFACT_NIT ni de FEL_DIGIFACT_TEST y NO los habilita.
//   FEL_DIGIFACT_CUI_EMPRESA=<uuid>      la ÚNICA empresa que puede consultar CUI con estas credenciales; las demás usan el simulador (datos ficticios y rotulados)
//   DIGIFACT_TEST_USERNAME / _PASSWORD / _NIT   credenciales de TEST (secretos del entorno, compartidos con los otros interruptores)
// Lo que se construye es un cliente de Digifact TEST (ambiente fijo «test») del que SOLO se expone «consultar»: ni certificar, ni anular, ni consultar NIT, ni descargar.
// Falla cerrado: cualquier variable ausente o incoherente lo deja deshabilitado y lo explica SIN mostrar valores.
import { crearDigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { Entorno } from "./digifact_nit_entorno.ts";

export interface ResultadoConsultorCui { encontrado: boolean; nombre?: string }
/** Lo ÚNICO que el resto del sistema ve de Digifact para consultar un CUI. No tiene certificar, anular, consultar NIT ni ninguna otra operación. */
export interface ConsultorCui { readonly empresaId: string; consultar(cui: string): Promise<ResultadoConsultorCui> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Espera máxima de una consulta de CUI: corta, para que la persona pueda escribir el nombre a mano. */
export const TIEMPO_MAXIMO_CUI_MS = 8_000;

export function crearConsultorCuiDesdeEntorno(env: Entorno, o: { fetchImpl?: typeof fetch; tiempoMaximoMs?: number } = {}): { consultor?: ConsultorCui; motivo: string } {
  if (env("FEL_DIGIFACT_CUI") !== "habilitado") return { motivo: "La consulta de CUI por Digifact TEST no está habilitada (FEL_DIGIFACT_CUI)." };
  const empresa = (env("FEL_DIGIFACT_CUI_EMPRESA") ?? "").toLowerCase(); if (!UUID.test(empresa)) return { motivo: "Falta FEL_DIGIFACT_CUI_EMPRESA (UUID de la única empresa que consulta CUI con las credenciales de TEST)." };
  const usuario = env("DIGIFACT_TEST_USERNAME"), nit = env("DIGIFACT_TEST_NIT"), clave = env("DIGIFACT_TEST_PASSWORD");
  if (!usuario || !clave || !nit) return { motivo: "Faltan las credenciales de Digifact TEST (usuario, contraseña o NIT)." };
  let cliente; try { cliente = crearDigifactGt({ ambiente: "test", nit, usuario, obtenerClave: () => clave, fetchImpl: o.fetchImpl, tiempoMaximoMs: o.tiempoMaximoMs ?? TIEMPO_MAXIMO_CUI_MS }); }
  catch { return { motivo: "No se pudo crear el cliente de Digifact TEST (revisa el usuario y el NIT)." }; }   // sin el mensaje original: podría citar valores
  const consultor: ConsultorCui = Object.freeze({ empresaId: empresa, consultar: async (c: string) => { const r = await cliente.consultarCui(c); return r.encontrado ? { encontrado: true, nombre: r.nombre } : { encontrado: false }; } });
  return { consultor, motivo: "Consulta de CUI por Digifact TEST habilitada para una empresa (la certificación y la consulta de NIT no se habilitan)" };
}
