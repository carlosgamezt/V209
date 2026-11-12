// CADENA COMPLETA de la nube, localmente y contra PostgreSQL real: intermediario de Cloudflare (nube/proxy.ts) → función de Supabase (nube/funcion.ts) → base.
// Solo se ejecuta con una base real (FEL_TEST_PG_ADMIN).
import assert from "node:assert/strict";
import { baseDePrueba } from "./bd_prueba.ts";
import { reenviar } from "../nube/proxy.ts";
import { crearManejador } from "../nube/funcion.ts";
import { codigo } from "../src/totp.ts";
import { semillaNueva } from "../src/totp.ts";
import { claveFuerte } from "../src/generar_secretos.ts";

const hay = !!Deno.env.get("FEL_TEST_PG_ADMIN"), RAIZ = new URL("..", import.meta.url).pathname;
const HOST = "nexa-demo.example.com";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "nube: intermediario → función → base; secreto compartido, host e IP del proxy, sin estado entre instancias, aprovisionamiento seguro", ignore: !hay, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bdp = await baseDePrueba({ vacia: false }); const SECRETO = claveFuerte() + claveFuerte();
  const claves: Record<string, string> = Object.fromEntries(["maestro", "maestro2", "ana", "luis", "marta", "pedro", "sofia"].map((u) => [u, claveFuerte()])), semillas = { maestro: semillaNueva(), maestro2: semillaNueva() };
  const env: Record<string, string> = { FEL_DEMO_BD_URL: bdp.url!, FEL_DEMO_CLAVES: Object.entries(claves).map(([u, c]) => `${u}=${c}`).join(","), FEL_DEMO_MFA_SEMILLAS: Object.entries(semillas).map(([u, s]) => `${u}=${s}`).join(","), FEL_DEMO_HOSTS: HOST, FEL_PROXY_SECRETO: SECRETO, FEL_DEMO_LIMITE_LOGIN: "6", FEL_DEMO_LIMITE_API: "100000" };
  try {
    // ---- aprovisionamiento: la función NO funciona antes (la base no está sembrada) y no imprime secretos
    const sinSembrar = crearManejador({ get: (k) => env[k] });
    const previo = await sinSembrar(new Request(`http://127.0.0.1/nexa-demo/api/sesion`, { headers: { "x-nexa-proxy": SECRETO, "x-nexa-host": HOST, "x-nexa-ip": "1.1.1.1" } })); assert.equal(previo.status, 503, "sin aprovisionar, la función no sirve nada");
    const p = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "nube/aprovisionar.ts"], cwd: RAIZ, env, stdout: "piped", stderr: "piped" }).output(); const salida = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
    assert.equal(p.code, 0, salida); assert.match(salida, /sembrada por primera vez/);
    for (const s of [...Object.values(claves), ...Object.values(semillas), bdp.url!, SECRETO]) assert.ok(!salida.includes(s), "el aprovisionamiento no imprime secretos");
    assert.equal((await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "nube/aprovisionar.ts"], cwd: RAIZ, env, stdout: "piped", stderr: "piped" }).output()).code, 0, "repetirlo (rotar contraseñas) no resiembra ni falla");

    // ---- cadena: una función por «instancia» (aislada, sin memoria compartida), alcanzada por el intermediario
    let funcion = crearManejador({ get: (k) => env[k] });
    const fetchFuncion: typeof fetch = (i, o) => funcion(new Request(String(i), o as RequestInit));
    const entorno = { FUNCION_URL: "http://127.0.0.1/nexa-demo", PROXY_SECRETO: SECRETO };
    class Cli { cookie = ""; constructor(public ip = "203.0.113.7", public host = HOST) {}
      async ll(m: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) {
        const r = await reenviar(new Request(`https://${this.host}${ruta}`, { method: m, headers: { "x-demo": "1", "content-type": "application/json", "cf-connecting-ip": this.ip, ...(this.cookie ? { cookie: this.cookie } : {}), ...extra }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), entorno, fetchFuncion);
        const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, r, texto: t }; }
    }
    // 1) puerta cerrada para quien no pasa por el intermediario
    const sinSecreto = await funcion(new Request("http://127.0.0.1/nexa-demo/api/sesion", { headers: { "x-nexa-host": HOST } })); assert.equal(sinSecreto.status, 403);
    assert.equal((await funcion(new Request("http://127.0.0.1/nexa-demo/api/sesion", { headers: { "x-nexa-proxy": "x".repeat(SECRETO.length), "x-nexa-host": HOST } }))).status, 403);
    // 2) estado de sesión: no revela contraseñas públicas; cabeceras de seguridad; sin CORS
    const c0 = new Cli(); const est = await c0.ll("GET", "/api/sesion"); assert.equal(est.status, 200); assert.equal(est.json.autenticado, false); assert.equal(est.json.clave_demo ?? null, null, "no hay contraseña pública");
    assert.ok(est.r.headers.get("strict-transport-security")); assert.match(est.r.headers.get("x-robots-tag") ?? "", /noindex/); assert.equal(est.r.headers.get("access-control-allow-origin"), null);
    // 3) nombre público: otro host se rechaza aunque el visitante intente falsificar la cabecera interna
    const otro = new Cli("203.0.113.8", "otro.example.com"); assert.equal((await otro.ll("GET", "/api/sesion", undefined, { "x-nexa-host": HOST })).status, 403, "el proxy sobrescribe x-nexa-host");
    // 4) solo /api/ y solo GET/POST pasan por el intermediario; lo demás no llega a la función
    assert.equal((await c0.ll("GET", "/servidor.ts")).status, 404); assert.equal((await c0.ll("PUT", "/api/sesion", {})).status, 405);
    // 5) inicio de sesión: contraseña de entorno, cookie segura; la pública no sirve; el administrador exige MFA
    const ana = new Cli(); assert.equal((await ana.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: "demo1234" })).status, 401);
    const ent = await ana.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana }); assert.equal(ent.status, 200, ent.texto); const sc = ent.r.headers.get("set-cookie") ?? ""; assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/);
    const mae = new Cli("203.0.113.9"); assert.equal((await mae.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro })).json.codigo, "mfa_requerido");
    assert.equal((await mae.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro, codigo: await codigo(semillas.maestro) })).status, 200);
    // 6) un recorrido real: factura con ítems, certificada con Digifact simulado; el estado del simulador vive en la base
    const e1 = (await ana.ll("GET", "/api/estado")).json; assert.equal(e1.usuario.clave, "ana"); const cli = e1.clientes[0], es = e1.establecimientos[0];
    const d = await ana.ll("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio A", cantidad: "2", precio_unitario: "100.00" }, { descripcion: "Servicio B", cantidad: "1", precio_unitario: "50.00" }] });
    assert.equal(d.status, 200, d.texto); const id = d.json.documento.id;
    await ana.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version });
    const cert = await ana.ll("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-nube-0000001" }); assert.equal(cert.json.documento.estado_fiscal, "certificado", cert.texto);
    // 6b) PDF de demostración descargable a través del intermediario
    const pdf = await ana.ll("GET", `/api/documentos/${id}/pdf-demo`); assert.equal(pdf.status, 200); assert.match(pdf.r.headers.get("content-type") ?? "", /pdf/); assert.ok(pdf.texto.startsWith("%PDF"));
    // 7) «otra instancia» (arranque en frío, sin memoria): la sesión, el documento y el simulador siguen ahí; se puede anular lo certificado
    funcion = crearManejador({ get: (k) => env[k] });
    assert.equal((await ana.ll("GET", `/api/documentos/${id}`)).json.documento.estado_fiscal, "certificado");
    const an = await ana.ll("POST", `/api/documentos/${id}/anular`, { motivo: "Anulación desde otra instancia", clave: "clave-nube-anula-01" }); assert.equal(an.status, 200, an.texto); assert.equal(an.json.documento.estado_fiscal, "anulado");
    // 9) límite de intentos por IP (la IP real la pone el intermediario; un visitante no puede cambiarla con cabeceras)
    const atacante = new Cli("198.51.100.5"); let limitado = 0; for (let i = 0; i < 9; i++) { const r = await atacante.ll("POST", "/api/sesion/entrar", { usuario: "luis", clave: "mala-" + i }, { "x-nexa-ip": `9.9.9.${i}`, "x-forwarded-for": `8.8.8.${i}` }); if (r.status === 429) limitado++; }
    assert.ok(limitado >= 1, "tras varios intentos desde la misma IP se limita, aunque cambie cabeceras");
    // 9b) el límite se comparte ENTRE instancias (PostgreSQL): 3 intentos en cada una suman 6; el séptimo, en cualquiera, ya se limita aunque esa instancia solo haya visto 4
    { const A = crearManejador({ get: (k) => env[k] }), B = crearManejador({ get: (k) => env[k] }); let k = 0; const intento = async (m: (r: Request) => Promise<Response>, ip: string) => (await reenviar(new Request(`https://${HOST}/api/sesion/entrar`, { method: "POST", headers: { "x-demo": "1", "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ usuario: `fantasma${k++}`, clave: "mala" }) }), entorno, (i, o) => m(new Request(String(i), o as RequestInit)))).status;
      const ip = "198.51.100.77"; for (let i = 0; i < 3; i++) { const sa = await intento(A, ip), sb = await intento(B, ip); assert.ok(sa !== 429 && sb !== 429, `i=${i} A=${sa} B=${sb}`); }
      assert.equal(await intento(A, ip), 429, "la instancia A limita por lo que vieron A y B juntas"); assert.equal(await intento(B, ip), 429);
      assert.notEqual(await intento(A, "198.51.100.78"), 429, "otra IP no se ve afectada"); }
    // 10) la función no escribe contraseñas ni secretos en sus registros (no hay credenciales en las respuestas)
    for (const s of [...Object.values(claves), ...Object.values(semillas), SECRETO]) assert.ok(!cert.texto.includes(s) && !est.texto.includes(s));
  } finally { await bdp.limpiar(); }
} });

Deno.test("proxy: sin configuración o con secreto corto no reenvía; solo /api/, GET/POST y tamaño acotado; limpia cabeceras internas y de CORS", async () => {
  const llamadas: Request[] = []; const f: typeof fetch = async (i, o) => { llamadas.push(new Request(String(i), o as RequestInit)); return new Response("{}", { headers: { "access-control-allow-origin": "*", server: "x", "x-nexa-proxy": "dentro", "content-type": "application/json" } }); };
  const bueno = { FUNCION_URL: "https://abc.supabase.co/functions/v1/nexa-demo", PROXY_SECRETO: "s".repeat(40) };
  assert.equal((await reenviar(new Request("https://a.example/api/x"), { ...bueno, PROXY_SECRETO: "corto" }, f)).status, 503); assert.equal(llamadas.length, 0);
  assert.equal((await reenviar(new Request("https://a.example/otra"), bueno, f)).status, 404); assert.equal((await reenviar(new Request("https://a.example/api/x", { method: "DELETE" }), bueno, f)).status, 405);
  assert.equal((await reenviar(new Request("https://a.example/api/x", { method: "POST", body: "x".repeat(400_000) }), bueno, f)).status, 413); assert.equal(llamadas.length, 0);
  const r = await reenviar(new Request("https://nexa.example.com/api/estado?x=1", { headers: { "cf-connecting-ip": "5.5.5.5", "x-nexa-ip": "falso", authorization: "Bearer robado", cookie: "fel_sid=1", "x-nexa-proxy": "falso" } }), bueno, f);
  const v = llamadas[0]; assert.equal(v.url, "https://abc.supabase.co/functions/v1/nexa-demo/api/estado?x=1"); assert.equal(v.headers.get("x-nexa-ip"), "5.5.5.5"); assert.equal(v.headers.get("x-nexa-host"), "nexa.example.com"); assert.equal(v.headers.get("x-nexa-proxy"), bueno.PROXY_SECRETO); assert.equal(v.headers.get("authorization"), null); assert.equal(v.headers.get("cookie"), "fel_sid=1");
  assert.equal(r.headers.get("access-control-allow-origin"), null); assert.equal(r.headers.get("server"), null); assert.equal(r.headers.get("x-nexa-proxy"), null); assert.equal(r.headers.get("cache-control"), "no-store");
  const caida: typeof fetch = () => Promise.reject(new Error("conexión a https://abc.supabase.co rechazada")); const e = await reenviar(new Request("https://a.example/api/x"), bueno, caida); assert.equal(e.status, 502); assert.ok(!(await e.text()).includes("supabase"));
});
