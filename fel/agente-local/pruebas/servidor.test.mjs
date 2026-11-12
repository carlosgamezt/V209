// Pruebas HTTP del SERVIDOR del simulador (sin navegador): separación control ↔ navegador, bloqueo de acciones no autorizadas, aislamiento por empresa, errores seguros.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { iniciarSimulador } from "../simulador/servidor.mjs";

const form = () => ({ tipo_documento: "FACT-SIM", fecha: "2026-11-11", moneda: "GTQ", establecimiento: { codigo: "1" }, receptor: { tipo_id: "CF", id: "CF" }, lineas: [{ tipo: "Bien", descripcion: "Café", cantidad: "2", precio_unitario: "5", descuento: "" }] });
let sim; const antes = async () => { sim ??= await iniciarSimulador({ demoraLentoMs: 50 }); return sim; };
test.after(async () => { await sim?.detener(); });

/** Petición cruda (permite fijar Host y Origin, que fetch no deja). */
const pedir = (metodo, ruta, { cuerpo, cab = {}, host } = {}) => new Promise((ok, ko) => {
  const texto = cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  const r = http.request({ host: "127.0.0.1", port: sim.puerto, method: metodo, path: ruta, headers: { ...(texto !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(texto) } : {}), ...(host ? { host } : {}), ...cab } }, (res) => {
    const t = []; res.on("data", (c) => t.push(c)); res.on("end", () => { const s = Buffer.concat(t).toString(); let j = null; try { j = JSON.parse(s); } catch { /* html */ } ok({ status: res.statusCode, json: j, texto: s, h: res.headers }); });
  });
  r.on("error", ko); if (texto !== undefined) r.write(texto); r.end();
});
const ctl = (metodo, ruta, cuerpo, tok) => pedir(metodo, ruta, { cuerpo, cab: { "x-control-token": tok ?? sim.tokenControl } });
const crear = async (o = {}) => (await ctl("POST", "/control/sesiones", { empresa: "emp-a", referencia: "ref-00000001", ...o })).json;
const previa = async (s) => (await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: { formulario: form() } })).json;

test("sólo escucha en 127.0.0.1 y devuelve cabeceras de seguridad sin caché", async () => {
  await antes(); assert.match(sim.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const s = await crear(); const r = await pedir("GET", `/f/${s.id}`);
  assert.equal(r.status, 200); assert.match(r.texto, /SIMULADO - SIN VALOR FISCAL/);
  assert.equal(r.h["cache-control"], "no-store"); assert.equal(r.h["x-content-type-options"], "nosniff"); assert.equal(r.h["x-frame-options"], "DENY");
  assert.match(r.h["content-security-policy"], /default-src 'none'/); assert.match(r.h["content-security-policy"], /script-src 'self'/);
  assert.doesNotMatch(r.texto, /<script>[^<]/, "sin scripts en línea");
});

test("el control exige token: sin token o con token erróneo ⇒ 401 uniforme", async () => {
  await antes();
  for (const tok of [undefined, "", "x", sim.tokenControl.slice(0, -1) + (sim.tokenControl.endsWith("0") ? "1" : "0")]) {
    const r = await pedir("POST", "/control/sesiones", { cuerpo: { empresa: "emp-a", referencia: "ref-00000001" }, cab: tok === undefined ? {} : { "x-control-token": tok } });
    assert.equal(r.status, 401); assert.equal(r.json.error, "NO_AUTORIZADO");
  }
  assert.equal((await pedir("GET", "/control/eventos?empresa=emp-a")).status, 401);
});

test("el agente NO puede confirmar: ni por una ruta de control (no existe) ni usando el token en la ruta del navegador, aunque tenga un token CSRF válido", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000010" }); const p = await previa(s); assert.ok(p.csrf);
  assert.equal((await ctl("POST", `/control/sesiones/${s.id}/confirmar?empresa=emp-a`, { csrf: p.csrf })).status, 404);
  const r = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf }, cab: { "x-control-token": sim.tokenControl } });
  assert.equal(r.status, 403); assert.equal(r.json.error, "SOLO_HUMANO");
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=ref-00000010")).json.length, 0, "no se emitió nada");
  assert.equal((await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).json.estado, "previsualizada");
});

test("el control nunca recibe el token de confirmación ni datos del receptor", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000011" }); const p = await previa(s);
  const vistas = [JSON.stringify((await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).json), JSON.stringify((await ctl("GET", "/control/eventos?empresa=emp-a")).json), JSON.stringify(s)];
  for (const v of vistas) assert.ok(!v.includes(p.csrf));
});

test("confirmación humana: una vez; la repetición se rechaza; el libro tiene una sola emisión", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000012" }); const p = await previa(s);
  const sinToken = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: {} }); assert.equal(sinToken.status, 403); assert.equal(sinToken.json.error, "CSRF");
  const a = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } }); assert.equal(a.status, 200); assert.match(a.json.emision.autorizacion, /^SIM-/);
  const b = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } }); assert.equal(b.status, 409); assert.equal(b.json.error, "YA_CONFIRMADA");
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=ref-00000012")).json.length, 1);
});

test("interrupción desde el control: la sesión termina, la confirmación posterior se rechaza y no hay emisión", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000013" }); const p = await previa(s);
  assert.equal((await ctl("POST", `/control/sesiones/${s.id}/interrumpir?empresa=emp-a`, {})).json.estado, "interrumpida");
  const r = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } }); assert.equal(r.status, 409);
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=ref-00000013")).json.length, 0);
  assert.equal((await ctl("POST", `/control/sesiones/${s.id}/interrumpir?empresa=emp-a`, {})).status, 409, "ya terminada");
});

