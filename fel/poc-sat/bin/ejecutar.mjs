#!/usr/bin/env node
// EJECUTAR: llena el formulario con datos FICTICIOS y SE DETIENE antes de cualquier emisión. Nunca emite, certifica ni envía.
// Uso: node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=mapeo.local.json --datos=config/datos-ficticios.json [--pestana=N]
import path from "node:path";
import { arg, leerJson, elegirPestana, esperarUsuario, RAIZ } from "./comun.mjs";
import { conectar, tomarBloqueo, bloquearEscrituras } from "../src/conexion.mjs";
import { validarAislamiento, validarMapeo, validarDatos, esLoopback } from "../src/guardia.mjs";
import { crearRegistro, formatoMs } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";

// --solo-local: SOLO para la autoprueba con la página de ejemplo; exige que todos los dominios sean locales.
const soloLocal = arg("solo-local") === true;
const [re, rm, rd] = ["empresa", "mapeo", "datos"].map((n) => arg(n));
if (!re || !rm || !rd || [re, rm, rd].includes(true)) { console.error("Uso: --empresa=… --mapeo=… --datos=…"); process.exit(2); }
const empresa = leerJson(re), plan = leerJson(rm), datos = leerJson(rd);
for (const [nombre, r] of [["aislamiento", validarAislamiento([empresa])], ["mapeo", validarMapeo(plan, { local: soloLocal })], ["solo-local", { ok: !soloLocal || (plan.dominios_permitidos ?? []).every(esLoopback), errores: ["--solo-local exige dominios locales"] }], ["datos", validarDatos(datos)]]) if (!r.ok) { console.error(`Se niega a correr (${nombre}):\n - ${r.errores.join("\n - ")}`); process.exit(2); }
const dirRegistros = path.join(RAIZ, "registros", empresa.alias), liberar = tomarBloqueo(dirRegistros);
const registro = crearRegistro({ dir: dirRegistros, empresa: empresa.alias });
console.log(`\nEJECUCIÓN DE PRUEBA · empresa «${empresa.alias}» · datos ficticios · SOLO LECTURA DE RED · parada obligatoria antes de emitir.\nNo se teclean credenciales: la sesión la inició una persona.\n`);
const c = await conectar(empresa);
try {
  await bloquearEscrituras(c.context, { permitir_post: plan.permitir_post ?? [] }, registro);
  const page = elegirPestana(c.context, plan.dominios_permitidos);
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa, esperarUsuario, local: soloLocal });
  const s = r.resumen;
  console.log(`\n== RESUMEN ==\nPasos: ${s.pasos} · automáticos: ${s.automaticos.n} (${formatoMs(s.automaticos.ms)}) · manuales: ${s.manuales.n} (${formatoMs(s.manuales.ms)}) · total: ${formatoMs(s.duracion_total_ms)}\nErrores: ${s.errores.length} · bloqueos de guardia: ${s.bloqueos_de_guardia.length} · solicitudes de red bloqueadas: ${s.solicitudes_bloqueadas.length}\nDetenido antes de emitir: ${s.detenido_antes_de_emitir ? "SÍ" : "NO"} · emitió: NO\nRegistro: ${registro.archivo()}`);
  if (s.solicitudes_bloqueadas.length) console.log("Solicitudes bloqueadas (observación útil: ¿el portal las necesitaba para llenar?):\n  " + [...new Set(s.solicitudes_bloqueadas)].join("\n  "));
  process.exitCode = r.ok ? 0 : 1;
} finally { await c.cerrar(); liberar(); }
