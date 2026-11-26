// COMPATIBILIDAD del rol de conexión restringido `nexa_app` (etapa 1B-bis; PROPUESTA): el recorrido real de la nube (intermediario → función → base) con la base conectada COMO nexa_app (sin BYPASSRLS, sin propiedad de tablas).
// El administrador solo aprovisiona (como hoy); la función sirve con nexa_app. Solo con FEL_TEST_PG_ADMIN y FEL_TEST_PG_ROL_APP=«rol:contraseña» (ver tools/test-rol-app.sh); no toca ninguna base hospedada.
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.5";
import { baseDePrueba } from "./bd_prueba.ts";
import { reenviar } from "../nube/proxy.ts";
import { crearManejador } from "../nube/funcion.ts";
import { codigo, semillaNueva } from "../src/totp.ts";
import { claveFuerte } from "../src/generar_secretos.ts";

const rolApp = Deno.env.get("FEL_TEST_PG_ROL_APP"), hay = !!Deno.env.get("FEL_TEST_PG_ADMIN") && !!rolApp, RAIZ = new URL("..", import.meta.url).pathname, HOST = "nexa-demo.example.com";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any
Deno.test({ name: "rol nexa_app: recorrido real completo (sesión, MFA, factura, certificación simulada, PDF, anulación, maestro) con la base como nexa_app", ignore: !hay, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bdp = await baseDePrueba({ vacia: false }), SECRETO = claveFuerte() + claveFuerte(), [rol, clavePg] = rolApp!.split(":");
  const claves: Record<string, string> = Object.fromEntries(["maestro", "maestro2", "ana", "luis", "marta", "pedro", "sofia"].map((u) => [u, claveFuerte()])), semillas = { maestro: semillaNueva(), maestro2: semillaNueva() };
  const base: Record<string, string> = { FEL_DEMO_CLAVES: Object.entries(claves).map(([u, c]) => `${u}=${c}`).join(","), FEL_DEMO_MFA_SEMILLAS: Object.entries(semillas).map(([u, s]) => `${u}=${s}`).join(","), FEL_DEMO_HOSTS: HOST, FEL_PROXY_SECRETO: SECRETO, FEL_DEMO_LIMITE_LOGIN: "6", FEL_DEMO_LIMITE_API: "100000" };
  const u = new URL(bdp.url!); u.username = rol; u.password = clavePg;
  const envAdmin: Record<string, string> = { ...base, FEL_DEMO_BD_URL: bdp.url! }, envApp: Record<string, string> = { ...base, FEL_DEMO_BD_URL: u.toString() };
  try {
    const p = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "nube/aprovisionar.ts"], cwd: RAIZ, env: envAdmin, stdout: "piped", stderr: "piped" }).output(); assert.equal(p.code, 0, new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr));   // aprovisiona el administrador, como hoy
    let funcion = crearManejador({ get: (k) => envApp[k] });   // sirve nexa_app
    const fetchFuncion: typeof fetch = (i, o) => funcion(new Request(String(i), o as RequestInit)); const entorno = { FUNCION_URL: "http://127.0.0.1/nexa-demo", PROXY_SECRETO: SECRETO };
    class Cli { cookie = ""; constructor(public ip = "203.0.113.7") {}
      async ll(m: string, ruta: string, cuerpo?: unknown) {
        const r = await reenviar(new Request(`https://${HOST}${ruta}`, { method: m, headers: { "x-demo": "1", "content-type": "application/json", "cf-connecting-ip": this.ip, ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), entorno, fetchFuncion);
        const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, r, texto: t }; }
    }
    const ana = new Cli(); const ent = await ana.ll("POST", "/api/sesion/entrar", { usuario: "ana", clave: claves.ana }); assert.equal(ent.status, 200, ent.texto);
    const e1 = (await ana.ll("GET", "/api/estado")).json; assert.equal(e1.usuario.clave, "ana"); const cli = e1.clientes[0], es = e1.establecimientos[0];
    const d = await ana.ll("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio A", cantidad: "2", precio_unitario: "100.00" }] });
    assert.equal(d.status, 200, d.texto); const id = d.json.documento.id;
    assert.equal((await ana.ll("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200);
    const cert = await ana.ll("POST", `/api/documentos/${id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-rolapp-0000001" }); assert.equal(cert.json.documento.estado_fiscal, "certificado", cert.texto);
    const pdf = await ana.ll("GET", `/api/documentos/${id}/pdf-demo`); assert.equal(pdf.status, 200); assert.ok(pdf.texto.startsWith("%PDF"));
    const lista = await ana.ll("GET", "/api/documentos?pagina=1&tam=25"); assert.equal(lista.status, 200);
    funcion = crearManejador({ get: (k) => envApp[k] });   // otra instancia en frío
    assert.equal((await ana.ll("GET", `/api/documentos/${id}`)).json.documento.estado_fiscal, "certificado");
    const an = await ana.ll("POST", `/api/documentos/${id}/anular`, { confirmacion: "ANULAR", motivo: "Anulación con el rol restringido", clave: "clave-rolapp-anula-01" }); assert.equal(an.status, 200, an.texto); assert.equal(an.json.documento.estado_fiscal, "anulado");
    // otra empresa: no ve nada de ana
    const sofia = new Cli("203.0.113.8"); assert.equal((await sofia.ll("POST", "/api/sesion/entrar", { usuario: "sofia", clave: claves.sofia })).status, 200);
    assert.notEqual((await sofia.ll("GET", `/api/documentos/${id}`)).status, 200, "otra empresa no ve el documento");
    assert.ok(!(await sofia.ll("GET", "/api/documentos?pagina=1&tam=25")).texto.includes(id), "otra empresa no lo lista");
    // administrador de la plataforma: MFA, su panel funciona y NO llega a documentos, clientes ni nada fiscal
    const mae = new Cli("203.0.113.9"); assert.equal((await mae.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro })).json.codigo, "mfa_requerido");
    assert.equal((await mae.ll("POST", "/api/sesion/entrar", { usuario: "maestro", clave: claves.maestro, codigo: await codigo(semillas.maestro) })).status, 200);
    const me = await mae.ll("GET", "/api/estado"); assert.equal(me.status, 200, me.texto.slice(0, 200)); assert.equal(me.json.esMaestro, true); assert.deepEqual(me.json.permisos, [], "el maestro no tiene permisos de empresa");
    { const r = await mae.ll("GET", "/api/plataforma/resumen"); assert.equal(r.status, 200, `resumen: ${r.status} ${r.texto.slice(0, 200)}`); assert.ok(Array.isArray(r.json.empresas) && r.json.empresas.length >= 2, "el panel lista las empresas (con el rol restringido)"); assert.ok(!/Servicio A|Cliente|digifact_operaciones|credencial/i.test(r.texto), "el resumen del maestro no trae datos fiscales ni credenciales"); }
    for (const ruta of [`/api/documentos/${id}`, "/api/documentos?pagina=1&tam=25", `/api/documentos/${id}/pdf-demo`, `/api/documentos/${id}/digifact`]) {
      const r = await mae.ll("GET", ruta); assert.ok(r.status >= 400 || !/Cliente|Servicio A|certificado/.test(r.texto), `el maestro no ve datos fiscales en ${ruta}`); if (ruta.includes(id)) assert.ok(r.status >= 400, `${ruta} debe negarse al maestro`); }
    for (const s of [...Object.values(claves), clavePg, SECRETO]) assert.ok(!cert.texto.includes(s) && !ent.texto.includes(s), "ninguna respuesta contiene secretos");
    // la función se conectó SOLO como nexa_app (el administrador solo aprovisionó y ya cerró)
    const admin = postgres(bdp.url!, { max: 1, onnotice: () => {} }); const nombre = new URL(bdp.url!).pathname.slice(1);
    try { const r = await admin.unsafe(`select usename, count(*)::int n from pg_stat_activity where datname = '${nombre}' and pid <> pg_backend_pid() group by usename`); const usuarios = r.map((x) => x.usename as string); assert.ok(usuarios.includes("nexa_app"), "hay conexiones como nexa_app"); assert.ok(!usuarios.includes("postgres"), `ninguna conexión como postgres: ${usuarios.join(",")}`); } finally { await admin.end(); }
  } finally { await bdp.limpiar(); }
} });
