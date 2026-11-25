// El emisor de Digifact TEST llega a la función como JSON o como BASE64 del JSON (su domicilio puede traer comillas y barras); la huella aprobada se comprueba igual en ambos casos.
import assert from "node:assert/strict";
import { crearDigifactDesdeEntorno } from "../src/digifact_entorno.ts";
import { huellaEmisor, type DatosEmisor } from "../../proveedores/src/datos_emisor.ts";
const D: DatosEmisor = { nit: "5888492", nombre: "TEST GENS", nombreComercial: 'ESTABLECIMIENTO "TEST GEN"', afiliacionIva: "GEN", codigoEstablecimiento: "2", correo: "",
  direccion: { direccion: '0 AVENIDA APTO. \\108\\ "CONDOMINIO NIMAJUYU I" ZONA 21', codigoPostal: "01021", municipio: "Guatemala", departamento: "GUATEMALA", pais: "GT" }, frases: [{ tipo: 1, escenario: 2 }] };
const base = async (emisor: string, huella?: string) => ({ FEL_DIGIFACT_TEST: "habilitado", FEL_DIGIFACT_TEST_EMPRESA: "10000000-0000-0000-0000-0000000000d0", DIGIFACT_TEST_USERNAME: "USUARIO_TEST", DIGIFACT_TEST_PASSWORD: "clave", DIGIFACT_TEST_NIT: "5888492",
  FEL_DIGIFACT_TEST_EMISOR: emisor, FEL_DIGIFACT_TEST_HUELLA: huella ?? await huellaEmisor(D) }) as Record<string, string>;
Deno.test("el emisor se acepta como JSON y como base64 del JSON (con comillas y barras en el domicilio); la huella siempre se comprueba", async () => {
  const json = JSON.stringify(D), b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  for (const e of [json, b64]) { const m = await base(e); const r = await crearDigifactDesdeEntorno((k) => m[k]); assert.ok(r.servicio, r.motivo); }
  const mal = await base(b64, "0000000000000000"); assert.match((await crearDigifactDesdeEntorno((k) => mal[k])).motivo, /huella/);
  const roto = await base("***no es json ni base64***"); assert.match((await crearDigifactDesdeEntorno((k) => roto[k])).motivo, /JSON/);
});

Deno.test("el NIT del emisor sale SOLO de DIGIFACT_TEST_NIT: el JSON puede omitirlo o traer basura (se ignora), y un NIT ajeno se rechaza por la huella aprobada", async () => {
  const sinNit = (() => { const { nit: _n, ...resto } = D; return JSON.stringify(resto); })();
  const conBasura = JSON.stringify({ ...D, nit: "<5888492>" }), conOtro = JSON.stringify({ ...D, nit: "1234567" });
  for (const e of [sinNit, conBasura, conOtro, btoa(sinNit)]) { const m = await base(e); const r = await crearDigifactDesdeEntorno((k) => m[k]); assert.ok(r.servicio, `${r.motivo}`); }
  // las credenciales son de OTRO NIT: la huella aprobada (que incluye el NIT del emisor del DTE aceptado) ya no coincide ⇒ no se habilita
  const ajeno: Record<string, string> = { ...(await base(sinNit)), DIGIFACT_TEST_NIT: "9999999" }; const r = await crearDigifactDesdeEntorno((k) => ajeno[k]);
  assert.equal(r.servicio, undefined); assert.match(r.motivo, /huella/);
  // sin credenciales completas no se habilita (usuario, contraseña o NIT)
  const sinNitCred: Record<string, string> = { ...(await base(sinNit)) }; delete sinNitCred.DIGIFACT_TEST_NIT; assert.match((await crearDigifactDesdeEntorno((k) => sinNitCred[k])).motivo, /credenciales/);
  // los datos del emisor siguen siendo obligatorios (nombre, domicilio y frases)
  const mal = JSON.stringify({ nombre: "X" }); const m2 = await base(mal); assert.match((await crearDigifactDesdeEntorno((k) => m2[k])).motivo, /datos del emisor/);
});
