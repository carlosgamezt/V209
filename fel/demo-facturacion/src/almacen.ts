// Almacén de cuentas, sesiones e intentos de la DEMOSTRACIÓN. Dos implementaciones con el mismo contrato:
//  · AlmacenMemoria: todo en memoria (demostración local; se pierde al cerrar).
//  · AlmacenPg: tablas demo_credenciales / demo_sesiones / demo_intentos (migración 20261112000800) sobre la base REAL (Supabase/PostgreSQL): persiste entre reinicios y entre instancias.
// Contraseñas = PBKDF2 con sal (las calcula Sesiones); identificadores de sesión = solo su SHA-256; nada sensible en claro.
import type { BdDemo } from "./bd.ts";

export interface Persona { id: string; nombre: string; rol: string; descripcion: string; empresa: string | null }
export interface Cuenta { usuario: string; persona: Persona; sal: string; hash: string }
export interface SesionAlmacen { id: string; usuario: string; creada: number; ultima: number; recordar: boolean }
export interface Fallos { n: number; hasta: number }

export interface Almacen {
  cuenta(usuario: string): Promise<Cuenta | null>;
  cuentas(): Promise<Cuenta[]>;
  cuentaPorId(userId: string): Promise<Cuenta | null>;
  /** Crea la cuenta o, si existe, cambia su sal y hash (no toca la persona). */
  guardar(c: Cuenta): Promise<void>;
  cambiarHash(usuario: string, sal: string, hash: string): Promise<void>;
  fallos(usuario: string): Promise<Fallos | null>;
  ponerFallos(usuario: string, f: Fallos | null): Promise<void>;
  crearSesion(s: SesionAlmacen): Promise<void>;
  obtenerSesion(id: string): Promise<SesionAlmacen | null>;
  tocarSesion(id: string, ultima: number): Promise<void>;
  borrarSesion(id: string): Promise<void>;
  borrarSesionesDe(usuario: string): Promise<void>;
  contarSesiones(): Promise<number>;
}

export class AlmacenMemoria implements Almacen {
  private c = new Map<string, Cuenta>(); private s = new Map<string, SesionAlmacen>(); private f = new Map<string, Fallos>();
  /** `personas`: las cuentas que ya existen en el «mundo» sembrado (la contraseña se registra después). */
  constructor(private personas: Record<string, Persona> = {}) {}
  async cuenta(u: string) { return this.c.get(u) ?? null; }
  async cuentas() { return [...this.c.values()]; }
  async cuentaPorId(id: string) { return [...this.c.values()].find((x) => x.persona.id === id) ?? null; }
  async guardar(c: Cuenta) { const previa = this.c.get(c.usuario); this.c.set(c.usuario, { ...c, persona: previa?.persona ?? c.persona ?? this.personas[c.usuario] }); }
  async cambiarHash(u: string, sal: string, hash: string) { const x = this.c.get(u); if (x) this.c.set(u, { ...x, sal, hash }); }
  async fallos(u: string) { return this.f.get(u) ?? null; }
  async ponerFallos(u: string, f: Fallos | null) { if (f) this.f.set(u, f); else this.f.delete(u); }
  async crearSesion(s: SesionAlmacen) { this.s.set(s.id, s); }
  async obtenerSesion(id: string) { return this.s.get(id) ?? null; }
  async tocarSesion(id: string, ultima: number) { const x = this.s.get(id); if (x) x.ultima = ultima; }
  async borrarSesion(id: string) { this.s.delete(id); }
  async borrarSesionesDe(u: string) { for (const [id, x] of this.s) if (x.usuario === u) this.s.delete(id); }
  async contarSesiones() { return this.s.size; }
}

const sha256 = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (x) => x.toString(16).padStart(2, "0")).join("");
const SEL_CUENTA = `select c.usuario, c.user_id, c.nombre, c.descripcion, c.empresa_id, c.sal, c.hash,
    coalesce((select m.rol from public.miembros m where m.user_id = c.user_id and m.empresa_id = c.empresa_id and m.activo limit 1), case when exists (select 1 from public.plataforma_admins p where p.user_id = c.user_id) then 'maestro' end, 'sin_acceso') as rol
  from public.demo_credenciales c`;
