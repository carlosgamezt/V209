#!/usr/bin/env node
// EJECUTAR: llena el formulario con datos FICTICIOS y SE DETIENE antes de cualquier emisión. Nunca emite, certifica ni envía.
// Uso: node bin/ejecutar.mjs --empresa=config/empresa.local.json --mapeo=mapeo.local.json --datos=config/datos-ficticios.json [--pestana=N] [--reanudar | --reiniciar]
//  --reanudar  continúa una ejecución interrumpida (solo tras verificar que la sesión SAT está activa y reconciliar lo ya llenado)
//  --reiniciar descarta el progreso anterior y empieza de cero (hazlo desde un formulario vacío)
import path from "node:path";
import { arg, leerJson, elegirPestana, esperarUsuario, RAIZ } from "./comun.mjs";
import { conectar, tomarBloqueo, bloquearEscrituras } from "../src/conexion.mjs";
import { validarAislamiento, validarMapeo, validarDatos, esLoopback, evaluarAutorizacionSat } from "../src/guardia.mjs";
import { crearRegistro, formatoMs } from "../src/registro.mjs";
import { ejecutarPlan } from "../src/ejecutor.mjs";
import { crearMonitorSesion } from "../src/sesion.mjs";
import { crearProgreso } from "../src/progreso.mjs";
import { crearLibro } from "../src/libro.mjs";

