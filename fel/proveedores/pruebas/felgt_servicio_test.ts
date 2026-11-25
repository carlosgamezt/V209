import assert from "node:assert/strict";
import { DigifactGt } from "../src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../src/digifact.ts";
import { AUTORIZACION_CICLO, AlmacenGtMemoria, CONFIRMACION_TEST, ErrorFelGt, MAX_RENOVACIONES, ServicioFelGt, ivaIncluidoGeneral, type ContextoFel, type DocumentoFel, type EstadoOpGt } from "../src/felgt_servicio.ts";
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
function mundo(opc: { certificar?: Manejador; reporte?: (ref: string | null, fecha?: string) => RespuestaHttp; prevueloDias?: number; persistente?: boolean; autorizada?: boolean; sinCanalB?: boolean; ahora?: () => Date; tipoTest?: (codigo: string) => boolean; documento?: (p: PeticionHttp) => RespuestaHttp; almacen?: AlmacenGtMemoria } = {}) {
  const llamadas: PeticionHttp[] = []; let envios = 0; let ultimaReferencia: string | null = null;
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    llamadas.push(p);
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios++; ultimaReferencia = referenciaEnviada(p); return await (opc.certificar ?? (() => ok(CERT)))(p, envios); }
    if (p.ruta.startsWith("/GetDocument")) return (opc.documento ?? (() => ok({ RESPONSE: [] })))(p);
    if (p.ruta.startsWith("/Shared")) {
      const q = new URL("https://x" + p.ruta).searchParams;
      if (q.get("DATA1") === "SHARED_GETINFONITcom") return ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA DE PRUEBA, S.A." }] });
      if (q.get("DATA1") === "SHARED_GETREPORTDAILYACUSES") { const fecha = /FECHA\|(\d{4}-\d{2}-\d{2})/.exec(decodeURIComponent(p.ruta))?.[1]; return (opc.reporte ?? (() => ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] })))(ultimaReferencia, fecha); }
    }
    return ok({}, 404);
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte });
  const almacen = opc.almacen ?? (opc.persistente === false ? new AlmacenGtMemoria() : AlmacenGtMemoria.persistenteSimulado());
  let autorizada: string | null = null; const aud: { evento: string; detalle: Record<string, unknown> }[] = [];
  const emisor = { emisor: facturaPrueba().emisor, huella: HUELLA };
  const s = new ServicioFelGt({
    clienteDe: (e) => (e === EMPRESA_A || (e === EMPRESA_B && !opc.sinCanalB) ? cliente : null), emisorDe: (e) => (e === EMPRESA_A || (e === EMPRESA_B && !opc.sinCanalB) ? emisor : null),
    almacen, autorizaPrueba: () => (opc.autorizada === false ? null : autorizada), ...(opc.tipoTest ? { tipoCertificableEnTest: opc.tipoTest } : {}), ahora: opc.ahora ?? (() => AHORA), auditar: (evento, _c, detalle) => { aud.push({ evento, detalle }); }, ...(opc.prevueloDias !== undefined ? { prevueloDias: opc.prevueloDias } : {}),
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

Deno.test("precio unitario Q0.00: aceptado solo en la demostración; al preparar para certificar se rechaza y no sale nada (los negativos ya no son numéricos válidos)", async () => {
  const m = mundo();
  const cero = (precio: string) => doc(EMPRESA_A, "dcero", { lineas: [{ tipo: "Servicio", descripcion: "Cortesía", cantidad: "1", precioUnitario: precio, descuento: "0" }] });
  await rechaza(m.s.preparar(ctx(), cero("0")), "VALIDACION"); await rechaza(m.s.preparar(ctx(), cero("0.00")), "VALIDACION"); await rechaza(m.s.preparar(ctx(), cero("-5")), "VALIDACION");
  assert.equal(m.llamadas.length, 0); assert.equal(m.envios(), 0);
  assert.ok((await m.s.preparar(ctx(), doc())).operacionId, "un documento con precio positivo sigue preparándose");
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

Deno.test("«CICLO-TEST» autoriza el ciclo de pruebas SIN fijar una referencia, pero el resto de garantías sigue exigiéndose y nunca se envía dos veces lo mismo", async () => {
  const m = mundo(); const p = await m.s.preparar(ctx(), doc()); m.autorizar(AUTORIZACION_CICLO);
  // con el ciclo autorizado siguen faltando la confirmación escrita, la referencia y la huella: sin ellas NO sale nada
  const antes = m.llamadas.length;
  await rechaza(m.s.certificar(ctx(), doc(), { ...confirmar(p), confirmacion: "x" }), "CONFIRMACION"); await rechaza(m.s.certificar(ctx(), doc(), { ...confirmar(p), huellaEmisor: "ffffffffffffffff" }), "CONFIRMACION");
  assert.equal(m.llamadas.length, antes); assert.equal(m.envios(), 0);
  const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.operacion.estado, "certificada"); assert.equal(m.envios(), 1);
  const otra = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, "una certificación ya hecha no se reenvía");   // anti duplicados
  m.autorizar("CICLO-OTRO"); const q = mundo(); const pq = await q.s.preparar(ctx(), doc()); q.autorizar("CICLO-OTRO");
  await rechaza(q.s.certificar(ctx(), doc(), confirmar(pq)), "PRUEBA_NO_AUTORIZADA");   // solo el valor exacto «CICLO-TEST» vale
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

// ---------------------------------------------------------------- certificación REAL: aplicación al documento y artefactos (XML/PDF) reales
const XML_REAL = `<?xml version="1.0" encoding="UTF-8"?><dte:GTDocumento><dte:NumeroAutorizacion Numero="5" Serie="A001">${AUT}</dte:NumeroAutorizacion></dte:GTDocumento>`;
const PDF_REAL = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
const XML64 = btoa(XML_REAL), PDF64 = btoa(PDF_REAL);
const CERT_CON_ARCHIVOS = { ...CERT, responseData1: XML64, responseData3: PDF64 };
const texto = (u: Uint8Array) => new TextDecoder().decode(u);

Deno.test("certificación REAL: se aplica al documento y los XML/PDF reales se guardan y se descargan solo con permiso y solo de su empresa", async () => {
  const m = mundo({ certificar: () => ok(CERT_CON_ARCHIVOS) });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(r.operacion.estado, "certificada"); assert.deepEqual([r.operacion.resultado?.serie, r.operacion.resultado?.numero, r.operacion.resultado?.autorizacion], ["A001", "5", AUT], "los datos fiscales son los del certificador");
  assert.equal((r as { aplicacion?: string }).aplicacion, "aplicada"); assert.equal((r as { artefactos?: string }).artefactos, "guardados"); assert.ok(m.almacen.aplicadas.has(p.operacionId));
  const x = await m.s.descargar(ctx(), "d1", "xml"), f = await m.s.descargar(ctx(), "d1", "pdf");
  assert.equal(texto(x.contenido), XML_REAL); assert.equal(texto(f.contenido), PDF_REAL); assert.equal(x.nombre, "DTE-A001-5.xml"); assert.equal(f.mime, "application/pdf"); assert.match(x.sha256, /^[0-9a-f]{64}$/);
  await rechaza(m.s.descargar(ctx(EMPRESA_A, ["borradores.ver"]), "d1", "xml"), "NO_AUTORIZADO");          // sin permiso fiscal.ver
  await rechaza(m.s.descargar(ctx(EMPRESA_B), "d1", "xml"), "NO_ENCONTRADO");                                 // otra empresa no ve ni descarga lo de la A
  await rechaza(m.s.descargar(ctx(), "d1", "html"), "ENTRADA"); await rechaza(m.s.descargar(ctx(), "otro-doc", "xml"), "NO_ENCONTRADO");
  const otra = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, "repetir no reenvía"); assert.equal((otra as { aplicacion?: string }).aplicacion, "ya_aplicada");
});

Deno.test("artefactos inválidos NO se guardan ni se sirven (la certificación fiscal se conserva); una descarga posterior los pide a Digifact, los valida y los guarda una sola vez", async () => {
  let pedidos = 0;
  const m = mundo({ certificar: () => ok({ ...CERT, responseData1: btoa("<?xml version='1.0'?><otro/>"), responseData3: btoa("%PDF-1.4 truncado") }),
    documento: () => { pedidos++; return ok({ RESPONSE: [{ ResponseData1: XML64, ResponseData3: PDF64 }] }); } });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal((r as { artefactos?: string }).artefactos, "invalidos"); assert.equal((r as { aplicacion?: string }).aplicacion, "aplicada", "lo fiscal no depende de los archivos"); assert.equal(r.operacion.estado, "certificada");
  assert.ok(m.aud.some((a) => a.evento === "digifact_test.artefacto_invalido"));
  assert.equal(texto((await m.s.descargar(ctx(), "d1", "xml")).contenido), XML_REAL); assert.equal(pedidos, 1);
  await m.s.descargar(ctx(), "d1", "xml"); assert.equal(pedidos, 1, "ya guardado: no se vuelve a pedir");
  const malo = mundo({ certificar: () => ok({ ...CERT, responseData1: undefined, responseData3: undefined }), documento: () => ok({ RESPONSE: [{ ResponseData1: btoa("<x>no es el documento</x>"), ResponseData3: "JVBERi0x" }] }) });
  const q = await malo.s.preparar(ctx(), doc()); malo.autorizar(q.referencia); await malo.s.certificar(ctx(), doc(), confirmar(q));
  await rechaza(malo.s.descargar(ctx(), "d1", "xml"), "ARTEFACTO_INVALIDO"); await rechaza(malo.s.descargar(ctx(), "d1", "pdf"), "ARTEFACTO_INVALIDO");
  const sin = mundo({ certificar: () => ok({ ...CERT, responseData1: undefined, responseData3: undefined }) }); const s1 = await sin.s.preparar(ctx(), doc()); sin.autorizar(s1.referencia); await sin.s.certificar(ctx(), doc(), confirmar(s1));
  await rechaza(sin.s.descargar(ctx(), "d1", "xml"), "NO_ENCONTRADO");   // Digifact no lo entrega todavía
});

Deno.test("si aplicar la certificación al documento falla, la operación sigue «certificada», queda «pendiente» y se repara sin reenviar nada", async () => {
  const almacen = AlmacenGtMemoria.persistenteSimulado(); let falla = true; const orig = almacen.aplicarCertificacion.bind(almacen);
  almacen.aplicarCertificacion = async (e, o) => { if (falla) throw new Error("FEL_REGLA: caída transitoria de la base"); return await orig(e, o); };
  const m = mundo({ certificar: () => ok(CERT_CON_ARCHIVOS), almacen });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(r.operacion.estado, "certificada"); assert.equal((r as { aplicacion?: string }).aplicacion, "pendiente"); assert.ok(m.aud.some((a) => a.evento === "digifact_test.aplicacion_pendiente"));
  falla = false; const rep = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(rep.reutilizada, true); assert.equal((rep as { aplicacion?: string }).aplicacion, "aplicada"); assert.equal(m.envios(), 1, "la reparación jamás reenvía");
});

Deno.test("timeout y conciliación: el documento solo se certifica cuando Digifact lo confirma, con SUS datos, y sin segundo envío", async () => {
  const fila = (ref: string) => ({ GUID: AUT, SERIE: "A001", NUMERO: "5", TIPO_DTE: "FACT", FECHA_DE_CERTIFICACION: "2026-11-16T10:00:05", REFERENCIA_INTERNA: ref, ESTADO_ACUSE: "ACEPTADO_SAT", ANULADO: "0", TOTAL: "100.00", NE: "2", NOMBRE: "X" });
  const m = mundo({ certificar: () => { throw new Error("corte"); }, reporte: (ref) => ok({ REQUEST_DATA: [{ Respuesta: "1" }], RESPONSE: [fila(ref!)] }) });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(r.operacion.estado, "desconocida"); assert.equal(m.almacen.aplicadas.size, 0, "un resultado incierto NO toca el documento");
  const c = await m.s.conciliar(ctx(), p.operacionId); assert.equal(c.resultado, "certificada"); assert.equal((c as { aplicacion?: string }).aplicacion, "aplicada"); assert.ok(m.almacen.aplicadas.has(p.operacionId)); assert.equal(m.envios(), 1);
  await rechaza(m.s.preparar(ctx(), doc()), "ESTADO");   // ya certificado: no se prepara otro envío
});

// ---------------------------------------------------------------- correo de la factura enviado por DIGIFACT al certificar (Buyer.Contact.EmailList)
const nucEnviado = (m: ReturnType<typeof mundo>) => JSON.parse(m.llamadas.find((l) => l.ruta.startsWith("/v2/transform/nuc_json"))!.cuerpo!);

Deno.test("correo por Digifact: sin pedirlo, el NUC es idéntico al de siempre (sin Buyer.Contact) y no se audita ningún correo", async () => {
  const m = mundo(); const p = await m.s.preparar(ctx(), doc()); assert.equal(p.correoSolicitado, null); m.autorizar(p.referencia);
  await m.s.certificar(ctx(), doc(), confirmar(p)); const nuc = nucEnviado(m);
  assert.equal(nuc.Buyer.Contact, undefined, "sin correo pedido no hay nodo de contacto"); assert.ok(!m.aud.some((a) => a.evento.includes("correo")));
});

Deno.test("correo por Digifact: pedido, viaja SOLO en Buyer.Contact.EmailList del NUC enviado; la huella y la referencia NO cambian; se audita «solicitado» enmascarado", async () => {
  const m = mundo(); const sin = await m.s.preparar(ctx(), doc()); const con = await m.s.preparar(ctx(), doc(), { correo: "cliente.prueba@ejemplo.com" });
  assert.equal(con.referencia, sin.referencia, "el correo no entra en la huella: misma operación preparada"); assert.equal(con.operacionId, sin.operacionId); assert.equal(con.correoSolicitado, "c***@ejemplo.com");
  m.autorizar(con.referencia);
  const r = await m.s.certificar(ctx(), doc(), { ...confirmar(con), correo: "cliente.prueba@ejemplo.com" }); assert.equal(r.operacion.estado, "certificada");
  const nuc = nucEnviado(m); assert.deepEqual(nuc.Buyer.Contact, { EmailList: { Email: ["cliente.prueba@ejemplo.com"] } });
  assert.equal(nuc.Buyer.TaxID, "CF"); assert.equal(nuc.Buyer.Name, "CONSUMIDOR FINAL", "los datos fiscales del receptor no cambian");
  const a = m.aud.filter((x) => x.evento === "digifact_test.correo_solicitado"); assert.equal(a.length, 1, "un solo registro de envío solicitado"); assert.equal(a[0].detalle.destinatario, "c***@ejemplo.com"); assert.equal(a[0].detalle.documento, "d1");
  assert.ok(!JSON.stringify(m.aud).includes("cliente.prueba"), "el correo completo no se audita");
  assert.ok(!m.aud.some((x) => /entregad/i.test(x.evento) || /entregad/i.test(JSON.stringify(x.detalle))), "nunca «entregado»: NEXA no recibe confirmación de entrega");
});

Deno.test("correo por Digifact: duplicados — repetir la certificación no vuelve a enviar nada (ni correo) y la conciliación no reconstruye el NUC", async () => {
  const m = mundo(); const p = await m.s.preparar(ctx(), doc(), { correo: "uno@ejemplo.com" }); m.autorizar(p.referencia);
  await m.s.certificar(ctx(), doc(), { ...confirmar(p), correo: "uno@ejemplo.com" }); assert.equal(m.envios(), 1);
  const otra = await m.s.certificar(ctx(), doc(), { ...confirmar(p), correo: "otro@ejemplo.com" }); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, "una sola salida hacia Digifact");
  assert.equal(m.aud.filter((x) => x.evento === "digifact_test.correo_solicitado").length, 1, "un solo «correo solicitado» aunque se repita la petición con otro correo");
  await rechaza(m.s.preparar(ctx(), doc(), { correo: "uno@ejemplo.com" }), "ESTADO");
});

Deno.test("correo por Digifact: correo inválido o demasiado largo se rechaza ANTES de enviar y sale nada hacia Digifact", async () => {
  const m = mundo();
  for (const mal of ["no-es-correo", "a@b", "x y@ejemplo.com", "uno@ejemplo.com,dos@ejemplo.com", "<s>@ejemplo.com", "a".repeat(45) + "@ejemplo.com"]) {
    await assert.rejects(m.s.preparar(ctx(), doc(), { correo: mal }), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "VALIDACION" && !!e.errores?.some((x) => x.campo === "receptor.correo"), mal.slice(0, 20));
  }
  await rechaza(m.s.preparar(ctx(), doc(), { correo: 123 }), "ENTRADA");
  const v = await m.s.validar(ctx(), doc(), { correo: "no-es-correo" }); assert.equal(v.ok, false); assert.ok(v.errores.some((x) => x.campo === "receptor.correo"));
  assert.equal(m.llamadas.filter((l) => l.ruta.startsWith("/v2/")).length, 0, "nada salió hacia Digifact");
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia);
  await assert.rejects(m.s.certificar(ctx(), doc(), { ...confirmar(p), correo: "no-es-correo" }), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "VALIDACION");
  assert.equal(m.envios(), 0, "un correo inválido en la certificación tampoco envía el NUC");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// RECUPERACIÓN: una certificación hecha en Digifact no se «deshace» restaurando un respaldo. Antes de enviar se busca la referencia (determinista) en Digifact; si ya está, NO se envía.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const FILA = (ref: string, aut = AUT) => ({ GUID: aut, SERIE: "A001", NUMERO: "5", TIPO_DTE: "FACT", FECHA_DE_CERTIFICACION: "2026-11-16T10:00:05", REFERENCIA_INTERNA: ref, ESTADO_ACUSE: "ACEPTADO_SAT", ANULADO: "0", TOTAL: "100.00", NE: "2", NOMBRE: "X" });
const reporteCon = (ref: string) => ok({ REQUEST_DATA: [{ Respuesta: "1" }], RESPONSE: [FILA(ref)] }), reporteVacio = () => ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] });
const reportes = (m: { llamadas: PeticionHttp[] }) => m.llamadas.filter((l) => l.ruta.includes("SHARED_GETREPORTDAILYACUSES")).length;

