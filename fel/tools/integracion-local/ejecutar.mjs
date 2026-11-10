// Integración con Supabase LOCAL REAL (GoTrue + PostgREST + PostgreSQL con las migraciones) y la función fel-api ejecutada con Deno.
// Tres ETAPAS independientes (cada una con su propia autorización cuando el destino no es local):
//   --etapa=verificar   solo lectura: dependencias de Auth, configuración y privilegios.
//   --etapa=ejecutar    crea datos de prueba, corre los escenarios y escribe un MANIFIESTO con los identificadores que creó (por defecto).
//   --etapa=limpiar     elimina EXCLUSIVAMENTE lo registrado en un manifiesto (--manifiesto=ruta). Nunca busca por correo, NIT ni patrón.
// La guardia (guardia.mjs) rechaza todo destino que no sea la pila local o un proyecto de desarrollo explícitamente autorizado.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { evaluarGuardia } from "./guardia.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const ETAPA = arg("etapa") ?? "ejecutar";
const guardia = evaluarGuardia({ env: process.env, etapa: ETAPA });
if (!guardia.permitido) { console.error(`Se niega a correr (etapa «${ETAPA}»):\n - ${guardia.razones.join("\n - ")}`); process.exit(2); }
if (!guardia.local) console.warn(`ATENCIÓN: etapa «${ETAPA}» contra el proyecto de DESARROLLO ${guardia.ref} con autorización expresa.`);

const API = process.env.API_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
const FELAPI = process.env.FEL_API_URL ?? "http://127.0.0.1:8000";
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!ANON || !SERVICE) { console.error("Faltan ANON_KEY / SERVICE_ROLE_KEY (supabase status -o env)."); process.exit(2); }

const resultados = [];
const registrar = (id, estado, desc, detalle = "") => { resultados.push({ id, estado, desc, detalle: String(detalle).slice(0, 400) }); console.log(`${estado.padEnd(9)} ${id}  ${desc}${detalle ? "  → " + String(detalle).slice(0, 200) : ""}`); };
const afirmar = (id, desc, cond, detalle) => registrar(id, cond ? "OK" : "FALLO", desc, cond ? "" : detalle);
const observar = (id, desc, valor) => registrar(id, "OBSERVADO", desc, typeof valor === "string" ? valor : JSON.stringify(valor));
async function escenario(id, desc, fn) { try { await fn(); } catch (e) { registrar(id, "FALLO", `${desc} (excepción)`, e?.stack ?? e); } }

const sql = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q", "-X", "-t", "-A", "-c", q], { encoding: "utf8" }).trim();
const sec = () => Math.floor(Date.now() / 1000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const lista = (ids) => { for (const x of ids) if (!UUID.test(x)) throw new Error(`identificador no válido en el manifiesto: ${x}`); return `'{${ids.join(",")}}'::uuid[]`; };
const runId = randomBytes(4).toString("hex");
const RUTA_MANIFIESTO = arg("manifiesto") ?? process.env.FEL_MANIFIESTO ?? `integracion-manifiesto-${runId}.json`;
const manifiesto = { runId, api: API, ref: guardia.ref, local: guardia.local, creado_en: new Date().toISOString(), usuarios: [], empresas: [], autorizaciones: [], solicitudes: [] };
// Se anota ANTES de crear (o apenas se conoce el id) y se escribe a disco cada vez: si algo falla a mitad, la limpieza sabe exactamente qué existe.
const anotar = (lista_, valor) => { manifiesto[lista_].push(valor); writeFileSync(RUTA_MANIFIESTO, JSON.stringify(manifiesto, null, 2)); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const cab = (token, key = ANON) => ({ apikey: key, authorization: `Bearer ${token ?? key}`, "content-type": "application/json" });
const claims = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()); } catch { return {}; } };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ---------------- Auth
const adminAuth = async (ruta, metodo = "GET", cuerpo) => { const r = await fetch(`${API}/auth/v1/admin/${ruta}`, { method: metodo, headers: cab(SERVICE, SERVICE), body: cuerpo ? JSON.stringify(cuerpo) : undefined }); return { status: r.status, datos: await j(r) }; };
const auth = async (ruta, { metodo = "POST", token, cuerpo } = {}) => { const r = await fetch(`${API}/auth/v1/${ruta}`, { method: metodo, headers: cab(token), body: cuerpo ? JSON.stringify(cuerpo) : undefined }); return { status: r.status, datos: await j(r), r }; };
const PASS = "Clave-Segura-123";
let PASS_PROP = PASS;   // contraseña actual del propietario (cambia en la prueba de recuperación)
const crearUsuario = async (email, password = PASS, rol = "prueba") => { const r = await adminAuth("users", "POST", { email, password, email_confirm: true }); if (!r.datos?.id) throw new Error(`no se pudo crear ${email}: ${JSON.stringify(r.datos)}`); anotar("usuarios", { rol, email, id: r.datos.id }); return r.datos.id; };
const login = async (email, password = PASS) => { const r = await auth("token?grant_type=password", { cuerpo: { email, password } }); return { ...r, sesion: r.datos?.access_token ? r.datos : null }; };
const refrescar = (rt) => auth("token?grant_type=refresh_token", { cuerpo: { refresh_token: rt } });
const rest = async (ruta, token) => { const r = await fetch(`${API}/rest/v1/${ruta}`, { headers: cab(token) }); return { status: r.status, datos: await j(r) }; };
const fel = async (accion, cuerpo, token) => { const r = await fetch(FELAPI, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ accion, ...cuerpo }) }); return { status: r.status, datos: await j(r) }; };
const firmaFalsa = (c) => { const h = b64u({ alg: "HS256", typ: "JWT" }), p = b64u(c); return `${h}.${p}.${createHmac("sha256", "secreto-equivocado-de-prueba-0123456789").update(`${h}.${p}`).digest("base64url")}`; };

