#!/usr/bin/env node
// HUELLAS: calcula el SHA-256 de los fragmentos de consola y, si existe VERSION.txt (en la raíz del ZIP), los compara. Solo lee archivos locales.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RAIZ } from "./comun.mjs";
const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const version = path.resolve(RAIZ, "../../VERSION.txt"), esperado = fs.existsSync(version) ? fs.readFileSync(version, "utf8") : "";
let mal = 0;
for (const n of ["observar-consola.js", "observar-consola-2.js", "observar-consola-3.js", "observar-consola-4.js"]) {
  const h = hash(path.join(RAIZ, "consola", n)), linea = esperado.split(/\r?\n/).find((l) => l.includes(n)), ok = linea ? linea.includes(h) : null;
  if (ok === false) mal++;
  console.log(`${ok === null ? "?" : ok ? "OK" : "DISTINTA"}  ${n}  ${h}${n === "observar-consola-2.js" ? "   (RETIRADO: no usar)" : ""}`);
}
console.log(esperado ? (mal ? "\nALGUNA HUELLA NO COINCIDE con VERSION.txt: no uses ese fragmento." : "\nTodas las huellas coinciden con VERSION.txt.") : "\n(no hay VERSION.txt: solo se muestran las huellas)");
process.exit(mal ? 1 : 0);
