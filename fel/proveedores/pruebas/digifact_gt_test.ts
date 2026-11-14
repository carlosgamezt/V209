import assert from "node:assert/strict";
import { crearDigifactGt, DigifactGt, ErrorDigifact, nit12, usuarioLogin, URL_BASE } from "../src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp, Transporte } from "../src/digifact.ts";
import { construirNuc } from "../src/nuc_gt.ts";
import { facturaPrueba, REF_PRUEBA } from "./digifact_gt_fixture.ts";

// Todo con transporte SIMULADO («MOCK»): ninguna prueba toca la red ni usa credenciales reales. La contraseña de abajo es inventada.
const CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9";
const AUT = "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (expS: number | null, id = "a") => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(expS === null ? { sub: id } : { sub: id, exp: expS })}.firma-${id}-${"x".repeat(12)}`;
const ok = (o: unknown, estado = 200): RespuestaHttp => ({ estado, cuerpo: typeof o === "string" ? o : JSON.stringify(o) });
type Manejador = (p: PeticionHttp, n: number) => RespuestaHttp | Promise<RespuestaHttp>;
function mundo(manejador: Manejador, opc: { ahora?: () => number; esquema?: "raw" | "bearer"; anular?: boolean; nc?: boolean } = {}) {
  const llamadas: PeticionHttp[] = []; let n = 0;
  const transporte: Transporte = async (p) => { llamadas.push(p); return await manejador(p, ++n); };
  const c = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => CLAVE, transporte, ahora: opc.ahora, esquemaAutorizacion: opc.esquema, permitirAnulacion: opc.anular, permitirNotaCredito: opc.nc });
  return { c, llamadas, logins: () => llamadas.filter((l) => l.ruta === "/login/get_token").length };
}
const esLogin = (p: PeticionHttp) => p.ruta === "/login/get_token";
const loginOk = (tk = jwt(Math.floor(Date.now() / 1000) + 3600)) => ok({ token: tk });
const certOk = { code: "1", message: "Procesado Correctamente", authNumber: AUT, batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-14T10:30:05", responseData1: "PD94bWw=", responseData2: "PCFET0NU", responseData3: "JVBERi0x" };
const nuc = () => construirNuc(facturaPrueba());

Deno.test("Digifact: NIT de 12 dígitos y usuario de inicio de sesión como pide la documentación", () => {
  assert.equal(nit12("5888492"), "000005888492"); assert.equal(nit12("123456"), "000000123456");
  assert.equal(usuarioLogin("5888492", "USUARIO_TEST"), "GT.000005888492.USUARIO_TEST");
  assert.throws(() => nit12("1234567890123"), ErrorDigifact); assert.throws(() => nit12("58-88"), ErrorDigifact); assert.throws(() => usuarioLogin("1", "a b"), ErrorDigifact);
  assert.equal(URL_BASE.test, "https://testnucgt.digifact.com/api");
});

Deno.test("Digifact: producción está BLOQUEADA y las credenciales de TEST no pueden apuntar a otro servidor", () => {
  assert.throws(() => crearDigifactGt({ ambiente: "produccion", nit: "5888492", usuario: "U_TEST", obtenerClave: () => CLAVE }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_permitido");
  const c = crearDigifactGt({ ambiente: "test", nit: "5888492", usuario: "U_TEST", obtenerClave: () => CLAVE, fetchImpl: ((_u: string) => { throw new Error("no debe llamarse en esta prueba"); }) as unknown as typeof fetch });
  assert.ok(c instanceof DigifactGt);
});

Deno.test("Digifact: autenticación — cuerpo exacto de la documentación, token solo en memoria y sin exponer secretos", async () => {
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok({})));
  const tk = await m.c.token();
  assert.ok(tk.split(".").length === 3);
  const l = m.llamadas[0];
  assert.equal(l.metodo, "POST"); assert.equal(l.ruta, "/login/get_token"); assert.equal(l.cabeceras["content-type"], "application/json");
  assert.deepEqual(JSON.parse(l.cuerpo!), { Username: "GT.000005888492.USUARIO_TEST", Password: CLAVE });
  const estado = JSON.stringify(m.c.estadoSesion()); assert.ok(!estado.includes(tk) && !estado.includes(CLAVE));
  assert.ok(!JSON.stringify(m.c).includes(CLAVE), "la contraseña no queda como propiedad del cliente"); assert.ok(!JSON.stringify(m.c).includes(tk));
  assert.equal(m.c.estadoSesion().activa, true);
});

Deno.test("Digifact: 10 solicitudes simultáneas comparten UN solo inicio de sesión", async () => {
  const m = mundo(async (p) => { if (esLogin(p)) { await new Promise((r) => setTimeout(r, 15)); return loginOk(); } return ok({ RESPONSE: [] }); });
  await Promise.all(Array.from({ length: 10 }, () => m.c.token()));
  assert.equal(m.logins(), 1);
  await Promise.all(Array.from({ length: 10 }, () => m.c.consultarNit("44653948")));
  assert.equal(m.logins(), 1, "con token vigente no se vuelve a autenticar");
});

Deno.test("Digifact: renovación controlada — usa el «exp» del JWT con margen, y un valor por defecto si no lo trae", async () => {
  let t = 1_000_000_000_000;   // ms simulados
  const m = mundo((p, n) => (esLogin(p) ? loginOk(jwt(Math.floor(t / 1000) + 300, String(n))) : ok({ RESPONSE: [] })), { ahora: () => t });
  await m.c.token(); await m.c.token(); assert.equal(m.logins(), 1);
  t += 200_000; await m.c.token(); assert.equal(m.logins(), 1, "a 200 s de un vencimiento de 300 s sigue vigente");
  t += 45_000; await m.c.token(); assert.equal(m.logins(), 2, "a menos de 60 s de vencer se renueva antes");
  const s = mundo((p) => (esLogin(p) ? loginOk(jwt(null)) : ok({})), { ahora: () => t });
  await s.c.token(); t += 500_000; await s.c.token(); assert.equal(s.logins(), 1, "sin «exp» rige la vigencia por defecto (600 s)");
  t += 100_000; await s.c.token(); assert.equal(s.logins(), 2);
});

Deno.test("Digifact: un 401 en una solicitud se repite UNA vez con token nuevo; dos solicitudes con 401 renuevan una sola vez", async () => {
  const viejo = jwt(Math.floor(Date.now() / 1000) + 3600, "viejo"), nuevo = jwt(Math.floor(Date.now() / 1000) + 3600, "nuevo");
  const m = mundo((p) => {
    if (esLogin(p)) return loginOk(m.logins() === 1 ? viejo : nuevo);   // el primer inicio de sesión entrega el token que luego «caduca»
    return p.cabeceras.authorization === nuevo ? ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA EJEMPLO S.A." }] }) : ok("", 401);
  });
  const [a, b] = await Promise.all([m.c.consultarNit("44653948"), m.c.consultarNit("44653948")]);
  assert.deepEqual(a, { encontrado: true, nit: "44653948", nombre: "EMPRESA EJEMPLO S.A." }); assert.deepEqual(b, a);
  assert.equal(m.logins(), 2, "un login inicial y UNO solo de renovación");
  const sinPermiso = mundo((p) => (esLogin(p) ? loginOk() : ok("", 401)));
  await assert.rejects(() => sinPermiso.c.consultarNit("44653948"), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_autorizado");
  assert.equal(sinPermiso.logins(), 2, "tras renovar una vez no insiste");
});

Deno.test("Digifact: errores de inicio de sesión (401, 403, 429, 5xx, tiempo, red, cuerpo inválido) sin revelar secretos", async () => {
  const caso = async (r: RespuestaHttp | Error) => { const m = mundo(() => { if (r instanceof Error) throw r; return r; }); try { await m.c.token(); } catch (e) { return e as ErrorDigifact; } throw new Error("debía fallar"); };
  const tiempo = Object.assign(new Error("x"), { name: "TiempoAgotado" }), red = Object.assign(new Error(`falló ${CLAVE}`), { name: "CorteDeRed" });
  const e401 = await caso(ok("usuario o clave inválidos", 401)); assert.equal(e401.tipo, "autenticacion"); assert.equal(e401.estadoHttp, 401);
  assert.equal((await caso(ok("", 403))).tipo, "autenticacion");
  assert.equal((await caso(ok("", 429))).tipo, "limite");
  assert.equal((await caso(ok("", 503))).tipo, "servidor");
  assert.equal((await caso(ok("", 400))).tipo, "solicitud");
  assert.equal((await caso(tiempo)).tipo, "tiempo_agotado");
  assert.equal((await caso(red)).tipo, "corte_de_red");
  assert.equal((await caso(ok("<html>no es json</html>"))).tipo, "respuesta_invalida");
  assert.equal((await caso(ok({ token: "" }))).tipo, "respuesta_invalida");
  assert.equal((await caso(ok({ nada: 1 }))).tipo, "respuesta_invalida");
  for (const r of [ok("", 401), red, tiempo, ok({ token: "" })]) { const e = await caso(r); assert.ok(!e.message.includes(CLAVE) && !JSON.stringify(e).includes(CLAVE), "ningún error contiene la contraseña"); }
});

Deno.test("Digifact: certificar — dirección, parámetros y cabecera según la documentación; resultado certificado con todos los datos fiscales", async () => {
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok(certOk)));
  const r = await m.c.certificar(nuc(), { referencia: REF_PRUEBA, formatos: ["PDF", "HTML", "XML"] });
  assert.equal(r.tipo, "certificado");
  if (r.tipo !== "certificado") return;
  assert.equal(r.autorizacion, AUT); assert.equal(r.serie, "A001"); assert.equal(r.numero, "5"); assert.equal(r.fechaCertificacion, "2026-11-14T10:30:05");
  assert.deepEqual(r.artefactos, { xml: "PD94bWw=", html: "PCFET0NU", pdf: "JVBERi0x" });
  assert.ok(!JSON.stringify(r.crudoSaneado).includes("PD94bWw="), "el registro saneado no lleva los documentos en base64");
  const c = m.llamadas[1], u = new URL("https://x" + c.ruta);
  assert.equal(c.metodo, "POST"); assert.equal(u.pathname, "/v2/transform/nuc_json");
  assert.equal(u.searchParams.get("TAXID"), "000005888492"); assert.equal(u.searchParams.get("FORMAT"), "PDF|HTML|XML"); assert.equal(u.searchParams.get("USERNAME"), "USUARIO_TEST");
  assert.equal(c.cabeceras["content-type"], "application/json"); assert.ok(!c.cabeceras.authorization.startsWith("Bearer "), "por defecto el token va sin prefijo, como en la guía oficial");
  assert.deepEqual(JSON.parse(c.cuerpo!).Seller.TaxID, "5888492");
});

