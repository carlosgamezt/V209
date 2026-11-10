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

/** Resumen legible del inventario (lo usan observar, importar-observacion y comparar). */
export function imprimirResumen(inv, base) {
  console.log(`\nPágina: ${inv.pagina.host}${inv.pagina.ruta}  ·  controles: ${inv.total_controles}  ·  sin localizador único: ${inv.sin_candidato_unico}  ·  con riesgo de emisión: ${inv.con_riesgo_de_emision}`);
  for (const m of inv.marcos) console.log(`  marco ${m.indice}${m.principal ? " (principal)" : ""}: ${m.host}${m.ruta} · controles ${m.controles ?? "?"}${m.captcha ? " · CAPTCHA" : ""}${m.shadow_abierto ? ` · shadow DOM abierto: ${m.shadow_abierto}` : ""}${m.frameworks?.length ? ` · ${m.frameworks.join(",")}` : ""}${m.error ? ` · error: ${m.error}` : ""}`);
  console.log(`  formularios: ${inv.formularios.length}${inv.formularios.map((f) => ` [${f.metodo.toUpperCase()} ${f.accion_ruta || "(misma página)"} · ${f.controles} elementos${f.id_generado ? " · id autogenerado" : ""}]`).join("")}`);
  console.log(`  campo de contraseña visible: ${inv.senales_sesion.campo_clave_visible ? "SÍ (esta pantalla parece de inicio de sesión)" : "no"}`);
  console.log("\nPosibles obstáculos para automatizar:"); for (const o of inv.obstaculos) console.log(`  [${o.severidad.toUpperCase().padEnd(5)}] ${o.codigo} (${o.n}): ${o.detalle}`);
  console.log("\nControles que NUNCA se tocarán (emitir/enviar/cerrar sesión/etc.):");
  for (const c of inv.controles.filter((x) => x.clasificacion !== "ok")) console.log(`  ${c.n}  «${c.texto || c.etiqueta}»  ${c.clasificacion}: ${c.razones.join("; ")}${c.ajax ? " · AJAX JSF" : ""}`);
  if (base) console.log(`\nGuardado en:\n  ${base}.json\n  ${base}.mapeo-borrador.json   (borrador: verificado=false y dato=null; hay que completarlo a mano)\nNo compartas estos archivos sin revisarlos.`);
}
/** Guarda inventario y borrador en observaciones/ (ignorada por git). */
export function guardarObservacion(inv, borrador, alias) {
  const dir = path.join(RAIZ, "observaciones"); fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${alias}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(inv, null, 2)); fs.writeFileSync(`${base}.mapeo-borrador.json`, JSON.stringify(borrador, null, 2));
  return base;
}
