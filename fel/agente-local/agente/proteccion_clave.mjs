// PROTECCIÓN de la clave privada Ed25519 del equipo. En Windows se exige DPAPI (ámbito del usuario actual de Windows + entropía propia de la aplicación): la clave nunca se
// guarda en texto plano ni en copias. DPAPI se invoca con el PowerShell que trae Windows (sin módulos nativos ni dependencias), enviando los datos por la entrada estándar
// (nunca por la línea de comandos) y SIN desactivar ninguna protección de Windows (sin «-ExecutionPolicy», sin perfiles). Fuera de Windows (solo desarrollo y pruebas en Linux)
// existe un protector de «archivo restringido» (0600) que se NIEGA a funcionar en Windows: así no hay forma de degradar la protección exigida allí.
import { spawnSync } from "node:child_process";

export const ENTROPIA = Buffer.from("NEXA-FEL/agente-local/clave-ed25519/v1");
export class ErrorProteccion extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Security",
  "$l = [Console]::In.ReadToEnd() -split \"`n\" | ForEach-Object { $_.Trim() }",
  "$e = [Convert]::FromBase64String($l[1]); $d = [Convert]::FromBase64String($l[2])",
  "$ambito = [System.Security.Cryptography.DataProtectionScope]::CurrentUser",
  "if ($l[0] -eq 'P') { $o = [System.Security.Cryptography.ProtectedData]::Protect($d, $e, $ambito) }",
  "elseif ($l[0] -eq 'U') { $o = [System.Security.Cryptography.ProtectedData]::Unprotect($d, $e, $ambito) }",
  "else { throw 'modo no válido' }",
  "[Console]::Out.Write([Convert]::ToBase64String($o))",
].join("\n");
const SCRIPT_CODIFICADO = Buffer.from(SCRIPT, "utf16le").toString("base64");   // -EncodedCommand: sin problemas de comillas, sin archivos temporales
const RE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Ruta ABSOLUTA del PowerShell de Windows (no se busca en el PATH: evita que un programa colocado en el PATH suplante la protección). */
export const rutaPowerShell = (env = process.env) => `${env.SystemRoot ?? env.windir ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

/** Ejecuta DPAPI en PowerShell. `modo`: «P» proteger, «U» desproteger. Los datos viajan por stdin; el error nunca incluye datos. */
export function ejecutarPowerShell(modo, datos, entropia, { env = process.env, spawn = spawnSync } = {}) {
  const entrada = `${modo}\n${Buffer.from(entropia).toString("base64")}\n${Buffer.from(datos).toString("base64")}\n`;
  const r = spawn(rutaPowerShell(env), ["-NoProfile", "-NonInteractive", "-EncodedCommand", SCRIPT_CODIFICADO], { input: entrada, encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 1 << 20 });
  if (r.error) throw new ErrorProteccion("DPAPI_NO_DISPONIBLE", `No se pudo ejecutar PowerShell para DPAPI (${r.error.code ?? "error"})`);
  if (r.status !== 0) throw new ErrorProteccion(modo === "U" ? "DPAPI_NO_DESPROTEGE" : "DPAPI_FALLO", modo === "U" ? "Windows no pudo descifrar la clave (otro usuario/equipo o datos alterados)" : "Windows no pudo proteger la clave");
  const salida = String(r.stdout ?? "").trim();
  if (!RE_B64.test(salida)) throw new ErrorProteccion("DPAPI_RESPUESTA", "Respuesta no válida de DPAPI");
  return Buffer.from(salida, "base64");
}

/** Protector DPAPI (solo Windows). */
export function crearProtectorDpapi({ plataforma = process.platform, ejecutar = ejecutarPowerShell } = {}) {
  if (plataforma !== "win32") throw new ErrorProteccion("SOLO_WINDOWS", "DPAPI solo existe en Windows");
  return {
    nombre: "dpapi",
    proteger: (bytes) => ejecutar("P", bytes, ENTROPIA).toString("base64"),
    desproteger: (b64) => { if (typeof b64 !== "string" || !RE_B64.test(b64)) throw new ErrorProteccion("FORMATO", "Clave protegida con formato no válido"); return ejecutar("U", Buffer.from(b64, "base64"), ENTROPIA); },
  };
}

/** Protector de DESARROLLO (Linux/macOS): el archivo de identidad queda con permisos 0600 en una carpeta 0700. No cifra; por eso se NIEGA a funcionar en Windows. */
export function crearProtectorArchivo({ plataforma = process.platform } = {}) {
  if (plataforma === "win32") throw new ErrorProteccion("PROHIBIDO_EN_WINDOWS", "En Windows la clave debe protegerse con DPAPI; el protector de archivo es solo para desarrollo");
  return { nombre: "archivo_restringido", proteger: (bytes) => Buffer.from(bytes).toString("base64"), desproteger: (b64) => Buffer.from(b64, "base64") };
}

/** Elige el protector de la plataforma: Windows ⇒ DPAPI (sin alternativa); otras ⇒ archivo restringido (desarrollo). */
export function elegirProtector({ plataforma = process.platform, ejecutar } = {}) {
  return plataforma === "win32" ? crearProtectorDpapi({ plataforma, ejecutar }) : crearProtectorArchivo({ plataforma });
}
/** Devuelve el protector que corresponde a un nombre guardado, comprobando que sea válido en esta plataforma. */
export function protectorPorNombre(nombre, { plataforma = process.platform, ejecutar } = {}) {
  if (nombre === "dpapi") return crearProtectorDpapi({ plataforma, ejecutar });
  if (nombre === "archivo_restringido") return crearProtectorArchivo({ plataforma });
  throw new ErrorProteccion("PROTECTOR_DESCONOCIDO", "Protector de clave desconocido");
}
