// Comprueba contra la pila LOCAL REAL de Supabase (GoTrue) lo que el aprovisionamiento de la demostración necesita de la API de administración de Auth:
// crear un usuario CON el identificador que nosotros fijamos, confirmado y sin contraseña; que repetir el alta sea inocuo; y que un id o correo distintos se detecten.
// Usa el MISMO código que usa el aprovisionamiento (src/usuarios_auth.ts). Solo contra 127.0.0.1.
import { creadorAdminApi } from "../../demo-facturacion/src/usuarios_auth.ts";
const api = Deno.env.get("API_URL") ?? "http://127.0.0.1:54321", clave = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SECRET_KEY") ?? "";
const host = new URL(api).hostname; if (host !== "127.0.0.1" && host !== "localhost") { console.error("Solo se ejecuta contra la pila local."); Deno.exit(2); }
const id = crypto.randomUUID(), email = `prueba-${id.slice(0, 8)}@demo.example`, c = creadorAdminApi({ url: api, claveServicio: clave });
const cab: Record<string, string> = { apikey: clave, ...(clave.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${clave}` }) };
const fallos: string[] = [];
const ok = (cond: boolean, m: string) => { console.log(`${cond ? "OK " : "FALLO"} ${m}`); if (!cond) fallos.push(m); };
try {
  await c.crear(id, email); ok(true, "alta con el identificador fijado por nosotros");
  const g = await fetch(`${api}/auth/v1/admin/users/${id}`, { headers: cab }); const u = await g.json();
  ok(g.status === 200 && u.id === id, "GoTrue respetó el id"); ok(String(u.email).toLowerCase() === email, "correo correcto"); ok(!!u.email_confirmed_at, "usuario confirmado"); ok(!u.encrypted_password, "sin contraseña de Supabase (el acceso a la demostración es propio)");
  await c.crear(id, email); ok(true, "repetir el alta (aprovisionamiento repetido) es inocuo");
  let rechazo = false; try { await c.crear(id, `otro-${email}`); } catch { rechazo = true; } ok(rechazo, "mismo id con otro correo se detecta, no se acepta en silencio");
  let rechazo2 = false; try { await c.crear(crypto.randomUUID(), email); } catch { rechazo2 = true; } ok(rechazo2, "mismo correo con otro id se detecta");
} finally { await fetch(`${api}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: cab }).catch(() => {}); }
if (fallos.length) { console.error("Incompatibilidad con la API de administración de Auth:", fallos); Deno.exit(1); }
console.log("AUTH ADMIN OK");
