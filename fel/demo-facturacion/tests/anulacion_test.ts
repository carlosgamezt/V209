// Anulación SIMULADA: confirmación reforzada y motivo obligatorios en el SERVIDOR, permisos, aislamiento entre empresas, marca «ANULADO» en el PDF y estados rechazada / pendiente.
// API real en el mismo proceso, PostgreSQL real en memoria, certificador SIMULADO; nada toca la red ni Digifact. La consulta de NIT/CUI y la certificación real no intervienen.
// Uso: deno test -A tests/anulacion_test.ts
import assert from "node:assert/strict";
import { montar, type J } from "./ayudas_receptor.ts";

type Cli = Awaited<ReturnType<Awaited<ReturnType<typeof montar>>["Cli"]["prototype"]["entrar"]>>;

async function documentoCertificado(ana: Cli, clave: string, escenario = "exito") {
  const est = (await ana.llamar("GET", "/api/estado")).json, cli = est.clientes.find((c: J) => c.nombre.startsWith("Comercial") || c.nombre.startsWith("Distribuidora")), es = est.establecimientos[0];
  const d = await ana.llamar("POST", "/api/documentos", { cliente_id: cli.id, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "100" }] });
  assert.equal(d.status, 200, d.texto);
  assert.equal((await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/estado`, { estado: "revisado", version: d.json.documento.version })).status, 200);
  const c = await ana.llamar("POST", `/api/documentos/${d.json.documento.id}/certificar`, { proveedor: "digifact", escenario, clave });
  assert.equal(c.status, 200, c.texto); assert.equal(c.json.documento.estado_fiscal, "certificado");
  return c.json.documento.id as string;
}
const anular = (c: Cli, id: string, cuerpo: J) => c.llamar("POST", `/api/documentos/${id}/anular`, cuerpo);
async function bajarPdf(api: Cli, id: string, formato: "carta" | "ticket") {
  const r = await api.llamar("GET", `/api/documentos/${id}/pdf-demo?formato=${formato}`); return { status: r.status, texto: r.texto };
}

Deno.test({ name: "anulación simulada: confirmación y motivo los exige el servidor, permisos, aislamiento, estados y marca en el PDF", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli } = await montar(); const ana = await new Cli("ana").entrar(), marta = await new Cli("marta").entrar(), pedro = await new Cli("pedro").entrar(), sofia = await new Cli("sofia").entrar();
  const id = await documentoCertificado(ana, "clave-cert-anulacion-0001");
  const ops = async (doc: string) => Number((await bd.filas<{ n: string }>("select count(*)::text as n from public.operaciones_fiscales where documento_id = $1 and tipo = 'anulacion'", [doc]))[0].n);
  const estado = async (doc: string) => (await bd.filas<{ e: string }>("select estado_fiscal as e from public.documentos where id = $1", [doc]))[0].e;

  // ---- el servidor exige la palabra y el motivo: nada de esto crea una operación
  for (const [que, cuerpo] of [["sin confirmación", { motivo: "Error en los datos del receptor", clave: "clave-anula-aaaaaaaa-01" }], ["confirmación en minúsculas", { confirmacion: "anular", motivo: "Error en los datos del receptor", clave: "clave-anula-aaaaaaaa-02" }],
    ["confirmación equivocada", { confirmacion: "SI", motivo: "Error en los datos del receptor", clave: "clave-anula-aaaaaaaa-03" }], ["sin motivo", { confirmacion: "ANULAR", clave: "clave-anula-aaaaaaaa-04" }],
    ["motivo vacío", { confirmacion: "ANULAR", motivo: "     ", clave: "clave-anula-aaaaaaaa-05" }], ["motivo demasiado corto", { confirmacion: "ANULAR", motivo: "no", clave: "clave-anula-aaaaaaaa-06" }]] as const) {
    const r = await anular(ana, id, cuerpo); assert.equal(r.status, 400, que); assert.ok(["confirmacion_requerida", "entrada_invalida"].includes(r.json.codigo), `${que}: ${r.texto}`);
  }
  assert.equal(await ops(id), 0, "ninguna petición incompleta crea una operación"); assert.equal(await estado(id), "certificado");
  assert.equal((await anular(ana, id, { motivo: "Error en los datos", clave: "clave-anula-aaaaaaaa-07" })).json.codigo, "confirmacion_requerida", "el mensaje pide escribir ANULAR");

  // ---- permisos y aislamiento entre empresas
  for (const [quien, c] of [["lector (pedro)", pedro], ["emisor (marta)", marta]] as const) { const r = await anular(c, id, { confirmacion: "ANULAR", motivo: "Intento sin permiso", clave: "clave-anula-bbbbbbbb-01" }); assert.equal(r.status, 403, quien); assert.equal(r.json.codigo, "no_autorizado"); }
  const ajena = await anular(sofia, id, { confirmacion: "ANULAR", motivo: "Intento de otra empresa", clave: "clave-anula-cccccccc-01" }); assert.ok(ajena.status >= 400 && ajena.status !== 200, `otra empresa: ${ajena.status}`);
  assert.equal((await sofia.llamar("GET", `/api/documentos/${id}/pdf-demo?formato=carta`)).status, 404, "otra empresa no ve el PDF");
  assert.equal(await ops(id), 0); assert.equal(await estado(id), "certificado", "nada de lo anterior cambió el documento");

  // ---- antes de anular el PDF no lleva marca de anulación
  for (const f of ["carta", "ticket"] as const) { const p = await bajarPdf(ana, id, f); assert.equal(p.status, 200); assert.ok(!/ANULADO|ANULACION PENDIENTE/.test(p.texto), `${f}: sin marca antes de anular`); }

  // ---- anulación correcta: definitiva, con motivo y fecha guardados, y PDF marcado
  const ok = await anular(ana, id, { confirmacion: "ANULAR", motivo: "Error en los datos del receptor", clave: "clave-anula-dddddddd-01" });
  assert.equal(ok.status, 200, ok.texto); assert.equal(ok.json.documento.estado_fiscal, "anulado"); assert.equal(ok.json.documento.anulacion_motivo, "Error en los datos del receptor"); assert.ok(ok.json.documento.anulado_en);
  for (const f of ["carta", "ticket"] as const) { const p = await bajarPdf(ana, id, f); assert.equal(p.status, 200); assert.ok(p.texto.includes("ANULADO"), `${f}: el PDF lleva la marca ANULADO`); assert.ok(p.texto.includes("SIN VALOR FISCAL"), `${f}: conserva el rótulo de no fiscal`); }
  const otra = await anular(ana, id, { confirmacion: "ANULAR", motivo: "Segundo intento", clave: "clave-anula-dddddddd-02" }); assert.ok(otra.status >= 400, "un documento anulado no se vuelve a anular"); assert.equal(await ops(id), 1);
  assert.equal((await anular(ana, id, { confirmacion: "ANULAR", motivo: "Error en los datos del receptor", clave: "clave-anula-dddddddd-01" })).json.operaciones.filter((o: J) => o.tipo === "anulacion").length, 1, "repetir la misma clave no duplica");

  // ---- rechazada por el proveedor: el documento sigue certificado y se puede intentar de nuevo con otra clave
  const id2 = await documentoCertificado(ana, "clave-cert-anulacion-0002");
  const rech = await anular(ana, id2, { confirmacion: "ANULAR", motivo: "Intento que el proveedor rechaza", clave: "clave-anula-eeeeeeee-01", escenario: "rechazo" });
  assert.equal(rech.status, 200, rech.texto); assert.equal(rech.json.documento.estado_fiscal, "certificado", "rechazada: sigue certificado");
  assert.equal(rech.json.operaciones.find((o: J) => o.tipo === "anulacion").estado, "confirmada_fallida");
  const reintento = await anular(ana, id2, { confirmacion: "ANULAR", motivo: "Segundo intento aceptado", clave: "clave-anula-eeeeeeee-02", escenario: "exito" }); assert.equal(reintento.json.documento.estado_fiscal, "anulado", "tras un rechazo confirmado se puede intentar otra vez");

  // ---- pendiente de conciliación: sin respuesta utilizable, queda «anulación solicitada», no se reintenta sola y el PDF lo dice
  const id3 = await documentoCertificado(ana, "clave-cert-anulacion-0003");
  const pend = await anular(ana, id3, { confirmacion: "ANULAR", motivo: "El proveedor no responde", clave: "clave-anula-ffffffff-01", escenario: "indeterminado" });
  assert.equal(pend.status, 200, pend.texto); assert.equal(pend.json.documento.estado_fiscal, "anulacion_solicitada"); assert.equal(pend.json.operaciones.find((o: J) => o.tipo === "anulacion").estado, "desconocida");
  const pp = await bajarPdf(ana, id3, "carta"); assert.ok(pp.texto.includes("ANULACION PENDIENTE") && !pp.texto.includes("DOCUMENTO ANULADO"), "el PDF marca la anulación como pendiente, no como anulada");
  const bloqueado = await anular(ana, id3, { confirmacion: "ANULAR", motivo: "Otro intento mientras hay una abierta", clave: "clave-anula-ffffffff-02" }); assert.ok(bloqueado.status >= 400, "no se abre una segunda anulación mientras hay una pendiente"); assert.equal(await ops(id3), 1);
  assert.equal((await ana.llamar("GET", `/api/documentos/${id3}`)).json.documento.estado_fiscal, "anulacion_solicitada");
}});
