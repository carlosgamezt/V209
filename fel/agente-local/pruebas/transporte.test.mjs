// TRANSPORTE REMOTO SEGURO (8a), probado contra un «NEXA falso» que controla cada byte de la respuesta: HTTPS estricto, respuestas firmadas y ligadas a la petición,
// repetidas / alteradas / vencidas / de otra clave, rotación y revocación de claves, interrupciones de red, reconexión, espera exponencial con variación y política de versiones.
// Sin red externa, sin SAT, sin credenciales. (La integración con el NEXA real —Deno, base de datos— está en agente.test.mjs y en las pruebas de Deno.)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirAlmacen } from "../agente/almacen.mjs";
import { crearAgente, VERSION } from "../agente/agente.mjs";
import { crearClienteNexa, ErrorNexa } from "../agente/cliente_nexa.mjs";
import { crearConfianza, ErrorRespuesta, verificarRespuesta } from "../agente/confianza_nexa.mjs";
import { claveDesdePem, generarPar } from "../agente/firma.mjs";
import { exigirBaseNexa } from "../agente/seguridad_red.mjs";
import { crearMetricasCliente, esperaAdaptativa, SONDEO } from "../agente/sondeo.mjs";

const CERT = (n) => readFileSync(fileURLToPath(new URL(`./certificados/${n}`, import.meta.url)), "utf8");
const dirs = []; const temp = () => { const d = mkdtempSync(join(tmpdir(), "nexa-tp-")); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const b64u = (b) => Buffer.from(b).toString("base64url");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const ISO = (ms = 0) => new Date(Date.now() + ms).toISOString();

/** Par de claves de «NEXA» para firmar en las pruebas (mismo formato que firma_respuesta.ts). */
function parNexa(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" }).x;
  const f = (m) => b64u(sign(null, Buffer.from(m), privateKey));
  return { kid, publica: pub, privada: privateKey, firmar: f, incrustada: { kid, publica: pub, desde: "2020-01-01T00:00:00Z", hasta: null },
    anuncio: (nuevo, hasta = null, desde = "2020-01-01T00:00:00Z") => ({ kid: nuevo.kid, publica: nuevo.publica, desde, hasta, anuncio_kid: kid, firma: f(`nexa-clave-v1\n${nuevo.kid}\n${nuevo.publica}\n${desde}\n${hasta ?? ""}`) }),
    revoca: (k) => ({ kid: k, anuncio_kid: kid, firma: f(`nexa-revoca-v1\n${k}`) }) };
}
/** Respuesta firmada por `par` para una petición con `nonce`. Cualquier campo puede alterarse para simular ataques. */
function respuestaFirmada(par, nonce, status, cuerpoObj, o = {}) {
  const cuerpo = typeof cuerpoObj === "string" ? cuerpoObj : JSON.stringify(cuerpoObj), kid = o.kid ?? par.kid, ts = o.ts ?? ISO();
  const firma = par.firmar(`nexa-respuesta-v1\n${kid}\n${o.nonceFirmado ?? nonce}\n${o.statusFirmado ?? status}\n${ts}\n${sha(o.cuerpoFirmado ?? cuerpo)}`);
  return { status, cuerpo, headers: { "content-type": "application/json", "x-nexa-kid": kid, "x-nexa-ts": ts, "x-nexa-firma": firma } };
}
const POLITICA = (o = {}) => ({ version_minima: 0, version_recomendada: 0, bloqueado: false, siguiente_ms: 3000, ...o });

/** NEXA falso (http o https). `programa(ctx)` decide la respuesta: { status, cuerpo, headers } | { destruir: true } | { colgar: true }. */
async function nexaFalso({ tls = false, cert = "localhost" } = {}) {
  const e = { peticiones: [], programa: null };
  const manejador = (req, res) => {
    const trozos = []; req.on("data", (c) => trozos.push(c)); req.on("end", () => {
      const texto = Buffer.concat(trozos).toString(), nonce = req.headers["x-nonce"], ctx = { req, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })(), nonce, n: e.peticiones.length };
      e.peticiones.push({ ruta: req.url, headers: req.headers, json: ctx.json });
      const r = e.programa(ctx);
      if (r.destruir) return req.socket.destroy(); if (r.colgar) return;
      res.writeHead(r.status ?? 200, r.headers ?? {}); res.end(r.cuerpo ?? "");
    });
  };
  const servidor = tls ? https.createServer({ cert: CERT(`${cert}.crt`), key: CERT(`${cert}.key`) }, manejador) : http.createServer(manejador);
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const puerto = servidor.address().port;
  return { e, url: `${tls ? "https" : "http"}://127.0.0.1:${puerto}`, programar: (f) => { e.programa = f; }, cerrar: () => new Promise((ok) => { servidor.close(ok); servidor.closeAllConnections?.(); }) };
}
/** Cliente de NEXA con identidad nueva y la confianza indicada. */
function cliente(url, { claves, ca, persistencia, ahora, hostsPermitidos } = {}) {
  const par = generarPar(), confianza = crearConfianza({ incrustadas: claves, persistencia, ahora });
  const metricas = crearMetricasCliente();
  return { c: crearClienteNexa({ base: url, agenteId: randomUUID(), privada: claveDesdePem(par.privadaPem), confianza, ca, hostsPermitidos, version: VERSION, ahora, metricas }), confianza, metricas };
}
const causa = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof ErrorNexa, String(e)); return { codigo: e.codigo, causa: e.causa, e }; } assert.fail("debía fallar"); };
const normal = (par) => (ctx) => respuestaFirmada(par, ctx.nonce, 200, { ok: true, orden: null, politica: POLITICA() });

