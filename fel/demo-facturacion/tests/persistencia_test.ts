// PERSISTENCIA REAL: lo que se crea en la demostración vive en PostgreSQL (el mismo modelo de NEXA FEL) y sobrevive a reinicios; sesiones, contraseñas y auditoría incluidas;
// la base se protege de usos indebidos. Solo se ejecuta contra una base real (FEL_TEST_PG_ADMIN; ver tools/test-demo-pg.sh y el trabajo de CI «Persistencia»).
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.5";
import { baseDePrueba } from "./bd_prueba.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hay = !!Deno.env.get("FEL_TEST_PG_ADMIN");
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

async function arrancar(env: Record<string, string>) {
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { FEL_AGENTE_SUPERVISOR_MS: "60000", ...env }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder(); const leer = async (s: ReadableStream<Uint8Array>) => { for await (const x of s) salida += dec.decode(x); }; const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  const limite = Date.now() + 120_000; while (!salida.includes("Supervisor de órdenes iniciado") && Date.now() < limite) { await dormir(100); if (salida.includes("Deno.exit") ) break; }
  return { puerto, base: `http://127.0.0.1:${puerto}`, salida: () => salida, async parar() { hijo.kill("SIGTERM"); await Promise.race([Promise.all(lecturas), dormir(3000)]); try { await hijo.status; } catch { /* ya terminó */ } } };
}
class Cli { cookie = ""; constructor(public base: string, public usuario = "") {}
  async llamar(m: string, ruta: string, cuerpo?: unknown) {
    const r = await fetch(this.base + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json };
  }
  async entrar(clave: string) { return await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave }); }
}

Deno.test({ name: "persistencia: todo sobrevive al reinicio (empresas, usuarios, facturas, planes, consumos, sesiones, contraseñas) y queda auditado; nada se resiembra", ignore: !hay, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bdp = await baseDePrueba(); const sql = postgres(bdp.url!, { max: 2, onnotice: () => {} });
  try {
    let s = await arrancar(bdp.env); assert.match(s.salida(), /sembrada por primera vez/);
    const nuevo = async (u: string, clave = "demo1234") => { const c = new Cli(s.base, u); assert.equal((await c.entrar(clave)).status, 200, u); return c; };
    const ana = await nuevo("ana"), marta = await nuevo("marta"), maestro = await nuevo("maestro");
    // factura certificada con consumo y cargo
    const est = (await marta.llamar("GET", "/api/estado")).json, cli = est.clientes[0], es = est.establecimientos[0];
    const d = (await marta.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio persistente", cantidad: "2", precio_unitario: "75" }] })).json;
    await ana.llamar("POST", `/api/documentos/${d.documento.id}/estado`, { estado: "revisado", version: d.documento.version });
    const cert = await ana.llamar("POST", `/api/documentos/${d.documento.id}/certificar`, { proveedor: "digifact", escenario: "exito", clave: "clave-persistente-0001" }); assert.equal(cert.json.documento.estado_fiscal, "certificado"); const aut = cert.json.documento.autorizacion_sat;
    // empresa nueva con propietario, plan y pago; usuario de la empresa; cambio de contraseña propio
    const alta = await maestro.llamar("POST", "/api/plataforma/empresas", { nombre_comercial: "Taller Persistente", razon_social: "Taller Persistente S.A. (FICTICIA)", nit: "7770009-4", propietario_nombre: "Pablo Perdura", propietario_usuario: "pablo", propietario_clave: "clave-pablo-1234" }); assert.equal(alta.status, 200, JSON.stringify(alta.json));
    const ver = (await maestro.llamar("GET", "/api/plataforma/planes")).json.versiones.find((v: J) => v.plan_codigo === "prepago_basico");
    await maestro.llamar("POST", "/api/plataforma/contratos", { empresa: alta.json.empresa, plan_version: ver.id }); await maestro.llamar("POST", "/api/plataforma/pagos", { empresa: alta.json.empresa, monto: "40", referencia: "PAGO-PERSISTE-1", clave: "clave-pago-persiste-001" });
    const pablo = await nuevo("pablo", "clave-pablo-1234"); assert.equal((await pablo.llamar("POST", "/api/usuarios", { usuario: "quique", nombre: "Quique Quintero", clave: "clave-quique-1234", rol: "emisor" })).status, 200);
    assert.equal((await pablo.llamar("POST", "/api/cuenta/clave", { actual: "clave-pablo-1234", nueva: "clave-pablo-NUEVA-99" })).status, 200);
    const planAntes = (await ana.llamar("GET", "/api/plan")).json, cookieAna = ana.cookie, nEmpresas = Number((await sql`select count(*)::int n from public.empresas`)[0].n);
    assert.ok(planAntes.consumos.length >= 1); assert.equal((await maestro.llamar("POST", "/api/sesion/salir", {})).status, 200);
    await s.parar();

    // ---- reinicio sobre la MISMA base
    s = await arrancar(bdp.env); assert.doesNotMatch(s.salida(), /sembrada por primera vez/, "no se vuelve a sembrar");
    assert.equal(Number((await sql`select count(*)::int n from public.empresas`)[0].n), nEmpresas, "ninguna empresa duplicada"); assert.equal(Number((await sql`select count(*)::int n from public.demo_entorno`)[0].n), 1);
    const ana2 = new Cli(s.base, "ana"); ana2.cookie = cookieAna; assert.equal((await ana2.llamar("GET", "/api/estado")).status, 200, "la sesión sobrevive al reinicio (vive en la base)");
    const doc2 = (await ana2.llamar("GET", `/api/documentos/${d.documento.id}`)).json; assert.equal(doc2.documento.estado_fiscal, "certificado"); assert.equal(doc2.documento.autorizacion_sat, aut); assert.equal(doc2.lineas.length, 1); assert.ok(doc2.cobertura.length === 1);
    const planDespues = (await ana2.llamar("GET", "/api/plan")).json; assert.deepEqual(planDespues.monedero, planAntes.monedero, "el monedero y sus movimientos se conservan"); assert.equal(planDespues.consumos.length, planAntes.consumos.length); assert.equal(planDespues.pagos.length, planAntes.pagos.length); assert.equal(planDespues.cargos.length, planAntes.cargos.length);
    // cuentas creadas en la aplicación y contraseña cambiada
    assert.equal((await new Cli(s.base, "pablo").entrar("clave-pablo-1234")).status, 401, "la contraseña anterior ya no sirve"); const pablo2 = new Cli(s.base, "pablo"); assert.equal((await pablo2.entrar("clave-pablo-NUEVA-99")).status, 200);
    assert.equal((await pablo2.llamar("GET", "/api/estado")).json.empresa.nombre_comercial, "Taller Persistente"); assert.ok((await pablo2.llamar("GET", "/api/usuarios")).json.miembros.some((m: J) => m.usuario === "quique"));
    assert.equal((await new Cli(s.base, "quique").entrar("clave-quique-1234")).status, 200, "el usuario creado en la aplicación sigue existiendo");
    assert.equal((await new Cli(s.base, "ana").entrar("demo1234")).status, 200, "las cuentas sembradas conservan su contraseña (no se pisan al reiniciar)");
    assert.equal((await new Cli(s.base, "maestro").llamar("GET", "/api/estado")).status, 401); // la sesión del maestro se cerró antes del reinicio
    // sesiones: cierre efectivo y sin identificadores en claro
    const filas = await sql`select token_hash from public.demo_sesiones`; assert.ok(filas.length >= 1); const todo = JSON.stringify(await sql`select * from public.demo_sesiones`); assert.ok(!todo.includes(cookieAna.split("=")[1]), "el identificador de la cookie no está en la base: solo su SHA-256");
    const antes = Number((await sql`select count(*)::int n from public.demo_sesiones`)[0].n); assert.equal((await ana2.llamar("POST", "/api/sesion/salir", {})).status, 200); assert.equal(Number((await sql`select count(*)::int n from public.demo_sesiones`)[0].n), antes - 1); assert.equal((await ana2.llamar("GET", "/api/estado")).status, 401);
    // contraseñas: solo hash con sal
    const cred = await sql`select usuario, sal, hash from public.demo_credenciales where usuario = 'ana'`; assert.match(cred[0].hash, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(await sql`select * from public.demo_credenciales`).includes("demo1234"));
    // auditoría de autenticación y de negocio (misma tabla de auditoría de NEXA FEL)
    const aud = await sql`select accion, count(*)::int n from public.auditoria where accion like 'demo.%' group by accion`; const m = Object.fromEntries(aud.map((x) => [x.accion, x.n]));
    assert.ok(m["demo.inicio_correcto"] >= 5 && m["demo.inicio_fallido"] >= 1 && m["demo.clave_cambiada"] === 1 && m["demo.sesion_cerrada"] >= 2, JSON.stringify(m)); assert.ok(!JSON.stringify(await sql`select datos from public.auditoria where accion like 'demo.%'`).match(/clave|password|hash/i), "la auditoría no contiene secretos");
    assert.ok(Number((await sql`select count(*)::int n from public.auditoria where accion like 'fiscal.%' or accion like 'documento.%'`)[0].n) > 0, "las acciones de negocio también quedan auditadas");
    await s.parar();
  } finally { await sql.end(); await bdp.limpiar(); }
} });

