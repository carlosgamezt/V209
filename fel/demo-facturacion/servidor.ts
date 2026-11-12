// DEMOSTRACIÓN FUNCIONAL de NEXA FEL · facturación individual SIMULADA.
// Arranca una base PostgreSQL real en memoria (PGlite) con las migraciones del proyecto, el orquestador real y el proveedor SIMULADO, y sirve la interfaz.
// Solo escucha en 127.0.0.1. No usa credenciales, no se conecta a SAT ni a ningún certificador y no emite nada: todo lleva «SIMULADO - SIN VALOR FISCAL».
// Uso:  deno run -A servidor.ts [--puerto=8787]
import { fileURLToPath } from "node:url";
import { crearBdPg } from "./src/bd.ts";
import { AlmacenMemoria, AlmacenPg } from "./src/almacen.ts";
import { prepararBase, ErrorAprovisionar } from "./src/aprovisionar.ts";
import { CLAVE_DEMO, PERSONAS, sembrarPractico } from "./src/mundo_practico.ts";
import { Sesiones } from "./src/sesiones.ts";
import { semillaNueva, uriOtp } from "./src/totp.ts";
import { LimiteTasa } from "./src/limite.ts";
import { crearEndurecimiento } from "./src/endurecimiento.ts";
import { leerConfigPublicada } from "./src/publicado.ts";
import { crearApi } from "./src/api.ts";
import { montarAgente } from "./src/agente_demo.ts";
import { intervaloDesdeEntorno } from "../proveedores/src/supervisor_ordenes.ts";
import { PREFIJO_AGENTE } from "../proveedores/src/plano_control_agente.ts";