// ================================================================ respuestas firmadas
test("una respuesta firmada por NEXA, ligada a la petición y reciente se acepta; trae la política", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); s.programar(normal(k1));
  try { const { c } = cliente(s.url, { claves: [k1.incrustada] }); const r = await c.reclamar(); assert.equal(r.orden, null); assert.equal(r.politica.siguiente_ms, 3000); assert.equal(s.e.peticiones[0].ruta, "/api/agente/v1/reclamar"); }
  finally { await s.cerrar(); }
});

test("respuestas ALTERADAS, sin firma, de otra clave o con la firma de otro mensaje se rechazan: nunca se obedece ni una orden ni un «revocado» sin autenticar", async () => {
  const k1 = parNexa("k1"), otra = parNexa("k1"), s = await nexaFalso();     // «otra» usa el mismo kid pero NO es la clave de NEXA (un atacante)
  try {
    const { c, metricas } = cliente(s.url, { claves: [k1.incrustada] });
    const orden = { ok: true, orden: { orden: "11111111-1111-4111-8111-111111111111", token: 1, ambiente: "simulado", instantanea: {} }, politica: POLITICA() };
    const casos = {
      "cuerpo alterado después de firmar": (x) => respuestaFirmada(k1, x.nonce, 200, orden, { cuerpoFirmado: JSON.stringify({ ok: true, orden: null, politica: POLITICA() }) }),
      "estado alterado (se firmó 200 y llega 403)": (x) => ({ ...respuestaFirmada(k1, x.nonce, 200, { ok: false, codigo: "FEL_REVOCADO" }), status: 403 }),
      "sin firma": () => ({ status: 200, cuerpo: JSON.stringify(orden), headers: {} }),
      "«revocado» inventado por un intermediario": () => ({ status: 403, cuerpo: JSON.stringify({ ok: false, codigo: "FEL_REVOCADO", mensaje: "x" }), headers: {} }),
      "firmada por otra clave con el mismo identificador": (x) => respuestaFirmada(otra, x.nonce, 200, orden),
      "firma con basura": (x) => { const r = respuestaFirmada(k1, x.nonce, 200, orden); r.headers["x-nexa-firma"] = "A".repeat(86); return r; },
      "cabecera de firma truncada": (x) => { const r = respuestaFirmada(k1, x.nonce, 200, orden); r.headers["x-nexa-firma"] = r.headers["x-nexa-firma"].slice(0, 40); return r; },
    };
    for (const [nombre, f] of Object.entries(casos)) {
      s.programar(f); const r = await causa(c.reclamar());
      assert.equal(r.codigo, "FEL_RESPUESTA_NO_AUTENTICA", nombre); assert.equal(r.e.esRevocado, false, `${nombre}: no es una revocación`); assert.equal(r.e.esTransitorio, true, `${nombre}: se reintenta`);
    }
    assert.equal(metricas.totales().no_autenticas, Object.keys(casos).length);
  } finally { await s.cerrar(); }
});

