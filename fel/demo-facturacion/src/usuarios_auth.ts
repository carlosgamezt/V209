// Alta de usuarios en Supabase Auth. Las claves foráneas del modelo (miembros, auditoría…) apuntan a auth.users, pero en un proyecto HOSPEDADO esa tabla es de Supabase Auth: lo soportado es crear
// los usuarios por su API de administración (no insertar filas a mano, que se saltaría identidades, metadatos y futuras reglas de Auth).
//  · creadorSql: local, pruebas y CI (PostgreSQL / PGlite con el esquema «auth» simulado) — inserta en auth.users.
//  · creadorAdminApi: proyecto hospedado — POST /auth/v1/admin/users con la clave de servicio, que SOLO existe en el servidor (la función de Supabase la recibe como secreto propio de la plataforma;
//    el aprovisionamiento la lee de una variable de entorno de tu equipo). El usuario se crea CONFIRMADO y SIN contraseña de Supabase (la demostración tiene su propio inicio de sesión).
export interface CreadorUsuarios { crear(id: string, email: string): Promise<void> }
type Ejecutar = (sql: string, params?: unknown[]) => Promise<void>;

export function creadorSql(ejecutar: Ejecutar): CreadorUsuarios {
  return { crear: async (id, email) => { await ejecutar("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()) on conflict (id) do nothing", [id, email]); } };
}

export function creadorAdminApi(o: { url: string; claveServicio: string; fetchImpl?: typeof fetch }): CreadorUsuarios {
  const f = o.fetchImpl ?? fetch, base = new URL(o.url);
  if (base.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("La dirección de Supabase debe ser HTTPS");
  if (o.claveServicio.length < 20) throw new Error("clave de servicio no válida");
  const raiz = base.origin, cab = { apikey: o.claveServicio, authorization: `Bearer ${o.claveServicio}`, "content-type": "application/json" };
  return {
    async crear(id, email) {
      // errores sin cuerpo ni cabeceras: nunca arrastran la clave ni datos de personas
      const r = await f(`${raiz}/auth/v1/admin/users`, { method: "POST", headers: cab, body: JSON.stringify({ id, email, email_confirm: true }), redirect: "manual" });
      const t = await r.text(); let j: { id?: string; email?: string } = {}; try { j = JSON.parse(t); } catch { /* sin JSON */ }
      if (r.status === 200 || r.status === 201) { if (j.id !== id) throw new Error("Supabase Auth creó el usuario con otro identificador: esta versión necesita que respete el id indicado"); return; }
      if (r.status === 422 || r.status === 409) {   // ya existe (aprovisionamiento repetido): válido solo si es el MISMO usuario
        const g = await f(`${raiz}/auth/v1/admin/users/${encodeURIComponent(id)}`, { headers: cab, redirect: "manual" });
        if (g.status === 200) { const u = await g.json().catch(() => ({})); if (u.id === id && String(u.email).toLowerCase() === email.toLowerCase()) return; }
        throw new Error("El usuario ya existe en Supabase Auth con otros datos");
      }
      throw new Error(`Supabase Auth rechazó el alta de un usuario (estado ${r.status})`);
    },
  };
}
