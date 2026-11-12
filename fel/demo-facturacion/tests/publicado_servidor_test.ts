// El servidor en MODO PUBLICADO (lo que se alojaría en línea) probado como lo vería un atacante: sin configuración no arranca, solo el nombre configurado, solo HTTPS, cabeceras estrictas,
// solo las cuentas con contraseña propia, MFA obligatoria para la plataforma, límite de intentos por IP, sin plano del agente y sin credenciales en el registro. Servidor real, TCP crudo.
import assert from "node:assert/strict";
import { baseDePrueba } from "./bd_prueba.ts";
import { codigo } from "../src/totp.ts";
import { PREFIJO_AGENTE } from "../../proveedores/src/plano_control_agente.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOST = "nexa-demo.example.com", SEM = "JBSWY3DPEHPK3PXP", SEM2 = "KRSXG5CTMVRXEZLU";
const CLAVES = { maestro: "Maes-tro-clave-segura-1", maestro2: "Maes-tro2-clave-segura-2", ana: "Ana-clave-privada-larga-3", marta: "Marta-clave-privada-larga-4" };
const ENV = { FEL_DEMO_PUBLICADO: "1", FEL_AGENTE_SUPERVISOR_MS: "60000", FEL_DEMO_HOSTS: HOST, FEL_DEMO_CLAVES: Object.entries(CLAVES).map(([u, c]) => `${u}=${c}`).join(","), FEL_DEMO_MFA_SEMILLAS: `maestro=${SEM},maestro2=${SEM2}` };

async function crudo(puerto: number, host: string, ruta: string, o: { metodo?: string; cab?: Record<string, string>; cuerpo?: string } = {}) {
  const con = await Deno.connect({ hostname: "127.0.0.1", port: puerto }); const cuerpo = o.cuerpo ?? "";
  const cab = { host, connection: "close", ...(cuerpo ? { "content-length": String(new TextEncoder().encode(cuerpo).length), "content-type": "application/json" } : {}), ...(o.cab ?? {}) };
  await con.write(new TextEncoder().encode(`${o.metodo ?? "GET"} ${ruta} HTTP/1.1\r\n${Object.entries(cab).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${cuerpo}`));
  const trozos: Uint8Array[] = []; const buf = new Uint8Array(65536); for (;;) { const n = await con.read(buf); if (n === null) break; trozos.push(buf.slice(0, n)); } con.close();
  const todo = new Uint8Array(trozos.reduce((s, t) => s + t.length, 0)); let p = 0; for (const t of trozos) { todo.set(t, p); p += t.length; }
  const txt = new TextDecoder().decode(todo), i = txt.indexOf("\r\n\r\n"), cabTxt = txt.slice(0, i), lineas = cabTxt.split("\r\n"), status = Number(/ (\d{3})/.exec(lineas[0])![1]);
  const h = new Map<string, string>(); for (const l of lineas.slice(1)) { const k = l.indexOf(":"); h.set(l.slice(0, k).toLowerCase(), l.slice(k + 1).trim()); }
  let body = txt.slice(i + 4); if (h.get("transfer-encoding") === "chunked") { let r = "", s = body; for (;;) { const e = s.indexOf("\r\n"); const n = parseInt(s.slice(0, e), 16); if (!n) break; r += s.slice(e + 2, e + 2 + n); s = s.slice(e + 2 + n + 2); } body = r; }
  return { status, h, body, json: () => JSON.parse(body) };
}

Deno.test({ name: "modo publicado: no arranca con configuración ausente, débil o pública, y no imprime ninguna credencial", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const [nombre, env, patron] of [["sin nada", { FEL_DEMO_PUBLICADO: "1" }, /maestro/], ["contraseña pública", { ...ENV, FEL_DEMO_CLAVES: ENV.FEL_DEMO_CLAVES + ",luis=demo1234demo1234" }, /débil o pública/], ["sin MFA", { ...ENV, FEL_DEMO_MFA_SEMILLAS: "" }, /semilla MFA/], ["sin nombre público", { ...ENV, FEL_DEMO_HOSTS: "" }, /FEL_DEMO_HOSTS/]] as const) {
    const r = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", "--puerto=9999"], cwd: RAIZ, env: env as Record<string, string>, stdout: "piped", stderr: "piped" }).output();
    const s = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr); assert.notEqual(r.code, 0, nombre); assert.match(s, patron, nombre); assert.ok(!s.includes("demo1234demo1234") || /pública/.test(s)); assert.ok(!s.includes(SEM), "no imprime semillas");
  }
} });

