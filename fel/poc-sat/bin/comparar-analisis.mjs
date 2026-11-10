#!/usr/bin/env node
// COMPARAR-ANÁLISIS: compara dos clasificaciones (observación anterior vs nueva) control por control (mismo orden del DOM).
// Uso: node bin/comparar-analisis.mjs analisis/obs1/clasificacion.json analisis/obs2a/clasificacion.json [--salida=archivo.md]
import fs from "node:fs";
import { arg, leerJson } from "./comun.mjs";
const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--")); if (!a || !b) { console.error("Uso: comparar-analisis.mjs <antes.json> <despues.json>"); process.exit(2); }
const A = leerJson(a), B = leerJson(b), estable = (e) => /^estable/.test(e), L = [];
const mismo = A.filas.length === B.filas.length && A.filas.every((f, i) => f.tag === B.filas[i].tag && f.tipo === B.filas[i].tipo && f.nombre === B.filas[i].nombre);
L.push(`# Comparación de observaciones`, "", `- Controles: ${A.total} → ${B.total} · estructura y orden idénticos: **${mismo ? "sí" : "NO"}** · visibles: ${A.visibles} → ${B.visibles}`);
const cambVis = B.filas.filter((f, i) => A.filas[i] && A.filas[i].visible !== f.visible).map((f) => `c${f.idx} (${f.funcion.slice(0, 50)}): ${A.filas[f.idx].visible ? "visible" : "oculto"} → ${f.visible ? "visible" : "oculto"}`);
L.push(`- Cambios de visibilidad: ${cambVis.length ? cambVis.join("; ") : "ninguno"}`, "");
const antes = A.filas.filter((f) => f.estabilidad === "sin_identificador"), ahora = antes.map((f) => B.filas[f.idx]);
const nuevos = ahora.filter((f) => estable(f.estabilidad)), siguen = ahora.filter((f) => !estable(f.estabilidad));
L.push(`## Controles que en la observación anterior no tenían identificador: ${antes.length}`, `- Ahora localizables de forma estable: **${nuevos.length}**`, `- Siguen sin localizador estable: **${siguen.length}**`, "");
const por = (l) => Object.entries(l.reduce((o, f) => ((o[f.estabilidad] = (o[f.estabilidad] ?? 0) + 1), o), {})).map(([k, v]) => `${k}: ${v}`).join(" · ");
L.push(`Detalle de los ahora estables: ${por(nuevos)}`, "", "### Siguen sin localizador estable", "", "| # | Sección | Vis. | Control | Función / modelo | Estabilidad ahora |", "|---|---|---|---|---|---|", ...siguen.map((f) => `| c${f.idx} | ${f.seccion}${f.subseccion ? " › " + f.subseccion : ""} | ${f.visible ? "sí" : "no"} | ${f.tag}[${f.tipo}] | ${f.funcion} | ${f.estabilidad} |`), "");
L.push("### Ahora estables, por sección", "", "| Sección | Controles |", "|---|---|", ...Object.entries(nuevos.reduce((o, f) => ((o[f.seccion] = (o[f.seccion] ?? 0) + 1), o), {})).map(([k, v]) => `| ${k} | ${v} |`), "");
const txt = L.join("\n") + "\n"; const s = arg("salida"); if (s && s !== true) fs.writeFileSync(s, txt); console.log(txt.slice(0, 6000));
