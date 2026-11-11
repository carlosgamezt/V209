#!/usr/bin/env node
// ANALIZAR O-1 MÍNIMO: lee el archivo con la línea «NEXA-O1M {json}» y emite un veredicto. Solo lee un archivo local; sin navegador ni red.
// Uso: node bin/analizar-o1m.mjs --entrada=o1m.txt [--tramo=2A|2B]
import fs from "node:fs";
import { arg } from "./comun.mjs";
import { analizarO1Minimo, informeO1Minimo } from "../src/o1o2.mjs";
const f = arg("entrada"); if (!f || f === true) { console.error("Uso: --entrada=archivo.txt [--tramo=2A|2B]"); process.exit(2); }
const t = fs.readFileSync(f, "utf8"), l = t.split(/\r?\n/).map((x) => x.replace(/^.*?(NEXA-O1M )/, "$1")).find((x) => x.startsWith("NEXA-O1M {"));
if (!l) { console.error("No encuentro una línea «NEXA-O1M {…}» en el archivo."); process.exit(2); }
let o; try { o = JSON.parse(l.slice(9)); } catch (e) { console.error("El JSON no es válido (¿se cortó al copiar?): " + e.message); process.exit(2); }
const r = analizarO1Minimo(o, { tramo: arg("tramo", "2A") }); console.log(informeO1Minimo(r));
process.exit(r.veredicto === "VERDE" ? 0 : r.veredicto === "AMARILLO" ? 3 : 1);
