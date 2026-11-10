// Lectura de claims del JWT. SOLO se usa DESPUÉS de que Supabase Auth validó el token (auth.getUser).
export interface Claims { sub?: string; aal?: string; role?: string; exp?: number; iat?: number; amr?: unknown }

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

// Eventos de AUTENTICACIÓN registrados en el token (claim amr de Supabase: [{ method, timestamp }]). Renovar un token NO crea eventos
// nuevos: conserva los de la sesión original. Por eso sirven para saber cuándo se autenticó de verdad la persona.
//   primero = el evento MÁS ANTIGUO: una sesión anterior a la que se le añadió después un TOTP conserva su contraseña antigua.
//   ultimo  = el más reciente (para rechazar instantes imposibles en el futuro).  totp = el último evento TOTP.
export interface EventosAuth { primero: number | null; ultimo: number | null; totp: number | null }
export function eventosAuth(c: Claims): EventosAuth {
  let primero: number | null = null, ultimo: number | null = null, totp: number | null = null;
  if (Array.isArray(c.amr)) {
    for (const e of c.amr) {
      if (typeof e !== "object" || e === null) continue;
      const m = (e as Record<string, unknown>).method, t = (e as Record<string, unknown>).timestamp;
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;   // un evento ilegible se ignora
      primero = primero === null ? t : Math.min(primero, t);
      ultimo = ultimo === null ? t : Math.max(ultimo, t);
      if (m === "totp") totp = totp === null ? t : Math.max(totp, t);
    }
  }
  return { primero, ultimo, totp };
}
