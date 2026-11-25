// PRIMERA CERTIFICACIÓN DESDE LA APLICACIÓN (ensayo local): la API REAL de NEXA FEL sobre PostgreSQL REAL con las 29 migraciones (almacén persistente de Digifact) y un Digifact SIMULADO.
// Recorre el procedimiento completo: sesión → cliente → líneas → revisión → preparar → certificar (con el correo por Digifact) → estado fiscal del documento → UUID/serie/número → XML y PDF → consulta y descarga,
// y las garantías que lo rodean: un solo envío, resultado desconocido sin reenvío, aislamiento entre empresas, documento certificado protegido y destinatarios restringidos. NADA sale a la red ni usa credenciales.
// Solo con FEL_TEST_PG_ADMIN (ver tools/test-demo-pg.sh). Uso: bash tools/test-demo-pg.sh tests/certificar_desde_app_test.ts
import assert from "node:assert/strict";
import { baseDePrueba } from "./bd_prueba.ts";
import { crearBdPg } from "../src/bd.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { crearApi } from "../src/api.ts";
import { Sesiones } from "../src/sesiones.ts";
import { AlmacenMemoria } from "../src/almacen.ts";
import { PERSONAS, CLAVE_DEMO } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { crearPoliticaCorreoDigifactDesdeEntorno } from "../src/digifact_correo_entorno.ts";
import { huellaEmisor } from "../../proveedores/src/datos_emisor.ts";
import { crearDigifactParaBd } from "../src/digifact_entorno.ts";

const admin = Deno.env.get("FEL_TEST_PG_ADMIN");
const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", DEST = "prueba.nexa@ejemplo.com";
const AUT1 = "A7220268-0BCF-4C35-9661-6791E5ADF2DC", AUT2 = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", AUT3 = "0F5C2D9A-7B31-4E86-9A44-2C1D6E8B7F03";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const XML = (a: string) => `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento><dte:NumeroAutorizacion Numero="198134837" Serie="A7220268">${a}</dte:NumeroAutorizacion></dte:GTDocumento>`, PDF = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n";
const sha = async (t: string | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof t === "string" ? new TextEncoder().encode(t) : t as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, "0")).join("");
type J = Record<string, any>; // deno-lint-ignore no-explicit-any

