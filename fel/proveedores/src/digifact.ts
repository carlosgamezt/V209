// Adaptador DIGIFACT (D3). Habla con un TRANSPORTE inyectado: en esta versión el único transporte es el simulador local (digifact_simulador.ts); no hay red, ni credenciales reales,
// ni certificación real. El contrato HTTP de abajo es una HIPÓTESIS de trabajo hasta contar con la documentación de Digifact (ver fel/docs/demo-version-practica.md): cuando exista, solo
// cambian este archivo y el simulador; el orquestador, la base y la interfaz no.
// Reglas que este adaptador NUNCA rompe: un solo intento por envío (sin reintentos), nada que no sea un resultado garantizado se presenta como éxito o fracaso,
// los importes viajan como TEXTO decimal, y fuera del ambiente «simulado» se niega a operar.
import { ErrorProveedor } from "./tipos.ts";
import type { ArtefactoRef, CapacidadesProveedor, Contexto, DatosFiscales, DocumentoCongelado, EmissionProvider, MotivoDesconocido, OperacionRef, ResultadoConciliacion, ResultadoEnvio, ResultadoValidacion, SolicitudCertificacion } from "./tipos.ts";
import { validarDocumento } from "./validacion.ts";

export interface PeticionHttp { metodo: "GET" | "POST"; ruta: string; cabeceras: Record<string, string>; cuerpo?: string }
export interface RespuestaHttp { estado: number; cuerpo: string }
/** Debe LANZAR ante un fallo de red o un tiempo agotado (nunca devolver una respuesta inventada). */
export type Transporte = (p: PeticionHttp) => Promise<RespuestaHttp>;
export interface CredencialesDigifact { usuario: string; clave: string }

export interface SolicitudAnulacion { empresaId: string; documentoId: string; operacionId: string; claveIdempotencia: string; referenciaCertificacion: string; autorizacion: string; motivo: string; ambiente: Contexto["ambiente"] }
export type ResultadoAnulacion =
  | { tipo: "anulado"; fechaAnulacion: string; crudoSaneado?: unknown }
  | { tipo: "rechazado_confirmado"; codigo: string; mensaje: string }
  | { tipo: "desconocido"; motivo: MotivoDesconocido };
export type ResultadoConciliacionAnulacion = { tipo: "anulado"; fechaAnulacion: string } | { tipo: "no_anulado_confirmado" } | { tipo: "indeterminado"; motivo: string };
export interface LineaConsumoProveedor { referencia: string; evento: string; unidades: string; fecha: string }
/** Extensión de EmissionProvider para anulación y conciliación del bolsón: EmissionProvider (tipos.ts) NO se modifica. */
export interface ProveedorAnulacion extends EmissionProvider {
  anular(sol: SolicitudAnulacion, ctx: Contexto): Promise<ResultadoAnulacion>;
  conciliarAnulacion(ref: SolicitudAnulacion | OperacionRef, ctx: Contexto): Promise<ResultadoConciliacionAnulacion>;
  obtenerConsumos(desde: string, hasta: string, ctx: Contexto): Promise<LineaConsumoProveedor[]>;
}

