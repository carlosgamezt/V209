// Función Edge INTERNA «nexa-sys» (F4): solo para procesos sin persona (programada o invocada con un secreto). Credencial propia `FEL_SYS_BD_URL` (rol nexa_sys). NO comparte secretos con «nexa-demo».
import { crearBdPg } from "../src/bd.ts";
import { crearManejadorSistema } from "../src/sistema.ts";

let sys: ReturnType<typeof crearBdPg> | null = null;
const manejador = crearManejadorSistema({
  sys: () => { const u = Deno.env.get("FEL_SYS_BD_URL"); if (!u) throw new Error("sin conexión de sistema"); return (sys ??= crearBdPg(u)); },
  secreto: Deno.env.get("FEL_SYS_SECRETO"),
});
if (import.meta.main) Deno.serve(manejador);
export { manejador };
