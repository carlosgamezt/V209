// Preparación de la base de la demostración (la usan el servidor y el aprovisionamiento de la nube). Nunca crea el esquema: lo aplican las migraciones del proyecto.
//  · Base nueva de la demostración (sin marcador y sin empresas): se siembra el mundo simulado y se deja el marcador.
//  · Base con marcador: se conserva todo (no se vuelve a sembrar ni se pisa nada).
//  · Base con empresas ajenas, o sin migraciones: se niega (devuelve un error; el llamador decide cómo terminar).
import type { BdDemo } from "./bd.ts";
import { sembrar, mundoExistente, type Sembrado } from "./mundo_demo.ts";
import { sembrarPractico, PERSONAS } from "./mundo_practico.ts";

export class ErrorAprovisionar extends Error {}
export async function prepararBase(bd: BdDemo, o: { sembrar: boolean; aviso?: (m: string) => void } = { sembrar: true }): Promise<Sembrado> {
  if (bd.tipo !== "pg") { const m = await sembrar(bd); await sembrarPractico(bd); return m; }   // memoria: siempre mundo nuevo
  try { await bd.filas("select 1 from public.demo_entorno limit 1"); }
  catch { throw new ErrorAprovisionar("La base no tiene las migraciones del proyecto (falta public.demo_entorno). Aplícalas primero (supabase db push); este programa no crea el esquema."); }
  if ((await bd.filas("select 1 from public.demo_entorno")).length) return await mundoExistente(bd);   // reinicio: se conserva todo
  const [{ n }] = await bd.filas<{ n: number }>("select count(*)::int as n from public.empresas");
  if (n > 0) throw new ErrorAprovisionar(`La base ya contiene ${n} empresa(s) que no son de la demostración. Por seguridad NO se siembra ni se usa: apunta FEL_DEMO_BD_URL a una base exclusiva de la demostración.`);
  if (!o.sembrar) throw new ErrorAprovisionar("La base de la demostración todavía no está sembrada. Ejecuta primero el aprovisionamiento (deno run -A nube/aprovisionar.ts).");
  // 1.º los usuarios de Auth (idempotente): si Auth falla, no queda nada sembrado en las tablas de NEXA y el aprovisionamiento se puede repetir sin más
  for (const u of Object.values(PERSONAS)) await bd.crearUsuario(u.id, `${u.nombre.split(" ")[0].toLowerCase()}@demo.example`);
  const m = await sembrar(bd); await sembrarPractico(bd); await bd.ejecutar("insert into public.demo_entorno default values");
  o.aviso?.("Base de la demostración sembrada por primera vez.");
  return m;
}
