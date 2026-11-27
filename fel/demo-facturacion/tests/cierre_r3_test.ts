// CIERRE LOCAL DE R3: con la Data API activa, NINGUNA ruta ni servicio lee tablas de empresa con SQL propio (el cerrojo de acceso directo falla ruidosamente si alguna lo intenta) y la identidad, los permisos y la empresa
// se mantienen DENTRO de los flujos de escritura (guardar, revisar, certificar con Digifact simulado, PDF, descarga de archivos, detalle). Cada rechazo se comprueba por su estado/código, no por «cualquier error».
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { emularPostgrest, firmarJwt, verificar } from "../src/emulador_postgrest.ts";
import { tablasDe, validarSql, TABLAS_SERVICIO, TABLAS_CATALOGO } from "../../proveedores/src/acceso_directo.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const SECRETO = "secreto-de-prueba-0123456789-abcdef", APIKEY = "llave-publica-de-prueba", URL = "http://127.0.0.1:54321";
const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", HUELLA = "0123456789abcdef";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
const XML_REAL = `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento><dte:NumeroAutorizacion Numero="5" Serie="A001">${AUT}</dte:NumeroAutorizacion></dte:GTDocumento>`, PDF_REAL = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n";
const o = { sanitizeOps: false, sanitizeResources: false };
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "Cerrojo: reconoce las tablas que una sentencia nombra y rechaza las de empresa; no confunde funciones, literales, catálogos del sistema ni «for update»", ...o, fn: () => {
  assert.deepEqual(tablasDe("select * from public.documentos d join public.clientes c on c.id = d.cliente_id").sort(), ["clientes", "documentos"]);
  assert.deepEqual(tablasDe("insert into public.envios_correo (a, b) values ($1, $2) on conflict do nothing returning id"), ["envios_correo"]);
  assert.deepEqual(tablasDe("insert into public.demo_limites (clave) values ($1) on conflict (clave, ventana) do update set n = public.demo_limites.n + 1"), ["demo_limites"], "do update y columnas calificadas no cuentan");
  assert.deepEqual(tablasDe("select 1 from public.digifact_operaciones where estado = 'from public.documentos' for update of x skip locked"), ["digifact_operaciones"], "literales y for update no cuentan");
  assert.deepEqual(tablasDe("select to_regclass('public.documentos') is not null as ok"), [], "to_regclass no lee la tabla");
  assert.deepEqual(tablasDe("select * from generate_series(1, 3) g, unnest($1::int[]) u where extract(epoch from now()) > 0"), [], "funciones y subconsultas no son tablas");
  assert.deepEqual(tablasDe("select column_name from information_schema.columns where table_name = 'documentos'"), [], "otros esquemas no cuentan");
  assert.deepEqual(tablasDe("select * from (select id from public.documentos) x join pg_class p on true").sort(), ["documentos"], "subconsulta con tabla de empresa SÍ cuenta; pg_* no");
  assert.throws(() => validarSql("select * from public.documentos", TABLAS_SERVICIO, "prueba"), /acceso directo a datos no permitido en prueba: documentos/);
  assert.throws(() => validarSql("update public.clientes set nombre = 'x'", TABLAS_CATALOGO, "prueba"), /clientes/);
  assert.doesNotThrow(() => validarSql("select clave, valor::text from public.plataforma_parametros where clave = any($1::text[])", TABLAS_CATALOGO, "prueba"));
  assert.doesNotThrow(() => validarSql("select * from public.digifact_operaciones o join public.digifact_artefactos a on a.operacion_id = o.id", TABLAS_SERVICIO, "prueba"));
}});

