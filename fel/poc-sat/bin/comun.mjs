import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { hostPermitido } from "../src/guardia.mjs";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const arg = (n, def = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? (process.argv.includes(`--${n}`) ? true : def);
export const leerJson = (ruta) => { try { return JSON.parse(fs.readFileSync(path.resolve(ruta), "utf8")); } catch (e) { console.error(`No se pudo leer ${ruta}: ${e.message}`); process.exit(2); } };
let lineas = null;   // un solo lector para toda la ejecución (también sirve con entrada redirigida)
export async function esperarUsuario(pregunta) {
  lineas ??= readline.createInterface({ input: process.stdin }) [Symbol.asyncIterator]();
  process.stdout.write(`\n>>> MANUAL: ${pregunta}\n    (Enter para continuar; escribe la respuesta si se pide) `);
  const r = await lineas.next();
  return r.done ? "" : r.value;
}
const sinQuery = (u) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`; } catch { return u; } };
/** Elige la pestaña: filtra por dominios (si se dan) y exige --pestana=N cuando hay varias. Nunca imprime URLs con parámetros. */
export function elegirPestana(context, dominios = null) {
  const pestanas = context.pages().filter((p) => !/^(about:|chrome|devtools)/.test(p.url()));
  const cand = dominios ? pestanas.filter((p) => { try { return hostPermitido(new URL(p.url()).hostname, dominios); } catch { return false; } }) : pestanas;
  const n = arg("pestana");
  if (n !== null && n !== true) { const p = cand[Number(n) - 1]; if (!p) { console.error(`No existe la pestaña ${n}.`); process.exit(2); } return p; }
  if (cand.length === 1) return cand[0];
  console.error(cand.length ? `Hay ${cand.length} pestañas candidatas; elige una con --pestana=N:` : "No hay ninguna pestaña candidata (¿abriste el formulario en la sesión y el dominio está en dominios_permitidos?).");
  cand.forEach((p, i) => console.error(`  ${i + 1}. ${sinQuery(p.url())}`));
  process.exit(2);
}
