// ALMACÉN PERSISTENTE DE DIGIFACT (propuesta de migración 29) contra PostgreSQL REAL: exclusión mutua, compare-and-set, concurrencia, aislamiento por empresa y garantías propias de la base.
// Solo con FEL_TEST_PG_ADMIN (ver tools/test-demo-pg.sh). Aplica docs/migracion-29/*.sql sobre una copia de la plantilla (migraciones 1–28); no toca ninguna base hospedada.
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.5";
import { AlmacenGtPg } from "../../proveedores/src/almacen_gt_pg.ts";
import { CONFIRMACION_TEST, ErrorFelGt, ServicioFelGt, type DocumentoFel, type OperacionGt } from "../../proveedores/src/felgt_servicio.ts";
import { DigifactGt } from "../../proveedores/src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../../proveedores/src/digifact.ts";
import { facturaPrueba } from "../../proveedores/pruebas/digifact_gt_fixture.ts";

const admin = Deno.env.get("FEL_TEST_PG_ADMIN");
const SQL29 = new URL("../../docs/migracion-29/20261114000100_fel_digifact_operaciones.sql", import.meta.url);
const A = "10000000-0000-0000-0000-0000000000a1", B = "10000000-0000-0000-0000-0000000000b2", ACTOR = "30000000-0000-0000-0000-000000000001";
const docId = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const uuid = () => crypto.randomUUID();

async function entorno() {
  const nombre = `dg_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`, ad = postgres(admin!, { max: 1, onnotice: () => {} });
  await ad.unsafe(`create database ${nombre} template nexa_plantilla`); await ad.end();
  const u = new URL(admin!); u.pathname = `/${nombre}`; const sql = postgres(u.toString(), { max: 12, onnotice: () => {} });
  await sql.unsafe(await Deno.readTextFile(SQL29));
  for (const [e, nit, nom] of [[A, "1234567-8", "Empresa A"], [B, "7654321-0", "Empresa B"]]) await sql.unsafe(`insert into public.empresas (id, nombre_comercial, razon_social, nit, regimen_id) select '${e}', '${nom}', '${nom} S.A.', '${nit}', id from public.regimenes_fiscales where codigo = 'general'`);
  await sql.unsafe(`insert into auth.users (id, email, email_confirmed_at) values ('${ACTOR}', 'actor@prueba.local', now()) on conflict (id) do nothing`);   // la persona que certifica existe en Auth (el documento registra quién actualizó)
  for (let i = 1; i <= 40; i++) await sql.unsafe(`insert into public.documentos (id, empresa_id, numero_borrador) values ('${docId(i)}', '${A}', ${i})`);
  await sql.unsafe(`insert into public.documentos (id, empresa_id, numero_borrador) values ('${docId(900)}', '${B}', 1)`);
  const filas = async <T,>(q: string, ps: unknown[] = []) => [...await sql.unsafe(q, ps as never[])] as unknown as T[];
  return { sql, filas, almacen: new AlmacenGtPg(filas), limpiar: async () => { await sql.end(); const s = postgres(admin!, { max: 1, onnotice: () => {} }); try { await s.unsafe(`drop database if exists ${nombre} with (force)`); } finally { await s.end(); } } };
}
const op = (documentoId: string, extra: Partial<OperacionGt> = {}, empresaId = A): OperacionGt => ({ id: uuid(), empresaId, documentoId, referencia: uuid(), hash: "a".repeat(64), huellaEmisor: "0123456789abcdef", fechaEmision: "2026-11-16", establecimiento: 1, total: "112.00",
  estado: "preparada", creada: Date.now(), actualizada: Date.now(), actorId: ACTOR, intentoDelDocumento: 1, intentosConciliacion: 0, ...extra });
const falla = async (f: () => Promise<unknown>, patron: RegExp, msg: string) => { let e: unknown; try { await f(); } catch (x) { e = x; } assert.ok(e, `${msg}: debía fallar`); assert.match(String((e as Error).message ?? e), patron, msg); };