Deno.test("Digifact: esquema de autorización «bearer» disponible por si la primera llamada real lo exigiera", async () => {
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok({ RESPONSE: [] })), { esquema: "bearer" });
  await m.c.consultarNit("44653948"); assert.ok(m.llamadas[1].cabeceras.authorization.startsWith("Bearer "));
});

Deno.test("Digifact: resultados dudosos NUNCA son éxito ni se reenvían (timeout, corte, 5xx, 429, ilegible, éxito sin datos fiscales)", async () => {
  const tiempo = Object.assign(new Error("x"), { name: "TiempoAgotado" }), corte = Object.assign(new Error("x"), { name: "CorteDeRed" });
  const caso = async (resp: RespuestaHttp | Error) => {
    const m = mundo((p) => { if (esLogin(p)) return loginOk(); if (resp instanceof Error) throw resp; return resp; });
    const r = await m.c.certificar(nuc(), { referencia: REF_PRUEBA });
    assert.equal(m.llamadas.filter((l) => l.ruta.startsWith("/v2/transform")).length, 1, "UN solo envío: nunca se reintenta una certificación");
    return r;
  };
  assert.deepEqual(await caso(tiempo), { tipo: "desconocido", motivo: "timeout" });
  assert.deepEqual(await caso(corte), { tipo: "desconocido", motivo: "corte" });
  assert.deepEqual(await caso(ok("", 500)), { tipo: "desconocido", motivo: "limite_o_caida" });
  assert.deepEqual(await caso(ok("", 429)), { tipo: "desconocido", motivo: "limite_o_caida" });
  assert.deepEqual(await caso(ok("<html>", 200)), { tipo: "desconocido", motivo: "respuesta_ilegible" });
  assert.deepEqual(await caso(ok({ code: "1", message: "ok" })), { tipo: "desconocido", motivo: "respuesta_ilegible" });                 // «éxito» sin autorización/serie/número
  assert.deepEqual(await caso(ok({ ...certOk, authNumber: "no-es-uuid" })), { tipo: "desconocido", motivo: "respuesta_ilegible" });
  assert.deepEqual(await caso(ok({ message: "sin código" })), { tipo: "desconocido", motivo: "codigo_no_mapeado" });
  assert.deepEqual(await caso(ok({ code: "500", message: "interno" })), { tipo: "desconocido", motivo: "limite_o_caida" });
});

