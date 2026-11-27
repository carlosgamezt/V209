// Función Edge INTERNA «nexa-sys» (F4): solo para procesos sin persona (programada o invocada con un secreto). Credencial propia `FEL_SYS_BD_URL` (rol nexa_sys). NO comparte secretos con «nexa-demo».
import { crearBdPg } from "../src/bd.ts";
import { crearManejadorSistema } from "../src/sistema.ts";
import { crearPlanoControl } from "../../proveedores/src/plano_control_agente.ts";
import { sha256Hex } from "../../proveedores/src/firma_agente.ts";

let sys: ReturnType<typeof crearBdPg> | null = null;
const manejador = crearManejadorSistema({
  sys: () => { const u = Deno.env.get("FEL_SYS_BD_URL"); if (!u) throw new Error("sin conexión de sistema"); return (sys ??= crearBdPg(u)); },
  secreto: Deno.env.get("FEL_SYS_SECRETO"),
  secretoAnterior: Deno.env.get("FEL_SYS_SECRETO_ANTERIOR"),   // solo durante una rotación (ver ROTACION-DE-CREDENCIALES.md)
  // Protocolo del agente local (W5): solo si se habilita explícitamente. Origen = dato que garantiza la plataforma (cf-connecting-ip o el último elemento de x-forwarded-for), SIEMPRE en huella; verificar en nexa-fel-test cuál cabecera es fiable.
  agente: Deno.env.get("FEL_AGENTE_EN_SISTEMA") === "1" ? crearPlanoControl({ rpc: (fn, a) => (sys ??= crearBdPg(Deno.env.get("FEL_SYS_BD_URL") ?? "")).rpc(fn, a),
    origen: async (req) => { const ip = req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() ?? ""; return ip ? (await sha256Hex(new TextEncoder().encode(ip))).slice(0, 32) : null; } }) : undefined,
});
if (import.meta.main) Deno.serve(manejador);
export { manejador };
