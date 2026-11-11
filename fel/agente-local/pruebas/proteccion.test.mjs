// Protección de la clave privada del equipo: DPAPI en Windows (sin alternativa más débil), archivo restringido solo para desarrollo en Linux.
// En Linux se prueba el CONTRATO con un PowerShell simulado; en Windows (CI «windows-latest») se prueba DPAPI de verdad.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirAlmacen } from "../agente/almacen.mjs";
import { ENTROPIA, ErrorProteccion, crearProtectorArchivo, crearProtectorDpapi, ejecutarPowerShell, elegirProtector, protectorPorNombre, rutaPowerShell } from "../agente/proteccion_clave.mjs";
import { generarPar } from "../agente/firma.mjs";

const esWin = process.platform === "win32";
const dir = () => mkdtempSync(join(tmpdir(), "nexa-prot-"));
const limpiar = (d) => rmSync(d, { recursive: true, force: true, maxRetries: 5 });
const codigo = (f) => { try { f(); } catch (e) { assert.ok(e instanceof ErrorProteccion, String(e)); return e.codigo; } assert.fail("debía fallar"); };
/** «DPAPI» falso y reversible (solo para probar el contrato en Linux): invierte los bytes con una marca. */
const dpapiFalso = (llamadas = []) => (modo, datos, entropia) => { llamadas.push({ modo, datos: Buffer.from(datos), entropia: Buffer.from(entropia) }); const b = Buffer.from(datos); return modo === "P" ? Buffer.concat([Buffer.from("PROT:"), b.reverse()]) : (() => { if (!b.subarray(0, 5).equals(Buffer.from("PROT:"))) throw new ErrorProteccion("DPAPI_NO_DESPROTEGE", "no"); return b.subarray(5).reverse(); })(); };

test("Windows exige DPAPI: el protector de archivo se NIEGA en Windows y DPAPI se niega fuera de Windows", () => {
  assert.equal(codigo(() => crearProtectorArchivo({ plataforma: "win32" })), "PROHIBIDO_EN_WINDOWS");
  assert.equal(codigo(() => crearProtectorDpapi({ plataforma: "linux" })), "SOLO_WINDOWS");
  assert.equal(codigo(() => protectorPorNombre("archivo_restringido", { plataforma: "win32" })), "PROHIBIDO_EN_WINDOWS", "una identidad guardada con el método débil no se abre en Windows");
  assert.equal(codigo(() => protectorPorNombre("otro", { plataforma: "linux" })), "PROTECTOR_DESCONOCIDO");
  assert.equal(elegirProtector({ plataforma: "win32", ejecutar: dpapiFalso() }).nombre, "dpapi");
  assert.equal(elegirProtector({ plataforma: "linux" }).nombre, "archivo_restringido");
  assert.equal(elegirProtector({ plataforma: "darwin" }).nombre, "archivo_restringido");
});

test("contrato de la llamada a DPAPI: ruta absoluta de PowerShell, sin ExecutionPolicy ni perfiles, datos por stdin (nunca por argumentos)", () => {
  let visto;
  const spawn = (cmd, args, opts) => { visto = { cmd, args, opts }; return { status: 0, stdout: Buffer.from("secreto-protegido").toString("base64"), stderr: "" }; };
  const secreto = Buffer.from("-----BEGIN PRIVATE KEY----- muy secreto");
  ejecutarPowerShell("P", secreto, ENTROPIA, { env: { SystemRoot: "C:\\Windows" }, spawn });
  assert.equal(visto.cmd, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"); assert.equal(rutaPowerShell({ windir: "D:\\Win" }), "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(visto.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]); assert.equal(visto.args.length, 4);
  const todo = visto.args.join(" "); for (const prohibido of ["ExecutionPolicy", "Bypass", "-File", "-Command ", "Unrestricted"]) assert.ok(!todo.includes(prohibido), prohibido);
  assert.ok(!todo.includes(secreto.toString("base64")) && !todo.includes("PRIVATE KEY"), "el secreto no viaja en la línea de comandos");
  assert.match(visto.opts.input, new RegExp(`^P\\n${Buffer.from(ENTROPIA).toString("base64")}\\n${secreto.toString("base64")}\\n$`), "datos y entropía por la entrada estándar");
  assert.equal(visto.opts.windowsHide, true); assert.ok(visto.opts.timeout > 0);
  const script = Buffer.from(visto.args[3], "base64").toString("utf16le");
  assert.match(script, /ProtectedData\]::Protect/); assert.match(script, /DataProtectionScope\]::CurrentUser/); assert.ok(!/LocalMachine/.test(script), "ámbito del usuario, nunca de la máquina"); assert.ok(!script.includes("PRIVATE KEY"));
});