Deno.test("restauración de un respaldo (la base perdió la memoria de lo enviado): si Digifact YA tiene la referencia, NO se envía; queda «desconocida», se concilia con SUS datos y repetir no reenvía", async () => {
  let existente: string | null = null;
  const m = mundo({ reporte: () => (existente ? reporteCon(existente) : reporteVacio()), documento: () => ok({ RESPONSE: [{ ResponseData1: XML64, ResponseData3: PDF64 }] }) });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); existente = p.referencia;   // la certificó antes de la «restauración»: Digifact la tiene, la base de NEXA no
  const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(r.reutilizada, false); assert.equal(r.operacion.estado, "desconocida"); assert.equal(r.operacion.resultado?.motivoDesconocido, "ya_existia_en_digifact"); assert.equal(m.envios(), 0, "NO se envió ningún NUC");
  assert.ok("aviso" in r && /NO se envió nada/.test(String((r as { aviso?: string }).aviso)));
  assert.ok(m.aud.some((a) => a.evento === "digifact_test.ya_existia_en_digifact") && !m.aud.some((a) => a.evento === "digifact_test.envio_iniciado"), "se audita el hallazgo y jamás un envío");
  // la operación «desconocida» bloquea: ni repetir ni volver a preparar envían algo
  assert.equal((await m.s.certificar(ctx(), doc(), confirmar(p))).reutilizada, true); await rechaza(m.s.preparar(ctx(), doc()), "ESTADO"); assert.equal(m.envios(), 0);
  // conciliar: se adopta el resultado que Digifact ya tiene (UUID, serie, número), se aplica al documento y NO se reenvía
  const c = await m.s.conciliar(ctx(), p.operacionId);
  assert.equal(c.resultado, "certificada"); assert.deepEqual([c.operacion.resultado?.autorizacion, c.operacion.resultado?.serie, c.operacion.resultado?.numero], [AUT, "A001", "5"]); assert.equal(m.envios(), 0);
  assert.equal(m.almacen.aplicadas.has(p.operacionId), true, "la certificación quedó aplicada al documento");
  assert.equal((await m.s.conciliar(ctx(), p.operacionId)).resultado, "sin_cambios", "idempotente");
  // los archivos se recuperan de Digifact (no se reconstruyen) y se validan
  assert.equal(texto((await m.s.descargar(ctx(), "d1", "xml")).contenido), XML_REAL);
  assert.equal(m.envios(), 0, "en todo el recorrido no salió ni un solo NUC");
});

