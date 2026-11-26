// Cifrado de sobre de las credenciales de Digifact de cada empresa (AES-256-GCM). PROPUESTA de la etapa 1 multiempresa: todavía no la usa ninguna ruta.
//  · La base solo guarda el resultado cifrado (`empresa_digifact_config.credencial_cifrada`) y la versión de llave; el texto claro solo existe en la memoria de la función, al usarlo.
//  · El `empresa_id` y la versión de llave entran como DATO AUTENTICADO (AAD): copiar el cifrado de una empresa a otra, o cambiar la versión, hace fallar el descifrado.
//  · Llaves: secretos de la función `FEL_CREDENCIALES_LLAVE_V<n>` (32 bytes en base64) y `FEL_CREDENCIALES_LLAVE_ACTUAL=<n>`; durante una rotación conviven dos.
//  · Ningún error, mensaje ni resultado de JSON contiene credenciales, llaves ni texto cifrado.
// Formato del resultado: [formato=1 (1 byte)] [versión de llave (1 byte)] [nonce (12 bytes)] [texto cifrado + etiqueta GCM (16 bytes)].
export type CodigoCredencial = "LLAVE_NO_DISPONIBLE" | "FORMATO" | "AUTENTICACION" | "ENTRADA" | "CONFIGURACION";
export class ErrorCredencial extends Error {
  constructor(public codigo: CodigoCredencial, mensaje: string) { super(mensaje); this.name = "ErrorCredencial"; }
  toJSON() { return { name: this.name, codigo: this.codigo, mensaje: this.message }; }
}
export interface LlavesCredenciales { actual: number; llaves: ReadonlyMap<number, CryptoKey> }
export interface CredencialDigifact { usuario: string; clave: string }

const FORMATO = 1, NONCE = 12, ENCABEZADO = 2 + NONCE, ETIQUETA = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });

function deBase64(s: string): Uint8Array | null { try { const b = atob(s.trim()); return Uint8Array.from(b, (c) => c.charCodeAt(0)); } catch { return null; } }
const aad = (empresaId: string, version: number) => enc.encode(`nexa-fel|digifact|${empresaId.toLowerCase()}|${version}`);
function exigirEmpresa(empresaId: string) { if (typeof empresaId !== "string" || !UUID.test(empresaId)) throw new ErrorCredencial("ENTRADA", "La empresa no es válida"); }

/** Lee las llaves del entorno. Falla cerrado y nunca muestra el valor de ninguna llave. */
export async function llavesDeEntorno(env: (k: string) => string | undefined): Promise<LlavesCredenciales> {
  const actual = Number(env("FEL_CREDENCIALES_LLAVE_ACTUAL"));
  if (!Number.isInteger(actual) || actual < 1 || actual > 99) throw new ErrorCredencial("CONFIGURACION", "Falta FEL_CREDENCIALES_LLAVE_ACTUAL (entero de 1 a 99)");
  const llaves = new Map<number, CryptoKey>();
  for (let v = 1; v <= 99; v++) {
    const crudo = env(`FEL_CREDENCIALES_LLAVE_V${v}`); if (!crudo) continue;
    const bytes = deBase64(crudo);
    if (!bytes || bytes.length !== 32) throw new ErrorCredencial("CONFIGURACION", `La llave V${v} no es de 32 bytes en base64`);
    llaves.set(v, await crypto.subtle.importKey("raw", bytes as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]));   // no exportable
    bytes.fill(0);
  }
  if (!llaves.has(actual)) throw new ErrorCredencial("CONFIGURACION", `Falta la llave V${actual}, que es la actual`);
  return { actual, llaves };
}

export async function cifrarCredencial(l: LlavesCredenciales, empresaId: string, c: CredencialDigifact): Promise<{ bytes: Uint8Array; version: number }> {
  exigirEmpresa(empresaId);
  const ok = (s: unknown) => typeof s === "string" && s.length >= 1 && s.length <= 256 && !/[\u0000-\u001f]/.test(s);
  if (!c || !ok(c.usuario) || !ok(c.clave)) throw new ErrorCredencial("ENTRADA", "El usuario y la clave son obligatorios (hasta 256 caracteres, sin caracteres de control)");
  const llave = l.llaves.get(l.actual); if (!llave) throw new ErrorCredencial("LLAVE_NO_DISPONIBLE", "No hay llave actual");
  const claro = enc.encode(JSON.stringify({ u: c.usuario, c: c.clave }));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE));
  try {
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as unknown as BufferSource, additionalData: aad(empresaId, l.actual) as unknown as BufferSource, tagLength: 128 }, llave, claro as unknown as BufferSource));
    const out = new Uint8Array(ENCABEZADO + ct.length); out[0] = FORMATO; out[1] = l.actual; out.set(nonce, 2); out.set(ct, ENCABEZADO);
    return { bytes: out, version: l.actual };
  } finally { claro.fill(0); }
}

/** `versionRegistrada` es la `llave_version` de la base: debe coincidir con la que lleva el propio cifrado. */
export async function descifrarCredencial(l: LlavesCredenciales, empresaId: string, bytes: Uint8Array, versionRegistrada: number): Promise<CredencialDigifact> {
  exigirEmpresa(empresaId);
  if (!(bytes instanceof Uint8Array) || bytes.length < ENCABEZADO + ETIQUETA + 1 || bytes.length > 2048 || bytes[0] !== FORMATO) throw new ErrorCredencial("FORMATO", "La credencial guardada no tiene un formato válido");
  const version = bytes[1];
  if (version !== versionRegistrada) throw new ErrorCredencial("FORMATO", "La versión de llave registrada no coincide con la del cifrado");
  const llave = l.llaves.get(version); if (!llave) throw new ErrorCredencial("LLAVE_NO_DISPONIBLE", `La llave V${version} no está disponible`);
  let claro: Uint8Array | null = null;
  try {
    claro = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(2, ENCABEZADO) as unknown as BufferSource, additionalData: aad(empresaId, version) as unknown as BufferSource, tagLength: 128 }, llave, bytes.slice(ENCABEZADO) as unknown as BufferSource));
  } catch { throw new ErrorCredencial("AUTENTICACION", "No se pudo descifrar la credencial (la llave, la empresa o los datos no coinciden)"); }
  try {
    const j = JSON.parse(dec.decode(claro)) as { u?: unknown; c?: unknown };
    if (typeof j.u !== "string" || typeof j.c !== "string") throw new Error();
    return { usuario: j.u, clave: j.c };
  } catch { throw new ErrorCredencial("FORMATO", "El contenido de la credencial no es válido"); }
  finally { claro?.fill(0); }
}

/** Rotación: descifra con la llave del cifrado y vuelve a cifrar con la actual. */
export async function recifrarCredencial(l: LlavesCredenciales, empresaId: string, bytes: Uint8Array, versionRegistrada: number): Promise<{ bytes: Uint8Array; version: number }> {
  return await cifrarCredencial(l, empresaId, await descifrarCredencial(l, empresaId, bytes, versionRegistrada));
}
