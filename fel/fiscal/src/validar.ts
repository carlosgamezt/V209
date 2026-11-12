// VALIDACIÓN COMPLETA de un DTE (D1-A): estructura + frases + fechas + aritmética (verificación). Es de SOLO LECTURA: no corrige, no calcula, no certifica.
// `aprobadoParaCertificar` es siempre `false` en D1-A: un DTE sin violaciones solo significa «no se detectó incumplimiento de las reglas respaldadas», no que sea fiscalmente válido.
import { ErrorFiscal } from "./error.ts";
import { exigirTolerancia, verificarAritmetica } from "./aritmetica.ts";
import { validarEstructura } from "./estructura.ts";
import { validarFechaCertificacion } from "./fechas.ts";
import { validarFrases } from "./frases.ts";
import { evaluarAprobacion } from "./escenarios.ts";
import type { Dte, NoVerificable, Violacion } from "./modelo.ts";
import type { Recursos } from "./recursos.ts";

export interface OpcionesValidacion { tolerancia: string; fechaCertificacion?: string }
export interface ResultadoValidacion {
  estructuraValida: boolean; violaciones: Violacion[]; avisos: Violacion[]; noVerificable: NoVerificable[];
  aritmetica: "verificada" | "parcial" | "omitida"; fechas: "verificada" | "omitida";
  aprobadoParaCertificar: false; bloqueos: string[];
  recursos: { fuente: string; commit: string; descargado: string };
}
export function validarDte(entrada: unknown, rec: Recursos, op: OpcionesValidacion): ResultadoValidacion {
  if (!op || typeof op !== "object") throw new ErrorFiscal("OPCIONES_OBLIGATORIAS", "Las opciones de validación (con tolerancia) son obligatorias");
  exigirTolerancia(op.tolerancia); // obligatoria siempre, aun si la estructura falla: sin valor predeterminado
  const todas: Violacion[] = validarEstructura(entrada, rec.esquema); let noVerificable: NoVerificable[] = [];
  let aritmetica: ResultadoValidacion["aritmetica"] = "omitida", fechas: ResultadoValidacion["fechas"] = "omitida";
  const estructuraValida = !todas.some((v) => v.severidad === "error");
  if (estructuraValida) {
    const dte = entrada as Dte;
    todas.push(...validarFrases(dte, rec));
    if (op.fechaCertificacion !== undefined) { todas.push(...validarFechaCertificacion(dte.DatosGenerales.FechaHoraEmision, op.fechaCertificacion)); fechas = "verificada"; }
    const a = verificarAritmetica(dte, rec, { tolerancia: op.tolerancia });
    todas.push(...a.violaciones); noVerificable = a.noVerificable; aritmetica = a.noVerificable.length ? "parcial" : "verificada";
  }
  return {
    estructuraValida, violaciones: todas.filter((v) => v.severidad === "error"), avisos: todas.filter((v) => v.severidad === "aviso"), noVerificable, aritmetica, fechas,
    aprobadoParaCertificar: false, bloqueos: evaluarAprobacion(entrada).bloqueos,
    recursos: { fuente: rec.manifiesto.fuente.url, commit: rec.manifiesto.referencia.commit, descargado: rec.manifiesto.descargado },
  };
}
