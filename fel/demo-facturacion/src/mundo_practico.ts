// Datos de la versión PRÁCTICA de la demostración: administrador de la plataforma, segunda empresa ficticia, canal Digifact SIMULADO, bolsón simulado, planes y saldos.
// Todo es ficticio y simulado: ningún pago es real, ningún documento se certifica ante SAT.
import type { BdDemo } from "./bd.ts";
import { EMPRESA, USUARIOS } from "./mundo_demo.ts";

export const EMPRESA2 = "10000000-0000-0000-0000-0000000000d1";
export const CLAVE_DEMO = "demo1234";   // contraseña de TODOS los usuarios ficticios (solo demostración local)
export const EXTRA = {
  maestro: { id: "00000000-0000-0000-0000-00000000a010", nombre: "Mario Maestro", rol: "maestro", descripcion: "Administrador de la plataforma: empresas, planes, pagos simulados y bolsón", empresa: null as string | null },
  maestro2: { id: "00000000-0000-0000-0000-00000000a012", nombre: "Nora Maestra", rol: "maestro", descripcion: "Segunda persona de la plataforma: aprueba las conciliaciones del bolsón", empresa: null as string | null },
  sofia: { id: "00000000-0000-0000-0000-00000000a011", nombre: "Sofía Aguilar", rol: "propietario", descripcion: "Propietaria de Servicios Aguilar (segunda empresa ficticia)", empresa: EMPRESA2 as string | null },
} as const;
export type Persona = { id: string; nombre: string; rol: string; descripcion: string; empresa: string | null };
export const PERSONAS: Record<string, Persona> = {
  ...Object.fromEntries(Object.entries(USUARIOS).map(([k, u]) => [k, { ...u, empresa: EMPRESA } as Persona])),
  ...EXTRA,
};
export const esMaestro = (clave: string) => clave === "maestro" || clave === "maestro2";

export interface MundoPractico { cuentaBolson: string; planes: { prepago: string; mensual: string; suscripcion: string } }

export async function sembrarPractico(bd: BdDemo): Promise<MundoPractico> {
  const M = EXTRA.maestro.id, S = EXTRA.sofia.id;
  for (const u of Object.values(EXTRA)) {
    await bd.crearUsuario(u.id, `${u.nombre.split(" ")[0].toLowerCase()}@demo.example`);
    await bd.ejecutar("insert into public.perfiles (user_id) values ($1) on conflict (user_id) do nothing", [u.id]);
  }
  await bd.ejecutar("insert into public.plataforma_admins (user_id) values ($1), ($2)", [M, EXTRA.maestro2.id]);
  // segunda empresa: creada por el maestro con las funciones reales y habilitada
  const [reg] = await bd.filas<{ id: string }>("select id from public.regimenes_fiscales where codigo = 'general'");
  await bd.ejecutar("insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado) values ($1, 'Servicios Aguilar', 'Servicios Aguilar, S.A. (FICTICIA)', '8880002-5', $2, 'habilitada')", [EMPRESA2, reg.id]);
  await bd.ejecutar("insert into public.miembros (empresa_id, user_id, rol) values ($1, $2, 'propietario')", [EMPRESA2, S]);
  const est = await bd.filas<{ id: string }>("select (public.fel_op_establecimiento_guardar($1, $2, null, '1', 'Oficina central', 'Dirección ficticia 20', 'activo')).id as id", [S, EMPRESA2]);
  await bd.filas("select public.fel_op_empresa_datos_guardar($1, $2, 'Servicios Aguilar', 'Dirección ficticia 20, Ciudad', '2300-0000', 'facturacion@aguilar.example')", [S, EMPRESA2]);
  void est;
  for (const [tipo, num, nombre] of [["NIT", "2468013-5", "Distribuidora La Ceiba (ficticia)"], ["CF", "CF", "Consumidor final"]]) {
    await bd.filas("select (public.fel_op_cliente_guardar($1, $2, null, $3, $4, $5, null, null, null, null)).id", [S, EMPRESA2, tipo, num, nombre]);
  }
  await bd.filas("select (public.fel_op_concepto_guardar($1, $2, null, 'SERV-A01', 'Servicio de mantenimiento', 'servicio', 'UND', 300::numeric, null, null)).id", [S, EMPRESA2]);
  // canales: ambas empresas pueden certificar con el proveedor simulado genérico o con Digifact SIMULADO
  for (const [emp, u] of [[EMPRESA, USUARIOS.ana.id], [EMPRESA2, S]] as const) {
    if (emp === EMPRESA2) await bd.filas("select public.fel_op_canal_configurar($1, $2, null, 'mock', 'simulado', true)", [u, emp]);
    for (const prov of ["digifact", "certificador_b"]) await bd.filas("select public.fel_op_canal_configurar($1, $2, null, $3, 'simulado', true)", [u, emp, prov]);
  }
  // bolsón global SIMULADO de Digifact y catálogo comercial
  const cuenta = (await bd.filas<{ id: string }>("select (public.fel_admin_bolson_cuenta_crear($1, 'digifact', 'simulado', 'SIM-DEMO-1')).id as id", [M]))[0].id;
  await bd.filas("select public.fel_admin_bolson_lote_registrar($1, $2, 5000, 2500, 'LOTE-SIM-1')", [M, cuenta]);
  const cuentaB = (await bd.filas<{ id: string }>("select (public.fel_admin_bolson_cuenta_crear($1, 'certificador_b', 'simulado', 'SIM-DEMO-B')).id as id", [M]))[0].id;
  await bd.filas("select public.fel_admin_bolson_lote_registrar($1, $2, 5000, 3000, 'LOTE-SIM-B1')", [M, cuentaB]);
  const tar = (precio: string) => [{ evento: "certificacion", precio, cargable: true }, { evento: "anulacion", precio: "0", cargable: false }, { evento: "rechazo_proveedor", precio: "0", cargable: false }, { evento: "consulta", precio: "0", cargable: false }];
  const plan = async (codigo: string, nombre: string, mod: string, cuota: string, incl: string, sob: boolean, lim: string, precio: string) => {
    await bd.filas("select public.fel_admin_plan_crear($1, $2, $3, $4)", [M, codigo, nombre, mod]);
    return (await bd.filas<{ id: string }>("select (public.fel_admin_plan_version_crear($1, $2, current_date - 1, $3::numeric, $4::numeric, $5, $6::numeric, $7::jsonb)).id as id", [M, codigo, cuota, incl, sob, lim, tar(precio)]))[0].id;
  };
  const prepago = await plan("prepago_basico", "Prepago básico", "prepago", "0", "0", false, "0", "2.5");
  const mensual = await plan("mensual_basico", "Consumo mensual", "consumo_mensual", "0", "0", false, "0", "2.25");
  const suscripcion = await plan("suscripcion_basica", "Suscripción básica", "suscripcion", "100", "20", false, "0", "3");
  await bd.filas("select public.fel_admin_contrato_asignar($1, $2, $3, current_date - 1)", [M, EMPRESA, prepago]);
  await bd.filas("select public.fel_admin_pago_simulado_registrar($1, $2, 100, 'PAGO-SIM-INICIAL', $3)", [M, EMPRESA, "pago-inicial-empresa-demo-0001"]);
  await bd.filas("select public.fel_admin_contrato_asignar($1, $2, $3, current_date - 1)", [M, EMPRESA2, mensual]);
  return { cuentaBolson: cuenta, planes: { prepago, mensual, suscripcion } };
}