Deno.test({ name: "persistencia: la base se protege (no siembra sobre empresas ajenas ni sin migraciones; el marcador identifica una base de demostración)", ignore: !hay, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  // base con una empresa que NO es de la demostración y sin marcador: el servidor se niega y no toca nada
  const ajena = await baseDePrueba(); const sql = postgres(ajena.url!, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql`select id from public.regimenes_fiscales where codigo = 'general'`; await sql`insert into public.empresas (nombre_comercial, razon_social, nit, regimen_id, estado) values ('Empresa Real', 'Empresa Real S.A.', '1234567-8', ${r.id}, 'habilitada')`;
    const o = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", "--puerto=9299"], cwd: RAIZ, env: { ...ajena.env, FEL_AGENTE_SUPERVISOR_MS: "60000" }, stdout: "piped", stderr: "piped" }).output();
    const txt = new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr); assert.notEqual(o.code, 0); assert.match(txt, /no son de la demostración/);
    assert.equal(Number((await sql`select count(*)::int n from public.empresas`)[0].n), 1, "no se sembró nada"); assert.equal(Number((await sql`select count(*)::int n from public.demo_entorno`)[0].n), 0); assert.equal(Number((await sql`select count(*)::int n from public.demo_credenciales`)[0].n), 0);
    assert.equal((await sql`select valor from public.plataforma_parametros where clave = 'espera_conciliacion_manual_min'`)[0].valor.toString(), "120", "los parámetros de la plataforma no se tocaron");
  } finally { await sql.end(); await ajena.limpiar(); }
  // base sin migraciones
  const vacia = await baseDePrueba({ vacia: true });
  try { const o = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", "--puerto=9298"], cwd: RAIZ, env: { ...vacia.env, FEL_AGENTE_SUPERVISOR_MS: "60000" }, stdout: "piped", stderr: "piped" }).output();
    const txt = new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr); assert.notEqual(o.code, 0); assert.match(txt, /migraciones/); } finally { await vacia.limpiar(); }
} });