test("REPETICIÓN: una respuesta válida de una petición anterior repetida contra otra petición se rechaza (ligada al nonce)", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); let guardada = null;
  s.programar((x) => { if (!guardada) { guardada = respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA() }); return guardada; } return guardada; });   // la segunda vez el «atacante» repite la primera respuesta
  try {
    const { c } = cliente(s.url, { claves: [k1.incrustada] }); await c.reclamar();
    const r = await causa(c.reclamar()); assert.equal(r.codigo, "FEL_RESPUESTA_NO_AUTENTICA"); assert.equal(r.causa, "FIRMA_INVALIDA");
  } finally { await s.cerrar(); }
});

test("VENCIDAS: una respuesta con marca de tiempo antigua o del futuro se rechaza; dentro de la tolerancia se acepta", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso();
  try {
    const { c } = cliente(s.url, { claves: [k1.incrustada] });
    for (const [nombre, ms, esperado] of [["de hace 5 minutos", -300_000, "RESPUESTA_VENCIDA"], ["del futuro (+5 min)", 300_000, "RESPUESTA_VENCIDA"]]) {
      s.programar((x) => respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA() }, { ts: ISO(ms) }));
      const r = await causa(c.reclamar()); assert.equal(r.causa, esperado, nombre);
    }
    s.programar((x) => respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA() }, { ts: ISO(-60_000) })); await c.reclamar();   // 1 minuto: aceptable
    // con el reloj del equipo adelantado 10 minutos, una respuesta de ahora también «vence» (el reloj mal puesto no abre la puerta)
    const adelantado = cliente(s.url, { claves: [k1.incrustada], ahora: () => new Date(Date.now() + 600_000) });
    s.programar(normal(k1)); assert.equal((await causa(adelantado.c.reclamar())).causa, "RESPUESTA_VENCIDA");
  } finally { await s.cerrar(); }
});

test("la verificación nunca lanza otra cosa que ErrorRespuesta (entradas hostiles)", () => {
  const k1 = parNexa("k1"), confianza = crearConfianza({ incrustadas: [k1.incrustada] }); const base = { confianza, nonce: "n".repeat(24), status: 200, cuerpo: Buffer.from("{}") };
  for (const headers of [{}, { "x-nexa-kid": "k1" }, { "x-nexa-kid": "k1", "x-nexa-ts": "ayer", "x-nexa-firma": "x" }, { "x-nexa-kid": "../../etc", "x-nexa-ts": ISO(), "x-nexa-firma": "x" }, { "x-nexa-kid": "k1", "x-nexa-ts": ISO(), "x-nexa-firma": "ñ".repeat(100) }, { "x-nexa-kid": "k9", "x-nexa-ts": ISO(), "x-nexa-firma": "x" }])
    assert.throws(() => verificarRespuesta({ ...base, headers }), (e) => e instanceof ErrorRespuesta);
});

