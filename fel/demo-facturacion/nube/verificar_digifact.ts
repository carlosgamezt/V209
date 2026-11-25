// VERIFICACIÓN EN SECO de la configuración de Digifact TEST (solo lectura: no llama a Digifact, no toca la función ni la base). La ejecuta «publicar-nube» en modo «verificar» con digifact=habilitado.
// Aplica EXACTAMENTE las mismas comprobaciones que hará la función al arrancar (crearDigifactDesdeEntorno) más las del despliegue, y dice SI/NO por requisito. Nunca imprime valores (ni NIT, ni usuario, ni contraseña, ni emisor, ni huella).
import { crearDigifactDesdeEntorno } from "../src/digifact_entorno.ts";
import { crearDigifactGt } from "../../proveedores/src/digifact_gt.ts";
const env = (k: string) => Deno.env.get(k) || undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPRESA_ANA = "10000000-0000-0000-0000-0000000000d0";   // la empresa de «ana» en nexa-demo (la imprime «empresa-demo» y la comprueba la publicación)
let mal = 0; const fila = (ok: boolean, txt: string) => { console.log(`  ${ok ? "SI " : "NO "} ${txt}`); if (!ok) mal++; };
console.log("== Verificación en seco de Digifact TEST (solo SI/NO; sin valores)");
for (const v of ["FEL_DIGIFACT_TEST_EMPRESA", "DIGIFACT_TEST_USERNAME", "DIGIFACT_TEST_PASSWORD", "DIGIFACT_TEST_NIT", "FEL_DIGIFACT_TEST_EMISOR", "FEL_DIGIFACT_TEST_HUELLA"]) fila(!!env(v), `existe ${v}`);
console.log("  --  el NIT del emisor sale SOLO de DIGIFACT_TEST_NIT: el campo «nit» del JSON del emisor, si lo trae, se ignora");
const emp = env("FEL_DIGIFACT_TEST_EMPRESA") ?? ""; fila(UUID.test(emp), "FEL_DIGIFACT_TEST_EMPRESA es un UUID"); fila(emp.toLowerCase() === EMPRESA_ANA, "FEL_DIGIFACT_TEST_EMPRESA es la empresa de «ana» (…0d0)");
fila(/^[0-9a-f]{16}$/.test(env("FEL_DIGIFACT_TEST_HUELLA") ?? ""), "FEL_DIGIFACT_TEST_HUELLA tiene 16 caracteres hexadecimales");
for (const v of ["DIGIFACT_TEST_USERNAME", "DIGIFACT_TEST_PASSWORD", "DIGIFACT_TEST_NIT", "FEL_DIGIFACT_TEST_EMPRESA", "FEL_DIGIFACT_TEST_HUELLA"]) { const x = env(v) ?? ""; fila(!/['\n\r]/.test(x), `${v} sin comilla simple ni salto de línea (el despliegue las rechaza)`); }
const r = await crearDigifactDesdeEntorno(env, {});   // las MISMAS reglas que aplicará la función: JSON/base64 del emisor, NIT del emisor = NIT de las credenciales, huella aprobada = huella calculada
fila(!!r.servicio, `la función podría habilitarse con estos valores (datos del emisor + huella aprobada, que incluye el NIT de las credenciales)${r.servicio ? "" : ` — motivo: ${r.motivo}`}`);
// COMPROBACIÓN INDEPENDIENTE contra Digifact TEST (solo lectura: un inicio de sesión; el usuario de Digifact lleva el NIT, así que solo entra si esa cuenta y ese NIT existen allí). Nunca se imprime el token ni valor alguno.
if (r.servicio) {
  try { const c = crearDigifactGt({ ambiente: "test", nit: env("DIGIFACT_TEST_NIT")!.trim(), usuario: env("DIGIFACT_TEST_USERNAME")!, obtenerClave: () => env("DIGIFACT_TEST_PASSWORD") ?? "" }); await c.token(); fila(true, "Digifact TEST acepta el inicio de sesión de esa cuenta con ese NIT (comprobación en línea, solo lectura)"); }
  catch (e) { fila(false, `Digifact TEST no aceptó el inicio de sesión con ese NIT y usuario — ${e instanceof Error ? e.message.slice(0, 160) : "error"}`); }
}
const ref = env("FEL_DIGIFACT_AUTORIZA_REFERENCIA") ?? ""; fila(ref === "" || ref === "CICLO-TEST" || UUID.test(ref), "digifact_referencia vacía, CICLO-TEST o un GUID");
console.log(mal === 0 ? "RESULTADO: configuración COMPLETA: se puede publicar con Digifact TEST." : `RESULTADO: faltan o fallan ${mal} requisito(s): corrige lo marcado NO y vuelve a verificar.`);
Deno.exit(mal === 0 ? 0 : 1);
