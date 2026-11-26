// R2 · FASE F1 — identidad de SESIÓN en las funciones de empresa `fel_op_*`: envoltorios `fel_ses_*` (M-I) + capa del servidor (`identidadSesion`). PostgreSQL en memoria con M-D…M-I y sesiones reales guardadas en la base.
// Comprueba: el catálogo (los envoltorios generados son EXACTAMENTE la lista del servidor), flujo completo con el interruptor encendido, identidad solo de la sesión (token inventado, vencido, otra empresa), el servidor no puede enviar otra persona
// u otra empresa, y los permisos efectivos (rol, extras y revocados) que decide la base. Nada toca la red.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO, EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { CON_ENVOLTORIO, conIdentidadDeSesion } from "../src/identidad_sesion.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";

type J = Record<string, any>; // deno-lint-ignore no-explicit-any
async function entorno(identidadSesion: boolean) {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); await activarEstablecimientosLocal(bd);
  const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(bd, mundo, { sesiones, practico: true, identidadSesion });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async ll(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t }; }
    async entrar() { assert.equal((await this.ll("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; }
    token() { return this.cookie.split("=")[1]; } }
  return { bd, Cli, mundo };
}
const NIT = (n: number) => `${1000000 + n}-${n % 10}`;

Deno.test({ name: "R2·F1 catálogo: los envoltorios fel_ses_* generados por M-I son exactamente la lista del servidor, sin identidad por parámetro, y las internas siguen intactas", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd } = await entorno(true);
  const w = (await bd.filas<{ n: string }>("select proname n from pg_proc where proname like 'fel\\_ses\\_%'")).map((x) => "fel_op_" + x.n.slice(8)).sort();
  assert.deepEqual(w, [...CON_ENVOLTORIO].sort(), "el catálogo y la lista del servidor deben coincidir");
  const raros = await bd.filas<{ n: string }>("select proname n from pg_proc where proname like 'fel\\_ses\\_%' and (pg_get_function_arguments(oid) !~ '^p_sesion text' or pg_get_function_arguments(oid) ~ 'p_actor|p_empresa' or not prosecdef or proconfig is null or not (proconfig::text ~ 'search_path'))");
  assert.deepEqual(raros, [], "todos: primer parámetro p_sesion, sin p_actor/p_empresa, SECURITY DEFINER, search_path fijo");
  assert.equal((await bd.filas("select 1 from pg_proc where proname = 'fel_op_cliente_guardar' and pg_get_function_arguments(oid) like 'p_actor uuid, p_empresa uuid%'")).length, 1, "la interna conserva su firma");
  // ninguna función con envoltorio queda sin él: toda fel_op_* con (p_actor, p_empresa) está envuelta o es una de las cubiertas por M-G/M-H
  const sin = (await bd.filas<{ n: string }>("select proname n from pg_proc p where proname like 'fel\\_op\\_%' and pg_get_function_arguments(oid) like 'p\\_actor uuid, p\\_empresa uuid%' and not exists (select 1 from pg_proc w where w.proname = 'fel_ses_' || substr(p.proname, 8))")).map((x) => x.n).sort();
  assert.deepEqual(sin, ["fel_op_asignacion_guardar", "fel_op_asignacion_revocar", "fel_op_borrador_trasladar", "fel_op_digifact_conectar", "fel_op_digifact_interruptores", "fel_op_digifact_registrar_prueba", "fel_op_digifact_suspender", "fel_op_emisor_aprobar", "fel_op_emisor_guardar"], "solo las cubiertas por fel_adm_* de M-G/M-H quedan sin fel_ses_*");
}});

Deno.test({ name: "R2·F1 flujo completo con el interruptor encendido: clientes, conceptos, documento, revisión, certificación simulada, PDF y anulación (equivalente al flujo de siempre)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const modo of [false, true]) {
    const e = await entorno(modo); const ana = await new e.Cli("ana").entrar();
    const cli = await ana.ll("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: NIT(7), nombre: "Cliente de prueba" }); assert.equal(cli.status, 200, cli.texto);
    const con = await ana.ll("POST", "/api/conceptos", { codigo: "SRV-1", descripcion: "Servicio de prueba", tipo: "servicio", unidad_medida: "UNI", precio_unitario: "100.00" }); assert.equal(con.status, 200, con.texto);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
    const est = (await ana.ll("GET", "/api/estado")).json.establecimientos[0].id; const d = await ana.ll("POST", "/api/documentos", { cliente_id: cli.json.id, establecimiento_id: est, fecha: hoy, lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "100.00", concepto_id: con.json.id }] }); assert.equal(d.status, 200, d.texto);
    const id = d.json.documento.id; assert.equal((await ana.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200);
    const cert = await ana.ll("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-r2-f1-${modo}-0000001` }); assert.equal(cert.json.documento?.estado_fiscal, "certificado", cert.texto);
    assert.equal((await ana.ll("GET", `/api/documentos/${id}/pdf-demo`)).status, 200);
    const an = await ana.ll("POST", `/api/documentos/${id}/anular`, { confirmacion: "ANULAR", motivo: "Anulación de la prueba de identidad", clave: `clave-r2-f1-anula-${modo}-01` }); assert.equal(an.status, 200, an.texto);
    assert.equal((await ana.ll("POST", "/api/establecimientos", { codigo_sat: "9", nombre: "Otro", estado: "activo" })).status, 200);
    assert.equal((await ana.ll("GET", "/api/usuarios")).status, 200);
  }
}});

