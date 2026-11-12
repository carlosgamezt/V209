// Motor fiscal NEXA FEL — D1-A (estructura, validación y aritmética EXACTA de verificación). No calcula ni certifica: ver fel/docs/fiscal-d1a-reglas.md.
export * from "./src/error.ts";
export * from "./src/decimal.ts";
export * from "./src/modelo.ts";
export * from "./src/reglas.ts";
export { cargarRecursos, recursos, verificarIntegridad, leerManifiesto, parsearJsonExacto } from "./src/recursos.ts";
export type { Recursos, Manifiesto } from "./src/recursos.ts";
export { extraerEsquema } from "./src/esquema.ts";
export { validarEstructura } from "./src/estructura.ts";
export { validarFrases, tipoFraseExento } from "./src/frases.ts";
export { validarFechaCertificacion } from "./src/fechas.ts";
export { verificarAritmetica, exigirTolerancia } from "./src/aritmetica.ts";
export { calcularDte, certificarDte, prepararCertificacionDte, evaluarAprobacion } from "./src/escenarios.ts";
export { validarDte } from "./src/validar.ts";
export type { OpcionesValidacion, ResultadoValidacion } from "./src/validar.ts";