Deno.test("chequeo previo: la referencia se busca en la fecha de emisión y hacia atrás; hallada en un día anterior bloquea el envío y se concilia en ESE día", async () => {
  let dia = "2026-11-13", ref: string | null = null;   // AHORA es 2026-11-16: tres días antes
  const m = mundo({ reporte: (_r, fecha) => (ref && fecha === dia ? reporteCon(ref) : reporteVacio()) });
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); ref = p.referencia;
  const r = await m.s.certificar(ctx(), doc(), confirmar(p)); assert.equal(r.operacion.estado, "desconocida"); assert.equal(m.envios(), 0); assert.equal(r.operacion.resultado?.motivoDesconocido, "ya_existia_en_digifact");
  assert.equal((await m.s.conciliar(ctx(), p.operacionId)).resultado, "certificada", "la conciliación consulta el día en que se halló");
  // fuera de la ventana (9 días antes) NO se ve con 7 días: ese es el límite del chequeo (documentado); con una ventana mayor sí
  dia = "2026-11-07"; const m2 = mundo({ reporte: (_r, fecha) => (ref && fecha === dia ? reporteCon(ref) : reporteVacio()) });
  const p2 = await m2.s.preparar(ctx(), doc()); ref = p2.referencia; m2.autorizar(p2.referencia); await m2.s.certificar(ctx(), doc(), confirmar(p2)); assert.equal(m2.envios(), 1, "con la ventana por defecto (7 días) no se alcanza a ver un día 9 días atrás");
  const m3 = mundo({ prevueloDias: 10, reporte: (_r, fecha) => (ref && fecha === dia ? reporteCon(ref) : reporteVacio()) });
  const p3 = await m3.s.preparar(ctx(), doc()); ref = p3.referencia; m3.autorizar(p3.referencia); const r3 = await m3.s.certificar(ctx(), doc(), confirmar(p3)); assert.equal(m3.envios(), 0); assert.equal(r3.operacion.estado, "desconocida");
});

