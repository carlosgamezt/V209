// REGISTRO DE REGLAS de D1-A. Cada regla indica su ORIGEN y la fuente exacta (archivo oficial, versión, ubicación). Las pruebas llevan el identificador de la regla en el nombre y una prueba
// de cobertura exige que TODA regla registrada tenga al menos una prueba. Si una regla no tiene fuente oficial leída, no se registra ni se implementa.
export interface Regla {
  id: string; descripcion: string;
  origen: "SAT" | "proyecto";                  // «proyecto»: decisión de la autorización de D1-A (no es una regla fiscal)
  recurso: string;                              // ruta relativa dentro de recursos/sat-fel (o «autorizacion-D1-A»)
  version: string | null;                       // versión del archivo (según su nombre) o null
  ubicacion: string;                            // xpath del XSD, código de mensaje del catálogo, etc.
}
const XSD = "XSD/GT_Documento-0.2.1.xsd", MSG = "Catalogos/catalogoMensajes-0.3.0.json", FRA = "Catalogos/CatalogoFrases-0.6.0.json", UG = "Catalogos/catalogoUnidadesGravables-0.1.4.json";
const x = (id: string, ubicacion: string, descripcion: string): Regla => ({ id, descripcion, origen: "SAT", recurso: XSD, version: "0.2.1", ubicacion });
const m = (id: string, codigos: string, descripcion: string, recurso = MSG, version = "0.3.0"): Regla => ({ id, descripcion, origen: "SAT", recurso, version, ubicacion: codigos });

