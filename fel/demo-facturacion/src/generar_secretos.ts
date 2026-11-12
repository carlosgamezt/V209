// Genera contraseñas aleatorias y semillas MFA para la demostración PRIVADA en línea. Se imprimen UNA vez en tu terminal (nada se guarda en disco ni se envía a ningún sitio).
import { semillaNueva, uriOtp } from "./totp.ts";
const ALFA = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const claveFuerte = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => ALFA[x % ALFA.length]).join("") + "-Aa1";
export function generar(usuarios: string[], conMfa: string[]) {
  const claves = Object.fromEntries(usuarios.map((u) => [u, claveFuerte()])), semillas = Object.fromEntries(conMfa.map((u) => [u, semillaNueva()]));
  return { claves, semillas, FEL_DEMO_CLAVES: Object.entries(claves).map(([u, c]) => `${u}=${c}`).join(","), FEL_DEMO_MFA_SEMILLAS: Object.entries(semillas).map(([u, s]) => `${u}=${s}`).join(",") };
}
if (import.meta.main) {
  const usuarios = (Deno.args[0] ?? "maestro,maestro2,ana,luis,marta,pedro,sofia").split(","), r = generar(usuarios, ["maestro", "maestro2"]);
  console.log("\n  COPIA ESTO AHORA (no se guarda en ningún sitio):\n");
  for (const u of usuarios) console.log(`  ${u.padEnd(9)} contraseña: ${r.claves[u]}`);
  for (const [u, s] of Object.entries(r.semillas)) console.log(`\n  ${u}: agrega a tu aplicación de autenticación →\n    ${uriOtp(u, s)}\n    (o escribe la clave a mano: ${s})`);
  console.log(`\n  Secretos del servicio (pégalos en la plataforma; p. ej. con Fly.io):\n    fly secrets set FEL_DEMO_CLAVES='${r.FEL_DEMO_CLAVES}' FEL_DEMO_MFA_SEMILLAS='${r.FEL_DEMO_MFA_SEMILLAS}' FEL_DEMO_HOSTS='<tu-nombre>.fly.dev'\n`);
}
