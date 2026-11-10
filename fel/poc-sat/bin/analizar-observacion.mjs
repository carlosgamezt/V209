#!/usr/bin/env node
// ANALIZAR-OBSERVACIÓN: clasifica los controles de una observación (salida del fragmento de consola) por sección, visibilidad, función y estabilidad.
// No abre navegador ni se conecta a nada. Uso: node bin/analizar-observacion.mjs --entrada=observacion.json [--config=analisis/sat-obs1.config.json] [--salida=analisis/obs1]
import fs from "node:fs";
import path from "node:path";
import { arg, leerJson, RAIZ } from "./comun.mjs";
import { construirInventario } from "../src/observar.mjs";
import { analizar, aMarkdown } from "../src/analisis.mjs";

const ent = arg("entrada"); if (!ent || ent === true) { console.error("Falta --entrada=observacion.json"); process.exit(2); }
const raw = leerJson(ent), cfg = leerJson(arg("config", path.join(RAIZ, "analisis/sat-obs1.config.json")));
if (raw?.origen !== "consola" || !raw.frames?.[0]?.r?.controles) { console.error("No parece una salida del fragmento de consola."); process.exit(2); }
const inv = construirInventario({ pagina: raw.pagina, frames: raw.frames, origen: "consola" }), a = analizar(inv, cfg);
const dir = path.resolve(arg("salida", path.join(RAIZ, "analisis/obs1"))); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "clasificacion.json"), JSON.stringify(a, null, 2)); fs.writeFileSync(path.join(dir, "clasificacion.md"), aMarkdown(a));
console.log(`Controles: ${a.total} · visibles: ${a.visibles}`); for (const [t, l] of [["estabilidad", a.por_estabilidad], ["sección", a.por_seccion], ["acción", a.por_accion]]) { console.log(`\nPor ${t}:`); for (const [k, v] of l) console.log(`  ${String(v).padStart(3)}  ${k}`); }
console.log(`\nCampos repetidos con sufijo:`); for (const r of a.repetidos) console.log(`  ${r.stem}: ocurrencias ${r.ocurrencias}, sufijos ${r.sufijos.join(",")}, visibles ${r.visibles}`); console.log(`\nSalida: ${dir}`);