test("errores de DPAPI: no dejan pasar salidas dudosas y nunca incluyen los datos", () => {
  const sp = (r) => () => r; const secreto = Buffer.from("MUY-SECRETO");
  const err = (r, modo = "P") => { try { ejecutarPowerShell(modo, secreto, ENTROPIA, { spawn: sp(r) }); } catch (e) { assert.ok(e instanceof ErrorProteccion); assert.ok(!e.message.includes("MUY-SECRETO") && !e.message.includes(secreto.toString("base64"))); return e.codigo; } assert.fail("debía fallar"); };
  assert.equal(err({ error: Object.assign(new Error("x"), { code: "ENOENT" }) }), "DPAPI_NO_DISPONIBLE");
  assert.equal(err({ status: 1, stdout: "", stderr: "falló con MUY-SECRETO" }), "DPAPI_FALLO"); assert.equal(err({ status: 1, stdout: "", stderr: "" }, "U"), "DPAPI_NO_DESPROTEGE");
  assert.equal(err({ status: 0, stdout: "no es base64 !!", stderr: "" }), "DPAPI_RESPUESTA"); assert.equal(err({ status: 0, stdout: "", stderr: "" }), "DPAPI_RESPUESTA");
  const p = crearProtectorDpapi({ plataforma: "win32", ejecutar: dpapiFalso() });
  assert.equal(codigo(() => p.desproteger("@@@")), "FORMATO"); assert.equal(codigo(() => p.desproteger(null)), "FORMATO");
});

test("el código de protección no desactiva protecciones de Windows (revisión estática)", () => {
  const t = readFileSync(fileURLToPath(new URL("../agente/proteccion_clave.mjs", import.meta.url)), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const prohibido of ["-ExecutionPolicy", "Set-ExecutionPolicy", "Bypass", "-WindowStyle Hidden -File", "Unblock-File", "Disable-", "reg add", "icacls", "takeown", "LocalMachine"]) assert.ok(!t.includes(prohibido), prohibido);
});

test("almacén: la identidad se guarda con la clave PROTEGIDA, jamás el PEM en claro; ida y vuelta; otro método o formato alterado se rechaza", () => {
  const d = dir(); try {
    const llamadas = [], par = generarPar(), p = crearProtectorDpapi({ plataforma: "win32", ejecutar: dpapiFalso(llamadas) });
    const a = abrirAlmacen(d, { protector: p });
    a.guardarIdentidad({ nexa: "http://127.0.0.1:1", agente_id: "ag-1", empresa_id: "emp-1", clave_publica: par.publica, clavePem: par.privadaPem });
    for (const f of readdirSync(d)) { const t = readFileSync(join(d, f), "utf8"); assert.ok(!t.includes("PRIVATE KEY") && !t.includes(Buffer.from(par.privadaPem).toString("base64")), `${f}: sin la clave en claro`); }
    const crudo = JSON.parse(readFileSync(join(d, "identidad.json"), "utf8")); assert.equal(crudo.protector, "dpapi"); assert.ok(crudo.clave_protegida); assert.equal(crudo.clavePem, undefined); assert.equal(crudo.privada_pem, undefined);
    assert.equal(llamadas[0].modo, "P"); assert.deepEqual(llamadas[0].entropia, ENTROPIA);
    const id = abrirAlmacen(d, { protector: p }).cargarIdentidad(); assert.equal(id.clavePem, par.privadaPem); assert.equal(id.agente_id, "ag-1"); assert.equal(llamadas.at(-1).modo, "U");
    // se rechaza abrir con el protector de archivo (método más débil) y con un blob alterado
    assert.throws(() => abrirAlmacen(d, { protector: crearProtectorArchivo({ plataforma: "linux" }) }).cargarIdentidad(), (e) => e.codigo === "PROTECTOR_DISTINTO");
    writeFileSync(join(d, "identidad.json"), JSON.stringify({ ...crudo, clave_protegida: Buffer.from("alterado").toString("base64") }));
    assert.throws(() => abrirAlmacen(d, { protector: p }).cargarIdentidad(), (e) => e.codigo === "DPAPI_NO_DESPROTEGE");
  } finally { limpiar(d); }
});