Deno.test("chequeo previo: sin referencia en Digifact se envía UNA vez (8 consultas de solo lectura antes); con una duda (reporte caído o ilegible) NO se envía, no se reintenta solo y la operación sigue «preparada»", async () => {
  const ok1 = mundo(); const p = await ok1.s.preparar(ctx(), doc()); ok1.autorizar(p.referencia); await ok1.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(ok1.envios(), 1); assert.equal(reportes(ok1), 8, "el día de la emisión y 7 hacia atrás, todos de solo lectura");
  for (const [nombre, falla] of [["reporte caído (500)", () => ok({}, 500)], ["reporte ilegible", () => ({ estado: 200, cuerpo: "<html>" })], ["reporte sin filas ni respuesta clara", () => ok({ REQUEST_DATA: [{}], RESPONSE: [] })]] as const) {
    let sano = false; const m = mundo({ reporte: () => (sano ? reporteVacio() : falla()) });
    const q = await m.s.preparar(ctx(), doc()); m.autorizar(q.referencia);
    await rechaza(m.s.certificar(ctx(), doc(), confirmar(q)), "PREVUELO");
    assert.equal(m.envios(), 0, `${nombre}: no se envió nada`); assert.equal(reportes(m), 1, `${nombre}: una sola consulta, sin reintento automático`);
    assert.equal((await m.s.estadoDocumento(ctx(), "d1"))[0].estado, "preparada", `${nombre}: la operación sigue preparada (no bloquea ni queda «enviando»)`);
    sano = true; const r = await m.s.certificar(ctx(), doc(), confirmar(q)); assert.equal(r.operacion.estado, "certificada"); assert.equal(m.envios(), 1, `${nombre}: una persona lo repite y entonces se envía UNA vez`);
  }
});