Deno.test({ name: "almacén persistente de Digifact (PostgreSQL real): contrato, exclusión mutua, concurrencia, aislamiento y garantías de la base", ignore: !admin, sanitizeOps: false, sanitizeResources: false, async fn() {
  const t = await entorno();
  try {
    const { almacen: al, sql } = t;
    assert.equal(al.persistente, true);
    // crear: idempotente por referencia mientras está «preparada»
    const p1 = op(docId(1)); const c1 = await al.crear(p1); assert.equal(c1.creada, true); assert.deepEqual({ ...c1.op }, { ...p1 });
    const c1b = await al.crear({ ...p1, id: uuid() }); assert.equal(c1b.creada, false); assert.equal(c1b.op.id, p1.id, "la misma referencia preparada devuelve la existente");
    const p1c = await al.crear(op(docId(1))); assert.equal(p1c.creada, true, "otra referencia (cambió el documento) se prepara aparte mientras no haya una que bloquee");
    // compare-and-set y exclusión mutua
    const env = await al.transicion(A, p1.id, ["preparada"], { estado: "enviando", actualizada: Date.now() }); assert.equal(env?.estado, "enviando");
    assert.equal(await al.transicion(A, p1.id, ["preparada"], { estado: "enviando" }), null, "el segundo intento pierde (compare-and-set)");
    const durante = await al.crear(op(docId(1))); assert.equal(durante.creada, false); assert.equal(durante.op.id, p1.id, "con una operación «enviando» no se crea otra para el mismo documento");
    // resultado certificado: la autorización sale del certificador y queda inmutable
    const cert = await al.transicion(A, p1.id, ["enviando"], { estado: "certificada", actualizada: Date.now(), resultado: { autorizacion: "UUID-REAL-0001", serie: "AB12CD34", numero: "1234567", fechaCertificacion: "2026-11-16T10:00:00Z" } });
    assert.equal(cert?.estado, "certificada"); assert.equal(cert?.resultado?.autorizacion, "UUID-REAL-0001");
    assert.equal((await al.obtener(A, p1.id))?.resultado?.serie, "AB12CD34", "sobrevive: se relee de la base");
    await falla(() => sql.unsafe(`update public.digifact_operaciones set resultado = '{"autorizacion":"OTRA"}' where id = '${p1.id}'`), /FEL_DIGIFACT/, "el resultado certificado no cambia");
    await falla(() => sql.unsafe(`update public.digifact_operaciones set estado = 'enviando' where id = '${p1.id}'`), /transición de estado no permitida/, "una certificada no vuelve a enviarse");
    await falla(() => sql.unsafe(`delete from public.digifact_operaciones where id = '${p1.id}'`), /no se borran/, "no se borran operaciones");
    await falla(() => sql.unsafe(`update public.digifact_operaciones set hash = '${"b".repeat(64)}' where id = '${p1.id}'`), /identidad de la operación/, "la identidad no cambia");
    // la misma autorización no se repite dentro de la empresa (otra empresa sí podría tenerla: es un identificador del certificador)
    const q = await al.crear(op(docId(2))); await al.transicion(A, q.op.id, ["preparada"], { estado: "enviando" });
    await falla(() => al.transicion(A, q.op.id, ["enviando"], { estado: "certificada", resultado: { autorizacion: "UUID-REAL-0001" } }), /duplicate key|digifact_op_autorizacion_uq/, "autorización repetida en la empresa");
    // desconocida → conciliar (cuenta intentos) → certificada
    const d = await al.crear(op(docId(3))); await al.transicion(A, d.op.id, ["preparada"], { estado: "enviando" });
    const desc = await al.transicion(A, d.op.id, ["enviando"], { estado: "desconocida", resultado: { motivoDesconocido: "timeout" } }); assert.equal(desc?.estado, "desconocida");
    const otraMientras = await al.crear(op(docId(3))); assert.equal(otraMientras.creada, false, "una operación desconocida bloquea un segundo envío (no duplica tras un timeout)");
    assert.equal((await al.transicion(A, d.op.id, ["desconocida"], { intentosConciliacion: 1, actualizada: Date.now() }))?.intentosConciliacion, 1);
    assert.equal((await al.transicion(A, d.op.id, ["desconocida"], { estado: "certificada", resultado: { autorizacion: "UUID-REAL-0003", serie: "S", numero: "3" } }))?.estado, "certificada");
    // rechazada y no_enviada son finales
    const r = await al.crear(op(docId(4))); await al.transicion(A, r.op.id, ["preparada"], { estado: "enviando" }); await al.transicion(A, r.op.id, ["enviando"], { estado: "rechazada", resultado: { codigo: "X", mensaje: "no" } });
    await falla(() => sql.unsafe(`update public.digifact_operaciones set estado = 'enviando' where id = '${r.op.id}'`), /transición de estado no permitida/, "una rechazada es final");
    assert.equal((await al.crear(op(docId(4)))).creada, true, "tras un rechazo confirmado se puede preparar de nuevo (nueva referencia)");
    // aislamiento por empresa
    assert.equal(await al.obtener(B, p1.id), null); assert.deepEqual(await al.deDocumento(B, docId(1)), []); assert.equal(await al.transicion(B, p1.id, ["certificada"], { actualizada: Date.now() }), null);
    await falla(() => al.crear(op(docId(1), {}, B)), /foreign key|violates/, "una operación de la empresa B no puede apuntar al documento de la A");
    const ob = await al.crear(op(docId(900), {}, B)); assert.equal(ob.creada, true);
    // CONCURRENCIA real: 25 envíos simultáneos de la misma operación → exactamente uno gana; 25 «preparar» del mismo documento con la misma referencia → una sola operación
    const base = await al.crear(op(docId(5))); const ganadores = (await Promise.all(Array.from({ length: 25 }, () => al.transicion(A, base.op.id, ["preparada"], { estado: "enviando", actualizada: Date.now() })))).filter(Boolean);
    assert.equal(ganadores.length, 1, "solo un proceso pasa de «preparada» a «enviando»");
    const ref = uuid(); const todas = await Promise.all(Array.from({ length: 25 }, () => al.crear(op(docId(6), { referencia: ref })))); assert.equal(todas.filter((x) => x.creada).length, 1); assert.equal(new Set(todas.map((x) => x.op.id)).size, 1, "todas devuelven la misma operación");
    const bloqueo = await al.crear(op(docId(7))); await al.transicion(A, bloqueo.op.id, ["preparada"], { estado: "enviando" });
    const carrera = await Promise.all(Array.from({ length: 25 }, () => al.crear(op(docId(7))))); assert.equal(carrera.filter((x) => x.creada).length, 0, "con una operación enviando ninguna creación concurrente prospera");
    assert.equal(Number((await t.filas<{ n: string }>(`select count(*)::text as n from public.digifact_operaciones where documento_id = '${docId(7)}' and estado in ('enviando','certificada','desconocida')`))[0].n), 1);
    // privilegios: solo el rol propietario de la base
    for (const rol of ["anon", "authenticated", "service_role"]) {
      const f = (await t.filas<{ p: boolean }>(`select has_table_privilege('${rol}', 'public.digifact_operaciones', 'select,insert,update,delete') as p`))[0].p; assert.equal(f, false, `${rol} sin privilegios`);
    }
    assert.equal((await t.filas<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid = 'public.digifact_operaciones'::regclass`))[0].r, true, "RLS activo");
  } finally { await t.limpiar(); }
} });

// ---------------------------------------------------------------- servicio completo sobre la base REAL: la certificación del certificador llega al documento, los archivos reales se guardan y todo es idempotente y aislado
const AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", AUT2 = "11111111-2222-4333-8444-555555555555";
const XML = (a: string) => `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento><dte:NumeroAutorizacion Numero="5" Serie="A001">${a}</dte:NumeroAutorizacion></dte:GTDocumento>`, PDF = "%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n";
const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown): RespuestaHttp => ({ estado: 200, cuerpo: JSON.stringify(o) });
const ctxDe = (empresaId: string, permisos = ["borradores.ver", "fiscal.ver", "fiscal.certificar"]) => ({ empresaId, actorId: ACTOR, permisos });
const docFel = (empresaId: string, id: string): DocumentoFel => ({ id, empresaId, estadoPreparacion: "revisado", estadoFiscal: "ninguno", receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" },
  lineas: [{ tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL", cantidad: "1", precioUnitario: "100", descuento: "0", unidad: "SER" }] });

Deno.test({ name: "servicio de Digifact sobre PostgreSQL real: certificación aplicada al documento, XML/PDF reales, idempotencia, timeouts, duplicados y aislamiento", ignore: !admin, sanitizeOps: false, sanitizeResources: false, async fn() {
  const t = await entorno();
  try {
    await t.sql.unsafe(`update public.documentos set estado_preparacion = 'revisado' where id in ('${docId(10)}','${docId(11)}','${docId(12)}','${docId(13)}','${docId(900)}')`);
    let envios = 0, autorizacion = AUT, modo: "exito" | "corte" = "exito", ultimaRef = ""; const aud: string[] = [], det: string[] = [];
    const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
      if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
      if (p.ruta.startsWith("/v2/transform/nuc_json")) {
        envios++; ultimaRef = JSON.parse(p.cuerpo!).AdditionalDocumentInfo.AdditionalInfo[0].Code;
        if (modo === "corte") throw new Error("corte de red");
        return ok({ code: "1", message: "Procesado Correctamente", authNumber: autorizacion, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: btoa(XML(autorizacion)), responseData3: btoa(PDF) });
      }
      if (p.ruta.startsWith("/Shared")) return ok({ REQUEST_DATA: [{ Respuesta: "1" }], RESPONSE: [{ GUID: autorizacion, SERIE: "A001", NUMERO: "5", TIPO_DTE: "FACT", FECHA_DE_CERTIFICACION: "2026-11-16T10:00:05", REFERENCIA_INTERNA: ultimaRef, ESTADO_ACUSE: "ACEPTADO_SAT", ANULADO: "0", TOTAL: "100.00", NE: "2", NOMBRE: "X" }] });
      return ok({});
    };
    const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => "CLAVE-INVENTADA-PARA-PRUEBAS-9", transporte });
    let autorizada: string | null = null;
    const svc = new ServicioFelGt({ clienteDe: () => cliente, emisorDe: () => ({ emisor: facturaPrueba().emisor, huella: "0123456789abcdef" }), almacen: t.almacen, autorizaPrueba: () => autorizada, auditar: (e, _c, d) => { aud.push(e); det.push(`${e}:${d.motivo ?? ""}`); } });
    const certificar = async (id: string, empresa = A) => { const p = await svc.preparar(ctxDe(empresa), docFel(empresa, id)); autorizada = p.referencia; return { p, r: await svc.certificar(ctxDe(empresa), docFel(empresa, id), { operacionId: p.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p.referencia, huellaEmisor: p.huellaEmisor }) }; };
    const fiscal = async (id: string) => (await t.filas<Record<string, string | null>>(`select estado_fiscal, serie, numero_fiscal, autorizacion_sat, certificacion_verificada_en::text as verif from public.documentos where id = '${id}'`))[0];

    // 1. éxito: el documento queda certificado con los datos del certificador, y los archivos reales se guardan
    assert.equal((await fiscal(docId(10))).estado_fiscal, "ninguno");
    const { p, r } = await certificar(docId(10));
    assert.equal(r.operacion.estado, "certificada"); assert.equal((r as { aplicacion?: string }).aplicacion, "aplicada", det.join(" | ")); assert.equal((r as { artefactos?: string }).artefactos, "guardados");
    const f = await fiscal(docId(10)); assert.deepEqual([f.estado_fiscal, f.serie, f.numero_fiscal, f.autorizacion_sat], ["certificado", "A001", "5", AUT]); assert.ok(f.verif, "fecha de verificación registrada");
    assert.equal(Number((await t.filas<{ n: string }>(`select count(*)::text as n from public.documento_estados where documento_id = '${docId(10)}' and eje = 'fiscal' and nuevo = 'certificado'`))[0].n), 1, "queda historial de estados");
    // 2. inmutabilidad del documento certificado (las reglas existentes del documento siguen vigentes)
    await falla(() => t.sql.unsafe(`update public.documentos set serie = 'ZZ' where id = '${docId(10)}'`), /inmutables|FEL_REGLA/, "serie inmutable");
    await falla(() => t.sql.unsafe(`update public.documentos set observaciones = 'x' where id = '${docId(10)}'`), /inmutable|FEL_REGLA/, "contenido inmutable");
    // 3. idempotencia: repetir no reenvía ni cambia nada
    const rep = await svc.certificar(ctxDe(A), docFel(A, docId(10)), { operacionId: p.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p.referencia, huellaEmisor: p.huellaEmisor });
    assert.equal(rep.reutilizada, true); assert.equal((rep as { aplicacion?: string }).aplicacion, "ya_aplicada"); assert.equal(envios, 1);
    // 4. archivos reales guardados y descargables solo por su empresa
    const x = await svc.descargar(ctxDe(A), docId(10), "xml"), pd = await svc.descargar(ctxDe(A), docId(10), "pdf");
    assert.equal(new TextDecoder().decode(x.contenido), XML(AUT)); assert.equal(new TextDecoder().decode(pd.contenido), PDF);
    assert.equal(Number((await t.filas<{ n: string }>(`select count(*)::text as n from public.digifact_artefactos where documento_id = '${docId(10)}'`))[0].n), 2);
    await falla(() => svc.descargar(ctxDe(B), docId(10), "xml"), /no tiene una certificación/, "otra empresa no descarga");
    await falla(() => t.sql.unsafe(`update public.digifact_artefactos set nombre = 'otro.xml' where documento_id = '${docId(10)}'`), /solo inserción|FEL_APPEND_ONLY/, "artefactos de solo inserción");
    await falla(() => t.sql.unsafe(`delete from public.digifact_artefactos where documento_id = '${docId(10)}'`), /solo inserción|FEL_APPEND_ONLY/, "no se borran artefactos");
    // 5. la MISMA autorización del certificador en OTRO documento de la empresa: el documento salió pero el resultado no se puede registrar ⇒ «desconocida» (bloquea otro envío), el documento NO se toca y queda para revisión manual
    const dup = await certificar(docId(11));
    assert.equal(dup.r.operacion.estado, "desconocida"); assert.equal(dup.r.operacion.resultado?.motivoDesconocido, "resultado_no_registrable"); assert.equal((await fiscal(docId(11))).estado_fiscal, "ninguno"); assert.ok(aud.includes("digifact_test.resultado_no_registrable"));
    await falla(() => svc.preparar(ctxDe(A), docFel(A, docId(11))), /operación|Este documento/, "no se prepara otro envío");
    // 6. timeout: el documento no se toca hasta conciliar; conciliar aplica los datos de Digifact; sin segundo envío
    autorizacion = AUT2; modo = "corte"; const antes = envios;
    const inc = await certificar(docId(12)); assert.equal(inc.r.operacion.estado, "desconocida"); assert.equal((await fiscal(docId(12))).estado_fiscal, "ninguno");
    await falla(() => svc.preparar(ctxDe(A), docFel(A, docId(12))), /operación|Este documento/, "una operación desconocida bloquea un segundo envío");
    modo = "exito"; const c = await svc.conciliar(ctxDe(A), inc.p.operacionId); assert.equal(c.resultado, "certificada"); assert.equal((c as { aplicacion?: string }).aplicacion, "aplicada");
    const f12 = await fiscal(docId(12)); assert.deepEqual([f12.estado_fiscal, f12.autorizacion_sat], ["certificado", AUT2]); assert.equal(envios, antes + 1, "solo el envío original");
    // 7. aislamiento multiempresa de la función de aplicación: la empresa B no puede aplicar una operación de la A
    await falla(() => t.filas(`select public.fel_sys_digifact_aplicar($1::uuid, $2::uuid)`, [B, p.operacionId]), /no encontrada/, "otra empresa no aplica");
    // 8. una operación que no está certificada nunca se aplica
    autorizacion = "22222222-3333-4444-8555-666666666666"; const n = await svc.preparar(ctxDe(A), docFel(A, docId(13)));
    await falla(() => t.filas(`select public.fel_sys_digifact_aplicar($1::uuid, $2::uuid)`, [A, n.operacionId]), /no está certificada/, "solo certificadas");
    assert.equal((await fiscal(docId(13))).estado_fiscal, "ninguno");
    for (const rol of ["anon", "authenticated"]) assert.equal((await t.filas<{ p: boolean }>(`select has_function_privilege('${rol}', 'public.fel_sys_digifact_aplicar(uuid, uuid)', 'execute') as p`))[0].p, false, `${rol} no ejecuta la función`);
    assert.equal((await t.filas<{ p: boolean }>(`select has_table_privilege('service_role', 'public.digifact_artefactos', 'select') as p`))[0].p, false, "los bytes no se leen con la clave de servicio de la API");
    assert.ok(!(aud.join(",").includes("CLAVE-INVENTADA")), "ningún secreto en la auditoría");
    assert.ok(ErrorFelGt);
  } finally { await t.limpiar(); }
} });
