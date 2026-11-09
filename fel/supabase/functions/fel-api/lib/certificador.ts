// Interfaz INTERNA para una futura integración autorizada con SAT / un certificador.
// En la Fase 1 NO se implementa nada real: no hay credenciales, no hay automatización del portal y nunca se generan
// serie, número ni autorización. Las credenciales (cuando existan) irán en los secretos de Supabase, nunca en tablas.
export interface DocumentoParaCertificar {
  empresaId: string;
  documentoId: string;
  tipo: "factura";
  // El contenido fiscal definitivo se definirá con la validación del certificador autorizado.
  datos: Record<string, unknown>;
}

export interface ResultadoCertificacion {
  estado: "certificada" | "rechazada" | "por_verificar";
  // Solo con confirmación verificable del certificador:
  serie?: string;
  numeroFiscal?: string;
  autorizacionSat?: string;
  detalle?: string;
}

export interface ProveedorCertificacion {
  readonly nombre: string;
  certificar(doc: DocumentoParaCertificar): Promise<ResultadoCertificacion>;
  consultar(empresaId: string, documentoId: string): Promise<ResultadoCertificacion>;
}

export class CertificadorNoConfigurado extends Error {
  constructor() {
    super("La certificación no está configurada ni habilitada en esta versión de NEXA FEL");
  }
}

export const certificadorNoConfigurado: ProveedorCertificacion = {
  nombre: "no_configurado",
  certificar: () => Promise.reject(new CertificadorNoConfigurado()),
  consultar: () => Promise.reject(new CertificadorNoConfigurado()),
};
