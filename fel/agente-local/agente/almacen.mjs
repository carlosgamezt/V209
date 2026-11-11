// Almacén local del agente: identidad (clave privada del equipo) y diario de la orden en curso. Carpeta propia con permisos restringidos.
// PENDIENTE (instalador de Windows, no autorizado todavía): proteger la clave con DPAPI/Credential Manager. Aquí: archivo 0600 en una carpeta 0700.
// La identidad NO contiene credenciales de SAT (el agente no las conoce ni las guarda).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function abrirAlmacen(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); try { chmodSync(dir, 0o700); } catch { /* sistemas sin permisos POSIX */ }
  const ruta = (n) => join(dir, n);
  const leer = (n) => { try { return JSON.parse(readFileSync(ruta(n), "utf8")); } catch { return null; } };
  const escribir = (n, v) => { const tmp = ruta(`${n}.tmp`); writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); renameSync(tmp, ruta(n)); };   // escritura atómica
  return {
    dir, perfil: ruta("perfil-chromium"),
    identidad: () => leer("identidad.json"), guardarIdentidad: (v) => escribir("identidad.json", v),
    diario: () => leer("diario.json"), guardarDiario: (v) => escribir("diario.json", v), borrarDiario: () => { if (existsSync(ruta("diario.json"))) rmSync(ruta("diario.json")); },
  };
}
