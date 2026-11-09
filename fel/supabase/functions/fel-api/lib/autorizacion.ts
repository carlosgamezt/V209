// Decisión de autorización (pura, probada sin red). La API la aplica en CADA operación, aunque use service_role.
import { ErrorFel } from "./errores.ts";

export interface Requisito {
  plataforma?: boolean;   // solo el administrador maestro de NEXA
  permiso?: string;       // permiso efectivo en la empresa indicada
  aal2?: boolean;         // exige verificación en dos pasos (MFA)
}
export interface Estado {
  esPlataforma: boolean;
  permisos: string[] | null;
  aal: string | undefined;
}

export function evaluar(req: Requisito, st: Estado): void {
  if (req.plataforma && !st.esPlataforma) {
    throw new ErrorFel(403, "Solo el administrador maestro puede hacer esto", "no_autorizado");
  }
  if (req.permiso && !(st.permisos ?? []).includes(req.permiso)) {
    throw new ErrorFel(403, "No tienes permiso para esta operación", "no_autorizado");
  }
  if (req.aal2 && st.aal !== "aal2") {
    throw new ErrorFel(403, "Esta operación exige verificación en dos pasos (MFA)", "mfa_requerido");
  }
}
