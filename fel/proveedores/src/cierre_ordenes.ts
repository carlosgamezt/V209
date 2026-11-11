// Cierre en NEXA de las órdenes del agente. NO modifica el orquestador: usa su ruta existente «resolverAccionHumana».
//  completada ⇒ certificado (simulado) · descartada / fallida ⇒ rechazo confirmado (se prueba que nada salió)
//  incierta   ⇒ la propia base ya dejó la operación «por_verificar»; aquí NO se hace nada (sin reintento automático; solo consulta o conciliación de dos personas).
import type { OrquestadorDb } from "./orquestador_db.ts";
import type { Rpc } from "./rpc.ts";

export interface ResumenCierre { vencidas: number; certificadas: number; rechazadas: number }

export async function cerrarOrdenes(rpc: Rpc, orq: OrquestadorDb, opciones: { empresaId?: string; ahora?: () => Date } = {}): Promise<ResumenCierre> {
  const r: ResumenCierre = { vencidas: 0, certificadas: 0, rechazadas: 0 };
  r.vencidas = Number(await rpc("fel_sys_ordenes_vencer", { p_empresa: opciones.empresaId ?? null }));   // aplica vencimientos: antes de presentar ⇒ cola; después ⇒ incierta
  const lista = await rpc("fel_sys_ordenes_para_cerrar", {}) as { orden_id: string; empresa_id: string; operacion_id: string; estado: string; serie: string | null; numero: string | null; autorizacion: string | null }[];
  for (const o of lista) {
    if (opciones.empresaId && o.empresa_id !== opciones.empresaId) continue;
    if (o.estado === "cancelada") continue;
    if (await rpc("fel_sys_orden_cierre_reservar", { p_orden: o.orden_id, p_segundos: 60 }) !== true) continue;   // otro cierre ya tiene esta orden: no se procesa dos veces
    try {
      if (o.estado === "completada") {
        await orq.resolverAccionHumana(o.empresa_id, o.operacion_id, { tipo: "certificado", serie: o.serie!, numero: o.numero!, autorizacion: o.autorizacion!, fechaCertificacion: (opciones.ahora?.() ?? new Date()).toISOString().slice(0, 10), artefactos: [] });
        r.certificadas++;
      } else if (o.estado === "descartada" || o.estado === "fallida") {
        await orq.resolverAccionHumana(o.empresa_id, o.operacion_id, { tipo: "rechazado_confirmado", codigo: o.estado === "descartada" ? "DESCARTADO_EN_EL_SIMULADOR" : "ERROR_ANTES_DE_PRESENTAR", mensaje: "El agente probó que no se emitió ningún documento" });
        r.rechazadas++;
      }
    } catch (e) {
      // Otro cierre (otro supervisor o una ejecución manual) se adelantó con ESTA orden: la operación ya no espera a una persona. No es un fallo: se sigue con las demás.
      if (!/FEL_REGLA|FEL_CONFLICTO/.test(String((e as { codigo?: string }).codigo ?? "") + String((e as Error).message))) { await rpc("fel_sys_orden_cierre_liberar", { p_orden: o.orden_id }); throw e; }   // fallo inesperado: se libera para que el siguiente ciclo reintente
    }
  }
  return r;
}