// ---------------- TOTP (RFC 6238)
const b32 = (s) => { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const c of s.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, "0"); const by = []; for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(by); };
const usados = new Set();
function codigoTotp(secreto) {
  for (const delta of [0, 1, -1]) {
    const ctr = Math.floor(Date.now() / 30000) + delta, b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr));
    const h = createHmac("sha1", b32(secreto)).update(b).digest(), o = h[19] & 15;
    const cod = String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
    if (!usados.has(secreto + cod)) { usados.add(secreto + cod); return cod; }
  }
  throw new Error("no hay un código TOTP sin usar disponible");
}
const factorDe = {};   // email → { id, secreto }
async function activarTotp(email, sesion) {
  const e = await auth("factors", { token: sesion.access_token, cuerpo: { factor_type: "totp", friendly_name: `t-${randomBytes(3).toString("hex")}`, issuer: "NEXA FEL prueba" } });
  if (!e.datos?.id) throw new Error(`enrolar falló: ${JSON.stringify(e.datos)}`);
  const f = { id: e.datos.id, secreto: e.datos.totp.secret }; factorDe[email] = f;
  return { ...f, sesion: await verificarTotp(sesion, f) };
}
async function verificarTotp(sesion, f) {
  const c = await auth(`factors/${f.id}/challenge`, { token: sesion.access_token });
  const v = await auth(`factors/${f.id}/verify`, { token: sesion.access_token, cuerpo: { challenge_id: c.datos.id, code: codigoTotp(f.secreto) } });
  if (!v.datos?.access_token) throw new Error(`verificar TOTP falló: ${JSON.stringify(v.datos)}`);
  return v.datos;
}

// ================================================================ datos de prueba
const sufijo = randomBytes(3).toString("hex");
const E = (n) => `${n}-${sufijo}@integracion.fel.test`;
const EMP_A = randomUUID(), EMP_B = randomUUID();                 // únicos por ejecución (nada se reutiliza entre ejecuciones)
const NIT = (x) => `T${sufijo.toUpperCase()}${x}`;                // NIT de prueba único por ejecución
const U = {};
async function preparar() {
  anotar("empresas", EMP_A); anotar("empresas", EMP_B);
  for (const n of ["prop", "emi", "lec", "otro", "maestro", "sinperfil", "bloq"]) U[n] = { email: E(n), id: await crearUsuario(E(n), PASS, n) };
  sql(`insert into public.perfiles (user_id) values ('${U.prop.id}'),('${U.emi.id}'),('${U.lec.id}'),('${U.otro.id}'),('${U.maestro.id}'),('${U.bloq.id}');
       insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id, estado)
         select e.id, e.n, e.n || ' S.A.', e.nit, r.id, 'habilitada' from (values ('${EMP_A}'::uuid,'Empresa A','${NIT("A")}'),('${EMP_B}'::uuid,'Empresa B','${NIT("B")}')) e(id,n,nit), public.regimenes_fiscales r where r.codigo='general';
       insert into public.miembros (empresa_id, user_id, rol) values ('${EMP_A}','${U.prop.id}','propietario'),('${EMP_A}','${U.emi.id}','emisor'),('${EMP_A}','${U.lec.id}','lector'),('${EMP_B}','${U.otro.id}','propietario');
       insert into public.clientes (empresa_id, tipo_identificacion, numero_identificacion, nombre) values ('${EMP_A}','NIT','1111111-1','Cliente A1'),('${EMP_A}','NIT','1111112-2','Cliente A2'),('${EMP_B}','NIT','2222222-2','Cliente B1');`);
}

// ================================================================ etapas «verificar» y «limpiar»
function terminar() {
  writeFileSync(process.env.RESULTADOS ?? `integracion-${ETAPA}-resultados.json`, JSON.stringify({ etapa: ETAPA, fecha: new Date().toISOString(), destino: guardia.local ? "local" : guardia.ref, resultados }, null, 2));
  const fallos = resultados.filter((r) => r.estado === "FALLO");
  console.log(`\n${resultados.filter((r) => r.estado === "OK").length} OK · ${resultados.filter((r) => r.estado === "OBSERVADO").length} observados · ${fallos.length} fallos`);
  process.exit(fallos.length ? 1 : 0);
}