export const REGLAS: Regla[] = [
  // ---------- estructura (XSD)
  x("ESQ-RAIZ", "GTDocumento/SAT/DTE/DatosEmision", "DatosGenerales, Emisor, Receptor, Items y Totales son obligatorios"),
  x("ESQ-TIPO", "DatosGenerales/@Tipo", "El tipo de DTE debe pertenecer a la enumeración del esquema"),
  x("ESQ-FECHA-EMISION", "DatosGenerales/@FechaHoraEmision", "Fecha y hora de emisión: xs:dateTime válido (calendario real); la zona horaria distinta de −06:00 es un aviso"),
  x("ESQ-MONEDA", "DatosGenerales/@CodigoMoneda", "Código de moneda de la enumeración (3 letras)"),
  x("ESQ-NUMERO-ACCESO", "DatosGenerales/@NumeroAcceso", "Entero entre 100000000 y 999999999"),
  x("ESQ-MARCAS", "DatosGenerales/@Exp|@EmisionUbicacionTemporal|@Espectaculo|@Servicio|@Dispositivo|@TipoPersoneria", "Marcas «SI», «Residencial», dispositivo (APP, AV, APPVOZ) y personería (entero ≥ 0)"),
  x("ESQ-EMISOR-NIT", "Emisor/@NITEmisor", "NIT del emisor: patrón del esquema y máximo 13 caracteres"),
  x("ESQ-EMISOR-TEXTOS", "Emisor/@NombreEmisor|@NombreComercial", "Nombre del emisor 1–400 y nombre comercial 1–255 caracteres"),
  x("ESQ-EMISOR-ESTABLECIMIENTO", "Emisor/@CodigoEstablecimiento", "Entero entre 1 y 9999"),
  x("ESQ-EMISOR-AFILIACION", "Emisor/@AfiliacionIVA|@AfiliacionOmiso|@ClasificacionEmisor", "Afiliación al IVA de la enumeración; afiliación de omiso GEN o PEQ; clasificación 1674"),
  x("ESQ-CORREO", "Emisor/@CorreoEmisor|Receptor/@CorreoReceptor", "Correo electrónico según el patrón del esquema"),
  x("ESQ-DIRECCION-EMISOR", "Emisor/DireccionEmisor", "Dirección obligatoria: dirección 1–200, código postal entero, municipio y departamento ≤ 100, país de la enumeración"),
  x("ESQ-RECEPTOR-ID", "Receptor/@IDReceptor", "ID del receptor: 1–18 caracteres con el patrón del esquema (NIT, CUI, CF o extranjero)"),
  x("ESQ-RECEPTOR-TEXTOS", "Receptor/@NombreReceptor|@TipoEspecial|@DestinodelaVenta|DireccionReceptor", "Nombre 1–400; tipo especial CUI o EXT; destino de la venta de la enumeración; dirección opcional con límites"),
  x("ESQ-FRASES-CARDINALIDAD", "Frases/Frase", "Si existe el bloque Frases debe tener entre 1 y 100 frases"),
  x("ESQ-FRASE-CAMPOS", "Frase/@TipoFrase|@CodigoEscenario|@NumeroResolucion|@FechaResolucion", "Tipo 1–12, escenario 1–99, resolución 4–50 caracteres y fecha AAAA-MM-DD válida"),
  x("ESQ-ITEMS-CARDINALIDAD", "Items/Item", "Entre 1 y 9999 ítems"),
  x("ESQ-ITEM-CAMPOS", "Item/@NumeroLinea|@BienOServicio|CodigoProducto|UnidadMedida|Descripcion|Observaciones|Afecto", "Línea 1–9999; B o S; producto de la enumeración; unidad 1–3; descripción 1–10000; observaciones ≤ 50; afecto Si/No"),
  x("ESQ-ITEM-IMPORTES", "Item/Cantidad|PrecioUnitario|Precio|Descuento|OtrosDescuento|Idp|Total", "NumeroNDecimales: texto decimal ≥ 0, hasta 10 decimales y 22 dígitos; Cantidad, PrecioUnitario, Precio y Total obligatorios"),
  x("ESQ-IMPUESTOS-CARDINALIDAD", "Item/Impuestos/Impuesto", "Si existe el bloque Impuestos debe tener 1 o 2 impuestos"),
  x("ESQ-IMPUESTO-CAMPOS", "Impuesto/NombreCorto|CodigoUnidadGravable|MontoGravable|CantidadUnidadesGravables|MontoImpuesto", "Nombre de la enumeración; unidad gravable entero ≥ 1 de hasta 7 dígitos; importes NumeroNDecimales; MontoImpuesto obligatorio"),
  x("ESQ-TOTALES", "Totales/TotalImpuestos/TotalImpuesto|GranTotal", "Hasta 20 totales por impuesto con nombre de la enumeración y monto NumeroNDecimales; GranTotal obligatorio"),
  { id: "PRY-SIN-FLOTANTES", descripcion: "Los importes son texto decimal; un número de coma flotante se rechaza", origen: "proyecto", recurso: "autorizacion-D1-A", version: null, ubicacion: "punto 2 de la autorización de D1-A" },
  // ---------- catálogo de unidades gravables
  m("CAT-UG-EXISTE", "RCP330, RCP334, SEC508, SEC512, SEC515, SEC519, SEC523", "El código de unidad gravable debe existir en el catálogo del impuesto", UG, "0.1.4"),
  m("CAT-UG-CASILLA", "RCP329, SEC502, SEC503, RCP335, SEC509, SEC511, SEC513", "Según el catálogo, el impuesto opera sobre MontoGravable o sobre CantidadUnidadesGravables: la otra casilla no debe estar presente", UG, "0.1.4"),
  // ---------- frases
  m("FRA-CATALOGO", "RCP320 (existencia del escenario)", "El tipo de frase y su código de escenario deben existir en el catálogo de frases", FRA, "0.6.0"),
  m("FRA-UNICA", "RCP487", "Salvo el tipo RANT, el mismo tipo de frase no puede repetirse en el DTE"),
  m("FRA-EXENTO-ITEMS-SIN-IVA", "RCP325", "FACT o FCAM sin exportación con algún ítem sin IVA: debe estar la frase tipo 4 (exento o no afecto)"),
  m("FRA-EXENTO-EXPORTACION", "RCP323", "FACT, FCAM, FACP, NDEB o NCRE con exportación: debe estar la frase tipo 4"),
  m("FRA-ESCENARIOS-9", "RCP112 (cláusulas 1 y 2)", "Frase 9: el escenario 15 solo en FACT/FCAM/FPEQ/FCAP; los escenarios 16 y 17 solo en NABN"),
  // ---------- fechas
  m("FEC-MES-CERTIFICACION", "RCP301", "La fecha de emisión no puede ser posterior al último día del mes de la fecha de certificación (hora de Guatemala)"),
  // ---------- aritmética
  m("ARI-PRECIO", "RCP313", "Precio = Cantidad × PrecioUnitario"),
  m("ARI-DESCUENTO", "RCP314", "Descuento no mayor que Precio"),
  m("ARI-IVA-BASE", "RCP226", "Con unidad gravable de IVA 1: MontoGravable = (Precio − Descuento − OtrosDescuento) / 1.12"),
  m("ARI-IVA-IMPUESTO", "RCP331", "MontoImpuesto = MontoGravable × porcentaje de la unidad gravable (IVA 12 %: 0.12)"),
  m("ARI-TOTAL-ITEM", "RCP348", "Total = Precio − Descuento + suma de los impuestos sumables (el IVA no se suma: ya está incluido)"),
  m("ARI-TOTAL-IMPUESTO", "RCP332", "TotalMontoImpuesto = suma de los MontoImpuesto del mismo impuesto"),
  m("ARI-GRAN-TOTAL", "RCP349", "GranTotal = suma de los Total de todos los ítems"),
  // ---------- escenarios
  { id: "ESC-BLOQUEO", descripcion: "Calcular o certificar un escenario no aprobado se rechaza con error; no se devuelve ningún resultado «válido»", origen: "proyecto", recurso: "autorizacion-D1-A", version: null, ubicacion: "condiciones obligatorias de la autorización de D1-A" },
];
export const REGLA = (id: string): Regla => { const r = REGLAS.find((x) => x.id === id); if (!r) throw new Error(`regla desconocida: ${id}`); return r; };