Deno.test("Digifact: rechazos confirmados (código distinto de 1, 400/406/415) y mensajes limpios de secretos", async () => {
  const caso = async (resp: RespuestaHttp) => { const m = mundo((p) => (esLogin(p) ? loginOk() : resp)); return await m.c.certificar(nuc(), { referencia: REF_PRUEBA }); };
  const a = await caso(ok({ code: "0", message: "Error al transformar: falta el elemento X" })); assert.equal(a.tipo, "rechazado_confirmado");
  if (a.tipo === "rechazado_confirmado") { assert.equal(a.codigo, "0"); assert.match(a.mensaje, /falta el elemento X/); }
  assert.equal((await caso(ok("NUC inválido", 406))).tipo, "rechazado_confirmado");
  assert.equal((await caso(ok("", 415))).tipo, "rechazado_confirmado");
  const s = await caso(ok({ code: "9", message: `eco de la clave ${CLAVE} en el mensaje` }));
  assert.equal(s.tipo, "rechazado_confirmado"); if (s.tipo === "rechazado_confirmado") assert.ok(!s.mensaje.includes(CLAVE), "si Digifact devolviera la clave, se oculta");
  const num = await caso(ok({ code: 0, message: "numérico" })); assert.equal(num.tipo, "rechazado_confirmado", "el código puede venir como número");
  const uno = await caso(ok({ ...certOk, code: 1 })); assert.equal(uno.tipo, "certificado", "el código 1 también puede venir como número");
});

