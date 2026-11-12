// Configuración del modo PUBLICADO (demostración privada en línea). Las credenciales llegan SOLO por variables de entorno del servicio (secretos de la plataforma de alojamiento);
// el programa se niega a arrancar si faltan, si son débiles o si es la contraseña pública de la demostración, y nunca las imprime.
export interface ConfigPublicada { claves: Record<string, string>; semillas: Record<string, string>; hosts: string[] }
const lista = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const pares = (s: string | undefined, donde: string): Record<string, string> => Object.fromEntries(lista(s).map((p) => { const i = p.indexOf("="); if (i < 1) throw new Error(`${donde}: formato «usuario=valor» no válido`); return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] as [string, string]; }));

export function leerConfigPublicada(env: (k: string) => string | undefined, usuarios: string[]): ConfigPublicada {
  const claves = pares(env("FEL_DEMO_CLAVES"), "FEL_DEMO_CLAVES"), semillas = pares(env("FEL_DEMO_MFA_SEMILLAS"), "FEL_DEMO_MFA_SEMILLAS"), hosts = lista(env("FEL_DEMO_HOSTS")).map((h) => h.toLowerCase());
  for (const u of ["maestro", "maestro2"]) { if (!claves[u]) throw new Error(`falta la contraseña de «${u}» en FEL_DEMO_CLAVES`); if (!semillas[u]) throw new Error(`falta la semilla MFA de «${u}» en FEL_DEMO_MFA_SEMILLAS (la verificación en dos pasos es obligatoria para la plataforma)`); }
  const vistas = new Set<string>();
  for (const [u, c] of Object.entries(claves)) {
    if (!usuarios.includes(u)) throw new Error(`FEL_DEMO_CLAVES: usuario desconocido «${u}»`);
    if (c.length < 14) throw new Error(`la contraseña de «${u}» es demasiado corta (mínimo 14 caracteres)`);
    if (/demo1234/i.test(c) || /^(.)\1+$/.test(c)) throw new Error(`la contraseña de «${u}» es débil o pública`);
    if (vistas.has(c)) throw new Error("cada usuario necesita una contraseña distinta"); vistas.add(c);
  }
  for (const [u, s] of Object.entries(semillas)) { if (!usuarios.includes(u)) throw new Error(`FEL_DEMO_MFA_SEMILLAS: usuario desconocido «${u}»`); if (!/^[A-Z2-7]{16,64}$/.test(s)) throw new Error(`la semilla MFA de «${u}» debe ser base32 (A-Z, 2-7) de 16 a 64 caracteres`); }
  if (hosts.length === 0) throw new Error("falta FEL_DEMO_HOSTS (el nombre público del servicio, p. ej. nexa-demo.example.com)");
  for (const h of hosts) if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) || /^\d+(\.\d+){3}$/.test(h)) throw new Error(`FEL_DEMO_HOSTS: nombre no válido «${h}» (sin esquema, comodines ni direcciones IP)`);
  return { claves, semillas, hosts };
}
