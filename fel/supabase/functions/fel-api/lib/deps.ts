// Dependencias reales de la API sobre un cliente con service_role. Se separa de index.ts para poder probarlas con un cliente falso.
// Regla de oro: ante cualquier error de la base de datos, se DENIEGA (nunca se asume permiso).
import { ErrorFel } from "./errores.ts";
import type { Config, Deps } from "../nucleo.ts";
import { decodificarClaims } from "./jwt.ts";

// deno-lint-ignore no-explicit-any
export function construirDeps(admin: any, config: Config): Deps {
  return {
    admin,
    config,
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user || !data.user.email) return null;
      // Supabase Auth ya verificó la firma y que la sesión siga viva. Además se exige que los claims que luego se leen
      // (aal) pertenezcan a ESTE usuario y a un token de usuario (no la clave anon ni un token de otro): sub y role coherentes.
      const c = decodificarClaims(token);
      if (c.sub !== data.user.id || c.role !== "authenticated") return null;
      return { id: data.user.id, email: data.user.email };
    },
    // Estado de la cuenta: solo "activa" (perfil existente y activo) tiene acceso general. "sin_perfil" solo puede aceptar una
    // invitación; "bloqueada" no puede nada. Si no se puede comprobar, se rechaza con 503; un valor desconocido = bloqueada.
    async estadoCuenta(userId) {
      const { data, error } = await admin.rpc("fel_estado_cuenta", { p_user: userId });
      if (error) throw new ErrorFel(503, "No se pudo verificar la cuenta; intenta de nuevo", "verificacion");
      return data === "activa" || data === "sin_perfil" ? data : "bloqueada";
    },
    // Administrador maestro = está en plataforma_admins Y su perfil está activo (misma regla que usa la base de datos).
    async esPlataforma(userId) {
      const { data, error } = await admin.rpc("fel_es_plataforma", { p_user: userId });
      return !error && data === true;
    },
    async permisos(empresaId, userId) {
      const { data, error } = await admin.rpc("fel_permisos_efectivos", { p_empresa: empresaId, p_user: userId });
      return error ? [] : (data as string[]) ?? [];
    },
    async limitar(clave, ventanaSeg, max) {
      const { data, error } = await admin.rpc("fel_limite_consumir", { p_clave: clave, p_ventana_seg: ventanaSeg, p_max: max });
      const fila = Array.isArray(data) ? data[0] : data;
      if (error || !fila) throw new ErrorFel(503, "Servicio no disponible temporalmente", "limitador");
      return { permitido: fila.permitido === true, reintentarEn: Number(fila.reintentar_en) || 1 };
    },
  };
}