Deno.test("Digifact: un 401 persistente al certificar NO es «desconocido»: no se procesó, se propaga como error", async () => {
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok("", 401)));
  await assert.rejects(() => m.c.certificar(nuc(), { referencia: REF_PRUEBA }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_autorizado");
  const fallaLogin = mundo(() => ok("", 401));
  await assert.rejects(() => fallaLogin.c.certificar(nuc(), { referencia: REF_PRUEBA }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "autenticacion");
  assert.equal(fallaLogin.llamadas.filter((l) => l.ruta.startsWith("/v2")).length, 0, "si no hubo sesión, jamás se envió el documento");
});

Deno.test("Digifact: certificación duplicada — el mismo documento no se envía dos veces a la vez, y se libera al terminar", async () => {
  let libera!: () => void; const espera = new Promise<void>((r) => (libera = r));
  const m = mundo(async (p) => { if (esLogin(p)) return loginOk(); await espera; return ok(certOk); });
  const primero = m.c.certificar(nuc(), { referencia: REF_PRUEBA });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(() => m.c.certificar(nuc(), { referencia: REF_PRUEBA }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_permitido");
  libera(); assert.equal((await primero).tipo, "certificado");
  assert.equal(m.llamadas.filter((l) => l.ruta.startsWith("/v2")).length, 1);
  await assert.rejects(() => m.c.certificar(nuc(), { referencia: "no-es-guid" }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "solicitud");
  assert.equal((await m.c.certificar(nuc(), { referencia: REF_PRUEBA })).tipo, "certificado", "tras terminar, la referencia vuelve a estar libre (el orquestador decide si corresponde reenviar)");
});

Deno.test("Digifact: consulta de NIT (SHARED_GETINFONITcom)", async () => {
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "Empresa Ejemplo S.A." }] })));
  assert.deepEqual(await m.c.consultarNit("44653948"), { encontrado: true, nit: "44653948", nombre: "Empresa Ejemplo S.A." });
  const u = new URL("https://x" + m.llamadas[1].ruta);
  assert.equal(m.llamadas[1].metodo, "GET"); assert.equal(u.pathname, "/Shared");
  assert.deepEqual(Object.fromEntries(u.searchParams), { COUNTRY: "GT", TAXID: "000005888492", DATA1: "SHARED_GETINFONITcom", DATA2: "NIT|44653948", USERNAME: "USUARIO_TEST" });
  const vacio = mundo((p) => (esLogin(p) ? loginOk() : ok({ RESPONSE: [] })));
  assert.deepEqual(await vacio.c.consultarNit("1234567K"), { encontrado: false });
  await assert.rejects(() => m.c.consultarNit("12-34"), ErrorDigifact); await assert.rejects(() => m.c.consultarNit("1; DROP"), ErrorDigifact);
});

