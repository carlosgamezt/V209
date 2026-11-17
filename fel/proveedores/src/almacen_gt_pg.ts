// Almacén PERSISTENTE (PostgreSQL) de las operaciones de Digifact: implementa AlmacenGt sobre la tabla propuesta public.digifact_operaciones (docs/migracion-29).
// Atomicidad y exclusión mutua las garantizan los índices únicos y el disparador de la base, no la memoria del proceso: dos procesos no pueden enviar el mismo documento.
import type { AlmacenGt, ArtefactoGt, EstadoOpGt, OperacionGt } from "./felgt_servicio.ts";

export type Filas = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const COLS = "id, empresa_id, documento_id, referencia, hash, huella_emisor, fecha_emision, establecimiento, total, estado, creada_ms, actualizada_ms, actor_id, intento_del_documento, intentos_conciliacion, resultado";
// deno-lint-ignore no-explicit-any
const aOp = (r: any): OperacionGt => ({ id: r.id, empresaId: r.empresa_id, documentoId: r.documento_id, referencia: r.referencia, hash: r.hash, huellaEmisor: r.huella_emisor, fechaEmision: r.fecha_emision, establecimiento: Number(r.establecimiento),
  total: r.total, estado: r.estado, creada: Number(r.creada_ms), actualizada: Number(r.actualizada_ms), actorId: r.actor_id, intentoDelDocumento: Number(r.intento_del_documento), intentosConciliacion: Number(r.intentos_conciliacion), ...(r.resultado ? { resultado: r.resultado } : {}) });

export class AlmacenGtPg implements AlmacenGt {
  readonly persistente = true;
  constructor(private readonly filas: Filas) {}
  async crear(op: OperacionGt): Promise<{ op: OperacionGt; creada: boolean }> {
    for (let intento = 0; intento < 3; intento++) {
      const nuevas = await this.filas(`insert into public.digifact_operaciones (${COLS}) select $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::integer,$9::text,$10::text,$11::bigint,$12::bigint,$13::uuid,$14::integer,$15::integer,$16::text::jsonb
         where not exists (select 1 from public.digifact_operaciones b where b.empresa_id = $2 and b.documento_id = $3 and b.estado in ('enviando','certificada','desconocida'))   -- con una operación que bloquea no se prepara otra
         on conflict do nothing returning ${COLS}`,
        [op.id, op.empresaId, op.documentoId, op.referencia, op.hash, op.huellaEmisor, op.fechaEmision, op.establecimiento, op.total, op.estado, op.creada, op.actualizada, op.actorId, op.intentoDelDocumento, op.intentosConciliacion, op.resultado ? JSON.stringify(op.resultado) : null]);
      if (nuevas.length) return { op: aOp(nuevas[0]), creada: true };
      const previas = await this.deDocumento(op.empresaId, op.documentoId);
      const bloquea = previas.find((o) => o.estado === "enviando" || o.estado === "certificada" || o.estado === "desconocida"); if (bloquea) return { op: bloquea, creada: false };
      const igual = previas.find((o) => o.estado === "preparada" && o.referencia === op.referencia); if (igual) return { op: igual, creada: false };
      // el conflicto vino de otra restricción o hubo una carrera: se reintenta
    }
    throw new Error("No se pudo crear la operación de Digifact (conflicto no resuelto)");
  }
  /** Función de la base (migración 29): estado fiscal, serie, número y autorización del documento, atómico e idempotente; falla si hay otros datos fiscales o la autorización es de otro documento. */
  async aplicarCertificacion(empresaId: string, operacionId: string) {
    const r = await this.filas<{ r: string }>("select public.fel_sys_digifact_aplicar($1::uuid, $2::uuid) as r", [empresaId, operacionId]);
    return (r[0]?.r === "ya_aplicada" ? "ya_aplicada" : "aplicada") as "aplicada" | "ya_aplicada";
  }
  /** Solo inserción: repetir el mismo tipo de la misma operación no cambia nada (la base lo impide con una restricción única). */
  async guardarArtefactos(empresaId: string, op: OperacionGt, artefactos: ArtefactoGt[]) {
    for (const a of artefactos) {
      await this.filas(`insert into public.digifact_artefactos (empresa_id, documento_id, operacion_id, tipo, nombre, mime, sha256, tamano, contenido)
        values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, $8::integer, $9::bytea) on conflict (operacion_id, tipo) do nothing`,
        [empresaId, op.documentoId, op.id, a.tipo, a.nombre, a.mime, a.sha256, a.contenido.length, a.contenido]);
    }
  }
  async artefacto(empresaId: string, documentoId: string, tipo: "xml" | "pdf") {
    const r = await this.filas<{ operacion_id: string; tipo: "xml" | "pdf"; nombre: string; mime: "application/xml" | "application/pdf"; sha256: string; contenido: Uint8Array }>(
      `select a.operacion_id, a.tipo, a.nombre, a.mime, a.sha256, a.contenido from public.digifact_artefactos a
         join public.digifact_operaciones o on o.id = a.operacion_id and o.empresa_id = a.empresa_id
        where a.empresa_id = $1::uuid and a.documento_id = $2::uuid and a.tipo = $3::text and o.estado = 'certificada' order by a.creado_en limit 1`, [empresaId, documentoId, tipo]);
    const f = r[0]; return f ? { operacionId: f.operacion_id, tipo: f.tipo, nombre: f.nombre, mime: f.mime, sha256: f.sha256, contenido: new Uint8Array(f.contenido) } : null;
  }
  async obtener(empresaId: string, id: string) { const r = await this.filas(`select ${COLS} from public.digifact_operaciones where empresa_id = $1 and id = $2`, [empresaId, id]); return r[0] ? aOp(r[0]) : null; }
  async deDocumento(empresaId: string, documentoId: string) { return (await this.filas(`select ${COLS} from public.digifact_operaciones where empresa_id = $1 and documento_id = $2 order by creada_ms, id`, [empresaId, documentoId])).map(aOp); }
  async transicion(empresaId: string, id: string, desde: EstadoOpGt[], cambios: Partial<OperacionGt>) {
    const sets: string[] = [], ps: unknown[] = [empresaId, id, desde]; const p = (v: unknown) => { ps.push(v); return `$${ps.length}`; };
    if (cambios.estado !== undefined) sets.push(`estado = ${p(cambios.estado)}`);
    if (cambios.actualizada !== undefined) sets.push(`actualizada_ms = ${p(cambios.actualizada)}`);
    if (cambios.intentosConciliacion !== undefined) sets.push(`intentos_conciliacion = ${p(cambios.intentosConciliacion)}`);
    if (cambios.resultado !== undefined) sets.push(`resultado = ${p(JSON.stringify(cambios.resultado))}::text::jsonb`);
    if (!sets.length) return await this.obtener(empresaId, id);
    try {
      const r = await this.filas(`update public.digifact_operaciones set ${sets.join(", ")} where empresa_id = $1 and id = $2 and estado = any($3::text[]) returning ${COLS}`, ps);
      return r[0] ? aOp(r[0]) : null;
    } catch (e) {
      // otra operación del mismo documento ya bloquea (enviando/certificada/desconocida): este proceso perdió la carrera, igual que un compare-and-set fallido
      if ((e as { code?: string; constraint_name?: string })?.code === "23505" && (e as { constraint_name?: string }).constraint_name === "digifact_op_una_que_bloquea_uq") return null;
      throw e;
    }
  }
}
