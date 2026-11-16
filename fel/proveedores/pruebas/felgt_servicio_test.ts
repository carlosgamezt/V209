import assert from "node:assert/strict";
import { DigifactGt } from "../src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../src/digifact.ts";
import { AlmacenGtMemoria, CONFIRMACION_TEST, ErrorFelGt, ServicioFelGt, ivaIncluidoGeneral, type ContextoFel, type DocumentoFel, type EstadoOpGt } from "../src/felgt_servicio.ts";
import { facturaPrueba } from "./digifact_gt_fixture.ts";

// Todo con transporte SIMULADO sobre el cliente REAL de Digifact: ninguna prueba toca la red ni usa credenciales reales.
const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9";
const AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: JSON.stringify(o) });
const EMPRESA_A = "10000000-0000-0000-0000-00000000000a", EMPRESA_B = "10000000-0000-0000-0000-00000000000b";
const HUELLA = "0123456789abcdef";
const CERT = { code: "1", message: "Procesado Correctamente", authNumber: AUT, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" };
const AHORA = new Date("2026-11-16T16:00:00Z");

const ctx = (empresaId = EMPRESA_A, permisos = ["borradores.ver", "clientes.ver", "fiscal.ver", "fiscal.certificar"]): ContextoFel => ({ empresaId, actorId: "u-" + empresaId.slice(-1), permisos });
const doc = (empresaId = EMPRESA_A, id = "d1", extra: Partial<DocumentoFel> = {}): DocumentoFel => ({
  id, empresaId, estadoPreparacion: "revisado", estadoFiscal: "ninguno",
  receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" },
  lineas: [{ tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL", cantidad: "1", precioUnitario: "100", descuento: "0", unidad: "SER" }], ...extra });
const referenciaEnviada = (p: PeticionHttp) => { const n = JSON.parse(p.cuerpo!); return n.AdditionalDocumentInfo.AdditionalInfo[0].Code as string; };

type Manejador = (p: PeticionHttp, envios: number) => RespuestaHttp | Promise<RespuestaHttp>;
function mundo(opc: { certificar?: Manejador; reporte?: (ref: string | null) => RespuestaHttp; persistente?: boolean; autorizada?: boolean; sinCanalB?: boolean; ahora?: () => Date } = {}) {
  const llamadas: PeticionHttp[] = []; let envios = 0; let ultimaReferencia: string | null = null;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; ultimaReferencia = referenciaEnviada(p); return await (opc.certificar ?? (() => ok(CERT)))(p, envios); }
    if (p.ruta.startsWith("/Shared")) {
      const q = new URL("https://x" + p.ruta).searchParams;
      if (q.get("DATA1") === "SHARED_GETINFONITcom") return ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA DE PRUEBA, S.A." }] });
      if (q.get("DATA1") === "SHARED_GETREPORTDAILYACUSES") return (opc.reporte ?? (() => ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] })))(ultimaReferencia);
    }
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const almacen = opc.persistente === false ? new AlmacenGtMemoria() : AlmacenGtMemoria.persistenteSimulado();
  let autorizada: string | null = null; const aud: { evento: string; detalle: Record<string, unknown> }[] = [];
  const emisor = { emisor: facturaPrueba().emisor, huella: HUELLA };
  const s = new ServicioFelGt({
    clienteDe: (e) => (e === EMPRESA_A || (e === EMPRESA_B && !opc.sinCanalB) ? cliente : null), emisorDe: (e) => (e === EMPRESA_A || (e === EMPRESA_B && !opc.sinCanalB) ? emisor : null),
    almacen, autorizaPrueba: () => (opc.autorizada === false ? null : autorizada), ahora: opc.ahora ?? (() => AHORA), auditar: (evento, _c, detalle) => { aud.push({ evento, detalle }); },
  });
  return { s, llamadas, almacen, aud, envios: () => envios, autorizar: (ref: string) => { autorizada = ref; }, cliente };
}
const rechaza = async (p: Promise<unknown>, codigo: string) => { await assert.rejects(p, (e: unknown) => e instanceof ErrorFelGt && e.codigo === codigo, `se esperaba ${codigo}`); };
const confirmar = (r: { operacionId: string; referencia: string; huellaEmisor: string }) => ({ operacionId: r.operacionId, confirmacion: CONFIRMACION_TEST, referencia: r.referencia, huellaEmisor: r.huellaEmisor });

Deno.test("consulta de NIT: solo con permiso y canal de la empresa, con límite de uso y sin secretos", async () => {
  const m = mundo();
  assert.deepEqual(await m.s.consultarNit(ctx(), "44653948"), { encontrado: true, nit: "44653948", nombre: "EMPRESA DE PRUEBA, S.A." });
  await rechaza(m.s.consultarNit(ctx(EMPRESA_A, ["borradores.ver"]), "44653948"), "NO_AUTORIZADO");
  await rechaza(m.s.consultarNit(ctx(), "44-65"), "ENTRADA"); await rechaza(m.s.consultarNit(ctx(), 123), "ENTRADA");
  const antes = m.llamadas.length; await rechaza(m.s.consultarNit(ctx(EMPRESA_A, []), "44653948"), "NO_AUTORIZADO"); assert.equal(m.llamadas.length, antes, "sin permiso no se llama a Digifact");
  const sinCanal = mundo({ sinCanalB: true }); await rechaza(sinCanal.s.consultarNit(ctx(EMPRESA_B), "44653948"), "SIN_CANAL"); assert.equal(sinCanal.llamadas.length, 0);
  const lim = new ServicioFelGt({ clienteDe: () => m.cliente, emisorDe: () => ({ emisor: facturaPrueba().emisor, huella: HUELLA }), almacen: new AlmacenGtMemoria(), autorizaPrueba: () => null, ahora: () => AHORA, limiteNitPorMinuto: 2 });
  await lim.consultarNit(ctx(), "44653948"); await lim.consultarNit(ctx(), "44653948"); await rechaza(lim.consultarNit(ctx(), "44653948"), "LIMITE");
  assert.ok(!JSON.stringify(m.aud).includes(CLAVE) && !JSON.stringify(m.aud).includes("firma-secreta"));
});

Deno.test("validación: sin red, sin guardar nada; reglas de documento revisado y de empresa", async () => {
  const m = mundo();
  const v = await m.s.validar(ctx(), doc()); assert.equal(v.ok, true); assert.equal(v.total, "100.000000"); assert.deepEqual(v.errores, []);
  assert.equal(m.llamadas.length, 0, "validar no usa la red"); assert.equal((await m.almacen.deDocumento(EMPRESA_A, "d1")).length, 0, "validar no guarda nada");
  const noRev = await m.s.validar(ctx(), doc(EMPRESA_A, "d2", { estadoPreparacion: "borrador" })); assert.equal(noRev.ok, false); assert.ok(noRev.errores.some((e) => /revisado/.test(e.mensaje)));
  const yaCert = await m.s.validar(ctx(), doc(EMPRESA_A, "d3", { estadoFiscal: "certificado" })); assert.equal(yaCert.ok, false);
  const malo = await m.s.validar(ctx(), doc(EMPRESA_A, "d4", { receptor: { tipoId: "NIT", id: "12-3", nombre: "X" } })); assert.equal(malo.ok, false); assert.ok(malo.errores.length >= 2, "devuelve TODOS los errores");
  const dec = await m.s.validar(ctx(), doc(EMPRESA_A, "d5", { lineas: [{ tipo: "Bien", descripcion: "Algo", cantidad: "1.1234567", precioUnitario: "1", descuento: "0" }] })); assert.equal(dec.ok, false);
  await rechaza(m.s.validar(ctx(EMPRESA_B), doc(EMPRESA_A)), "NO_ENCONTRADO");   // un documento de A jamás se valida en nombre de B
  await rechaza(m.s.validar(ctx(EMPRESA_A, []), doc()), "NO_AUTORIZADO");
});

Deno.test("política de impuestos: IVA 12 % incluido (igual al documento de prueba aprobado) y fallo cerrado para otras afiliaciones", async () => {
  const e = facturaPrueba().emisor;
  assert.deepEqual(ivaIncluidoGeneral(100_000_000n, e), [{ codigoUnidadGravable: 1, nombre: "IVA", gravable: "89.285714", monto: "10.714286" }]);
  assert.throws(() => ivaIncluidoGeneral(1n, { ...e, afiliacionIva: "PEQ" }), (x: unknown) => x instanceof ErrorFelGt && x.codigo === "VALIDACION");
  const m = mundo(); const v = await m.s.validar(ctx(), doc(EMPRESA_A, "x", { lineas: [{ tipo: "Servicio", descripcion: "Con descuento", cantidad: "3", precioUnitario: "33.33", descuento: "10" }] })); assert.equal(v.ok, true, JSON.stringify(v.errores)); assert.equal(v.total, "89.990000");
});

Deno.test("preparación: guarda la operación pero NO envía; es idempotente y la referencia es única y determinista", async () => {
  const m = mundo();
  const p1 = await m.s.preparar(ctx(), doc()); assert.equal(m.llamadas.length, 0, "preparar no toca la red"); assert.equal(p1.reutilizada, false); assert.match(p1.referencia, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const p2 = await m.s.preparar(ctx(), doc()); assert.equal(p2.operacionId, p1.operacionId); assert.equal(p2.reutilizada, true); assert.equal(p2.referencia, p1.referencia);
  const otra = await m.s.preparar(ctx(), doc(EMPRESA_A, "d2")); assert.notEqual(otra.referencia, p1.referencia);
  const cambiado = await m.s.preparar(ctx(), doc(EMPRESA_A, "d1", { lineas: [{ tipo: "Servicio", descripcion: "Otro", cantidad: "1", precioUnitario: "50", descuento: "0" }] })); assert.notEqual(cambiado.referencia, p1.referencia);
  await rechaza(m.s.preparar(ctx(EMPRESA_A, ["borradores.ver", "fiscal.ver"]), doc()), "NO_AUTORIZADO");   // un lector no prepara
  await rechaza(m.s.preparar(ctx(), doc(EMPRESA_A, "d9", { estadoPreparacion: "borrador" })), "VALIDACION");
  assert.equal(m.envios(), 0);
});

Deno.test("certificar exige cada garantía por separado y, si falta alguna, NO sale nada hacia Digifact", async () => {
  const m = mundo(); const p = await m.s.preparar(ctx(), doc()); const c = confirmar(p);
  const sinSalida = async (cod: string, f: () => Promise<unknown>) => { const antes = m.llamadas.length; await rechaza(f(), cod); assert.equal(m.llamadas.length, antes, `${cod}: no debe haber red`); assert.equal(m.envios(), 0); };
  await sinSalida("NO_AUTORIZADO", () => m.s.certificar(ctx(EMPRESA_A, ["borradores.ver", "fiscal.ver"]), doc(), c));   // sin «fiscal.certificar»
  await sinSalida("CONFIRMACION", () => m.s.certificar(ctx(), doc(), { ...c, confirmacion: "certificar-test" }));
  await sinSalida("CONFIRMACION", () => m.s.certificar(ctx(), doc(), { ...c, confirmacion: undefined }));
  await sinSalida("CONFIRMACION", () => m.s.certificar(ctx(), doc(), { ...c, referencia: "6f1c2f6e-3b7a-4c52-9d0e-0a1b2c3d4e5f" }));
  await sinSalida("CONFIRMACION", () => m.s.certificar(ctx(), doc(), { ...c, huellaEmisor: "ffffffffffffffff" }));
  await sinSalida("PRUEBA_NO_AUTORIZADA", () => m.s.certificar(ctx(), doc(), c));   // todo en regla, pero nadie autorizó esta prueba
  m.autorizar("00000000-0000-5000-8000-000000000001");
  await sinSalida("PRUEBA_NO_AUTORIZADA", () => m.s.certificar(ctx(), doc(), c));   // autorizó OTRA referencia
  m.autorizar(p.referencia);
  await sinSalida("DOCUMENTO_CAMBIO", () => m.s.certificar(ctx(), doc(EMPRESA_A, "d1", { lineas: [{ tipo: "Servicio", descripcion: "Cambiado", cantidad: "1", precioUnitario: "100", descuento: "0" }] }), c));
  await sinSalida("ESTADO", () => m.s.certificar(ctx(), doc(EMPRESA_A, "d1", { estadoPreparacion: "borrador" }), c));
  await sinSalida("NO_ENCONTRADO", () => m.s.certificar(ctx(), doc(EMPRESA_A, "otro-doc"), c));
  await sinSalida("NO_ENCONTRADO", () => m.s.certificar(ctx(EMPRESA_B), doc(EMPRESA_B), c));   // otra empresa no puede usar la operación de A
  const caduca = mundo({ ahora: (() => { let t = AHORA.getTime(); return () => new Date((t += 40 * 60_000)); })() });
  const pc = await caduca.s.preparar(ctx(), doc()); caduca.autorizar(pc.referencia); await rechaza(caduca.s.certificar(ctx(), doc(), confirmar(pc)), "ESTADO"); assert.equal(caduca.llamadas.length, 0, "una preparación caducada no se envía");
});

Deno.test("sin almacén persistente no hay envío real (falla cerrado)", async () => {
  const m = mundo({ persistente: false }); const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  await rechaza(m.s.certificar(ctx(), doc(), confirmar(p)), "ALMACEN_NO_PERSISTENTE"); assert.equal(m.llamadas.length, 0);
});

Deno.test("certificación feliz: un solo envío, referencia en la Adenda, y repetir NO reenvía", async () => {
  const m = mundo(); const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.reutilizada, false); assert.equal(r.operacion.estado, "certificada"); assert.equal(r.operacion.resultado?.autorizacion, AUT); assert.equal(r.operacion.resultado?.serie, "A001");
  assert.equal(m.envios(), 1); assert.equal(referenciaEnviada(m.llamadas.find((l) => l.ruta.startsWith("/v2/transform/nuc_json"))!), p.referencia);
  const otra = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, "repetir no vuelve a enviar");
  await rechaza(m.s.preparar(ctx(), doc()), "ESTADO");   // ya certificado: no se prepara otro envío
  const sale = JSON.stringify([r, otra, m.aud]); assert.ok(!sale.includes(CLAVE) && !sale.includes("firma-secreta") && !sale.includes("JVBERi0x") && !sale.includes("PD94bWw="), "ni credenciales, ni token, ni documentos en bruto");
  assert.ok(m.aud.some((a) => a.evento === "digifact_test.envio_iniciado") && m.aud.some((a) => a.evento === "digifact_test.certificada"));
});