Deno.test("resultado desconocido tras enviar: no hay reintento automático — repetir, volver a preparar y conciliar sin hallazgo jamás vuelven a enviar", async () => {
  const m = mundo({ certificar: () => { throw new Error("corte"); } });   // el reporte nunca la tiene
  const p = await m.s.preparar(ctx(), doc()); m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), doc(), confirmar(p));
  assert.equal(r.operacion.estado, "desconocida"); assert.equal(m.envios(), 1);
  for (let i = 0; i < 3; i++) { assert.equal((await m.s.certificar(ctx(), doc(), confirmar(p))).reutilizada, true); await rechaza(m.s.preparar(ctx(), doc()), "ESTADO"); assert.equal((await m.s.conciliar(ctx(), p.operacionId)).resultado, "no_encontrado"); }
  assert.equal(m.envios(), 1, "tras la incertidumbre, nada se reenvía por sí solo");
});

// ---- RENOVACIÓN de una preparación vencida (misma operación y referencia; no autoriza nada; acotada; solo «preparada»)
function relojManual() { let t = AHORA.getTime(); return { ahora: () => new Date(t), avanza: (min: number) => { t += min * 60_000; } }; }
const identidad = (o: { id: string; referencia: string; hash: string; huellaEmisor: string; total: string; fechaEmision: string; intentoDelDocumento: number; creada: number }) => JSON.stringify([o.id, o.referencia, o.hash, o.huellaEmisor, o.total, o.fechaEmision, o.intentoDelDocumento, o.creada]);

Deno.test("renovación: tras vencer, volver a preparar RENUEVA la misma operación (misma referencia, huella e identidad) y se certifica UNA vez", async () => {
  const r = relojManual(); const m = mundo({ ahora: r.ahora });
  const p1 = await m.s.preparar(ctx(), doc()); const antes = identidad((await m.almacen.obtener(EMPRESA_A, p1.operacionId))!);
  r.avanza(31); const confirma = confirmar(p1);
  await rechaza(m.s.certificar(ctx(), doc(), confirma), "ESTADO"); assert.equal(m.llamadas.length, 0, "vencida: no se envía");
  const p2 = await m.s.preparar(ctx(), doc());
  assert.deepEqual([p2.operacionId, p2.referencia, p2.huellaEmisor, p2.reutilizada, p2.renovada, p2.renovaciones], [p1.operacionId, p1.referencia, p1.huellaEmisor, true, true, 1], "la misma operación, renovada");
  assert.ok(p2.caducaEnMs > 29 * 60_000, "vuelve a tener vigencia");
  assert.equal(identidad((await m.almacen.obtener(EMPRESA_A, p2.operacionId))!), antes, "la identidad fiscal no cambia");
  assert.equal((await m.almacen.deDocumento(EMPRESA_A, "d1")).length, 1, "NO se creó una segunda operación");
  // renovar NO autoriza: sin la autorización expresa de la referencia no sale nada
  await rechaza(m.s.certificar(ctx(), doc(), confirmar(p2)), "PRUEBA_NO_AUTORIZADA"); assert.equal(m.llamadas.filter((l) => l.ruta.startsWith("/v2/transform")).length, 0);
  m.autorizar(p2.referencia); const c = await m.s.certificar(ctx(), doc(), confirmar(p2)); assert.equal(c.operacion.estado, "certificada"); assert.equal(m.envios(), 1, "un solo envío");
  const otra = await m.s.certificar(ctx(), doc(), confirmar(p2)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1, "ni repitiendo");
  assert.ok(m.aud.some((a) => a.evento === "digifact_test.preparada_renovada"), "la renovación queda auditada");
});

Deno.test("renovación: dentro de la vigencia no se renueva (reutiliza) y no se puede renovar indefinidamente: tras 3 renovaciones se descarta SIN enviar y se prepara otra", async () => {
  const r = relojManual(); const m = mundo({ ahora: r.ahora });
  const p0 = await m.s.preparar(ctx(), doc()); r.avanza(5); const igual = await m.s.preparar(ctx(), doc()); assert.deepEqual([igual.operacionId, igual.renovada, igual.renovaciones], [p0.operacionId, false, 0], "vigente: no se renueva");
  for (let i = 1; i <= MAX_RENOVACIONES; i++) { r.avanza(31); const p = await m.s.preparar(ctx(), doc()); assert.deepEqual([p.operacionId, p.renovada, p.renovaciones], [p0.operacionId, true, i]); }
  r.avanza(31); const nueva = await m.s.preparar(ctx(), doc());   // 4.º vencimiento: sin más renovaciones
  assert.notEqual(nueva.operacionId, p0.operacionId); assert.notEqual(nueva.referencia, p0.referencia, "referencia NUEVA: otro intento");
  const ops = await m.almacen.deDocumento(EMPRESA_A, "d1"); const vieja = ops.find((o) => o.id === p0.operacionId)!;
  assert.deepEqual([vieja.estado, vieja.resultado?.codigo], ["no_enviada", "preparacion_caducada"]); assert.equal(m.llamadas.length, 0, "NUNCA se envió nada");
  assert.ok(m.aud.some((a) => a.evento === "digifact_test.preparada_descartada" && a.detalle.enviada === false));
});

Deno.test("renovación: pasadas 24 h desde su creación la preparación no se renueva aunque le queden renovaciones", async () => {
  const r = relojManual(); const m = mundo({ ahora: r.ahora }); const p0 = await m.s.preparar(ctx(), doc());
  r.avanza(25 * 60); const p = await m.s.preparar(ctx(), doc());
  assert.notEqual(p.operacionId, p0.operacionId); assert.equal((await m.almacen.obtener(EMPRESA_A, p0.operacionId))!.estado, "no_enviada"); assert.equal(m.llamadas.length, 0);
});

