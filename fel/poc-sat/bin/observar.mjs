#!/usr/bin/env node
// OBSERVAR (solo lectura): inventario de los controles de la pestaña activa → observaciones/<alias>-<fecha>.json + borrador de mapeo.
// Uso: node bin/observar.mjs --empresa=config/empresa.local.json [--pestana=N] [--opciones]
import path from "node:path";
import { arg, leerJson, elegirPestana, RAIZ, imprimirResumen, guardarObservacion } from "./comun.mjs";
import { conectar, tomarBloqueo } from "../src/conexion.mjs";
import { validarAislamiento } from "../src/guardia.mjs";
import { inventariar, borradorMapeo } from "../src/observar.mjs";

const ruta = arg("empresa"); if (!ruta || ruta === true) { console.error("Falta --empresa=config/empresa.local.json (copia config/empresa.ejemplo.json)"); process.exit(2); }
const empresa = leerJson(ruta), v = validarAislamiento([empresa]);
if (!v.ok) { console.error(v.errores.join("\n")); process.exit(2); }
const liberar = tomarBloqueo(path.join(RAIZ, "registros", empresa.alias));
console.log(`OBSERVACIÓN (solo lectura) · empresa «${empresa.alias}» · no se hace clic ni se escribe nada.`);
const c = await conectar(empresa);
try {
  const page = elegirPestana(c.context);
  const inv = await inventariar(page, { incluirOpciones: arg("opciones") === true });
  const base = guardarObservacion(inv, borradorMapeo(inv), empresa.alias);
  imprimirResumen(inv, base);
} finally { await c.cerrar(); liberar(); }
