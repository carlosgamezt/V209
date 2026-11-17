// «consultar-nit-privado» por la LÍNEA DE ÓRDENES (digifact_prueba.ts) como subproceso real. Está separada de pruebas/ porque necesita --allow-run: así el resto de las pruebas conserva sus permisos mínimos.
// Sin red (al subproceso no se le da --allow-net: cualquier intento de conexión fallaría) y con credenciales inventadas.
// Uso: deno test --allow-run="$(command -v deno)" --allow-read pruebas_cli/
import assert from "node:assert/strict";
import { CONFIRMACION_NIT_PRIVADO } from "../src/consulta_nit_privada.ts";

const USUARIO = "GT.000005888492.USUARIO_INVENTADO", CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", NIT = "5888492", NOMBRE = "RAZON SOCIAL INVENTADA PARA PRUEBAS, S.A.";
const SECRETOS = [USUARIO, CLAVE, NIT, NOMBRE, "USUARIO_INVENTADO"];
const sinSecretos = (r: unknown, donde: string) => { const t = typeof r === "string" ? r : JSON.stringify(r); for (const s of SECRETOS) assert.ok(!t.includes(s), `${donde}: la salida no debe contener «${s}»`); };

async function correr(paso: string, env: Record<string, string>) {
  const r = await new Deno.Command(Deno.execPath(), { args: ["run", "--allow-env", "--allow-read", "digifact_prueba.ts", paso], env: { ...env, NO_COLOR: "1" }, clearEnv: true, stdout: "piped", stderr: "piped", cwd: new URL("..", import.meta.url).pathname }).output();
  return { codigo: r.code, salida: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr) };
}
const ENV_CLI = { DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT };
Deno.test("línea de órdenes: «credenciales-presentes» solo imprime sí/no; «consultar-nit-privado» sin confirmación no llega a la red; «consultar-nit» ya no existe", async () => {
  assert.equal(Deno.permissions.querySync({ name: "run", command: Deno.execPath() }).state, "granted", "esta prueba exige --allow-run (no se omite en silencio)");
  const p = await correr("credenciales-presentes", ENV_CLI); assert.equal(p.codigo, 0); assert.deepEqual(JSON.parse(p.salida), { prueba: "credenciales-presentes", ambiente: "TEST", credenciales: { usuario: true, clave: true, nit: true }, cuiPrueba: false, ok: true }); sinSecretos(p.salida, "presentes");
  const q = await correr("credenciales-presentes", { DIGIFACT_TEST_USERNAME: USUARIO }); assert.equal(q.codigo, 1); assert.equal(JSON.parse(q.salida).credenciales.clave, false); sinSecretos(q.salida, "presentes incompletas");
  const s = await correr("consultar-nit-privado", ENV_CLI); assert.equal(s.codigo, 1); assert.equal(JSON.parse(s.salida).motivo, "falta_confirmacion"); sinSecretos(s.salida, "sin confirmación");
  const t = await correr("consultar-nit-privado", { ...ENV_CLI, DIGIFACT_CONFIRMAR: CONFIRMACION_NIT_PRIVADO, DIGIFACT_NIT_CONSULTA: "44653948" }); assert.equal(t.codigo, 1); assert.equal(JSON.parse(t.salida).motivo, "solo_nit_de_la_cuenta"); sinSecretos(t.salida, "NIT ajeno"); assert.ok(!t.salida.includes("44653948"), "ni el NIT escrito a mano se repite");
  const v = await correr("consultar-nit", { ...ENV_CLI, DIGIFACT_NIT_CONSULTA: "44653948" }); assert.equal(v.codigo, 2); assert.match(v.salida, /ya no existe/); sinSecretos(v.salida, "consultar-nit retirado");
});

Deno.test("línea de órdenes: «consultar-cui-privado» sin CUI de prueba o sin confirmación no llega a la red y no imprime datos", async () => {
  assert.equal(Deno.permissions.querySync({ name: "run", command: Deno.execPath() }).state, "granted", "esta prueba exige --allow-run (no se omite en silencio)");
  const CUI = "1234567891234";
  const a = await correr("consultar-cui-privado", ENV_CLI); assert.equal(a.codigo, 1); assert.equal(JSON.parse(a.salida).motivo, "falta_cui_de_prueba"); sinSecretos(a.salida, "sin CUI de prueba"); assert.ok(!a.salida.includes(CUI));
  const b = await correr("consultar-cui-privado", { ...ENV_CLI, DIGIFACT_CUI_PRUEBA: CUI }); assert.equal(b.codigo, 1); assert.equal(JSON.parse(b.salida).motivo, "falta_confirmacion"); assert.ok(!b.salida.includes(CUI), "el CUI de prueba nunca se imprime");
  const c = await correr("credenciales-presentes", { ...ENV_CLI, DIGIFACT_CUI_PRUEBA: CUI }); assert.equal(JSON.parse(c.salida).cuiPrueba, true); assert.ok(!c.salida.includes(CUI));
});
