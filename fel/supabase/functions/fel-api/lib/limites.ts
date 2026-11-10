// Límites de peticiones por usuario, empresa y tipo de operación. El contador vive en la base de datos
// (fel_limite_consumir: atómico y compartido entre todas las instancias de la Edge Function), no en memoria local.
export interface Cubeta { ambito: "usuario" | "empresa" | "ip"; ventanaSeg: number; max: number }
export interface ReglaLimite {
  cubetas: Cubeta[];
  falla: "cerrado" | "abierto"; // qué hacer si el limitador no responde (cerrado = rechazar con 503)
}

// Valores iniciales, a ajustar con el uso real. Cada acción declara su categoría en acciones.ts (campo "limite").
export const LIMITES: Record<string, ReglaLimite> = {
  // lectura del perfil de sesión: se llama en cada carga de la app; si el limitador cae, no se bloquea el acceso
  sesion: { falla: "abierto", cubetas: [{ ambito: "usuario", ventanaSeg: 60, max: 120 }] },
  // envío de correos de invitación: el más caro y abusable
  invitacion_envio: { falla: "cerrado", cubetas: [
    { ambito: "usuario", ventanaSeg: 3600, max: 10 }, { ambito: "empresa", ventanaSeg: 3600, max: 30 }] },
  // revocar invitaciones, cambiar miembros, aceptar invitaciones
  gestion_usuarios: { falla: "cerrado", cubetas: [
    { ambito: "usuario", ventanaSeg: 3600, max: 60 }, { ambito: "empresa", ventanaSeg: 3600, max: 200 }] },
  // clientes, conceptos y borradores
  escritura: { falla: "cerrado", cubetas: [
    { ambito: "usuario", ventanaSeg: 60, max: 120 }, { ambito: "empresa", ventanaSeg: 60, max: 600 }] },
  // lecturas por la API (lista de miembros, solicitudes de recuperación)
  lectura: { falla: "cerrado", cubetas: [
    { ambito: "usuario", ventanaSeg: 60, max: 240 }, { ambito: "empresa", ventanaSeg: 60, max: 1200 }] },
  // solicitar recuperar el acceso (MFA perdido): poquísimas por hora
  recuperacion: { falla: "cerrado", cubetas: [{ ambito: "usuario", ventanaSeg: 3600, max: 5 }] },
  // administrador maestro (empresas, regímenes, emisión)
  admin: { falla: "cerrado", cubetas: [{ ambito: "usuario", ventanaSeg: 60, max: 30 }] },
  // reservada para certificar / anular / conciliar (no existen en la API de la Fase 1)
  fiscal: { falla: "cerrado", cubetas: [
    { ambito: "usuario", ventanaSeg: 60, max: 10 }, { ambito: "empresa", ventanaSeg: 3600, max: 100 }] },
};

// Límite previo a la autenticación, por dirección de origen (la IP se guarda solo como hash).
export const LIMITE_IP: Cubeta = { ambito: "ip", ventanaSeg: 60, max: 600 };

export function claveLimite(ambito: string, id: string, categoria: string, ventanaSeg: number): string {
  return `${ambito}:${id}:${categoria}:${ventanaSeg}`;
}

export async function hashCorto(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
