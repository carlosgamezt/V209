// Correo de la factura enviado por Digifact en la certificación de PRUEBA (TEST) manual: controles y SIMULACIÓN COMPLETA con interruptores apagados y encendidos.
// Todo con transporte SIMULADO sobre el cliente REAL de Digifact: ninguna prueba toca la red ni usa credenciales ni correos reales.
import assert from "node:assert/strict";
import { DigifactGt } from "../src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../src/digifact.ts";
import { construirNuc } from "../src/nuc_gt.ts";
import { conCorreo, CONFIRMACION_CORREO_TEST, enmascarar, estadoDeLaReferencia, listaCerrada, nucParaMostrar, presenciaCorreoPrueba, resolverCorreoDePrueba, sha256Hex, verificarNucConCorreo } from "../src/correo_prueba.ts";
import { facturaDePruebaTest } from "../digifact_prueba.ts";
import type { DatosEmisor } from "../src/datos_emisor.ts";

const EMISOR: DatosEmisor = { nit: "5888492", nombre: "EMISOR DE EJEMPLO", nombreComercial: "ESTABLECIMIENTO DE EJEMPLO", afiliacionIva: "GEN", codigoEstablecimiento: "2", correo: "", direccion: { direccion: "DIRECCION DE EJEMPLO", codigoPostal: "01010", municipio: "Guatemala", departamento: "Guatemala", pais: "GT" }, frases: [{ tipo: 1, escenario: 2 }] };
const REF = "6D2F1C6E-3B0A-5C1F-8E52-0123456789AB", DEST = "prueba.nexa@ejemplo.com";
const env = (o: Record<string, string>) => (k: string) => o[k];
const ENC = { DIGIFACT_CON_CORREO: "si", DIGIFACT_CONFIRMAR_CORREO: CONFIRMACION_CORREO_TEST, DIGIFACT_CORREO_PRUEBA: DEST, DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, @pruebas.example.org` };

Deno.test("correo de prueba: apagado por defecto — sin «con_correo = si» el comportamiento es EXACTAMENTE el de siempre", () => {
  for (const o of ([{}, { DIGIFACT_CON_CORREO: "no" }, { DIGIFACT_CON_CORREO: "" }, { DIGIFACT_CON_CORREO: "SI " }, { DIGIFACT_CORREO_PRUEBA: DEST, DIGIFACT_CORREO_DESTINATARIOS: DEST }] as Record<string, string>[])) assert.deepEqual(resolverCorreoDePrueba(env(o)), { estado: "no_solicitado" }, JSON.stringify(Object.keys(o)));
  const f = facturaDePruebaTest(EMISOR, REF, "2026-11-21T08:00:00-06:00"); const n = construirNuc(f); assert.equal((n.Buyer as Record<string, unknown>).Contact, undefined, "sin correo el NUC no lleva Buyer.Contact");
  assert.deepEqual(presenciaCorreoPrueba(env({})), { correoDePrueba: false, listaDeDestinatarios: false });
  assert.deepEqual(presenciaCorreoPrueba(env(ENC)), { correoDePrueba: true, listaDeDestinatarios: true }, "solo presencia, nunca valores");
});

Deno.test("correo de prueba: la lista cerrada bloquea todo lo no autorizado y la doble confirmación es obligatoria", () => {
  const ok = resolverCorreoDePrueba(env(ENC)); assert.equal(ok.estado, "listo"); if (ok.estado === "listo") { assert.equal(ok.correo, DEST); assert.equal(ok.enmascarado, "p***@ejemplo.com"); }
  const bloq = (o: Record<string, string>) => { const r = resolverCorreoDePrueba(env({ ...ENC, ...o })); assert.equal(r.estado, "bloqueado"); return r.estado === "bloqueado" ? r.motivo : ""; };
  assert.equal(bloq({ DIGIFACT_CONFIRMAR_CORREO: "" }), "falta_confirmacion_correo"); assert.equal(bloq({ DIGIFACT_CONFIRMAR_CORREO: "enviar-correo-test" }), "falta_confirmacion_correo", "el texto es literal");
  assert.equal(bloq({ DIGIFACT_CORREO_PRUEBA: "" }), "falta_correo_de_prueba");
  for (const mal of ["no-es-correo", "a@b", "x y@ejemplo.com", "<s>@pruebas.example.org", "uno@pruebas.example.org,dos@pruebas.example.org", "x".repeat(45) + "@pruebas.example.org"]) assert.equal(bloq({ DIGIFACT_CORREO_PRUEBA: mal }), "correo_no_valido", mal.slice(0, 20));
  assert.equal(bloq({ DIGIFACT_CORREO_PRUEBA: "cliente@dominio-externo.com" }), "destinatario_no_autorizado", "fuera de la lista no se envía");
  assert.equal(bloq({ DIGIFACT_CORREO_PRUEBA: "x@evil.pruebas.example.org.com" }), "destinatario_no_autorizado"); assert.equal(bloq({ DIGIFACT_CORREO_PRUEBA: "x@mipruebas.example.org" }), "destinatario_no_autorizado");
  assert.equal(bloq({ DIGIFACT_CORREO_DESTINATARIOS: "" }), "falta_lista_de_destinatarios", "sin lista no sale nada"); assert.equal(bloq({ DIGIFACT_CORREO_DESTINATARIOS: `${DEST}, basura` }), "lista_no_valida", "un elemento inválido invalida la lista");
  assert.equal(resolverCorreoDePrueba(env({ ...ENC, DIGIFACT_CORREO_PRUEBA: "alguien@pruebas.example.org" })).estado, "listo", "un dominio de la lista sí");
  const lista = listaCerrada("Uno@Ejemplo.com, @pruebas.example.org")!; assert.ok(lista("UNO@EJEMPLO.COM") && !lista("otro@ejemplo.com")); assert.equal(listaCerrada(undefined), null); assert.equal(listaCerrada(""), null);
});

Deno.test("correo de prueba: el NUC con correo cambia SOLO Buyer.Contact y la verificación detecta cualquier otra cosa; el registro nunca muestra el correo completo", () => {
  const f = facturaDePruebaTest(EMISOR, REF, "2026-11-21T08:00:00-06:00"), sin = construirNuc(f), con = construirNuc(conCorreo(f, DEST));
  const v = verificarNucConCorreo(sin, con, DEST); assert.deepEqual(v, { ok: true, problemas: [], cantidad: 1 });
  assert.deepEqual(((con.Buyer as Record<string, any>).Contact), { EmailList: { Email: [DEST] } }); assert.equal((con.Buyer as Record<string, any>).TaxID, "CF"); assert.equal((con.Buyer as Record<string, any>).Name, "CONSUMIDOR FINAL");
  const dos = structuredClone(con) as any; dos.Buyer.Contact.EmailList.Email.push("otro@ejemplo.com"); assert.equal(verificarNucConCorreo(sin, dos, DEST).ok, false, "dos correos");
  const otro = structuredClone(con) as any; otro.Buyer.Contact.EmailList.Email = ["otro@ejemplo.com"]; assert.ok(verificarNucConCorreo(sin, otro, DEST).problemas.includes("el correo del NUC no es el autorizado"));
  const raro = structuredClone(con) as any; raro.Items[0].Description = "cambiada"; assert.ok(verificarNucConCorreo(sin, raro, DEST).problemas.includes("el NUC cambió fuera de Buyer"));
  const fiscal = structuredClone(con) as any; fiscal.Buyer.Name = "OTRO"; assert.ok(verificarNucConCorreo(sin, fiscal, DEST).problemas.includes("los datos fiscales del receptor cambiaron"));
  assert.equal(verificarNucConCorreo(sin, sin, DEST).ok, false, "sin correo no pasa");
  const mostrar = JSON.stringify(nucParaMostrar(con)); assert.ok(!mostrar.includes("prueba.nexa") && mostrar.includes("p***@ejemplo.com"), "el registro lleva el correo enmascarado"); assert.equal(enmascarar("abc@dom.com"), "a***@dom.com");
});

Deno.test("SIMULACIÓN COMPLETA de la prueba: apagado = igual que siempre; encendido = un solo envío con el nodo exacto; repetir la referencia NO vuelve a enviar", async () => {
  const cuerpos: Record<string, any>[] = []; let certificada = false;
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-xxxxxxxxxxxxxxxx`;
  const ok = (o: unknown): RespuestaHttp => ({ estado: 200, cuerpo: JSON.stringify(o) });
  const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
    if (p.ruta === "/login/get_token") return ok({ token: TOKEN });
    if (p.ruta.startsWith("/v2/transform/nuc_json")) { cuerpos.push(JSON.parse(p.cuerpo!)); certificada = true; return ok({ code: "1", message: "Procesado Correctamente", authNumber: "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", batch: "A001", serial: "5", enrolledTimeStamp: "2026-11-21T08:00:05", responseData1: btoa("<xml/>"), responseData3: btoa("%PDF-1.4") }); }
    if (p.ruta.startsWith("/Shared")) return ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: certificada ? [{ REFERENCIA_INTERNA: cuerpos.at(-1)!.AdditionalDocumentInfo.AdditionalInfo[0].Code, AUTORIZACION: "BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764", SERIE: "A001", NUMERO: "5", ESTABLECIMIENTO: "2", ESTATUS: "ACEPTADO", FECHA_CERTIFICACION: "2026-11-21T08:00:05", TIPO_DTE: "FACT" }] : [] });
    return { estado: 404, cuerpo: "{}" };
  };
  const cliente = new DigifactGt({ nit: "5888492", usuario: "USUARIO_TEST", obtenerClave: () => "CLAVE-INVENTADA", transporte });
  const f = facturaDePruebaTest(EMISOR, REF, "2026-11-21T08:00:00-06:00");
  // 1) interruptores APAGADOS: la factura funciona igual que siempre y sale sin Buyer.Contact
  assert.equal(resolverCorreoDePrueba(env({})).estado, "no_solicitado");
  const r0 = await cliente.certificar(construirNuc(f), { referencia: REF, formatos: ["XML", "PDF"] }); assert.equal(r0.tipo, "certificado"); assert.equal(cuerpos.length, 1); assert.equal(cuerpos[0].Buyer.Contact, undefined);
  // 2) encendido: antes de enviar se revisa si la referencia ya existe; una referencia ya certificada BLOQUEA (no se manda un segundo NUC ni un segundo correo)
  assert.equal(await estadoDeLaReferencia(cliente, "2026-11-21", REF, 2), "ya_certificada");
  assert.equal(await estadoDeLaReferencia({ conciliarPorReferencia: () => Promise.reject(new Error("red")) }, "2026-11-21", REF, 2), "consulta_fallida", "si no se puede verificar, NO se envía");
  assert.equal(await estadoDeLaReferencia({ conciliarPorReferencia: () => Promise.resolve({ tipo: "indeterminado", motivo: "x" }) }, "2026-11-21", REF, 2), "consulta_fallida");
  assert.equal(cuerpos.length, 1, "las comprobaciones previas no enviaron nada");
  // 3) referencia NUEVA: se envía UNA vez con el nodo exacto
  certificada = false; const REF2 = "7E3A2D7F-4C1B-5D20-9F63-123456789ABC"; assert.equal(await estadoDeLaReferencia(cliente, "2026-11-21", REF2, 2), "no_encontrada");
  const cp = resolverCorreoDePrueba(env(ENC)); assert.equal(cp.estado, "listo"); if (cp.estado !== "listo") return;
  const f2 = facturaDePruebaTest(EMISOR, REF2, "2026-11-21T08:00:00-06:00"), sin = construirNuc(f2), con = construirNuc(conCorreo(f2, cp.correo)); assert.equal(verificarNucConCorreo(sin, con, cp.correo).ok, true);
  const r1 = await cliente.certificar(con, { referencia: REF2, formatos: ["XML", "PDF"] }); assert.equal(r1.tipo, "certificado"); assert.equal(cuerpos.length, 2);
  assert.deepEqual(cuerpos[1].Buyer.Contact, { EmailList: { Email: [DEST] } }, "el NUC enviado lleva exactamente el correo autorizado"); assert.equal(cuerpos[1].AdditionalDocumentInfo.AdditionalInfo[0].Code, REF2);
  // 4) repetir la ejecución con la misma referencia: queda bloqueada ANTES de enviar
  assert.equal(await estadoDeLaReferencia(cliente, "2026-11-21", REF2, 2), "ya_certificada"); assert.equal(cuerpos.length, 2, "ni segundo NUC ni segundo correo");
  assert.equal((await sha256Hex(new TextEncoder().encode("abc") as Uint8Array<ArrayBuffer>)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