Deno.test({ name: "Cierre R3 con la Data API: guardar, revisar, PDF, detalle y TODO el ciclo de Digifact simulado funcionan sin SQL directo de empresa; la identidad y la empresa se mantienen en las escrituras; sin JWT no sale nada", ...o, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true }); await activarEstablecimientosLocal(bd);
  const sesiones = new Sesiones(undefined, new AlmacenPg(bd)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const emu = emularPostgrest(bd.db!, { secreto: SECRETO, apikey: APIKEY });
  // Digifact REAL con transporte simulado: nada sale a la red
  const llamadas: PeticionHttp[] = []; let autorizada: string | null = null;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => { llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) return ok({ code: "1", message: "Procesado Correctamente", authNumber: AUT, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: btoa(XML_REAL), responseData2: "", responseData3: btoa(PDF_REAL), responseData4: "" });
    if (p.ruta.startsWith("/Shared")) return ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA DE PRUEBA, S.A." }] });
    return ok({}, 404); };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const emisor = { emisor: facturaPrueba().emisor, huella: HUELLA };
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? emisor : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => autorizada,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  let espiaN = 0; const bdEspiada = { ...bd, filas: (...x: Parameters<typeof bd.filas>) => { espiaN++; return bd.filas(...x); }, ejecutar: (...x: Parameters<typeof bd.ejecutar>) => { espiaN++; return bd.ejecutar(...x); }, rpc: (...x: Parameters<typeof bd.rpc>) => { espiaN++; return bd.rpc(...x); } } as typeof bd;
  let bdApi = null as typeof bd | null; const api = crearApi(bdEspiada, mundo, { alObtenerBd: (x) => { bdApi = x; }, sesiones, practico: true, identidadSesion: true, digifact: svc, datosApi: { url: URL, apikey: APIKEY, fetch: emu.fetch }, jwtDe: (r) => r.headers.get("x-jwt-prueba"), verificarJwt: (t) => verificar(t, SECRETO) as never });
  let n = 0;
  const entrar = async (clave: string) => {
    const r = await api(new Request("http://127.0.0.1/api/sesion/entrar", { method: "POST", headers: { "x-demo": "1", "content-type": "application/json" }, body: JSON.stringify({ usuario: clave, clave: CLAVE_DEMO }) })); assert.equal(r.status, 200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]; const sid = `95000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await bd.ejecutar("insert into auth.sessions (id, user_id, aal) values ($1, $2, 'aal2')", [sid, PERSONAS[clave].id]);
    const jwt = await firmarJwt({ sub: PERSONAS[clave].id, role: "authenticated", session_id: sid, aal: "aal2", exp: Math.floor(Date.now() / 1000) + 600 }, SECRETO);
    const ll = async (m: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => { const x = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", cookie, "x-jwt-prueba": jwt, ...cab }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const t = await x.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: x.status, json, texto: t, headers: x.headers, bytes: new TextEncoder().encode(t) }; };
    return { ll, sid, jwt, cookie }; };
  const ana = await entrar("ana"), marta = await entrar("marta"), pedro = await entrar("pedro"), sofia = await entrar("sofia");
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  // ---- el cerrojo está CABLEADO: la conexión efectiva de las rutas rechaza SQL sobre tablas de empresa y acepta solo catálogos globales; rpc sigue disponible
  assert.ok(bdApi); await assert.rejects(() => bdApi!.filas("select * from public.documentos"), /acceso directo a datos no permitido/); await assert.rejects(() => bdApi!.ejecutar("update public.clientes set nombre = 'x'"), /clientes/);
  await assert.rejects(() => bdApi!.filas("select 1 from public.empresas"), /empresas/); await bdApi!.filas("select clave from public.plataforma_parametros limit 1");
  // ---- guardar: cliente nuevo, consumidor final (cliente_ref por nombre), edición con fecha previa y cambio de tipo; todo por funciones
  const est = (await ana.ll("GET", "/api/estado")).json; const es = est.establecimientos[0], cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT");
  const d = await ana.ll("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: hoy, lineas: [{ descripcion: "Supervisión de obra", cantidad: "2", precio_unitario: "500" }] }); assert.equal(d.status, 200, d.texto); const docId = d.json.documento.id as string;
  const cf1 = await ana.ll("POST", "/api/documentos", { tipo: "CF", nombre_cf: "Juan Pérez", establecimiento_id: es.id, fecha: hoy, lineas: [{ descripcion: "Venta menor", cantidad: "1", precio_unitario: "100" }] }); assert.equal(cf1.status, 200, cf1.texto);
  const edit = await ana.ll("POST", "/api/documentos", { id: docId, version: d.json.documento.version, cliente_id: cli.id, establecimiento_id: es.id, fecha: hoy, lineas: [{ descripcion: "Supervisión de obra", cantidad: "2", precio_unitario: "500" }] }); assert.equal(edit.status, 200, edit.texto);
  const ver = (await ana.ll("GET", `/api/documentos/${docId}`)).json; assert.equal((await ana.ll("POST", `/api/documentos/${docId}/estado`, { estado: "revisado", version: ver.documento.version })).status, 200);
  // ---- detalle (cobertura por RPC), PDF carta y ticket
  const det = await ana.ll("GET", `/api/documentos/${docId}`); assert.equal(det.status, 200); assert.ok(Array.isArray(det.json.cobertura) && det.json.anulable === false, "detalle: cobertura por RPC; sin anulación simulada");
  for (const fmt of ["carta", "ticket"]) { const r = await ana.ll("GET", `/api/documentos/${docId}/pdf-demo?formato=${fmt}`); assert.equal(r.status, 200, `${fmt}: ${r.texto.slice(0, 120)}`); assert.match(r.headers.get("content-type") ?? "", /pdf/); }
  // ---- rutas acopladas a la simulación: no existen con la Data API
  for (const [m, r] of [["POST", `/api/operaciones/${docId}/conciliar-anulacion`], ["GET", `/api/documentos/${docId}/consultar-proveedor`]] as const) { const x = await ana.ll(m, r, m === "GET" ? undefined : {}); assert.equal(x.status, 404, `${r}: ${x.texto}`); assert.match(x.texto, /simulación|no_disponible/i); }
  // ---- referencias: una conciliación o una alerta que no existen (o son de otra empresa) devuelven 404 por la función, no por SQL
  assert.equal((await ana.ll("POST", `/api/conciliaciones/${crypto.randomUUID()}/decidir`, { aprobar: true, nota: "x" })).status, 404); assert.equal((await ana.ll("POST", `/api/alertas/${crypto.randomUUID()}/resolver`, { nota: "xxx" })).status, 404);
  // ---- Digifact: validar, preparar, certificar UNA vez (aun con triple clic), descargar archivos; con permisos y empresa
  const R = (id: string, x: string) => `/api/documentos/${id}/digifact${x}`;
  const v = await ana.ll("POST", R(docId, "/validar"), {}); assert.equal(v.status, 200, v.texto); assert.equal(v.json.ok, true, JSON.stringify(v.json.errores)); assert.equal(v.json.total, "1000.000000");
  assert.equal((await pedro.ll("POST", R(docId, "/preparar"), {})).status, 403, "el lector no prepara"); assert.equal((await sofia.ll("POST", R(docId, "/validar"), {})).status, 404, "otra empresa: el documento no existe (la función filtra por empresa)");
  const p = await ana.ll("POST", R(docId, "/preparar"), {}); assert.equal(p.status, 200, p.texto); autorizada = p.json.referencia;
  const c = { operacionId: p.json.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.json.referencia, huellaEmisor: p.json.huellaEmisor };
  assert.equal((await sofia.ll("POST", R(docId, "/certificar"), c)).status, 404, "otra empresa no usa la operación preparada");
  const rs = await Promise.all([ana.ll("POST", R(docId, "/certificar"), c), ana.ll("POST", R(docId, "/certificar"), c), ana.ll("POST", R(docId, "/certificar"), c)]); assert.deepEqual(rs.map((r) => r.status), [200, 200, 200], rs.map((r) => r.texto).join(" | "));
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/transform/nuc_json")).length, 1, "UN solo envío");
  const x = await ana.ll("GET", R(docId, "/xml")); assert.equal(x.status, 200); assert.equal(new TextDecoder().decode(x.bytes), XML_REAL); assert.equal((await sofia.ll("GET", R(docId, "/xml"))).status, 404, "otra empresa no descarga");
  const fin = (await ana.ll("GET", R(docId, ""))).json.operaciones as J[]; assert.equal(fin.length, 1); assert.equal(fin[0].estado, "certificada");
  // ---- descarga del archivo del documento por la RPC con permiso (artefacto del flujo del simulador no existe aquí; el de Digifact vive en su almacén)
  assert.equal((await ana.ll("GET", `/api/artefactos/${crypto.randomUUID()}`)).status, 404);
  // ---- sin JWT, con firma ajena o vencido: ninguna ruta de estos flujos toca la base ni a Digifact
  const falso = await firmarJwt({ sub: PERSONAS.ana.id, role: "authenticated", session_id: ana.sid, aal: "aal2", exp: Math.floor(Date.now() / 1000) + 600 }, "otro-secreto-0123456789-abcdefghij");
  const rutas: [string, string, unknown?][] = [["POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: hoy, lineas: [] }], ["GET", `/api/documentos/${docId}/pdf-demo`], ["POST", R(docId, "/validar"), {}], ["POST", R(docId, "/preparar"), {}], ["POST", R(docId, "/certificar"), c], ["GET", R(docId, "/xml")], ["GET", "/api/digifact/estado"], ["POST", "/api/digifact/nit", { nit: "44653948" }], ["GET", `/api/documentos/${docId}`]];
  assert.equal((await marta.ll("GET", "/api/estado")).status, 200);   // (una petición válida antes de medir)
  const n0 = espiaN, h0 = llamadas.length, e0 = emu.llamadas.length;
  for (const [m, r, b] of rutas) { for (const cab of [{ "x-jwt-prueba": "" }, { "x-jwt-prueba": falso }]) { const z = await ana.ll(m, r, b, cab); assert.equal(z.status, 403, `${m} ${r} (${cab["x-jwt-prueba"] ? "firma ajena" : "sin JWT"}): ${z.status} ${z.texto.slice(0, 100)}`); } }
  // un JWT válido de OTRA persona con la cookie de ana tampoco vale (el `sub` debe ser el de la sesión)
  for (const [m, r, b] of rutas) { const z = await ana.ll(m, r, b, { "x-jwt-prueba": marta.jwt }); assert.equal(z.status, 403, `${m} ${r} con el JWT de otra persona: ${z.status}`); }
  assert.equal(espiaN, n0, "sin JWT válido la aplicación NO ejecutó ninguna consulta ni rpc"); assert.equal(llamadas.length, h0, "nada salió hacia Digifact"); assert.equal(emu.llamadas.length, e0, "ni a la Data API");
  // ---- revocación inmediata en rutas de nivel sistema (no pasan por la Data API): se cierra la sesión de Auth y el MISMO token (aún sin vencer) deja de servir en el acto
  await bd.ejecutar("delete from auth.sessions where id = $1", [ana.sid]);
  for (const [m, r, b] of [["POST", R(docId, "/validar"), {}], ["POST", R(docId, "/certificar"), c], ["GET", R(docId, "/xml")], ["POST", "/api/digifact/nit", { nit: "44653948" }]] as const) {
    const z = await ana.ll(m, r, b); assert.equal(z.status, 403, `${m} ${r} con la sesión de Auth cerrada: ${z.status} ${z.texto.slice(0, 100)}`); assert.match(z.texto, /sesión no válida/i);
  }
  assert.equal(llamadas.filter((l) => l.ruta.startsWith("/v2/transform/nuc_json")).length, 1, "tras cerrar la sesión no sale nada más hacia Digifact");
}});

Deno.test({ name: "Cerrojo cableado en los servicios: el servicio de correo y el almacén de Digifact rechazan SQL sobre tablas de empresa (solo sus tablas propias); el límite de tasa también", ...o, fn: async () => {
  const bd = await crearBd(); await prepararBase(bd, { sembrar: true });
  const { ServicioCorreo } = await import("../src/correo/servicio.ts"); const { CorreoSimulado } = await import("../src/correo/proveedor.ts"); const { AlmacenGtPg } = await import("../../proveedores/src/almacen_gt_pg.ts"); const { LimiteTasaPg } = await import("../src/limite_pg.ts");
  const correo = ServicioCorreoDe(ServicioCorreo, CorreoSimulado, bd);
  // deno-lint-ignore no-explicit-any
  const cb = (correo as any).bd; await assert.rejects(() => cb.filas("select * from public.documentos"), /acceso directo a datos no permitido en servicio de correo/); await assert.rejects(() => cb.filas("select * from public.clientes"), /clientes/);
  await cb.filas("select to_regclass('public.envios_correo')::text as t");   // lo que no es tabla de empresa sigue permitido
  const llegadas: string[] = []; const alm = new AlmacenGtPg((async (sql: string) => { llegadas.push(sql); return []; }) as never);
  // deno-lint-ignore no-explicit-any
  const af = (alm as any).filas; await assert.rejects(() => af("select * from public.documentos"), /almacén de Digifact: documentos/); await af("select * from public.digifact_operaciones where id = $1", ["x"]); assert.equal(llegadas.length, 1, "solo la consulta de su tabla propia llegó a la base");
  const lim = new LimiteTasaPg(bd, 5, 60_000); // deno-lint-ignore no-explicit-any
  await assert.rejects(() => (lim as any).bd.filas("select * from public.miembros"), /límites de tasa: miembros/);
}});
function ServicioCorreoDe(C: new (bd: never, p: never, c: never) => unknown, P: new () => unknown, bd: unknown) { return new C(bd as never, new P() as never, { remitente: "x@ejemplo.test", destinatarioPermitido: () => true, automatico: false } as never); }
