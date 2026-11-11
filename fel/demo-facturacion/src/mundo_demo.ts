// Datos de ejemplo de la demostración: una empresa FICTICIA con cuatro personas ficticias, dos establecimientos, un canal SIMULADO y algunos clientes.
// Ningún dato es real. Los parámetros de espera se acortan a 0 para poder recorrer la conciliación manual y las respuestas tardías en una sola sesión.
import type { BdDemo } from "./bd.ts";

export const EMPRESA = "10000000-0000-0000-0000-0000000000d0";
export const USUARIOS = {
  ana: { id: "00000000-0000-0000-0000-00000000a001", nombre: "Ana Torres", rol: "propietario", descripcion: "Propietaria: todo, incluida la aprobación de conciliaciones" },
  luis: { id: "00000000-0000-0000-0000-00000000a002", nombre: "Luis Méndez", rol: "administrador", descripcion: "Administrador: segunda persona que aprueba conciliaciones" },
  marta: { id: "00000000-0000-0000-0000-00000000a003", nombre: "Marta Ruiz", rol: "emisor", descripcion: "Emisora: crea borradores; no certifica ni concilia" },
  pedro: { id: "00000000-0000-0000-0000-00000000a004", nombre: "Pedro Díaz", rol: "lector", descripcion: "Lector: solo consulta" },
} as const;
export type ClaveUsuario = keyof typeof USUARIOS;

export interface Sembrado { empresa: string; canal: string; establecimientos: { id: string; codigo_sat: string; nombre: string }[] }

export async function sembrar(bd: BdDemo): Promise<Sembrado> {
  const { db } = bd;
  for (const u of Object.values(USUARIOS)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [u.id, `${u.nombre.split(" ")[0].toLowerCase()}@demo.example`]);
    await db.query("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [u.id]);
  }
  await db.query("insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado) select $1, 'Empresa Demo', 'Empresa Demo, S.A. (FICTICIA)', '7770001-0', id, 'habilitada' from public.regimenes_fiscales where codigo = 'general'", [EMPRESA]);
  for (const u of Object.values(USUARIOS)) await db.query("insert into public.miembros (empresa_id, user_id, rol) values ($1, $2, $3)", [EMPRESA, u.id, u.rol]);
  const est: Sembrado["establecimientos"] = [];
  for (const [codigo, nombre, dir] of [["1", "Casa matriz", "Dirección ficticia 1"], ["2", "Sucursal Zona 10", "Dirección ficticia 2"]]) {
    const r = await bd.filas<{ id: string }>("select (public.fel_op_establecimiento_guardar($1, $2, null, $3, $4, $5, 'activo')).id as id", [USUARIOS.ana.id, EMPRESA, codigo, nombre, dir]);
    est.push({ id: r[0].id, codigo_sat: codigo, nombre });
  }
  await bd.filas("select public.fel_op_empresa_datos_guardar($1, $2, 'Empresa Demo', 'Dirección ficticia 1, Ciudad', '2200-0000', 'facturacion@empresa-demo.example')", [USUARIOS.ana.id, EMPRESA]);
  const canal = (await bd.filas<{ id: string }>("select (public.fel_op_canal_configurar($1, $2, null, 'mock', 'simulado', true)).id as id", [USUARIOS.ana.id, EMPRESA]))[0].id;
  for (const [tipo, num, nombre, dir, mail, tel] of [
    ["NIT", "1234567-8", "Comercial Los Pinos, S.A. (ficticia)", "Dirección ficticia 10, Ciudad", "contacto@lospinos.example", "2200-1000"],
    ["NIT", "7654321-4", "Ferretería El Tornillo (ficticia)", "Dirección ficticia 11, Ciudad", "ventas@eltornillo.example", "2200-2000"],
    ["NIT", "3214567-9", "Constructora El Roble, S.A. (ficticia)", "Dirección ficticia 12, Ciudad", "info@elroble.example", "2200-3000"],
    ["NIT", "6547891-2", "Multiservicios del Norte (ficticia)", "Dirección ficticia 13, Ciudad", "msn@multiservicios.example", "2200-4000"],
    ["CF", "CF", "Consumidor final", null, null, null]]) {
    await bd.filas("select (public.fel_op_cliente_guardar($1, $2, null, $3, $4, $5, $6, $7, $8, null)).id", [USUARIOS.marta.id, EMPRESA, tipo, num, nombre, dir, mail, tel]);
  }
  for (const nit of ["1234567-8", "3214567-9"]) { const [c] = await bd.filas<{ id: string }>("select id from public.clientes where empresa_id = $1 and numero_identificacion = $2", [EMPRESA, nit]); await bd.filas("select public.fel_op_cliente_frecuente($1, $2, $3, true)", [USUARIOS.marta.id, EMPRESA, c.id]); }
  for (const [codigo, desc, tipo, precio] of [["SERV-001", "Supervisión de obra", "servicio", "500"], ["SERV-002", "Instalación de equipo", "servicio", "350"], ["SERV-003", "Asesoría técnica", "servicio", "250"], ["BIEN-001", "Material de construcción", "bien", "120"]]) {
    await bd.filas("select (public.fel_op_concepto_guardar($1, $2, null, $3, $4, $5, 'UND', $6::numeric, null, null)).id", [USUARIOS.marta.id, EMPRESA, codigo, desc, tipo, precio]);
  }
  // demostración: sin esperas para poder recorrer todo el proceso en minutos (los valores por defecto del producto son 120 / 1440 / 10 minutos)
  await db.query("update public.plataforma_parametros set valor = 0 where clave in ('espera_conciliacion_manual_min', 'ventana_tardia_min', 'umbral_recuperacion_min')");
  return { empresa: EMPRESA, canal, establecimientos: est };
}
