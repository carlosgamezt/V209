// Tipos de documento (DTE) por la API REAL de la demostración, en el mismo proceso: PostgreSQL real en memoria con las migraciones del proyecto, Digifact con transporte SIMULADO.
// Comprueba: catálogo y configuración por empresa con permisos, selección y cambio de tipo en borradores, notas con origen certificado, recibos, validación sin red,
// bloqueo de la certificación de los tipos no implementados, y que FACT sigue igual. NO certifica nada, NO envía correos, NO toca la red.
// Uso: deno test -A tests/tipos_documento_api_test.ts
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO, EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { AlmacenGtMemoria, ServicioFelGt } from "../../proveedores/src/felgt_servicio.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", HUELLA = "0123456789abcdef", AUT = "62496FB5-75B4-4C75-83FA-DFBEF92DE92D";
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "tipos de documento por la API: catálogo, habilitación por empresa, notas con origen certificado, recibos, validación sin red y certificación bloqueada", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const bd = await crearBd(); const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
  for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = [];
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => { llamadas.push(p); return { estado: 404, cuerpo: "{}" }; };   // cualquier llamada a Digifact sería un fallo de la prueba
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => null,
    auditar: async (evento, ctx, d) => { await bd.filas("select public.fel_auditar($1, $2, $3, 'documento', $4, $5::jsonb)", [ctx.empresaId, ctx.actorId, evento, String(d.documento ?? d.operacion ?? ""), JSON.stringify(d)]); } });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  class Cli { cookie = ""; constructor(public usuario: string) {}
    async llamar(m: string, ruta: string, cuerpo?: unknown) {
      const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ }
      return { status: r.status, json };
    }
    async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200); return this; } }
  const ana = await new Cli("ana").entrar(), marta = await new Cli("marta").entrar(), pedro = await new Cli("pedro").entrar(), sofia = await new Cli("sofia").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], otro = est.clientes.find((c: J) => c.id !== cli.id && c.tipo_identificacion === "NIT"), es = est.establecimientos[0];
  const linea = (precio: string, descripcion = "Servicio de prueba") => [{ descripcion, cantidad: "2", precio_unitario: precio }];
  const nuevoDoc = async (u: Cli, extra: J = {}, precio = "50", cliente_id = cli.id) => await u.llamar("POST", "/api/documentos", { cliente_id, establecimiento_id: es.id, lineas: linea(precio), fecha: new Date().toISOString().slice(0, 10), ...extra });
  const revisar = async (r: J) => (await ana.llamar("POST", `/api/documentos/${r.json.documento.id}/estado`, { estado: "revisado", version: r.json.documento.version }));
  const certificarFalso = async (id: string, serie: string, num: string) => {   // sin proveedor: deja un FACT certificado como origen (las mismas transiciones que usa el sistema)
    await bd.ejecutar("select set_config('fel.op_fiscal', 'on', false)");
    await bd.ejecutar("update public.documentos set estado_fiscal = 'pendiente_certificacion' where id = $1", [id]);
    await bd.ejecutar("update public.documentos set estado_fiscal = 'certificado', serie = $2, numero_fiscal = $3, autorizacion_sat = $4, certificacion_verificada_en = now() where id = $1", [id, serie, num, AUT]);
    await bd.ejecutar("select set_config('fel.op_fiscal', 'off', false)");
  };

  // ---- 1. catálogo y configuración: todo visible, solo FACT habilitado, permisos
  const c0 = (await ana.llamar("GET", "/api/tipos-documento")).json;
  assert.equal(c0.tipos.length, 17); assert.equal(c0.predeterminado, "FACT"); assert.equal(c0.puede_configurar, true);
  assert.deepEqual(c0.tipos.filter((t: J) => t.habilitado).map((t: J) => t.codigo), ["FACT"], "solo Factura habilitada de origen");
  assert.deepEqual(c0.tipos.filter((t: J) => t.certificacion_habilitada).map((t: J) => t.codigo), ["FACT"]);
  assert.equal(c0.tipos.find((t: J) => t.codigo === "FCAM").disponibilidad, "pendiente"); assert.ok(c0.tipos.find((t: J) => t.codigo === "FCAM").motivo_pendiente.length > 20);
  assert.equal((await marta.llamar("GET", "/api/tipos-documento")).json.puede_configurar, false, "el emisor ve el catálogo pero no lo configura");
  assert.equal((await new Cli("ana").llamar("GET", "/api/tipos-documento")).status, 401, "sin sesión no hay catálogo");
  assert.equal((await marta.llamar("POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true })).status, 403);
  assert.equal((await pedro.llamar("POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true })).status, 403);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "ZZZZ", habilitado: true })).status, 400);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "FCAM", habilitado: true })).status, 422, "un tipo pendiente no se habilita");
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "FPEQ", habilitado: true, predeterminado: true })).status, 422);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "RECI", habilitado: true })).status, 422, "el recibo exige su base");

  // ---- 2. FACT sigue igual: sin tipo en la petición es Factura; el selector no cambia nada si no se usa
  const f1 = await nuevoDoc(marta); assert.equal(f1.status, 200, JSON.stringify(f1.json)); assert.equal(f1.json.documento.tipo_dte, "FACT"); assert.equal(f1.json.documento.documento_origen_id, null);
  const f1b = await nuevoDoc(marta, { tipo_dte: "FACT" }); assert.equal(f1b.json.documento.tipo_dte, "FACT");
  // un tipo no habilitado no se puede elegir ni crear (nada queda guardado)
  const antes = (await ana.llamar("GET", "/api/documentos")).json.length;
  for (const t of ["NCRE", "NDEB", "RECI"]) assert.equal((await nuevoDoc(marta, { tipo_dte: t, tipo_recibo: "Colegio", documento_origen_id: f1.json.documento.id, motivo_ajuste: "motivo" })).status, 422, t + " sin habilitar");
  for (const t of ["FCAM", "FPEQ", "FCAP", "FESP"]) assert.equal((await nuevoDoc(marta, { tipo_dte: t })).status, 422, t + " pendiente");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "XXXX" })).status, 400);
  assert.equal((await ana.llamar("GET", "/api/documentos")).json.length, antes, "los intentos rechazados no dejaron borradores a medias");

  // ---- 3. la empresa habilita NCRE, NDEB y RECI (este con su base) y elige el predeterminado
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true })).status, 200);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "NDEB", habilitado: true })).status, 200);
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "RECI", habilitado: true, base_habilitacion: "Base de prueba (no es una resolución real)", predeterminado: true })).status, 200);
  const c1 = (await ana.llamar("GET", "/api/tipos-documento")).json; assert.equal(c1.predeterminado, "RECI"); assert.deepEqual(c1.tipos.filter((t: J) => t.habilitado).map((t: J) => t.codigo).sort(), ["FACT", "NCRE", "NDEB", "RECI"]);
  assert.equal((await sofia.llamar("GET", "/api/tipos-documento")).json.predeterminado, "FACT", "la otra empresa no cambió");
  assert.deepEqual((await sofia.llamar("GET", "/api/tipos-documento")).json.tipos.filter((t: J) => t.habilitado).map((t: J) => t.codigo), ["FACT"]);

  // ---- 4. nota de crédito: exige un origen CERTIFICADO
  const o = await nuevoDoc(marta, {}, "100"); assert.equal((await revisar(o)).status, 200);                      // total 200
  const sinOrigen = await nuevoDoc(marta, { tipo_dte: "NCRE", motivo_ajuste: "Devolución" }, "20"); assert.equal(sinOrigen.status, 400, "sin origen");
  const noCert = await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: o.json.documento.id, motivo_ajuste: "Devolución" }, "20"); assert.equal(noCert.status, 422, "el origen aún no está certificado");
  await certificarFalso(o.json.documento.id, "62496FB5", "1974750325");
  const cand = (await marta.llamar("GET", "/api/documentos/origenes?tipo=NCRE")).json; assert.ok(cand.some((x: J) => x.id === o.json.documento.id && x.serie === "62496FB5"), "el certificado es candidato");
  assert.equal((await marta.llamar("GET", "/api/documentos/origenes?tipo=FACT")).status, 422, "FACT no tiene origen"); assert.equal((await marta.llamar("GET", "/api/documentos/origenes?tipo=ZZZZ")).status, 400);
  assert.equal((await sofia.llamar("GET", "/api/documentos/origenes?tipo=NCRE")).json.length, 0, "la otra empresa no ve estos documentos");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: o.json.documento.id }, "20")).status, 400, "sin motivo");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: o.json.documento.id, motivo_ajuste: "ab" }, "20")).status, 400, "motivo muy corto");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: f1.json.documento.id, motivo_ajuste: "Devolución" }, "20")).status, 422, "origen no certificado");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: crypto.randomUUID(), motivo_ajuste: "Devolución" }, "20")).status, 422, "origen inexistente");
  const origenAntes = (await ana.llamar("GET", `/api/documentos/${o.json.documento.id}`)).json.documento;
  const n1 = await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: o.json.documento.id, motivo_ajuste: "Devolución de mercadería" }, "20"); assert.equal(n1.status, 200, JSON.stringify(n1.json));
  const dn = n1.json.documento; assert.equal(dn.tipo_dte, "NCRE"); assert.equal(dn.referencia_origen.autorizacion, AUT); assert.equal(dn.referencia_origen.serie, "62496FB5"); assert.equal(dn.cliente_id, cli.id, "el receptor es el del origen");
  const origenDespues = (await ana.llamar("GET", `/api/documentos/${o.json.documento.id}`)).json.documento; assert.equal(origenDespues.tipo_dte, "FACT"); assert.equal(origenDespues.estado_fiscal, "certificado"); assert.deepEqual({ v: origenDespues.version, a: origenDespues.actualizado_en, t: origenDespues.total, s: origenDespues.serie }, { v: origenAntes.version, a: origenAntes.actualizado_en, t: origenAntes.total, s: origenAntes.serie }, "el origen no se modificó");
  // otro receptor ≠ el del origen: la nota toma siempre el del origen (aunque el formulario mande otro)
  if (otro) { const n1b = await nuevoDoc(marta, { tipo_dte: "NCRE", documento_origen_id: o.json.documento.id, motivo_ajuste: "Otro motivo distinto" }, "21", otro.id); assert.equal(n1b.status, 200); assert.equal(n1b.json.documento.cliente_id, cli.id, "se ignora el receptor del formulario"); }

  // ---- 5. validar por el servicio (sin red): la nota se valida con sus reglas propias y avisa que aún no certifica; preparar/certificar se rechazan
  await ana.llamar("POST", `/api/documentos/${dn.id}/estado`, { estado: "revisado", version: dn.version });
  const v = await ana.llamar("POST", `/api/documentos/${dn.id}/digifact/validar`, {}); assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.tipo, "NCRE"); assert.equal(v.json.certificable, false); assert.match(v.json.aviso, /solo validación y vista previa/); assert.equal(v.json.ok, true, JSON.stringify(v.json.errores));
  const p = await ana.llamar("POST", `/api/documentos/${dn.id}/digifact/preparar`, {}); assert.equal(p.status, 422); assert.equal(p.json.codigo, "tipo_no_habilitado");
  const ce = await ana.llamar("POST", `/api/documentos/${dn.id}/digifact/certificar`, { operacionId: "x", confirmacion: "x", referencia: "x", huellaEmisor: HUELLA }); assert.equal(ce.status, 422); assert.equal(ce.json.codigo, "tipo_no_habilitado");
  assert.equal(llamadas.length, 0, "nada salió hacia Digifact");
  // y la base lo impide también en el flujo simulado
  const sim = await ana.llamar("POST", `/api/documentos/${dn.id}/certificar`, { clave: "clave-de-prueba-0123456789" }); assert.ok(sim.status >= 400, "el flujo simulado tampoco certifica una nota: " + sim.status);
  assert.equal((await bd.filas("select count(*)::int as n from public.operaciones_fiscales where documento_id = $1", [dn.id]))[0].n, 0);
  // una nota revisada es inmutable en su tipo
  const rev = (await ana.llamar("GET", `/api/documentos/${dn.id}`)).json.documento;
  assert.equal((await ana.llamar("POST", "/api/documentos", { id: dn.id, version: rev.version, cliente_id: cli.id, establecimiento_id: es.id, lineas: linea("20"), tipo_dte: "FACT" })).status >= 400, true, "no se cambia el tipo de una nota revisada");

  // ---- 6. recibo: tipo obligatorio; habilitado con base; cambiar el tipo de un borrador mientras es editable
  assert.equal((await nuevoDoc(marta, { tipo_dte: "RECI" }, "30")).status, 400, "el recibo exige su tipo");
  assert.equal((await nuevoDoc(marta, { tipo_dte: "RECI", tipo_recibo: "Banco" }, "30")).status, 400);
  const r1 = await nuevoDoc(marta, { tipo_dte: "RECI", tipo_recibo: "Colegio" }, "30"); assert.equal(r1.status, 200, JSON.stringify(r1.json)); assert.equal(r1.json.documento.tipo_dte, "RECI"); assert.equal(r1.json.documento.tipo_recibo, "Colegio");
  const vr = await ana.llamar("POST", `/api/documentos/${r1.json.documento.id}/estado`, { estado: "revisado", version: r1.json.documento.version }); assert.equal(vr.status, 200, JSON.stringify(vr.json));
  const vv = await ana.llamar("POST", `/api/documentos/${r1.json.documento.id}/digifact/validar`, {}); assert.equal(vv.json.tipo, "RECI"); assert.equal(vv.json.certificable, false);
  const r2 = await nuevoDoc(marta, { tipo_dte: "RECI", tipo_recibo: "Universidad" }, "31");
  const r2f = await marta.llamar("POST", "/api/documentos", { id: r2.json.documento.id, version: r2.json.documento.version, cliente_id: cli.id, establecimiento_id: es.id, lineas: linea("31"), tipo_dte: "FACT" });
  assert.equal(r2f.status, 200, JSON.stringify(r2f.json)); assert.equal(r2f.json.documento.tipo_dte, "FACT"); assert.equal(r2f.json.documento.tipo_recibo, null, "al volver a Factura se limpian los campos del recibo");
  // sin enviar el tipo (formulario anterior), un documento existente conserva el suyo
  const r3 = await nuevoDoc(marta, { tipo_dte: "RECI", tipo_recibo: "Inmobiliaria" }, "32");
  const r3m = await marta.llamar("POST", "/api/documentos", { id: r3.json.documento.id, version: r3.json.documento.version, cliente_id: cli.id, establecimiento_id: es.id, lineas: linea("33") }); assert.equal(r3m.status, 200, JSON.stringify(r3m.json)); assert.equal(r3m.json.documento.tipo_dte, "RECI");
  // la empresa retira la habilitación: se conserva lo creado, pero no se crean más
  assert.equal((await ana.llamar("POST", "/api/tipos-documento", { tipo: "RECI", habilitado: false })).status, 200);
  assert.equal((await nuevoDoc(marta, { tipo_dte: "RECI", tipo_recibo: "Colegio" }, "34")).status, 422);
  assert.equal((await ana.llamar("GET", "/api/tipos-documento")).json.predeterminado, "FACT", "sin habilitación, el predeterminado vuelve a Factura");

  // ---- 7. historial: el listado trae el tipo y la referencia
  const lista = (await ana.llamar("GET", "/api/documentos")).json as J[];
  assert.ok(lista.every((d) => typeof d.tipo_dte === "string")); assert.ok(lista.some((d) => d.tipo_dte === "NCRE" && d.origen_serie === "62496FB5")); assert.ok(lista.some((d) => d.tipo_dte === "RECI")); assert.ok(lista.filter((d) => d.tipo_dte === "FACT").length >= 2);
  // ---- 8. auditoría: cada cambio de configuración y de tipo queda registrado
  const aud = await bd.filas<{ accion: string }>("select accion from public.auditoria where empresa_id = $1 and accion in ('empresa.tipo_documento', 'documento.tipo')", [EMPRESA]); assert.ok(aud.some((x) => x.accion === "empresa.tipo_documento") && aud.some((x) => x.accion === "documento.tipo"));
  assert.ok(!(await bd.filas("select 1 from public.auditoria where empresa_id = $1", [EMPRESA2])).some((_) => false));
  await bd.cerrar();
} });

