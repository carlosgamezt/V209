// ALMACÉN PERSISTENTE DE DIGIFACT (propuesta de migración 29) contra PostgreSQL REAL: exclusión mutua, compare-and-set, concurrencia, aislamiento por empresa y garantías propias de la base.
// Solo con FEL_TEST_PG_ADMIN (ver tools/test-demo-pg.sh). Aplica docs/migracion-29/*.sql sobre una copia de la plantilla (migraciones 1–28); no toca ninguna base hospedada.
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.5";
import { AlmacenGtPg } from "../../proveedores/src/almacen_gt_pg.ts";
import type { OperacionGt } from "../../proveedores/src/felgt_servicio.ts";

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
