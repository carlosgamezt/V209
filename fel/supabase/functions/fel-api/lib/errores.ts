// Errores de la API de NEXA FEL. Nunca se devuelve texto interno de la base de datos al cliente.
export class ErrorFel extends Error {
  constructor(public status: number, message: string, public codigo = "error") {
    super(message);
  }
}

// Traduce los errores de PostgreSQL / de nuestras funciones SQL (prefijo FEL_) a respuestas HTTP seguras.
export function traducirErrorPg(e: { message?: string; code?: string } | null | undefined): ErrorFel {
  const msg = String(e?.message ?? "");
  const m = msg.match(/FEL_([A-Z_]+):\s*(.*)$/s);
  if (m) {
    const texto = m[2].trim();
    switch (m[1]) {
      case "NO_AUTORIZADO": return new ErrorFel(403, texto, "no_autorizado");
      case "NO_ENCONTRADO": return new ErrorFel(404, texto, "no_encontrado");
      case "CONFLICTO": return new ErrorFel(409, texto, "conflicto");
      case "REGLA": return new ErrorFel(422, texto, "regla");
      default: return new ErrorFel(500, "Error interno", "interno");
    }
  }
  switch (e?.code) {
    case "23505": return new ErrorFel(409, "Ya existe un registro con esos datos", "duplicado");
    case "23514": return new ErrorFel(422, "Alguno de los datos no es válido", "dato_invalido");
    case "23503": return new ErrorFel(422, "El dato relacionado no existe o no pertenece a la empresa", "relacion_invalida");
    case "42501": return new ErrorFel(403, "No tienes permiso para esta operación", "no_autorizado");
    default: return new ErrorFel(500, "Error interno", "interno");
  }
}
