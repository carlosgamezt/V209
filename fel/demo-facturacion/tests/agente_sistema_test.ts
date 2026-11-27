// Punto 1 · El protocolo del agente servido por `nexa-sys` (ruta firmada, SIN el secreto de sistema), de punta a punta sobre PostgreSQL en memoria con M-D…M-Q.
// Comprueba autenticación efectiva (firma Ed25519 sobre método, ruta, hora, nonce y hash del cuerpo), repetición, alcance de empresa, revocación, ausencia de oráculo de existencia y límites por origen/agente.
// Cada rechazo se verifica por su CÓDIGO estable (FEL_FIRMA, FEL_REPETICION, FEL_RELOJ, FEL_REVOCADO, FEL_EMPRESA, FEL_LIMITE, FEL_CODIGO), no por «cualquier error».
import assert from "node:assert/strict";
import { crearBd } from "../src/bd_memoria.ts";
import { prepararBase } from "../src/aprovisionar.ts";
import { activarEstablecimientosLocal } from "../src/demo_establecimientos.ts";
import { crearManejadorSistema } from "../src/sistema.ts";
import { crearPlanoControl } from "../../proveedores/src/plano_control_agente.ts";
import { cabecerasFirmadas, generarParClaves, sha256Hex } from "../../proveedores/src/firma_agente.ts";
import { EMPRESA2 } from "../src/mundo_practico.ts";
import { EMPRESA } from "../src/mundo_demo.ts";

const SEC = "secreto-de-sistema-para-pruebas-0123456789"; const o = { sanitizeOps: false, sanitizeResources: false };
type J = Record<string, any>; // deno-lint-ignore no-explicit-any
async function entorno() {
  const bd = await crearBd(); await prepararBase(bd, { sembrar: true }); await activarEstablecimientosLocal(bd);
  const origenes: string[] = []; const plano = crearPlanoControl({ rpc: bd.rpc, origen: async (req) => { const ip = req.headers.get("x-prueba-ip") ?? ""; origenes.push(ip); return ip ? (await sha256Hex(new TextEncoder().encode(ip))).slice(0, 32) : null; } });
  const h = crearManejadorSistema({ sys: () => bd, secreto: SEC, agente: plano });
  const dueno = async (emp: string) => (await bd.filas<{ u: string }>("select user_id u from public.miembros where empresa_id = $1 and rol = 'propietario' limit 1", [emp]))[0].u;
  const codigo = async (emp: string) => (await bd.rpc("fel_op_agente_codigo_crear", { p_actor: await dueno(emp), p_empresa: emp }) as J).codigo as string;
  const post = async (ruta: string, cuerpo: unknown, cab: Record<string, string> = {}) => { const r = await h(new Request("http://x" + ruta, { method: "POST", headers: { "content-type": "application/json", ...cab }, body: JSON.stringify(cuerpo) })); return { status: r.status, json: await r.json() as J }; };
  const vincular = async (emp: string, nombre = "Equipo de prueba") => { const par = await generarParClaves(); const pub = par.publica; const c = await codigo(emp);
    const r = await post("/api/agente/v1/vincular", { codigo: c, clave_publica: pub, nombre, version: "9" }); assert.equal(r.status, 200, JSON.stringify(r.json)); return { id: r.json.agente_id as string, par, emp: r.json.empresa_id as string }; };
  const firmado = async (ag: { id: string; par: { privada: CryptoKey } }, ruta: string, cuerpo: unknown, extra: Partial<Parameters<typeof cabecerasFirmadas>[0]> = {}, cuerpoEnviado?: unknown) =>
    post(ruta, cuerpoEnviado ?? cuerpo, await cabecerasFirmadas({ agenteId: ag.id, privada: ag.par.privada, ruta, cuerpo: JSON.stringify(cuerpo), ...extra }));
  return { bd, h, post, vincular, firmado, codigo, origenes };
}
const R = "/api/agente/v1/";