test("aislamiento por empresa: otra empresa no ve ni interrumpe la sesión, sus eventos ni su libro", async () => {
  await antes(); const s = await crear({ empresa: "emp-x", referencia: "ref-00000020" }); const p = await previa(s);
  await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } });
  assert.equal((await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-y`)).status, 404);
  assert.equal((await ctl("POST", `/control/sesiones/${s.id}/interrumpir?empresa=emp-y`, {})).status, 404);
  assert.equal((await ctl("GET", `/control/sesiones/${s.id}`)).status, 400, "la empresa es obligatoria");
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-y")).json.length, 0);
  assert.equal((await ctl("GET", "/control/eventos?empresa=emp-y")).json.filter((e) => e.sesion === s.id).length, 0);
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-x")).json.length, 1);
});

test("validación en el servidor: datos incompletos devuelven 422 con los campos y no avanzan", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000030" });
  const f = form(); f.lineas[0].cantidad = "0"; f.receptor = { tipo_id: "NIT", id: "", nombre: "" };
  const r = await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: { formulario: f } });
  assert.equal(r.status, 422); assert.deepEqual(r.json.errores.map((e) => e.campo).sort(), ["linea-1-cantidad", "receptor_id", "receptor_nombre"]);
  assert.equal(r.json.csrf, undefined); assert.equal((await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).json.estado, "abierta");
});

test("errores seguros: método, ruta, tipo, tamaño y JSON; sin trazas; Host y Origin ajenos rechazados", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000031" });
  assert.equal((await pedir("GET", "/nada")).status, 404); assert.equal((await pedir("GET", "/f/zzzz")).status, 404);
  assert.equal((await pedir("GET", `/f/${"0".repeat(32)}`)).status, 404);
  assert.equal((await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: "x=1", cab: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: "{no json" })).status, 400);
  assert.equal((await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: JSON.stringify({ x: "a".repeat(70000) }) })).status, 413);
  assert.equal((await pedir("POST", `/f/${s.id}/otra`, { cuerpo: {} })).status, 404);
  const rebinding = await pedir("GET", `/f/${s.id}`, { host: "atacante.example" }); assert.equal(rebinding.status, 421);
  const ajeno = await pedir("POST", `/f/${s.id}/vista-previa`, { cuerpo: { formulario: form() }, cab: { origin: "http://atacante.example" } }); assert.equal(ajeno.status, 403);
  for (const r of [await pedir("GET", "/nada"), rebinding, ajeno]) assert.ok(!/at |\.mjs|node:|Error:/.test(r.texto), "sin trazas ni rutas internas");
  assert.equal((await ctl("POST", "/control/sesiones", { empresa: "a b", referencia: "ref-00000031" })).status, 400);
  assert.equal((await ctl("POST", "/control/sesiones", { empresa: "emp-a", referencia: "ref-00000031", fallo: "x" })).status, 400);
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=%27%3Bdrop")).status, 400);
});

test("error inyectado ANTES de registrar: 500 genérico, sesión en «error», nada en el libro", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000040", fallo: "error_antes" }); const p = await previa(s);
  const r = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } }); assert.equal(r.status, 500); assert.equal(r.json.error, "ERROR_SERVIDOR");
  assert.equal((await ctl("GET", `/control/sesiones/${s.id}?empresa=emp-a`)).json.estado, "error");
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=ref-00000040")).json.length, 0);
});

test("corte DESPUÉS de registrar: el cliente pierde la conexión, el libro conserva la emisión y la consulta permite verificar (sin reintentar)", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000041", fallo: "corte_tras_confirmar" }); const p = await previa(s);
  await assert.rejects(pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } }), /socket hang up|ECONNRESET/);
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-a&referencia=ref-00000041")).json.length, 1, "la emisión sí quedó registrada");
  const eventos = (await ctl("GET", `/control/eventos?empresa=emp-a&sesion=${s.id}`)).json.map((e) => e.evento);
  assert.ok(eventos.includes("emision_registrada") && eventos.includes("error_inyectado"));
  assert.equal((await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } })).status, 409, "reintentar la misma sesión no duplica");
});

test("respuesta lenta: la confirmación termina bien tras la demora", async () => {
  await antes(); const s = await crear({ referencia: "ref-00000042", fallo: "lento" }); const p = await previa(s);
  const t0 = Date.now(); const r = await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } });
  assert.equal(r.status, 200); assert.ok(Date.now() - t0 >= 45);
});

test("duplicados: dos sesiones con la misma referencia producen dos emisiones y ambas quedan señaladas en los eventos (el simulador no deduplica)", async () => {
  await antes();
  for (let i = 0; i < 2; i++) { const s = await crear({ empresa: "emp-d", referencia: "ref-00000050" }); const p = await previa(s); assert.equal((await pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } })).status, 200); }
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-d&referencia=ref-00000050")).json.length, 2);
  assert.equal((await ctl("GET", "/control/eventos?empresa=emp-d")).json.filter((e) => e.evento === "emision_duplicada_de_referencia").length, 1);
});

test("confirmaciones simultáneas sobre la misma sesión: exactamente una emisión", async () => {
  await antes(); const s = await crear({ empresa: "emp-c", referencia: "ref-00000060" }); const p = await previa(s);
  const rs = await Promise.all(Array.from({ length: 8 }, () => pedir("POST", `/f/${s.id}/confirmar`, { cuerpo: { csrf: p.csrf } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
  assert.equal((await ctl("GET", "/control/emisiones?empresa=emp-c")).json.length, 1);
});
