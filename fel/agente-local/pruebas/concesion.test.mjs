// Autorización humana en el SIMULADOR (sin NEXA real): una concesión firmada por NEXA es obligatoria, de un solo uso y ligada a empresa, orden y vista previa.
// La clave de NEXA de estas pruebas es un par propio (node:crypto); las pruebas de extremo a extremo usan la NEXA real de prueba (agente.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { crearVerificador } from "../comun/concesion.mjs";
import { crearNucleo, ErrorSim } from "../simulador/nucleo.mjs";
import { iniciarSimulador } from "../simulador/servidor.mjs";
import { parNexaDePrueba } from "./ayudas.mjs";

const nexa = parNexaDePrueba();
const form = () => ({ tipo_documento: "FACT-SIM", fecha: "2026-11-11", moneda: "GTQ", establecimiento: { codigo: "1" }, receptor: { tipo_id: "CF", id: "CF" }, lineas: [{ tipo: "Bien", descripcion: "Café", cantidad: "2", precio_unitario: "5", descuento: "" }] });
const ORDEN = "0a1b2c3d-0000-4000-8000-000000000001";
const preparar = (n, o = {}) => { const s = n.crearSesion({ empresa: "emp-a", referencia: ORDEN, ...o }); const p = n.previsualizar(s, form()); return { s, p }; };
const codigo = (f) => { try { f(); } catch (e) { assert.ok(e instanceof ErrorSim, String(e)); return e.codigo; } assert.fail("debía fallar"); };
const nucleo = () => crearNucleo({ verificarConcesion: crearVerificador(nexa.publica) });
const concesionPara = (s, o = {}) => nexa.concesion({ empresa: s.empresa, orden: s.referencia, resumen_hash: s.hash, ...o });

test("sin concesión no se puede confirmar, aunque el token de la vista previa sea correcto", () => {
  const n = nucleo(), { s, p } = preparar(n);
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA");
  assert.equal(s.estado, "previsualizada"); assert.equal(n.totalEmisiones(), 0);
  assert.ok(n.eventos({ empresa: "emp-a" }).some((e) => e.evento === "confirmacion_bloqueada" && e.detalle === "sin_autorizacion_humana"));
});