// --solo-local: SOLO para la autoprueba con la página de ejemplo; exige que todos los dominios sean locales.
const soloLocal = arg("solo-local") === true, soloComprobar0 = arg("solo-comprobar") === true;
const [re, rm, rd] = ["empresa", "mapeo", "datos"].map((n) => arg(n));
if (!re || !rm || !rd || [re, rm, rd].includes(true)) { console.error("Uso: --empresa=… --mapeo=… --datos=…"); process.exit(2); }
const empresa = leerJson(re), plan = leerJson(rm), datos = leerJson(rd);
for (const [nombre, r] of [["aislamiento", validarAislamiento([empresa])], ["mapeo", validarMapeo(plan, { local: soloLocal, soloComprobar: soloComprobar0 })], ["autorización", (() => { const a = evaluarAutorizacionSat({ env: process.env, dominios: plan.dominios_permitidos, soloComprobar: soloComprobar0 }); return { ok: a.permitido, errores: a.razones }; })()], ["solo-local", { ok: !soloLocal || (plan.dominios_permitidos ?? []).every(esLoopback), errores: ["--solo-local exige dominios locales"] }], ["datos", validarDatos(datos)]]) if (!r.ok) { console.error(`Se niega a correr (${nombre}):\n - ${r.errores.join("\n - ")}`); process.exit(2); }
const dirRegistros = path.join(RAIZ, "registros", empresa.alias), liberar = tomarBloqueo(dirRegistros);
const soloComprobar = arg("solo-comprobar") === true;   // --solo-comprobar: resuelve y comprueba los localizadores SIN escribir ni pulsar nada y sin dejar progreso ni libro
const progreso = soloComprobar ? null : crearProgreso({ dir: dirRegistros, plan, datos }), libro = soloComprobar ? null : crearLibro({ dir: dirRegistros }), previo = progreso?.cargar() ?? null;
const reanudar = !soloComprobar && arg("reanudar") === true, reiniciar = !soloComprobar && arg("reiniciar") === true;   // --solo-comprobar: resuelve y comprueba los localizadores SIN escribir ni pulsar nada
const salir = (m) => { console.error(m); liberar(); process.exit(2); };
if (reanudar && reiniciar) salir("Elige --reanudar o --reiniciar, no ambos.");
if (previo && previo.estado !== "detenido" && !reanudar && !reiniciar) salir(`Hay una ejecución interrumpida (estado: ${previo.estado}, ${previo.completados.length} pasos hechos). Usa --reanudar (verifica la sesión y lo llenado) o --reiniciar (desde un formulario vacío).`);
if (reanudar && (!previo || previo.estado === "detenido")) salir("No hay una ejecución interrumpida que reanudar.");
if (reanudar && ["requiere_reinicio_manual", "requiere_decision_manual"].includes(previo.estado)) salir(`El estado «${previo.estado}» exige revisar a mano el portal y usar --reiniciar.`);
if (reiniciar) progreso.archivarPrevio();
if (soloComprobar && (arg("reanudar") === true || arg("reiniciar") === true)) salir("--solo-comprobar no se combina con --reanudar ni --reiniciar.");
const registro = crearRegistro({ dir: dirRegistros, empresa: empresa.alias });
console.log(soloComprobar ? `\nCOMPROBACIÓN (solo lectura) · empresa «${empresa.alias}» · NO se escribe, no se pulsa, no se elige, no se sale de ningún campo · se detiene ante cualquier señal inesperada.\nNo se teclean credenciales: la sesión la inició una persona.\n` : `\nEJECUCIÓN DE PRUEBA · empresa «${empresa.alias}» · datos ficticios · SOLO LECTURA DE RED · parada obligatoria antes de emitir.\nNo se teclean credenciales: la sesión la inició una persona.\n`);
const c = await conectar(empresa);
try {
  await bloquearEscrituras(c.context, { permitir_post: plan.permitir_post ?? [], permitir_get: plan.permitir_get ?? [], dominios: plan.dominios_permitidos }, registro);
  const page = elegirPestana(c.context, plan.dominios_permitidos);
  const sesion = crearMonitorSesion({ config: plan.sesion ?? {}, dominios: plan.dominios_permitidos });
  process.on("SIGINT", () => { try { progreso?.estado("interrumpido"); } catch { /* aún sin iniciar */ } liberar(); console.error(soloComprobar ? "\nInterrumpido: no se escribió ni se pulsó nada en el portal." : "\nInterrumpido: el progreso quedó guardado (usa --reanudar). No se emitió nada."); process.exit(130); });
  const r = await ejecutarPlan({ page, plan, datos, registro, empresa, esperarUsuario, local: soloLocal, sesion, progreso, libro, reanudar, soloComprobar,
    detenerSi: soloComprobar ? () => { const b = registro.eventos().find((e) => e.evento === "solicitud_bloqueada"); return b ? `solicitud bloqueada durante la comprobación (${b.metodo} ${b.host}${b.ruta}): ${b.razon}` : null; } : null });
  const s = r.resumen;
  console.log(`\n== RESUMEN ==\nPasos: ${s.pasos} · automáticos: ${s.automaticos.n} (${formatoMs(s.automaticos.ms)}) · manuales: ${s.manuales.n} (${formatoMs(s.manuales.ms)}) · total: ${formatoMs(s.duracion_total_ms)}\nFases: autenticación ${formatoMs(s.fases.autenticacion?.ms ?? 0)} · llenado ${formatoMs(s.fases.llenado?.ms ?? 0)} · espera ${formatoMs(s.fases.espera?.ms ?? 0)} · interrupciones de sesión: ${s.interrupciones_de_sesion} · estado final: ${s.estado_final}\nErrores: ${s.errores.length} · bloqueos de guardia: ${s.bloqueos_de_guardia.length} · solicitudes de red bloqueadas: ${s.solicitudes_bloqueadas.length}\nDetenido antes de emitir: ${s.detenido_antes_de_emitir ? "SÍ" : "NO"} · emitió: NO\nRegistro: ${registro.archivo()}`);
  if (s.solicitudes_bloqueadas.length) console.log("Solicitudes bloqueadas (observación útil: ¿el portal las necesitaba para llenar?):\n  " + [...new Set(s.solicitudes_bloqueadas)].join("\n  "));
  process.exitCode = r.ok ? 0 : 1;
} finally { await c.cerrar(); liberar(); }