// ================================================================ claves de NEXA: distribución y rotación
test("ROTACIÓN: NEXA empieza a firmar con una clave nueva anunciada por una clave que el agente ya conoce y se acepta sin intervención; se recuerda tras reiniciar", async () => {
  const k1 = parNexa("k1"), k2 = parNexa("k2"), d = temp(), per = abrirAlmacen(d).persistencia("claves_nexa.json"), s = await nexaFalso();
  try {
    s.programar((x) => respuestaFirmada(k2, x.nonce, 200, { ok: true, orden: null, politica: POLITICA(), claves_nexa: [k1.anuncio(k2)], revocadas: [] }));   // firma con k2 y trae el anuncio firmado por k1
    const a = cliente(s.url, { claves: [k1.incrustada], persistencia: per }); await a.c.reclamar();
    assert.deepEqual(a.confianza.kids().sort(), ["k1", "k2"]);
    // sin el anuncio (otro arranque), la clave k2 se recuerda desde el disco
    s.programar((x) => respuestaFirmada(k2, x.nonce, 200, { ok: true, orden: null, politica: POLITICA() }));
    const b = cliente(s.url, { claves: [k1.incrustada], persistencia: abrirAlmacen(d).persistencia("claves_nexa.json") }); await b.c.reclamar();
    // el agente declara los kid que conoce para que NEXA solo anuncie lo nuevo
    assert.deepEqual(s.e.peticiones.at(-1).json.kids.sort(), ["k1", "k2"]);
  } finally { await s.cerrar(); }
});

test("claves FALSAS: un anuncio firmado por quien no es de confianza, alterado, con otra clave pública o vencido no abre la puerta", async () => {
  const k1 = parNexa("k1"), intruso = parNexa("k1"), nueva = parNexa("k2"), s = await nexaFalso();
  try {
    const casos = {
      "anuncio firmado por un intruso": [intruso.anuncio(nueva)],
      "anuncio alterado (clave pública cambiada)": [{ ...k1.anuncio(nueva), publica: parNexa("kx").publica }],
      "anuncio firmado por una clave desconocida": [{ ...k1.anuncio(nueva), anuncio_kid: "zz" }],
      "anuncio ya vencido": [k1.anuncio(nueva, "2021-01-01T00:00:00Z")],
      "anuncio con fechas invertidas": [k1.anuncio(nueva, "2019-01-01T00:00:00Z", "2020-06-01T00:00:00Z")],
    };
    for (const [nombre, anuncios] of Object.entries(casos)) {
      s.programar((x) => respuestaFirmada(nueva, x.nonce, 200, { ok: true, orden: null, politica: POLITICA(), claves_nexa: anuncios }));
      const { c, confianza } = cliente(s.url, { claves: [k1.incrustada] }); const r = await causa(c.reclamar());
      assert.equal(r.codigo, "FEL_RESPUESTA_NO_AUTENTICA", nombre); assert.deepEqual(confianza.kids(), ["k1"], `${nombre}: no se aprendió nada`);
    }
    // una clave ya conocida no puede «cambiarse» con un anuncio posterior
    const c1 = crearConfianza({ incrustadas: [k1.incrustada] }); assert.deepEqual(c1.procesarDistribucion({ claves_nexa: [k1.anuncio(nueva)] }).aceptadas, ["k2"]);
    assert.deepEqual(c1.procesarDistribucion({ claves_nexa: [k1.anuncio({ kid: "k2", publica: parNexa("k2").publica })] }).aceptadas, [], "no se sustituye una clave conocida");
    assert.equal(c1.obtener("k2").publica, nueva.publica);
  } finally { await s.cerrar(); }
});

test("REVOCACIÓN de una clave de NEXA: solo con una clave INCRUSTADA; una clave anunciada no puede revocar a las demás; lo revocado deja de firmar", async () => {
  const k1 = parNexa("k1"), r0 = parNexa("r0"), k2 = parNexa("k2");
  const conf = crearConfianza({ incrustadas: [k1.incrustada, r0.incrustada] }); conf.procesarDistribucion({ claves_nexa: [k1.anuncio(k2)] });
  assert.deepEqual(conf.procesarDistribucion({ revocadas: [k2.revoca("k1")] }).revocadas, [], "una clave anunciada (k2) no puede revocar a k1");
  assert.deepEqual(conf.procesarDistribucion({ revocadas: [k1.revoca("k1")] }).revocadas, [], "una clave no se revoca a sí misma");
  assert.deepEqual(conf.procesarDistribucion({ revocadas: [{ ...r0.revoca("k1"), firma: "A".repeat(86) }] }).revocadas, [], "firma inválida");
  assert.ok(conf.obtener("k1") && conf.obtener("k2"));
  assert.deepEqual(conf.procesarDistribucion({ revocadas: [r0.revoca("k1")] }).revocadas, ["k1"]); assert.equal(conf.obtener("k1"), null); assert.ok(conf.obtener("k2")); assert.deepEqual(conf.kids().sort(), ["k2", "r0"]);
  // y un servidor que siga firmando con k1 es rechazado
  const nonce = "n".repeat(24), r = respuestaFirmada(k1, nonce, 200, { ok: true });
  assert.throws(() => verificarRespuesta({ confianza: conf, nonce, status: 200, headers: r.headers, cuerpo: Buffer.from(r.cuerpo) }), (e) => e.codigo === "CLAVE_DESCONOCIDA");
});