Deno.test({ name: "modo publicado: superficie de ataque (host, HTTPS, cabeceras, cuentas, MFA, límite de intentos, agente, registro)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9500 + Math.floor(Math.random() * 90);
  const bdp = await baseDePrueba();
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts"], cwd: RAIZ, env: { ...bdp.env, ...ENV, PORT: String(puerto) }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder(); const leer = async (s: ReadableStream<Uint8Array>) => { for await (const x of s) salida += dec.decode(x); }; const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  try {
    const limite = Date.now() + 120_000; while (!salida.includes("Escuchando en el puerto") && Date.now() < limite) await dormir(100);
    assert.ok(salida.includes("Escuchando en el puerto"), salida); const https = { "x-forwarded-proto": "https" };
    // salud: sin datos y para cualquier nombre
    const s = await crudo(puerto, "interno.local", "/salud"); assert.equal(s.status, 200); assert.deepEqual(s.json(), { ok: true }); assert.ok(!s.h.get("set-cookie"));
    // nombre (Host) y protocolo
    for (const h of ["127.0.0.1", "localhost", "sitio-malo.example", `${HOST}.sitio-malo.example`, "x." + HOST]) assert.equal((await crudo(puerto, h, "/", { cab: https })).status, 403, h);
    const red = await crudo(puerto, HOST, "/web/js/main.js?x=1", { cab: { "x-forwarded-proto": "http" } }); assert.equal(red.status, 308); assert.equal(red.h.get("location"), `https://${HOST}/web/js/main.js?x=1`);
    const idx = await crudo(puerto, HOST, "/", { cab: https }); assert.equal(idx.status, 200); assert.match(idx.h.get("strict-transport-security") ?? "", /max-age=\d{7,}/); assert.match(idx.h.get("x-robots-tag") ?? "", /noindex/); assert.equal(idx.h.get("x-content-type-options"), "nosniff"); assert.match(idx.h.get("content-security-policy") ?? "", /default-src 'self'/); assert.equal(idx.h.get("x-frame-options"), "DENY"); assert.match(idx.h.get("permissions-policy") ?? "", /camera=\(\)/);
    assert.match((await crudo(puerto, HOST, "/robots.txt", { cab: https })).body, /Disallow: \//);
    // el plano del agente no se ofrece; las rutas internas tampoco
    assert.equal((await crudo(puerto, HOST, `${PREFIJO_AGENTE}/estado`, { cab: https })).status, 404); for (const r of ["/servidor.ts", "/src/api.ts", "/tests/publicado_servidor_test.ts", "/web/../servidor.ts"]) assert.equal((await crudo(puerto, HOST, r, { cab: https })).status, 404, r);
    // cuentas: solo las configuradas; la contraseña pública no sirve; la cabecera de persona se ignora
    const entrar = (usuario: string, clave: string, ip: string, extra: Record<string, unknown> = {}) => crudo(puerto, HOST, "/api/sesion/entrar", { metodo: "POST", cab: { ...https, "x-demo": "1", "x-forwarded-for": ip }, cuerpo: JSON.stringify({ usuario, clave, ...extra }) });
    assert.equal((await entrar("ana", "demo1234", "1.1.1.1")).status, 401); assert.equal((await entrar("luis", "demo1234", "1.1.1.2")).status, 401, "luis no tiene contraseña configurada: no existe para el mundo"); assert.equal((await entrar("pedro", CLAVES.ana, "1.1.1.3")).status, 401);
    const ok = await entrar("ana", CLAVES.ana, "1.1.1.4"); assert.equal(ok.status, 200); const ck = ok.h.get("set-cookie")!; assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.match(ck, /Secure/);
    assert.equal((await crudo(puerto, HOST, "/api/estado", { cab: { ...https, "x-demo": "1", "x-demo-usuario": "ana" } })).status, 401); const est = await crudo(puerto, HOST, "/api/estado", { cab: { ...https, "x-demo": "1", cookie: ck.split(";")[0] } }); assert.equal(est.status, 200); assert.equal(est.json().usuario.clave, "ana"); assert.match(est.h.get("x-robots-tag") ?? "", /noindex/);
    // plataforma: MFA obligatoria
    const m1 = await entrar("maestro", CLAVES.maestro, "2.2.2.1"); assert.equal(m1.status, 401); assert.equal(m1.json().codigo, "mfa_requerido"); assert.ok(!m1.h.get("set-cookie"));
    assert.equal((await entrar("maestro", CLAVES.maestro, "2.2.2.2", { codigo: "123456" })).status, 401); assert.equal((await entrar("maestro", "otra-clave-larga-123", "2.2.2.3", { codigo: await codigo(SEM) })).status, 401, "el código sin la contraseña no sirve");
    const m = await entrar("maestro", CLAVES.maestro, "2.2.2.4", { codigo: await codigo(SEM) }); assert.equal(m.status, 200); assert.equal((await entrar("maestro2", CLAVES.maestro2, "2.2.2.5", { codigo: await codigo(SEM) })).status, 401, "cada persona tiene su propia semilla");
    // límite de intentos por IP (y otra IP no se ve afectada)
    let ultimo = 0; for (let i = 0; i < 14; i++) ultimo = (await entrar("ana", "equivocada-equivocada", "3.3.3.3")).status; assert.equal(ultimo, 429); const lim = await entrar("ana", "equivocada-equivocada", "3.3.3.3"); assert.ok(Number(lim.h.get("retry-after")) >= 1); assert.equal((await entrar("marta", "equivocada-equivocada", "3.3.3.4")).status, 401, "otra IP y otra cuenta no se ven afectadas");
    // sin CORS permisivo y sin credenciales en el registro del servicio
    assert.equal(est.h.get("access-control-allow-origin") ?? null, null);
    for (const secreto of [...Object.values(CLAVES), SEM, SEM2]) assert.ok(!salida.includes(secreto), "el registro del servicio no contiene credenciales");
    assert.match(salida, /Sin credenciales en este registro/);
  } finally { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } await bdp.limpiar(); }
} });