Deno.test({ name: "P1 agente: vincular con código + latido firmado funcionan por nexa-sys; la ruta no usa el secreto de sistema; /tick sigue exigiéndolo", ...o, fn: async () => {
  const e = await entorno(); const ag = await e.vincular(EMPRESA);
  const l = await e.firmado(ag, R + "latido", { version: "9" }); assert.equal(l.status, 200, JSON.stringify(l.json)); assert.equal(l.json.ok, true);
  const bajoPrefijo = await e.firmado(ag, "/nexa-sys" + R + "latido", { version: "9" }); assert.equal(bajoPrefijo.status, 200, "con el prefijo de la función, firmando ESA ruta");
  assert.equal((await e.post("/tick", {})).status, 401, "/tick exige el secreto");
  assert.equal((await e.post("/tick", {}, { "x-nexa-sys-secreto": SEC })).status, 200);
  // sin la opción `agente`, esas rutas no existen
  const sin = crearManejadorSistema({ sys: () => e.bd, secreto: SEC }); assert.equal((await sin(new Request("http://x" + R + "latido", { method: "POST", headers: { "x-nexa-sys-secreto": SEC } }))).status, 404);
  // rutas vecinas no pasan por el plano del agente
  for (const r of ["/api/agente/v1/otra", "/x/api/agente/v1/latido", "/api/agente/v1/latido/x", "/api/agente/v2/latido"]) assert.equal((await e.post(r, {}, { "x-nexa-sys-secreto": SEC })).status, 404, r);
}});

Deno.test({ name: "P1 agente: firma — cuerpo alterado, otra ruta, otro agente, clave ajena y agente desconocido dan la MISMA respuesta (FEL_FIRMA) sin oráculo de existencia", ...o, fn: async () => {
  const e = await entorno(); const a = await e.vincular(EMPRESA, "A"), b = await e.vincular(EMPRESA2, "B"); const cuerpo = { version: "9" };
  const cod = async (r: { status: number; json: J }) => `${r.status}:${r.json.codigo}`;
  assert.equal(await cod(await e.firmado(a, R + "latido", cuerpo, {}, { version: "10" })), "401:FEL_FIRMA", "cuerpo alterado tras firmar");
  const cab = await cabecerasFirmadas({ agenteId: a.id, privada: a.par.privada, ruta: R + "latido", cuerpo: JSON.stringify(cuerpo) });
  assert.equal(await cod(await e.post(R + "reclamar", cuerpo, cab)), "401:FEL_FIRMA", "firma de /latido reutilizada en /reclamar (la ruta está firmada)");
  assert.equal(await cod(await e.post(R + "latido", cuerpo, { ...cab, "x-agente": b.id })), "401:FEL_FIRMA", "firma de A con el id de B");
  const ajena = await generarParClaves(); assert.equal(await cod(await e.firmado({ id: a.id, par: ajena }, R + "latido", cuerpo)), "401:FEL_FIRMA", "firmado con una clave que no es la registrada");
  const desconocido = await e.firmado({ id: "a0000000-0000-4000-8000-0000000000ff", par: ajena }, R + "latido", cuerpo); assert.equal(await cod(desconocido), "401:FEL_FIRMA", "agente desconocido = firma inválida");
  assert.deepEqual(desconocido.json, (await e.firmado({ id: a.id, par: ajena }, R + "latido", cuerpo)).json, "mismo cuerpo de respuesta: no revela si el agente existe");
  assert.equal(await cod(await e.post(R + "latido", cuerpo, {})), "401:FEL_FIRMA", "sin cabeceras de firma");
  assert.equal(await cod(await e.post(R + "latido", cuerpo, { ...cab, "x-nonce": "corto" })), "401:FEL_FIRMA", "nonce mal formado");
}});

Deno.test({ name: "P1 agente: repetición — el mismo nonce no vale dos veces; reloj desfasado; revocación inmediata", ...o, fn: async () => {
  const e = await entorno(); const a = await e.vincular(EMPRESA); const cuerpo = { version: "9" }; const nonce = "nonce-unico-0123456789abc";
  const cab = await cabecerasFirmadas({ agenteId: a.id, privada: a.par.privada, ruta: R + "latido", cuerpo: JSON.stringify(cuerpo), nonce });
  const primero = await e.post(R + "latido", cuerpo, cab); assert.equal(primero.status, 200);
  const repetido = await e.post(R + "latido", cuerpo, cab); assert.equal(repetido.status, 401); assert.equal(repetido.json.codigo, "FEL_REPETICION", "repetir EXACTAMENTE la petición firmada se rechaza");
  const viejo = await e.firmado(a, R + "latido", cuerpo, { ts: new Date(Date.now() - 10 * 60_000).toISOString() }); assert.equal(viejo.status, 401); assert.equal(viejo.json.codigo, "FEL_RELOJ", "marca de tiempo fuera de ventana");
  const futuro = await e.firmado(a, R + "latido", cuerpo, { ts: new Date(Date.now() + 10 * 60_000).toISOString() }); assert.equal(futuro.json.codigo, "FEL_RELOJ");
  await e.bd.ejecutar("update public.agentes_locales set estado = 'revocado', revocado_en = now() where id = $1", [a.id]);
  const rev = await e.firmado(a, R + "latido", cuerpo); assert.equal(rev.status, 403); assert.equal(rev.json.codigo, "FEL_REVOCADO", "revocado: solo quien posee la clave llega a saberlo");
}});

