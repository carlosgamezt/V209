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
