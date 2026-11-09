// Edge Function "fel-api" de NEXA FEL. Desplegar con "Verify JWT" ACTIVADO (además valida la sesión por su cuenta).
// Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (los pone Supabase). Opcionales: FEL_ALLOWED_ORIGINS, FEL_APP_URL.
// FEL_EMISION_REAL_PERMITIDA debe quedar sin definir (o distinto de "true") hasta que se autorice la emisión real.
import { createClient } from "npm:@supabase/supabase-js@2";
import { acciones } from "./acciones.ts";
import { manejar, type Deps } from "./nucleo.ts";

const env = (n: string) => Deno.env.get(n) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const deps: Deps = {
  admin,
  config: {
    origenesPermitidos: env("FEL_ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
    emisionRealPermitida: env("FEL_EMISION_REAL_PERMITIDA") === "true",
    appUrl: env("FEL_APP_URL"),
  },
  async getUser(token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user || !data.user.email) return null;
    return { id: data.user.id, email: data.user.email };
  },
  async esPlataforma(userId) {
    const { data } = await admin.from("plataforma_admins").select("user_id").eq("user_id", userId).maybeSingle();
    return !!data;
  },
  async permisos(empresaId, userId) {
    const { data, error } = await admin.rpc("fel_permisos_efectivos", { p_empresa: empresaId, p_user: userId });
    return error ? [] : (data as string[]) ?? [];
  },
};

Deno.serve((req) => manejar(req, deps, acciones));
