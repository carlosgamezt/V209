#!/usr/bin/env node
// OBSERVAR (solo lectura): inventario de los controles de la pestaña activa → observaciones/<alias>-<fecha>.json + borrador de mapeo.
// Uso: node bin/observar.mjs --empresa=config/empresa.local.json [--pestana=N] [--opciones]
import fs from "node:fs";
import path from "node:path";
import { arg, leerJson, elegirPestana, RAIZ } from "./comun.mjs";
import { conectar, tomarBloqueo } from "../src/conexion.mjs";
import { validarAislamiento } from "../src/guardia.mjs";
import { inventariar, borradorMapeo, controlesDeRiesgo } from "../src/observar.mjs";

const ruta = arg("empresa"); if (!ruta || ruta === true) { console.error("Falta --empresa=config/empresa.local.json (copia config/empresa.ejemplo.json)"); process.exit(2); }
const empresa = leerJson(ruta), v = validarAislamiento([empresa]);
if (!v.ok) { console.error(v.errores.join("\n")); process.exit(2); }
const liberar = tomarBloqueo(path.join(RAIZ, "registros", empresa.alias));
console.log(`OBSERVACIÓN (solo lectura) · empresa «${empresa.alias}» · no se hace clic ni se escribe nada.`);
const c = await conectar(empresa);
try {
  const page = elegirPestana(c.context);
  const inv = await inventariar(page, { incluirOpciones: arg("opciones") === true });
  const dir = path.join(RAIZ, "observaciones"); fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${empresa.alias}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(inv, null, 2)); fs.writeFileSync(`${base}.mapeo-borrador.json`, JSON.stringify(borradorMapeo(inv), null, 2));
  console.log(`\nPágina: ${inv.pagina.host}${inv.pagina.ruta}  ·  controles: ${inv.total_controles}  ·  sin localizador único: ${inv.sin_candidato_unico}  ·  con riesgo de emisión: ${inv.con_riesgo_de_emision}`);
  for (const m of inv.marcos) console.log(`  marco ${m.indice}${m.principal ? " (principal)" : ""}: ${m.host}${m.ruta} · controles ${m.controles ?? "?"}${m.captcha ? " · CAPTCHA" : ""}${m.shadow_abierto ? ` · shadow DOM abierto: ${m.shadow_abierto}` : ""}${m.frameworks?.length ? ` · ${m.frameworks.join(",")}` : ""}${m.error ? ` · error: ${m.error}` : ""}`);
  console.log("\nControles que NUNCA se tocarán (emitir/enviar/etc.):"); for (const r of controlesDeRiesgo(inv)) console.log(`  ${r.n}  «${r.texto}»  ${r.nivel}: ${r.razones.join("; ")}`);
  console.log(`\nGuardado en:\n  ${base}.json\n  ${base}.mapeo-borrador.json   (borrador: verificado=false y dato=null; hay que completarlo a mano)\nNo compartas estos archivos sin revisarlos.`);
} finally { await c.cerrar(); liberar(); }
