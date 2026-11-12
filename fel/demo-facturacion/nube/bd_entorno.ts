// Conexión a la base según el entorno. Con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (proyecto hospedado; la plataforma los entrega a la función como secretos propios) los usuarios se crean con
// la API de administración de Supabase Auth; sin ellos (local, pruebas, CI) se usa la fila en auth.users del esquema local.
import { crearBdPg, type BdDemo } from "../src/bd.ts";
import { creadorAdminApi } from "../src/usuarios_auth.ts";

export function bdDeEntorno(get: (k: string) => string | undefined): BdDemo {
  const url = get("FEL_DEMO_BD_URL"); if (!url) throw new Error("falta FEL_DEMO_BD_URL");
  const su = get("SUPABASE_URL"), clave = get("SUPABASE_SERVICE_ROLE_KEY");
  return crearBdPg(url, su && clave ? { usuarios: creadorAdminApi({ url: su, claveServicio: clave }) } : {});
}

/** Protección contra apuntar al proyecto equivocado (p. ej. el principal de NEXA): la referencia del proyecto de la demostración debe confirmarse y coincidir con la URL de Supabase y con la conexión a la base. */
export function verificarProyecto(get: (k: string) => string | undefined): string | null {
  const su = get("SUPABASE_URL"), ref = get("FEL_DEMO_PROYECTO_REF"), bd = get("FEL_DEMO_BD_URL") ?? "";
  let host = ""; try { host = new URL(su ?? "").hostname; } catch { /* sin URL */ }
  if (host === "127.0.0.1" || host === "localhost") return null;   // pila local de Supabase (pruebas)
  const esSupabase = /supabase\.(co|com)/.test(bd) || !!su; if (!esSupabase) return null;   // base local o de pruebas: no aplica
  if (!ref || !/^[a-z0-9]{15,30}$/.test(ref)) return "Falta FEL_DEMO_PROYECTO_REF (la referencia del proyecto Supabase NUEVO y exclusivo de la demostración; está en la URL del proyecto: https://<referencia>.supabase.co).";
  if (su && host !== `${ref}.supabase.co`) return "SUPABASE_URL no corresponde a la referencia indicada en FEL_DEMO_PROYECTO_REF.";
  if (!bd.includes(ref)) return "La conexión a la base (FEL_DEMO_BD_URL) no pertenece al proyecto indicado en FEL_DEMO_PROYECTO_REF.";
  return null;
}
