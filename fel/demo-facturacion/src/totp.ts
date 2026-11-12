// TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, 30 s) para la verificación en dos pasos del administrador de la plataforma en la DEMOSTRACIÓN.
// En producción esto lo hace Supabase Auth (MFA, aal2); aquí solo permite probar el recorrido con una aplicación de autenticación real.
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Uint8Array): string { let bits = 0, valor = 0, out = ""; for (const b of bytes) { valor = (valor << 8) | b; bits += 8; while (bits >= 5) { out += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31]; return out; }
export function deBase32(s: string): Uint8Array { let bits = 0, valor = 0; const out: number[] = []; for (const c of s.toUpperCase().replace(/=+$/, "")) { const i = ALFABETO.indexOf(c); if (i < 0) throw new Error("base32 no válido"); valor = (valor << 5) | i; bits += 5; if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
export const semillaNueva = () => base32(crypto.getRandomValues(new Uint8Array(20)));
export async function codigo(semilla: string, ms: number = Date.now(), paso = 30_000): Promise<string> {
  const contador = Math.floor(ms / paso), msg = new Uint8Array(8); new DataView(msg.buffer).setBigUint64(0, BigInt(contador));
  const k = await crypto.subtle.importKey("raw", deBase32(semilla) as unknown as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, msg)), o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
/** Acepta el código del paso actual y el anterior/siguiente (desfase de reloj); comparación de tiempo constante. */
export async function verificar(semilla: string, entrada: string, ms: number = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(entrada)) return false; let ok = 0;
  for (const d of [-1, 0, 1]) { const c = await codigo(semilla, ms + d * 30_000); let r = 0; for (let i = 0; i < 6; i++) r |= c.charCodeAt(i) ^ entrada.charCodeAt(i); ok |= r === 0 ? 1 : 0; }
  return ok === 1;
}
export const uriOtp = (usuario: string, semilla: string) => `otpauth://totp/NEXA%20FEL%20demo:${encodeURIComponent(usuario)}?secret=${semilla}&issuer=NEXA%20FEL%20demo&digits=6&period=30`;
