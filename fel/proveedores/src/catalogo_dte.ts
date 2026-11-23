// CATÁLOGO CENTRAL de tipos de Documento Tributario Electrónico (DTE) de Guatemala. ÚNICA fuente de verdad: el constructor NUC, el servicio de emisión, la API, el formulario y la migración
// (fel_tipos_dte, que una prueba compara con este archivo) leen de aquí. Añadir un tipo = añadir una entrada; habilitarlo para certificar = cambiarle la disponibilidad Y pasar sus pruebas (ver «estado» abajo).
//
// REGLA DE ORO: que Digifact liste un tipo en su catálogo NO lo habilita aquí. Un tipo solo sale de «pendiente» cuando sus reglas SAT están verificadas con fuente y probadas.
//   · implementado → puede certificarse (hoy solo FACT, que ya funciona y está probada).
//   · en_pruebas   → NEXA construye y valida su NUC y lo muestra (borrador, vista previa, validación local), pero NO lo prepara ni lo certifica (ni real ni TEST). La base lo impide también.
//   · pendiente    → catalogado (nombre y código), pero no se puede elegir ni emitir; «motivoPendiente» dice qué falta.
//
// FUENTES: catálogo `doctype` de Digifact GT (leído el 14/11/2026), NUC JSON V2.0.3 §4.7 (complementos) y ejemplos «NUC 4 - NCRE.json»; reglas SAT del repositorio (fiscal/src/reglas.ts).
// Los puntos que el propio inventario fiscal marca como BLOQUEADOS (V3 matriz tipo×afiliación×personería, V4 frases por régimen, V6 tipos sin impuesto, V9 notas de crédito/débito, V10 exportación)
// se declaran aquí como «verificado: false»: son la razón por la que ningún tipo nuevo certifica todavía.

export type CodigoDte = "FACT" | "FCAM" | "FPEQ" | "FCAP" | "FESP" | "NABN" | "RDON" | "RECI" | "NDEB" | "NCRE" | "FEPE" | "FARP" | "FCRP" | "FPEC" | "FCPC" | "CIVA" | "CAIS";
export type Disponibilidad = "implementado" | "en_pruebas" | "pendiente";
export type FamiliaDte = "factura" | "nota" | "recibo" | "constancia" | "especial";
export type AfiliacionIvaDte = "GEN" | "PEQ" | "PEE" | "EXE" | "PRI" | "PEC";

export interface TipoDte {
  /** Código SAT del tipo (el que viaja en DocType del NUC). */
  codigo: CodigoDte;
  /** Código con el que Digifact lo publica en su catálogo `doctype`, si difiere del de la SAT (su documentación no es consistente: ver observación). */
  codigoDigifact?: string;
  nombre: string;
  /** Nombre corto para el selector compacto del formulario. */
  corto: string;
  familia: FamiliaDte;
  disponibilidad: Disponibilidad;
  /** ¿Puede prepararse y certificarse? Solo true cuando la disponibilidad es «implementado». La base de datos lo repite (fel_tipos_dte.certificacion_habilitada) y bloquea las operaciones fiscales si es false. */
  certificacionHabilitada: boolean;
  /** Régimen o condición de habilitación del EMISOR. «verificado: false» = NO confirmado contra «Reglas y Validaciones» de la SAT. */
  regimen: { condicion: string; afiliaciones?: AfiliacionIvaDte[]; verificado: boolean };
  /** ¿Cada empresa debe habilitarlo expresamente (con su base legal) antes de poder elegirlo? FACT es el predeterminado histórico y no lo exige. */
  habilitacionExplicita: boolean;
  /** Campos propios del tipo, además de los de toda factura (receptor, ítems, fecha…). Nombres lógicos de NEXA; los valida validarReglasTipo. */
  camposObligatorios: string[];
  /** Complementos fiscales necesarios (códigos del NUC en AdditionalInfo.Code). */
  complementos: string[];
  /** Notas de crédito/débito: exigen un documento certificado previo al que hacen referencia. */
  requiereOrigen: boolean;
  /** Tipos de documento que pueden ser el origen de esta nota (nunca otra nota ni un recibo). */
  origenesPermitidos: CodigoDte[];
  /** La frase tipo 1 (régimen del emisor) es obligatoria. Hoy solo se exige donde ya estaba comprobada (FACT). */
  exigeFraseTipo1: boolean;
  /** ¿Admite consumidor final (CF)? Las notas heredan el receptor del documento de origen. */
  admiteConsumidorFinal: boolean;
  /** Título del documento en pantalla, vista previa y PDF (distinto del nombre del tipo: «Nueva…» / «Nuevo documento»). */
  tituloDocumento: string;
  /** Qué falta para pasar de estado (siempre presente salvo en «implementado»). */
  motivoPendiente?: string;
  /** Qué hay que confirmar con la SAT o Digifact antes de certificar, aunque el tipo esté en pruebas. */
  pendientesVerificar: string[];
  fuentes: string[];
}