test("un archivo de claves aprendidas manipulado (se añade la clave de un atacante) no añade confianza: se vuelve a verificar contra las incrustadas", () => {
  const k1 = parNexa("k1"), k2 = parNexa("k2"), intruso = parNexa("k9"), d = temp(), per = abrirAlmacen(d).persistencia("claves_nexa.json");
  crearConfianza({ incrustadas: [k1.incrustada], persistencia: per }).procesarDistribucion({ claves_nexa: [k1.anuncio(k2)] });
  const archivo = per.leer(); assert.equal(archivo.claves_nexa.length, 1);
  per.escribir({ claves_nexa: [...archivo.claves_nexa, { kid: "k9", publica: intruso.publica, desde: "2020-01-01T00:00:00Z", hasta: null, anuncio_kid: "k1", firma: "A".repeat(86) }], revocadas: [] });
  const c = crearConfianza({ incrustadas: [k1.incrustada], persistencia: abrirAlmacen(d).persistencia("claves_nexa.json") });
  assert.deepEqual(c.kids().sort(), ["k1", "k2"], "k9 no entra");
});

// ================================================================ HTTPS estricto
test("HTTPS ESTRICTO: sin confiar en el certificado no hay conexión (la petición nunca llega a la aplicación); confiando en el correcto sí; un certificado de OTRO nombre se rechaza", async () => {
  const k1 = parNexa("k1");
  const bueno = await nexaFalso({ tls: true }); bueno.programar(normal(k1));
  try {
    const sinCa = cliente(bueno.url, { claves: [k1.incrustada] }); const r = await causa(sinCa.c.reclamar());
    assert.equal(r.codigo, "FEL_TLS"); assert.equal(bueno.e.peticiones.length, 0, "el servidor no llegó a recibir nada");
    assert.equal((await cliente(bueno.url, { claves: [k1.incrustada], ca: CERT("localhost.crt") }).c.reclamar()).orden, null);
    const equivocado = await causa(cliente(bueno.url, { claves: [k1.incrustada], ca: CERT("otro.crt") }).c.reclamar()); assert.equal(equivocado.codigo, "FEL_TLS", "otro certificado");
  } finally { await bueno.cerrar(); }
  const otro = await nexaFalso({ tls: true, cert: "otro" }); otro.programar(normal(k1));    // el servidor presenta el certificado de «otro.example» en 127.0.0.1
  try { const r = await causa(cliente(otro.url, { claves: [k1.incrustada], ca: CERT("otro.crt") }).c.reclamar()); assert.equal(r.codigo, "FEL_TLS", "el nombre del certificado no coincide con el servidor"); assert.equal(otro.e.peticiones.length, 0); }
  finally { await otro.cerrar(); }
});

