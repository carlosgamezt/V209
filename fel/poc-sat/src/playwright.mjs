// Carga Playwright con require (respeta NODE_PATH, como en la CI). No se descarga ningún navegador aquí.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { try { pw = require("playwright-core"); } catch { throw new Error("Falta Playwright: ejecuta «npm install» dentro de fel/poc-sat"); } }
export const { chromium } = pw;
