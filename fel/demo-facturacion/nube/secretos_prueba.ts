// Solo para pruebas locales/CI: imprime «export …» con secretos aleatorios de un solo uso (se evalúan en el intérprete de comandos; nunca se guardan).
import { generar } from "../src/generar_secretos.ts";
const r = generar(["maestro", "maestro2", "ana", "luis", "marta", "pedro", "sofia"], ["maestro", "maestro2"]);
console.log(`export FEL_DEMO_CLAVES='${r.FEL_DEMO_CLAVES}' FEL_DEMO_MFA_SEMILLAS='${r.FEL_DEMO_MFA_SEMILLAS}' FEL_PROXY_SECRETO='${crypto.randomUUID()}${crypto.randomUUID()}'`);