Deno.test({ name: "base SIN la propuesta de migración de tipos: la demostración sigue como antes (solo Factura), sin consultar columnas ni funciones nuevas, y los tipos nuevos se rechazan con un mensaje claro", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  Deno.env.set("FEL_TIPOS", "0"); let bd; try { bd = await crearBd(); } finally { Deno.env.delete("FEL_TIPOS"); }
  assert.equal((await bd.filas("select to_regclass('public.fel_tipos_dte') is null as sin")).at(0)?.sin, true, "la base de esta prueba NO tiene la propuesta");
  const mundo = await prepararBase(bd, { sembrar: true });
  const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO; for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
  const llamadas: PeticionHttp[] = [];
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte: async (p) => { llamadas.push(p); return { estado: 404, cuerpo: "{}" }; } });
  const svc = new ServicioFelGt({ clienteDe: (e) => (e === EMPRESA ? cliente : null), emisorDe: (e) => (e === EMPRESA ? { emisor: facturaPrueba().emisor, huella: HUELLA } : null), almacen: AlmacenGtMemoria.persistenteSimulado(), autorizaPrueba: () => null, auditar: async () => {} });
  const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc });
  const llamar = async (cookie: string, m: string, ruta: string, cuerpo?: unknown) => { const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const t = await r.text(); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] }; };
  const entrar = async (u: string) => (await llamar("", "POST", "/api/sesion/entrar", { usuario: u, clave: CLAVE_DEMO })).cookie;
  const ana = await entrar("ana"), est = (await llamar(ana, "GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT") ?? est.clientes[0], es = est.establecimientos[0];
  const cuerpo = (extra: J = {}) => ({ cliente_id: cli.id, establecimiento_id: es.id, lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "75" }], fecha: new Date().toISOString().slice(0, 10), ...extra });
  const c = (await llamar(ana, "GET", "/api/tipos-documento")).json;
  assert.equal(c.sin_migracion, true); assert.equal(c.puede_configurar, false); assert.deepEqual(c.tipos.filter((t: J) => t.habilitado).map((t: J) => t.codigo), ["FACT"]); assert.equal(c.predeterminado, "FACT");
  assert.match(c.tipos.find((t: J) => t.codigo === "NCRE").motivo_no_habilitado, /migración/);
  assert.equal((await llamar(ana, "POST", "/api/tipos-documento", { tipo: "NCRE", habilitado: true })).status, 422);
  assert.equal((await llamar(ana, "GET", "/api/documentos/origenes?tipo=NCRE")).status, 422);
  // Factura: crear (con y sin tipo), editar sin tipo, listar, detallar, revisar, validar por el servicio (leerDocumentoFel sin columnas nuevas)
  const d1 = await llamar(ana, "POST", "/api/documentos", cuerpo()); assert.equal(d1.status, 200, JSON.stringify(d1.json)); assert.equal(d1.json.documento.tipo_dte, undefined, "la base no tiene tipo_dte");
  const d2 = await llamar(ana, "POST", "/api/documentos", cuerpo({ tipo_dte: "FACT" })); assert.equal(d2.status, 200, JSON.stringify(d2.json));
  const ed = await llamar(ana, "POST", "/api/documentos", cuerpo({ id: d1.json.documento.id, version: d1.json.documento.version })); assert.equal(ed.status, 200, JSON.stringify(ed.json));
  assert.equal((await llamar(ana, "POST", "/api/documentos", cuerpo({ tipo_dte: "NCRE", documento_origen_id: d1.json.documento.id, motivo_ajuste: "Devolución" }))).status, 422, "un tipo nuevo se rechaza con claridad");
  assert.equal((await llamar(ana, "POST", "/api/documentos", cuerpo({ tipo_dte: "RECI", tipo_recibo: "Colegio" }))).status, 422);
  const lista = (await llamar(ana, "GET", "/api/documentos")).json; assert.ok(lista.length >= 2 && lista.every((d: J) => d.tipo_dte === undefined), "el listado funciona sin las columnas nuevas");
  assert.equal((await llamar(ana, "GET", `/api/documentos/${d1.json.documento.id}`)).status, 200);
  const rev = await llamar(ana, "POST", `/api/documentos/${ed.json.documento.id}/estado`, { estado: "revisado", version: ed.json.documento.version }); assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const v = await llamar(ana, "POST", `/api/documentos/${ed.json.documento.id}/digifact/validar`, {}); assert.equal(v.status, 200, JSON.stringify(v.json)); assert.equal(v.json.tipo, "FACT"); assert.equal(v.json.certificable, true); assert.equal(v.json.ok, true, JSON.stringify(v.json.errores));
  const pdf = await api(new Request(`http://127.0.0.1/api/documentos/${d1.json.documento.id}/pdf-demo?formato=carta`, { headers: { "x-demo": "1", cookie: ana } })); assert.equal(pdf.status, 200, "el PDF funciona sin las columnas nuevas");
  assert.equal(llamadas.length, 0); await bd.cerrar();
} });
