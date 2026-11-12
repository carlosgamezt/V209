// Errores del motor fiscal. Nunca llevan datos de facturas ni de personas.
export class ErrorFiscal extends Error {
  constructor(public codigo: string, mensaje: string) { super(mensaje); this.name = "ErrorFiscal"; }
}
/** Se lanza cuando se intenta CALCULAR o CERTIFICAR un escenario fiscal que la autorización vigente (D1-A) no aprueba. Nunca se devuelve un resultado «aparentemente válido». */
export class EscenarioNoAprobado extends ErrorFiscal {
  constructor(mensaje: string, public escenario: string, public bloqueos: string[]) { super("ESCENARIO_NO_APROBADO", mensaje); this.name = "EscenarioNoAprobado"; }
}