Deno.test("dos certificaciones simultáneas de la misma operación: exactamente UN envío", async () => {
  let abrir!: () => void; const compuerta = new Promise<void>((r) => { abrir = r; });
  const m = mundo({ certificar: async () => { await compuerta; return ok(CERT); } });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  const x = Promise.all([m.s.certificar(ctx(), doc(), confirmar(p)), m.s.certificar(ctx(), doc(), confirmar(p)), m.s.certificar(ctx(), doc(), confirmar(p))]);
  await new Promise((r) => setTimeout(r, 20)); abrir(); const rs = await x;
  assert.equal(m.envios(), 1); assert.equal(rs.filter((r) => !r.reutilizada).length, 1); assert.ok(rs.every((r) => ["certificada", "enviando"].includes(r.operacion.estado)));
});

Deno.test("rechazo confirmado: queda «rechazada», se puede corregir y la nueva preparación usa OTRA referencia", async () => {
  const m = mundo({ certificar: () => ok({ code: "31", message: "NIT del receptor no válido" }) }); const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.operacion.estado, "rechazada"); assert.equal(r.operacion.resultado?.codigo, "31");
  const p2 = await m.s.preparar(ctx(), doc(EMPRESA_A, "d1", { estadoFiscal: "rechazado" })); assert.notEqual(p2.referencia, p.referencia); assert.notEqual(p2.operacionId, p.operacionId);
});

