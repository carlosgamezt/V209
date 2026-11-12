// Compatibilidad con Supabase HOSPEDADO: los usuarios se crean por la API de administración de Supabase Auth (nunca insertando en auth.users), el proyecto se confirma por referencia,
// y la cadena funciona aunque la aplicación NO pueda escribir en auth.users (como ocurre con la garantía de que Auth es de Supabase).
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.5";
import { baseDePrueba } from "./bd_prueba.ts";
import { creadorAdminApi } from "../src/usuarios_auth.ts";
import { verificarProyecto } from "../nube/bd_entorno.ts";
import { reenviar } from "../nube/proxy.ts";
import { crearManejador } from "../nube/funcion.ts";
import { codigo, semillaNueva } from "../src/totp.ts";
import { claveFuerte } from "../src/generar_secretos.ts";

const hay = !!Deno.env.get("FEL_TEST_PG_ADMIN"), RAIZ = new URL("..", import.meta.url).pathname;
const CLAVE_SERVICIO = "eyJ" + "x".repeat(60), ID = "11111111-1111-4111-8111-111111111111";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test("Auth admin: alta confirmada y sin contraseña, mismo id, idempotente; errores sin secretos; HTTPS exigido", async () => {
  const llamadas: { url: string; cab: Headers; cuerpo: J }[] = []; let modo = "ok";
  const f: typeof fetch = async (i, o) => { const url = String(i), cab = new Headers((o as RequestInit).headers); const cuerpo = (o as RequestInit).body ? JSON.parse(String((o as RequestInit).body)) : {}; llamadas.push({ url, cab, cuerpo });
    if ((o as RequestInit).method === "POST") return modo === "ok" ? new Response(JSON.stringify({ id: cuerpo.id, email: cuerpo.email }), { status: 200 }) : modo === "otro_id" ? new Response(JSON.stringify({ id: "22222222-2222-4222-8222-222222222222" }), { status: 200 }) : modo === "existe" ? new Response('{"error_code":"email_exists"}', { status: 422 }) : new Response("clave=" + CLAVE_SERVICIO, { status: 500 });
    return new Response(JSON.stringify(modo === "existe" ? { id: ID, email: "ana@demo.example" } : {}), { status: modo === "existe" ? 200 : 404 }); };
  const c = creadorAdminApi({ url: "https://abcdefghijklmnopqrst.supabase.co", claveServicio: CLAVE_SERVICIO, fetchImpl: f });
  await c.crear(ID, "ana@demo.example"); const l = llamadas[0]; assert.equal(l.url, "https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users"); assert.equal(l.cab.get("apikey"), CLAVE_SERVICIO); assert.equal(l.cab.get("authorization"), `Bearer ${CLAVE_SERVICIO}`);
  assert.deepEqual(l.cuerpo, { id: ID, email: "ana@demo.example", email_confirm: true }, "confirmado y sin contraseña de Supabase");
  modo = "otro_id"; await assert.rejects(() => c.crear(ID, "ana@demo.example"), /otro identificador/);
  modo = "existe"; await c.crear(ID, "ana@demo.example"); await assert.rejects(() => c.crear(ID, "otra@demo.example"), /otros datos/);
  modo = "falla"; await assert.rejects(() => c.crear(ID, "ana@demo.example"), (e: Error) => !e.message.includes(CLAVE_SERVICIO) && /estado 500/.test(e.message));
  assert.throws(() => creadorAdminApi({ url: "http://abc.supabase.co", claveServicio: CLAVE_SERVICIO }), /HTTPS/);
});

