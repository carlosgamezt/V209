// Adaptador SIMULADO. Determinista, sin red, sin credenciales, sin tiempo real. Nada de lo que produce tiene valor fiscal.
// Contiene un «servidor simulado» interno para poder reproducir lo difícil: que el servidor certifique aunque el cliente no vea la respuesta.
import type { Persistible } from "./persistible.ts";
import { ErrorProveedor } from "./tipos.ts";
import type { ArtefactoRef, CapacidadesProveedor, Contexto, DatosFiscales, DocumentoCongelado, EmissionProvider, OperacionRef, ResultadoConciliacion, ResultadoEnvio, ResultadoValidacion, SolicitudCertificacion } from "./tipos.ts";
import { validarDocumento } from "./validacion.ts";

export type Escenario =
  | "exito"
  | "rechazo"                              // rechazo confirmado: el proveedor garantiza que NO hay DTE
  | "timeout_antes"                        // el cliente no ve respuesta y el servidor NO certificó
  | "timeout_despues"                      // el cliente no ve respuesta pero el servidor SÍ certificó
  | "corte_despues"                        // conexión cortada tras certificar
  | "respuesta_ilegible"                   // el servidor certificó pero la respuesta no se entiende
  | "codigo_desconocido_certificado"       // código no mapeado; en el servidor SÍ hay DTE
  | "codigo_desconocido_no_certificado"    // código no mapeado; en el servidor NO hay DTE
  | "timeout_indeterminado"                // no se puede saber (ni conciliando) si hay DTE
  | "timeout_tardio"                       // el servidor certificará DESPUÉS (liberarTardios)
  | "limite_tasa"                          // 429/limite: no se procesó, pero no es un rechazo garantizado
  | "caida"                                // servicio caído: no se procesó, pero no es un rechazo garantizado
  | "accion_humana";                       // canal asistido: una persona debe terminar (imita portal_playwright)

export interface OpcionesMock {
  escenarioPorDefecto?: Escenario;
  escenarioPorDocumento?: Record<string, Escenario>;
  /** Si es false, el «servidor» NO deduplica: reenviar la misma referencia crea OTRA certificación (para probar que el orquestador no reenvía). */
  idempotenciaNativa?: boolean;
  prefijoSerie?: string;
}
export interface CertificadoSimulado extends DatosFiscales { referencia: string; documentoId: string; empresaId: string; hashContenido: string; artefactos: ArtefactoRef[] }

const enc = new TextEncoder();
async function sha256(t: Uint8Array | string): Promise<string> {
  const b = typeof t === "string" ? enc.encode(t) : t;
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource));
  return Array.from(buf, (x) => x.toString(16).padStart(2, "0")).join("");
}
function pdfSimulado(texto: string): Uint8Array {
  const contenido = `BT /F1 12 Tf 40 760 Td (${texto.replace(/[()\\]/g, "")}) Tj ET`;
  const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${contenido.length}>>stream\n${contenido}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return enc.encode(pdf);
}

export class MockProvider implements EmissionProvider, Persistible {
  readonly capacidades: CapacidadesProveedor;
  /** «Servidor simulado»: lo que de verdad existe, independientemente de lo que el cliente haya visto. */
  readonly servidor: CertificadoSimulado[] = [];
  /** Registro de cada llamada que llegó al «servidor» (para afirmar cuántas veces se envió). */
  readonly llamadasEnviar: { referencia: string; documentoId: string }[] = [];
  private tardios: SolicitudCertificacion[] = [];
  private contador = 0;
  private indeterminados = new Set<string>();
  private pendientesHumanos = new Map<string, SolicitudCertificacion>();