Deno.test("fallo ANTES de procesar (contraseña o token rechazados): «no_enviada», sin documento y sin bloquear", async () => {
  const m = mundo(); const orig = m.cliente.certificar.bind(m.cliente);
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  const falla = mundo({ certificar: () => ok({}, 401) }); const pf = await falla.s.preparar(ctx(), doc()); falla.autorizar(pf.referencia);
  const r = await falla.s.certificar(ctx(), doc(), confirmar(pf)); assert.equal(r.operacion.estado, "no_enviada"); assert.ok(!JSON.stringify(r).includes(CLAVE) && !JSON.stringify(r).includes("firma-secreta"));
  const p2 = await falla.s.preparar(ctx(), doc()); assert.notEqual(p2.referencia, pf.referencia, "tras un no_enviada se puede volver a preparar");
  void orig;
});

Deno.test("resultado incierto: «desconocida», NUNCA se reenvía y solo se concilia por la referencia", async () => {
  const caso = async (nombre: string, manejador: Manejador, motivo: string) => {
    const m = mundo({ certificar: manejador }); const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
    const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.operacion.estado, "desconocida", nombre); assert.equal(r.operacion.resultado?.motivoDesconocido, motivo, nombre);
    const otra = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, `${nombre}: no se reenvía`);
    await rechaza(m.s.preparar(ctx(), doc()), "ESTADO");
    return { m, p };
  };
  await caso("tiempo agotado", () => { const e = new Error("t"); e.name = "TiempoAgotado"; throw e; }, "timeout");
  await caso("corte de red", () => { throw new Error("reset"); }, "corte");
  await caso("error 500", () => ok({}, 500), "limite_o_caida");
  await caso("respuesta ilegible", () => ({ estado: 200, cuerpo: "<html>" }), "respuesta_ilegible");
  await caso("éxito sin datos fiscales", () => ok({ code: "1", authNumber: "no-es-guid" }), "respuesta_ilegible");
  const { m, p } = await caso("código no mapeado", () => ok({ message: "???" }), "codigo_no_mapeado");
  // conciliación: no aparece → sigue desconocida y cuenta el intento, sin reenviar
  const c1 = await m.s.conciliar(ctx(), p.operacionId); assert.equal(c1.resultado, "no_encontrado"); assert.equal(c1.operacion.estado, "desconocida"); assert.equal(c1.operacion.intentosConciliacion, 1); assert.equal(m.envios(), 1);
  assert.ok("aviso" in c1);
});