type Fila = { usuario: string; user_id: string; nombre: string; descripcion: string; empresa_id: string | null; sal: string; hash: string; rol: string };
const aCuenta = (f: Fila): Cuenta => ({ usuario: f.usuario, sal: f.sal, hash: f.hash, persona: { id: f.user_id, nombre: f.nombre, rol: f.rol, descripcion: f.descripcion, empresa: f.empresa_id } });

export class AlmacenPg implements Almacen {
  constructor(private bd: BdDemo) {}
  async cuenta(u: string) { const [f] = await this.bd.filas<Fila>(`${SEL_CUENTA} where c.usuario = $1`, [u]); return f ? aCuenta(f) : null; }
  async cuentas() { return (await this.bd.filas<Fila>(`${SEL_CUENTA} order by c.usuario`)).map(aCuenta); }
  async cuentaPorId(id: string) { const [f] = await this.bd.filas<Fila>(`${SEL_CUENTA} where c.user_id = $1`, [id]); return f ? aCuenta(f) : null; }
  async guardar(c: Cuenta) {
    await this.bd.ejecutar(`insert into public.demo_credenciales (usuario, user_id, nombre, descripcion, empresa_id, sal, hash) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (usuario) do update set sal = excluded.sal, hash = excluded.hash, actualizada_en = now()`, [c.usuario, c.persona.id, c.persona.nombre, c.persona.descripcion, c.persona.empresa, c.sal, c.hash]);
  }
  async cambiarHash(u: string, sal: string, hash: string) { await this.bd.ejecutar("update public.demo_credenciales set sal = $2, hash = $3, actualizada_en = now() where usuario = $1", [u, sal, hash]); }
  async fallos(u: string) { const [f] = await this.bd.filas<{ n: number; hasta: Date }>("select n, hasta from public.demo_intentos where usuario = $1", [u]); return f ? { n: f.n, hasta: new Date(f.hasta).getTime() } : null; }
  async ponerFallos(u: string, f: Fallos | null) {
    if (!f) { await this.bd.ejecutar("delete from public.demo_intentos where usuario = $1", [u]); return; }
    await this.bd.ejecutar("insert into public.demo_intentos (usuario, n, hasta) values ($1, $2, $3) on conflict (usuario) do update set n = excluded.n, hasta = excluded.hasta", [u, f.n, new Date(f.hasta)]);
  }
  async crearSesion(s: SesionAlmacen) { await this.bd.ejecutar("insert into public.demo_sesiones (token_hash, usuario, creada_en, ultima_en, recordar) values ($1, $2, $3, $4, $5)", [await sha256(s.id), s.usuario, new Date(s.creada), new Date(s.ultima), s.recordar]); }
  async obtenerSesion(id: string) {
    const [f] = await this.bd.filas<{ usuario: string; creada_en: Date; ultima_en: Date; recordar: boolean }>("select usuario, creada_en, ultima_en, recordar from public.demo_sesiones where token_hash = $1", [await sha256(id)]);
    return f ? { id, usuario: f.usuario, creada: new Date(f.creada_en).getTime(), ultima: new Date(f.ultima_en).getTime(), recordar: f.recordar } : null;
  }
  async tocarSesion(id: string, ultima: number) { await this.bd.ejecutar("update public.demo_sesiones set ultima_en = $2 where token_hash = $1", [await sha256(id), new Date(ultima)]); }
  async borrarSesion(id: string) { await this.bd.ejecutar("delete from public.demo_sesiones where token_hash = $1", [await sha256(id)]); }
  async borrarSesionesDe(u: string) { await this.bd.ejecutar("delete from public.demo_sesiones where usuario = $1", [u]); }
  async contarSesiones() { const [f] = await this.bd.filas<{ n: number }>("select count(*)::int as n from public.demo_sesiones"); return f.n; }
}
