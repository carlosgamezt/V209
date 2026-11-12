// Inicio de sesión de la DEMOSTRACIÓN: usuarios ficticios con contraseña, cookie HttpOnly y sesiones en memoria.
// No es el Auth de producción (ese es Supabase Auth con MFA para el maestro): solo permite probar el recorrido completo sin credenciales reales.
//  · La cookie no es legible desde JavaScript (HttpOnly), SameSite=Strict y «Secure» cuando se sirve por HTTPS.
//  · Sesión normal: expira a los 30 min sin actividad. «Recordar este dispositivo»: 7 días sin actividad y 14 días como máximo.
//  · La contraseña se guarda solo como PBKDF2-SHA256 con sal; hay un límite de intentos fallidos por usuario.
export interface Sesion { id: string; usuario: string; creada: number; ultima: number; recordar: boolean }
const NOMBRE = "fel_sid";
const IDLE_NORMAL = 30 * 60_000, IDLE_RECORDAR = 7 * 86_400_000, MAXIMO_RECORDAR = 14 * 86_400_000, MAXIMO_NORMAL = 12 * 3_600_000;
const MAX_FALLOS = 5, BLOQUEO_MS = 60_000;

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), (x) => x.toString(16).padStart(2, "0")).join("");
async function derivar(clave: string, sal: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal as unknown as BufferSource, iterations: 60_000 }, k, 256));
}
function iguales(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export class Sesiones {
  private cuentas = new Map<string, { sal: Uint8Array; hash: string }>();
  private sesiones = new Map<string, Sesion>();
  private fallos = new Map<string, { n: number; hasta: number }>();
  constructor(private ahora: () => number = () => Date.now()) {}

  async registrar(usuario: string, clave: string) { const sal = crypto.getRandomValues(new Uint8Array(16)); this.cuentas.set(usuario, { sal, hash: await derivar(clave, sal) }); }
  async cambiarClave(usuario: string, clave: string) { await this.registrar(usuario, clave); for (const [id, s] of this.sesiones) if (s.usuario === usuario) this.sesiones.delete(id); }

  /** Devuelve la sesión nueva o null. El mismo mensaje para usuario inexistente y contraseña errónea. */
  async entrar(usuario: string, clave: string, recordar: boolean): Promise<{ sesion: Sesion | null; bloqueado: boolean }> {
    const f = this.fallos.get(usuario);
    if (f && f.n >= MAX_FALLOS && f.hasta > this.ahora()) return { sesion: null, bloqueado: true };
    const c = this.cuentas.get(usuario);
    const sal = c?.sal ?? new Uint8Array(16), calculado = await derivar(clave, sal);
    if (!c || !iguales(calculado, c.hash)) { const n = (f && f.hasta > this.ahora() ? f.n : 0) + 1; this.fallos.set(usuario, { n, hasta: this.ahora() + BLOQUEO_MS }); return { sesion: null, bloqueado: false }; }
    this.fallos.delete(usuario);
    const s: Sesion = { id: hex(crypto.getRandomValues(new Uint8Array(32))), usuario, creada: this.ahora(), ultima: this.ahora(), recordar };
    this.sesiones.set(s.id, s); return { sesion: s, bloqueado: false };
  }
  /** Sesión vigente (y renueva su actividad) o null. */
  validar(id: string | null | undefined): Sesion | null {
    if (!id) return null; const s = this.sesiones.get(id); if (!s) return null; const t = this.ahora();
    const ocioso = t - s.ultima > (s.recordar ? IDLE_RECORDAR : IDLE_NORMAL), vencida = t - s.creada > (s.recordar ? MAXIMO_RECORDAR : MAXIMO_NORMAL);
    if (ocioso || vencida) { this.sesiones.delete(id); return null; }
    s.ultima = t; return s;
  }
  salir(id: string | null | undefined) { if (id) this.sesiones.delete(id); }
  cantidad() { return this.sesiones.size; }

  static idDeCookie(req: Request): string | null { const m = new RegExp(`(?:^|;\\s*)${NOMBRE}=([0-9a-f]{64})`).exec(req.headers.get("cookie") ?? ""); return m ? m[1] : null; }
  static cookie(s: Sesion | null, seguro: boolean): string {
    const base = `${NOMBRE}=${s?.id ?? ""}; Path=/; HttpOnly; SameSite=Strict${seguro ? "; Secure" : ""}`;
    return s ? `${base}${s.recordar ? `; Max-Age=${MAXIMO_RECORDAR / 1000}` : ""}` : `${base}; Max-Age=0`;
  }
}
