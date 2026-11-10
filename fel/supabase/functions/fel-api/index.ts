// Edge Function "fel-api" de NEXA FEL. Desplegar con "Verify JWT" ACTIVADO (además valida la sesión por su cuenta).
// Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (los pone Supabase). Opcionales: FEL_ALLOWED_ORIGINS, FEL_APP_URL.
// FEL_EMISION_REAL_PERMITIDA debe quedar sin definir (o distinto de "true"); aun así, la emisión real sigue bloqueada
// por una constante en el código y por el interruptor de la base de datos (plataforma_config).
import { createClient } from "npm:@supabase/supabase-js@2";
import { acciones } from "./acciones.ts";
import { manejar } from "./nucleo.ts";
import { construirDeps } from "./lib/deps.ts";

const env = (n: string) => Deno.env.get(n) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const deps = construirDeps(admin, {
  origenesPermitidos: env("FEL_ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
  emisionRealPermitida: env("FEL_EMISION_REAL_PERMITIDA") === "true",
  appUrl: env("FEL_APP_URL"),
});

Deno.serve((req) => manejar(req, deps, acciones));
