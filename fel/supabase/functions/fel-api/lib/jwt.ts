// Lectura de claims del JWT. SOLO se usa DESPUÉS de que Supabase Auth validó el token (auth.getUser).
export interface Claims { sub?: string; aal?: string; role?: string; exp?: number; amr?: unknown }

export function decodificarClaims(token: string): Claims {
  const partes = token.split(".");
  if (partes.length !== 3) return {};
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(partes[1].length / 4) * 4, "=");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as Claims;
  } catch {
    return {};
  }
}