Deno.test("renovación: una operación «enviando», «certificada» o «desconocida» NUNCA se renueva ni se reemplaza (un resultado incierto sigue bloqueando)", async () => {
  for (const estado of ["enviando", "desconocida", "certificada"] as const) {
    const r = relojManual(); const m = mundo({ ahora: r.ahora }); const p = await m.s.preparar(ctx(), doc());
    await m.almacen.transicion(EMPRESA_A, p.operacionId, ["preparada"], { estado: "enviando", actualizada: r.ahora().getTime() + 1 });
    if (estado !== "enviando") await m.almacen.transicion(EMPRESA_A, p.operacionId, ["enviando"], { estado, actualizada: r.ahora().getTime() + 2, ...(estado === "desconocida" ? { resultado: { motivoDesconocido: "corte" } } : { resultado: { autorizacion: "A7220268-0BCF-4C35-9661-6791E5ADF2DC", serie: "A", numero: "1" } }) });
    r.avanza(60); const antes = identidad((await m.almacen.obtener(EMPRESA_A, p.operacionId))!);
    await rechaza(m.s.preparar(ctx(), doc()), "ESTADO");
    const despues = (await m.almacen.deDocumento(EMPRESA_A, "d1")); assert.equal(despues.length, 1, `${estado}: no se creó otra`); assert.equal(despues[0].estado, estado); assert.equal(identidad(despues[0]), antes); assert.equal(despues[0].renovaciones ?? 0, 0, `${estado}: no se renovó`);
    assert.equal(m.llamadas.length, 0);
  }
});

/* ---------------------------------------------------------------- tipos de documento (catálogo): solo FACT certifica; los demás se validan y se previsualizan */
const ORIGEN_NOTA = { tipo: "FACT", autorizacion: AUT, fechaEmision: "2026-11-01", serie: "BDE0DEC2", numero: "5", receptorId: "CF" };
const docTipo = (tipoDte: string, extra: Partial<DocumentoFel> = {}) => doc(EMPRESA_A, "dt-" + tipoDte, { tipoDte, ...extra });

Deno.test("tipos: un documento sin tipo es FACT y su validación sigue igual (certificable, sin aviso)", async () => {
  const m = mundo(); const r = await m.s.validar(ctx(), doc());
  assert.equal(r.ok, true); assert.equal(r.tipo, "FACT"); assert.equal(r.certificable, true); assert.equal("aviso" in r, false);
  const r2 = await m.s.validar(ctx(), docTipo("FACT")); assert.deepEqual({ ...r2 }, { ...r }, "FACT explícito = FACT implícito");
});
Deno.test("tipos: NCRE/NDEB/RECI se validan con sus reglas propias sin tocar la red, y avisan que aún no certifican", async () => {
  const m = mundo();
  for (const d of [docTipo("NCRE", { origen: ORIGEN_NOTA, motivoAjuste: "Devolución de mercadería" }), docTipo("NDEB", { origen: ORIGEN_NOTA, motivoAjuste: "Cargo adicional" }),
    docTipo("RECI", { tipoRecibo: "Colegio", receptor: { tipoId: "NIT", id: "44653948", nombre: "RECEPTOR" } })]) {
    const r = await m.s.validar(ctx(), d); assert.equal(r.ok, true, d.tipoDte + " " + JSON.stringify(r.errores)); assert.equal(r.certificable, false); assert.match(String(r.aviso), /solo validación y vista previa/);
  }
  assert.equal(m.llamadas.length, 0, "validar no llama a Digifact"); assert.equal(m.envios(), 0);
  // reglas propias: una nota sin origen o un recibo sin tipo NO son válidos
  assert.equal((await m.s.validar(ctx(), docTipo("NCRE"))).ok, false);
  assert.ok((await m.s.validar(ctx(), docTipo("NCRE", { origen: ORIGEN_NOTA }))).errores.some((e) => e.campo === "motivo_ajuste"));
  assert.ok((await m.s.validar(ctx(), docTipo("RECI", { receptor: { tipoId: "NIT", id: "44653948", nombre: "R" } }))).errores.some((e) => e.campo === "tipo_recibo"));
  assert.ok((await m.s.validar(ctx(), docTipo("FCAM"))).errores.some((e) => e.campo === "tipoDoc"), "un tipo pendiente no es válido");
});
Deno.test("tipos: preparar y certificar un tipo no implementado se RECHAZAN antes de guardar o enviar nada (ni TEST ni real)", async () => {
  const m = mundo();
  for (const t of ["NCRE", "NDEB", "RECI", "FCAM", "FPEQ"]) {
    const d = docTipo(t, { origen: ORIGEN_NOTA, motivoAjuste: "Devolución", tipoRecibo: "Colegio" });
    await rechaza(m.s.preparar(ctx(), d), "TIPO_NO_HABILITADO");
    await rechaza(m.s.certificar(ctx(), d, { operacionId: "x", confirmacion: CONFIRMACION_TEST, referencia: "y", huellaEmisor: HUELLA }), "TIPO_NO_HABILITADO");
    assert.deepEqual(await m.almacen.deDocumento(EMPRESA_A, d.id), [], "no se guardó ninguna operación");
  }
  assert.equal(m.llamadas.length, 0); assert.equal(m.envios(), 0, "no se envió nada a Digifact");
  // FACT sigue pudiendo prepararse
  const p = await m.s.preparar(ctx(), doc()); assert.ok(p.operacionId);
});

/* ---------------------------------------------------------------- FECHA DE EMISIÓN ELEGIDA (hasta 5 días calendario atrás; zona de Guatemala; el reloj del servidor decide) */
const gtHora = (fechaHora: string) => new Date(`${fechaHora}-06:00`);
const relojDe = (inicio: string) => { let t = gtHora(inicio).getTime(); return { ahora: () => new Date(t), a: (fechaHora: string) => { t = gtHora(fechaHora).getTime(); } }; };