async function sha256(b: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
}
export function deBase64(s: string): Uint8Array { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
export function aBase64(b: Uint8Array): string { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
const noVacio = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
// deno-lint-ignore no-explicit-any
function json(r: RespuestaHttp): any | null { try { return JSON.parse(r.cuerpo); } catch { return null; } }
const motivoDeError = (e: unknown): MotivoDesconocido => (e instanceof Error && e.name === "TiempoAgotado" ? "timeout" : "corte");

export class DigifactProvider implements ProveedorAnulacion {
  readonly capacidades: CapacidadesProveedor;
  private token: { valor: string; hasta: number } | null = null;
  /** Cuántas peticiones de certificación salieron (para afirmar que NUNCA se reintenta). */
  llamadasCertificar = 0;
  constructor(private transporte: Transporte, private credenciales: CredencialesDigifact, opciones: { tiempoMaximoMs?: number } = {}) {
    this.capacidades = {
      id: "digifact", ambientes: ["simulado"], tiposDte: ["SIM"], emiteSinHumano: true, idempotenciaNativa: true, consultaPorReferencia: true,
      entregaXml: true, entregaPdf: true, soportaAnulacion: true, soportaNotaCredito: false, tiempoMaximoMs: opciones.tiempoMaximoMs ?? 2000,
    };
  }
  private exigirSimulado(ctx: Contexto) {
    if (ctx.ambiente !== "simulado") throw new ErrorProveedor("NO_SOPORTADO", `Digifact solo opera contra el simulador (se pidió «${ctx.ambiente}»); pruebas y producción requieren credenciales y documentación (D4)`);
  }

  private async autenticar(ctx: Contexto): Promise<string> {
    if (this.token && this.token.hasta > ctx.ahora().getTime() + 5_000) return this.token.valor;
    const r = await this.transporte({ metodo: "POST", ruta: "/api/login", cabeceras: { "content-type": "application/json" }, cuerpo: JSON.stringify(this.credenciales) });
    const j = json(r);
    if (r.estado === 401 || r.estado === 403) throw new ErrorProveedor("AUTENTICACION", "Digifact rechazó las credenciales");
    if (r.estado !== 200 || !noVacio(j?.token)) throw new ErrorProveedor("FORMATO", "Respuesta de autenticación no válida");
    this.token = { valor: j.token, hasta: ctx.ahora().getTime() + (Number(j.expira_en_s) || 300) * 1000 };
    return j.token;
  }
  private async llamar(ctx: Contexto, p: Omit<PeticionHttp, "cabeceras">): Promise<RespuestaHttp> {
    const t = await this.autenticar(ctx);
    return await this.transporte({ ...p, cabeceras: { "content-type": "application/json", authorization: `Bearer ${t}` } });
  }

  async validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion> { this.exigirSimulado(ctx); return validarDocumento(doc); }

  private cuerpoCertificacion(s: SolicitudCertificacion) {
    const d = s.instantanea;
    return JSON.stringify({
      referencia: s.claveIdempotencia, tipo_dte: "FACT-SIM", moneda: d.moneda, fecha_emision: d.fechaEmision,
      emisor: { empresa_id: s.empresaId, establecimiento: s.establecimientoId },
      receptor: { tipo_id: d.receptor.tipoId, id: d.receptor.id, nombre: d.receptor.nombre ?? null },
      lineas: d.lineas.map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precioUnitario, descuento: l.descuento })),
      total: d.total, datos_adicionales: { documento_id: s.documentoId, operacion_id: s.operacionId, hash_contenido: s.hashContenido },
    });
  }
  private async artefactosDe(b64: { xml?: unknown; pdf?: unknown }, nombre: string): Promise<ArtefactoRef[]> {
    const out: ArtefactoRef[] = [];
    for (const [tipo, mime, v] of [["xml", "application/xml", b64.xml], ["pdf", "application/pdf", b64.pdf]] as const) {
      if (!noVacio(v)) continue;
      let c: Uint8Array; try { c = deBase64(v); } catch { continue; }
      out.push({ tipo, nombre: `${nombre}.${tipo}`, mime, sha256: await sha256(c), contenido: c });   // el SHA-256 lo calcula NEXA, no se confía en el proveedor
    }
    return out;
  }
  // deno-lint-ignore no-explicit-any
  private datosDe(j: any): DatosFiscales | null {
    return noVacio(j?.serie) && noVacio(j?.numero) && noVacio(j?.autorizacion) && noVacio(j?.fecha_certificacion) ? { serie: j.serie, numero: j.numero, autorizacion: j.autorizacion, fechaCertificacion: j.fecha_certificacion } : null;
  }

  async enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio> {
    this.exigirSimulado(ctx);
    // 1. autenticación: si falla, el documento NO salió; se informa como desconocido (la conciliación lo aclarará) y NO se reintenta
    try { await this.autenticar(ctx); } catch { return { tipo: "desconocido", motivo: "excepcion_del_adaptador" }; }
    // 2. UN solo intento de certificación
    this.llamadasCertificar++;
    let r: RespuestaHttp;
    try { r = await this.llamar(ctx, { metodo: "POST", ruta: "/api/certificar", cuerpo: this.cuerpoCertificacion(sol) }); }
    catch (e) { return { tipo: "desconocido", motivo: motivoDeError(e) }; }
    const j = json(r);
    if (r.estado === 429 || r.estado >= 500) return { tipo: "desconocido", motivo: "limite_o_caida" };
    if (r.estado === 401 || r.estado === 403) { this.token = null; return { tipo: "desconocido", motivo: "excepcion_del_adaptador" }; }
    if (j === null) return { tipo: "desconocido", motivo: "respuesta_ilegible" };
    if (r.estado === 422 && j.estado === "RECHAZADO" && noVacio(j.codigo)) return { tipo: "rechazado_confirmado", codigo: String(j.codigo).slice(0, 60), mensaje: String(j.mensaje ?? "").slice(0, 200), crudoSaneado: { codigo: j.codigo } };
    if (r.estado === 402 && j.codigo === "SALDO_INSUFICIENTE") return { tipo: "rechazado_confirmado", codigo: "SALDO_INSUFICIENTE", mensaje: "Digifact informa que el bolsón no tiene saldo; el documento no se procesó" };
    if (r.estado === 200 && j.estado === "CERTIFICADO") {
      const d = this.datosDe(j); if (!d) return { tipo: "desconocido", motivo: "respuesta_ilegible" };   // «certificado» sin los datos fiscales completos: no se puede probar
      return { tipo: "certificado", ...d, artefactos: await this.artefactosDe({ xml: j.xml_b64, pdf: j.pdf_b64 }, `${d.serie}-${d.numero}`), crudoSaneado: { estado: j.estado } };
    }
    return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
  }

  async conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion> {
    this.exigirSimulado(ctx);   // SOLO LECTURA
    let r: RespuestaHttp;
    try { r = await this.llamar(ctx, { metodo: "GET", ruta: `/api/consultar?referencia=${encodeURIComponent(op.claveIdempotencia)}` }); }
    catch { return { tipo: "indeterminado", motivo: "no se pudo consultar a Digifact" }; }
    const j = json(r);
    if (r.estado === 200 && j?.estado === "CERTIFICADO") {
      const d = this.datosDe(j); if (!d) return { tipo: "indeterminado", motivo: "respuesta incompleta de Digifact" };
      return { tipo: "certificado", ...d, artefactos: await this.artefactosDe({ xml: j.xml_b64, pdf: j.pdf_b64 }, `${d.serie}-${d.numero}`) };
    }
    if (r.estado === 200 && j?.estado === "EN_PROCESO") return { tipo: "indeterminado", motivo: "Digifact informa que la solicitud sigue en proceso" };
    if (r.estado === 404 && j?.codigo === "NO_EXISTE" && j?.procesamiento === "finalizado") return { tipo: "no_existe_confirmado" };   // SOLO si el proveedor garantiza la ausencia
    return { tipo: "indeterminado", motivo: "Digifact no puede confirmar ni descartar la certificación" };
  }
  async obtenerArtefactos(op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]> {
    this.exigirSimulado(ctx);
    try {
      const r = await this.llamar(ctx, { metodo: "GET", ruta: `/api/documento?referencia=${encodeURIComponent(op.claveIdempotencia)}` });
      const j = json(r); if (r.estado !== 200 || !j) return [];
      return await this.artefactosDe({ xml: j.xml_b64, pdf: j.pdf_b64 }, `${j.serie ?? "SIM"}-${j.numero ?? "0"}`);
    } catch { return []; }
  }
  async salud(ctx: Contexto): Promise<{ ok: boolean; detalle: string }> {
    this.exigirSimulado(ctx);
    try { const r = await this.transporte({ metodo: "GET", ruta: "/api/salud", cabeceras: {} }); return { ok: r.estado === 200, detalle: r.estado === 200 ? "Digifact (simulador) responde" : `estado ${r.estado}` }; }
    catch { return { ok: false, detalle: "sin respuesta" }; }
  }

  // ------------------------------------------------------------------ anulación (simulada)
  async anular(sol: SolicitudAnulacion, ctx: Contexto): Promise<ResultadoAnulacion> {
    this.exigirSimulado(ctx);
    try { await this.autenticar(ctx); } catch { return { tipo: "desconocido", motivo: "excepcion_del_adaptador" }; }
    let r: RespuestaHttp;
    try {
      r = await this.llamar(ctx, { metodo: "POST", ruta: "/api/anular", cuerpo: JSON.stringify({ referencia: sol.claveIdempotencia, referencia_certificacion: sol.referenciaCertificacion, autorizacion: sol.autorizacion, motivo: sol.motivo,
        datos_adicionales: { documento_id: sol.documentoId, operacion_id: sol.operacionId } }) });
    } catch (e) { return { tipo: "desconocido", motivo: motivoDeError(e) }; }
    const j = json(r);
    if (r.estado === 429 || r.estado >= 500) return { tipo: "desconocido", motivo: "limite_o_caida" };
    if (j === null) return { tipo: "desconocido", motivo: "respuesta_ilegible" };
    if (r.estado === 200 && j.estado === "ANULADO" && noVacio(j.fecha_anulacion)) return { tipo: "anulado", fechaAnulacion: j.fecha_anulacion, crudoSaneado: { estado: j.estado } };
    if (r.estado === 422 && j.estado === "RECHAZADO" && noVacio(j.codigo)) return { tipo: "rechazado_confirmado", codigo: String(j.codigo).slice(0, 60), mensaje: String(j.mensaje ?? "").slice(0, 200) };
    return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
  }
  async conciliarAnulacion(ref: SolicitudAnulacion | OperacionRef, ctx: Contexto): Promise<ResultadoConciliacionAnulacion> {
    this.exigirSimulado(ctx);
    let r: RespuestaHttp;
    try { r = await this.llamar(ctx, { metodo: "GET", ruta: `/api/consultar-anulacion?referencia=${encodeURIComponent(ref.claveIdempotencia)}` }); }
    catch { return { tipo: "indeterminado", motivo: "no se pudo consultar a Digifact" }; }
    const j = json(r);
    if (r.estado === 200 && j?.estado === "ANULADO" && noVacio(j.fecha_anulacion)) return { tipo: "anulado", fechaAnulacion: j.fecha_anulacion };
    if (r.estado === 404 && j?.codigo === "NO_EXISTE" && j?.procesamiento === "finalizado") return { tipo: "no_anulado_confirmado" };
    return { tipo: "indeterminado", motivo: "Digifact no puede confirmar ni descartar la anulación" };
  }
  /** Consumo que Digifact reporta contra el bolsón (insumo de la conciliación; solo lectura). */
  async obtenerConsumos(desde: string, hasta: string, ctx: Contexto): Promise<LineaConsumoProveedor[]> {
    this.exigirSimulado(ctx);
    const r = await this.llamar(ctx, { metodo: "GET", ruta: `/api/consumos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}` });
    const j = json(r); if (r.estado !== 200 || !Array.isArray(j?.lineas)) throw new ErrorProveedor("FORMATO", "Respuesta de consumos no válida");
    // deno-lint-ignore no-explicit-any
    return j.lineas.map((l: any) => ({ referencia: String(l.referencia), evento: String(l.evento), unidades: String(l.unidades), fecha: String(l.fecha) }));
  }
}
