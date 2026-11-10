#!/usr/bin/env node
// Regenera consola/observar-consola.js (el fragmento que se pega en la consola de Chrome) a partir del código de src/observar.mjs.
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./comun.mjs";
import { fuenteConsola } from "../src/observar.mjs";
fs.writeFileSync(path.join(RAIZ, "consola", "observar-consola.js"), fuenteConsola());
console.log("consola/observar-consola.js regenerado");
