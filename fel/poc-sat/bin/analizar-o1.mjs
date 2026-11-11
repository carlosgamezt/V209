#!/usr/bin/env node
// ANALIZAR O-1: lee el archivo con la línea «NEXA-O1 {json}» que copiaste de la consola y emite un veredicto. Solo lee un archivo local; no usa navegador ni red.
// Uso: node bin/analizar-o1.mjs --entrada=o1.txt [--tramo=2A|2B] [--aprobadas=aprobadas.json]   (aprobadas.json: ["calcularTotal", ...] funciones revisadas por una persona)
import fs from "node:fs";
import { arg } from "./comun.mjs";
import { analizarO1, informeTexto } from "../src/o1o2.mjs";
const f = arg("entrada"); if (!f || f === true) { console.error("Uso: --entrada=archivo.txt [--tramo=2A|2B] [--aprobadas=archivo.json]"); process.exit(2); }
const texto = fs.readFileSync(f, "utf8"), l = texto.split(/\r?\n/).map((x) => x.replace(/^.*?(NEXA-O1 )/, "$1")).find((x) => x.startsWith("NEXA-O1 {")) ?? (texto.trim().startsWith("{") ? "NEXA-O1 " + texto.trim() : null);
if (!l) { console.error("No encuentro una línea «NEXA-O1 {…}» ni un JSON en el archivo."); process.exit(2); }
let o1; try { o1 = JSON.parse(l.slice(8)); } catch (e) { console.error("El JSON no es válido (¿se cortó al copiar?): " + e.message); process.exit(2); }
const ap = arg("aprobadas") && arg("aprobadas") !== true ? JSON.parse(fs.readFileSync(arg("aprobadas"), "utf8")) : [];
const r = analizarO1(o1, { tramo: arg("tramo", "2A"), aprobadas: ap });
console.log(informeTexto(`O-1 · tramo ${r.tramo}`, r)); console.log("\nManejadores por campo (nombres de funciones, sin valores):");
for (const c of r.campos.filter((x) => x.vigente)) console.log(`  ${c.campo} (${c.encontrados}): ` + (c.llamadas.length ? [...new Set(c.llamadas.map((x) => `${x.nombre}[${x.clase}]@${x.origen}`))].join(", ") : "sin manejadores propios"));
if (r.funciones_scope.length) console.log("\nFunciones del scope con nombre de guardado/envío/emisión (existen; revisar si algún manejador las invoca): " + [...new Set(r.funciones_scope)].join(", "));
process.exit(r.veredicto === "VERDE" ? 0 : r.veredicto === "AMARILLO" ? 3 : 1);