test("con la concesión correcta se confirma UNA vez; la misma concesión no sirve para otra confirmación (un solo uso)", () => {
  const n = nucleo(), { s, p } = preparar(n);
  n.registrarConcesion(concesionPara(s));
  const r = n.confirmar(s, { csrf: p.csrf, origen: "humano" }); assert.match(r.emision.autorizacion, /^SIM-/); assert.equal(n.totalEmisiones(), 1);
  const { s: s2, p: p2 } = preparar(n);                                                  // otra sesión con el MISMO contenido y la misma referencia
  assert.equal(codigo(() => n.confirmar(s2, { csrf: p2.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA", "la concesión ya se usó");
  assert.equal(n.totalEmisiones(), 1);
  assert.ok(n.eventos({ empresa: "emp-a" }).some((e) => e.evento === "autorizacion_humana_usada"));
});

test("concesiones que no corresponden se rechazan: otra orden, otra empresa, otro contenido, caducada", () => {
  const n = nucleo(), { s, p } = preparar(n);
  const casos = { "otra orden": { orden: "0a1b2c3d-0000-4000-8000-0000000000ff" }, "otra empresa": { empresa: "emp-b" }, "otro contenido": { resumen_hash: "f".repeat(64) } };
  for (const [nombre, o] of Object.entries(casos)) { n.registrarConcesion(concesionPara(s, o)); assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA", nombre); }
  assert.equal(codigo(() => n.registrarConcesion(concesionPara(s, { expira_seg: -5 }))), "CONCESION_INVALIDA", "caducada: ni se acepta");
  assert.equal(n.totalEmisiones(), 0); assert.equal(s.estado, "previsualizada");
  n.registrarConcesion(concesionPara(s)); n.confirmar(s, { csrf: p.csrf, origen: "humano" }); assert.equal(n.totalEmisiones(), 1);
});

test("una concesión que caduca después de recibirla deja de servir", () => {
  let ahora = Date.now(); const n = crearNucleo({ ahora: () => new Date(ahora), verificarConcesion: crearVerificador(nexa.publica) });
  const { s, p } = preparar(n); n.registrarConcesion(concesionPara(s, { expira_seg: 60 }));
  ahora += 61_000; assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA");
});

test("si el formulario cambia después de la autorización (nuevo hash), la concesión anterior no sirve", () => {
  const n = nucleo(), { s } = preparar(n); const vieja = concesionPara(s); n.registrarConcesion(vieja);
  n.volver(s); const f = form(); f.lineas[0].precio_unitario = "500"; const p2 = n.previsualizar(s, f); assert.ok(p2.ok); assert.notEqual(s.hash, JSON.parse(Buffer.from(vieja.split(".")[0], "base64url")).resumen_hash);
  assert.equal(codigo(() => n.confirmar(s, { csrf: p2.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA"); assert.equal(n.totalEmisiones(), 0);
});

test("concesión forjada: firmada con otra clave (por ejemplo la del agente), alterada o mal formada ⇒ rechazada y no se guarda nada", () => {
  const n = nucleo(), { s, p } = preparar(n);
  const agente = generateKeyPairSync("ed25519"), cuerpo = Buffer.from(JSON.stringify({ v: 1, empresa: s.empresa, orden: s.referencia, resumen_hash: s.hash, usuario: "yo", emitida: new Date().toISOString(), expira: new Date(Date.now() + 60000).toISOString(), jti: "a".repeat(32) })).toString("base64url");
  const forjada = `${cuerpo}.${sign(null, Buffer.from(`nexa-confirmacion-v1\n${cuerpo}`), agente.privateKey).toString("base64url")}`;
  const valida = concesionPara(s), [c, f] = valida.split(".");
  const alterada = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, "base64url")), orden: "otra" })).toString("base64url")}.${f}`;
  for (const t of [forjada, alterada, "", "x", "a.b.c", `${c}.`, `.${f}`, valida + "A", 12345, null]) assert.equal(codigo(() => n.registrarConcesion(t)), "CONCESION_INVALIDA");
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "humano" })), "SIN_AUTORIZACION_HUMANA"); assert.equal(n.totalEmisiones(), 0);
});

test("el agente (origen «agente») sigue sin poder confirmar, ni con una concesión válida", () => {
  const n = nucleo(), { s, p } = preparar(n); n.registrarConcesion(concesionPara(s));
  assert.equal(codigo(() => n.confirmar(s, { csrf: p.csrf, origen: "agente" })), "SOLO_HUMANO"); assert.equal(n.totalEmisiones(), 0);
});

test("HTTP: /nexa/autorizaciones acepta solo firmas válidas, rechaza páginas web (Origin), tipos y tamaños; sin servicio configurado no existe", async () => {
  const sim = await iniciarSimulador({ clavePublicaNexa: nexa.publica }), sin = await iniciarSimulador();
  try {
    const post = (u, c, cab = {}) => fetch(`${u}/nexa/autorizaciones`, { method: "POST", headers: { "content-type": "application/json", ...cab }, body: typeof c === "string" ? c : JSON.stringify(c) });
    const ok = nexa.concesion({ empresa: "emp-a", orden: ORDEN, resumen_hash: "a".repeat(64) });
    assert.equal((await post(sim.url, { token: ok })).status, 200);
    assert.equal((await post(sim.url, { token: "x.y" })).status, 401); assert.equal((await post(sim.url, {})).status, 401);
    assert.equal((await post(sim.url, { token: ok }, { origin: "http://atacante.example" })).status, 403, "una página web no puede entregar concesiones");
    assert.equal((await fetch(`${sim.url}/nexa/autorizaciones`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
    assert.equal((await post(sim.url, { token: "a".repeat(70000) })).status, 413);
    assert.equal((await post(sin.url, { token: ok })).status, 404, "sin clave de NEXA configurada el simulador no admite concesiones");
    const rj = await (await post(sim.url, { token: "x.y" })).text(); assert.ok(!/at |\.mjs|node:|Error:/.test(rj));
  } finally { await sim.detener(); await sin.detener(); }
});

test("HTTP: la concesión nunca aparece en respuestas, estados ni eventos", async () => {
  const sim = await iniciarSimulador({ clavePublicaNexa: nexa.publica });
  try {
    const ctl = (m, r, c) => fetch(sim.url + r, { method: m, headers: { "x-control-token": sim.tokenControl, "content-type": "application/json" }, body: c ? JSON.stringify(c) : undefined }).then(async (x) => ({ status: x.status, texto: await x.text() }));
    const s = JSON.parse((await ctl("POST", "/control/sesiones", { empresa: "emp-a", referencia: ORDEN })).texto);
    const pv = await (await fetch(`${sim.url}/f/${s.id}/vista-previa`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formulario: form() }) })).json();
    const t = nexa.concesion({ empresa: "emp-a", orden: ORDEN, resumen_hash: pv.resumen ? (await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`).then((x) => JSON.parse(x.texto).hash)) : "" });
    assert.equal((await fetch(`${sim.url}/nexa/autorizaciones`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) })).status, 200);
    const jti = JSON.parse(Buffer.from(t.split(".")[0], "base64url")).jti;
    const vistas = [(await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).texto, (await ctl("GET", "/control/eventos?empresa=emp-a")).texto, (await ctl("GET", "/control/emisiones?empresa=emp-a")).texto];
    for (const v of vistas) { assert.ok(!v.includes(t) && !v.includes(jti) && !v.includes(t.split(".")[1])); }
    const c = await fetch(`${sim.url}/f/${s.id}/confirmar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf: pv.csrf }) }); assert.equal(c.status, 200);
  } finally { await sim.detener(); }
});
