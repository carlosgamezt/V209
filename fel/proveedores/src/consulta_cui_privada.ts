// «consultar-cui-privado»: UNA consulta real de CUI al ambiente TEST de Digifact (SHARED_GETINFOCUI), pensada para una primera prueba que NO deje datos personales en ningún registro.
// Mismas garantías que «consultar-nit-privado», y además:
//  · El CUI de la prueba NO se escribe en la ejecución: viene de un secreto del entorno (DIGIFACT_CUI_PRUEBA), así que ni las entradas ni el registro lo muestran.
//  · La forma de la respuesta de Digifact no está en su documentación pública: la salida incluye los NOMBRES de los campos (nunca sus valores) para reconocerla sin exponer a nadie.
//  · Una sola llamada de inicio de sesión y UNA sola consulta GET /Shared; se bloquea cualquier otra cosa, incluida la repetición del cliente tras un 401.
//  · Salida solo con banderas, contadores y nombres de campos. Nunca el CUI, el nombre, el usuario, la contraseña, el token ni texto del proveedor.
import { crearDigifactGt, ErrorDigifact } from "./digifact_gt.ts";
import { presenciaCredenciales, type EntornoNit, type PresenciaCredenciales } from "./consulta_nit_privada.ts";

export const CONFIRMACION_CUI_PRIVADO = "CONSULTAR-CUI-TEST";
export type MotivoNoEjecutadaCui = "faltan_credenciales" | "falta_cui_de_prueba" | "falta_confirmacion" | "no_usar_entrada_manual" | "cui_de_prueba_no_valido";
export interface ResultadoConsultaCuiPrivada {
  prueba: "consultar-cui-privado"; ambiente: "TEST"; credenciales: PresenciaCredenciales; cuiPrueba: boolean;
  ok: boolean; consulta: "encontrado" | "no_encontrado" | "error" | "no_ejecutada";
  coincide: boolean | null; nombrePresente: boolean | null; camposRespuesta: string[];
  llamadas: { inicioSesion: number; consulta: number }; reintentoBloqueado: boolean;
  motivo?: MotivoNoEjecutadaCui; errorTipo?: string; estadoHttp?: number | null;
}
export const presenciaCuiPrueba = (env: EntornoNit): boolean => !!(env("DIGIFACT_CUI_PRUEBA") ?? "").trim();

export async function consultaCuiPrivada(env: EntornoNit, o: { fetchImpl?: typeof fetch; tiempoMaximoMs?: number } = {}): Promise<ResultadoConsultaCuiPrivada> {
  const credenciales = presenciaCredenciales(env), cuiPrueba = presenciaCuiPrueba(env), llamadas = { inicioSesion: 0, consulta: 0 };
  let bloqueado = false;
  const base = (motivo: MotivoNoEjecutadaCui): ResultadoConsultaCuiPrivada => ({ prueba: "consultar-cui-privado", ambiente: "TEST", credenciales, cuiPrueba, ok: false, consulta: "no_ejecutada", coincide: null, nombrePresente: null, camposRespuesta: [], llamadas, reintentoBloqueado: false, motivo });
  if (!credenciales.usuario || !credenciales.clave || !credenciales.nit) return base("faltan_credenciales");
  if (!cuiPrueba) return base("falta_cui_de_prueba");
  if (env("DIGIFACT_CONFIRMAR") !== CONFIRMACION_CUI_PRIVADO) return base("falta_confirmacion");
  if ((env("DIGIFACT_NIT_CONSULTA") ?? "").trim() !== "") return base("no_usar_entrada_manual");   // nada de datos personales escritos en las entradas de la ejecución
  const nit = env("DIGIFACT_TEST_NIT")!.trim(), cui = String(env("DIGIFACT_CUI_PRUEBA")).replace(/[\s-]+/g, "");
  if (!/^\d{1,12}$/.test(nit) || !/^\d{13}$/.test(cui)) return base("cui_de_prueba_no_valido");
  const real = o.fetchImpl ?? fetch;
  const permitido = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/login/get_token")) { if (++llamadas.inicioSesion > 1) { bloqueado = true; throw new Error("bloqueado"); } }
    else if (u.includes("/Shared?")) { if (++llamadas.consulta > 1) { bloqueado = true; throw new Error("bloqueado"); } }
    else { bloqueado = true; throw new Error("bloqueado"); }
    return await real(url, init);
  }) as typeof fetch;
  try {
    const c = crearDigifactGt({ ambiente: "test", nit, usuario: env("DIGIFACT_TEST_USERNAME")!, obtenerClave: () => env("DIGIFACT_TEST_PASSWORD")!, esquemaAutorizacion: "raw", fetchImpl: permitido, tiempoMaximoMs: o.tiempoMaximoMs ?? 15_000 });
    const r = await c.consultarCui(cui);
    if (!r.encontrado) return { prueba: "consultar-cui-privado", ambiente: "TEST", credenciales, cuiPrueba, ok: true, consulta: "no_encontrado", coincide: null, nombrePresente: null, camposRespuesta: r.campos, llamadas, reintentoBloqueado: bloqueado };
    return { prueba: "consultar-cui-privado", ambiente: "TEST", credenciales, cuiPrueba, ok: true, consulta: "encontrado", coincide: r.coincide, nombrePresente: !!r.nombre, camposRespuesta: r.campos, llamadas, reintentoBloqueado: bloqueado };
  } catch (e) {
    return { prueba: "consultar-cui-privado", ambiente: "TEST", credenciales, cuiPrueba, ok: false, consulta: "error", coincide: null, nombrePresente: null, camposRespuesta: [], llamadas, reintentoBloqueado: bloqueado,
      errorTipo: e instanceof ErrorDigifact ? e.tipo : "inesperado", estadoHttp: e instanceof ErrorDigifact ? (e.estadoHttp ?? null) : null };
  }
}
