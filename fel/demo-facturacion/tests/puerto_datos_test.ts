// W3 · PUERTO DE DATOS con doble implementación (pooler / Data API) — PostgreSQL en memoria con M-D…M-N y un EMULADOR de PostgREST que verifica la firma del JWT y fija rol y claims.
// Comprueba: (1) el catálogo (todo nombre del servidor tiene su función en `api`), (2) equivalencia entre las dos implementaciones, (3) que la capa de compatibilidad NO permite eludir restricciones:
// sin JWT, JWT falsificado/vencido/«none», sesión cerrada, aal1 en operación sensible, identidad distinta, funciones de sistema y esquemas distintos de `api`; cada rechazo por SU defensa, nunca por error de datos.
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";
import { PERSONAS, EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { CON_ENVOLTORIO, PLATAFORMA, ErrorIdentidad, conIdentidadDeSesion, type ContextoPeticion } from "../src/identidad_sesion.ts";
import { conDataApi, nombreApi, elegirDatos, LECTURAS_API } from "../src/puerto_datos.ts";
import { emularPostgrest, firmarJwt } from "../src/emulador_postgrest.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { CLAVE_DEMO } from "../src/mundo_practico.ts";

const SECRETO = "secreto-de-prueba-0123456789-abcdef", APIKEY = "llave-publica-de-prueba", URL = "http://127.0.0.1:54321";
const ahora = () => Math.floor(Date.now() / 1000);
async function entorno() {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); await activarEstablecimientosLocal(bd);
  const emu = emularPostgrest(bd.db!, { secreto: SECRETO, apikey: APIKEY });
  let ctx: ContextoPeticion | undefined; const contexto = () => ctx;
  const dataapi = conDataApi(bd, { url: URL, apikey: APIKEY, fetch: emu.fetch }, contexto);
  let n = 0;
  const sesion = async (clave: string, aal: "aal1" | "aal2" = "aal1", opciones: { aalToken?: string; exp?: number; secreto?: string; empresa?: string } = {}) => {
    const p = PERSONAS[clave]; const sid = `92000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await bd.ejecutar("insert into auth.sessions (id, user_id, aal) values ($1, $2, $3)", [sid, p.id, aal]);
    const claims = { sub: p.id, role: "authenticated", session_id: sid, aal: opciones.aalToken ?? aal, exp: opciones.exp ?? ahora() + 600, ...(opciones.empresa ? { app_metadata: { empresa_id: opciones.empresa } } : {}) };
    return { sid, jwt: await firmarJwt(claims, opciones.secreto ?? SECRETO), actor: p.id as string, empresa: (p as { empresa?: string }).empresa ?? null };
  };
  const como = (s: { jwt: string; actor: string; empresa: string | null } | null, extra: Partial<ContextoPeticion> = {}) => { ctx = s ? { token: null, actor: s.actor, empresa: s.empresa, jwt: s.jwt, ...extra } : undefined; };
  return { bd, mundo, emu, dataapi, como, sesion };
}
const NIT = (n: number) => `${2000000 + n}-${n % 10}`;
const args = (n: number) => ({ p_id: null, p_tipo_identificacion: "NIT", p_numero_identificacion: NIT(n), p_nombre: `Cliente ${n}`, p_direccion: null, p_email: null, p_telefono: null, p_version: null });
const o = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "W3 catálogo: todo nombre que el servidor puede mandar por la Data API existe en `api`, y toda función de `api` es alcanzable por una regla (sin huérfanas ni de sistema)", ...o, fn: async () => {
  const { bd } = await entorno();
  const api = new Set((await bd.filas<{ n: string }>("select proname n from pg_proc where pronamespace = 'api'::regnamespace")).map((x) => x.n));
  const alcanzables = new Set<string>();
  for (const fn of [...CON_ENVOLTORIO, ...PLATAFORMA.values()].map((x) => PLATAFORMA.has(x) ? x : x)) { const d = nombreApi(fn); assert.ok(d, `sin nombre en api: ${fn}`); assert.ok(api.has(d!), `api.${d} no existe (de ${fn})`); alcanzables.add(d!); }
  const adm = (await bd.filas<{ n: string }>("select proname n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fel\\_adm\\_%' and pg_get_function_arguments(oid) like 'p\\_sesion text%'")).map((x) => x.n);
  for (const fn of adm) { const d = nombreApi(fn); assert.ok(d && api.has(d), `fel_adm sin api: ${fn} -> ${d}`); alcanzables.add(d!); }
  for (const l of LECTURAS_API) { assert.ok(api.has(l), `lectura sin función: ${l}`); alcanzables.add(l); }
  const huerfanas = [...api].filter((x) => !alcanzables.has(x)); assert.deepEqual(huerfanas, [], `funciones de api sin regla del servidor: ${huerfanas}`);
  for (const fn of ["fel_sys_artefacto_guardar", "fel_sys_cobertura_reservar", "fel_auditar", "fel_sys_agente_autenticar", "fel_sys_orden_reclamar", "fel_sys_bolson_revisar"]) assert.equal(nombreApi(fn), null, `${fn} NO se publica en api`);
  assert.equal([...api].filter((x) => /^(sys_|pla_sys_|auditar|aud_)/.test(x)).length, 0);
}});

Deno.test({ name: "W3 equivalencia: lo mismo por pooler (token de sesión) y por Data API (JWT) da el mismo resultado y deja los datos en la misma empresa", ...o, fn: async () => {
  const a = await entorno(), b = await entorno();
  // pooler: sesión de demo_sesiones y envoltorios fel_ses_*; Data API: JWT + api.*
  const sesiones = new Sesiones(undefined, new AlmacenPg(a.bd)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const api = crearApi(a.bd, a.mundo, { sesiones, practico: true, identidadSesion: true });
  const ent = await api(new Request("http://127.0.0.1/api/sesion/entrar", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ usuario: "ana", clave: CLAVE_DEMO }) }));
  assert.equal(ent.status, 200); const tok = (ent.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1]; assert.ok(tok, "token de sesión");
  const pooler = conIdentidadDeSesion(a.bd, () => ({ token: tok, actor: PERSONAS.ana.id, empresa: EMPRESA }));
  const s = await b.sesion("ana"); b.como(s);
  const llamadas: [string, Record<string, unknown>][] = [["fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA, ...args(1) }], ["fel_op_miembros_listar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA }], ["fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA, ...args(2) }]];
  for (const [fn, ar] of llamadas) {
    const x = await pooler.rpc(fn, ar) as Record<string, unknown> | Record<string, unknown>[], y = await b.dataapi.rpc(fn, ar) as Record<string, unknown> | Record<string, unknown>[];
    assert.equal(Array.isArray(x), Array.isArray(y), `${fn}: misma forma (lista o fila)`);
    if (Array.isArray(x)) assert.deepEqual((x as Record<string, unknown>[]).map((r) => r.rol).sort(), (y as Record<string, unknown>[]).map((r) => r.rol).sort(), `${fn}: mismos roles`);
    else { const xr = x as Record<string, unknown>, yr = y as Record<string, unknown>; for (const k of ["nombre", "numero_identificacion", "empresa_id"]) assert.equal(xr[k], yr[k], `${fn}.${k}`); }
  }
  for (const e of [a, b]) assert.equal((await e.bd.filas("select 1 from public.clientes where empresa_id = $1 and numero_identificacion in ($2, $3)", [EMPRESA, NIT(1), NIT(2)])).length, 2);
  assert.ok(b.emu.llamadas.length === 3 && b.emu.llamadas.every((l) => l.rol === "authenticated" && l.sub === PERSONAS.ana.id), "las 3 llamadas salieron por la Data API como `authenticated` con el sub de la persona");
}});

Deno.test({ name: "W3 no-elusión de identidad: sin JWT, falsificado, vencido, «none», sesión cerrada, sesión ajena — cada uno rechazado por su defensa, sin escribir nada", ...o, fn: async () => {
  const e = await entorno(); const contar = async () => (await e.bd.filas("select 1 from public.clientes where numero_identificacion = $1", [NIT(50)])).length;
  // 1) sin JWT: se rechaza ANTES de salir (no hay degradación a otra ruta)
  e.como(null); await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), (x) => x instanceof ErrorIdentidad); assert.equal(e.emu.llamadas.length, 0, "no salió nada");
  const base = await e.sesion("ana");
  // 2) firmado con otro secreto (quien no es Supabase Auth)
  const falso = await e.sesion("ana", "aal1", { secreto: "otro-secreto-0123456789-abcdefghij" }); e.como(falso);
  await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), (x) => x instanceof ErrorIdentidad, "JWT con firma ajena"); assert.equal(e.emu.llamadas.length, 0, "ni siquiera llegó a la base");
  // 3) vencido
  const viejo = await e.sesion("ana", "aal1", { exp: ahora() - 10 }); e.como(viejo); await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), (x) => x instanceof ErrorIdentidad, "JWT vencido");
  // 4) algoritmo «none»
  const h = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, ""), p = btoa(JSON.stringify({ sub: PERSONAS.ana.id, role: "authenticated", session_id: base.sid, aal: "aal2", exp: ahora() + 600 })).replace(/=+$/, "");
  e.como({ ...base, jwt: `${h}.${p}.` }); await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), (x) => x instanceof ErrorIdentidad, "alg none"); assert.equal(e.emu.llamadas.length, 0);
  // 5) firma válida pero la sesión ya no existe en auth.sessions (cierre de sesión): rechaza LA BASE, de inmediato aunque el token no haya vencido
  const viva = await e.sesion("ana"); e.como(viva); await e.dataapi.rpc("fel_op_cliente_guardar", args(51));
  await e.bd.ejecutar("delete from auth.sessions where id = $1", [viva.sid]);
  await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), /sesión no válida/i, "sesión cerrada: la decide la base"); assert.equal(await contar(), 0);
  // 6) sub de una persona y session_id de otra
  const otra = await e.sesion("sofia"); const mezcla = await firmarJwt({ sub: PERSONAS.ana.id, role: "authenticated", session_id: otra.sid, aal: "aal1", exp: ahora() + 600 }, SECRETO);
  e.como({ ...base, jwt: mezcla }); await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(50)), /sesión no válida/i, "session_id ajeno"); assert.equal(await contar(), 0);
  // 7) el servidor «se equivoca» y manda otra persona/empresa: se rechaza antes de salir
  const n0 = e.emu.llamadas.length; e.como(await e.sesion("ana"));
  await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.marta.id, p_empresa: EMPRESA, ...args(50) }), /no es la de la sesión/);
  await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", { p_actor: PERSONAS.ana.id, p_empresa: EMPRESA2, ...args(50) }), /no es la de la sesión/);
  assert.equal(e.emu.llamadas.length, n0, "ningún rechazo salió de la aplicación"); assert.equal(await contar(), 0);
}});

Deno.test({ name: "W3 no-elusión de MFA y de empresa: aal1 no pasa en operaciones sensibles (ni aal2 solo en el token); la empresa sale de la membresía aunque el cliente mande otra", ...o, fn: async () => {
  const e = await entorno(); const est = { p_id: null, p_codigo: "777", p_nombre: "Sucursal W3", p_direccion: null, p_estado: "activo" };
  e.como(await e.sesion("ana", "aal1")); await assert.rejects(() => e.dataapi.rpc("fel_op_establecimiento_guardar", est), /aal2|dos pasos/i, "aal1 rechazado por MFA");
  e.como(await e.sesion("ana", "aal1", { aalToken: "aal2" })); await assert.rejects(() => e.dataapi.rpc("fel_op_establecimiento_guardar", est), /aal2|dos pasos/i, "aal2 solo en el token: no vale");
  e.como(await e.sesion("ana", "aal2")); await e.dataapi.rpc("fel_op_establecimiento_guardar", est);
  assert.equal((await e.bd.filas("select 1 from public.establecimientos where nombre = 'Sucursal W3' and empresa_id = $1", [EMPRESA])).length, 1);
  // aislamiento entre empresas: sofia (EMPRESA2) escribe y lista SOLO lo suyo, sin importar lo que el cliente mande
  const sofia = await e.sesion("sofia"); e.como({ ...sofia, empresa: null });   // el servidor ni siquiera conoce la empresa
  await e.dataapi.rpc("fel_op_cliente_guardar", { p_empresa: EMPRESA, ...args(60) });   // p_empresa se retira: manda la membresía
  assert.equal((await e.bd.filas("select 1 from public.clientes where numero_identificacion = $1 and empresa_id = $2", [NIT(60), EMPRESA2])).length, 1);
  assert.equal((await e.bd.filas("select 1 from public.clientes where numero_identificacion = $1 and empresa_id = $2", [NIT(60), EMPRESA])).length, 0, "nada en la empresa ajena");
  const m = await e.dataapi.rpc("fel_op_miembros_listar", {}) as { empresa_id?: string; user_id?: string }[];
  assert.ok(Array.isArray(m) && m.length > 0 && m.every((r) => !r.empresa_id || r.empresa_id === EMPRESA2), "la lista de sofia solo trae su empresa");
  // el selector `app_metadata.empresa_id` solo ELIGE entre las propias: uno ajeno falla en la base
  const ajeno = await e.sesion("sofia", "aal1", { empresa: EMPRESA }); e.como(ajeno); await assert.rejects(() => e.dataapi.rpc("fel_op_cliente_guardar", args(61)), /no eres miembro activo/i);
}});

Deno.test({ name: "W3 no-elusión de superficie: las funciones de sistema/auditoría no salen por la Data API; la Data API real solo expone `api`; la llave pública sola no da acceso", ...o, fn: async () => {
  const e = await entorno(); const s = await e.sesion("ana", "aal2"); e.como(s);
  // 1) una función del sistema NO va por la Data API: se delega en la conexión interna (aquí la propia base) y la Data API no registra nada
  const n0 = e.emu.llamadas.length; await e.dataapi.rpc("fel_sys_artefactos_faltantes", { p_limite: 1 }).catch(() => {}); assert.equal(e.emu.llamadas.length, n0, "fel_sys_* no sale por la Data API");
  // 2) llamadas directas a la Data API (sin pasar por el puerto): lo que no está en `api` no existe; otros esquemas no se exponen; sin JWT no hay identidad
  const crudo = (ruta: string, cab: Record<string, string>, cuerpo: unknown = {}) => e.emu.fetch(`${URL}/rest/v1/rpc/${ruta}`, { method: "POST", headers: { "content-type": "application/json", ...cab }, body: JSON.stringify(cuerpo) });
  const bearer = { apikey: APIKEY, authorization: `Bearer ${s.jwt}` };
  assert.equal((await crudo("fel_sys_artefacto_guardar", bearer)).status, 404, "función de sistema: no existe en api");
  assert.equal((await crudo("fel_ses_cliente_guardar", bearer, { p_sesion: "x", ...args(70) })).status, 404, "los envoltorios de public no se exponen");
  assert.equal((await crudo("contexto", { ...bearer, "content-profile": "public", "accept-profile": "public" })).status, 406, "perfil distinto de api");
  assert.equal((await crudo("contexto", { authorization: `Bearer ${s.jwt}` })).status, 401, "sin apikey");
  const anon = await crudo("contexto", { apikey: APIKEY }); assert.equal(anon.status, 401, "anónimo: sin privilegio sobre api"); assert.match((await anon.json()).message, /permission denied/i);
  assert.equal((await crudo("contexto", bearer)).status, 200);
  // 3) la identidad que el cliente pone en el cuerpo no cambia nada: la base ignora lo que no es su firma
  const r = await crudo("contexto", bearer, { p_actor: PERSONAS.marta.id, p_empresa: EMPRESA2 }); assert.equal(r.status, 404, "api.contexto no tiene esos parámetros: PostgREST no encuentra la firma");
  // 4) el interruptor
  const base = (await entorno()).bd; assert.equal(elegirDatos(base, () => undefined).modo, "pooler");
  assert.throws(() => elegirDatos(base, (k) => k === "FEL_DATOS" ? "dataapi" : undefined), /FEL_DATA_API_URL/);
  assert.throws(() => elegirDatos(base, (k) => ({ FEL_DATOS: "dataapi", FEL_DATA_API_URL: "http://ejemplo.com", FEL_DATA_API_KEY: "k" } as Record<string, string>)[k]), /https/);
  assert.equal(elegirDatos(base, (k) => ({ FEL_DATOS: "dataapi", FEL_DATA_API_URL: "https://x.supabase.co", FEL_DATA_API_KEY: "k" } as Record<string, string>)[k]).modo, "dataapi");
}});

// ---- W4 · piloto de lecturas: las rutas del servidor por la Data API (RPC INVOKER + RLS) devuelven lo mismo que por el pooler, sin degradación silenciosa ----
// los UUID se generan por entorno: se compara contenido y orden sin ellos
const sinId = (v: unknown): unknown => Array.isArray(v) ? v.map(sinId) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "id").map(([k, x]) => [k, sinId(x)])) : v;
async function servidor(modo: "pooler" | "dataapi") {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); await activarEstablecimientosLocal(bd);
  const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const emu = emularPostgrest(bd.db!, { secreto: SECRETO, apikey: APIKEY }); let n = 0;
  const jwtDe = (req: Request) => req.headers.get("x-jwt-prueba");
  const api = crearApi(bd, mundo, { sesiones, practico: true, identidadSesion: true, ...(modo === "dataapi" ? { datosApi: { url: URL, apikey: APIKEY, fetch: emu.fetch }, jwtDe } : {}) });
  const entrar = async (clave: string, aal: "aal1" | "aal2" = "aal2") => {
    const r = await api(new Request("http://127.0.0.1/api/sesion/entrar", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ usuario: clave, clave: CLAVE_DEMO }) })); assert.equal(r.status, 200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]; const sid = `94000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await bd.ejecutar("insert into auth.sessions (id, user_id, aal) values ($1, $2, $3)", [sid, PERSONAS[clave].id, aal]);
    const jwt = await firmarJwt({ sub: PERSONAS[clave].id, role: "authenticated", session_id: sid, aal, exp: ahora() + 600 }, SECRETO);
    return { cookie, sid, jwt, ll: async (m: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => { const x = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", cookie, "x-jwt-prueba": jwt, ...cab }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const t = await x.text(); let json: Record<string, any> = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: x.status, json, texto: t }; } };
  };
  return { bd, emu, entrar };
}
Deno.test({ name: "W4 rutas: /api/estado, /api/clientes, /api/conceptos y /api/configuracion por la Data API devuelven lo mismo que por el pooler; con la Data API no hay degradación sin JWT", ...o, fn: async () => {
  const P = await servidor("pooler"), D = await servidor("dataapi");
  const ap = await P.entrar("ana"), ad = await D.entrar("ana");
  for (const ruta of ["/api/clientes", "/api/conceptos"]) {
    const x = await ap.ll("GET", ruta), y = await ad.ll("GET", ruta); assert.equal(x.status, 200); assert.equal(y.status, 200, y.texto);
    assert.deepEqual(sinId(y.json), sinId(x.json), `${ruta}: mismo contenido y orden de filas`);
  }
  const ex = await ap.ll("GET", "/api/estado"), ey = await ad.ll("GET", "/api/estado"); assert.equal(ey.status, 200, ey.texto);
  for (const k of ["establecimientos", "clientes", "conceptos", "parametros"]) assert.deepEqual(sinId(ey.json[k]), sinId(ex.json[k]), `/api/estado.${k}`);
  const cx = await ap.ll("GET", "/api/configuracion"), cy = await ad.ll("GET", "/api/configuracion"); assert.equal(cy.status, 200, cy.texto); assert.deepEqual(sinId(cy.json.establecimientos), sinId(cx.json.establecimientos), "configuración: establecimientos");
  const llamadas = D.emu.llamadas.map((l) => l.fn); for (const f of ["clientes_listar", "conceptos_listar", "estado_catalogos", "establecimientos_listar"]) assert.ok(llamadas.includes(f), `salió por la Data API: ${f}`);
  assert.equal(llamadas.filter((f) => f === "estado_catalogos").length, 1, "UNA RPC por pantalla (conserva #55)");
  // escritura + lectura por la Data API: el cliente nuevo aparece en la lista
  const nuevo = await ad.ll("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: NIT(88), nombre: "Cliente W4" }); assert.equal(nuevo.status, 200, nuevo.texto);
  assert.ok((await ad.ll("GET", "/api/clientes")).json.some((c: { nombre: string }) => c.nombre === "Cliente W4"));
  // sin JWT con la Data API activa: la lectura NO baja al pooler, se rechaza 403 (y no entra ninguna llamada nueva)
  const n0 = D.emu.llamadas.length; const sin = await ad.ll("GET", "/api/clientes", undefined, { "x-jwt-prueba": "" }); assert.equal(sin.status, 403, sin.texto); assert.equal(D.emu.llamadas.length, n0);
  const sin2 = await ad.ll("GET", "/api/estado", undefined, { "x-jwt-prueba": "" }); assert.equal(sin2.status, 403, sin2.texto);
  // sesión cerrada en Supabase Auth: efecto inmediato aunque la cookie propia siga viva
  await D.bd.ejecutar("delete from auth.sessions where id = $1", [ad.sid]); const cerrada = await ad.ll("GET", "/api/clientes"); assert.equal(cerrada.status, 403, cerrada.texto); assert.match(cerrada.texto, /sesión no válida/i);
  // aislamiento: la persona de OTRA empresa, por la Data API, no ve los clientes de ana
  const sd = await D.entrar("sofia"); const lista = (await sd.ll("GET", "/api/clientes")).json as { nombre: string }[]; assert.ok(!lista.some((c) => c.nombre === "Cliente W4"), "sofia no ve lo de ana");
}});
