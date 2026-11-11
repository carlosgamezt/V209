// Contrato de proveedores de emisión (NEXA FEL). SOLO definiciones: sin red, sin credenciales, sin acceso a la base de datos.
// Diseño: fel/docs/saas-proveedores-diseno.md §3. Decisiones: fel/docs/saas-decisiones-arquitectura.md.

export type Ambiente = "simulado" | "pruebas" | "produccion";
/** Identificadores de proveedor. «portal_playwright» (principal) y «digifact» (secundario) son futuros: aquí solo se reservan. */
export type ProveedorId = "mock" | "portal_playwright" | "digifact";

export interface LineaDocumento {
  tipo: "Bien" | "Servicio";
  descripcion: string;
  cantidad: string;        // decimales como texto: nunca float
  precioUnitario: string;
  descuento: string;
}
export interface Receptor { tipoId: "NIT" | "CUI" | "EXT" | "CF"; id: string; nombre?: string; direccion?: string }
/** Contenido inmutable revisado y aprobado; es lo que se hashea y se envía. */
export interface DocumentoCongelado {
  id: string; empresaId: string; establecimientoId: string;
  tipoDte: string;                       // código del catálogo versionado (no se asume ninguno)
  receptor: Receptor; moneda: "GTQ"; fechaEmision: string; // AAAA-MM-DD
  lineas: LineaDocumento[];
  total: string;                          // total declarado: debe coincidir con las líneas
}

export interface Contexto { ambiente: Ambiente; ahora: () => Date; senal?: AbortSignal }

export interface CapacidadesProveedor {
  id: ProveedorId; ambientes: Ambiente[]; tiposDte: string[];
  emiteSinHumano: boolean;        // false en portal_playwright (D3): la emisión final la pulsa una persona
  idempotenciaNativa: boolean;    // ¿el proveedor deduplica por una referencia nuestra?
  consultaPorReferencia: boolean; // ¿se puede conciliar por nuestra referencia?
  entregaXml: boolean; entregaPdf: boolean; soportaAnulacion: boolean; soportaNotaCredito: boolean;
  tiempoMaximoMs: number;         // sin reintento automático
}

export interface ErrorValidacion { codigo: string; campo: string; mensaje: string }
export interface ResultadoValidacion { ok: boolean; errores: ErrorValidacion[] }

export interface SolicitudCertificacion {
  empresaId: string; establecimientoId: string; documentoId: string; operacionId: string;
  claveIdempotencia: string; hashContenido: string;   // ya persistidos antes de enviar (write-ahead)
  instantanea: DocumentoCongelado; ambiente: Ambiente;
}
export interface OperacionRef { empresaId: string; documentoId: string; operacionId: string; claveIdempotencia: string; ambiente: Ambiente }

export interface ArtefactoRef {
  tipo: "xml" | "pdf" | "evidencia"; nombre: string; mime: string; sha256: string;
  contenido?: Uint8Array;     // el mock devuelve el contenido; un adaptador real puede devolver solo una referencia
}
export interface DatosFiscales { serie: string; numero: string; autorizacion: string; fechaCertificacion: string }

export type MotivoDesconocido = "timeout" | "corte" | "respuesta_ilegible" | "codigo_no_mapeado" | "limite_o_caida" | "excepcion_del_adaptador";

/** Solo «certificado» y «rechazado_confirmado» son resultados que el proveedor garantiza. Todo lo demás NO es éxito ni fallo. */
export type ResultadoEnvio =
  | ({ tipo: "certificado"; artefactos: ArtefactoRef[]; crudoSaneado?: unknown } & DatosFiscales)
  | { tipo: "rechazado_confirmado"; codigo: string; mensaje: string; crudoSaneado?: unknown }
  | { tipo: "desconocido"; motivo: MotivoDesconocido }
  | { tipo: "requiere_accion_humana"; instruccion: string; ordenId: string };

export type ResultadoConciliacion =
  | ({ tipo: "certificado"; artefactos: ArtefactoRef[] } & DatosFiscales)
  | { tipo: "no_existe_confirmado" }                              // SOLO si el proveedor lo garantiza
  | { tipo: "indeterminado"; motivo: string };

export interface EmissionProvider {
  readonly capacidades: CapacidadesProveedor;
  validar(doc: DocumentoCongelado, ctx: Contexto): Promise<ResultadoValidacion>;     // sin efectos fiscales
  enviar(sol: SolicitudCertificacion, ctx: Contexto): Promise<ResultadoEnvio>;       // NUNCA reintenta por sí mismo
  conciliar(op: OperacionRef, ctx: Contexto): Promise<ResultadoConciliacion>;        // solo lectura
  obtenerArtefactos(op: OperacionRef, ctx: Contexto): Promise<ArtefactoRef[]>;
  salud(ctx: Contexto): Promise<{ ok: boolean; detalle: string }>;                   // sin efectos
}

/** Catálogo normalizado de errores de adaptador. */
export const CODIGOS_ERROR = ["AUTENTICACION", "VALIDACION_PROVEEDOR", "LIMITE", "RED", "FORMATO", "NO_SOPORTADO", "DESCONOCIDO"] as const;
export type CodigoError = typeof CODIGOS_ERROR[number];
export class ErrorProveedor extends Error {
  constructor(public codigo: CodigoError, mensaje: string) { super(mensaje); this.name = "ErrorProveedor"; }
}
