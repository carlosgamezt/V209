// Fixtures contra la base REAL de pruebas (cada «mundo» = una empresa nueva con usuarios, establecimiento, canal simulado y documentos).
import { conectarPg, type ConexionPg } from "../src/repo_pg.ts";

export function conexion(): ConexionPg {
  return conectarPg({ host: Deno.env.get("FEL_PGHOST") ?? "127.0.0.1", port: Number(Deno.env.get("FEL_PGPORT") ?? 54322), user: Deno.env.get("FEL_PGUSER") ?? "postgres",
    password: Deno.env.get("FEL_PGPASSWORD") ?? undefined, database: Deno.env.get("FEL_PGDATABASE") ?? "postgres" });
}

let secuencia = 0;
const uuid = () => crypto.randomUUID();
export interface Mundo { empresa: string; propietario: string; admin2: string; emisor: string; lector: string; establecimiento: string; canal: string; cliente: string }

export async function nuevoMundo(cx: ConexionPg): Promise<Mundo> {
  const { sql } = cx, n = ++secuencia * 7919 + Math.floor(Math.random() * 1000), nit = `${String(n).padStart(7, "0").slice(-7)}-${n % 10}`;
  const m: Mundo = { empresa: uuid(), propietario: uuid(), admin2: uuid(), emisor: uuid(), lector: uuid(), establecimiento: "", canal: "", cliente: "" };
  for (const [k, id] of Object.entries({ propietario: m.propietario, admin2: m.admin2, emisor: m.emisor, lector: m.lector })) {
    await sql.unsafe("insert into auth.users (id, email) values ($1, $2)", [id, `${k}-${id.slice(0, 8)}@fel.test`]);
    await sql.unsafe("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [id]);
  }
  await sql.unsafe("insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado) select $1, 'Empresa de prueba', 'Empresa de prueba S.A.', $2, id, 'habilitada' from public.regimenes_fiscales where codigo = 'general'", [m.empresa, nit]);
  for (const [uid, rol] of [[m.propietario, "propietario"], [m.admin2, "administrador"], [m.emisor, "emisor"], [m.lector, "lector"]] as const) {
    await sql.unsafe("insert into public.miembros (empresa_id, user_id, rol) values ($1, $2, $3)", [m.empresa, uid, rol]);
  }
  m.establecimiento = (await sql.unsafe("select (public.fel_op_establecimiento_guardar($1, $2, null, '1', 'Casa matriz', 'Dirección de prueba', 'activo')).id as id", [m.propietario, m.empresa]))[0].id;
  m.canal = (await sql.unsafe("select (public.fel_op_canal_configurar($1, $2, null, 'mock', 'simulado', true)).id as id", [m.propietario, m.empresa]))[0].id;
  m.cliente = (await sql.unsafe("select (public.fel_op_cliente_guardar($1, $2, null, 'NIT', $3, 'Cliente de prueba', null, null, null, null)).id as id", [m.emisor, m.empresa, `${(n + 1) % 9000000 + 1000000}-1`]))[0].id;
  return m;
}

/** Documento revisado y listo para certificar (lo crea el emisor y lo revisa el propietario). */
export async function documentoRevisado(cx: ConexionPg, m: Mundo, cantidad = 2, precio = "10.5"): Promise<string> {
  const { sql } = cx, base = String(Number(cantidad) * Number(precio));
  const lineas = cx.sql.json([{ orden: 1, descripcion: "Servicio de prueba", cantidad, precio_unitario: Number(precio) }] as never);
  const id = (await sql.unsafe("select (public.fel_op_documento_guardar($1, $2, null, $3, current_date, 'prueba', $4::jsonb, $5::numeric, 0, $5::numeric, '{\"oficial\":false}'::jsonb, null)).id as id", [m.emisor, m.empresa, m.cliente, lineas as never, base]))[0].id;
  await sql.unsafe("select public.fel_op_documento_establecimiento($1, $2, $3, $4)", [m.emisor, m.empresa, id, m.establecimiento]);
  const v = (await sql.unsafe("select version from public.documentos where id = $1", [id]))[0].version;
  await sql.unsafe("select public.fel_op_documento_preparacion($1, $2, $3, 'revisado', null, $4)", [m.propietario, m.empresa, id, v]);
  return id;
}

export const estadoDoc = async (cx: ConexionPg, doc: string) => (await cx.sql.unsafe("select estado_preparacion, estado_fiscal, serie, numero_fiscal, autorizacion_sat, version from public.documentos where id = $1", [doc]))[0] as Record<string, unknown>;
export const operaciones = async (cx: ConexionPg, doc: string) => await cx.sql.unsafe("select id, estado, enviada_en, orden_externa, resolucion, motivo_desconocido from public.operaciones_fiscales where documento_id = $1 order by iniciada_en, id", [doc]);
export const parametros = (cx: ConexionPg, espera: number, ventana: number, umbral = 0) =>
  cx.sql.unsafe("update public.plataforma_parametros set valor = case clave when 'espera_conciliacion_manual_min' then $1::numeric when 'ventana_tardia_min' then $2::numeric else $3::numeric end where clave in ('espera_conciliacion_manual_min', 'ventana_tardia_min', 'umbral_recuperacion_min')", [espera, ventana, umbral]);
export const clave = (n: number | string) => `clave-db-${String(n).padStart(8, "0")}-${crypto.randomUUID().slice(0, 8)}`;
