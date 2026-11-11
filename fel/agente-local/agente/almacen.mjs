// Almacén local del agente: identidad (clave privada del equipo) y diario de la orden en curso. Carpeta propia con permisos restringidos.
// La clave privada se guarda PROTEGIDA (Windows: DPAPI del usuario actual; desarrollo en Linux: archivo 0600 en carpeta 0700; ver proteccion_clave.mjs). Nunca en texto plano en Windows.
// La identidad NO contiene credenciales de SAT (el agente no las conoce ni las guarda).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ErrorProteccion, elegirProtector, protectorPorNombre } from "./proteccion_clave.mjs";

export function abrirAlmacen(dir, { protector } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); try { chmodSync(dir, 0o700); } catch { /* sistemas sin permisos POSIX */ }
  const ruta = (n) => join(dir, n);
  const leer = (n) => { try { return JSON.parse(readFileSync(ruta(n), "utf8")); } catch { return null; } };
  const escribir = (n, v) => { const tmp = ruta(`${n}.tmp`); writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); renameSync(tmp, ruta(n)); };   // escritura atómica
  return {
    dir, perfil: ruta("perfil-chromium"),
    identidad: () => leer("identidad.json"),
    /** Guarda la identidad con la clave PROTEGIDA (nunca el PEM en claro). `clavePem` se protege con el protector de la plataforma. */
    guardarIdentidad: ({ clavePem, ...datos }) => { const p = protector ?? elegirProtector(); escribir("identidad.json", { ...datos, protector: p.nombre, clave_protegida: p.proteger(Buffer.from(clavePem, "utf8")) }); },
    /** Lee la identidad y desprotege la clave. Un protector no permitido en esta plataforma (p. ej. «archivo_restringido» en Windows) se rechaza. Migra el formato anterior (PEM en claro) re-protegiéndolo. */
    cargarIdentidad: () => {
      const v = leer("identidad.json"); if (!v) return null;
      if (typeof v.privada_pem === "string") {                                           // formato anterior: PEM en claro ⇒ se re-protege y se borra el texto plano
        const { privada_pem, ...resto } = v; const p = protector ?? elegirProtector();
        escribir("identidad.json", { ...resto, protector: p.nombre, clave_protegida: p.proteger(Buffer.from(privada_pem, "utf8")) });
        return { ...resto, clavePem: privada_pem, protector: p.nombre };
      }
      const p = protector ?? protectorPorNombre(v.protector);
      if (p.nombre !== v.protector) throw new ErrorProteccion("PROTECTOR_DISTINTO", "La clave fue protegida con otro método y no se puede abrir aquí");
      const { clave_protegida, ...resto } = v; const bytes = p.desproteger(clave_protegida);
      try { return { ...resto, clavePem: bytes.toString("utf8") }; } finally { bytes.fill(0); }
    },
    diario: () => leer("diario.json"), guardarDiario: (v) => escribir("diario.json", v), borrarDiario: () => { if (existsSync(ruta("diario.json"))) rmSync(ruta("diario.json")); },
  };
}