Deno.test({ name: "primera certificación desde la aplicación (ensayo local): flujo completo, un solo envío, desconocido sin reenvío, aislamiento, documento protegido y correo restringido", ignore: !admin, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const pg = await baseDePrueba(); const bd = crearBdPg(pg.url!);
  try {
    const mundo = await prepararBase(bd, { sembrar: true });
    const sesiones = new Sesiones(undefined, new AlmacenMemoria(PERSONAS)); sesiones.claveDemoPublica = CLAVE_DEMO;
    for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO, PERSONAS[k]);
    // ---- Digifact SIMULADO a nivel HTTP (con memoria: sabe qué referencias certificó, como el reporte de acuses real). El servicio se arma EXACTAMENTE como en la función hospedada: por variables de entorno.
    const nucs: J[] = [], salida: string[] = []; let modo: "exito" | "corte" = "exito", autorizacion = AUT1; const memoria = new Map<string, string>();
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url)); assert.equal(u.hostname, "testnucgt.digifact.com", "solo el ambiente TEST de Digifact");
      if (u.pathname.endsWith("/login/get_token")) return json({ Token: TOKEN });
      if (u.pathname.endsWith("/v2/transform/nuc_json")) {
        const nuc = JSON.parse(String(init?.body)); nucs.push(nuc); const ref = nuc.AdditionalDocumentInfo.AdditionalInfo[0].Code as string; memoria.set(ref, autorizacion);
        if (modo === "corte") throw new Error("corte de red");   // Digifact SÍ lo certificó pero NEXA no lo supo
        return json({ code: "1", message: "Proceso de certificacion realizado correctamente!", authNumber: autorizacion, batch: "A7220268", serial: "198134837", enrolledTimeStamp: "2026-11-21T13:33:27", responseData1: btoa(XML(autorizacion)), responseData3: btoa(PDF) });
      }
      if (u.pathname.endsWith("/GetDocument")) return json({ RESPONSE: [{ ResponseData1: btoa(XML(autorizacion)), ResponseData3: btoa(PDF) }] });
      if (u.pathname.endsWith("/Shared")) {
        const filas = [...memoria.entries()].map(([ref, aut]) => ({ GUID: aut, SERIE: "A7220268", NUMERO: "198134837", TIPO_DTE: "FACT", FECHA_DE_CERTIFICACION: "2026-11-21T13:33:27", REFERENCIA_INTERNA: ref, ESTADO_ACUSE: "ACEPTADO_SAT", ANULADO: "0", TOTAL: "100.00", NE: "2", NOMBRE: "X" }));
        return json({ REQUEST_DATA: [{ Respuesta: filas.length ? "1" : "0" }], RESPONSE: filas });
      }
      return json({ mensaje: "ruta no permitida" }, 404);
    }) as typeof fetch;
    const DATOS = { nit: "5888492", nombre: "TEST GENS", nombreComercial: 'ESTABLECIMIENTO "TEST GEN"', afiliacionIva: "GEN", codigoEstablecimiento: "2", correo: "", direccion: { direccion: "0 AVENIDA APTO. 108 ZONA 21", codigoPostal: "01021", municipio: "Guatemala", departamento: "GUATEMALA", pais: "GT" }, frases: [{ tipo: 1, escenario: 2 }] };
    const ENV: Record<string, string> = { FEL_DIGIFACT_TEST: "habilitado", FEL_DIGIFACT_TEST_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: "USUARIO_TEST", DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: "5888492",
      FEL_DIGIFACT_TEST_EMISOR: JSON.stringify(DATOS), FEL_DIGIFACT_TEST_HUELLA: await huellaEmisor(DATOS),
      FEL_DIGIFACT_CORREO: "habilitado", FEL_DIGIFACT_CORREO_EMPRESA: EMPRESA, FEL_DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, @pruebas.example.org` };
    let adelantoMin = 0;   // reloj del servicio (solo en la prueba): permite vencer una preparación sin esperar
    const dg = await crearDigifactParaBd((k) => ENV[k], bd, fetchImpl, () => new Date(Date.now() + adelantoMin * 60_000)); assert.ok(dg.servicio, dg.motivo); assert.equal(dg.almacenPersistente, true, "con la migración 29 el almacén es PERSISTENTE (PostgreSQL)");
    const svc = dg.servicio!; const autorizar = (ref: string | null) => { if (ref) ENV.FEL_DIGIFACT_AUTORIZA_REFERENCIA = ref; else delete ENV.FEL_DIGIFACT_AUTORIZA_REFERENCIA; };   // equivale a publicar con la referencia autorizada
    const pol = crearPoliticaCorreoDigifactDesdeEntorno((k) => ENV[k]);
    const api = crearApi(bd, mundo, { sesiones, practico: true, digifact: svc, digifactCorreo: pol.politica });
    class Cli { cookie = ""; constructor(public usuario: string) {}
      async crudo(m: string, ruta: string, cuerpo?: unknown) { const r = await api(new Request("http://127.0.0.1" + ruta, { method: m, headers: { "x-demo": "1", "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })); const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]; return r; }
      async llamar(m: string, ruta: string, cuerpo?: unknown) { const r = await this.crudo(m, ruta, cuerpo); const t = await r.text(); salida.push(t); let json: J = {}; try { json = JSON.parse(t); } catch { /* sin cuerpo */ } return { status: r.status, json, texto: t }; }
      async entrar() { assert.equal((await this.llamar("POST", "/api/sesion/entrar", { usuario: this.usuario, clave: CLAVE_DEMO })).status, 200, `login ${this.usuario}`); return this; } }
    const R = (id: string, x: string) => `/api/documentos/${id}/digifact${x}`;

    // ===== 1. iniciar sesión · 2. seleccionar el cliente (Consumidor Final) · 3. agregar el servicio · 4. revisar
    const ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar(), pedro = await new Cli("pedro").entrar();
    assert.equal((await ana.llamar("GET", "/api/digifact/estado")).json.almacenamiento, "persistente", "la interfaz recibe el estado REAL del almacenamiento"); assert.equal((await ana.llamar("GET", "/api/digifact/estado")).json.certificacion, true); assert.equal((await ana.llamar("GET", "/api/digifact/estado")).json.correoDigifact.habilitado, true);
    const est = (await ana.llamar("GET", "/api/estado")).json, cf = est.clientes.find((c: J) => c.tipo_identificacion === "CF"), establecimiento = est.establecimientos[0];
    const crear = async (precio = "112") => { const d = await ana.llamar("POST", "/api/documentos", { cliente_id: cf.id, establecimiento_id: establecimiento.id, lineas: [{ descripcion: "Servicio de prueba NEXA FEL (TEST)", cantidad: "1", precio_unitario: precio }], fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()) });
      assert.equal(d.status, 200, d.texto); const r = await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/estado`, { estado: "revisado", version: d.json.documento.version }); assert.equal(r.status, 200, r.texto); return d.json.documento.id as string; };
    const id = await crear();
    assert.equal((await ana.llamar("GET", `/api/documentos/${id}`)).json.documento.estado_fiscal, "ninguno", "antes de certificar: sin estado fiscal");

    // ===== 5. solicitar la certificación (Digifact TEST) — validar y preparar NO envían nada
    const v = await ana.llamar("POST", R(id, "/validar"), { enviar_correo: true, correo: DEST }); assert.equal(v.status, 200); assert.equal(v.json.ok, true);
    const p = (await ana.llamar("POST", R(id, "/preparar"), { enviar_correo: true, correo: DEST })).json; assert.equal(nucs.length, 0, "preparar no envía nada"); assert.match(p.referencia, /^[0-9a-f-]{36}$/); assert.match(p.correoRef, /^[0-9a-f]{16}$/);
    // sin autorización expresa de la referencia, NO se certifica (la certificación hospedada sigue bloqueada)
    const cuerpo = { operacionId: p.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p.referencia, huellaEmisor: p.huellaEmisor, enviar_correo: true, correo: DEST, correo_ref: p.correoRef };
    const sinAut = await ana.llamar("POST", R(id, "/certificar"), cuerpo); assert.equal(sinAut.status, 403); assert.equal(sinAut.json.codigo, "prueba_no_autorizada"); assert.equal(nucs.length, 0, "sin autorización expresa no sale nada");
    // el lector y otra empresa no pueden certificar
    assert.equal((await pedro.llamar("POST", R(id, "/certificar"), cuerpo)).status, 403, "el lector no certifica"); assert.ok([403, 404].includes((await sofia.llamar("POST", R(id, "/certificar"), cuerpo)).status), "otra empresa no certifica");
    // confirmaciones: texto, referencia y huella exactos
    autorizar(p.referencia);
    for (const [campo, valor] of [["confirmacion", "certificar"], ["referencia", "00000000-0000-5000-8000-000000000001"], ["huellaEmisor", "ffffffffffffffff"]] as const) { const r = await ana.llamar("POST", R(id, "/certificar"), { ...cuerpo, [campo]: valor }); assert.equal(r.status, 400, campo); }
    assert.equal(nucs.length, 0);

    // ===== 6. certificar UNA vez: UUID, serie, número, XML y PDF · 7. estado fiscal del documento
    const c = await ana.llamar("POST", R(id, "/certificar"), cuerpo); assert.equal(c.status, 200, c.texto);
    assert.equal(c.json.operacion.estado, "certificada"); assert.equal(c.json.aplicacion, "aplicada"); assert.equal(c.json.artefactos, "guardados"); assert.equal(nucs.length, 1, "UN solo envío a Digifact");
    assert.deepEqual(nucs[0].Buyer.Contact, { EmailList: { Email: [DEST] } }, "el correo viaja solo en Buyer.Contact.EmailList");
    const doc = (await ana.llamar("GET", `/api/documentos/${id}`)).json.documento;
    assert.deepEqual([doc.estado_fiscal, doc.serie, doc.numero_fiscal, doc.autorizacion_sat], ["certificado", "A7220268", "198134837", AUT1], "el documento quedó certificado con los datos del certificador");
    // ===== 8. consultar y descargar la factura certificada (XML y PDF reales, con su SHA-256)
    const ops = (await ana.llamar("GET", R(id, ""))).json.operaciones; assert.equal(ops.length, 1); assert.deepEqual([ops[0].estado, ops[0].resultado.autorizacion, ops[0].resultado.serie, ops[0].resultado.numero], ["certificada", AUT1, "A7220268", "198134837"]);
    for (const [tipo, esperado] of [["xml", XML(AUT1)], ["pdf", PDF]] as const) {
      const r = await ana.crudo("GET", R(id, `/${tipo}`)); assert.equal(r.status, 200, tipo); const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(new TextDecoder().decode(bytes), esperado, `${tipo}: es el archivo que entregó Digifact`); assert.equal(r.headers.get("x-nexa-sha256"), await sha(esperado), `${tipo}: SHA-256`); assert.match(r.headers.get("content-disposition") ?? "", /attachment/); assert.equal(r.headers.get("cache-control"), "no-store");
    }
    const filas = await bd.filas<{ tipo: string; sha256: string; n: number }>("select tipo, sha256, tamano as n from public.digifact_artefactos where documento_id = $1 order by tipo", [id]); assert.deepEqual(filas.map((f) => f.tipo), ["pdf", "xml"]);
    assert.equal(filas.find((f) => f.tipo === "xml")!.sha256, await sha(XML(AUT1)), "la base guardó el XML con su SHA-256");
    const xs = await sofia.crudo("GET", R(id, "/xml")), ps = await sofia.crudo("GET", R(id, "/pdf")); await xs.body?.cancel(); await ps.body?.cancel();
    assert.ok(xs.status !== 200 && ps.status !== 200, `OTRA EMPRESA no debe descargar el XML ni el PDF (XML ${xs.status}, PDF ${ps.status})`);
    assert.equal((await sofia.llamar("GET", `/api/documentos/${id}`)).status, 404, "otra empresa no ve el documento"); assert.equal((await sofia.llamar("GET", R(id, ""))).status === 200 && (await sofia.llamar("GET", R(id, ""))).json.operaciones?.length > 0, false, "otra empresa no ve las operaciones");
    const xl = await pedro.crudo("GET", R(id, "/xml")); const rolLector = xl.status; await xl.body?.cancel(); console.log(`  (informativo) el lector de la MISMA empresa recibe ${rolLector} al descargar el XML`);
    // ===== 9. el correo: «solicitado», nunca «entregado»
    const cs = (await ana.llamar("GET", R(id, "/correo"))).json; assert.deepEqual([cs.solicitado, cs.destinatario, cs.entrega], [true, "p***@ejemplo.com", "sin_confirmacion"]);

    // ===== duplicados: repetir NO vuelve a enviar (ni a pedir el correo) · el documento certificado queda protegido
    const rep = await ana.llamar("POST", R(id, "/certificar"), cuerpo); assert.equal(rep.json.reutilizada, true); assert.equal(nucs.length, 1);
    assert.notEqual((await ana.llamar("POST", R(id, "/preparar"), {})).status, 200, "no se prepara otra certificación de un documento ya certificado");
    assert.notEqual((await ana.llamar("POST", `/api/documentos/${id}/reabrir`, { version: doc.version })).status, 200, "un documento certificado no se reabre");
    assert.notEqual((await ana.llamar("POST", `/api/documentos/${id}/estado`, { estado: "borrador", version: doc.version })).status, 200, "ni vuelve a borrador");
    await assert.rejects(() => bd.filas("update public.documentos set serie = 'ZZ' where id = $1", [id]), /inmutables|FEL_REGLA/, "serie inmutable");
    await assert.rejects(() => bd.filas("delete from public.digifact_operaciones where documento_id = $1", [id]), /no se borran/, "las operaciones no se borran");

    // ===== resultado DESCONOCIDO: nunca se reenvía; se concilia por la referencia
    modo = "corte"; autorizacion = AUT2; const id2 = await crear("224"); const p2 = (await ana.llamar("POST", R(id2, "/preparar"), {})).json; autorizar(p2.referencia);
    const c2 = await ana.llamar("POST", R(id2, "/certificar"), { operacionId: p2.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p2.referencia, huellaEmisor: p2.huellaEmisor });
    assert.equal(c2.status, 200); assert.equal(c2.json.operacion.estado, "desconocida"); assert.equal(nucs.length, 2); modo = "exito";
    for (let i = 0; i < 3; i++) { const r = await ana.llamar("POST", R(id2, "/certificar"), { operacionId: p2.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p2.referencia, huellaEmisor: p2.huellaEmisor }); assert.equal(r.json.reutilizada, true); }
    assert.notEqual((await ana.llamar("POST", R(id2, "/preparar"), {})).status, 200, "con una operación desconocida no se prepara otra"); assert.equal(nucs.length, 2, "tras el resultado desconocido NO se reenvió nada");
    assert.equal((await ana.llamar("GET", `/api/documentos/${id2}`)).json.documento.estado_fiscal, "ninguno", "hasta conciliar, el documento no se toca");
    const con = await ana.llamar("POST", R(id2, "/conciliar"), { operacionId: p2.operacionId }); assert.equal(con.status, 200, con.texto); assert.equal(con.json.resultado, "certificada"); assert.equal(nucs.length, 2);
    assert.deepEqual((({ estado_fiscal, serie, numero_fiscal, autorizacion_sat }) => [estado_fiscal, serie, numero_fiscal, autorizacion_sat])((await ana.llamar("GET", `/api/documentos/${id2}`)).json.documento), ["certificado", "A7220268", "198134837", AUT2]);

    // ===== destinatarios restringidos y nada sensible en las respuestas
    const id3 = await crear(); const p3 = (await ana.llamar("POST", R(id3, "/preparar"), {})).json;
    const ajeno = await ana.llamar("POST", R(id3, "/preparar"), { enviar_correo: true, correo: "cliente@dominio-externo.com" }); assert.equal(ajeno.status, 403); assert.equal(ajeno.json.codigo, "destinatario_no_autorizado"); assert.equal(nucs.length, 2);
    assert.ok(p3.operacionId); const todo = salida.join("\n"); assert.ok(!todo.includes(CLAVE) && !todo.includes("firma-secreta-del-token") && !todo.includes(DEST), "ni credenciales, ni tokens, ni el correo completo en ninguna respuesta");

    // ===== RENOVACIÓN segura de una preparación vencida (misma operación y referencia; no autoriza; acotada; el resultado incierto sigue bloqueando)
    const ops4 = (d: string) => bd.filas<{ id: string; estado: string; referencia: string; hash: string; creada_ms: string; renovaciones: number }>("select id, estado, referencia, hash, creada_ms, renovaciones from public.digifact_operaciones where documento_id = $1 order by creada_ms, id", [d]);
    autorizacion = AUT3; adelantoMin = 0; const id4 = await crear("336"); const p4 = (await ana.llamar("POST", R(id4, "/preparar"), {})).json; const antes4 = (await ops4(id4))[0]; assert.equal(p4.renovada, false);
    const cuerpo4 = { operacionId: p4.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p4.referencia, huellaEmisor: p4.huellaEmisor };
    autorizar(p4.referencia); adelantoMin = 31; const enviosAntes = nucs.length;
    const venc = await ana.llamar("POST", R(id4, "/certificar"), cuerpo4); assert.equal(venc.status, 409, "vencida: no se certifica"); assert.equal(nucs.length, enviosAntes);
    const renov = (await ana.llamar("POST", R(id4, "/preparar"), {})).json;
    assert.deepEqual([renov.operacionId, renov.referencia, renov.huellaEmisor, renov.renovada, renov.renovaciones], [p4.operacionId, p4.referencia, p4.huellaEmisor, true, 1], "la MISMA operación, renovada");
    { const o = await ops4(id4); assert.equal(o.length, 1, "no hay una segunda operación"); assert.deepEqual([o[0].id, o[0].referencia, o[0].hash, o[0].creada_ms, o[0].estado, o[0].renovaciones], [antes4.id, antes4.referencia, antes4.hash, antes4.creada_ms, "preparada", 1], "identidad intacta"); }
    // renovar no autoriza: con la referencia autorizada de OTRA operación, no sale nada
    autorizar(p3.referencia); const noAut = await ana.llamar("POST", R(id4, "/certificar"), cuerpo4); assert.equal(noAut.status, 403); assert.equal(noAut.json.codigo, "prueba_no_autorizada"); assert.equal(nucs.length, enviosAntes, "renovar no autoriza nada");
    // sin renovaciones infinitas: 3 como máximo; la 4.ª vez la preparación se DESCARTA (nunca se envió) y nace otra con referencia nueva
    for (const n of [2, 3]) { adelantoMin += 31; const r = (await ana.llamar("POST", R(id4, "/preparar"), {})).json; assert.deepEqual([r.operacionId, r.renovaciones], [p4.operacionId, n]); }
    adelantoMin += 31; const nueva4 = (await ana.llamar("POST", R(id4, "/preparar"), {})).json; assert.notEqual(nueva4.operacionId, p4.operacionId); assert.notEqual(nueva4.referencia, p4.referencia, "referencia nueva (otro intento)");
    { const o = await ops4(id4); assert.deepEqual(o.map((x) => x.estado), ["no_enviada", "preparada"]); assert.equal(o[0].id, p4.operacionId); } assert.equal(nucs.length, enviosAntes, "descartar una preparación no envía nada");
    // la nueva se certifica UNA vez (la renovación y el descarte no cambiaron ninguna garantía)
    autorizar(nueva4.referencia);   // el reloj solo avanza (la base no admite fechas de actualización que retrocedan)
    const c4 = await ana.llamar("POST", R(id4, "/certificar"), { operacionId: nueva4.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: nueva4.referencia, huellaEmisor: nueva4.huellaEmisor });
    assert.equal(c4.status, 200, c4.texto); assert.equal(c4.json.operacion.estado, "certificada"); assert.equal(nucs.length, enviosAntes + 1, "UN solo envío");
    assert.equal((await ana.llamar("POST", R(id4, "/certificar"), { operacionId: nueva4.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: nueva4.referencia, huellaEmisor: nueva4.huellaEmisor })).json.reutilizada, true); assert.equal(nucs.length, enviosAntes + 1);
    // un resultado INCIERTO sigue bloqueando aunque pase el tiempo: no se renueva ni se reemplaza
    modo = "corte"; autorizacion = "5E1A7C30-9D42-4B8F-A6C3-71F0B2D94E15"; const id5 = await crear("448"); const p5 = (await ana.llamar("POST", R(id5, "/preparar"), {})).json; autorizar(p5.referencia);
    assert.equal((await ana.llamar("POST", R(id5, "/certificar"), { operacionId: p5.operacionId, confirmacion: "CERTIFICAR-TEST", referencia: p5.referencia, huellaEmisor: p5.huellaEmisor })).json.operacion.estado, "desconocida"); modo = "exito";
    const envios5 = nucs.length; adelantoMin += 120; const r5 = await ana.llamar("POST", R(id5, "/preparar"), {}); assert.notEqual(r5.status, 200, "con un resultado incierto no se renueva ni se prepara otra");
    { const o = await ops4(id5); assert.equal(o.length, 1); assert.deepEqual([o[0].estado, o[0].renovaciones], ["desconocida", 0]); } assert.equal(nucs.length, envios5, "y no se reenvió nada");

    // ===== AUDITORÍA JSON: todo evento (Digifact, receptor, correo) es un OBJETO jsonb, nunca una cadena (el defecto solo aparece con PostgreSQL real)
    assert.deepEqual(await bd.filas("select accion, jsonb_typeof(datos) as tipo from public.auditoria where jsonb_typeof(datos) is distinct from 'object'"), [], "ninguna auditoría quedó guardada como cadena JSON");
    assert.ok((await bd.filas("select 1 from public.auditoria where accion = 'digifact_test.preparada_renovada' and jsonb_typeof(datos) = 'object' and datos ->> 'operacion' is not null")).length >= 1, "la renovación quedó auditada como objeto");
    assert.ok((await bd.filas("select 1 from public.auditoria where accion = 'digifact_test.preparada_descartada' and (datos ->> 'enviada') = 'false'")).length >= 1, "el descarte quedó auditado (enviada=false)");
    // compatibilidad de LECTURA con registros antiguos guardados como cadena JSON (el defecto anterior): la API sigue entregando el destinatario enmascarado
    { const idv = await crear("560"); await bd.filas("select public.fel_auditar($1, $2, 'digifact_test.correo_solicitado', 'documento', $3, $4::jsonb)", [EMPRESA, "30000000-0000-0000-0000-000000000001", idv, JSON.stringify({ destinatario: "v***@ejemplo.com" })]);
      assert.equal((await bd.filas<{ t: string }>("select jsonb_typeof(datos) as t from public.auditoria where entidad_id = $1 and accion = 'digifact_test.correo_solicitado'", [idv]))[0].t, "string", "(precondición) el registro antiguo es una cadena JSON");
      { const rv = await ana.llamar("GET", R(idv, "/correo")); assert.equal(rv.json.destinatario, "v***@ejemplo.com", `un registro antiguo (cadena JSON) se sigue leyendo: ${rv.texto}`); } }
    const aud = JSON.stringify(await bd.filas("select accion, datos from public.auditoria where accion like 'digifact_test.%'")); assert.ok(!aud.includes(DEST) && !aud.includes(CLAVE), "la auditoría no guarda el correo completo ni credenciales"); assert.ok(!/entregad/i.test(aud));
  } finally { await bd.cerrar(); await pg.limpiar(); }
} });
