#!/usr/bin/env node
// VERIFICAR: ejecuta las tres baterías LOCALES (reglas, autoprueba con navegador, simulación AngularJS). Nada se conecta a SAT.
// Uso: node bin/verificar.mjs [--navegador=chrome|chromium] [--ruta=ruta\al\ejecutable]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { RAIZ, arg } from "./comun.mjs";
const env = { ...process.env }, nav = arg("navegador"), ruta = arg("ruta");
if (nav && nav !== true) env.FEL_NAVEGADOR = nav; if (ruta && ruta !== true) env.FEL_NAVEGADOR_RUTA = ruta;
const pasos = [["Reglas y guardia (sin navegador)", ["--test", "tests/guardia.test.mjs"]], ["Autoprueba con navegador (páginas simuladas)", ["tests/autoprueba.mjs"]], ["Simulación AngularJS 1.5.8 (páginas simuladas)", ["tests/simulacion-angular.mjs"]]];
let mal = 0;
for (const [titulo, args] of pasos) { console.log(`\n=== ${titulo} ===`); const r = spawnSync(process.execPath, args, { cwd: RAIZ, env, stdio: "inherit" }); if (r.status !== 0) { mal++; console.log(`>>> FALLÓ: ${titulo} (código ${r.status})`); } }
console.log(mal ? `\nRESULTADO: ${mal} batería(s) con fallos. Copia toda la salida y envíala.` : "\nRESULTADO: las 3 baterías pasaron (todo local y simulado; no se contactó con SAT).");
process.exit(mal ? 1 : 0);