Deno.test("conciliación: si Digifact ya la tiene, queda «certificada» con sus datos; se rechaza una referencia distinta", async () => {
  const fila = (ref: string) => ({ GUID: AUT, SERIE: "A001", NUMERO: "5", TIPO_DTE: "FACT", FECHA_DE_CERTIFICACION: "2026-11-16T10:00:05", REFERENCIA_INTERNA: ref, ESTADO_ACUSE: "ACEPTADO_SAT", ANULADO: "0", TOTAL: "100.00", NE: "2", NOMBRE: "X" });
  const m = mundo({ certificar: () => { throw new Error("corte"); }, reporte: (ref) => ok({ REQUEST_DATA: [{ Respuesta: "1" }], RESPONSE: [fila(ref!)] }) });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); await m.s.certificar(ctx(), doc(), confirmar(p));
  const c = await m.s.conciliar(ctx(), p.operacionId); assert.equal(c.resultado, "certificada"); assert.equal(c.operacion.resultado?.autorizacion, AUT); assert.equal(m.envios(), 1);
  assert.equal((await m.s.conciliar(ctx(), p.operacionId)).resultado, "sin_cambios", "conciliar es idempotente");
  const m2 = mundo({ certificar: () => { throw new Error("corte"); }, reporte: () => ok({ REQUEST_DATA: [{ Respuesta: "1" }], RESPONSE: [fila("00000000-0000-5000-8000-0000000000ff")] }) });
  const p2 = await m2.s.preparar(ctx(), doc()); m2.autorizar(p2.referencia); await m2.s.certificar(ctx(), doc(), confirmar(p2));
  assert.equal((await m2.s.conciliar(ctx(), p2.operacionId)).resultado, "no_encontrado", "una fila con otra referencia no concilia");
  assert.equal((await m2.s.estadoDocumento(ctx(), "d1"))[0].estado, "desconocida");
});

