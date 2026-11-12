// CARGA de los recursos oficiales versionados (fiscal/recursos/sat-fel): verifica el hash SHA-256 de cada archivo contra MANIFIESTO.json ANTES de usarlo, y devuelve los catálogos tipados.
// Los importes de los catálogos (factor, descuento) se leen como TEXTO decimal exacto del propio archivo (nunca como número de coma flotante).
import { ErrorFiscal } from "./error.ts";
import { type Esquema, extraerEsquema } from "./esquema.ts";

export interface ArchivoManifiesto { ruta: string; tipo: string; version: string | null; bytes: number; sha256: string }
export interface Manifiesto { esquema: number; fuente: { nombre: string; url: string; publicador: string; licencia: string }; referencia: { rama: string; commit: string; fechaCommit: string; nota: string }; descargado: string; nota: string; archivos: ArchivoManifiesto[] }
export interface EscenarioFrase { codigo: number; descripcion: string; texto: string; marcas: Record<string, boolean> }
export interface TipoFrase { codigo: number; nombre: string; escenarios: Map<number, EscenarioFrase> }
export interface UnidadGravable { codigo: number | null; nombreCorto: string; operaSobre: "MontoGravable" | "CantidadUnidadesGravables" | null; factor: string | null; descuento: string | null }
export interface ImpuestoCatalogo { nombre: string; unidades: Map<number | null, UnidadGravable> }
export interface MensajeSat { codigo: string; validacion: string; mensaje: string }
export interface Recursos {
  manifiesto: Manifiesto; esquema: Esquema; frases: Map<number, TipoFrase>; unidades: Map<string, ImpuestoCatalogo>; mensajes: Map<string, MensajeSat>;
  cabeceras: { frases: string; unidades: string; mensajes: string }; archivosVerificados: number;
}
const RAIZ_POR_DEFECTO = new URL("../recursos/sat-fel/", import.meta.url);
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");

export async function leerManifiesto(raiz: URL = RAIZ_POR_DEFECTO): Promise<Manifiesto> {
  const m = JSON.parse(await Deno.readTextFile(new URL("MANIFIESTO.json", raiz))) as Manifiesto;
  if (m.esquema !== 1 || !/^[0-9a-f]{40}$/.test(m.referencia?.commit ?? "") || !Array.isArray(m.archivos)) throw new ErrorFiscal("MANIFIESTO_INVALIDO", "Manifiesto de recursos no válido");
  return m;
}
/** Lee un archivo del manifiesto verificando tamaño y hash. Cualquier diferencia ABORTA: nunca se usa un recurso alterado. */
async function leerVerificado(raiz: URL, m: Manifiesto, ruta: string): Promise<Uint8Array> {
  const a = m.archivos.find((x) => x.ruta === ruta); if (!a) throw new ErrorFiscal("RECURSO_NO_REGISTRADO", `Recurso no registrado en el manifiesto: ${ruta}`);
  const b = await Deno.readFile(new URL(ruta, raiz));
  if (b.length !== a.bytes || await hex(b) !== a.sha256) throw new ErrorFiscal("RECURSO_ALTERADO", `El recurso ${ruta} no coincide con el hash del manifiesto`);
  return b;
}
export async function verificarIntegridad(raiz: URL = RAIZ_POR_DEFECTO): Promise<{ ruta: string; ok: boolean }[]> {
  const m = await leerManifiesto(raiz), r: { ruta: string; ok: boolean }[] = [];
  for (const a of m.archivos) { try { await leerVerificado(raiz, m, a.ruta); r.push({ ruta: a.ruta, ok: true }); } catch { r.push({ ruta: a.ruta, ok: false }); } }
  return r;
}
/** JSON con los números del catálogo (factor, descuento) como TEXTO exacto (usa el texto fuente del lector JSON); si el motor no lo soporta, falla en lugar de usar coma flotante. */
export function parsearJsonExacto(texto: string): unknown {
  const sinBom = texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto;
  // deno-lint-ignore no-explicit-any
  const revisor = function (this: unknown, k: string, v: any, ctx?: { source?: string }) {
    if ((k === "factor" || k === "descuento") && typeof v === "number") { if (typeof ctx?.source !== "string") throw new ErrorFiscal("JSON_SIN_TEXTO_FUENTE", "El motor JSON no entrega el texto fuente de los números; no se usa coma flotante"); return ctx.source; }
    return v;
  };
  // deno-lint-ignore no-explicit-any
  return JSON.parse(sinBom, revisor as any);
}

export async function cargarRecursos(raiz: URL = RAIZ_POR_DEFECTO): Promise<Recursos> {
  const m = await leerManifiesto(raiz), dec = new TextDecoder("utf-8", { fatal: true });
  const xsd = dec.decode(await leerVerificado(raiz, m, "XSD/GT_Documento-0.2.1.xsd"));
  // deno-lint-ignore no-explicit-any
  const fr = parsearJsonExacto(dec.decode(await leerVerificado(raiz, m, "Catalogos/CatalogoFrases-0.6.0.json"))) as any;
  // deno-lint-ignore no-explicit-any
  const ug = parsearJsonExacto(dec.decode(await leerVerificado(raiz, m, "Catalogos/catalogoUnidadesGravables-0.1.4.json"))) as any;
  // deno-lint-ignore no-explicit-any
  const ms = parsearJsonExacto(dec.decode(await leerVerificado(raiz, m, "Catalogos/catalogoMensajes-0.3.0.json"))) as any;
  const frases = new Map<number, TipoFrase>();
  for (const t of fr.contenido.tiposFrases) {
    const esc = new Map<number, EscenarioFrase>();
    for (const f of t.frases) {
      const { codigoEscenario, escenario, textoAColocar, ...marcas } = f;
      esc.set(codigoEscenario, { codigo: codigoEscenario, descripcion: escenario, texto: textoAColocar ?? "", marcas: Object.fromEntries(Object.entries(marcas).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean> });
    }
    frases.set(t.codigoTipoFrase, { codigo: t.codigoTipoFrase, nombre: t.nombre, escenarios: esc });
  }
  const unidades = new Map<string, ImpuestoCatalogo>();
  for (const i of ug.Contenido) {
    const us = new Map<number | null, UnidadGravable>();
    for (const u of i.unidadesGravables) us.set(u.codigoUnidadGravable ?? null, { codigo: u.codigoUnidadGravable ?? null, nombreCorto: u.nombreCorto, operaSobre: u.operaSobreCasilla ?? null, factor: u.factor ?? null, descuento: u.descuento ?? null });
    unidades.set(i.impuesto, { nombre: i.impuesto, unidades: us });
  }
  const mensajes = new Map<string, MensajeSat>(); for (const x of ms.Contenido) mensajes.set(x.codigo, { codigo: x.codigo, validacion: x.validacion, mensaje: x.mensaje });
  return { manifiesto: m, esquema: extraerEsquema(xsd), frases, unidades, mensajes,
    cabeceras: { frases: fr.cabecera["Ultima Actualizacion"], unidades: ug.Cabecera["Ultima Actualizacion"], mensajes: ms.Cabecera["Ultima Actualizacion"] }, archivosVerificados: 4 };
}
let enCache: Promise<Recursos> | null = null;
/** Recursos cargados una sola vez por proceso. */
export const recursos = (): Promise<Recursos> => (enCache ??= cargarRecursos());