Deno.test("confirmación del proyecto: referencia obligatoria y coherente con la URL y la conexión; nada que verificar en local", () => {
  const ref = "abcdefghijklmnopqrst", env = (o: Record<string, string>) => (k: string) => o[k];
  assert.equal(verificarProyecto(env({ FEL_DEMO_BD_URL: "postgres://postgres@127.0.0.1:5432/x" })), null);
  assert.match(verificarProyecto(env({ FEL_DEMO_BD_URL: `postgres://postgres.${ref}:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, SUPABASE_URL: `https://${ref}.supabase.co` }))!, /Falta FEL_DEMO_PROYECTO_REF/);
  assert.match(verificarProyecto(env({ FEL_DEMO_BD_URL: `postgres://postgres.${ref}:p@h.pooler.supabase.com:6543/postgres`, SUPABASE_URL: `https://${ref}.supabase.co`, FEL_DEMO_PROYECTO_REF: "zzzzzzzzzzzzzzzzzzzz" }))!, /no corresponde/);
  assert.match(verificarProyecto(env({ FEL_DEMO_BD_URL: `postgres://postgres.otroproyectoprincipal:p@h.pooler.supabase.com:6543/postgres`, SUPABASE_URL: `https://${ref}.supabase.co`, FEL_DEMO_PROYECTO_REF: ref }))!, /no pertenece/);
  assert.equal(verificarProyecto(env({ FEL_DEMO_BD_URL: `postgres://postgres.${ref}:p@h.pooler.supabase.com:6543/postgres`, SUPABASE_URL: `https://${ref}.supabase.co`, FEL_DEMO_PROYECTO_REF: ref })), null);
});

Deno.test({ name: "Supabase hospedado simulado: la aplicación no puede escribir en auth.users; siembra y altas en ejecución pasan por la API de administración", ignore: !hay, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bdp = await baseDePrueba(); const sql = postgres(bdp.url!, { max: 2, onnotice: () => {} });
  // Auth «hospedado»: solo su propia API puede insertar usuarios (un disparador rechaza cualquier otra escritura directa)
  await sql.unsafe(`create function public.solo_auth_api() returns trigger language plpgsql as $$ begin if coalesce(current_setting('nexa.via_api', true), '') <> 'on' then raise exception 'AUTH_DIRECTO: auth.users es de Supabase Auth'; end if; return new; end $$;
    create trigger solo_auth_api before insert on auth.users for each row execute function public.solo_auth_api();`);
  let altas = 0;
  const auth = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    if (req.headers.get("apikey") !== CLAVE_SERVICIO || req.headers.get("authorization") !== `Bearer ${CLAVE_SERVICIO}`) return new Response("{}", { status: 401 });
    const u = new URL(req.url);
    if (req.method === "POST" && u.pathname === "/auth/v1/admin/users") { const b = await req.json(); assert.equal(b.email_confirm, true); assert.equal(b.password, undefined);
      await sql.begin(async (q) => { await q`select set_config('nexa.via_api', 'on', true)`; await q`insert into auth.users (id, email, email_confirmed_at) values (${b.id}, ${b.email}, now()) on conflict (id) do nothing`; }); altas++; return new Response(JSON.stringify({ id: b.id, email: b.email }), { status: 200 }); }
    const m = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(u.pathname); if (m) { const [x] = await sql`select id, email from auth.users where id = ${m[1]}`; return new Response(JSON.stringify(x ?? {}), { status: x ? 200 : 404 }); }
    return new Response("{}", { status: 404 }); });
  const SECRETO = claveFuerte() + claveFuerte(), HOST = "nexa-demo.example.com";
  const claves: Record<string, string> = Object.fromEntries(["maestro", "maestro2", "ana", "luis", "marta", "pedro", "sofia"].map((u) => [u, claveFuerte()])), semillas = { maestro: semillaNueva(), maestro2: semillaNueva() };
  const env: Record<string, string> = { FEL_DEMO_BD_URL: bdp.url!, SUPABASE_URL: `http://127.0.0.1:${auth.addr.port}`, SUPABASE_SERVICE_ROLE_KEY: CLAVE_SERVICIO, FEL_DEMO_CLAVES: Object.entries(claves).map(([u, c]) => `${u}=${c}`).join(","), FEL_DEMO_MFA_SEMILLAS: Object.entries(semillas).map(([u, s]) => `${u}=${s}`).join(","), FEL_DEMO_HOSTS: HOST, FEL_PROXY_SECRETO: SECRETO, FEL_DEMO_LIMITE_LOGIN: "100000", FEL_DEMO_LIMITE_API: "100000" };
  try {
    // sin API de administración, el aprovisionamiento FALLA de forma visible (la aplicación no escribe a escondidas en auth.users)
    const sinApi = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "nube/aprovisionar.ts"], cwd: RAIZ, env: { ...env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, stdout: "piped", stderr: "piped" }).output(); assert.notEqual(sinApi.code, 0); assert.match(new TextDecoder().decode(sinApi.stderr) + new TextDecoder().decode(sinApi.stdout), /AUTH_DIRECTO|auth\.users/);
    assert.equal(Number((await sql`select count(*)::int n from public.demo_entorno`)[0].n), 0, "una siembra fallida no deja la base marcada como lista");
    assert.equal(Number((await sql`select count(*)::int n from public.empresas`)[0].n), 0, "si Auth falla no queda nada sembrado: el aprovisionamiento se puede repetir");
    const p = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "nube/aprovisionar.ts"], cwd: RAIZ, env, stdout: "piped", stderr: "piped" }).output(); const salida = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
    assert.equal(p.code, 0, salida); assert.ok(altas >= 7, "los usuarios del mundo se crearon por la API"); assert.ok(!salida.includes(CLAVE_SERVICIO), "la clave de servicio no se imprime");
    // en ejecución: la función crea el propietario de una empresa nueva por la misma vía
    const funcion = crearManejador({ get: (k) => env[k] }), entorno = { FUNCION_URL: "http://127.0.0.1/nexa-demo", PROXY_SECRETO: SECRETO };
    const ff: typeof fetch = (i, o) => funcion(new Request(String(i), o as RequestInit));
    let cookie = ""; const ll = async (m: string, ruta: string, cuerpo?: unknown) => { const r = await reenviar(new Request(`https://${HOST}${ruta}`, { method: m, headers: { "x-demo": "1", "content-type": "application/json", "cf-connecting-ip": "203.0.113.20", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), entorno, ff); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* */ } return { status: r.status, json, texto: t }; };
    assert.equal((await ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro, codigo: await codigo(semillas.maestro) })).status, 200);
    const antes = altas; const alta = await ll("POST", "/api/plataforma/empresas", { nombre_comercial: "Taller Hospedado", razon_social: "Taller Hospedado S.A. (FICTICIA)", nit: "7770019-2", propietario_nombre: "Hugo Hospedado", propietario_usuario: "hugo", propietario_clave: claveFuerte() });
    assert.equal(alta.status, 200, alta.texto); assert.equal(altas, antes + 1, "el propietario nuevo se creó por la API de Auth");
    assert.equal(Number((await sql`select count(*)::int n from auth.users where email = 'hugo@demo.example'`)[0].n), 1);
  } finally { await auth.shutdown(); await sql.end(); await bdp.limpiar(); }
} });