  constructor(private opciones: OpcionesMock = {}) {
    this.capacidades = {
      id: "mock", ambientes: ["simulado"], tiposDte: ["SIM"], emiteSinHumano: true, idempotenciaNativa: opciones.idempotenciaNativa ?? true,
      consultaPorReferencia: true, entregaXml: true, entregaPdf: true, soportaAnulacion: false, soportaNotaCredito: false, tiempoMaximoMs: 1000,
    };
  }
  private exigirSimulado(ctx: Contexto) { if (ctx.ambiente !== "simulado") throw new ErrorProveedor("NO_SOPORTADO", `El mock solo funciona en el ambiente «simulado» (se pidió «${ctx.ambiente}»)`); }
  private escenarioDe(documentoId: string): Escenario { return this.opciones.escenarioPorDocumento?.[documentoId] ?? this.opciones.escenarioPorDefecto ?? "exito"; }
  /** Escenario fijado para un documento (nulo si usa el predeterminado). */
  escenarioDeDocumento(documentoId: string): Escenario | null { return this.opciones.escenarioPorDocumento?.[documentoId] ?? null; }
  /** Estado del «servidor» simulado (certificaciones, solicitudes tardías, órdenes humanas, contadores y escenarios): se guarda y se restaura para sobrevivir a reinicios. */
  exportar() { return { servidor: this.servidor, llamadasEnviar: this.llamadasEnviar.slice(-500), tardios: this.tardios, contador: this.contador, indeterminados: this.indeterminados, pendientesHumanos: this.pendientesHumanos, escenarios: this.opciones.escenarioPorDocumento ?? {} }; }
  // deno-lint-ignore no-explicit-any
  importar(x: any) { this.servidor.length = 0; this.servidor.push(...(x.servidor ?? [])); this.llamadasEnviar.length = 0; this.llamadasEnviar.push(...(x.llamadasEnviar ?? [])); this.tardios = x.tardios ?? []; this.contador = x.contador ?? 0; this.indeterminados = x.indeterminados ?? new Set(); this.pendientesHumanos = x.pendientesHumanos ?? new Map(); this.opciones.escenarioPorDocumento = x.escenarios ?? {}; }
  /** Cambia el escenario de un documento en caliente (p. ej. para probar la conciliación o el reintento). */
  fijarEscenario(documentoId: string, e: Escenario) { (this.opciones.escenarioPorDocumento ??= {})[documentoId] = e; }

  // Los métodos de la interfaz son async: un error de configuración siempre es una promesa rechazada, nunca una excepción síncrona.
  async validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion> { this.exigirSimulado(ctx); return validarDocumento(doc); }