async function verificar() {   // SOLO LECTURA: no crea ni modifica nada
  const h = await fetch(`${API}/auth/v1/health`, { headers: cab(ANON) }); afirmar("V01", "Auth responde", h.status === 200, h.status);
  const st = await fetch(`${API}/auth/v1/settings`, { headers: cab(ANON) }).then(j).catch(() => ({}));
  afirmar("V02", "el registro abierto está desactivado (disable_signup)", st.disable_signup === true, JSON.stringify(st).slice(0, 160));
  afirmar("V03", "el proveedor de correo está activo (si no, no hay login con contraseña)", st.external?.email === true, JSON.stringify(st.external ?? {}));
  afirmar("V04", "no hay autoconfirmación de correos", st.mailer_autoconfirm !== true, JSON.stringify({ mailer_autoconfirm: st.mailer_autoconfirm }));
  const filas = sql("select comprobacion || '|' || ok || '|' || detalle from public.fel_verificar_dependencias_auth()").split("\n").filter(Boolean);
  afirmar("V05", "la función de compatibilidad con Auth existe y devuelve comprobaciones", filas.length >= 14, `${filas.length} filas`);
  for (const f of filas) { const [c, ok, det] = f.split("|"); afirmar(`V05-${c.slice(0, 48)}`, c, ok === "true", det); }
  afirmar("V06", "el interruptor de emisión real está APAGADO", sql("select valor from public.plataforma_config where clave='emision_real_disponible'") === "f");
  afirmar("V07", "ninguna empresa tiene emisión real habilitada", sql("select count(*) from public.empresas where emision_real_habilitada") === "0");
  afirmar("V08", "todas las tablas de public tienen RLS", sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity") === "0");
  const aut = sql("select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')");
  afirmar("V09", "authenticated solo ejecuta las 3 funciones de la RLS", aut === "fel_es_admin_plataforma,fel_es_miembro,fel_tiene_permiso", aut);
  afirmar("V10", "anon no ejecuta ninguna función de public", sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')") === "0");
  afirmar("V11", "anon y authenticated no escriben en ninguna tabla de public", sql("select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')") === "0");
  terminar();
}

async function limpiar() {   // elimina SOLO lo que figura en el manifiesto indicado
  if (!arg("manifiesto") && !process.env.FEL_MANIFIESTO) { console.error("La etapa limpiar exige --manifiesto=ruta."); process.exit(2); }
  if (!existsSync(RUTA_MANIFIESTO)) { console.error(`No existe el manifiesto ${RUTA_MANIFIESTO}`); process.exit(2); }
  const m = JSON.parse(readFileSync(RUTA_MANIFIESTO, "utf8"));
  if (m.api !== API || (m.ref ?? null) !== (guardia.ref ?? null) || !m.runId) { console.error("El manifiesto corresponde a OTRO destino (api/ref): no se limpia nada."); process.exit(2); }
  const us = (m.usuarios ?? []).map((x) => x.id), emp = m.empresas ?? [], aut = m.autorizaciones ?? [], sol = m.solicitudes ?? [];
  console.log(`Limpieza de la ejecución ${m.runId}: ${us.length} usuarios, ${emp.length} empresas, ${aut.length} autorizaciones, ${sol.length} solicitudes (solo estos identificadores).`);
  const U_ = us.length ? lista(us) : "'{}'::uuid[]", E_ = emp.length ? lista(emp) : "'{}'::uuid[]", A_ = aut.length ? lista(aut) : "'{}'::uuid[]", S_ = sol.length ? lista(sol) : "'{}'::uuid[]";
  // El guardián de «último propietario» impide borrar membresías; se desactiva SOLO dentro de esta transacción. La auditoría es de solo agregar:
  // sus filas NO se borran, así que las empresas de prueba se SUSPENDEN en lugar de borrarse (la auditoría las referencia).
  try {
    sql(`begin;
      alter table public.miembros disable trigger miembros_guard;
      delete from public.solicitudes_recuperacion_mfa where id = any(${S_}) or user_id = any(${U_}) or resuelta_por = any(${U_});
      delete from public.revocaciones_sesion where user_id = any(${U_});
      delete from public.autorizaciones_maestro where id = any(${A_}) or autorizado_por = any(${U_});
      delete from public.invitaciones where empresa_id = any(${E_}) or invitado_por = any(${U_}) or user_id = any(${U_});
      delete from public.clientes where empresa_id = any(${E_});
      delete from public.miembros where empresa_id = any(${E_}) or user_id = any(${U_}) or invitado_por = any(${U_});
      delete from public.plataforma_admins where user_id = any(${U_});
      delete from public.perfiles where user_id = any(${U_});
      alter table public.miembros enable trigger miembros_guard;
      update public.empresas set estado = 'suspendida' where id = any(${E_});
      commit;`);
    registrar("L-sql", "OK", "datos de la ejecución eliminados en la base de datos (transacción única)");
  } catch (e) { registrar("L-sql", "FALLO", "la transacción de limpieza falló (no se aplicó nada)", String(e.stderr ?? e)); }
  for (const x of m.usuarios ?? []) {
    const r = await adminAuth(`users/${x.id}`, "DELETE"); registrar(`L-auth-${x.rol}`, r.status === 200 ? "OK" : "FALLO", `usuario ${x.email} eliminado de Auth`, r.status === 200 ? "" : JSON.stringify(r.datos));
  }
  const cuenta = (q) => Number(sql(q));
  afirmar("L-v1", "no queda ninguno de los usuarios en Auth", cuenta(`select count(*) from auth.users where id = any(${U_})`) === 0);
  afirmar("L-v2", "no quedan perfiles, membresías, solicitudes ni marcas de esos usuarios", cuenta(`select (select count(*) from public.perfiles where user_id = any(${U_})) + (select count(*) from public.miembros where user_id = any(${U_}) or empresa_id = any(${E_})) + (select count(*) from public.solicitudes_recuperacion_mfa where user_id = any(${U_})) + (select count(*) from public.revocaciones_sesion where user_id = any(${U_}))`) === 0);
  afirmar("L-v3", "no quedan clientes ni invitaciones de las empresas de la ejecución", cuenta(`select (select count(*) from public.clientes where empresa_id = any(${E_})) + (select count(*) from public.invitaciones where empresa_id = any(${E_}))`) === 0);
  afirmar("L-v4", "las autorizaciones de maestro de la ejecución ya no existen", cuenta(`select count(*) from public.autorizaciones_maestro where id = any(${A_})`) === 0);
  afirmar("L-v5", "las empresas de la ejecución quedaron SUSPENDIDAS (no se borran: la auditoría de solo agregar las referencia)", cuenta(`select count(*) from public.empresas where id = any(${E_}) and estado = 'suspendida'`) === emp.length);
  observar("L-v6", "filas de auditoría conservadas por diseño (append-only) para esta ejecución", sql(`select count(*) from public.auditoria where empresa_id = any(${E_}) or actor_user_id = any(${U_})`));
  terminar();
}
if (ETAPA === "verificar") await verificar();
if (ETAPA === "limpiar") await limpiar();

await preparar();
const S = {};   // sesiones iniciales (aal1)
for (const n of ["prop", "emi", "lec", "otro", "maestro", "sinperfil", "bloq"]) S[n] = (await login(U[n].email)).sesion;

// ================================================================ 1. Auth: login y forma de los claims
await escenario("A01", "login con contraseña correcta/incorrecta", async () => {
  afirmar("A01a", "contraseña correcta entrega tokens", !!S.prop?.access_token);
  const mal = await login(U.prop.email, "Incorrecta-123456"); afirmar("A01b", "contraseña incorrecta se rechaza (400)", mal.status === 400 && !mal.sesion, mal.status);
});
await escenario("A02", "forma de los claims del JWT (supuestos del diseño)", async () => {
  const c = claims(S.prop.access_token);
  afirmar("A02a", "sub, role=authenticated, aal=aal1, exp futuro", c.sub === U.prop.id && c.role === "authenticated" && c.aal === "aal1" && c.exp > sec(), JSON.stringify(c));
  afirmar("A02b", "amr es una lista con {method:'password', timestamp:número}", Array.isArray(c.amr) && c.amr.some((x) => x.method === "password" && Number.isFinite(x.timestamp)), JSON.stringify(c.amr));
  observar("A02d", "duración del JWT (exp − iat, segundos); recomendado ≤ 1800 en el proyecto real", c.exp - c.iat);
  afirmar("A02c", "el instante de autenticación es reciente (±60 s)", Math.abs(sec() - Math.max(...c.amr.map((x) => x.timestamp))) < 60, JSON.stringify(c.amr));
});

// ================================================================ 2. JWT hostiles contra fel-api y PostgREST
await escenario("J01", "tokens hostiles", async () => {
  const buenos = { sub: U.prop.id, role: "authenticated", aal: "aal2", exp: sec() + 3600, amr: [{ method: "password", timestamp: sec() }, { method: "totp", timestamp: sec() }] };
  for (const [nombre, token] of [["basura", "no-es-un-jwt"], ["firma falsa (secreto equivocado)", firmaFalsa(buenos)], ["clave anon como usuario", ANON], ["clave service_role como usuario", SERVICE], ["sin token", ""]]) {
    const f = await fel("yo", {}, token); afirmar(`J01-${nombre}`, `fel-api rechaza: ${nombre}`, f.status === 401, `status ${f.status}`);
    if (token === SERVICE) continue;   // la clave service_role ES el acceso de servicio: PostgREST la acepta por diseño; lo que importa es que fel-api no la tome por una persona
    const r = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, token || ANON); afirmar(`J01r-${nombre}`, `PostgREST no entrega datos: ${nombre}`, !(Array.isArray(r.datos) && r.datos.length > 0), `status ${r.status} ${JSON.stringify(r.datos).slice(0, 80)}`);
  }
  const caducado = firmaFalsa({ ...buenos, exp: sec() - 60 });
  afirmar("J01-caducado", "fel-api rechaza un token caducado", (await fel("yo", {}, caducado)).status === 401);
});

// ================================================================ 3. Datos y aislamiento multiempresa (PostgREST real + RLS)
await escenario("D01", "RLS y aislamiento", async () => {
  const a = await rest(`clientes?select=nombre&empresa_id=eq.${EMP_A}`, S.prop.access_token);
  afirmar("D01a", "propietario de A ve los 2 clientes de A", a.status === 200 && a.datos.length === 2, JSON.stringify(a.datos));
  const b = await rest(`clientes?select=nombre&empresa_id=eq.${EMP_B}`, S.prop.access_token);
  afirmar("D01b", "propietario de A NO ve clientes de B", b.status === 200 && b.datos.length === 0, JSON.stringify(b.datos));
  const todos = await rest("clientes?select=nombre", S.prop.access_token); afirmar("D01c", "sin filtro solo ve los de su empresa", todos.datos.length === 2 && todos.datos.every((c) => c.nombre.startsWith("Cliente A")), JSON.stringify(todos.datos));
  const anon = await rest("clientes?select=nombre", ANON); afirmar("D01d", "anon no lee clientes", !(Array.isArray(anon.datos) && anon.datos.length), `status ${anon.status}`);
  const esc = await fel("cliente_guardar", { empresa_id: EMP_B, tipo_identificacion: "NIT", numero_identificacion: "9999999-9", nombre: "Intruso" }, S.prop.access_token);
  afirmar("D01e", "escribir en la empresa B con un usuario de A → 403", esc.status === 403, `${esc.status} ${JSON.stringify(esc.datos)}`);
  afirmar("D01f", "no se creó nada en B", sql(`select count(*) from public.clientes where empresa_id='${EMP_B}' and nombre='Intruso'`) === "0");
  const lec = await fel("cliente_guardar", { empresa_id: EMP_A, tipo_identificacion: "NIT", numero_identificacion: "8888888-8", nombre: "Lector escribe" }, S.lec.access_token);
  afirmar("D01g", "un lector no escribe → 403", lec.status === 403, `${lec.status}`);
  const lst = await fel("miembros_listar", { empresa_id: EMP_B }, S.prop.access_token); afirmar("D01h", "listar miembros de otra empresa → 403", lst.status === 403, `${lst.status}`);
});

// ================================================================ 4. Cuenta sin perfil / bloqueada
await escenario("C01", "sin perfil y bloqueada", async () => {
  const sp = await fel("yo", {}, S.sinperfil.access_token); afirmar("C01a", "cuenta sin perfil: yo → 403 sin_perfil", sp.status === 403 && sp.datos.codigo === "sin_perfil", JSON.stringify(sp));
  const acp = await fel("aceptar_invitacion", {}, S.sinperfil.access_token); afirmar("C01b", "sin invitación vigente, aceptar → 403", acp.status === 403, JSON.stringify(acp));
  const r = await rest("clientes?select=id", S.sinperfil.access_token); afirmar("C01c", "sin perfil no lee datos", Array.isArray(r.datos) && r.datos.length === 0, JSON.stringify(r.datos));
  const antes = await fel("yo", {}, S.bloq.access_token); sql(`update public.perfiles set activo=false where user_id='${U.bloq.id}'`);
  const bl = await fel("yo", {}, S.bloq.access_token); afirmar("C01d", "cuenta bloqueada con token vigente: yo → 403 cuenta_desactivada", bl.status === 403 && bl.datos.codigo === "cuenta_desactivada", `antes ${antes.status}; ahora ${JSON.stringify(bl)}`);
});

// ================================================================ 5. MFA TOTP: aal2, amr y renovación
let propAal2, tot;
await escenario("M01", "TOTP real", async () => {
  tot = await activarTotp(U.prop.email, S.prop); propAal2 = tot.sesion;
  const c = claims(propAal2.access_token);
  afirmar("M01a", "tras verificar TOTP el JWT es aal2", c.aal === "aal2", JSON.stringify(c));
  const t = c.amr?.find((x) => x.method === "totp");
  afirmar("M01b", "amr incluye un evento totp reciente", !!t && Math.abs(sec() - t.timestamp) < 60, JSON.stringify(c.amr));
  const ref = await refrescar(propAal2.refresh_token); const c2 = claims(ref.datos.access_token);
  afirmar("M01c", "renovar conserva aal2 y NO crea eventos de autenticación nuevos (amr igual)", c2.aal === "aal2" && JSON.stringify(c2.amr) === JSON.stringify(c.amr), `${JSON.stringify(c.amr)} → ${JSON.stringify(c2.amr)}`);
  propAal2 = ref.datos;
  const yo = await fel("yo", {}, propAal2.access_token); afirmar("M01d", "fel-api acepta el token aal2 y reporta mfa=aal2", yo.status === 200 && yo.datos.datos.mfa === "aal2", JSON.stringify(yo));
});

// ================================================================ 6. Maestro: bootstrap real y lecturas aal2
await escenario("P01", "maestro con aal2", async () => {
  const m = await activarTotp(U.maestro.email, S.maestro);
  const boot = (() => { try { return sql(`select public.fel_bootstrap_primer_maestro('${U.maestro.email}')`); } catch (e) { return `ERROR ${String(e.stderr ?? e).slice(0, 300)}`; } })();
  afirmar("P01a", "fel_bootstrap_primer_maestro funciona con las tablas reales de Auth (TOTP verificado)", boot === U.maestro.id, boot);
  const aal1 = await login(U.maestro.email); afirmar("P01b", "con solo contraseña el login queda en aal1", claims(aal1.sesion.access_token).aal === "aal1");
  const r1 = await rest("empresas?select=id", aal1.sesion.access_token); afirmar("P01c", "maestro con aal1 NO ve empresas (RLS exige aal2)", Array.isArray(r1.datos) && r1.datos.length === 0, JSON.stringify(r1.datos));
  const r2 = await rest("empresas?select=id", m.sesion.access_token); afirmar("P01d", "maestro con aal2 ve las empresas", Array.isArray(r2.datos) && r2.datos.length >= 2, JSON.stringify(r2.datos));
  const f1 = await fel("maestro_autorizar", { email: E("candidato"), motivo: "Ampliar el equipo de administración" }, aal1.sesion.access_token); afirmar("P01e", "acción de maestro con aal1 → 403 mfa_requerido", f1.status === 403 && f1.datos.codigo === "mfa_requerido", JSON.stringify(f1));
  const f2 = await fel("maestro_autorizar", { email: E("candidato"), motivo: "Ampliar el equipo de administración" }, m.sesion.access_token); afirmar("P01f", "acción de maestro con aal2 reciente → 200", f2.status === 200, JSON.stringify(f2));
  if (f2.datos?.datos?.autorizacion_id) anotar("autorizaciones", f2.datos.datos.autorizacion_id);
  const viejo = (() => { const c = claims(m.sesion.access_token); return c; })(); observar("P01g", "amr del maestro", viejo.amr);
});

// ================================================================ 7. Invitaciones: cuenta (Auth) vs empresa
await escenario("I01", "invitaciones", async () => {
  const nuevo = E("invitado");
  const sinAal2 = await fel("miembro_invitar", { empresa_id: EMP_A, email: nuevo, rol: "lector" }, S.prop.access_token); afirmar("I01a", "invitar con aal1 → 403 mfa_requerido", sinAal2.status === 403 && sinAal2.datos.codigo === "mfa_requerido", JSON.stringify(sinAal2));
  const ok = await fel("miembro_invitar", { empresa_id: EMP_A, email: nuevo, rol: "lector" }, propAal2.access_token);
  afirmar("I01b", "invitar con aal2 reciente → 200", ok.status === 200, JSON.stringify(ok));
  afirmar("I01c", "se registró la invitación a la EMPRESA (pendiente)", sql(`select estado from public.invitaciones where email='${nuevo}' and empresa_id='${EMP_A}'`) === "pendiente");
  const existe = sql(`select count(*) from auth.users where email='${nuevo}'`);
  observar("I01d", "la invitación de cuenta creó el usuario en Auth", existe);
  // la cuenta de Auth sola no da acceso; al aceptar, sí
  const id = sql(`select id from auth.users where email='${nuevo}'`);   // correo EXACTO creado en esta ejecución
  if (id) {
    anotar("usuarios", { rol: "invitado", email: nuevo, id });
    await adminAuth(`users/${id}`, "PUT", { password: PASS, email_confirm: true });
    const l = await login(nuevo); const antes = await fel("yo", {}, l.sesion.access_token);
    afirmar("I01e", "invitado ANTES de aceptar: la cuenta existe pero yo → 403 sin_perfil", antes.status === 403 && antes.datos.codigo === "sin_perfil", JSON.stringify(antes));
    const rr = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token); afirmar("I01f", "antes de aceptar no lee datos de la empresa", rr.datos.length === 0, JSON.stringify(rr.datos));
    const acepta = await fel("aceptar_invitacion", {}, l.sesion.access_token); afirmar("I01g", "aceptar_invitacion con correo confirmado → 200", acepta.status === 200 && acepta.datos.datos.aceptadas === 1, JSON.stringify(acepta));
    const despues = await fel("yo", {}, l.sesion.access_token); afirmar("I01h", "después: yo → rol lector en la empresa", despues.status === 200 && despues.datos.datos.empresas[0]?.rol === "lector", JSON.stringify(despues));
    const inv = await rest("invitaciones?select=empresa_id,estado", propAal2.access_token);
    afirmar("I01j", "el propietario de A ve SOLO invitaciones de A (RLS)", Array.isArray(inv.datos) && inv.datos.length >= 1 && inv.datos.every((x) => x.empresa_id === EMP_A), JSON.stringify(inv.datos));
    const invLec = await rest("invitaciones?select=id", S.lec.access_token); afirmar("I01k", "un lector no ve invitaciones", Array.isArray(invLec.datos) && invLec.datos.length === 0, JSON.stringify(invLec.datos));
    const invOtro = await rest(`invitaciones?select=id&empresa_id=eq.${EMP_A}`, S.otro.access_token); afirmar("I01l", "el propietario de B no ve invitaciones de A", Array.isArray(invOtro.datos) && invOtro.datos.length === 0, JSON.stringify(invOtro.datos));
    const rr2 = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token); afirmar("I01i", "después de aceptar lee los clientes (RLS)", rr2.datos.length === 2, JSON.stringify(rr2.datos));
  }
});

