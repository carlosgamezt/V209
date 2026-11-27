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
  const espia = { n: 0 };   // cuenta TODA consulta/rpc que la aplicación (no la sesión propia) hace a la base
  const bdEspiada = { ...bd, filas: (...x: Parameters<typeof bd.filas>) => { espia.n++; return bd.filas(...x); }, ejecutar: (...x: Parameters<typeof bd.ejecutar>) => { espia.n++; return bd.ejecutar(...x); }, rpc: (...x: Parameters<typeof bd.rpc>) => { espia.n++; return bd.rpc(...x); }, lote: bd.lote ? (...x: Parameters<NonNullable<typeof bd.lote>>) => { espia.n++; return bd.lote!(...x); } : undefined } as typeof bd;
  const api = crearApi(bdEspiada, mundo, { sesiones, practico: true, identidadSesion: true, ...(modo === "dataapi" ? { datosApi: { url: URL, apikey: APIKEY, fetch: emu.fetch }, jwtDe } : {}) });
  const entrar = async (clave: string, aal: "aal1" | "aal2" = "aal2") => {
    const r = await api(new Request("http://127.0.0.1/api/sesion/entrar", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ usuario: clave, clave: CLAVE_DEMO }) })); assert.equal(r.status, 200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]; const sid = `94000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await bd.ejecutar("insert into auth.sessions (id, user_id, aal) values ($1, $2, $3)", [sid, PERSONAS[clave].id, aal]);
    const jwt = await firmarJwt({ sub: PERSONAS[clave].id, role: "authenticated", session_id: sid, aal, exp: ahora() + 600 }, SECRETO);
    return { cookie, sid, jwt, bin: async (ruta: string) => { const x = await api(new Request("http://127.0.0.1" + ruta, { headers: { "x-demo": "1", cookie, "x-jwt-prueba": jwt } })); return { status: x.status, bytes: (await x.arrayBuffer()).byteLength }; }, ll: async (m: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => { const x = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", cookie, "x-jwt-prueba": jwt, ...cab }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const t = await x.text(); let json: Record<string, any> = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: x.status, json, texto: t }; } };
  };
  return { bd, emu, entrar, espia };
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

// ---- Parámetros de plataforma por clase (M-R): el servidor solo entrega la clase «usuario», por el pooler y por la Data API ----
import { PARAMETROS_USUARIO } from "../src/parametros.ts";
Deno.test({ name: "Parámetros: la lista del servidor = la clase «usuario» de la base; /api/estado y /api/configuracion solo entregan esa clase (pooler y Data API); ningún umbral de defensa llega al cliente", ...o, fn: async () => {
  const P = await servidor("pooler"), D = await servidor("dataapi");
  const clases = await P.bd.filas<{ clave: string; clase: string | null }>("select clave, public.fel__parametro_clase(clave) as clase from public.plataforma_parametros order by clave");
  assert.deepEqual(clases.filter((c) => c.clase === "usuario").map((c) => c.clave).sort(), [...PARAMETROS_USUARIO].sort(), "la lista del servidor coincide con la clasificación de la base");
  assert.deepEqual(clases.filter((c) => c.clase === null), [], "todo parámetro existente está clasificado");
  const internos = clases.filter((c) => c.clase === "interno").map((c) => c.clave); assert.ok(internos.length >= 6 && internos.includes("mfa_operaciones_sensibles") && internos.includes("agente_vinculacion_max_origen"));
  await P.bd.ejecutar("insert into public.plataforma_parametros (clave, valor, descripcion) values ('zz_nuevo_sin_clasificar', 5, 'prueba')"); await D.bd.ejecutar("insert into public.plataforma_parametros (clave, valor, descripcion) values ('zz_nuevo_sin_clasificar', 5, 'prueba')");
  for (const [nombre, S] of [["pooler", P], ["dataapi", D]] as const) {
    const a = await S.entrar("ana");
    const est = await a.ll("GET", "/api/estado"); assert.equal(est.status, 200, est.texto); const cfg = await a.ll("GET", "/api/configuracion"); assert.equal(cfg.status, 200, cfg.texto);
    for (const [ruta, r] of [["/api/estado", est], ["/api/configuracion", cfg]] as const) {
      const claves = (r.json.parametros as { clave: string }[]).map((p) => p.clave).sort();
      assert.deepEqual(claves, [...PARAMETROS_USUARIO].sort(), `${nombre} ${ruta}: solo la clase usuario`);
      assert.ok(!claves.some((c) => /mfa|vinculacion|reloj|peticiones|zz_nuevo|agente_/.test(c)), `${nombre} ${ruta}: ningún parámetro interno ni sin clasificar`);
    }
  }
}});

// ---- R3 segunda tanda (M-S): documentos, detalle, archivos, panel y reporte por la Data API = lo mismo que por el pooler; sin JWT NADA toca la base ----
// Se compara contenido y orden sin ids ni marcas de tiempo/valores aleatorios; la forma (claves y tipos) debe ser idéntica.
const ALEATORIO = /^(id|.*_id|.*_en|clave_idempotencia|orden_externa|sha256|autorizacion|autorizacion_sat|serie|numero|numero_fiscal|referencia_externa|hash_.*|tamano|enviada_en)$/;
const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !ALEATORIO.test(k)).sort(([a], [b]) => a < b ? -1 : 1).map(([k, x]) => [k, norm(x)])) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(v) ? v.slice(0, 10) : v;   // la interfaz toma siempre los 10 primeros caracteres de una fecha
const tipos = (v: unknown): unknown => Array.isArray(v) ? (v.length ? tipos(v[0]) : "[]") : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1).map(([k, x]) => [k, tipos(x)])) : v === null ? "null" : typeof v;
async function flujo(S: Awaited<ReturnType<typeof servidor>>) {
  const a = await S.entrar("ana"); const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const cli = await a.ll("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: NIT(300), nombre: "Cliente Flujo" }); assert.equal(cli.status, 200, cli.texto);
  await a.ll("POST", "/api/conceptos", { codigo: "SRV-F", descripcion: "Servicio flujo", tipo: "servicio", unidad_medida: "UNI", precio_unitario: "100.00" });
  const est = (await a.ll("GET", "/api/estado")).json.establecimientos[0].id; const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = await a.ll("POST", "/api/documentos", { cliente_id: cli.json.id, establecimiento_id: est, fecha: hoy, lineas: [{ descripcion: "Servicio flujo", cantidad: String(i + 1), precio_unitario: "100.00" }] }); assert.equal(d.status, 200, d.texto); ids.push(d.json.documento.id);
  }
  for (const id of ids.slice(0, 2)) { const g = await a.ll("GET", `/api/documentos/${id}`); await a.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: g.json.documento.version }); const c = await a.ll("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: `clave-flujo-${ids.indexOf(id)}-${Math.random().toString(36).slice(2, 10)}-0001` }); assert.equal(c.json.documento?.estado_fiscal, "certificado", c.texto); }
  return { a, ids };
}
Deno.test({ name: "R3·M-S rutas: lista, detalle, archivos, panel y reporte por la Data API = pooler; sin JWT ninguna ruta toca la base (ni siquiera las no migradas)", ...o, fn: async () => {
  const P = await servidor("pooler"), D = await servidor("dataapi"); const fp = await flujo(P), fd = await flujo(D);
  // lista paginada con filtros y categorías
  for (const qs of ["pagina=1&tam=25", "pagina=1&tam=2", "pagina=2&tam=2", "pagina=1&categoria=emitidos", "pagina=1&categoria=borradores", "pagina=1&q=Flujo", "pagina=1&estado=certificado", "pagina=99&tam=2"]) {
    const x = await fp.a.ll("GET", `/api/documentos?${qs}`), y = await fd.a.ll("GET", `/api/documentos?${qs}`); assert.equal(y.status, 200, `${qs}: ${y.texto}`);
    assert.deepEqual(norm(y.json), norm(x.json), `lista ${qs}: mismo contenido y orden`); assert.deepEqual(tipos(y.json), tipos(x.json), `lista ${qs}: mismas claves y tipos`);
  }
  // detalle (documento certificado: operaciones, eventos, archivos) y borrador
  for (const i of [0, 3]) {
    const x = await fp.a.ll("GET", `/api/documentos/${fp.ids[i]}`), y = await fd.a.ll("GET", `/api/documentos/${fd.ids[i]}`); assert.equal(y.status, 200, y.texto);
    assert.deepEqual(norm(y.json.documento), norm(x.json.documento), `detalle ${i}: documento`); assert.deepEqual(tipos(y.json.documento), tipos(x.json.documento), `detalle ${i}: tipos del documento`);
    for (const k of ["lineas", "operaciones", "eventos", "conciliaciones", "alertas", "artefactos"]) { assert.deepEqual(norm(y.json[k]), norm(x.json[k]), `detalle ${i}.${k}`); assert.deepEqual(tipos(y.json[k]), tipos(x.json[k]), `detalle ${i}.${k}: tipos`); }
  }
  const dx = (await fd.a.ll("GET", `/api/documentos/${fd.ids[0]}`)).json; assert.ok(dx.artefactos.length >= 1, "el documento certificado tiene archivos");
  // descarga de archivos: mismo contenido por ambos caminos
  for (const [nombre, f] of [["pooler", fp], ["dataapi", fd]] as const) { const det = (await f.a.ll("GET", `/api/documentos/${f.ids[0]}`)).json; const r = await f.a.bin(`/api/artefactos/${det.artefactos[0].id}`); assert.equal(r.status, 200, `${nombre} descarga`); assert.ok(r.bytes > 100, `${nombre}: contenido no vacío (${r.bytes})`); }
  // panel y reportes
  const px = await fp.a.ll("GET", "/api/panel"), py = await fd.a.ll("GET", "/api/panel"); assert.equal(py.status, 200, py.texto);
  assert.deepEqual(norm(py.json.documentos), norm(px.json.documentos), "panel: totales"); assert.deepEqual(norm(py.json.clientes), norm(px.json.clientes), "panel: clientes"); assert.deepEqual(py.json.serie.map((s: { certificados: number }) => s.certificados), px.json.serie.map((s: { certificados: number }) => s.certificados), "panel: serie");
  const rx = await fp.a.ll("GET", "/api/reportes/documentos.csv"), ry = await fd.a.ll("GET", "/api/reportes/documentos.csv"); assert.equal(ry.status, 200, ry.texto);
  assert.equal(ry.texto.split("\n").length, rx.texto.split("\n").length, "reporte: mismas filas"); assert.equal(ry.texto.split("\n")[0], rx.texto.split("\n")[0], "reporte: mismas columnas");
  // salieron por la Data API
  const usadas = new Set(D.emu.llamadas.map((l) => l.fn)); for (const f of ["documentos_listar", "documento_detalle", "artefacto_descargar", "panel_resumen", "reporte_documentos"]) assert.ok(usadas.has(f), `por la Data API: ${f}`);
  // sin JWT: NINGUNA ruta autenticada llega a la base (el espía cuenta toda consulta/rpc de la aplicación) ni a la Data API; mismo resultado con firma ajena y con JWT vencido
  const rutas = ["/api/documentos?pagina=1", `/api/documentos/${fd.ids[0]}`, "/api/panel", "/api/reportes/documentos.csv", "/api/clientes", "/api/estado", "/api/configuracion", "/api/usuarios", "/api/plan", "/api/agentes"];
  const llamadas0 = D.emu.llamadas.length; D.espia.n = 0;
  for (const r of rutas) { const x = await fd.a.ll("GET", r, undefined, { "x-jwt-prueba": "" }); assert.equal(x.status, 403, `${r} sin JWT: ${x.texto}`); assert.match(x.texto, /sesión no válida/i, `${r}: motivo`); }
  const falso = await firmarJwt({ sub: PERSONAS.ana.id, role: "authenticated", session_id: fd.a.sid, aal: "aal2", exp: ahora() + 600 }, "otro-secreto-0123456789-abcdefghij");
  const venc = await firmarJwt({ sub: PERSONAS.ana.id, role: "authenticated", session_id: fd.a.sid, aal: "aal2", exp: ahora() - 5 }, SECRETO);
  for (const t of [falso, venc]) for (const r of ["/api/documentos?pagina=1", "/api/panel"]) { const x = await fd.a.ll("GET", r, undefined, { "x-jwt-prueba": t }); assert.equal(x.status, 403, `${r}: JWT inválido`); }
  assert.equal(D.espia.n, 0, "sin JWT válido la aplicación NO ejecutó ninguna consulta ni rpc (nada de pooler como alternativa)"); assert.equal(D.emu.llamadas.length, llamadas0, "tampoco llegó a la Data API");
  // aislamiento: la persona de OTRA empresa no ve nada de ana por ninguna de las rutas
  const sd = await D.entrar("sofia"); const lista = (await sd.ll("GET", "/api/documentos?pagina=1")).json as { total: number }; assert.equal(lista.total, 0, "sofia no ve documentos de ana");
  const det = await sd.ll("GET", `/api/documentos/${fd.ids[0]}`); assert.equal(det.status, 404, det.texto);
  const art = (await fd.a.ll("GET", `/api/documentos/${fd.ids[0]}`)).json.artefactos[0]; assert.equal((await sd.bin(`/api/artefactos/${art.id}`)).status, 404, "archivo de otra empresa: no existe");
}});

// ---- R3 tanda final (M-T): plan, consumos, usuarios y rutas de plataforma por la Data API = pooler; negativas por la defensa de la base; sin JWT nada toca la base ----
Deno.test({ name: "R3·M-T rutas: plan, reporte de consumos, usuarios y plataforma por la Data API = pooler; permisos y MFA decididos por la base; rutas de simulación cerradas; sin JWT nada toca la base", ...o, fn: async () => {
  const P = await servidor("pooler"), D = await servidor("dataapi"); const fp = await flujo(P), fd = await flujo(D);
  const mp = await P.entrar("maestro"), md = await D.entrar("maestro");
  const cmp = async (ruta: string, quien: "a" | "m", ignorar: string[] = []) => {
    const x = quien === "a" ? await fp.a.ll("GET", ruta) : await mp.ll("GET", ruta), y = quien === "a" ? await fd.a.ll("GET", ruta) : await md.ll("GET", ruta); assert.equal(x.status, 200, `${ruta} pooler: ${x.texto}`); assert.equal(y.status, 200, `${ruta} dataapi: ${y.texto}`);
    const q = (v: unknown) => { const w = norm(v) as Record<string, unknown>; for (const k of ignorar) delete w[k]; return w; };
    assert.deepEqual(q(y.json), q(x.json), `${ruta}: mismo contenido`); assert.deepEqual(tipos(q(y.json)), tipos(q(x.json)), `${ruta}: mismas claves y tipos`); return y;
  };
  // empresa
  const plan = await cmp("/api/plan", "a"); assert.ok(plan.json.cuenta && plan.json.contrato && Array.isArray(plan.json.consumos) && plan.json.consumos.length >= 1, "el plan tiene cuenta, contrato y consumos de las certificaciones");
  await cmp("/api/panel", "a", ["serie"]);
  const csvP = await fp.a.ll("GET", "/api/reportes/consumos.csv"), csvD = await fd.a.ll("GET", "/api/reportes/consumos.csv"); assert.equal(csvD.status, 200, csvD.texto);
  assert.equal(csvD.texto.split("\n").length, csvP.texto.split("\n").length, "reporte de consumos: mismas filas"); assert.equal(csvD.texto.split("\n")[0], csvP.texto.split("\n")[0], "mismas columnas");
  const us = await cmp("/api/usuarios", "a", ["yo"]); assert.ok(us.json.invitaciones !== undefined && us.json.roles.length === 4 && us.json.catalogo.length > 5, "usuarios: roles y catálogo");
  // plataforma
  const empId = (await fd.a.ll("GET", "/api/estado")).json.empresa?.id ?? EMPRESA;
  await cmp("/api/plataforma/resumen", "m", ["verificacion"]); const res = await md.ll("GET", "/api/plataforma/resumen"); assert.ok(res.json.verificacion.comprobaciones >= 1 && res.json.verificacion.fallos === 0, "verificación de saldos por la Data API");
  await cmp("/api/plataforma/planes", "m"); await cmp("/api/plataforma/bolson", "m", ["simuladores", "verificacion", "nombres"]); await cmp("/api/plataforma/bolson/conciliaciones", "m", ["nombres", "yo"]);
  const pe = await md.ll("GET", `/api/plataforma/empresas/${empId}/plan`); assert.equal(pe.status, 200, pe.texto); assert.ok(pe.json.cuenta, "plan de una empresa elegida por el administrador");
  const usadas = new Set(D.emu.llamadas.map((l) => l.fn)); for (const f of ["plan_resumen", "reporte_consumos", "usuarios_resumen", "pla_lectura_resumen", "pla_lectura_planes", "pla_lectura_plan_empresa", "pla_lectura_bolson", "pla_lectura_conciliaciones", "pla_lectura_verificacion"]) assert.ok(usadas.has(f), `por la Data API: ${f}`);
  // las rutas acopladas a la simulación no existen con la Data API; con el pooler siguen igual
  for (const [m, r] of [["POST", "/api/usuarios"], ["POST", "/api/plataforma/empresas"], ["POST", "/api/plataforma/bolson/extractos/importar"]] as const) { const x = m === "POST" && r.startsWith("/api/plataforma") ? await md.ll(m, r, {}) : await fd.a.ll(m, r, {}); assert.equal(x.status, 404, `${r}: ${x.texto}`); assert.match(x.texto, /simulación|no_disponible/i); }
  // aislamiento y permisos: la persona de otra empresa ve SU plan; un lector no ve plan ni usuarios (la base lo decide, no solo el servidor)
  const sd = await D.entrar("sofia"); const psofia = await sd.ll("GET", "/api/plan"); assert.equal(psofia.status, 200, psofia.texto); assert.notDeepEqual(norm(psofia.json.consumos), norm(plan.json.consumos), "sofía no recibe los consumos de ana");
  const crudo = (jwt: string, fn: string, cuerpo: unknown = {}) => D.emu.fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { "content-type": "application/json", apikey: APIKEY, authorization: `Bearer ${jwt}`, "content-profile": "api" }, body: JSON.stringify(cuerpo) });
  const pedro = await D.entrar("pedro"); const msg = async (r: Response) => ({ st: r.status, m: ((await r.json()) as { message?: string }).message ?? "" });
  assert.match((await msg(await crudo(pedro.jwt, "plan_resumen"))).m, /FEL_NO_AUTORIZADO.*plan/, "lector sin facturacion.ver: lo rechaza LA BASE"); assert.match((await msg(await crudo(pedro.jwt, "usuarios_resumen"))).m, /FEL_NO_AUTORIZADO.*usuarios/);
  assert.match((await msg(await crudo(pedro.jwt, "reporte_consumos"))).m, /FEL_NO_AUTORIZADO/);
  for (const fn of ["pla_lectura_resumen", "pla_lectura_planes", "pla_lectura_bolson", "pla_lectura_conciliaciones", "pla_lectura_verificacion"]) { const r = await msg(await crudo(fd.a.jwt, fn)); assert.ok(r.st >= 400 && /FEL_NO_AUTORIZADO/.test(r.m), `${fn} con la sesión de una empresa: ${r.st} ${r.m}`); }
  assert.equal((await crudo(fd.a.jwt, "pla_lectura_plan_empresa", { p_empresa: empId })).status, 400, "una persona de empresa no lee el plan de otra por la ruta de plataforma");
  const anon = await D.emu.fetch(`${URL}/rest/v1/rpc/plan_resumen`, { method: "POST", headers: { "content-type": "application/json", apikey: APIKEY, "content-profile": "api" }, body: "{}" }); assert.equal(anon.status, 401);
  // MFA de plataforma: con el parámetro obligatorio, el administrador con aal1 queda fuera
  await D.bd.ejecutar("update public.plataforma_parametros set valor = 1 where clave = 'plataforma_mfa_obligatoria'");
  const m1 = await D.entrar("maestro", "aal1"); const r1 = await msg(await crudo(m1.jwt, "pla_lectura_resumen")); assert.ok(r1.st >= 400 && /dos pasos/.test(r1.m), `aal1: ${r1.m}`);
  assert.equal((await crudo(md.jwt, "pla_lectura_resumen")).status, 200, "con aal2 pasa");
  // sin JWT: ninguna ruta nueva llega a la base ni a la Data API
  D.espia.n = 0; const n0 = D.emu.llamadas.length;
  for (const r of ["/api/plan", "/api/reportes/consumos.csv", "/api/usuarios"]) { const x = await fd.a.ll("GET", r, undefined, { "x-jwt-prueba": "" }); assert.equal(x.status, 403, r); }
  for (const r of ["/api/plataforma/resumen", "/api/plataforma/planes", "/api/plataforma/bolson", "/api/plataforma/bolson/conciliaciones", `/api/plataforma/empresas/${empId}/plan`]) { const x = await md.ll("GET", r, undefined, { "x-jwt-prueba": "" }); assert.equal(x.status, 403, r); }
  assert.equal(D.espia.n, 0, "sin JWT: ninguna consulta ni rpc de la aplicación"); assert.equal(D.emu.llamadas.length, n0);
}});

// ---- Paginación de clientes y conceptos (M-U): pooler = Data API; conjunto de trabajo acotado con totales; sin cambios por debajo del tope ----
Deno.test({ name: "Paginación: /api/clientes y /api/conceptos paginados = por pooler y por Data API; /api/estado entrega un conjunto de trabajo (500/1000) con totales; con pocos registros todo es como siempre", ...o, fn: async () => {
  const P = await servidor("pooler"), D = await servidor("dataapi");
  const ap = await P.entrar("ana"), ad = await D.entrar("ana");
  // por debajo del tope: sin cambios (totales = longitud) y la lista completa de siempre
  for (const [a] of [[ap], [ad]] as const) { const e = (await a.ll("GET", "/api/estado")).json; assert.equal(e.clientes_total, e.clientes.length, "por debajo del tope: todo el conjunto"); assert.equal(e.conceptos_total, e.conceptos.length); const l = await a.ll("GET", "/api/clientes"); assert.ok(Array.isArray(l.json), "ruta sin «pagina»: lista completa como siempre"); }
  const masivo = async (S: typeof P) => {
    await S.bd.ejecutar("insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre, activo, frecuente) select $1, case when g % 5 = 0 then 'CUI' else 'NIT' end, (9000000 + g) || '-1', 'Masivo ' || lpad(g::text, 4, '0'), g % 50 <> 0, g % 97 = 0 from generate_series(1, 560) g", [EMPRESA]);
    await S.bd.ejecutar("insert into public.conceptos (empresa_id, codigo, descripcion, tipo, unidad_medida, precio_unitario, activo) select $1, 'M' || g, 'Concepto masivo ' || lpad(g::text, 4, '0'), case when g % 2 = 0 then 'bien' else 'servicio' end, 'UNI', 1, true from generate_series(1, 1100) g", [EMPRESA]);
  };
  await masivo(P); await masivo(D);
  const x = (await ap.ll("GET", "/api/estado")).json, y = (await ad.ll("GET", "/api/estado")).json;
  for (const [n, e] of [["pooler", x], ["dataapi", y]] as const) { assert.equal(e.clientes.length, 500, `${n}: conjunto de trabajo de clientes`); assert.ok(e.clientes_total > 500, `${n}: total mayor que el conjunto`); assert.equal(e.conceptos.length, 1000, `${n}: conceptos acotados`); assert.ok(e.conceptos_total >= 1100, `${n}: total de conceptos`); assert.ok(e.clientes[0].frecuente, `${n}: los frecuentes primero`); }
  assert.equal(y.clientes_total, x.clientes_total); assert.deepEqual(norm(y.clientes.slice(0, 20)), norm(x.clientes.slice(0, 20)), "mismo orden del conjunto de trabajo");
  // rutas paginadas: mismas respuestas por ambos caminos
  for (const qs of ["pagina=1&tam=5", "pagina=3&tam=5", "pagina=1&tam=100&tipo=persona", "pagina=1&frecuentes=1", "pagina=1&q=masivo%200007", "pagina=1&q=9000010", "pagina=1&inactivos=1&tam=100", "pagina=99999&tam=100", "pagina=1&tam=1000&tipo=basura&q=%25"]) {
    const a = await ap.ll("GET", `/api/clientes?${qs}`), b = await ad.ll("GET", `/api/clientes?${qs}`); assert.equal(a.status, 200, `${qs}: ${a.texto}`); assert.equal(b.status, 200, `${qs}: ${b.texto}`);
    assert.deepEqual(norm(b.json), norm(a.json), `clientes ${qs}`); assert.deepEqual(tipos(b.json), tipos(a.json), `clientes ${qs}: tipos`);
  }
  for (const qs of ["pagina=1", "pagina=22&tam=50", "pagina=1&tipo=bien&q=masivo%20000", "pagina=1&inactivos=1&q=%25"]) {
    const a = await ap.ll("GET", `/api/conceptos?${qs}`), b = await ad.ll("GET", `/api/conceptos?${qs}`); assert.equal(b.status, 200, `${qs}: ${b.texto}`); assert.deepEqual(norm(b.json), norm(a.json), `conceptos ${qs}`); assert.deepEqual(tipos(b.json), tipos(a.json), `conceptos ${qs}: tipos`);
  }
  const p1 = (await ad.ll("GET", "/api/clientes?pagina=1&tam=5")).json; assert.equal(p1.items.length, 5); assert.ok(p1.total > 500 && p1.conteos.registrados === p1.total, "total e indicadores sobre los activos"); assert.equal(p1.paginas, Math.ceil(p1.total / 5));
  const pc = (await ad.ll("GET", "/api/conceptos?pagina=1&tam=50")).json; assert.equal(pc.items.length, 50); assert.ok(pc.total >= 1100);
  // aislamiento y JWT: la otra empresa no ve nada de esto; sin JWT la ruta paginada no toca la base
  const sd = await D.entrar("sofia"); const s1 = (await sd.ll("GET", "/api/clientes?pagina=1&q=masivo")).json; assert.equal(s1.total, 0, "sofía no ve los clientes de ana"); assert.equal(((await sd.ll("GET", "/api/conceptos?pagina=1&q=masivo")).json as { total: number }).total, 0);
  D.espia.n = 0; const sin = await ad.ll("GET", "/api/clientes?pagina=1", undefined, { "x-jwt-prueba": "" }); assert.equal(sin.status, 403); assert.equal(D.espia.n, 0);
}});