Deno.test({ name: "P1 agente: alcance de empresa — un agente no toca órdenes de otra empresa ni de una orden inexistente; la empresa nunca sale del cuerpo", ...o, fn: async () => {
  const e = await entorno(); const a = await e.vincular(EMPRESA, "A"), b = await e.vincular(EMPRESA2, "B");
  const ord = "b0000000-0000-4000-8000-000000000001";
  for (const [op, cuerpo] of [["progreso", { orden: ord, token: 1, fase: "llenando" }], ["resultado", { orden: ord, token: 1, tipo: "descartado" }], ["vista_previa", { orden: ord, token: 1, hash: "a".repeat(64), resumen: {} }]] as const) {
    const r = await e.firmado(b, R + op, cuerpo); assert.equal(r.status, 403, `${op}: ${JSON.stringify(r.json)}`); assert.equal(r.json.codigo, "FEL_EMPRESA", `${op}: la orden no es de su empresa`);
  }
  const inyectado = await e.firmado(a, R + "latido", { version: "9", empresa_id: EMPRESA2, p_empresa: EMPRESA2 }); assert.equal(inyectado.status, 200);
  const rec = await e.firmado(a, R + "reclamar", { version: "9" }); assert.equal(rec.status, 200); assert.equal(rec.json.orden, null, "sin órdenes de su empresa no recibe nada");
  assert.equal((await e.bd.filas("select 1 from public.agentes_locales where id = $1 and empresa_id = $2", [a.id, EMPRESA])).length, 1);
}});

Deno.test({ name: "P1 agente: límites — la vinculación se limita POR ORIGEN (otro origen sigue vinculando), el origen se manda en huella y el agente tiene su propio tope", ...o, fn: async () => {
  const e = await entorno(); const par = await generarParClaves();
  const mal = (ip: string) => e.post(R + "vincular", { codigo: "CODIGO-FALSO-" + Math.random().toString(36).slice(2, 6), clave_publica: par.publica, nombre: "x", version: "9" }, { "x-prueba-ip": ip });
  for (let i = 0; i < 10; i++) { const r = await mal("203.0.113.9"); assert.equal(r.json.codigo, "FEL_CODIGO"); }
  const limite = await mal("203.0.113.9"); assert.equal(limite.status, 429); assert.equal(limite.json.codigo, "FEL_LIMITE", "el origen atacante se limita");
  const otro = await mal("198.51.100.7"); assert.equal(otro.json.codigo, "FEL_CODIGO", "OTRO origen no está bloqueado por el atacante (antes: 429 para todos)");
  // un código válido desde un origen no limitado se vincula aunque el atacante siga inundando
  const c = await e.codigo(EMPRESA); const buena = await e.post(R + "vincular", { codigo: c, clave_publica: (await generarParClaves()).publica, nombre: "legítimo", version: "9" }, { "x-prueba-ip": "198.51.100.7" }); assert.equal(buena.status, 200);
  // el origen se guarda en huella (nunca la IP en claro)
  const guardados = await e.bd.filas<{ origen: string }>("select distinct origen from public.vinculacion_fallos"); assert.ok(guardados.length >= 2 && guardados.every((g) => /^[0-9a-f]{32}$/.test(g.origen)), "huellas hexadecimales de 32");
  assert.ok(!JSON.stringify(guardados).includes("203.0.113"), "la IP en claro no se almacena");
  // tope por agente
  const ag = await e.vincular(EMPRESA, "ruidoso"); await e.bd.ejecutar("update public.plataforma_parametros set valor = 3 where clave = 'agente_max_peticiones_min'");
  for (let i = 0; i < 3; i++) assert.equal((await e.firmado(ag, R + "latido", { version: "9" })).status, 200);
  const tope = await e.firmado(ag, R + "latido", { version: "9" }); assert.equal(tope.status, 429); assert.equal(tope.json.codigo, "FEL_LIMITE");
  const otroAg = await e.vincular(EMPRESA2, "tranquilo"); assert.equal((await e.firmado(otroAg, R + "latido", { version: "9" })).status, 200, "el tope de un agente no afecta a otro");
}});
