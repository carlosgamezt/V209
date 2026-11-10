#!/usr/bin/env node
// MEDIR-SESIÓN (solo lectura pasiva): mide cuánto tarda el portal en pedir iniciar sesión de nuevo SIN que nadie interactúe.
// Hipótesis a contrastar (NO confirmada): cierre por inactividad entre 20 y 30 minutos. El script solo observa (url, indicadores, 401); no hace
// clics, no recarga, no navega, no manda peticiones. NO TOQUES la ventana durante la medición (si la tocas, mides otra cosa).
// Uso: node bin/medir-sesion.mjs --empresa=config/empresa.local.json [--mapeo=mapeo.local.json] [--intervalo=30] [--max-min=45] [--pestana=N]
import fs from "node:fs";
import path from "node:path";
import { arg, leerJson, elegirPestana, RAIZ } from "./comun.mjs";
import { conectar, tomarBloqueo } from "../src/conexion.mjs";
import { validarAislamiento, validarMapeo } from "../src/guardia.mjs";
import { crearMonitorSesion } from "../src/sesion.mjs";

const re = arg("empresa"); if (!re || re === true) { console.error("Falta --empresa=…"); process.exit(2); }
const empresa = leerJson(re), plan = arg("mapeo") && arg("mapeo") !== true ? leerJson(arg("mapeo")) : null;
if (!validarAislamiento([empresa]).ok) { console.error("empresa no válida"); process.exit(2); }
const soloLocal = arg("solo-local") === true;
if (plan) { const v = validarMapeo(plan, { local: soloLocal }); if (!v.ok) { console.error(`Mapeo no válido:\n - ${v.errores.join("\n - ")}`); process.exit(2); } }
const intervalo = Math.max(1, Number(arg("intervalo", 30))) * 1000, maxMs = Math.max(1, Number(arg("max-min", 45)) * 60000);
const liberar = tomarBloqueo(path.join(RAIZ, "registros", empresa.alias)), c = await conectar(empresa);
try {
  const page = elegirPestana(c.context, plan?.dominios_permitidos ?? null);
  const monitor = crearMonitorSesion({ config: plan?.sesion ?? {}, dominios: plan?.dominios_permitidos ?? [] }); monitor.adjuntar(page);
  console.log(`MEDICIÓN PASIVA · empresa «${empresa.alias}» · cada ${intervalo / 1000}s hasta ${Math.round(maxMs / 60000 * 10) / 10} min · NO toques la ventana. El script no hace ninguna acción.`);
  const t0 = Date.now(), cambios = []; let ultimo = null, primerLogin = null;
  while (Date.now() - t0 < maxMs) {
    const ev = await monitor.evaluar(page);
    if (ev.estado !== ultimo) { cambios.push({ t_ms: Date.now() - t0, estado: ev.estado, razones: ev.razones }); console.log(`  +${Math.round((Date.now() - t0) / 1000)}s  ${ev.estado}  (${ev.razones.join(", ")})`); ultimo = ev.estado; }
    if (ev.estado === "requiere_login") { primerLogin = Date.now() - t0; break; }
    await new Promise((r) => setTimeout(r, intervalo));
  }
  const salida = { fecha: new Date().toISOString(), empresa: empresa.alias, intervalo_ms: intervalo, max_ms: maxMs, duracion_ms: Date.now() - t0, primer_login_detectado_ms: primerLogin, cambios,
    nota: "Mide el tiempo hasta que el portal pidió iniciar sesión sin interacción. Un solo dato no confirma un tiempo de inactividad: repite en distintos momentos. Hipótesis 20–30 min NO confirmada." };
  const dir = path.join(RAIZ, "registros", empresa.alias); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `medicion-sesion-${new Date().toISOString().replace(/[:.]/g, "-")}.json`); fs.writeFileSync(f, JSON.stringify(salida, null, 2));
  console.log(primerLogin == null ? `\nLa sesión NO se cerró en ${Math.round(salida.duracion_ms / 1000)} s.` : `\nEl portal pidió iniciar sesión a los ${Math.round(primerLogin / 1000)} s (${(primerLogin / 60000).toFixed(1)} min) sin interacción.`, `\nGuardado: ${f}`);
} finally { await c.cerrar(); liberar(); }