// ================================================================ 8. Recuperación de contraseña (enlace real generado por Auth)
await escenario("R01", "recuperación de contraseña", async () => {
  const gl = async (email) => { const g = await adminAuth("generate_link", "POST", { type: "recovery", email }); const link = g.datos?.action_link; if (!link) throw new Error(`generate_link: ${JSON.stringify(g.datos)}`); const r = await fetch(link, { redirect: "manual" }); const loc = r.headers.get("location") ?? ""; const h = new URLSearchParams(loc.split("#")[1] ?? ""); return { status: r.status, tipo: h.get("type"), access_token: h.get("access_token"), refresh_token: h.get("refresh_token") }; };
  // cuenta SIN TOTP
  const a = await gl(U.lec.email); afirmar("R01a", "el enlace de recuperación entrega una sesión type=recovery en el #fragmento", !!a.access_token && a.tipo === "recovery", JSON.stringify({ ...a, access_token: !!a.access_token, refresh_token: !!a.refresh_token }));
  if (a.access_token) {
    const cambio = await auth("user", { metodo: "PUT", token: a.access_token, cuerpo: { password: "Nueva-Clave-Segura-456" } }); afirmar("R01b", "sin TOTP, la sesión de recuperación puede fijar la contraseña", cambio.status === 200, JSON.stringify(cambio.datos));
    afirmar("R01c", "la contraseña vieja ya no sirve y la nueva sí", (await login(U.lec.email)).status === 400 && !!(await login(U.lec.email, "Nueva-Clave-Segura-456")).sesion);
  }
  // cuenta CON TOTP (prop): ¿exige aal2 para cambiar la contraseña?
  const b = await gl(U.prop.email);
  if (b.access_token) {
    const sin = await auth("user", { metodo: "PUT", token: b.access_token, cuerpo: { password: "Otra-Clave-Segura-789" } });
    observar("R01d", "con TOTP verificado, cambiar la contraseña con la sesión de recuperación aal1 (esperado: rechazo por AAL2)", { status: sin.status, error: sin.datos?.error_code ?? sin.datos?.msg });
    const sesRec = { access_token: b.access_token, refresh_token: b.refresh_token };
    let tras = null; try { const v = await verificarTotp(sesRec, tot); tras = await auth("user", { metodo: "PUT", token: v.access_token, cuerpo: { password: "Otra-Clave-Segura-789" } }); } catch (e) { tras = { status: 0, datos: String(e) }; }
    afirmar("R01e", "tras verificar el TOTP con esa sesión, SÍ se puede cambiar la contraseña", tras.status === 200, JSON.stringify(tras.datos));
    afirmar("R01f", "recuperar la contraseña NO quitó el TOTP (el login sigue en aal1 y exige el código)", claims((await login(U.prop.email, "Otra-Clave-Segura-789")).sesion?.access_token ?? "").aal === "aal1" && sql(`select count(*) from auth.mfa_factors where user_id='${U.prop.id}' and status='verified'`) === "1");
    if (tras.status === 200) PASS_PROP = "Otra-Clave-Segura-789";
  }
});

