#!/usr/bin/env node
// IMPORTAR-OBSERVACIÓN: convierte el JSON que produce el fragmento de la consola de Chrome en el inventario completo + borrador de mapeo.
// No abre navegador ni se conecta a nada: procesa un archivo local. Uso: node bin/importar-observacion.mjs --entrada=consola.json --alias=empresa-a
import fs from "node:fs";
import { arg, leerJson, imprimirResumen, guardarObservacion } from "./comun.mjs";
import { construirInventario, borradorMapeo } from "../src/observar.mjs";

const ent = arg("entrada"); if (!ent || ent === true) { console.error("Falta --entrada=archivo.json (lo que copió el fragmento de la consola)"); process.exit(2); }
const alias = arg("alias", "consola"); if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(String(alias))) { console.error("alias no válido"); process.exit(2); }
const raw = leerJson(ent);
if (!raw || raw.origen !== "consola" || !Array.isArray(raw.frames) || !raw.frames[0]?.r?.controles) { console.error("El archivo no parece una salida del fragmento de consola (falta origen/frames)."); process.exit(2); }
const inv = construirInventario({ pagina: raw.pagina, frames: raw.frames, origen: "consola" });
if ((raw.marcos_sin_inspeccionar ?? []).length) inv.obstaculos.push({ codigo: "marcos_sin_inspeccionar_en_consola", severidad: "media", n: raw.marcos_sin_inspeccionar.length, detalle: "El fragmento solo inspecciona el documento superior. Para un iframe, cámbialo en el selector de contexto de la consola («top») y vuelve a ejecutarlo." });
imprimirResumen(inv, guardarObservacion(inv, borradorMapeo(inv), alias));