test("el código no desactiva nunca la validación de TLS ni sigue redirecciones (revisión estática)", () => {
  const dir = fileURLToPath(new URL("../agente/", import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const t = readFileSync(dir + f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/rejectUnauthorized\s*:\s*false/.test(t) && !/NODE_TLS_REJECT_UNAUTHORIZED/.test(t) && !/checkServerIdentity/.test(t) && !/insecure/i.test(t), `${f}: TLS siempre estricto`);
    assert.ok(!/followRedirects|redirect\s*:\s*["']follow/.test(t), `${f}: sin redirecciones`);
  }
});

test("las redirecciones no se siguen: un 302 hacia otro sitio se trata como respuesta no autenticada", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(), trampa = await nexaFalso(); trampa.programar(normal(k1));
  s.programar(() => ({ status: 302, headers: { location: `${trampa.url}/api/agente/v1/reclamar` }, cuerpo: "" }));
  try { const r = await causa(cliente(s.url, { claves: [k1.incrustada] }).c.reclamar()); assert.equal(r.codigo, "FEL_RESPUESTA_NO_AUTENTICA"); assert.equal(trampa.e.peticiones.length, 0, "no se visitó el destino de la redirección"); }
  finally { await s.cerrar(); await trampa.cerrar(); }
});

test("destinos: https solo en hosts autorizados (nunca IP, ni SAT/certificadores, ni con credenciales, ruta o puertos raros); http solo en loopback", () => {
  const ok = (u, h = ["nexa.example.com"]) => exigirBaseNexa(u, { hostsPermitidos: h });
  assert.equal(ok("https://nexa.example.com"), "https://nexa.example.com"); assert.equal(ok("https://NEXA.example.com:443"), "https://nexa.example.com");
  assert.equal(ok("http://127.0.0.1:8123"), "http://127.0.0.1:8123"); assert.equal(ok("https://localhost:8443"), "https://localhost:8443");
  for (const u of ["https://otro.example.com", "http://nexa.example.com", "https://203.0.113.5", "https://[2001:db8::1]", "https://nexa.example.com:8443", "https://user:pw@nexa.example.com", "https://nexa.example.com/ruta", "https://nexa.example.com/?x=1", "ftp://nexa.example.com", "no es url", "http://192.168.1.10"])
    assert.throws(() => ok(u), (e) => e.name === "Error" && /NEXA/.test(e.message), u);
  for (const u of ["https://portal.sat.gob.gt", "https://api.digifact.com", "https://www.infile.com.gt", "https://megaprint.example.com"]) assert.throws(() => ok(u, [new URL(u).hostname]), /bloqueado/, `${u}: bloqueado aunque figure en la lista`);
});

// ================================================================ interrupciones de red y reconexión
test("INTERRUPCIONES: una conexión cortada es un fallo transitorio; al volver la conexión se cuenta UNA reconexión y se informa a NEXA sin repetir contadores", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); let modo = "corte";
  s.programar((x) => modo === "corte" ? { destruir: true } : respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA() }));
  try {
    const { c, metricas } = cliente(s.url, { claves: [k1.incrustada] });
    const r1 = await causa(c.reclamar()); assert.equal(r1.codigo, "FEL_RED"); assert.equal(r1.e.esTransitorio, true);
    modo = "ok"; await c.reclamar();
    assert.deepEqual(metricas.totales(), { peticiones: 2, errores_red: 1, no_autenticas: 0, reconexiones: 1 });
    await c.reclamar(); await c.reclamar();
    const peticiones = s.e.peticiones.map((p) => p.json.metricas);
    assert.deepEqual(peticiones[1], { peticiones: 1, errores_red: 1 }, "la consulta tras la caída informó el fallo");
    assert.deepEqual(peticiones[2], { peticiones: 1, reconexiones: 1 }, "la siguiente informó la reconexión (una sola)");
    assert.deepEqual(peticiones[3], { peticiones: 1 }, "lo ya informado no se repite");
  } finally { await s.cerrar(); }
});

test("tiempo de espera agotado: la petición se abandona (fallo de red) y no deja nada colgado", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); s.programar(() => ({ colgar: true }));
  try {
    const c = crearClienteNexa({ base: s.url, agenteId: randomUUID(), privada: claveDesdePem(generarPar().privadaPem), confianza: crearConfianza({ incrustadas: [k1.incrustada] }), timeoutMs: 300 });
    const t0 = Date.now(); const r = await causa(c.reclamar()); assert.equal(r.codigo, "FEL_RED"); assert.ok(Date.now() - t0 < 3000);
  } finally { await s.cerrar(); }
});

