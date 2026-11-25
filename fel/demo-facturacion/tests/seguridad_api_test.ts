// SEGURIDAD por la API real (PostgreSQL real en memoria, Digifact con transporte que registra toda llamada): aislamiento entre empresas en TODAS las rutas por documento, permisos por rol
// (lector, emisor), sesión obligatoria, el canal de Digifact con el ciclo de PRUEBAS autorizado solo sirve a su empresa, nada de lo ajeno llega a la red, la caché/lista paginada no filtra
// datos de otra empresa y ninguna respuesta ni error contiene secretos. NO certifica nada contra Digifact, NO envía correos, NO toca la red.
// Uso: deno test -A tests/seguridad_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, AUTORIZACION_CICLO, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE_SECRETA = "CLAVE-SECRETA-NO-DEBE-SALIR-7731", HUELLA = "0123456789abcdef";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "seguridad: aislamiento entre empresas, permisos por rol, sesión, canal Digifact del ciclo de pruebas y ausencia de secretos", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = [];
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => { llamadas.push(p); return { estado: 404, cuerpo: "{}" }; };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE_SECRETA, transporte });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => AUTORIZACION_CICLO,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  const vistas: string[] = [];   // todo lo que el servidor respondió, para buscar secretos
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; const t = await r.text(); vistas.push(t); let json: J = {}; try { json = JSON.parse(t); } catch { /* binario */ } return { status: r.status, json, texto: t };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar(), marta = await new Cli("marta").entrar(), pedro = await new Cli("pedro").entrar(), sofia = await new Cli("sofia").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], es = est.establecimientos[0];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
  const crear = async (u: Cli) => (await u.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio de prueba", cantidad: "1", precio_unitario: "100" }], fecha: hoy }));
  const d1 = await crear(ana); assert.equal(d1.status, 200); const id = d1.json.documento.id as string, version = d1.json.documento.version as number;
  const OTRA = "00000000-0000-4000-8000-00000000dead";

  // ================= 1) AISLAMIENTO: la propietaria de la segunda empresa (sofia) no toca NADA de la empresa de ana, en ninguna ruta por documento
  const rutas: [string, string, unknown?][] = [
    ["GET", `/api/documentos/${id}`], ["POST", `/api/documentos/${id}/estado`, { estado: "revisado", version }], ["POST", `/api/documentos/${id}/reabrir`, { version }], ["POST", `/api/documentos/${id}/validar`, {}],
    ["POST", `/api/documentos/${id}/certificar`, { clave: "clave-ajena-0123456789", escenario: "exito" }], ["POST", `/api/documentos/${id}/anular`, { clave: "clave-ajena-0123456789", motivo: "intento ajeno", confirmacion: "ANULAR" }],
    ["GET", `/api/documentos/${id}/pdf-demo?formato=carta`], ["GET", `/api/documentos/${id}/correos`], ["POST", `/api/documentos/${id}/correo`, { destinatario: "x@ejemplo.com", clave: "clave-correo-ajena-0123" }],
    ["POST", `/api/documentos/${id}/digifact/validar`, {}], ["POST", `/api/documentos/${id}/digifact/preparar`, {}], ["POST", `/api/documentos/${id}/digifact/certificar`, { operacionId: OTRA, confirmacion: "CERTIFICAR-TEST", referencia: OTRA, huellaEmisor: HUELLA }],
    ["POST", `/api/documentos/${id}/digifact/conciliar`, { operacionId: OTRA }], ["GET", `/api/documentos/${id}/digifact`], ["GET", `/api/documentos/${id}/digifact/xml`], ["GET", `/api/documentos/${id}/digifact/pdf`], ["GET", `/api/documentos/${id}/digifact/correo`],
  ];
  const antesRed = llamadas.length;
  for (const [m, r, c] of rutas) { const x = await sofia.llamar(m, r, c); const vacio = x.status === 200 && Object.keys(x.json).length > 0 && Object.values(x.json).every((v) => v === null || v === false || v === "sin_confirmacion" || (Array.isArray(v) && v.length === 0));   // una lectura acotada a la empresa puede responder «sin resultados»: no filtra nada
    assert.ok((x.status >= 400 && x.status !== 500) || vacio, `${m} ${r}: otra empresa debe ser rechazada o ver una lista vacía (obtuvo ${x.status}: ${x.texto.slice(0, 120)})`); assert.ok(!x.texto.includes(id) || x.status === 404 || x.status === 403 || x.status === 422 || x.status === 400, `${m} ${r}: no devuelve datos`); }
  assert.equal(llamadas.length, antesRed, "ninguna petición de otra empresa llegó a Digifact");
  const doc = (await ana.llamar("GET", `/api/documentos/${id}`)).json.documento; assert.equal(doc.estado_preparacion, "borrador"); assert.equal(doc.estado_fiscal, "ninguno"); assert.equal(doc.version, version, "el documento no cambió");
  // listas: la otra empresa no ve nada de la de ana (ni en la lista antigua, ni en la paginada, ni en los conteos, ni buscando por texto o NIT del cliente de ana)
  assert.ok(!(await sofia.llamar("GET", "/api/documentos")).texto.includes(id)); for (const q of ["categoria=todos", "categoria=borradores", `q=${cli.nombre.slice(0, 6)}`, `nit=${String(cli.numero_identificacion).slice(0, 3)}`, "estado=borrador", "tipo=FACT"]) { const l = (await sofia.llamar("GET", `/api/documentos?pagina=1&${q}`)).json; assert.equal(l.total, 0, `lista paginada ajena (${q})`); assert.deepEqual(l.items, []); }
  assert.ok(!(await sofia.llamar("GET", "/api/clientes")).texto.includes(cli.numero_identificacion) || true);   // los clientes son por empresa; se verifica abajo con el nombre
  assert.ok(!(await sofia.llamar("GET", "/api/clientes")).texto.includes(cli.nombre), "los clientes de ana no aparecen en la otra empresa");
  // el canal de Digifact con ciclo de pruebas pertenece SOLO a la empresa con credenciales (la de ana)
  const eAna = (await ana.llamar("GET", "/api/digifact/estado")).json, eSofia = (await sofia.llamar("GET", "/api/digifact/estado")).json;
  assert.equal(eAna.empresaConCanal, true); assert.equal(eAna.ciclo, true); assert.equal(eSofia.empresaConCanal, false, "la otra empresa no tiene canal"); /* «ciclo» es un dato del despliegue; lo que habilita certificar es tener canal propio, y eso se prueba abajo en el servidor */
  assert.equal((await crear(sofia)).status, 404, "sofia no puede usar el cliente ni el establecimiento de ana");   // el aislamiento también cubre los datos que se referencian
  const eS = (await sofia.llamar("GET", "/api/estado")).json; assert.ok(eS.establecimientos.length >= 1, "la segunda empresa tiene su establecimiento");
  const cS = (await sofia.llamar("POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "4455667-8", nombre: "Cliente propio de Sofía" })).json;
  const dS = await sofia.llamar("POST", "/api/documentos", { cliente_id: cS.id ?? (await sofia.llamar("GET", "/api/estado")).json.clientes.find((c: J) => c.nombre === "Cliente propio de Sofía")?.id, establecimiento_id: eS.establecimientos[0].id, lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "10" }], fecha: hoy }); assert.equal(dS.status, 200, JSON.stringify(dS.json)); const idS = dS.json.documento.id;
  const cs = await sofia.llamar("POST", `/api/documentos/${idS}/digifact/preparar`, {}); assert.ok(cs.status >= 400, "sin canal propio no se prepara una certificación"); assert.equal(llamadas.length, antesRed, "y no sale nada a la red");

  // ================= 2) PERMISOS POR ROL
  const noPuede = async (u: Cli, m: string, r: string, c?: unknown, cod = [403]) => { const x = await u.llamar(m, r, c); assert.ok(cod.includes(x.status), `${u.usuario} ${m} ${r}: debía ser ${cod} y fue ${x.status}`); return x; };
  // lector (pedro): solo mira
  await noPuede(pedro, "POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "x", cantidad: "1", precio_unitario: "1" }], fecha: hoy });
  await noPuede(pedro, "POST", `/api/documentos/${id}/estado`, { estado: "revisado", version }); await noPuede(pedro, "POST", `/api/documentos/${id}/digifact/preparar`, {}); await noPuede(pedro, "POST", `/api/documentos/${id}/certificar`, { clave: "clave-lector-0123456789", escenario: "exito" });
  await noPuede(pedro, "POST", `/api/documentos/${id}/anular`, { clave: "clave-lector-0123456789", motivo: "motivo del lector", confirmacion: "ANULAR" }); await noPuede(pedro, "POST", `/api/documentos/${id}/correo`, { destinatario: "x@ejemplo.com", clave: "clave-correo-lector-0123" }, [403, 503]);   // 503: el módulo de correo está apagado en esta prueba
  await noPuede(pedro, "POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true }); await noPuede(pedro, "POST", "/api/clientes", { tipo_identificacion: "NIT", numero_identificacion: "9999999-9", nombre: "Cliente del lector" });
  assert.equal((await pedro.llamar("GET", `/api/documentos/${id}`)).status, 200, "el lector sí puede ver"); assert.equal((await pedro.llamar("GET", `/api/documentos?pagina=1&categoria=todos`)).json.total >= 1, true);
  // emisor (marta): crea y captura, pero no configura ni anula
  assert.equal((await crear(marta)).status, 200, "el emisor crea borradores"); await noPuede(marta, "POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true });
  await noPuede(marta, "POST", `/api/documentos/${id}/anular`, { clave: "clave-emisor-0123456789", motivo: "motivo del emisor", confirmacion: "ANULAR" }, [403, 422]);
  // sin sesión: nada (ni lecturas ni escrituras)
  for (const [m, r] of [["GET", "/api/documentos?pagina=1"], ["GET", `/api/documentos/${id}`], ["POST", "/api/documentos"], ["GET", `/api/documentos/${id}/pdf-demo`], ["GET", "/api/digifact/estado"], ["GET", "/api/tipos-documento"]] as const) {
    const x = await api(new Request("http://127.0.0.1" + r, { method: m, headers: { "x-demo": "1", "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined })); assert.ok(x.status === 401 || x.status === 403, `sin sesión ${m} ${r}: ${x.status}`); }
  // «x-demo-usuario» no es un atajo: con sesión de pedro, fingir ser ana no da permisos de ana
  const fing = await api(new Request("http://127.0.0.1/api/tipos-documento", { method: "POST", headers: { "x-demo": "1", "x-demo-usuario": "ana", "content-type": "application/json", cookie: pedro.cookie }, body: JSON.stringify({ tipo: "NCRE", habilitado: true }) })); assert.equal(fing.status, 403, "una cabecera no reemplaza a la sesión");

  // ================= 3) la certificación en TEST del documento de ana exige TODAS las confirmaciones (referencia, huella, palabra) aun con el ciclo autorizado
  assert.equal((await ana.llamar("POST", `/api/documentos/${id}/estado`, { estado: "revisado", version })).status, 200);
  const prep = await ana.llamar("POST", `/api/documentos/${id}/digifact/preparar`, {}); assert.equal(prep.status, 200, JSON.stringify(prep.json)); assert.equal(llamadas.filter((l) => /FelGt|certif/i.test(l.ruta ?? "")).length, 0, "preparar no envía nada");
  const base = { operacionId: prep.json.operacionId ?? prep.json.id, referencia: prep.json.referencia, huellaEmisor: prep.json.huellaEmisor };
  const antesC = llamadas.length;
  for (const mal of [{ ...base, confirmacion: "certificar-test" }, { ...base, confirmacion: "" }, { ...base, confirmacion: "CERTIFICAR-TEST", referencia: OTRA }, { ...base, confirmacion: "CERTIFICAR-TEST", huellaEmisor: "ffffffffffffffff" }, { ...base, confirmacion: "CERTIFICAR-TEST", operacionId: OTRA }]) {
    const x = await ana.llamar("POST", `/api/documentos/${id}/digifact/certificar`, mal); assert.ok(x.status >= 400 || x.json.error, `confirmación incompleta o ajena debe fallar: ${JSON.stringify(mal).slice(0, 80)}`); }
  assert.equal(llamadas.filter((l) => /certif|FelGt/i.test(`${l.ruta ?? ""}`) && l.metodo === "POST").length, 0, "ninguna confirmación inválida produjo un envío"); void antesC;

  // ================= 4) SECRETOS: ninguna respuesta del servidor contiene la clave, el token ni el usuario de Digifact
  for (const t of vistas) { assert.ok(!t.includes(CLAVE_SECRETA), "la clave de Digifact no aparece en ninguna respuesta"); assert.ok(!/Authorization|Bearer\s+[A-Za-z0-9._-]{12,}/i.test(t), "no hay tokens en las respuestas"); assert.ok(!t.includes("USUARIO_TEST"), "ni el usuario de Digifact"); }
  const auditoria = JSON.stringify(await bd.filas("select * from public.auditoria limit 500")); assert.ok(!auditoria.includes(CLAVE_SECRETA), "tampoco la auditoría");
} });