const DIGIFACT = "Digifact GT · catálogo doctype (14/11/2026)", NUC = "Digifact GT · NUC JSON V2.0.3 §4.7", EJ_NCRE = "Digifact GT · ejemplo «NUC 4 - NCRE.json»", REGLAS = "fiscal/src/reglas.ts · puntos bloqueados V3, V4, V6, V9";
const PEND_GENERAL = "Matriz tipo × afiliación × personería (V3) y frases por régimen (V4) del documento «Reglas y Validaciones» de la SAT: no disponible.";

const base = (t: Partial<TipoDte> & Pick<TipoDte, "codigo" | "nombre" | "corto" | "familia" | "disponibilidad" | "tituloDocumento">): TipoDte => ({
  certificacionHabilitada: false, regimen: { condicion: "Sin confirmar", verificado: false }, habilitacionExplicita: true, camposObligatorios: [], complementos: [],
  requiereOrigen: false, origenesPermitidos: [], exigeFraseTipo1: false, admiteConsumidorFinal: false, pendientesVerificar: [], fuentes: [DIGIFACT], ...t,
});

export const CATALOGO_DTE: readonly TipoDte[] = Object.freeze([
  base({
    codigo: "FACT", nombre: "Factura", corto: "Factura", familia: "factura", disponibilidad: "implementado", certificacionHabilitada: true, habilitacionExplicita: false, tituloDocumento: "Factura",
    regimen: { condicion: "Contribuyente afecto al IVA. Es el tipo con el que ya se certifica en TEST; su comportamiento no cambia.", verificado: true },
    exigeFraseTipo1: true, admiteConsumidorFinal: true, camposObligatorios: [], complementos: [],
    pendientesVerificar: [], fuentes: [DIGIFACT, NUC],
  }),
  base({
    codigo: "NCRE", nombre: "Nota de crédito", corto: "Nota de crédito", familia: "nota", disponibilidad: "en_pruebas", tituloDocumento: "Nota de crédito",
    regimen: { condicion: "Sobre un DTE ya certificado del mismo emisor y receptor; disminuye lo facturado. El emisor debe poder emitir el tipo de documento de origen.", verificado: false },
    requiereOrigen: true, origenesPermitidos: ["FACT"], complementos: ["NCRE"],
    camposObligatorios: ["documento_origen", "motivo_ajuste"],
    motivoPendiente: "Certificación bloqueada: reglas SAT de notas (V9: IVA, plazo de dos meses, importes y referencias) sin confirmar. Solo borrador, validación local y vista previa.",
    pendientesVerificar: ["V9: plazo máximo entre el documento de origen y la nota", "V9: IVA y tope del importe frente al documento de origen", "Serie y número del origen en régimen FEL (el ejemplo oficial los incluye; el texto del NUC los describe solo para papel/FACE1)", PEND_GENERAL],
    fuentes: [DIGIFACT, NUC, EJ_NCRE, REGLAS],
  }),
  base({
    codigo: "NDEB", nombre: "Nota de débito", corto: "Nota de débito", familia: "nota", disponibilidad: "en_pruebas", tituloDocumento: "Nota de débito",
    regimen: { condicion: "Sobre un DTE ya certificado del mismo emisor y receptor; aumenta lo facturado (cargos adicionales).", verificado: false },
    requiereOrigen: true, origenesPermitidos: ["FACT"], complementos: ["NDEB"],
    camposObligatorios: ["documento_origen", "motivo_ajuste"],
    motivoPendiente: "Certificación bloqueada: reglas SAT de notas (V9) sin confirmar y sin ejemplo JSON oficial de NDEB leído; se usa la estructura común de NCRE/NDEB del NUC V2.0.3.",
    pendientesVerificar: ["Ejemplo oficial «NUC 3 - NDEB.json» (no leído)", "V9: plazo, IVA e importes frente al origen", PEND_GENERAL],
    fuentes: [DIGIFACT, NUC, REGLAS],
  }),
  base({
    codigo: "RECI", nombre: "Recibo", corto: "Recibo", familia: "recibo", disponibilidad: "en_pruebas", tituloDocumento: "Recibo",
    regimen: { condicion: "Comprobante de pago que NO es factura. Solo para emisores fiscalmente habilitados para emitirlo; cada empresa debe habilitarlo expresamente con su base legal.", verificado: false },
    habilitacionExplicita: true, camposObligatorios: ["tipo_recibo"], complementos: [],
    motivoPendiente: "Certificación bloqueada: se desconoce qué emisores pueden emitir RECI (V3), si lleva IVA (V6) y las frases que exige (V4). Solo borrador, validación local y vista previa.",
    pendientesVerificar: ["Quién puede emitir RECI (matriz tipo × afiliación × personería, V3)", "Tratamiento del IVA del recibo (V6)", "Frases obligatorias (V4)", "Ejemplos oficiales de RECI (Digifact: «NUC 7 - RECI.xml» y variantes; no leídos)"],
    fuentes: [DIGIFACT, NUC, REGLAS],
  }),
  base({
    codigo: "FCAM", codigoDigifact: "FACM", nombre: "Factura cambiaria", corto: "Fact. cambiaria", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura cambiaria",
    regimen: { condicion: "Contribuyente afecto al IVA, con efecto cambiario (pago a plazo).", verificado: false },
    admiteConsumidorFinal: false, camposObligatorios: ["abonos"], complementos: ["FCAMB"],
    motivoPendiente: "Falta el complemento de abonos (FCAMB: número, vencimiento y monto) con su ejemplo JSON oficial y sus reglas. Además la documentación de Digifact es inconsistente: su catálogo la publica como FACM y el resto del manual como FCAM.",
    pendientesVerificar: ["Código real aceptado por la API: FCAM o FACM", "Estructura JSON del complemento FCAMB", "Reglas de abonos (suma, fechas)"],
    fuentes: [DIGIFACT, NUC],
  }),
  base({
    codigo: "FPEQ", nombre: "Factura pequeño contribuyente", corto: "Fact. peq. contrib.", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura pequeño contribuyente",
    regimen: { condicion: "Contribuyente inscrito en el régimen de pequeño contribuyente (afiliación PEQ).", afiliaciones: ["PEQ"], verificado: false },
    admiteConsumidorFinal: true,
    motivoPendiente: "No incluye IVA y el inventario fiscal marca ese cálculo como bloqueado (V6), igual que su matriz de afiliación (V3) y sus frases (V4). Sin confirmarlos, certificarla produciría documentos incorrectos.",
    pendientesVerificar: ["V6: tratamiento sin IVA", "V3: matriz de afiliación", "V4: frases del régimen"],
    fuentes: [DIGIFACT, REGLAS],
  }),
  base({ codigo: "FCAP", nombre: "Factura cambiaria pequeño contribuyente", corto: "Cambiaria peq.", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura cambiaria pequeño contribuyente",
    regimen: { condicion: "Pequeño contribuyente con efecto cambiario.", afiliaciones: ["PEQ"], verificado: false }, complementos: ["FCAMB"], camposObligatorios: ["abonos"],
    motivoPendiente: "Depende de FCAM (complemento FCAMB) y de FPEQ (V6, V3, V4).", pendientesVerificar: ["Lo de FCAM y FPEQ"], fuentes: [DIGIFACT, REGLAS] }),
  base({ codigo: "FESP", nombre: "Factura especial", corto: "Fact. especial", familia: "especial", disponibilidad: "pendiente", tituloDocumento: "Factura especial", complementos: ["FESP"], camposObligatorios: ["retencion_isr", "total_menos_retenciones"],
    regimen: { condicion: "El comprador factura por cuenta de quien no emite factura (con retenciones).", verificado: false }, motivoPendiente: "Retenciones de ISR e IVA (V8) bloqueadas.", pendientesVerificar: ["V8: porcentajes, umbrales y base de retenciones"], fuentes: [DIGIFACT, NUC, REGLAS] }),
  base({ codigo: "NABN", nombre: "Nota de abono", corto: "Nota de abono", familia: "nota", disponibilidad: "pendiente", tituloDocumento: "Nota de abono", requiereOrigen: true,
    regimen: { condicion: "Abono sobre un saldo pendiente.", verificado: false }, motivoPendiente: "Sin reglas ni ejemplo leídos (frase 9 escenarios 16 y 17 solo en NABN).", pendientesVerificar: ["Reglas y complemento de NABN"] }),
  base({ codigo: "RDON", nombre: "Recibo por donación", corto: "Recibo donación", familia: "recibo", disponibilidad: "pendiente", tituloDocumento: "Recibo por donación",
    regimen: { condicion: "Solo personerías autorizadas para recibir donaciones (TipoPersoneria obligatorio).", verificado: false }, motivoPendiente: "Requiere el tipo de personería del emisor y su autorización: no modelados.", pendientesVerificar: ["Tipos de personería habilitados"] }),
  base({ codigo: "FEPE", nombre: "Factura específica", corto: "Fact. específica", familia: "especial", disponibilidad: "pendiente", tituloDocumento: "Factura específica", complementos: ["FEPE"], regimen: { condicion: "Retención ICT.", verificado: false }, motivoPendiente: "Retención ICT sin reglas (V8).", pendientesVerificar: ["V8"] }),
  base({ codigo: "FARP", nombre: "Factura contribuyente régimen primario", corto: "Régimen primario", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura régimen primario", regimen: { condicion: "Régimen primario (PRI).", afiliaciones: ["PRI"], verificado: false }, motivoPendiente: PEND_GENERAL, pendientesVerificar: [PEND_GENERAL] }),
  base({ codigo: "FCRP", nombre: "Factura cambiaria contribuyente régimen primario", corto: "Cambiaria PRI", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura cambiaria régimen primario", regimen: { condicion: "Régimen primario con efecto cambiario.", afiliaciones: ["PRI"], verificado: false }, complementos: ["FCAMB"], motivoPendiente: PEND_GENERAL, pendientesVerificar: [PEND_GENERAL] }),
  base({ codigo: "FPEC", nombre: "Factura contribuyente régimen pecuario", corto: "Régimen pecuario", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura régimen pecuario", regimen: { condicion: "Régimen pecuario (PEC).", afiliaciones: ["PEC"], verificado: false }, motivoPendiente: PEND_GENERAL, pendientesVerificar: [PEND_GENERAL] }),
  base({ codigo: "FCPC", nombre: "Factura cambiaria contribuyente régimen pecuario", corto: "Cambiaria PEC", familia: "factura", disponibilidad: "pendiente", tituloDocumento: "Factura cambiaria régimen pecuario", regimen: { condicion: "Régimen pecuario con efecto cambiario.", afiliaciones: ["PEC"], verificado: false }, complementos: ["FCAMB"], motivoPendiente: PEND_GENERAL, pendientesVerificar: [PEND_GENERAL] }),
  base({ codigo: "CIVA", nombre: "Constancia de exención de IVA", corto: "Const. exención IVA", familia: "constancia", disponibilidad: "pendiente", tituloDocumento: "Constancia de exención de IVA", complementos: ["REFCONST"], regimen: { condicion: "Emitida por un ente exento a quien le facturaron con IVA.", verificado: false }, motivoPendiente: "Complemento REFCONST y reglas sin leer.", pendientesVerificar: ["REFCONST"] }),
  base({ codigo: "CAIS", nombre: "Constancia de adquisición de insumos y servicios", corto: "Const. insumos", familia: "constancia", disponibilidad: "pendiente", tituloDocumento: "Constancia de adquisición de insumos y servicios", regimen: { condicion: "—", verificado: false }, motivoPendiente: "Digifact la marca «No aceptado por el momento».", pendientesVerificar: ["Aceptación por la SAT/Digifact"] }),
]);

const POR_CODIGO = new Map<string, TipoDte>(CATALOGO_DTE.map((t) => [t.codigo, t]));
export const TIPO_PREDETERMINADO_GLOBAL: CodigoDte = "FACT";

export function tipoDte(codigo: string): TipoDte | undefined { return POR_CODIGO.get(codigo); }
export function esCodigoDte(c: unknown): c is CodigoDte { return typeof c === "string" && POR_CODIGO.has(c); }
/** Tipos que se pueden ELEGIR en un documento (implementados o en pruebas); los pendientes solo se listan. */
export function tiposElegibles(): readonly TipoDte[] { return CATALOGO_DTE.filter((t) => t.disponibilidad !== "pendiente"); }
export function puedeCertificar(codigo: string): boolean { const t = tipoDte(codigo); return !!t && t.disponibilidad === "implementado" && t.certificacionHabilitada; }

/** Configuración de la empresa: qué tipos habilitó (con su base legal) y cuál es el predeterminado. FACT no necesita habilitación expresa. */
export interface ConfigTiposEmpresa { habilitados: ReadonlyArray<{ tipo: string; baseHabilitacion?: string | null }>; predeterminado?: string | null }

/** ¿Está el tipo habilitado PARA ESTA EMPRESA? Elegible en el catálogo + (FACT, o habilitación expresa; el recibo exige además su base legal escrita). */
export function habilitadoParaEmpresa(codigo: string, cfg: ConfigTiposEmpresa): { ok: true } | { ok: false; motivo: string } {
  const t = tipoDte(codigo);
  if (!t) return { ok: false, motivo: "Tipo de documento desconocido" };
  if (t.disponibilidad === "pendiente") return { ok: false, motivo: `${t.nombre} aún no está disponible: ${t.motivoPendiente ?? "pendiente"}` };
  if (!t.habilitacionExplicita) return { ok: true };
  const h = cfg.habilitados.find((x) => x.tipo === codigo);
  if (!h) return { ok: false, motivo: `${t.nombre} no está habilitado para esta empresa` };
  if (t.familia === "recibo" && !(h.baseHabilitacion ?? "").trim()) return { ok: false, motivo: "El recibo exige registrar la base que habilita a la empresa para emitirlo" };
  return { ok: true };
}
/** Tipos que la empresa puede usar hoy, con el predeterminado resuelto (el configurado si sigue habilitado; si no, Factura). */
export function tiposDeEmpresa(cfg: ConfigTiposEmpresa): { tipos: TipoDte[]; predeterminado: CodigoDte } {
  const tipos = tiposElegibles().filter((t) => habilitadoParaEmpresa(t.codigo, cfg).ok);
  const p = cfg.predeterminado && tipos.some((t) => t.codigo === cfg.predeterminado) ? cfg.predeterminado as CodigoDte : TIPO_PREDETERMINADO_GLOBAL;
  return { tipos, predeterminado: p };
}

/** Referencia fiscal del documento de origen de una nota, copiada del documento CERTIFICADO (nunca escrita a mano). */
export interface ReferenciaOrigen { documentoId: string; tipo: string; autorizacion: string; fechaEmision: string; serie: string; numero: string; total: string; receptorId: string }

export interface ErrorRegla { campo: string; mensaje: string }
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaReal = (s: string) => { if (!FECHA_ISO.test(s)) return false; const d = new Date(s + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

export interface DatosTipo {
  tipo: string; fechaEmision: string;                       // AAAA-MM-DD (o fecha-hora ISO: se usan los 10 primeros)
  receptorId?: string; esConsumidorFinal?: boolean;
  origen?: ReferenciaOrigen | null; motivoAjuste?: string | null; tipoRecibo?: string | null;
}
export const TIPOS_RECIBO = ["Universidad", "Colegio", "Inmobiliaria"] as const;

/** Validaciones propias de cada tipo (independientes del NUC y de la base; las tres capas se comprueban entre sí). */
export function validarReglasTipo(d: DatosTipo): ErrorRegla[] {
  const e: ErrorRegla[] = [], t = tipoDte(d.tipo);
  if (!t) return [{ campo: "tipo", mensaje: "tipo de documento desconocido" }];
  const fecha = d.fechaEmision.slice(0, 10);
  if (t.requiereOrigen) {
    const o = d.origen;
    if (!o) e.push({ campo: "documento_origen", mensaje: `${t.nombre}: elige el documento certificado al que hace referencia` });
    else {
      if (!t.origenesPermitidos.includes(o.tipo as CodigoDte)) e.push({ campo: "documento_origen", mensaje: `${t.nombre}: el documento de origen debe ser ${t.origenesPermitidos.join(" o ")}, no ${o.tipo}` });
      if (!UUID.test(o.autorizacion)) e.push({ campo: "documento_origen.autorizacion", mensaje: "el origen no tiene un número de autorización SAT válido (¿está certificado?)" });
      if (!fechaReal(o.fechaEmision)) e.push({ campo: "documento_origen.fechaEmision", mensaje: "fecha de emisión del origen no válida" });
      else if (fechaReal(fecha) && o.fechaEmision > fecha) e.push({ campo: "documento_origen.fechaEmision", mensaje: "la nota no puede ser anterior al documento al que hace referencia" });
      if (!o.serie || o.serie.length > 20) e.push({ campo: "documento_origen.serie", mensaje: "serie del origen: 1 a 20 caracteres" });
      if (!o.numero || o.numero.length > 20) e.push({ campo: "documento_origen.numero", mensaje: "número del origen: 1 a 20 caracteres" });
      if (d.receptorId !== undefined && d.receptorId !== o.receptorId) e.push({ campo: "receptor", mensaje: "la nota debe dirigirse al mismo receptor del documento de origen" });
    }
    const m = (d.motivoAjuste ?? "").trim();
    if (m.length < 3 || m.length > 50) e.push({ campo: "motivo_ajuste", mensaje: "indica el motivo del ajuste (3 a 50 caracteres)" });
  } else {
    if (d.origen) e.push({ campo: "documento_origen", mensaje: `${t.nombre} no hace referencia a otro documento` });
    if (d.motivoAjuste) e.push({ campo: "motivo_ajuste", mensaje: `${t.nombre} no lleva motivo de ajuste` });
  }
  if (t.codigo === "RECI") {
    if (!(TIPOS_RECIBO as readonly string[]).includes(d.tipoRecibo ?? "")) e.push({ campo: "tipo_recibo", mensaje: `el recibo exige su tipo: ${TIPOS_RECIBO.join(", ")}` });
  } else if (d.tipoRecibo) e.push({ campo: "tipo_recibo", mensaje: `${t.nombre} no lleva tipo de recibo` });
  if (t.codigo !== "FACT" && d.esConsumidorFinal && !t.admiteConsumidorFinal && !t.requiereOrigen) e.push({ campo: "receptor", mensaje: `${t.nombre} no se emite a consumidor final` });
  return e;
}