/** Puntos bloqueados (inventario fiscal D1): NO se implementa nada que dependa de ellos. */
export const PUNTOS_BLOQUEADOS: Record<string, { estado: "bloqueado"; descripcion: string; nota?: string }> = {
  V1: { estado: "bloqueado", descripcion: "IVA incluido en el precio y fórmula de MontoGravable/MontoImpuesto/Total (CÁLCULO)", nota: "Las fórmulas figuran en el texto oficial del catálogo de mensajes (RCP226/331/348) y D1-A solo las usa para VERIFICAR importes declarados con una tolerancia explícita; calcularlos exige además el redondeo (V2)." },
  V2: { estado: "bloqueado", descripcion: "Decimales y redondeo/tolerancia por campo (anexo «Tolerancia en el cálculo de las casillas numéricas» de «Reglas y Validaciones», no disponible)" },
  V3: { estado: "bloqueado", descripcion: "Matriz tipo de DTE × afiliación del IVA × personería (matriz 2.5.1 de «Reglas y Validaciones»)" },
  V4: { estado: "bloqueado", descripcion: "Frases obligatorias por régimen del emisor y tipo de DTE" },
  V5: { estado: "bloqueado", descripcion: "Límite de monto del consumidor final (RCP535/SEC535 no dan el valor)" },
  V6: { estado: "bloqueado", descripcion: "Tipos de DTE que no incluyen impuesto (RCP315) y su cálculo" },
  V7: { estado: "bloqueado", descripcion: "Algoritmos de dígito verificador de NIT y CUI" },
  V8: { estado: "bloqueado", descripcion: "Retenciones de ISR e IVA (porcentajes, umbrales y base)" },
  V9: { estado: "bloqueado", descripcion: "Notas de crédito y débito (IVA, dos meses, importes y referencias)" },
  V10: { estado: "bloqueado", descripcion: "Exportaciones (escenarios válidos, complemento, moneda, tipo de documento)" },
  V11: { estado: "bloqueado", descripcion: "Base de cálculo y sumabilidad de impuestos distintos del IVA" },
  V12: { estado: "bloqueado", descripcion: "Anulación: plazo exacto y calendario" },
};