const arg = (n: string, d: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const LOGIN = (Deno.env.get("FEL_DEMO_LOGIN") ?? "1") !== "0";   // «0»: modo de pruebas con selector de personas y sin contraseña (lo usan las pruebas automáticas)
const LAN = Deno.args.includes("--lan") || Deno.env.get("FEL_DEMO_LAN") === "1";   // permitir abrir la demostración desde otro equipo de la red (teléfono): exige inicio de sesión
if (LAN && !LOGIN) { console.error("--lan exige el inicio de sesión (FEL_DEMO_LOGIN distinto de 0)."); Deno.exit(1); }
// MODO PUBLICADO (demostración privada en línea detrás de HTTPS): credenciales y semillas MFA solo por variables de entorno, nada de contraseñas públicas, límites de tasa, cabeceras estrictas, sin plano del agente.
const PUBLICADO = Deno.env.get("FEL_DEMO_PUBLICADO") === "1";
if (PUBLICADO && !LOGIN) { console.error("El modo publicado exige el inicio de sesión."); Deno.exit(1); }
let CONFIG_PUB: ReturnType<typeof leerConfigPublicada> | undefined;
if (PUBLICADO) { try { CONFIG_PUB = leerConfigPublicada((k) => Deno.env.get(k), Object.keys(PERSONAS)); } catch (e) { console.error(`Configuración del modo publicado no válida: ${(e as Error).message}`); Deno.exit(1); } }
const HOSTS_EXTRA = CONFIG_PUB?.hosts ?? (Deno.env.get("FEL_DEMO_HOSTS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);   // nombres permitidos (p. ej. el de un túnel HTTPS)
const PUERTO = Number(arg("puerto", Deno.env.get("PORT") ?? Deno.env.get("FEL_DEMO_PUERTO") ?? "8787"));
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json; charset=utf-8", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// BASE DE DATOS: sin FEL_DEMO_BD_URL, PostgreSQL en memoria (PGlite; se pierde al cerrar). Con ella, la base REAL (Supabase/PostgreSQL) con las migraciones del proyecto aplicadas: todo persiste.
const BD_URL = Deno.env.get("FEL_DEMO_BD_URL");
const bd = BD_URL ? crearBdPg(BD_URL) : await (await import("./src/bd_memoria.ts")).crearBd();   // PGlite solo se carga en modo memoria
let mundo;
try { mundo = await prepararBase(bd, { sembrar: true, aviso: (m) => console.log(`  ${m}`) }); }
catch (e) { if (e instanceof ErrorAprovisionar) { console.error(e.message); Deno.exit(1); } throw e; }
const ALEATORIAS = !PUBLICADO && (LAN || Deno.env.get("FEL_DEMO_CLAVE_ALEATORIA") === "1");   // acceso desde otros equipos / remoto: nunca contraseñas públicas
const sesiones = LOGIN ? new Sesiones(undefined, bd.tipo === "pg" ? new AlmacenPg(bd) : new AlmacenMemoria(PERSONAS)) : undefined;
// auditoría de la autenticación en el registro de auditoría de NEXA FEL (nunca contraseñas ni códigos)
if (sesiones) sesiones.auditar = async (evento, usuario, detalle = {}) => { try { const c = await sesiones.almacen.cuenta(usuario); await bd.filas("select public.fel_auditar($1, $2, $3, $4, $5, $6)", [c?.persona.empresa ?? null, c?.persona.id ?? null, `demo.${evento}`, "sesion", usuario, { ...detalle, existe: !!c }]); } catch (e) { console.error("auditoría:", (e as Error).message); } };
const CLAVES: Record<string, string> = {};
const aleatoria = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
if (sesiones) {
  sesiones.claveDemoPublica = ALEATORIAS || PUBLICADO ? null : CLAVE_DEMO; sesiones.forzarSeguro = PUBLICADO;
  if (PUBLICADO) { for (const [u, c] of Object.entries(CONFIG_PUB!.claves)) await sesiones.registrar(u, c, PERSONAS[u]); }   // solo las cuentas con contraseña configurada pueden entrar
  else for (const k of Object.keys(PERSONAS)) { if (bd.tipo === "pg" && await sesiones.persona(k)) continue; CLAVES[k] = ALEATORIAS ? aleatoria() : CLAVE_DEMO; await sesiones.registrar(k, CLAVES[k], PERSONAS[k]); }   // con base persistente no se pisan las contraseñas que las personas ya cambiaron
}
const agente = montarAgente(bd, { intervaloMs: intervaloDesdeEntorno(Deno.env.get("FEL_AGENTE_SUPERVISOR_MS")) });   // intervalo configurable (50 ms – 1 h; 15 s por defecto)
// Verificación en dos pasos (TOTP) del administrador de la plataforma: obligatoria en modo remoto o con FEL_DEMO_MFA=1 (semillas fijas opcionales: FEL_DEMO_MFA_SEMILLAS="maestro=BASE32,maestro2=BASE32")
const MFA = new Map<string, string>();
if (sesiones && PUBLICADO) { for (const [u, s] of Object.entries(CONFIG_PUB!.semillas)) MFA.set(u, s); }   // semillas por entorno: NUNCA se imprimen
else if (sesiones && (ALEATORIAS || Deno.env.get("FEL_DEMO_MFA") === "1")) {
  const fijas = Object.fromEntries((Deno.env.get("FEL_DEMO_MFA_SEMILLAS") ?? "").split(",").filter(Boolean).map((x) => x.split("=") as [string, string]));
  for (const u of ["maestro", "maestro2"]) MFA.set(u, fijas[u] ?? semillaNueva());
  console.log("\n  Verificación en dos pasos (aplicación de autenticación) para el administrador de la plataforma:");
  for (const [u, s] of MFA) console.log(`    ${u.padEnd(9)} clave ${s}\n              ${uriOtp(u, s)}`);
}
const api = crearApi(bd, mundo, { supervisor: agente.supervisor, metricas: agente.metricas, sesiones, practico: true, mfa: MFA });

async function estatico(ruta: string): Promise<Response> {
  let archivo: string;
  if (ruta === "/" || ruta === "/index.html") archivo = `${AQUI}web/index.html`;
  else if (ruta === "/manifest.webmanifest") archivo = `${AQUI}web/manifest.webmanifest`;
  else if (ruta === "/sw.js") archivo = `${AQUI}web/sw.js`;
  else if (ruta.startsWith("/web/")) archivo = `${AQUI}${ruta.slice(1)}`;
  else if (/^\/app\/(css|js)\/[A-Za-z0-9._-]+$/.test(ruta)) archivo = `${AQUI}../${ruta.slice(1)}`;   // identidad visual y utilidades de la interfaz de NEXA FEL
  else return new Response("No encontrado", { status: 404 });
  if (archivo.includes("..") && !ruta.startsWith("/app/")) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await Deno.readFile(archivo); const ext = archivo.slice(archivo.lastIndexOf("."));
    return new Response(datos, { headers: { "content-type": TIPOS[ext] ?? "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff", "cache-control": "no-store", "referrer-policy": "no-referrer", ...(ruta === "/sw.js" ? { "service-worker-allowed": "/" } : {}) } });
  } catch { return new Response("No encontrado", { status: 404 }); }
}

const endurecer = crearEndurecimiento({ publicado: PUBLICADO, hosts: HOSTS_EXTRA, lan: LAN, limiteLogin: new LimiteTasa(Number(Deno.env.get("FEL_DEMO_LIMITE_LOGIN") ?? "10"), 60_000), limiteApi: new LimiteTasa(Number(Deno.env.get("FEL_DEMO_LIMITE_API") ?? "400"), 60_000) });

const servidor = Deno.serve({ hostname: LAN || PUBLICADO ? "0.0.0.0" : "127.0.0.1", port: PUERTO, onListen: ({ port }) => {
  if (PUBLICADO) { console.log(`\n  NEXA FEL · demostración PRIVADA en línea (SIMULADA, sin valor fiscal)\n  Escuchando en el puerto ${port}; nombres permitidos: ${HOSTS_EXTRA.join(", ")}; inicio de sesión y verificación en dos pasos obligatorios. Sin credenciales en este registro.\n`); }
  else console.log(`\n  NEXA FEL · demostración de facturación individual SIMULADA\n  Abre:  http://127.0.0.1:${port}/\n${LAN ? "  En la red local: http://<IP de este equipo>:" + port + "/  (modo --lan: solo con inicio de sesión)\n" : ""}${LOGIN ? (ALEATORIAS ? `  Contraseñas ALEATORIAS de esta sesión (solo se muestran aquí):\n${Object.entries(CLAVES).map(([u, c]) => `    ${u.padEnd(9)} ${c}`).join("\n")}\n` : `  Usuarios ficticios: maestro, maestro2, ana, luis, marta, pedro, sofia · contraseña: ${CLAVE_DEMO}\n`) : "  Modo de pruebas: selector de personas, sin contraseña\n"}  (todo es simulado: SIN VALOR FISCAL; no se conecta a SAT ni a ningún certificador; Ctrl+C para salir)\n`);
  if (!PUBLICADO && Deno.args.includes("--abrir")) { try { const url = `http://127.0.0.1:${port}/`; const [cmd, ...args] = Deno.build.os === "windows" ? ["cmd", "/c", "start", "", url] : Deno.build.os === "darwin" ? ["open", url] : ["xdg-open", url]; new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).spawn().unref(); } catch { /* sin navegador predeterminado: se abre a mano */ } }
} }, async (req) => {
  const previo = await endurecer.previo(req); if (previo) return previo;
  const url = new URL(req.url);
  if (url.pathname.startsWith(PREFIJO_AGENTE)) return PUBLICADO ? endurecer.asegurar(new Response("No encontrado", { status: 404 })) : agente.plano(req);   // plano de control del agente local (firmado); NO se ofrece en línea
  return endurecer.asegurar(url.pathname.startsWith("/api/") ? await api(req) : await estatico(url.pathname));
});
agente.supervisor.iniciar();

// Cierre ordenado (Ctrl+C o señal de terminación): primero el supervisor (espera al ciclo en curso), luego el servidor y la base.
let cerrando = false;
async function cierre(senal: string) {
  if (cerrando) return; cerrando = true;
  console.log(`\n  Cerrando (${senal})…`);
  await agente.supervisor.detener();
  await servidor.shutdown();
  await bd.cerrar();
  console.log("  Cierre ordenado completado.");
  Deno.exit(0);
}
for (const senal of ["SIGINT", "SIGTERM"] as const) { try { Deno.addSignalListener(senal, () => { void cierre(senal); }); } catch { /* señal no disponible en este sistema (p. ej. SIGTERM en Windows) */ } }
await servidor.finished;
