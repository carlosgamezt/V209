#!/usr/bin/env node
// ANALIZAR O-2: lee el registro transcrito de la pestaña Network («segundo,metodo,host,ruta,tipo», una línea por solicitud) y emite un veredicto. Solo lee un archivo local.
// Uso: node bin/analizar-o2.mjs --entrada=o2.csv [--duracion=300] [--aprobadas=aprobadas.json]   (aprobadas.json: ["GET host/ruta", ...] ya revisadas por una persona)
import fs from "node:fs";
import { arg } from "./comun.mjs";
import { leerRegistroO2, analizarO2, informeTexto } from "../src/o1o2.mjs";
const f = arg("entrada"); if (!f || f === true) { console.error("Uso: --entrada=o2.csv [--duracion=300] [--aprobadas=archivo.json]"); process.exit(2); }
const { filas, errores, vacio_confirmado } = leerRegistroO2(fs.readFileSync(f, "utf8")); if (errores.length) { console.error("Errores en el archivo:\n  " + errores.join("\n  ")); process.exit(2); }
const ap = arg("aprobadas") && arg("aprobadas") !== true ? JSON.parse(fs.readFileSync(arg("aprobadas"), "utf8")) : [];
const r = analizarO2(filas, { duracion_s: Number(arg("duracion", 300)), aprobadas: ap, vacio_confirmado });
console.log(informeTexto("O-2 · red en reposo", r)); console.log("\nSolicitudes distintas (método host ruta · veces · clase):"); for (const x of r.resumen) console.log(`  ${x.clave} · ${x.veces} · ${x.clase}${x.razones.length ? " · " + x.razones.join("; ") : ""}`);
process.exit(r.veredicto === "VERDE" ? 0 : r.veredicto === "AMARILLO" ? 3 : 1);