  private async certificar(sol: SolicitudCertificacion, ctx: Contexto): Promise<CertificadoSimulado> {
    const referencia = sol.claveIdempotencia;
    if (this.capacidades.idempotenciaNativa) { const previo = this.servidor.find((c) => c.referencia === referencia); if (previo) return previo; }
    this.contador++;
    const serie = `${this.opciones.prefijoSerie ?? "SIM"}A`, numero = String(this.contador).padStart(8, "0");
    const hash = await sha256(`${sol.empresaId}|${sol.operacionId}|${this.contador}`);
    const autorizacion = `SIM-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`.toUpperCase();
    const fecha = ctx.ahora().toISOString();
    const xml = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<DTESimulado simulado="true" aviso="SIMULADO - SIN VALOR FISCAL"><Serie>${serie}</Serie><Numero>${numero}</Numero><Autorizacion>${autorizacion}</Autorizacion><Documento>${sol.documentoId}</Documento></DTESimulado>\n`);
    const pdf = pdfSimulado(`SIMULADO - SIN VALOR FISCAL - ${serie}-${numero}`);
    const artefactos: ArtefactoRef[] = [
      { tipo: "xml", nombre: `${serie}-${numero}.xml`, mime: "application/xml", sha256: await sha256(xml), contenido: xml },
      { tipo: "pdf", nombre: `${serie}-${numero}.pdf`, mime: "application/pdf", sha256: await sha256(pdf), contenido: pdf },
    ];
    const c: CertificadoSimulado = { referencia, documentoId: sol.documentoId, empresaId: sol.empresaId, hashContenido: sol.hashContenido, serie, numero, autorizacion, fechaCertificacion: fecha, artefactos };
    this.servidor.push(c); return c;
  }
  private comoResultado(c: CertificadoSimulado): ResultadoEnvio { return { tipo: "certificado", serie: c.serie, numero: c.numero, autorizacion: c.autorizacion, fechaCertificacion: c.fechaCertificacion, artefactos: c.artefactos }; }

  async enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio> {
    this.exigirSimulado(ctx);
    this.llamadasEnviar.push({ referencia: sol.claveIdempotencia, documentoId: sol.documentoId });
    const e = this.escenarioDe(sol.documentoId);
    switch (e) {
      case "exito": return this.comoResultado(await this.certificar(sol, ctx));
      case "rechazo": return { tipo: "rechazado_confirmado", codigo: "SIM-VAL-001", mensaje: "Rechazo simulado: el documento no cumple una validación del proveedor" };
      case "timeout_antes": return { tipo: "desconocido", motivo: "timeout" };
      case "timeout_despues": await this.certificar(sol, ctx); return { tipo: "desconocido", motivo: "timeout" };
      case "corte_despues": await this.certificar(sol, ctx); return { tipo: "desconocido", motivo: "corte" };
      case "respuesta_ilegible": await this.certificar(sol, ctx); return { tipo: "desconocido", motivo: "respuesta_ilegible" };
      case "codigo_desconocido_certificado": await this.certificar(sol, ctx); return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
      case "codigo_desconocido_no_certificado": return { tipo: "desconocido", motivo: "codigo_no_mapeado" };
      case "timeout_indeterminado": this.indeterminados.add(sol.claveIdempotencia); return { tipo: "desconocido", motivo: "timeout" };
      case "timeout_tardio": this.tardios.push(sol); return { tipo: "desconocido", motivo: "timeout" };
      case "limite_tasa": case "caida": return { tipo: "desconocido", motivo: "limite_o_caida" };
      case "accion_humana": { const ordenId = `ORD-${sol.operacionId}`; this.pendientesHumanos.set(ordenId, sol); return { tipo: "requiere_accion_humana", instruccion: "Simulación: una persona debe completar la emisión en el canal asistido", ordenId }; }
    }
  }
  /** Simula que el servidor procesa por fin las solicitudes «tardías». */
  async liberarTardios(ctx: Contexto): Promise<void> { const ts = this.tardios; this.tardios = []; for (const s of ts) await this.certificar(s, ctx); }
  /** Simula que la persona terminó la emisión asistida: crea el certificado en el servidor y devuelve el resultado que leería el agente. */
  async completarAccionHumana(ordenId: string, ctx: Contexto): Promise<ResultadoEnvio> {
    const s = this.pendientesHumanos.get(ordenId); if (!s) throw new ErrorProveedor("NO_SOPORTADO", "Orden desconocida"); this.pendientesHumanos.delete(ordenId);
    return this.comoResultado(await this.certificar(s, ctx));
  }

  async conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion> {
    this.exigirSimulado(ctx);   // SOLO LECTURA: no modifica el servidor ni los contadores
    if (this.indeterminados.has(op.claveIdempotencia)) return Promise.resolve({ tipo: "indeterminado", motivo: "El proveedor simulado no puede confirmar ni descartar la certificación" });
    if (this.tardios.some((s) => s.claveIdempotencia === op.claveIdempotencia)) return Promise.resolve({ tipo: "indeterminado", motivo: "Hay una solicitud en proceso: no se puede garantizar su ausencia" });
    if ([...this.pendientesHumanos.values()].some((s) => s.claveIdempotencia === op.claveIdempotencia)) return Promise.resolve({ tipo: "indeterminado", motivo: "Pendiente de acción humana" });
    const c = this.servidor.find((x) => x.referencia === op.claveIdempotencia);
    if (c) return Promise.resolve({ tipo: "certificado", serie: c.serie, numero: c.numero, autorizacion: c.autorizacion, fechaCertificacion: c.fechaCertificacion, artefactos: c.artefactos });
    return Promise.resolve({ tipo: "no_existe_confirmado" });
  }
  async obtenerArtefactos(op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]> { this.exigirSimulado(ctx); return this.servidor.find((x) => x.referencia === op.claveIdempotencia)?.artefactos ?? []; }
  async salud(ctx: Contexto): Promise<{ ok: boolean; detalle: string }> { this.exigirSimulado(ctx); return { ok: true, detalle: "mock simulado" }; }

  /** Solicitudes que el servidor aún puede certificar (tardías u órdenes humanas pendientes): lo que una persona NO puede descartar con seguridad. */
  pendientesDe(documentoId: string): number { return this.tardios.filter((s) => s.documentoId === documentoId).length + [...this.pendientesHumanos.values()].filter((s) => s.documentoId === documentoId).length; }
  /** Cuántas certificaciones existen en el «servidor» para un documento (la verdad que importa en las pruebas anti-duplicados). */
  certificacionesDe(documentoId: string): number { return this.servidor.filter((c) => c.documentoId === documentoId).length; }
}
