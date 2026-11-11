// Ayudas de las pruebas del agente local: NEXA de prueba (Deno + PGlite), simulador con autorización humana, personas de la demostración, órdenes y agentes.
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMINIO_CONCESION } from "../comun/concesion.mjs";
import { crearAgente, vincular } from "../agente/agente.mjs";
import { iniciarSimulador } from "../simulador/servidor.mjs";

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export async function esperar(cond, { ms = 20000, paso = 40, que = "condición" } = {}) {
  const lim = Date.now() + ms; let v;
  while (Date.now() < lim) { v = await cond(); if (v) return v; await dormir(paso); }
  throw new Error(`tiempo agotado esperando: ${que}`);
}

/** «NEXA» solo para pruebas de concesiones: un par de claves propio para firmar tokens de prueba con node:crypto. */
export function parNexaDePrueba() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publica = publicKey.export({ format: "jwk" }).x;
  const firmar = (c) => { const cuerpo = Buffer.from(JSON.stringify(c)).toString("base64url"); return `${cuerpo}.${sign(null, Buffer.from(`${DOMINIO_CONCESION}\n${cuerpo}`), privateKey).toString("base64url")}`; };
  const concesion = (o) => firmar({ v: 1, usuario: "u-prueba", emitida: new Date().toISOString(), expira: new Date(Date.now() + (o.expira_seg ?? 300) * 1000).toISOString(), jti: randomBytes(16).toString("hex"), ...o });
  return { publica, firmar, concesion };
}

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
/** Petición a NEXA de prueba (http, o https confiando SOLO en el certificado de prueba). */
function pedirHttp(base, ca, { metodo, ruta, headers = {}, cuerpo }) {
  return new Promise((ok, ko) => {
    const u = new URL(base + ruta), seguro = u.protocol === "https:", t = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
    const r = (seguro ? https : http).request({ method: metodo, hostname: u.hostname, port: u.port, path: u.pathname + u.search, agent: false, headers: { ...headers, ...(t !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(t) } : {}) }, ...(seguro ? { ca } : {}) }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => ok({ status: res.statusCode, texto: Buffer.concat(c).toString(), headers: res.headers }));
    }); r.on("error", ko); if (t !== undefined) r.write(t); r.end();
  });
}
const CERT = (n) => fileURLToPath(new URL(`./certificados/${n}`, import.meta.url));
/** Arranca NEXA de prueba (proceso Deno) y espera su línea PRUEBA_LISTA. `tls`: sirve por HTTPS con el certificado de prueba (el agente solo confía en él si se le entrega como `ca`). */
export async function arrancarNexa({ tls = false } = {}) {
  const puerto = 9700 + Math.floor(Math.random() * 250);
  const hijo = spawn("deno", ["run", "-A", "--node-modules-dir=none", join(RAIZ, "pruebas/nexa_prueba.ts"), `--puerto=${puerto}`, ...(tls ? ["--tls"] : [])], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FEL_AGENTE_SUPERVISOR_MS: "100" } });
  const info = await new Promise((ok, ko) => {
    let salida = ""; const t = setTimeout(() => { hijo.kill(); ko(new Error("NEXA de prueba no arrancó:\n" + salida)); }, 120000);
    const leer = (d) => { salida += d; const m = /PRUEBA_LISTA (\{.*\})/.exec(salida); if (m) { clearTimeout(t); ok(JSON.parse(m[1])); } };
    hijo.stdout.on("data", leer); hijo.stderr.on("data", leer); hijo.on("exit", (c) => { if (c) ko(new Error(`NEXA de prueba terminó (${c}):\n${salida}`)); });
  });
  const ca = tls ? readFileSync(CERT("localhost.crt"), "utf8") : undefined, base = `${tls ? "https" : "http"}://127.0.0.1:${info.puerto}`;
  const api = async (usuario, metodo, ruta, cuerpo) => {
    const r = await pedirHttp(base, ca, { metodo, ruta, headers: { "x-demo": "1", "x-demo-usuario": usuario }, cuerpo }); let json = null; try { json = JSON.parse(r.texto); } catch { /* sin JSON */ } return { status: r.status, json, texto: r.texto };
  };
  const prueba = async (metodo, ruta, cuerpo) => JSON.parse((await pedirHttp(base, ca, { metodo, ruta, cuerpo })).texto);
  const claves = info.claves_nexa;
  return { base, info, api, prueba, ca, claves, opcionesAgente: { claves, ...(ca ? { ca } : {}) }, ordenes: () => prueba("GET", "/prueba/ordenes"), auditoria: () => prueba("GET", "/prueba/auditoria"), parar: async () => { hijo.kill("SIGTERM"); await new Promise((r) => hijo.once("exit", r)); } };
}

