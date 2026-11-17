// Arma el servicio de Digifact TEST a partir de variables de entorno del SERVIDOR. Sin ellas el servicio NO existe (las rutas responden «no habilitado»).
// Falla cerrado: cualquier variable ausente o incoherente deja Digifact deshabilitado y lo explica SIN mostrar valores.
//   FEL_DIGIFACT_TEST=habilitado            interruptor general (producción no existe: el cliente la bloquea)
//   FEL_DIGIFACT_TEST_EMPRESA=<uuid>        la ÚNICA empresa de NEXA que usa estas credenciales de TEST (las credenciales son de un NIT: nunca se comparten entre empresas)
//   DIGIFACT_TEST_USERNAME / _PASSWORD / _NIT   credenciales de TEST (secretos del entorno; nunca se guardan en el servicio)
//   FEL_DIGIFACT_TEST_EMISOR=<json>         datos del emisor leídos de un DTE aceptado por SAT (paso «datos-emisor»); no son secretos
//   FEL_DIGIFACT_TEST_HUELLA=<16 hex>       huella de esos datos que una persona aprobó: si no coincide, no se habilita
//   FEL_DIGIFACT_AUTORIZA_REFERENCIA=<guid> autorización EXPRESA de UNA prueba: solo esa referencia se puede enviar (se retira al terminar)
import { crearDigifactGt } from "../../proveedores/src/digifact_gt.ts";
import { huellaEmisor, type DatosEmisor } from "../../proveedores/src/datos_emisor.ts";
import type { EmisorGt } from "../../proveedores/src/nuc_gt.ts";
import { AlmacenGtMemoria, ServicioFelGt, type AlmacenGt, type ContextoFel } from "../../proveedores/src/felgt_servicio.ts";
import { AlmacenGtPg } from "../../proveedores/src/almacen_gt_pg.ts";
import type { BdDemo } from "./bd.ts";

export type Entorno = (k: string) => string | undefined;
export interface ResultadoEntorno { servicio?: ServicioFelGt; motivo: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emisorDeDatos(e: DatosEmisor): EmisorGt {
  return { nit: String(Number(e.nit)), nombre: e.nombre, afiliacionIva: e.afiliacionIva as EmisorGt["afiliacionIva"], frases: e.frases,
    establecimiento: { codigo: Number(e.codigoEstablecimiento), ...(e.nombreComercial ? { nombre: e.nombreComercial } : {}), direccion: { direccion: e.direccion.direccion, codigoPostal: e.direccion.codigoPostal, municipio: e.direccion.municipio, departamento: e.direccion.departamento, pais: e.direccion.pais || "GT" } } };
}

export async function crearDigifactDesdeEntorno(env: Entorno, o: { almacen?: AlmacenGt; auditar?: (evento: string, ctx: ContextoFel, detalle: Record<string, unknown>) => Promise<void> | void; fetchImpl?: typeof fetch } = {}): Promise<ResultadoEntorno> {
  if (env("FEL_DIGIFACT_TEST") !== "habilitado") return { motivo: "Digifact TEST no está habilitado (FEL_DIGIFACT_TEST)." };
  const empresa = env("FEL_DIGIFACT_TEST_EMPRESA") ?? ""; if (!UUID.test(empresa)) return { motivo: "Falta FEL_DIGIFACT_TEST_EMPRESA (UUID de la única empresa que usa las credenciales de TEST)." };
  const usuario = env("DIGIFACT_TEST_USERNAME"), nit = env("DIGIFACT_TEST_NIT"); if (!usuario || !env("DIGIFACT_TEST_PASSWORD") || !nit) return { motivo: "Faltan las credenciales de Digifact TEST (usuario, contraseña o NIT)." };
  let datos: DatosEmisor; try { datos = JSON.parse(env("FEL_DIGIFACT_TEST_EMISOR") ?? ""); } catch { return { motivo: "FEL_DIGIFACT_TEST_EMISOR no es un JSON válido." }; }
  if (!datos?.nit || !datos.nombre || !datos.direccion || !Array.isArray(datos.frases)) return { motivo: "FEL_DIGIFACT_TEST_EMISOR no trae los datos del emisor." };
  if (String(Number(datos.nit)) !== String(Number(nit))) return { motivo: "El NIT del emisor no coincide con el NIT de las credenciales de TEST." };
  const huella = await huellaEmisor(datos); if (huella !== env("FEL_DIGIFACT_TEST_HUELLA")) return { motivo: "La huella aprobada de los datos del emisor no coincide: no se habilita." };
  let cliente; try { cliente = crearDigifactGt({ ambiente: "test", nit, usuario, obtenerClave: () => env("DIGIFACT_TEST_PASSWORD") ?? "", fetchImpl: o.fetchImpl }); } catch (e) { return { motivo: `No se pudo crear el cliente de Digifact: ${(e as Error).message}` }; }
  const emisor = { emisor: emisorDeDatos(datos), huella };
  const servicio = new ServicioFelGt({
    clienteDe: (e) => (e === empresa.toLowerCase() ? cliente : null), emisorDe: (e) => (e === empresa.toLowerCase() ? emisor : null),
    almacen: o.almacen ?? new AlmacenGtMemoria(),   // sin almacén persistente el servicio PREPARA y VALIDA, pero se niega a enviar nada real
    autorizaPrueba: () => { const a = env("FEL_DIGIFACT_AUTORIZA_REFERENCIA") ?? ""; return UUID.test(a) ? a.toLowerCase() : null; }, auditar: o.auditar,
  });
  return { servicio, motivo: "Digifact TEST habilitado" };
}

/** Digifact TEST para un servidor con base de datos (el local y la función de la nube lo usan igual): el almacén es PERSISTENTE solo si la base es PostgreSQL real y ya tiene la tabla de la migración 29;
 *  si no, el servicio prepara y valida pero se niega a enviar nada real. La auditoría va a la base, sin valores sensibles. Sin las variables FEL_DIGIFACT_*, el servicio no existe. */
export async function crearDigifactParaBd(env: Entorno, bd: BdDemo, fetchImpl?: typeof fetch): Promise<ResultadoEntorno & { almacenPersistente: boolean }> {
  const persistente = bd.tipo === "pg" && (await bd.filas<{ ok: boolean }>("select to_regclass('public.digifact_operaciones') is not null as ok"))[0]?.ok === true;
  const r = await crearDigifactDesdeEntorno(env, { almacen: persistente ? new AlmacenGtPg(bd.filas) : undefined, fetchImpl,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  return { ...r, almacenPersistente: persistente };
}
