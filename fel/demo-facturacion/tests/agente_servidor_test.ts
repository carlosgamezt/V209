// El servidor REAL de la demostración con el plano de control del agente: vinculación, peticiones firmadas por HTTP, permisos de las personas,
// salud del supervisor periódico y CIERRE ORDENADO al recibir la señal de terminación. Todo simulado y local (127.0.0.1, sin red externa ni credenciales).
// Uso: deno test -A tests/agente_servidor_test.ts
import assert from "node:assert/strict";
import { cabecerasFirmadas, generarParClaves } from "../../proveedores/src/firma_agente.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test({ name: "servidor de la demostración: plano de control del agente, supervisor y cierre ordenado", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const puerto = 9600 + Math.floor(Math.random() * 300);
  const hijo = new Deno.Command(Deno.execPath(), { args: ["run", "-A", "servidor.ts", `--puerto=${puerto}`], cwd: RAIZ, env: { FEL_AGENTE_SUPERVISOR_MS: "100", FEL_DEMO_LOGIN: "0" }, stdout: "piped", stderr: "piped" }).spawn();
  let salida = ""; const dec = new TextDecoder();
  const leer = async (s: ReadableStream<Uint8Array>) => { for await (const t of s) salida += dec.decode(t); };
  const lecturas = [leer(hijo.stdout), leer(hijo.stderr)];
  try {
    // stdout y stderr se leen por separado: se espera (con límite) a que AMBOS mensajes de arranque hayan llegado, en lugar de suponer su orden
    const limite = Date.now() + 120_000; while (!(salida.includes("Abre:") && /Supervisor de órdenes iniciado/.test(salida)) && Date.now() < limite) await dormir(100);
    assert.ok(salida.includes("Abre:"), "el servidor no arrancó:\n" + salida);
    assert.match(salida, /Supervisor de órdenes iniciado \(100 ms\)/, "el intervalo del supervisor se configura por entorno");
    const base = `http://127.0.0.1:${puerto}`, persona = (u: string) => ({ "x-demo": "1", "x-demo-usuario": u, "content-type": "application/json" });
    const j = async (r: Response) => ({ status: r.status, json: await r.json() as Record<string, unknown> });
    const usuario = (u: string, m: string, ruta: string, cuerpo?: unknown) => fetch(base + ruta, { method: m, headers: persona(u), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }).then(j);

    // las personas: solo quien tiene agentes.administrar crea el código
    assert.equal((await usuario("marta", "POST", "/api/agentes/codigo", {})).status, 403, "la emisora no vincula agentes");
    assert.equal((await usuario("pedro", "POST", "/api/agentes/codigo", {})).status, 403, "el lector tampoco");
    const cod = (await usuario("ana", "POST", "/api/agentes/codigo", {})).json.codigo as string; assert.match(cod, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    // el agente (sin cabeceras de la demostración): vincula con el código y firma sus peticiones
    const par = await generarParClaves();
    const vinc = await fetch(`${base}/api/agente/v1/vincular`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: cod, clave_publica: par.publica, nombre: "PC de prueba", version: "1.0.0" }) }).then(j);
    assert.equal(vinc.status, 200); const agente = vinc.json.agente_id as string;
    const firmado = async (op: string, cuerpo: Record<string, unknown> = {}) => { const t = JSON.stringify(cuerpo); return fetch(`${base}/api/agente/v1/${op}`, { method: "POST", headers: await cabecerasFirmadas({ agenteId: agente, privada: par.privada, ruta: `/api/agente/v1/${op}`, cuerpo: t }), body: t }).then(j); };
    assert.equal((await firmado("latido", { version: "1.0.0" })).status, 200);
    assert.equal((await firmado("reclamar")).json.orden, null);
    assert.equal((await fetch(`${base}/api/agente/v1/latido`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401, "sin firma no pasa");
    assert.equal((await fetch(`${base}/api/agente/v1/latido`)).status, 405);

    // estado del agente y salud del supervisor (consultables por las personas con permiso)
    const lista = await fetch(`${base}/api/agentes`, { headers: persona("marta") }).then((r) => r.json()) as { id: string; estado: string }[];
    assert.equal(lista.find((a) => a.id === agente)?.estado, "conectado");
    await dormir(450); const salud = (await usuario("pedro", "GET", "/api/agentes/salud")).json as { ok: boolean; en_marcha: boolean; ciclos: number; intervalo_ms: number };
    assert.equal(salud.en_marcha, true); assert.equal(salud.ok, true); assert.ok(salud.ciclos >= 2, `el supervisor debe ciclar solo (ciclos: ${salud.ciclos})`); assert.equal(salud.intervalo_ms, 100);

    // revocación: solo con permiso; después el equipo recibe «revocado» (firma válida) y nada más
    assert.equal((await usuario("marta", "POST", "/api/agentes/revocar", { agente })).status, 403);
    assert.equal((await usuario("ana", "POST", "/api/agentes/revocar", { agente })).status, 200);
    const rev = await firmado("latido"); assert.equal(rev.status, 403); assert.equal(rev.json.codigo, "FEL_REVOCADO");

    // cierre ordenado al recibir la señal: el supervisor se detiene y el proceso termina con código 0
    hijo.kill("SIGTERM"); const estado = await hijo.status; await Promise.all(lecturas);
    assert.equal(estado.code, 0, "salida limpia:\n" + salida);
    assert.match(salida, /Cerrando \(SIGTERM\)/); assert.match(salida, /Supervisor de órdenes detenido/); assert.match(salida, /Cierre ordenado completado/);
    assert.ok(salida.indexOf("Supervisor de órdenes detenido") < salida.indexOf("Cierre ordenado completado"), "primero el supervisor, luego el cierre");
  } finally { try { hijo.kill("SIGKILL"); } catch { /* ya terminó */ } }
} });
