// «consultar-nit-privado»: UNA consulta real de NIT al ambiente TEST de Digifact, pensada para una primera prueba que NO deje datos personales en ningún registro.
// Garantías (aplicadas en código, no por costumbre):
//  · Solo se consulta el NIT de la propia cuenta TEST (el de las credenciales). Cualquier otro NIT se rechaza antes de tocar la red.
//  · Una sola llamada de inicio de sesión y UNA sola consulta GET /Shared. Un envoltorio de `fetch` permite exactamente esas dos llamadas y bloquea todo lo demás, incluida la repetición
//    que el cliente haría por sí mismo al recibir un 401 (renovar el token y reenviar): no hay reintentos.
//  · La salida son SOLO banderas y contadores: credenciales presentes (sí/no), encontrado / no encontrado / error, si el NIT devuelto coincide con el consultado y si hubo un nombre.
//    Nunca el NIT, el nombre, el usuario, la contraseña, el token ni el texto que devuelva el proveedor.
//  · Exige la palabra de confirmación; sin ella (o sin credenciales) no se hace ninguna llamada.
//  · Solo consulta: no certifica, no anula, no descarga, y producción está bloqueada en el cliente.
import { crearDigifactGt, ErrorDigifact } from "./digifact_gt.ts";

export const CONFIRMACION_NIT_PRIVADO = "CONSULTAR-NIT-TEST";
export type EntornoNit = (k: string) => string | undefined;
export interface PresenciaCredenciales { usuario: boolean; clave: boolean; nit: boolean }
export type MotivoNoEjecutada = "faltan_credenciales" | "falta_confirmacion" | "solo_nit_de_la_cuenta" | "nit_de_la_cuenta_no_valido";
export interface ResultadoConsultaPrivada {
  prueba: "consultar-nit-privado"; ambiente: "TEST"; credenciales: PresenciaCredenciales;
  /** «ok» es true cuando la consulta se hizo y Digifact respondió (encontrado o no encontrado). */
  ok: boolean; consulta: "encontrado" | "no_encontrado" | "error" | "no_ejecutada";
  coincide: boolean | null; nombrePresente: boolean | null;
  llamadas: { inicioSesion: number; consulta: number }; reintentoBloqueado: boolean;
  motivo?: MotivoNoEjecutada; errorTipo?: string; estadoHttp?: number | null;
}

/** Solo presencia (sí/no): ni valores ni longitudes. */
export function presenciaCredenciales(env: EntornoNit): PresenciaCredenciales {
  return { usuario: !!env("DIGIFACT_TEST_USERNAME"), clave: !!env("DIGIFACT_TEST_PASSWORD"), nit: !!env("DIGIFACT_TEST_NIT") };
}
const normalizarNit = (n: unknown) => String(n ?? "").replace(/[\s-]+/g, "").toUpperCase().replace(/^0+(?=.)/, "");

export async function consultaNitPrivada(env: EntornoNit, o: { fetchImpl?: typeof fetch; tiempoMaximoMs?: number } = {}): Promise<ResultadoConsultaPrivada> {
  const credenciales = presenciaCredenciales(env), llamadas = { inicioSesion: 0, consulta: 0 };
  let bloqueado = false;
  const base = (motivo: MotivoNoEjecutada): ResultadoConsultaPrivada => ({ prueba: "consultar-nit-privado", ambiente: "TEST", credenciales, ok: false, consulta: "no_ejecutada", coincide: null, nombrePresente: null, llamadas, reintentoBloqueado: false, motivo });
  if (!credenciales.usuario || !credenciales.clave || !credenciales.nit) return base("faltan_credenciales");
  if (env("DIGIFACT_CONFIRMAR") !== CONFIRMACION_NIT_PRIVADO) return base("falta_confirmacion");
  if ((env("DIGIFACT_NIT_CONSULTA") ?? "").trim() !== "") return base("solo_nit_de_la_cuenta");   // ni siquiera el mismo NIT escrito a mano: la entrada de la ejecución queda a la vista
  const nit = env("DIGIFACT_TEST_NIT")!.trim(); if (!/^\d{1,12}$/.test(nit)) return base("nit_de_la_cuenta_no_valido");
  const real = o.fetchImpl ?? fetch;
  const permitido = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/login/get_token")) { if (++llamadas.inicioSesion > 1) { bloqueado = true; throw new Error("bloqueado"); } }
    else if (u.includes("/Shared?")) { if (++llamadas.consulta > 1) { bloqueado = true; throw new Error("bloqueado"); } }
    else { bloqueado = true; throw new Error("bloqueado"); }   // ninguna otra ruta: ni certificar, ni anular, ni descargar
    return await real(url, init);
  }) as typeof fetch;
  try {
    const c = crearDigifactGt({ ambiente: "test", nit, usuario: env("DIGIFACT_TEST_USERNAME")!, obtenerClave: () => env("DIGIFACT_TEST_PASSWORD")!, esquemaAutorizacion: "raw", fetchImpl: permitido, tiempoMaximoMs: o.tiempoMaximoMs ?? 15_000 });
    const r = await c.consultarNit(nit);
    if (!r.encontrado) return { prueba: "consultar-nit-privado", ambiente: "TEST", credenciales, ok: true, consulta: "no_encontrado", coincide: null, nombrePresente: null, llamadas, reintentoBloqueado: bloqueado };
    return { prueba: "consultar-nit-privado", ambiente: "TEST", credenciales, ok: true, consulta: "encontrado", coincide: normalizarNit(r.nit) === normalizarNit(nit), nombrePresente: !!r.nombre, llamadas, reintentoBloqueado: bloqueado };
  } catch (e) {
    // solo el TIPO del error y el estado HTTP: nunca el mensaje ni el cuerpo que devolvió el proveedor
    return { prueba: "consultar-nit-privado", ambiente: "TEST", credenciales, ok: false, consulta: "error", coincide: null, nombrePresente: null, llamadas, reintentoBloqueado: bloqueado,
      errorTipo: e instanceof ErrorDigifact ? e.tipo : "inesperado", estadoHttp: e instanceof ErrorDigifact ? (e.estadoHttp ?? null) : null };
  }
}