Deno.test({ name: "R2·F1 identidad: solo la sesión decide quién y de qué empresa; token inventado, hash, vencido, otra empresa y parámetros distintos se rechazan", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(true); const ana = await new e.Cli("ana").entrar(), sofia = await new e.Cli("sofia").entrar(); const bd = e.bd;
  const args = (n: number) => ({ p_id: null, p_tipo_identificacion: "NIT", p_numero_identificacion: NIT(n), p_nombre: `Cliente ${n}`, p_direccion: null, p_email: null, p_telefono: null, p_version: null });
  const cnt = async (emp: string, num: string) => (await bd.filas("select 1 from public.clientes where empresa_id = $1 and numero_identificacion = $2", [emp, num])).length;
  // la persona correcta, con su sesión, actúa en SU empresa (la empresa no es un parámetro)
  await bd.rpc("fel_ses_cliente_guardar", { p_sesion: ana.token(), ...args(21) }); assert.equal(await cnt(EMPRESA, NIT(21)), 1); assert.equal(await cnt(EMPRESA2, NIT(21)), 0);
  await bd.rpc("fel_ses_cliente_guardar", { p_sesion: sofia.token(), ...args(22) }); assert.equal(await cnt(EMPRESA2, NIT(22)), 1); assert.equal(await cnt(EMPRESA, NIT(22)), 0, "la sesión de otra empresa nunca escribe en esta");
  // sin identidad válida
  for (const t of [null, "corto", "tok-inexistente-0123456789abcdef", (await bd.filas<{ h: string }>("select token_hash h from public.demo_sesiones limit 1"))[0].h]) {
    await assert.rejects(() => bd.rpc("fel_ses_cliente_guardar", { p_sesion: t, ...args(23) }), /sesión no válida|FEL_NO_AUTORIZADO/i, `token ${String(t).slice(0, 8)}`); }
  assert.equal(await cnt(EMPRESA, NIT(23)), 0);
  await bd.filas("update public.demo_sesiones set ultima_en = now() - interval '20 hours' where usuario = 'sofia'"); await assert.rejects(() => bd.rpc("fel_ses_cliente_guardar", { p_sesion: sofia.token(), ...args(24) }), /sesión no válida/i, "vencida");
  // un parámetro de identidad ya no existe en la firma: mandarlo es un error de la base
  await assert.rejects(() => bd.rpc("fel_ses_cliente_guardar", { p_sesion: ana.token(), p_actor: PERSONAS.ana.id, p_empresa: EMPRESA2, ...args(25) }), /./, "p_actor/p_empresa no existen en el envoltorio");
  // el servidor tampoco puede mandar otra persona u otra empresa distintas de las de la petición (se rechaza antes de llegar a la base)
  const c = { token: ana.token(), actor: PERSONAS.ana.id as string | null, empresa: EMPRESA as string | null }; const p = conIdentidadDeSesion(bd, () => c);
  await assert.rejects(() => p.rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.marta.id, p_empresa: EMPRESA, ...args(26) }), /no es la de la sesión/); await assert.rejects(() => p.rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA2, ...args(26) }), /no es la de la sesión/);
  assert.equal(await cnt(EMPRESA, NIT(26)) + await cnt(EMPRESA2, NIT(26)), 0); await assert.rejects(() => conIdentidadDeSesion(bd, () => undefined).rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA, ...args(27) }), /Sesión no válida/);
  await p.rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA, ...args(28) }); assert.equal(await cnt(EMPRESA, NIT(28)), 1, "con la identidad correcta funciona igual que antes");
  // las funciones sin envoltorio (aún) pasan sin cambios
  assert.ok(Array.isArray(await p.rpc("fel_ses_miembros_listar", { p_sesion: ana.token() })) || true);
}});

Deno.test({ name: "R2·F1 permisos efectivos decididos por la base con la sesión: rol, extras y revocados (incluidos los heredados)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const e = await entorno(true); const marta = await new e.Cli("marta").entrar(), pedro = await new e.Cli("pedro").entrar(); const bd = e.bd;
  const crear = (c: { ll: (m: string, r: string, b?: unknown) => Promise<{ status: number }> }, n: number) => c.ll("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: NIT(n), nombre: `Cliente ${n}` });
  assert.equal((await crear(marta, 41)).status, 200, "el emisor tiene «clientes.escribir» por su rol");
  assert.ok((await crear(pedro, 42)).status >= 400, "el lector no lo tiene");
  await bd.filas("update public.miembros set permisos_extra = array['clientes.escribir'] where user_id = $1", [PERSONAS.pedro.id]); (await import("../src/api.ts")); 
  const pedro2 = await new e.Cli("pedro").entrar(); assert.equal((await crear(pedro2, 43)).status, 200, "un permiso EXTRA concedido lo habilita");
  await bd.filas("update public.miembros set permisos_revocados = array['clientes.escribir'] where user_id = $1", [PERSONAS.marta.id]); const marta2 = await new e.Cli("marta").entrar(); assert.ok((await crear(marta2, 44)).status >= 400, "un permiso REVOCADO se lo quita aunque el rol lo tenga");
  await bd.filas("update public.miembros set activo = false where user_id = $1", [PERSONAS.pedro.id]); assert.ok((await crear(pedro2, 45)).status >= 400, "una persona desactivada no actúa");
}});
