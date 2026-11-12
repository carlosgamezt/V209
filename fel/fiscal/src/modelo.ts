// MODELO ESTRUCTURAL del DTE, alineado con el esquema oficial GT_Documento-0.2.1.xsd (SAT). Es el contenido de DatosEmision en forma de objeto; NO es el formato NUC de Digifact
// (el adaptador de D3 lo traducirá). Los importes son TEXTO decimal (xs:decimal): nunca `number`.
export type TextoDecimal = string;
export type TipoDte = "FACT" | "FCAM" | "FPEQ" | "FCAP" | "FESP" | "NABN" | "RDON" | "RECI" | "NDEB" | "NCRE" | "CIVA" | "CAIS" | "NEV" | "RANT" | "FACP" | "FEPE" | "FARP" | "FCRP" | "FPEC" | "FCPC" | "BIDP";
export interface DatosGenerales { Tipo: TipoDte | string; FechaHoraEmision: string; CodigoMoneda: string; NumeroAcceso?: number; Exp?: "SI"; EmisionUbicacionTemporal?: "SI"; Espectaculo?: "SI"; TipoPersoneria?: number; Servicio?: "Residencial"; Dispositivo?: "APP" | "AV" | "APPVOZ" }
export interface Direccion { Direccion: string; CodigoPostal: number; Municipio: string; Departamento: string; Pais: string }
export interface Emisor { NITEmisor: string; NombreEmisor: string; CodigoEstablecimiento: number; NombreComercial: string; CorreoEmisor?: string; AfiliacionIVA: string; AfiliacionOmiso?: "GEN" | "PEQ"; ClasificacionEmisor?: number; DireccionEmisor: Direccion }
export interface Receptor { IDReceptor: string; TipoEspecial?: "CUI" | "EXT"; NombreReceptor: string; CorreoReceptor?: string; DestinodelaVenta?: string; DireccionReceptor?: Partial<Direccion> & { Direccion: string } }
export interface Frase { TipoFrase: number; CodigoEscenario: number; NumeroResolucion?: string; FechaResolucion?: string }
export interface Impuesto { NombreCorto: string; CodigoUnidadGravable: number; MontoGravable?: TextoDecimal; CantidadUnidadesGravables?: TextoDecimal; MontoImpuesto: TextoDecimal }
export interface Item {
  NumeroLinea: number; BienOServicio: "B" | "S"; CodigoProducto?: string; Cantidad: TextoDecimal; UnidadMedida?: string; Descripcion: string; PrecioUnitario: TextoDecimal; Observaciones?: string;
  Precio: TextoDecimal; Descuento?: TextoDecimal; OtrosDescuento?: TextoDecimal; Impuestos?: Impuesto[]; Afecto?: "Si" | "No"; Idp?: TextoDecimal; Total: TextoDecimal;
}
export interface TotalImpuesto { NombreCorto: string; TotalMontoImpuesto: TextoDecimal }
export interface Totales { TotalImpuestos?: TotalImpuesto[]; GranTotal: TextoDecimal }
export interface Dte { DatosGenerales: DatosGenerales; Emisor: Emisor; Receptor: Receptor; Frases?: Frase[]; Items: Item[]; Totales: Totales }

/** Hallazgo de una validación. `regla` es el identificador del registro de reglas (con su fuente oficial). */
export interface Violacion { regla: string; severidad: "error" | "aviso"; ruta: string; mensaje: string; esperado?: string; encontrado?: string }
/** Algo que NO se pudo verificar porque su escenario no está aprobado/verificado: nunca se interpreta como «correcto». */
export interface NoVerificable { regla: string; ruta: string; motivo: string; puntos: string[] }