Deno.test("fecha elegida: hoy y de 1 a 5 días atrás viajan en Header.IssuedDateTime con la hora de Guatemala; la certificación NO la sustituye por la fecha actual", async () => {
  for (let n = 0; n <= 5; n++) {
    const m = mundo({ ahora: () => gtHora("2026-11-25T10:00:00") });   // 25/11/2026, 10:00 en Guatemala
    const fecha = `2026-11-${String(25 - n).padStart(2, "0")}`, d = doc(EMPRESA_A, `d${n}`, { fechaEmisionPrevista: fecha });
    const p = await m.s.preparar(ctx(), d); assert.equal(p.fechaEmision, `${fecha}T10:00:00-06:00`, "el resumen muestra la fecha elegida");
    m.autorizar(p.referencia); const r = await m.s.certificar(ctx(), d, confirmar(p)); assert.equal(r.operacion.estado, "certificada");
    const nuc = nucEnviado(m); assert.equal(nuc.Header.IssuedDateTime, `${fecha}T10:00:00-06:00`, `${n} días atrás`); assert.match(nuc.Header.IssuedDateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-06:00$/);
    assert.equal(r.operacion.fechaEmision, `${fecha}T10:00:00-06:00`, "la operación conserva la fecha de emisión elegida");
    assert.equal(r.operacion.resultado?.autorizacion, AUT, "la autorización y la fecha de certificación las pone el certificador (aquí no se escriben)");
  }
});

Deno.test("fecha elegida: 6 días atrás y un día futuro se rechazan al validar y al preparar; no se guarda ni se envía nada y la fecha no se corrige sola", async () => {
  for (const [fecha, texto] of [["2026-11-19", /anterior al 20\/11\/2026/], ["2026-11-26", /no puede ser futura/], ["2026-02-31", /no existe/], ["25/11/2026", /formato/]] as const) {
    const m = mundo({ ahora: () => gtHora("2026-11-25T10:00:00") }), d = doc(EMPRESA_A, "d1", { fechaEmisionPrevista: fecha });
    const v = await m.s.validar(ctx(), d); assert.equal(v.ok, false); assert.ok(v.errores.some((e) => e.campo === "fechaEmision" && texto.test(e.mensaje)), `${fecha}: ${JSON.stringify(v.errores)}`);
    await assert.rejects(m.s.preparar(ctx(), d), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "FECHA_EMISION" && texto.test(e.message), fecha);
    assert.equal((await m.almacen.deDocumento(EMPRESA_A, "d1")).length, 0, "no se creó ninguna operación"); assert.equal(m.envios(), 0); assert.equal(m.llamadas.filter((l) => l.ruta.startsWith("/v2/")).length, 0);
    assert.equal(d.fechaEmisionPrevista, fecha, "el servicio no modifica la fecha del documento");
  }
});

Deno.test("entre las 18:00 y las 23:59 de Guatemala (UTC ya es el día siguiente) «hoy» sigue siendo el día de Guatemala: el NUC lleva esa fecha y mañana se rechaza", async () => {
  for (const h of ["18:00:00", "21:30:15", "23:59:59"]) {
    const m = mundo({ ahora: () => gtHora(`2026-11-24T${h}`) });
    const hoy = doc(EMPRESA_A, "h", { fechaEmisionPrevista: "2026-11-24" }), p = await m.s.preparar(ctx(), hoy); assert.equal(p.fechaEmision, `2026-11-24T${h}-06:00`);
    await assert.rejects(m.s.preparar(ctx(), doc(EMPRESA_A, "m", { fechaEmisionPrevista: "2026-11-25" })), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "FECHA_EMISION" && /futura/.test(e.message), "con UTC mañana habría parecido hoy");
  }
});

Deno.test("borrador que vence antes de certificar: se REVALIDA justo antes de enviar, no se envía nada y la fecha NO se cambia sola", async () => {
  const r = relojDe("2026-11-24T23:50:00"), m = mundo({ ahora: r.ahora });
  const d = doc(EMPRESA_A, "d1", { fechaEmisionPrevista: "2026-11-19" });   // el último día válido a las 23:50 del 24/11 (5 días atrás)
  const p = await m.s.preparar(ctx(), d); m.autorizar(p.referencia);
  r.a("2026-11-25T00:10:00");   // pasó la medianoche: la fecha ya tiene 6 días y la preparación (20 min) aún no caducó
  await assert.rejects(m.s.certificar(ctx(), d, confirmar(p)), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "FECHA_EMISION" && /Elige otra fecha/.test(e.message));
  assert.equal(m.envios(), 0, "no salió nada hacia Digifact"); assert.equal(d.fechaEmisionPrevista, "2026-11-19", "la fecha del borrador no se tocó");
  const ops = await m.almacen.deDocumento(EMPRESA_A, "d1"); assert.equal(ops.length, 1); assert.equal(ops[0].estado, "preparada", "la operación sigue preparada (nunca se envió) y no se reescribió su fecha"); assert.equal(ops[0].fechaEmision, "2026-11-19T23:50:00-06:00");
  await assert.rejects(m.s.preparar(ctx(), d), (e: unknown) => e instanceof ErrorFelGt && e.codigo === "FECHA_EMISION", "volver a prepararlo con la misma fecha tampoco la acepta");
});

Deno.test("cambio de día con el borrador abierto: lo que era «hoy» sigue valiendo como «ayer» y el NUC conserva la fecha preparada (no la de ahora)", async () => {
  const r = relojDe("2026-11-24T23:50:00"), m = mundo({ ahora: r.ahora });
  const d = doc(EMPRESA_A, "d1", { fechaEmisionPrevista: "2026-11-24" }), p = await m.s.preparar(ctx(), d); m.autorizar(p.referencia);
  r.a("2026-11-25T00:10:00");
  const c = await m.s.certificar(ctx(), d, confirmar(p)); assert.equal(c.operacion.estado, "certificada");
  assert.equal(nucEnviado(m).Header.IssuedDateTime, "2026-11-24T23:50:00-06:00", "la fecha de emisión es la elegida, aunque ya sea otro día");
});

