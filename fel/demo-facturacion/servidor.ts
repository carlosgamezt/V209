// DEMOSTRACIÓN FUNCIONAL de NEXA FEL · facturación individual SIMULADA.
// Arranca una base PostgreSQL real en memoria (PGlite) con las migraciones del proyecto, el orquestador real y el proveedor SIMULADO, y sirve la interfaz.
// Solo escucha en 127.0.0.1. No usa credenciales, no se conecta a SAT ni a ningún certificador y no emite nada: todo lleva «SIMULADO - SIN VALOR FISCAL».
// Uso:  deno run -A servidor.ts [--puerto=8787]
import { fileURLToPath } from "node:url";
import { crearBd } from "./src/bd.ts";
import { sembrar } from "./src/mundo_demo.ts";
import { CLAVE_DEMO, PERSONAS, sembrarPractico } from "./src/mundo_practico.ts";
import { Sesiones } from "./src/sesiones.ts";
import { crearApi } from "./src/api.ts";
import { montarAgente } from "./src/agente_demo.ts";
import { intervaloDesdeEntorno } from "../proveedores/src/supervisor_ordenes.ts";
import { PREFIJO_AGENTE } from "../proveedores/src/plano_control_agente.ts";

const arg = (n: string, d: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const LOGIN = (Deno.env.get("FEL_DEMO_LOGIN") ?? "1") !== "0";   // «0»: modo de pruebas con selector de personas y sin contraseña (lo usan las pruebas automáticas)
const LAN = Deno.args.includes("--lan") || Deno.env.get("FEL_DEMO_LAN") === "1";   // permitir abrir la demostración desde otro equipo de la red (teléfono): exige inicio de sesión
const HOSTS_EXTRA = (Deno.env.get("FEL_DEMO_HOSTS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);   // nombres permitidos (p. ej. el de un túnel HTTPS)
if (LAN && !LOGIN) { console.error("--lan exige el inicio de sesión (FEL_DEMO_LOGIN distinto de 0)."); Deno.exit(1); }
const PUERTO = Number(arg("puerto", Deno.env.get("FEL_DEMO_PUERTO") ?? "8787"));
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json; charset=utf-8", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const bd = await crearBd();
const mundo = await sembrar(bd);
await sembrarPractico(bd);
const sesiones = LOGIN ? new Sesiones() : undefined;
if (sesiones) for (const k of Object.keys(PERSONAS)) await sesiones.registrar(k, CLAVE_DEMO);
const agente = montarAgente(bd, { intervaloMs: intervaloDesdeEntorno(Deno.env.get("FEL_AGENTE_SUPERVISOR_MS")) });   // intervalo configurable (50 ms – 1 h; 15 s por defecto)
const api = crearApi(bd, mundo, { supervisor: agente.supervisor, metricas: agente.metricas, sesiones, practico: true });

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

const servidor = Deno.serve({ hostname: LAN ? "0.0.0.0" : "127.0.0.1", port: PUERTO, onListen: ({ port }) => {
  console.log(`\n  NEXA FEL · demostración de facturación individual SIMULADA\n  Abre:  http://127.0.0.1:${port}/\n${LAN ? "  En la red local: http://<IP de este equipo>:" + port + "/  (modo --lan: solo con inicio de sesión)\n" : ""}${LOGIN ? `  Usuarios ficticios: maestro, ana, luis, marta, pedro, sofia · contraseña: ${CLAVE_DEMO}\n` : "  Modo de pruebas: selector de personas, sin contraseña\n"}  (todo es simulado: SIN VALOR FISCAL; no se conecta a SAT ni a ningún certificador; Ctrl+C para salir)\n`);
} }, (req) => {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  const permitido = host === "127.0.0.1" || host === "localhost" || (LAN && (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || HOSTS_EXTRA.includes(host.toLowerCase())));
  if (!permitido) return new Response("Host no permitido", { status: 403 });   // contra DNS rebinding (en --lan solo direcciones IP y los nombres de FEL_DEMO_HOSTS)
  const url = new URL(req.url);
  if (url.pathname.startsWith(PREFIJO_AGENTE)) return agente.plano(req);   // plano de control del agente local: peticiones FIRMADAS, sin cabeceras de la demostración
  return url.pathname.startsWith("/api/") ? api(req) : estatico(url.pathname);
});
agente.supervisor.iniciar();

// Cierre ordenado (Ctrl+C o señal de terminación): primero el supervisor (espera al ciclo en curso), luego el servidor y la base.
let cerrando = false;
async function cierre(senal: string) {
  if (cerrando) return; cerrando = true;
  console.log(`\n  Cerrando (${senal})…`);
  await agente.supervisor.detener();
  await servidor.shutdown();
  await bd.db.close().catch(() => {});
  console.log("  Cierre ordenado completado.");
  Deno.exit(0);
}
for (const senal of ["SIGINT", "SIGTERM"] as const) { try { Deno.addSignalListener(senal, () => { void cierre(senal); }); } catch { /* señal no disponible en este sistema (p. ej. SIGTERM en Windows) */ } }
await servidor.finished;