// ================================================================ 9. Recuperación de MFA de punta a punta
await escenario("X01", "recuperación de MFA", async () => {
  const emi = await activarTotp(U.emi.email, S.emi); const viejoAal2 = emi.sesion;             // sesión aal2 "vieja" (de quien perderá el dispositivo, o de un atacante que la robó)
  const nuevoLogin = await login(U.emi.email);                                                    // desde otro dispositivo: solo contraseña (aal1)
  const sol = await fel("mfa_recuperacion_solicitar", { motivo: "Perdí mi teléfono con la aplicación autenticadora" }, nuevoLogin.sesion.access_token);
  afirmar("X01a", "la persona (aal1) solicita la recuperación → 200", sol.status === 200, JSON.stringify(sol));
  if (sol.datos?.datos?.solicitud_id) anotar("solicitudes", sol.datos.datos.solicitud_id);
  afirmar("X01b", "solicitar NO elimina el factor", sql(`select count(*) from auth.mfa_factors where user_id='${U.emi.id}' and status='verified'`) === "1");
  const propFresco = await verificarTotp(await login(U.prop.email, PASS_PROP).then((x) => x.sesion), tot);   // propietario con aal2 y TOTP reciente
  const aprobSinEvidencia = await fel("mfa_recuperacion_aprobar", { solicitud_id: sol.datos?.datos?.solicitud_id, verificacion: "corta" }, propFresco.access_token); afirmar("X01c", "sin evidencia suficiente → 400", aprobSinEvidencia.status === 400, JSON.stringify(aprobSinEvidencia));
  const lista = await fel("mfa_recuperacion_listar", {}, propFresco.access_token); afirmar("X01d", "el propietario ve la solicitud de su emisor", lista.status === 200 && lista.datos.datos.solicitudes.some((s) => s.user_id === U.emi.id), JSON.stringify(lista));
  const otro = await login(U.otro.email); const noPuede = await fel("mfa_recuperacion_aprobar", { solicitud_id: sol.datos?.datos?.solicitud_id, verificacion: "Intento de un propietario de otra empresa sin relación" }, otro.sesion.access_token); afirmar("X01e", "otro usuario (aal1, otra empresa) NO puede aprobar", noPuede.status === 403, JSON.stringify(noPuede));
  const sesionesAntes = sql(`select count(*) from auth.sessions where user_id='${U.emi.id}'`);
  const ap = await fel("mfa_recuperacion_aprobar", { solicitud_id: sol.datos?.datos?.solicitud_id, verificacion: "Videollamada con documento en mano; confirmé identidad y cargo" }, propFresco.access_token);
  afirmar("X01f", "aprobar con aal2 reciente → 200 y elimina el factor con la API de administración REAL", ap.status === 200 && ap.datos.datos.factores_eliminados >= 1, JSON.stringify(ap));
  afirmar("X01g", "el factor TOTP ya no existe en Auth", sql(`select count(*) from auth.mfa_factors where user_id='${U.emi.id}'`) === "0");
  observar("X01h", "sesiones de Auth de la persona antes → después de aprobar", `${sesionesAntes} → ${sql(`select count(*) from auth.sessions where user_id='${U.emi.id}'`)}`);
  afirmar("X01h2", "la aprobación y la evidencia quedaron en la auditoría", Number(sql(`select count(*) from public.auditoria where accion='plataforma.mfa_recuperacion_aprobada' and datos->>'usuario'='${U.emi.id}' and datos ? 'verificacion'`)) === 1);
  afirmar("X01i", "quedó la marca de revocación", sql(`select count(*) from public.revocaciones_sesion where user_id='${U.emi.id}'`) === "1");
  // la sesión vieja (aal2) ya no sirve, ni por fel-api ni por PostgREST
  const yoViejo = await fel("yo", {}, viejoAal2.access_token); afirmar("X01j", "la sesión aal2 ANTERIOR → fel-api 401 (sesion_revocada por la marca, o sin_sesion si Auth ya la rechaza)", yoViejo.status === 401 && ["sesion_revocada", "sin_sesion"].includes(yoViejo.datos.codigo), JSON.stringify(yoViejo));
  const rViejo = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, viejoAal2.access_token); afirmar("X01k", "la sesión aal2 ANTERIOR → PostgREST no entrega datos (RLS)", Array.isArray(rViejo.datos) && rViejo.datos.length === 0, JSON.stringify(rViejo.datos));
  const aal1Viejo = await fel("yo", {}, nuevoLogin.sesion.access_token); afirmar("X01l", "también la sesión aal1 anterior a la aprobación queda revocada", aal1Viejo.status === 401, JSON.stringify(aal1Viejo));
  const ren = await refrescar(viejoAal2.refresh_token);
  observar("X01m", "renovar el token de renovación viejo en Auth", { status: ren.status, error: ren.datos?.error_code ?? ren.datos?.msg });
  if (ren.datos?.access_token) { const y2 = await fel("yo", {}, ren.datos.access_token); afirmar("X01n", "un token RENOVADO desde la sesión vieja sigue rechazado (la marca no depende de Auth)", y2.status === 401, JSON.stringify(y2)); }
  const viejoAuth = await auth("user", { metodo: "GET", token: viejoAal2.access_token }); observar("X01o", "GET /auth/v1/user con el token viejo (¿Auth ya lo rechaza?)", viejoAuth.status);
  // inicio de sesión nuevo → aal1 (ya no hay factor): lo operativo sí, lo sensible no hasta configurar y verificar TOTP de nuevo
  await new Promise((r) => setTimeout(r, 6500));   // marca + margen de reloj (5 s): un inicio de sesión legítimo ocurre después
  const fresco = await login(U.emi.email); const yo = await fel("yo", {}, fresco.sesion.access_token); afirmar("X01p", "un inicio de sesión nuevo funciona (aal1)", yo.status === 200 && yo.datos.datos.mfa === "aal1", JSON.stringify(yo));
  const sens = await fel("mfa_recuperacion_listar", {}, fresco.sesion.access_token); afirmar("X01q", "lo sensible exige aal2 hasta verificar un TOTP nuevo → 403 mfa_requerido", sens.status === 403 && sens.datos.codigo === "mfa_requerido", JSON.stringify(sens));
  const nuevo = await activarTotp(U.emi.email, fresco.sesion);
  const sens2 = await fel("mfa_recuperacion_listar", {}, nuevo.sesion.access_token); afirmar("X01r", "tras configurar y verificar un TOTP NUEVO, lo sensible vuelve a estar permitido", sens2.status === 200, JSON.stringify(sens2));
  const rep = await fel("mfa_recuperacion_aprobar", { solicitud_id: sol.datos?.datos?.solicitud_id, verificacion: "Reintento sobre una solicitud ya ejecutada por completo" }, propFresco.access_token); afirmar("X01s", "repetir la aprobación después de ejecutada no hace nada (4xx)", rep.status >= 400 && rep.status < 500, JSON.stringify(rep));
});