let secNit = 1000000 + Math.floor(Math.random() * 500000);
/** Documento revisado y certificación SOLICITADA por el canal asistido ⇒ queda una orden pendiente para el agente. */
export async function nuevaOrden(nexa, o = {}) {
  const cliente = o.cliente ?? { tipo_identificacion: "NIT", numero_identificacion: `${++secNit}-${secNit % 10}`, nombre: "Cliente de prueba" };
  const d = await nexa.api("marta", "POST", "/api/documentos", { cliente_nuevo: cliente, lineas: o.lineas ?? [{ descripcion: "Servicio de prueba", cantidad: "2", precio_unitario: "10.50" }], establecimiento_id: nexa.info.establecimientos[0].id, fecha: "2026-11-11" });
  if (d.status !== 200) throw new Error(`no se creó el documento: ${d.texto}`);
  const doc = d.json.documento.id;
  const r = await nexa.api("ana", "POST", `/api/documentos/${doc}/estado`, { estado: "revisado", version: d.json.documento.version }); if (r.status !== 200) throw new Error(`no se revisó: ${r.texto}`);
  const c = await nexa.api("ana", "POST", `/api/documentos/${doc}/certificar`, { clave: `clave-${randomUUID()}`, escenario: "exito" }); if (c.status !== 200) throw new Error(`no se solicitó la certificación: ${c.texto}`);
  const orden = (await nexa.ordenes()).find((x) => x.documento_id === doc);
  return { doc, orden: orden.id, operacion: orden.operacion_id };
}
export const ordenDe = async (nexa, id) => (await nexa.ordenes()).find((x) => x.id === id);

/** Simulador con autorización humana exigida (clave pública de NEXA) y destino de las concesiones configurado en NEXA de prueba. */
export async function arrancarSimulador(nexa, opciones = {}) {
  const sim = await iniciarSimulador({ clavePublicaNexa: nexa.info.clave_publica, ...opciones });
  await nexa.prueba("POST", "/prueba/config", { simulador: `${sim.url}/nexa/autorizaciones` });
  return sim;
}

/** Equipo vinculado con un código nuevo de la empresa (la persona con permiso lo genera). Devuelve el agente listo para usar. */
export async function nuevoAgente(nexa, sim, { nombre = "PC de prueba", config = {}, ganchos, estado } = {}) {
  const dir = estado ?? mkdtempSync(join(tmpdir(), "nexa-agente-"));
  const cod = (await nexa.api("ana", "POST", "/api/agentes/codigo", {})).json.codigo;
  const v = await vincular({ nexa: nexa.base, codigo: cod, estado: dir, nombre, ...nexa.opcionesAgente });
  const agente = crearAgente({ estado: dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos, ...nexa.opcionesAgente, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500, headless: true, ...config } });
  return { ...agente, id: v.agente_id, dir, limpiar: () => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }) };
}
export const persona = (nexa) => ({
  vistaPrevia: (orden, u = "ana") => nexa.api(u, "GET", `/api/ordenes/${orden}/vista-previa`),
  autorizar: (orden, u = "ana") => nexa.api(u, "POST", `/api/ordenes/${orden}/autorizar`, {}),
});
/** La «persona» pulsa Confirmar en la ventana del agente (la prueba actúa como una persona frente al navegador). */
export async function pulsarConfirmar(pagina) {
  await pagina.click("#btn-confirmar");
  await Promise.race([pagina.waitForSelector("#seccion-resultado:not([hidden])", { timeout: 8000 }), pagina.waitForSelector("#errores:not([hidden])", { timeout: 8000 })]);
  return { resultado: await pagina.locator("#seccion-resultado").isVisible() ? await pagina.locator("#resultado-titulo").innerText() : null, error: await pagina.locator("#errores").isVisible() ? await pagina.locator("#errores").innerText() : null };
}
