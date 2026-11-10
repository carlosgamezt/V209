#!/usr/bin/env node
// COMPARAR: diferencias entre dos observaciones (p. ej. antes y después de elegir a mano un tipo de documento) → campos dinámicos.
// Uso: node bin/comparar.mjs observaciones/a.json observaciones/b.json
import fs from "node:fs";
const [a, b] = process.argv.slice(2); if (!a || !b) { console.error("Uso: comparar.mjs <antes.json> <despues.json>"); process.exit(2); }
const cargar = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const clave = (c) => `${c.marco}|${c.tag}|${c.type}|${c.etiqueta || c.marcador || c.nombre || c.id || c.texto || c.dom}`;
const A = cargar(a), B = cargar(b), mA = new Map(A.controles.map((c) => [clave(c), c])), mB = new Map(B.controles.map((c) => [clave(c), c]));
const nuevos = [...mB].filter(([k]) => !mA.has(k)).map(([, c]) => c), quitados = [...mA].filter(([k]) => !mB.has(k)).map(([, c]) => c);
const visib = [...mB].filter(([k, c]) => mA.has(k) && mA.get(k).visible !== c.visible).map(([k, c]) => `${c.etiqueta || c.texto || k}: ${mA.get(k).visible ? "visible" : "oculto"} → ${c.visible ? "visible" : "oculto"}`);
const nom = (c) => `${c.n} ${c.tag}${c.type ? `[${c.type}]` : ""} «${c.etiqueta || c.texto || c.marcador || c.nombre || c.dom}»${c.clasificacion !== "ok" ? ` (${c.clasificacion})` : ""}`;
console.log(`Antes: ${A.total_controles} controles · Después: ${B.total_controles}\n\nControles NUEVOS (${nuevos.length}) — candidatos a campos dinámicos:`); nuevos.forEach((c) => console.log("  + " + nom(c)));
console.log(`\nControles que DESAPARECIERON (${quitados.length}):`); quitados.forEach((c) => console.log("  - " + nom(c)));
console.log(`\nCambios de visibilidad (${visib.length}):`); visib.forEach((x) => console.log("  ~ " + x));
