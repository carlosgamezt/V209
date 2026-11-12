// Base de datos de prueba para los servidores que lanzan las pruebas. Sin FEL_TEST_PG_ADMIN, el servidor usa PostgreSQL en memoria (PGlite).
// Con FEL_TEST_PG_ADMIN (URL de administración de un PostgreSQL con la plantilla «nexa_plantilla»: migraciones del proyecto ya aplicadas), cada servidor recibe una base NUEVA y vacía: así las mismas
// pruebas se ejecutan contra la base real (PostgreSQL) y comprueban que el modelo persistente se comporta igual que el de memoria.
import postgres from "npm:postgres@3.4.5";
export async function baseDePrueba(opciones: { vacia?: boolean } = {}): Promise<{ env: Record<string, string>; url?: string; limpiar: () => Promise<void> }> {
  const admin = Deno.env.get("FEL_TEST_PG_ADMIN"); if (!admin) return { env: {}, limpiar: async () => {} };
  const nombre = `demo_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, sql = postgres(admin, { max: 1, onnotice: () => {} });
  await sql.unsafe(opciones.vacia ? `create database ${nombre}` : `create database ${nombre} template nexa_plantilla`); await sql.end();
  const u = new URL(admin); u.pathname = `/${nombre}`;
  return { env: { FEL_DEMO_BD_URL: u.toString() }, url: u.toString(), limpiar: async () => { const s = postgres(admin, { max: 1, onnotice: () => {} }); try { await s.unsafe(`drop database if exists ${nombre} with (force)`); } finally { await s.end(); } } };
}