test("respuesta cortada a la mitad del cuerpo: fallo de red, nunca una respuesta a medias aceptada", async () => {
  const k1 = parNexa("k1");
  const srv = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-length": "500", ...respuestaFirmada(k1, req.headers["x-nonce"], 200, { ok: true }).headers }); res.write("{\"ok\":tr"); setTimeout(() => res.destroy(), 20); }); });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  try { const r = await causa(cliente(`http://127.0.0.1:${srv.address().port}`, { claves: [k1.incrustada] }).c.reclamar()); assert.ok(["FEL_RED", "FEL_RESPUESTA_NO_AUTENTICA"].includes(r.codigo)); }
  finally { await new Promise((ok) => { srv.close(ok); srv.closeAllConnections?.(); }); }
});

// ================================================================ espera adaptativa
test("ESPERA EXPONENCIAL con variación: crece 1 s → 60 s, nunca baja de la mitad del tope, respeta la pausa mínima del servidor y no sincroniza a los equipos", () => {
  const sin = (f, a) => esperaAdaptativa({ fallosSeguidos: f, aleatorio: () => a });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map((f) => sin(f, 1)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000], "tope exponencial acotado a 60 s");
  assert.deepEqual([1, 2, 3, 7].map((f) => sin(f, 0)), [500, 1000, 2000, 30000], "mitad fija con aleatorio 0");
  const muestras = Array.from({ length: 2000 }, () => esperaAdaptativa({ fallosSeguidos: 4 })); assert.ok(muestras.every((m) => m >= 4000 && m <= 8000)); assert.ok(new Set(muestras).size > 500, "variación real: los equipos no reintentan a la vez");
  assert.equal(esperaAdaptativa({ fallosSeguidos: 1, retryAfterMs: 20000, aleatorio: () => 0 }), 20000, "Retry-After manda"); assert.equal(esperaAdaptativa({ fallosSeguidos: 1, retryAfterMs: 9e9, aleatorio: () => 0 }), SONDEO.maxMs, "pero acotado");
});

test("SONDEO ADAPTATIVO: se obedece la indicación de NEXA dentro de límites seguros (1 s–120 s) con ±20 % de variación", () => {
  const e = (hint, a = 0.5) => esperaAdaptativa({ hintMs: hint, aleatorio: () => a });
  assert.equal(e(3000), 3000); assert.equal(e(3000, 0), 2400); assert.equal(e(3000, 1), 3600); assert.equal(e(30000, 0), 24000);
  for (const h of [0, 5, -1, NaN, "x", null, undefined, Infinity]) { const v = e(h); assert.ok(v >= SONDEO.minMs && v <= SONDEO.maxMs, `${String(h)} → ${v}`); }
  assert.ok(e(9e9, 1) <= SONDEO.maxMs && e(1, 0) >= SONDEO.minMs, "un servidor hostil no puede ni acelerar el sondeo por debajo de 1 s ni frenarlo más de 2 min");
  const m = Array.from({ length: 1000 }, () => esperaAdaptativa({ hintMs: 30000 })); assert.ok(Math.min(...m) >= 24000 && Math.max(...m) <= 36000); assert.ok(new Set(m).size > 300);
});

// ================================================================ agente completo contra el NEXA falso
function agenteFalso(url, { config = {}, dormir, claves, ca, aleatorio } = {}) {
  const d = temp(), par = generarPar(); const idAg = randomUUID();
  abrirAlmacen(d).guardarIdentidad({ nexa: url, agente_id: idAg, empresa_id: "emp-x", clave_publica: par.publica, clavePem: par.privadaPem });
  return crearAgente({ estado: d, simulador: "http://127.0.0.1:9", tokenSimulador: "t", claves, ca, dormir, aleatorio, config: { ciclosMs: null, ...config } });
}

