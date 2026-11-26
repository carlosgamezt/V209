// RESOLVEDOR DE DIGIFACT POR EMPRESA (etapa 1C multiempresa; DESACTIVADO por defecto: ninguna ruta lo usa todavía).
//  · Cada empresa usa EXCLUSIVAMENTE sus credenciales (descifradas con AES-256-GCM vinculado a su empresa_id), su emisor aprobado y su propio cliente (su propio token): nada se comparte.
//  · Las credenciales viven en la base; una empresa nueva se conecta sin tocar el código ni redesplegar (se ve como máximo al vencer la caché negativa o al invalidarla).
//  · Caché segura: positiva con vencimiento, negativa corta (para no consultar la base en cada petición de una empresa sin canal), una sola carga a la vez por empresa y número de empresas acotado.
//  · Los errores NUNCA revelan credenciales, llaves ni texto cifrado: se registran solo códigos.
//  · En la ruta caliente (caché vigente) NO hay consultas a la base ni esperas nuevas; la carga cuesta UN viaje (lectura de la configuración y del emisor en un lote).
import { ErrorFelGt, ServicioFelGt, AUTORIZACION_CICLO, type ClienteGt, type ContextoFel, type DatosEmisorEmpresa, type DepsFelGt, type DocumentoFel } from "./felgt_servicio.ts";
import { huellaEmisor, type DatosEmisor } from "./datos_emisor.ts";
import { descifrarCredencial, type LlavesCredenciales } from "./credenciales_empresa.ts";
import type { EmisorGt } from "./nuc_gt.ts";

export interface FilaCredencial { digifact_nit: string; credencial_cifrada: Uint8Array; llave_version: number; consulta_nit: boolean; consulta_cui: boolean; certificar: boolean; correo_digifact: boolean; version: number }
export interface FilaEmisor { version: number; nit: string; nombre_fiscal: string; nombre_comercial: string | null; afiliacion_iva: string; frases: Array<{ tipo: number; escenario: number }>; correo: string | null;
  codigo_establecimiento: number; direccion: string; codigo_postal: string; municipio: string; departamento: string; huella: string }