Deno.test("proceso caído a mitad de un envío: pasa a «desconocida» para conciliar, nunca se reenvía", async () => {
  let t = AHORA.getTime(); const m = mundo({ ahora: () => new Date(t) });
  const p = await m.s.preparar(ctx(), doc()); await m.almacen.transicion(EMPRESA_A, p.operacionId, ["preparada"], { estado: "enviando" as EstadoOpGt });   // el proceso murió justo tras guardar «enviando»
  assert.equal((await m.s.conciliar(ctx(), p.operacionId)).operacion.estado, "enviando", "recién iniciado: aún se espera");
  t += 5 * 60_000; const c = await m.s.conciliar(ctx(), p.operacionId);
  assert.equal(c.operacion.estado, "desconocida"); assert.equal(c.operacion.resultado?.motivoDesconocido, "proceso_interrumpido"); assert.equal(m.envios(), 0);
  m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.reutilizada, true); assert.equal(m.envios(), 0);
});

Deno.test("aislamiento multiempresa: una empresa nunca ve, concilia ni toca operaciones de otra", async () => {
  const m = mundo(); const pa = await m.s.preparar(ctx(EMPRESA_A), doc(EMPRESA_A, "doc-comun")); m.autorizar(pa.referencia);
  assert.deepEqual(await m.s.estadoDocumento(ctx(EMPRESA_B), "doc-comun"), [], "B no ve las operaciones de A, ni con el mismo id de documento");
  await rechaza(m.s.conciliar(ctx(EMPRESA_B), pa.operacionId), "NO_ENCONTRADO");
  await rechaza(m.s.certificar(ctx(EMPRESA_B), doc(EMPRESA_B, "doc-comun"), confirmar(pa)), "NO_ENCONTRADO");
  const pb = await m.s.preparar(ctx(EMPRESA_B), doc(EMPRESA_B, "doc-comun")); assert.notEqual(pb.referencia, pa.referencia, "la referencia depende de la empresa");
  assert.equal(await m.almacen.obtener(EMPRESA_B, pa.operacionId), null);
  assert.equal((await m.almacen.transicion(EMPRESA_B, pa.operacionId, ["preparada"], { estado: "certificada" })), null, "ni a nivel de almacén se puede cambiar la operación de otra empresa");
  assert.equal((await m.s.estadoDocumento(ctx(EMPRESA_A), "doc-comun")).length, 1);
  await rechaza(m.s.estadoDocumento({ empresaId: "", actorId: "x", permisos: ["fiscal.ver"] }, "doc-comun"), "NO_AUTORIZADO");
  const sinCanal = mundo({ sinCanalB: true }); await rechaza(sinCanal.s.preparar(ctx(EMPRESA_B), doc(EMPRESA_B)), "SIN_CANAL"); assert.equal(sinCanal.llamadas.length, 0);
});

Deno.test("anulación y nota de crédito siguen cerradas: el servicio ni las expone y el cliente las rechaza", async () => {
  const m = mundo(); assert.equal((m.s as unknown as Record<string, unknown>).anular, undefined); assert.equal((m.s as unknown as Record<string, unknown>).notaCredito, undefined);
  await assert.rejects(() => m.cliente.constructor.prototype.anular.call(m.cliente, { autorizacion: AUT, nitReceptor: "CF", fechaEmision: "2026-11-16T10:00:00", motivo: "prueba", confirmacion: "ANULAR" }), /no está habilitada/);
});
