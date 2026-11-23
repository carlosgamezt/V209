// ¿Tiene esta base la propuesta de TIPOS DE DOCUMENTO aplicada (docs/migracion-tipos-documento)? La propuesta vive FUERA de supabase/migrations (el conjunto de 29 migraciones aprobadas no cambia), así que una base
// hospedada puede no tenerla todavía: en ese caso la demostración sigue funcionando EXACTAMENTE como antes (solo Factura, sin consultar ninguna columna ni función nueva).
// Se recuerda el «sí»; un «no» se vuelve a mirar como mucho cada 30 s (para recoger una migración aplicada con el servidor en marcha) sin cargar la base.
import type { BdDemo } from "./bd.ts";
const memoria = new WeakMap<BdDemo, { si: boolean; vistoMs: number }>();
export async function tiposDisponibles(bd: BdDemo, ahoraMs = Date.now()): Promise<boolean> {
  const m = memoria.get(bd); if (m && (m.si || ahoraMs - m.vistoMs < 30_000)) return m.si;
  const [r] = await bd.filas<{ ok: boolean }>(`select (to_regprocedure('public.fel_tipos_empresa(uuid,uuid)') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name = 'tipo_dte')) as ok`);
  const si = !!r?.ok; memoria.set(bd, { si, vistoMs: ahoraMs }); return si;
}