Deno.test("Digifact: consulta de DTE (SHARED_GETDTEINFO) y descarga (GetDocument)", async () => {
  const dte = { REQUEST_DATA: [{ Codigo: "1", Mensaje: "Procesado" }], RESPONSE: [{ TIPO_DTE: "FACT", GUID: AUT, SERIE: "A001", NUMERO: "5", FECHA_DE_EMISION: "2026-11-14", NIT_COMPRADOR: "CF", TOTAL: 100.0, DTE: "PD94bWw=" }] };
  const m = mundo((p) => (esLogin(p) ? loginOk() : p.ruta.startsWith("/GetDocument") ? ok({ RESPONSE: [{ ResponseData1: "PD94bWw=", ResponseData2: "", ResponseData3: "JVBERi0x" }] }) : ok(dte)));
  const r = await m.c.consultarDte(AUT.toLowerCase());
  assert.deepEqual(r, { encontrado: true, tipoDte: "FACT", autorizacion: AUT, serie: "A001", numero: "5", fechaEmision: "2026-11-14", nitComprador: "CF", total: "100", xmlB64: "PD94bWw=" });
  assert.equal(new URL("https://x" + m.llamadas[1].ruta).searchParams.get("DATA2"), `AUTHNUMBER|${AUT}`);
  const d = await m.c.obtenerDocumento(AUT, ["PDF", "XML"]);
  assert.deepEqual(d, { encontrado: true, artefactos: { xml: "PD94bWw=", html: undefined, pdf: "JVBERi0x" } });
  const u = new URL("https://x" + m.llamadas[2].ruta); assert.equal(u.pathname, "/GetDocument"); assert.equal(u.searchParams.get("FORMAT"), "PDF|XML"); assert.equal(u.searchParams.get("AUTHNUMBER"), AUT); assert.equal(u.searchParams.get("TAXID"), "000005888492");
  const nada = mundo((p) => (esLogin(p) ? loginOk() : ok({ RESPONSE: [] })));
  assert.deepEqual(await nada.c.obtenerDocumento(AUT), { encontrado: false }); assert.deepEqual(await nada.c.consultarDte(AUT), { encontrado: false });
  await assert.rejects(() => m.c.consultarDte("no-uuid"), ErrorDigifact);
  const caido = mundo((p) => (esLogin(p) ? loginOk() : ok("", 503)));
  await assert.rejects(() => caido.c.obtenerDocumento(AUT), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "servidor");
});

