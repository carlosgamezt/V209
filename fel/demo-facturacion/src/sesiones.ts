// Inicio de sesión de la DEMOSTRACIÓN: usuarios ficticios con contraseña, cookie HttpOnly y sesiones en memoria.
// No es el Auth de producción (ese es Supabase Auth con MFA para el maestro): solo permite probar el recorrido completo sin credenciales reales.
//  · La cookie no es legible desde JavaScript (HttpOnly), SameSite=Strict y «Secure» cuando se sirve por HTTPS.
//  · Sesión normal: expira a los 30 min sin actividad. «Recordar este dispositivo»: 7 días sin actividad y 14 días como máximo.
//  · La contraseña se guarda solo como PBKDF2-SHA256 con sal; hay un límite de intentos fallidos por usuario.
export interface Sesion { id: string; usuario: string; creada: number; ultima: number; recordar: boolean }
const NOMBRE = "fel_sid";
const IDLE_NORMAL = 30 * 60_000, IDLE_RECORDAR = 7 * 86_400_000, MAXIMO_RECORDAR = 14 * 86_400_000, MAXIMO_NORMAL = 12 * 3_600_000;
const MAX_FALLOS = 5, BLOQUEO_MS = 60_000;

import { AlmacenMemoria, type Almacen, type Persona } from "./almacen.ts";
const deHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), (x) => x.toString(16).padStart(2, "0")).join("");
async function derivar(clave: string, sal: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal as unknown as BufferSource, iterations: 60_000 }, k, 256));
}
function iguales(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export class Sesiones {
  /** Contraseña de demostración que la pantalla de inicio puede mostrar; nula cuando las contraseñas son aleatorias (modo remoto). */
  claveDemoPublica: string | null = null;
  /** En modo publicado la cookie es siempre «Secure» (el servicio solo se ofrece por HTTPS). */
  forzarSeguro = false;
  /** Registro de auditoría de los eventos de autenticación (inicio, fallo, bloqueo, cierre, cambio de contraseña); lo conecta el servidor. Nunca recibe contraseñas ni códigos. */
  auditar: (evento: string, usuario: string, detalle?: Record<string, unknown>) => Promise<void> = async () => {};
  constructor(private ahora: () => number = () => Date.now(), readonly almacen: Almacen = new AlmacenMemoria()) {}

  /** Registra (o cambia) la contraseña de una cuenta. `persona` solo hace falta si la cuenta no existía todavía. */
  async registrar(usuario: string, clave: string, persona?: Persona) {
    const sal = hex(crypto.getRandomValues(new Uint8Array(16))), hash = await derivar(clave, deHex(sal)), previa = await this.almacen.cuenta(usuario);
    if (previa) await this.almacen.cambiarHash(usuario, sal, hash); else await this.almacen.guardar({ usuario, persona: persona as Persona, sal, hash });
  }
  /** Comprueba la contraseña actual (cuenta como intento fallido si es errónea; respeta el bloqueo). */
  async verificar(usuario: string, clave: string): Promise<boolean> {
    const f = await this.almacen.fallos(usuario); if (f && f.n >= MAX_FALLOS && f.hasta > this.ahora()) return false;
    const c = await this.almacen.cuenta(usuario); const ok = !!c && iguales(await derivar(clave, deHex(c.sal)), c.hash);
    if (!ok) await this.almacen.ponerFallos(usuario, { n: (f && f.hasta > this.ahora() ? f.n : 0) + 1, hasta: this.ahora() + BLOQUEO_MS }); else if (f) await this.almacen.ponerFallos(usuario, null);
    return ok;
  }
  async cambiarClave(usuario: string, clave: string) { await this.registrar(usuario, clave); await this.almacen.borrarSesionesDe(usuario); await this.auditar("clave_cambiada", usuario); }

  /** Devuelve la sesión nueva o null. El mismo mensaje para usuario inexistente y contraseña errónea. */
  async entrar(usuario: string, clave: string, recordar: boolean, segundo?: (u: string) => Promise<"ok" | "falta" | "mal">): Promise<{ sesion: Sesion | null; bloqueado: boolean; mfa?: "falta" | "mal" }> {
    const f = await this.almacen.fallos(usuario);
    if (f && f.n >= MAX_FALLOS && f.hasta > this.ahora()) { await this.auditar("inicio_bloqueado", usuario); return { sesion: null, bloqueado: true }; }
    const c = await this.almacen.cuenta(usuario);
    const calculado = await derivar(clave, c ? deHex(c.sal) : new Uint8Array(16));
    if (!c || !iguales(calculado, c.hash)) { await this.almacen.ponerFallos(usuario, { n: (f && f.hasta > this.ahora() ? f.n : 0) + 1, hasta: this.ahora() + BLOQUEO_MS }); await this.auditar("inicio_fallido", usuario); return { sesion: null, bloqueado: false }; }
    if (segundo) {   // segundo factor (TOTP): sin él no hay sesión; un código equivocado cuenta como intento fallido, uno ausente no
      const r = await segundo(usuario);
      if (r !== "ok") { if (r === "mal") { await this.almacen.ponerFallos(usuario, { n: ((await this.almacen.fallos(usuario))?.n ?? 0) + 1, hasta: this.ahora() + BLOQUEO_MS }); await this.auditar("mfa_fallido", usuario); } return { sesion: null, bloqueado: false, mfa: r }; }
    }
    if (f) await this.almacen.ponerFallos(usuario, null);
    const s: Sesion = { id: hex(crypto.getRandomValues(new Uint8Array(32))), usuario, creada: this.ahora(), ultima: this.ahora(), recordar };
    await this.almacen.crearSesion(s); await this.auditar("inicio_correcto", usuario, { recordar }); return { sesion: s, bloqueado: false };
  }
  /** Sesión vigente (y renueva su actividad) o null. */
  async validar(id: string | null | undefined): Promise<Sesion | null> {
    if (!id) return null; const s = await this.almacen.obtenerSesion(id); if (!s) return null; const t = this.ahora();
    const ocioso = t - s.ultima > (s.recordar ? IDLE_RECORDAR : IDLE_NORMAL), vencida = t - s.creada > (s.recordar ? MAXIMO_RECORDAR : MAXIMO_NORMAL);
    if (ocioso || vencida) { await this.almacen.borrarSesion(id); return null; }
    await this.almacen.tocarSesion(id, t); return { ...s, ultima: t };
  }
  async salir(id: string | null | undefined) { if (!id) return; const s = await this.almacen.obtenerSesion(id); await this.almacen.borrarSesion(id); if (s) await this.auditar("sesion_cerrada", s.usuario); }
  async cantidad() { return await this.almacen.contarSesiones(); }
  async persona(usuario: string): Promise<Persona | undefined> { return (await this.almacen.cuenta(usuario))?.persona; }

  static idDeCookie(req: Request): string | null { const m = new RegExp(`(?:^|;\\s*)${NOMBRE}=([0-9a-f]{64})(?=;|\\s*$)`).exec(req.headers.get("cookie") ?? ""); return m ? m[1] : null; }
  static cookie(s: Sesion | null, seguro: boolean): string {
    const base = `${NOMBRE}=${s?.id ?? ""}; Path=/; HttpOnly; SameSite=Strict${seguro ? "; Secure" : ""}`;
    return s ? `${base}${s.recordar ? `; Max-Age=${MAXIMO_RECORDAR / 1000}` : ""}` : `${base}; Max-Age=0`;
  }
}