// ================================================================ 9b. Cuenta bloqueada con token vigente: la RLS corta las lecturas directas de inmediato
await escenario("B01", "bloqueo en caliente", async () => {
  const l = await login(U.lec.email, "Nueva-Clave-Segura-456");
  const antes = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token); afirmar("B01a", "antes del bloqueo el lector lee clientes", antes.datos.length === 2, JSON.stringify(antes.datos));
  sql(`update public.perfiles set activo=false where user_id='${U.lec.id}'`);
  const despues = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token); afirmar("B01b", "bloqueada la cuenta, el MISMO token ya no lee nada (PostgREST + RLS)", Array.isArray(despues.datos) && despues.datos.length === 0, JSON.stringify(despues.datos));
  const f = await fel("yo", {}, l.sesion.access_token); afirmar("B01c", "y fel-api responde 403 cuenta_desactivada", f.status === 403 && f.datos.codigo === "cuenta_desactivada", JSON.stringify(f));
  sql(`update public.perfiles set activo=true where user_id='${U.lec.id}'`);
  const re = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token); afirmar("B01d", "reactivada, vuelve a leer", re.datos.length === 2, JSON.stringify(re.datos));
});

// ================================================================ 9c. Persona con dos empresas: permisos separados por empresa
await escenario("MU01", "multiempresa", async () => {
  const multi = { email: E("multi"), id: await crearUsuario(E("multi"), PASS, "multi") };
  sql(`insert into public.perfiles (user_id) values ('${multi.id}'); insert into public.miembros (empresa_id, user_id, rol) values ('${EMP_A}','${multi.id}','lector'),('${EMP_B}','${multi.id}','propietario');`);
  const s = (await login(multi.email)).sesion;
  const yo = await fel("yo", {}, s.access_token); const roles = Object.fromEntries((yo.datos?.datos?.empresas ?? []).map((x) => [x.empresa.id, x.rol]));
  afirmar("MU01a", "yo lista las dos empresas con su rol de cada una", roles[EMP_A] === "lector" && roles[EMP_B] === "propietario", JSON.stringify(roles));
  const todos = await rest("clientes?select=nombre", s.access_token); afirmar("MU01b", "sin filtro ve los clientes de AMBAS (es miembro de las dos), nada más", todos.datos.length === 3, JSON.stringify(todos.datos));
  const soloB = await rest(`clientes?select=nombre&empresa_id=eq.${EMP_B}`, s.access_token); afirmar("MU01c", "filtrando por B solo ve los de B", soloB.datos.length === 1 && soloB.datos[0].nombre === "Cliente B1", JSON.stringify(soloB.datos));
  const wA = await fel("cliente_guardar", { empresa_id: EMP_A, tipo_identificacion: "NIT", numero_identificacion: "7000001-1", nombre: "Escribe en A" }, s.access_token); afirmar("MU01d", "en A (lector) no puede escribir → 403", wA.status === 403, JSON.stringify(wA));
  const wB = await fel("cliente_guardar", { empresa_id: EMP_B, tipo_identificacion: "NIT", numero_identificacion: "7000002-2", nombre: "Escribe en B" }, s.access_token); afirmar("MU01e", "en B (propietario) sí puede escribir → 200", wB.status === 200, JSON.stringify(wB));
  afirmar("MU01f", "lo escrito quedó solo en B", sql(`select string_agg(empresa_id::text, ',') from public.clientes where nombre in ('Escribe en A','Escribe en B')`) === EMP_B);
  const lA = await fel("miembros_listar", { empresa_id: EMP_A }, s.access_token); const lB = await fel("miembros_listar", { empresa_id: EMP_B }, s.access_token);
  afirmar("MU01g", "listar miembros: 403 en A (lector), 200 en B (propietario) y solo de B", lA.status === 403 && lB.status === 200 && lB.datos.datos.miembros.every((m) => [U.otro.id, multi.id].includes(m.user_id)), `${lA.status} ${lB.status} ${JSON.stringify(lB.datos).slice(0, 160)}`);
});

// ================================================================ 10. Revocación por cierre de sesión (comportamiento de Supabase, solo se observa)
await escenario("L01", "cierre de sesión", async () => {
  const l = await login(U.lec.email, "Nueva-Clave-Segura-456"); if (!l.sesion) return observar("L01", "no se pudo iniciar sesión para la observación", l.status);
  await auth("logout?scope=local", { token: l.sesion.access_token });
  const u = await auth("user", { metodo: "GET", token: l.sesion.access_token }); const f = await fel("yo", {}, l.sesion.access_token); const r = await rest(`clientes?select=id&empresa_id=eq.${EMP_A}`, l.sesion.access_token);
  observar("L01a", "tras cerrar sesión, token de acceso viejo → Auth /user | fel-api yo | PostgREST clientes", { auth: u.status, fel_api: f.status, postgrest: `${r.status} filas=${Array.isArray(r.datos) ? r.datos.length : "?"}` });
  const ren = await refrescar(l.sesion.refresh_token); observar("L01b", "tras cerrar sesión, el token de renovación viejo", ren.status);
});

console.log(`Manifiesto de esta ejecución (necesario para la etapa limpiar): ${RUTA_MANIFIESTO}`);
terminar();