Deno.test("cambiar la fecha después de preparar es cambiar el documento: certificar con otra fecha se rechaza y preparar de nuevo da OTRA referencia", async () => {
  const m = mundo({ ahora: () => gtHora("2026-11-25T10:00:00") });
  const a = doc(EMPRESA_A, "d1", { fechaEmisionPrevista: "2026-11-24" }), b = doc(EMPRESA_A, "d1", { fechaEmisionPrevista: "2026-11-23" });
  const p = await m.s.preparar(ctx(), a); m.autorizar(p.referencia);
  await rechaza(m.s.certificar(ctx(), b, confirmar(p)), "DOCUMENTO_CAMBIO"); assert.equal(m.envios(), 0);
  const q = await m.s.preparar(ctx(), b); assert.notEqual(q.referencia, p.referencia, "otra fecha, otra referencia"); assert.equal(q.fechaEmision, "2026-11-23T10:00:00-06:00");
  const igual = await m.s.preparar(ctx(), a); assert.equal(igual.referencia, p.referencia, "la misma fecha conserva la misma referencia (idempotente)");
});

Deno.test("un documento sin fecha elegida (anterior al selector) conserva su comportamiento: la fecha y hora actuales de Guatemala", async () => {
  const m = mundo({ ahora: () => gtHora("2026-11-24T22:15:00") }), p = await m.s.preparar(ctx(), doc()); assert.equal(p.fechaEmision, "2026-11-24T22:15:00-06:00");
});

Deno.test("notas: la fecha elegida no puede ser anterior a la del documento de origen; y NCRE, NDEB y RECI siguen sin certificarse", async () => {
  const origen = { tipo: "FACT", autorizacion: AUT, fechaEmision: "2026-11-23", serie: "A001", numero: "5", receptorId: "44653948" };
  const nota = (tipo: string, fecha: string) => doc(EMPRESA_A, "n1", { tipoDte: tipo, fechaEmisionPrevista: fecha, receptor: { tipoId: "NIT", id: "44653948", nombre: "EMPRESA DE PRUEBA, S.A." }, origen, motivoAjuste: "Devolución" } as Partial<DocumentoFel>);
  const m = mundo({ ahora: () => gtHora("2026-11-25T10:00:00") });
  for (const tipo of ["NCRE", "NDEB"]) {
    const antes = await m.s.validar(ctx(), nota(tipo, "2026-11-22")); assert.ok(antes.errores.some((e) => /no puede ser anterior al documento/.test(e.mensaje)), `${tipo} anterior a su origen`);
    const bien = await m.s.validar(ctx(), nota(tipo, "2026-11-24")); assert.ok(!bien.errores.some((e) => e.campo.startsWith("documento_origen.fechaEmision")), `${tipo}: ${JSON.stringify(bien.errores)}`); assert.equal(bien.certificable, false);
    await rechaza(m.s.preparar(ctx(), nota(tipo, "2026-11-24")), "TIPO_NO_HABILITADO");
  }
  await rechaza(m.s.preparar(ctx(), doc(EMPRESA_A, "r1", { tipoDte: "RECI", fechaEmisionPrevista: "2026-11-24", tipoRecibo: "pago" } as Partial<DocumentoFel>)), "TIPO_NO_HABILITADO");
  assert.equal(m.envios(), 0);
});

Deno.test("NCRE en TEST (cuando el despliegue la habilita): se prepara y se certifica UNA vez con su referencia al origen y su motivo; NDEB, RECI y los pendientes siguen bloqueados", async () => {
  const m = mundo({ tipoTest: (c) => c === "NCRE" }); m.autorizar(AUTORIZACION_CICLO);
  const d = docTipo("NCRE", { origen: ORIGEN_NOTA, motivoAjuste: "Devolución de mercadería" });
  const p = await m.s.preparar(ctx(), d); assert.equal(m.envios(), 0, "preparar no envía");
  const r = await m.s.certificar(ctx(), d, confirmar(p)); assert.equal(r.operacion.estado, "certificada"); assert.equal(m.envios(), 1);
  const envio = m.llamadas.find((l) => l.ruta.startsWith("/v2/transform/nuc_json"))!, cuerpo = envio.cuerpo!;
  assert.ok(cuerpo.includes("NCRE"), "el DTE enviado es una nota de crédito"); assert.ok(cuerpo.includes(AUT), "referencia la autorización del origen"); assert.ok(cuerpo.includes("BDE0DEC2"), "y su serie"); assert.ok(cuerpo.includes("Devolución de mercadería"), "y el motivo");
  // idempotente: certificar otra vez no reenvía
  const otra = await m.s.certificar(ctx(), d, confirmar(p)); assert.equal(otra.reutilizada, true); assert.equal(m.envios(), 1);
  // lo que el despliegue no habilitó sigue bloqueado, aunque exista el gancho
  for (const t of ["NDEB", "RECI", "FCAM", "FPEQ"]) {
    const x = docTipo(t, { origen: ORIGEN_NOTA, motivoAjuste: "Cargo", tipoRecibo: "Colegio" });
    await rechaza(m.s.preparar(ctx(), x), "TIPO_NO_HABILITADO"); assert.deepEqual(await m.almacen.deDocumento(EMPRESA_A, x.id), []);
  }
  // un tipo PENDIENTE jamás certifica, ni con un gancho que lo permita
  const todo = mundo({ tipoTest: () => true }); todo.autorizar(AUTORIZACION_CICLO);
  await rechaza(todo.s.preparar(ctx(), docTipo("FCAM")), "TIPO_NO_HABILITADO"); await rechaza(todo.s.preparar(ctx(), docTipo("FPEQ")), "TIPO_NO_HABILITADO");
  // sin la autorización del ciclo de pruebas tampoco se certifica una NCRE
  const sin = mundo({ tipoTest: (c) => c === "NCRE" }); const ps = await sin.s.preparar(ctx(), d); await rechaza(sin.s.certificar(ctx(), d, confirmar(ps)), "PRUEBA_NO_AUTORIZADA"); assert.equal(sin.envios(), 0);
});
