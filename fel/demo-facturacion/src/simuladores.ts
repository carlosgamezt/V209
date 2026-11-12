// Persistencia del estado de los certificadores SIMULADOS en la base (solo modo PostgreSQL real). Cada petición que modifica algo se ejecuta dentro de una sección crítica:
// bloqueo consultivo → cargar estado → atender → guardar estado. Así varias instancias o un reinicio ven lo mismo y nada se certifica dos veces ni se pierde.
import type { BdDemo } from "./bd.ts";
import { codificar, decodificar, type Persistible } from "../../proveedores/src/persistible.ts";

export class PersistenciaSimuladores {
  private cola: Promise<unknown> = Promise.resolve(); private versiones = new Map<string, number>();
  constructor(private bd: BdDemo, private piezas: Record<string, Persistible>) {}
  get activa() { return this.bd.tipo === "pg" && !!this.bd.transaccion; }
  /** Ejecuta `fn` con el estado de los simuladores cargado y, al terminar bien, guardado. Las secciones se serializan (una a la vez en toda la base). */
  con<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.activa) return fn();
    // una sola sección a la vez por proceso: así nunca hay varias conexiones esperando el bloqueo mientras la que lo tiene necesita otra del grupo
    const r = this.cola.then(() => this.seccion(fn)); this.cola = r.catch(() => {}); return r;
  }
  /** Lectura sin bloqueo (peticiones GET): si otro proceso guardó cambios, los carga. */
  async sincronizar() {
    if (!this.activa) return;
    const v = await this.bd.filas<{ clave: string; version: number }>("select clave, version from public.demo_simulador_estado");
    const nuevas = v.filter((x) => this.piezas[x.clave] && this.versiones.get(x.clave) !== Number(x.version)); if (!nuevas.length) return;
    for (const f of await this.bd.filas<{ clave: string; estado: string; version: number }>("select clave, estado, version from public.demo_simulador_estado where clave = any($1)", [nuevas.map((x) => x.clave)])) { this.piezas[f.clave].importar(decodificar(f.estado)); this.versiones.set(f.clave, Number(f.version)); }
  }
  private async seccion<T>(fn: () => Promise<T>): Promise<T> {
    return await this.bd.transaccion!(async (tx) => {
      await tx.ejecutar("select pg_advisory_xact_lock(hashtext('nexa_demo_simuladores'))");
      const filas = await tx.filas<{ clave: string; estado: string }>("select clave, estado, version from public.demo_simulador_estado");
      for (const f of filas as unknown as { clave: string; estado: string }[]) { const p = this.piezas[f.clave]; if (p) p.importar(decodificar(f.estado)); }
      const r = await fn();   // si falla, la transacción se revierte y el estado de la base no cambia
      for (const [clave, p] of Object.entries(this.piezas)) {
        await tx.ejecutar(`insert into public.demo_simulador_estado (clave, estado) values ($1, $2) on conflict (clave) do update set estado = excluded.estado, version = demo_simulador_estado.version + 1, actualizado_en = now()`, [clave, codificar(p.exportar())]);
      }
      for (const f of await tx.filas<{ clave: string; version: number }>("select clave, version from public.demo_simulador_estado")) this.versiones.set(f.clave, Number(f.version));
      return r;
    });
  }
}