test("migración: una identidad del formato anterior (PEM en claro) se re-protege y el texto plano desaparece del disco", () => {
  const d = dir(); try {
    const par = generarPar(), llamadas = [], p = crearProtectorDpapi({ plataforma: "win32", ejecutar: dpapiFalso(llamadas) });
    writeFileSync(join(d, "identidad.json"), JSON.stringify({ nexa: "http://127.0.0.1:1", agente_id: "ag-2", empresa_id: "emp", clave_publica: par.publica, privada_pem: par.privadaPem }));
    const id = abrirAlmacen(d, { protector: p }).cargarIdentidad(); assert.equal(id.clavePem, par.privadaPem);
    const t = readFileSync(join(d, "identidad.json"), "utf8"); assert.ok(!t.includes("PRIVATE KEY") && !t.includes("privada_pem")); assert.equal(JSON.parse(t).protector, "dpapi"); assert.equal(llamadas[0].modo, "P");
  } finally { limpiar(d); }
});

test("el agente que se crea no conserva la clave en claro en su estado público", async () => {
  const { crearAgente } = await import("../agente/agente.mjs"); const d = dir();
  try {
    const par = generarPar(), a = abrirAlmacen(d);
    a.guardarIdentidad({ nexa: "http://127.0.0.1:9", agente_id: "11111111-1111-4111-8111-111111111111", empresa_id: "emp-x", clave_publica: par.publica, clavePem: par.privadaPem });
    const ag = crearAgente({ estado: d, simulador: "http://127.0.0.1:9", tokenSimulador: "t" });
    assert.ok(!JSON.stringify(ag.identidad).includes("PRIVATE KEY") && ag.identidad.clavePem === undefined);
  } finally { limpiar(d); }
});

// ---------------------------------------------------------------- solo Windows: DPAPI de verdad
const w = { skip: esWin ? false : "solo se ejecuta en Windows (CI windows-latest)" };
test("WINDOWS · DPAPI real: proteger y desproteger; el blob no contiene el secreto; datos alterados o entropía distinta NO se descifran", w, () => {
  const p = crearProtectorDpapi(), secreto = Buffer.from("-----BEGIN PRIVATE KEY-----\nclave-de-prueba-0123456789\n-----END PRIVATE KEY-----\n");
  const blob = p.proteger(secreto), crudo = Buffer.from(blob, "base64");
  assert.ok(crudo.length > secreto.length && !crudo.includes(secreto.subarray(0, 20)) && !blob.includes(secreto.toString("base64")), "el blob de DPAPI no es el secreto");
  assert.deepEqual(p.desproteger(blob), secreto);
  const alterado = Buffer.from(crudo); alterado[alterado.length - 5] ^= 0xff;
  assert.equal(codigo(() => p.desproteger(alterado.toString("base64"))), "DPAPI_NO_DESPROTEGE", "datos alterados");
  assert.equal(codigo(() => ejecutarPowerShell("U", crudo, Buffer.from("otra-entropia"))), "DPAPI_NO_DESPROTEGE", "otra aplicación (entropía distinta) no puede abrirlo");
  assert.notEqual(p.proteger(secreto), blob, "cada protección es distinta");
});

test("WINDOWS · identidad real con DPAPI: sin el PEM en el disco, ida y vuelta y el protector de archivo no existe", w, () => {
  const d = dir(); try {
    const par = generarPar(), a = abrirAlmacen(d);
    assert.equal(elegirProtector().nombre, "dpapi"); assert.equal(codigo(() => crearProtectorArchivo()), "PROHIBIDO_EN_WINDOWS");
    a.guardarIdentidad({ nexa: "http://127.0.0.1:1", agente_id: "ag-w", empresa_id: "emp", clave_publica: par.publica, clavePem: par.privadaPem });
    for (const f of readdirSync(d)) { const t = readFileSync(join(d, f), "utf8"); assert.ok(!t.includes("PRIVATE KEY"), `${f}: sin la clave en claro`); }
    assert.equal(JSON.parse(readFileSync(join(d, "identidad.json"), "utf8")).protector, "dpapi");
    assert.equal(abrirAlmacen(d).cargarIdentidad().clavePem, par.privadaPem);
  } finally { limpiar(d); }
});