test("BUCLE del agente: obedece el siguiente_ms de NEXA; tras fallos espera de forma exponencial y vuelve al ritmo normal al reconectar; no se bloquea ni se satura", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); const esperas = []; let n = 0, ag;
  s.programar((x) => { n++; if (n <= 3) return { destruir: true }; if (n === 4) return respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA({ siguiente_ms: 5000 }) }); if (n >= 6) ag.detener(); return respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, politica: POLITICA({ siguiente_ms: 30000 }) }); });
  try {
    ag = agenteFalso(s.url, { claves: [k1.incrustada], aleatorio: () => 1, dormir: async (ms) => { esperas.push(ms); } });
    await ag.ejecutar();
    assert.deepEqual(esperas.slice(0, 3), [1000, 2000, 4000], "exponencial tras 3 fallos");
    assert.ok(Math.abs(esperas[3] - 6000) <= 1, `tras reconectar vuelve a la indicación del servidor (5 s con variación): ${esperas[3]}`);
    assert.equal(ag.estado, "detenido"); assert.deepEqual(ag.metricas(), { peticiones: n, errores_red: 3, no_autenticas: 0, reconexiones: 1 });
  } finally { await s.cerrar(); }
});

test("VERSIÓN MÍNIMA: con una versión bloqueada el agente deja de reclamar (solo latido) y avisa; al bajar el mínimo se desbloquea solo", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); let minima = 1_000_001; const rutas = []; let ag;
  s.programar((x) => {
    rutas.push(x.req.url.split("/").pop());
    const bloqueado = minima > 1_000_000;                                           // el agente es 1.0.0 = 1 000 000
    if (x.req.url.endsWith("/reclamar") && bloqueado) return respuestaFirmada(k1, x.nonce, 426, { ok: false, codigo: "FEL_VERSION", mensaje: "actualiza", politica: POLITICA({ version_minima: minima, bloqueado: true }) });
    if (rutas.length >= 6) ag.detener();
    return respuestaFirmada(k1, x.nonce, 200, { ok: true, orden: null, estado: "activo", politica: POLITICA({ version_minima: minima, bloqueado }) });
  });
  try {
    const estados = []; let i = 0;
    ag = agenteFalso(s.url, { claves: [k1.incrustada], config: { ciclosMs: 5 }, dormir: async () => { estados.push(ag.estado); if (++i === 3) minima = 0; } });
    await ag.ejecutar();
    assert.deepEqual(rutas.slice(0, 2), ["reclamar", "latido"], "primero se entera por el 426 y después solo hace latido");
    assert.ok(estados.slice(0, 2).every((e) => e === "actualizar"), `estado: ${estados}`); assert.equal(rutas.filter((r) => r === "reclamar").length >= 2, true, "tras bajar el mínimo vuelve a reclamar");
    assert.equal(ag.bloqueado, false);
  } finally { await s.cerrar(); }
});

test("un «revocado» FIRMADO por NEXA sí detiene al agente; uno sin firmar solo provoca reintentos", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); let ag, firmado = false, n = 0;
  s.programar((x) => { n++; if (!firmado) return { status: 403, cuerpo: JSON.stringify({ ok: false, codigo: "FEL_REVOCADO" }), headers: {} }; return respuestaFirmada(k1, x.nonce, 403, { ok: false, codigo: "FEL_REVOCADO", mensaje: "desvinculado" }); });
  try {
    const esperas = []; ag = agenteFalso(s.url, { claves: [k1.incrustada], config: { ciclosMs: 5 }, dormir: async () => { esperas.push(1); if (esperas.length === 3) firmado = true; } });
    await ag.ejecutar();
    assert.equal(ag.estado, "detenido"); assert.ok(n >= 4, "con respuestas sin firmar insistió; solo paró al llegar la firmada"); assert.equal(ag.metricas().no_autenticas, 3);
  } finally { await s.cerrar(); }
});

test("el panel y los mensajes no revelan detalles técnicos de los fallos de transporte", async () => {
  const k1 = parNexa("k1"), s = await nexaFalso(); s.programar(() => ({ destruir: true }));
  try { const r = await causa(cliente(s.url, { claves: [k1.incrustada] }).c.reclamar()); assert.ok(!/ECONN|socket|127\.0\.0\.1|at /.test(r.e.message), r.e.message); }
  finally { await s.cerrar(); }
});
