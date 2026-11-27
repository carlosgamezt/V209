// SOLO PRUEBAS LOCALES (PGlite en memoria): aplica las propuestas multiempresa M-D…M-H, crea los establecimientos de prueba de Digifact TEST (código 2 «Sucursal Principal» y 67 «Sucursal 2»),
// asigna a marta (emisora) → 2 y enciende «establecimiento_por_usuario». Nunca se usa con una base real ni con FEL_DEMO_PUBLICADO. Las propuestas NO están en supabase/migrations.
import { fileURLToPath } from "node:url";
import type { BdDemo } from "./bd.ts";
import { EMPRESA } from "./mundo_demo.ts";
import { PERSONAS } from "./mundo_practico.ts";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const PROPUESTAS = ["M-D_permisos", "M-A_emisor_fiscal", "M-B_digifact_config", "M-C_acceso_maestro", "M-F_establecimientos_usuario", "M-G_sesion_admin", "M-H_admin_establecimientos", "M-I_envoltorios_sesion", "M-J_plataforma_y_auditoria", "M-K_sistema_nexa_sys", "M-L_rls_sesion_viva", "M-M_identidad_auth", "M-N_esquema_api", "M-O_lecturas_api", "M-Q_agente_endurecimiento", "M-R_parametros_clases", "M-S_lecturas_documentos"];
export async function activarEstablecimientosLocal(bd: BdDemo): Promise<{ e2: string; e67: string }> {
  if (bd.tipo !== "pglite") throw new Error("Solo para la base en memoria de pruebas locales");
  // deno-lint-ignore no-explicit-any
  const db = (bd as any).db; for (const f of PROPUESTAS) await db.exec(await Deno.readTextFile(`${RAIZ}docs/multiempresa/propuesta/${f}.sql`));
  const ana = PERSONAS.ana.id;
  const guardar = async (id: string | null, codigo: string, nombre: string, dir: string) => (await bd.filas<{ id: string }>("select (public.fel_op_establecimiento_guardar($1, $2, $3, $4, $5, $6, 'activo')).id as id", [ana, EMPRESA, id, codigo, nombre, dir]))[0].id;
  const [x2] = await bd.filas<{ id: string }>("select id from public.establecimientos where empresa_id = $1 and codigo_sat = '2'", [EMPRESA]);
  const e2 = await guardar(x2?.id ?? null, "2", "Sucursal Principal", "Dirección pendiente de verificar (datos-emisor)"), e67 = await guardar(null, "67", "Sucursal 2", "Dirección pendiente de verificar (datos-emisor)");
  await bd.filas("select public.fel_op_asignacion_guardar($1, $2, $3, $4, true, 'alta inicial de pruebas')", [ana, EMPRESA, PERSONAS.marta.id, e2]);
  await bd.filas("update public.plataforma_parametros set valor = 1 where clave = 'establecimiento_por_usuario'");
  return { e2, e67 };
}
