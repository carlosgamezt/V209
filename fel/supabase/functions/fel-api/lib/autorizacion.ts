// Decisión de autorización (pura, probada sin red). La API la aplica en CADA operación, aunque use service_role.
import { ErrorFel } from "./errores.ts";

export interface Requisito {
  plataforma?: boolean;   // solo el administrador maestro de NEXA
  permiso?: string;       // permiso efectivo en la empresa indicada
  aal2?: boolean;         // exige verificación en dos pasos (MFA)
  aal2Reciente?: boolean; // además, que el código TOTP se haya dado hace poco (acciones sensibles): un aal2 antiguo no basta
}
export interface Estado {
  esPlataforma: boolean;
  permisos: string[] | null;
  aal: string | undefined;
  totpEn?: number | null; // instante (s) del último TOTP registrado en el token
  ahoraS?: number;        // reloj (s); para pruebas
}

// Antigüedad máxima del último código TOTP para acciones sensibles.
export const MAX_EDAD_TOTP_S = 15 * 60;

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
  if (req.aal2Reciente) {
    const ahora = st.ahoraS ?? Math.floor(Date.now() / 1000);
    if (st.aal !== "aal2") throw new ErrorFel(403, "Esta operación exige verificación en dos pasos (MFA)", "mfa_requerido");
    if (!st.totpEn || ahora - st.totpEn > MAX_EDAD_TOTP_S || st.totpEn > ahora + 60) {
      throw new ErrorFel(403, "Confirma de nuevo tu código de verificación para esta operación", "mfa_reciente");
    }
  }
}