export interface LecturaEmpresa { credencial: FilaCredencial | null; emisor: FilaEmisor | null }
export interface Resuelto { empresaId: string; version: number; consultaNit: boolean; consultaCui: boolean; certificar: boolean; correoDigifact: boolean; cliente: ClienteGt; emisor: DatosEmisorEmpresa }
export interface DepsResolvedor {
  /** Lee, en UN viaje, la configuración activa y el emisor aprobado de ESA empresa (null si no hay). Debe respetar `fel_sys_digifact_credencial` y `fel_sys_emisor_vigente`. */
  leer: (empresaId: string) => Promise<LecturaEmpresa>;
  llaves: LlavesCredenciales;
  /** Crea el cliente de Digifact de ESA empresa con SUS credenciales. */
  crearCliente: (c: { nit: string; usuario: string; clave: string }) => ClienteGt;
  ahora?: () => number; ttlMs?: number; ttlNegativoMs?: number; ttlErrorMs?: number; maxEmpresas?: number;
  /** Solo códigos y el empresa_id, nunca valores. */ registrar?: (evento: string, empresaId: string, codigo: string) => void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function datosDeFila(f: FilaEmisor): DatosEmisor {
  return { nit: f.nit, nombre: f.nombre_fiscal, nombreComercial: f.nombre_comercial ?? "", afiliacionIva: f.afiliacion_iva, codigoEstablecimiento: String(f.codigo_establecimiento), correo: f.correo ?? "",
    direccion: { direccion: f.direccion, codigoPostal: f.codigo_postal, municipio: f.municipio, departamento: f.departamento, pais: "GT" }, frases: f.frases };
}
export function emisorGtDeDatos(e: DatosEmisor): EmisorGt {
  return { nit: String(Number(e.nit)), nombre: e.nombre, afiliacionIva: e.afiliacionIva as EmisorGt["afiliacionIva"], frases: e.frases,
    establecimiento: { codigo: Number(e.codigoEstablecimiento), ...(e.nombreComercial ? { nombre: e.nombreComercial } : {}), direccion: { direccion: e.direccion.direccion, codigoPostal: e.direccion.codigoPostal, municipio: e.direccion.municipio, departamento: e.direccion.departamento, pais: "GT" } } as EmisorGt["establecimiento"],
    ...(e.correo ? { correo: e.correo } : {}) };
}

export class ResolvedorDigifact {
  readonly #d: DepsResolvedor; readonly #ok = new Map<string, { r: Resuelto | null; hasta: number }>(); readonly #cargando = new Map<string, Promise<Resuelto | null>>();
  constructor(deps: DepsResolvedor) { this.#d = deps; }
  #ahora() { return (this.#d.ahora ?? Date.now)(); }
  /** Lo ya resuelto, SIN consultar nada (incluso si venció: solo `asegurar` decide la frescura). */
  sincrono(empresaId: string): Resuelto | null { return this.#ok.get(empresaId.toLowerCase())?.r ?? null; }
  invalidar(empresaId: string) { this.#ok.delete(empresaId.toLowerCase()); }
  tamano() { return this.#ok.size; }
  /** Garantiza una resolución vigente de la empresa (caché → una sola carga a la vez). Nunca lanza con datos sensibles: ante cualquier fallo, la empresa queda SIN canal. */
  asegurar(empresaId: string): Promise<Resuelto | null> {
    if (typeof empresaId !== "string" || !UUID.test(empresaId)) return Promise.resolve(null);
    const id = empresaId.toLowerCase(), e = this.#ok.get(id);
    if (e && e.hasta > this.#ahora()) return Promise.resolve(e.r);
    const en = this.#cargando.get(id); if (en) return en;
    const p = this.#cargar(id).finally(() => this.#cargando.delete(id)); this.#cargando.set(id, p); return p;
  }
  async #cargar(id: string): Promise<Resuelto | null> {
    const d = this.#d, ttl = d.ttlMs ?? 60_000, neg = d.ttlNegativoMs ?? 30_000, err = d.ttlErrorMs ?? 5_000, t = this.#ahora();
    const guardar = (r: Resuelto | null, ms: number) => {
      if (this.#ok.size >= (d.maxEmpresas ?? 500) && !this.#ok.has(id)) { const viejo = [...this.#ok.entries()].sort((a, b) => a[1].hasta - b[1].hasta)[0]; if (viejo) this.#ok.delete(viejo[0]); }
      this.#ok.set(id, { r, hasta: this.#ahora() + ms }); return r;
    };
    let lec: LecturaEmpresa;
    try { lec = await d.leer(id); } catch { d.registrar?.("lectura_fallida", id, "BD"); return guardar(null, err); }
    if (!lec.credencial || !lec.emisor) return guardar(null, neg);   // sin conexión activa o sin emisor aprobado: sin canal
    const c = lec.credencial, em = lec.emisor, previo = this.#ok.get(id)?.r;
    if (previo && previo.version === c.version && previo.emisor.huella === em.huella) return guardar(previo, ttl);   // misma configuración: se conserva el cliente (y su token)
    try {
      const claro = await descifrarCredencial(d.llaves, id, c.credencial_cifrada, c.llave_version);
      const datos = datosDeFila(em);
      if ((await huellaEmisor(datos)) !== em.huella) { d.registrar?.("huella_no_coincide", id, "EMISOR"); return guardar(null, err); }   // los datos aprobados no coinciden con su huella: no se usa
      const emisor = emisorGtDeDatos(datos);
      const cliente = d.crearCliente({ nit: c.digifact_nit, usuario: claro.usuario, clave: claro.clave });
      return guardar({ empresaId: id, version: c.version, consultaNit: c.consulta_nit, consultaCui: c.consulta_cui, certificar: c.certificar, correoDigifact: c.correo_digifact, cliente, emisor: { emisor, huella: em.huella } }, ttl);
    } catch (e) { d.registrar?.("resolucion_fallida", id, (e as { codigo?: string })?.codigo ?? "ERROR"); return guardar(null, err); }
    void t;
  }
}

/** Fachada con la misma interfaz que usan las rutas: antes de cada llamada asegura la resolución de LA empresa del contexto y delega en UN ServicioFelGt compartido, que solo ve el cliente y el emisor de esa empresa. */
export function crearServicioMultiempresa(res: ResolvedorDigifact, base: Omit<DepsFelGt, "clienteDe" | "emisorDe" | "autorizaPrueba" | "autorizaPruebaDe">) {
  const svc = new ServicioFelGt({ ...base, clienteDe: (e) => res.sincrono(e)?.cliente ?? null, emisorDe: (e) => res.sincrono(e)?.emisor ?? null, autorizaPrueba: () => null,
    autorizaPruebaDe: (e) => (res.sincrono(e)?.certificar ? AUTORIZACION_CICLO : null) });
  const listo = async (ctx: ContextoFel) => { await res.asegurar(ctx.empresaId); };
  const sinCanal = (m: string) => new ErrorFelGt("SIN_CANAL", m);
  return {
    servicio: svc,
    async calentar(ctx: ContextoFel, o: { consulta?: boolean } = {}) { await listo(ctx); const r = res.sincrono(ctx.empresaId); if (!r || !(r.certificar || r.consultaNit)) return; return svc.calentar(ctx, o); },
    async consultarNit(ctx: ContextoFel, nit: unknown) { await listo(ctx); const r = res.sincrono(ctx.empresaId); if (!r?.consultaNit) throw sinCanal("La consulta de NIT por Digifact no está habilitada para esta empresa"); return svc.consultarNit(ctx, nit); },
    async validar(ctx: ContextoFel, doc: DocumentoFel, o: Parameters<ServicioFelGt["validar"]>[2] = {}) { await listo(ctx); return svc.validar(ctx, doc, o); },
    async preparar(ctx: ContextoFel, doc: DocumentoFel, o: { correo?: unknown } = {}) { await listo(ctx); return svc.preparar(ctx, doc, o); },
    async certificar(ctx: ContextoFel, doc: DocumentoFel, c: Parameters<ServicioFelGt["certificar"]>[2]) { await listo(ctx); return svc.certificar(ctx, doc, c); },
    async conciliar(ctx: ContextoFel, operacionId: unknown) { await listo(ctx); return svc.conciliar(ctx, operacionId); },
    async descargar(ctx: ContextoFel, documentoId: unknown, tipo: unknown) { await listo(ctx); return svc.descargar(ctx, documentoId, tipo); },
    async estadoDocumento(ctx: ContextoFel, documentoId: string) { await listo(ctx); return svc.estadoDocumento(ctx, documentoId); },
    async estadoCanal(ctx: ContextoFel) { await listo(ctx); return svc.estadoCanal(ctx.empresaId); },
  };
}