Deno.test("Digifact: conciliación por referencia interna con el reporte diario de acuses (recuperación tras un resultado desconocido)", async () => {
  const fila = { NIT_EMISOR: "5888492", NE: "2", TIPO_DTE: "FACT", GUID: AUT, SERIE: "A001", NUMERO: "5", ESTATUS: "", FECHA_DE_CERTIFICACION: "11/14/2026 10:30:05 AM", TOTAL: "100", REFERENCIA_INTERNA: REF_PRUEBA.toUpperCase(), ACUSE_RECEPCION_ESTADO: "ACEPTADO_SAT" };
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok({ REQUEST_DATA: [{ Respuesta: 1, Descripcion: "2 ITEMS" }], RESPONSE: [{ ...fila, GUID: "OTRO", REFERENCIA_INTERNA: "otra" }, fila] })));
  const r = await m.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA, 2);
  assert.equal(r.tipo, "encontrado");
  if (r.tipo === "encontrado") assert.deepEqual(r.documento, { autorizacion: AUT, serie: "A001", numero: "5", tipoDte: "FACT", fechaCertificacion: "11/14/2026 10:30:05 AM", referenciaInterna: REF_PRUEBA.toUpperCase(), estadoAcuse: "ACEPTADO_SAT", anulado: false, total: "100" });
  assert.equal(new URL("https://x" + m.llamadas[1].ruta).searchParams.get("DATA1"), "SHARED_GETREPORTDAILYACUSES");
  assert.equal(new URL("https://x" + m.llamadas[1].ruta).searchParams.get("DATA2"), "FECHA|2026-11-14|ESTABLECIMIENTO|2");
  const otra = mundo((p) => (esLogin(p) ? loginOk() : ok({ REQUEST_DATA: [{ Respuesta: 1 }], RESPONSE: [{ ...fila, REFERENCIA_INTERNA: "otra" }] })));
  assert.deepEqual(await otra.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA), { tipo: "no_encontrado" });
  const sinDatos = mundo((p) => (esLogin(p) ? loginOk() : ok({ REQUEST_DATA: [{ Respuesta: 0, Mensaje: "No existe el recurso solicitado." }], RESPONSE: [] })));
  assert.deepEqual(await sinDatos.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA), { tipo: "no_encontrado" });
  const caido = mundo((p) => (esLogin(p) ? loginOk() : ok("", 503)));
  assert.equal((await caido.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA)).tipo, "indeterminado", "si la consulta falla, no se concluye nada");
  const raro = mundo((p) => (esLogin(p) ? loginOk() : ok({ RESPONSE: [] })));
  assert.equal((await raro.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA)).tipo, "indeterminado");
  await assert.rejects(() => m.c.conciliarPorReferencia("14-11-2026", REF_PRUEBA), ErrorDigifact);
  const anul = mundo((p) => (esLogin(p) ? loginOk() : ok({ REQUEST_DATA: [{ Respuesta: 1 }], RESPONSE: [{ ...fila, ESTATUS: "ANULADO" }] })));
  const a = await anul.c.conciliarPorReferencia("2026-11-14", REF_PRUEBA); assert.ok(a.tipo === "encontrado" && a.documento.anulado);
});

