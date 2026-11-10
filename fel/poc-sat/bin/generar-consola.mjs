#!/usr/bin/env node
// Regenera consola/observar-consola.js (el fragmento que se pega en la consola de Chrome) a partir del código de src/observar.mjs.
import fs from "node:fs";
import path from "node:path";
import { RAIZ, leerJson } from "./comun.mjs";
import { fuenteConsola } from "../src/observar.mjs";
fs.writeFileSync(path.join(RAIZ, "consola", "observar-consola.js"), fuenteConsola());
const css = leerJson(path.join(RAIZ, "config/mapeo.sat-preliminar.json")).comprobar_css;
fs.writeFileSync(path.join(RAIZ, "consola", "observar-consola-2.js"), fuenteConsola({ extendido: true, css }));
fs.writeFileSync(path.join(RAIZ, "consola", "observar-consola-3.js"), fuenteConsola({ extendido: true, css, version: 3, permitidas: [] }));
console.log("consola/observar-consola.js, -2.js y -3.js regenerados");
