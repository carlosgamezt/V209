// Aprovisionamiento de la base de la demostración en línea (se ejecuta UNA vez desde tu equipo; también para rotar contraseñas):
//   FEL_DEMO_BD_URL=… FEL_DEMO_CLAVES=… FEL_DEMO_MFA_SEMILLAS=… FEL_DEMO_HOSTS=… deno run -A nube/aprovisionar.ts
// Verifica las migraciones, siembra el mundo simulado si la base está vacía (se niega ante empresas ajenas), y registra las contraseñas (hash PBKDF2 con sal) de las cuentas configuradas.
// No imprime contraseñas, semillas ni la cadena de conexión.
import { crearBdPg } from "../src/bd.ts";
import { AlmacenPg } from "../src/almacen.ts";
import { prepararBase, ErrorAprovisionar } from "../src/aprovisionar.ts";
import { PERSONAS } from "../src/mundo_practico.ts";
import { Sesiones } from "../src/sesiones.ts";
import { leerConfigPublicada } from "../src/publicado.ts";

const url = Deno.env.get("FEL_DEMO_BD_URL");
if (!url) { console.error("Falta FEL_DEMO_BD_URL (la cadena de conexión de la base exclusiva de la demostración)."); Deno.exit(1); }
let cfg; try { cfg = leerConfigPublicada((k) => Deno.env.get(k), Object.keys(PERSONAS)); } catch (e) { console.error(`Configuración no válida: ${(e as Error).message}`); Deno.exit(1); }
const bd = crearBdPg(url);
try {
  await prepararBase(bd, { sembrar: true, aviso: (m) => console.log(`  ${m}`) });
  const sesiones = new Sesiones(undefined, new AlmacenPg(bd));
  for (const [u, c] of Object.entries(cfg.claves)) await sesiones.registrar(u, c, PERSONAS[u]);
  console.log(`  Contraseñas registradas para: ${Object.keys(cfg.claves).join(", ")} (solo como hash). MFA: ${Object.keys(cfg.semillas).join(", ")} (las semillas viven en el secreto de la función, no en la base).`);
  console.log("  Listo. Siguiente paso: desplegar la función y la página (ver docs/demostracion-infraestructura-y-persistencia.md).");
} catch (e) { if (e instanceof ErrorAprovisionar) { console.error(e.message); Deno.exit(1); } throw e; }
finally { await bd.cerrar(); }