Deno.test("Digifact: anulación — cerrada salvo habilitación explícita y confirmación literal; cuerpo según la documentación", async () => {
  const datos = { autorizacion: AUT, nitReceptor: "CF", fechaEmision: "2026-11-14T10:25:09", motivo: "Error en datos del receptor", confirmacion: "ANULAR" };
  const cerrada = mundo((p) => (esLogin(p) ? loginOk() : ok({})));
  await assert.rejects(() => cerrada.c.anular(datos), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_permitido");
  assert.equal(cerrada.llamadas.length, 0, "cerrada: ni siquiera inicia sesión");
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok({ Codigo: "1", Mensaje: "Anulación Exitosa", Autorizacion: AUT })), { anular: true });
  await assert.rejects(() => m.c.anular({ ...datos, confirmacion: "si" }), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_permitido");
  await assert.rejects(() => m.c.anular({ ...datos, motivo: "x" }), ErrorDigifact); await assert.rejects(() => m.c.anular({ ...datos, fechaEmision: "14/11/2026" }), ErrorDigifact);
  assert.equal(m.llamadas.length, 0);
  const r = await m.c.anular(datos); assert.equal(r.tipo, "anulado");
  const c = m.llamadas[1]; assert.equal(c.ruta, "/CancelFelGT");
  assert.deepEqual(JSON.parse(c.cuerpo!), { Taxid: "5888492", Autorizacion: AUT, IdReceptor: "CF", FechaEmisionDocumentoAnular: "2026-11-14T10:25:09", MotivoAnulacion: "Error en datos del receptor", Username: "USUARIO_TEST" });
  const rech = mundo((p) => (esLogin(p) ? loginOk() : ok({ Codigo: "0", Mensaje: "no se puede anular" })), { anular: true });
  assert.equal((await rech.c.anular(datos)).tipo, "rechazado_confirmado");
  const tiempo = mundo((p) => { if (esLogin(p)) return loginOk(); throw Object.assign(new Error("x"), { name: "TiempoAgotado" }); }, { anular: true });
  assert.deepEqual(await tiempo.c.anular(datos), { tipo: "desconocido", motivo: "timeout" });
  assert.equal(tiempo.llamadas.filter((l) => l.ruta === "/CancelFelGT").length, 1, "la anulación tampoco se reintenta");
});

Deno.test("Digifact: nota de crédito total — cerrada salvo habilitación y confirmación; respuesta con el mismo esquema que certificar", async () => {
  const datos = { autorizacion: AUT, fechaEmision: "2026-11-14 13:24:00", motivo: "Devolución total", referenciaInterna: "NC-001", confirmacion: "NOTA-CREDITO-TOTAL" };
  const cerrada = mundo((p) => (esLogin(p) ? loginOk() : ok(certOk)));
  await assert.rejects(() => cerrada.c.notaCreditoTotal(datos), (e: unknown) => e instanceof ErrorDigifact && e.tipo === "no_permitido");
  const m = mundo((p) => (esLogin(p) ? loginOk() : ok(certOk)), { nc: true });
  await assert.rejects(() => m.c.notaCreditoTotal({ ...datos, confirmacion: "x" }), ErrorDigifact);
  await assert.rejects(() => m.c.notaCreditoTotal({ ...datos, fechaEmision: "2026-11-14T13:24:00" }), ErrorDigifact);
  const r = await m.c.notaCreditoTotal(datos); assert.equal(r.tipo, "certificado");
  const c = m.llamadas[1]; assert.equal(c.ruta, "/cert/ncredtotal");
  assert.deepEqual(JSON.parse(c.cuerpo!), { Staxid: "5888492", Authnumber: AUT, FechaEmision: "2026-11-14 13:24:00", MotivoAjuste: "Devolución total", Formatos: "xml|pdf", Username: "USUARIO_TEST", ReferenciaInterna: "NC-001" });
});

Deno.test("Digifact: la contraseña y el token no aparecen en ninguna parte de lo que el cliente expone (errores, resultados saneados, estado)", async () => {
  const tk = jwt(Math.floor(Date.now() / 1000) + 3600, "secreto");
  const m = mundo((p) => (esLogin(p) ? ok({ token: tk }) : ok({ ...certOk, message: `eco ${tk} y ${CLAVE}` })));
  const r = await m.c.certificar(nuc(), { referencia: REF_PRUEBA });
  const volcado = JSON.stringify([r, m.c.estadoSesion()]);
  assert.ok(!volcado.includes(tk) && !volcado.includes(CLAVE));
});

Deno.test("Digifact: la factura de prueba del script de pruebas reales produce un NUC válido (sin tocar la red)", async () => {
  const { facturaDePruebaTest } = await import("../digifact_prueba.ts");
  const n = construirNuc(facturaDePruebaTest("5888492", REF_PRUEBA)) as Record<string, any>;
  assert.equal(n.Seller.TaxID, "5888492"); assert.equal(n.Header.DocType, "FACT"); assert.match(n.Header.IssuedDateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-06:00$/);
  assert.equal(n.AdditionalDocumentInfo.AdditionalInfo[0].Code, REF_PRUEBA);
});
