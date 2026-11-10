// Validación manual y estricta de las entradas. Todo lo que no esté en la lista de campos permitidos se rechaza
// (evita "mass assignment": que el cliente intente mandar empresa_id, estado, serie, etc.).
import { ErrorFel } from "./errores.ts";

export type Cuerpo = Record<string, unknown>;

const bad = (campo: string, detalle: string) => new ErrorFel(400, `${campo}: ${detalle}`, "entrada_invalida");

export function soloCampos(b: Cuerpo, permitidos: string[]): void {
  for (const k of Object.keys(b)) {
    if (k !== "accion" && !permitidos.includes(k)) throw bad(k, "campo no permitido");
  }
}

export function texto(b: Cuerpo, campo: string, min: number, max: number): string {
  const v = b[campo];
  if (typeof v !== "string") throw bad(campo, "es obligatorio");
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(campo, `debe tener entre ${min} y ${max} caracteres`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) throw bad(campo, "contiene caracteres no válidos");
  return t;
}

export function textoOpt(b: Cuerpo, campo: string, max: number): string | null {
  const v = b[campo];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  return texto(b, campo, 1, max);
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(b: Cuerpo, campo: string): string {
  const v = b[campo];
  if (typeof v !== "string" || !RE_UUID.test(v)) throw bad(campo, "no es un identificador válido");
  return v.toLowerCase();
}
export function uuidOpt(b: Cuerpo, campo: string): string | null {
  return b[campo] === undefined || b[campo] === null ? null : uuid(b, campo);
}

const RE_EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;
export function email(b: Cuerpo, campo: string): string {
  const t = texto(b, campo, 5, 254).toLowerCase();
  if (!RE_EMAIL.test(t)) throw bad(campo, "no es un correo válido");
  return t;
}
export function emailOpt(b: Cuerpo, campo: string): string | null {
  return textoOpt(b, campo, 254) === null ? null : email(b, campo);
}

// Identificación del comprador: solo se valida el JUEGO DE CARACTERES. El formato oficial de cada tipo (NIT, CUI, etc.)
// lo aplica la base de datos únicamente cuando el tipo fue verificado contra normativa vigente (catálogo identificaciones_tipos).
export function tipoIdentificacion(b: Cuerpo, campo: string): string {
  const t = texto(b, campo, 2, 12).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,11}$/.test(t)) throw bad(campo, "tipo de identificación no válido");
  return t;
}
export function numeroIdentificacion(b: Cuerpo, campo: string): string {
  const t = texto(b, campo, 1, 30).toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9A-Z-]+$/.test(t)) throw bad(campo, "solo letras, números y guion");
  return t;
}
export function fechaOpt(b: Cuerpo, campo: string): string | null {
  const v = b[campo];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(campo, "fecha no válida (AAAA-MM-DD)");
  return v;
}

export function enumerado<T extends string>(b: Cuerpo, campo: string, valores: readonly T[]): T {
  const v = b[campo];
  if (typeof v !== "string" || !(valores as readonly string[]).includes(v)) throw bad(campo, `debe ser uno de: ${valores.join(", ")}`);
  return v as T;
}

// Montos: se aceptan número o texto numérico, con hasta 6 decimales; se devuelven como TEXTO para no perder precisión.
export function montoNoNegativo(b: Cuerpo, campo: string): string {
  const v = b[campo];
  const t = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(t)) throw bad(campo, "debe ser un monto no negativo con hasta 6 decimales");
  return t;
}

export function entero(b: Cuerpo, campo: string, min = 1): number {
  const v = b[campo];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > 2_000_000_000) throw bad(campo, "debe ser un número entero válido");
  return v;
}
export function enteroOpt(b: Cuerpo, campo: string, min = 1): number | null {
  return b[campo] === undefined || b[campo] === null ? null : entero(b, campo, min);
}

const RE_PERMISO = /^[a-z_]+\.[a-z_]+$/;
export function listaPermisos(b: Cuerpo, campo: string): string[] | null {
  const v = b[campo];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 40 || v.some((x) => typeof x !== "string" || !RE_PERMISO.test(x))) {
    throw bad(campo, "debe ser una lista de permisos válidos");
  }
  return [...new Set(v as string[])];
}

export function booleano(b: Cuerpo, campo: string): boolean {
  if (typeof b[campo] !== "boolean") throw bad(campo, "debe ser verdadero o falso");
  return b[campo] as boolean;
}
export function booleanoOpt(b: Cuerpo, campo: string): boolean | null {
  return b[campo] === undefined || b[campo] === null ? null : booleano(b, campo);
}

export function objeto(b: Cuerpo, campo: string): Record<string, unknown> {
  const v = b[campo];
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw bad(campo, "debe ser un objeto");
  return v as Record<string, unknown>;
}
