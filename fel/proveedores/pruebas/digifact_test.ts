// Adaptador Digifact contra su SIMULADOR local: suite de contrato común + reglas propias (un solo intento, token, anulación, consumos, ambiente). Sin red, sin credenciales reales.
import assert from "node:assert/strict";
import { DigifactProvider, type SolicitudAnulacion } from "../src/digifact.ts";
import { DigifactSimulador, type EscenarioDigifact } from "../src/digifact_simulador.ts";
import { ErrorProveedor } from "../src/tipos.ts";
import type { OperacionRef, SolicitudCertificacion } from "../src/tipos.ts";
import { CTX, clave, documento } from "./datos.ts";
import { ejecutarSuiteContrato, type EscenarioContrato } from "./suite_contrato.ts";

const crear = (o: ConstructorParameters<typeof DigifactSimulador>[0] = {}) => { const s = new DigifactSimulador({ ahora: CTX.ahora, ...o }); return { s, p: new DigifactProvider(s.transporte, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" }) }; };
const sol = (id: string, n: number): SolicitudCertificacion => ({ empresaId: "empresa-prueba-1", establecimientoId: "est-1", documentoId: id, operacionId: `op-${n}`, claveIdempotencia: clave(n), hashContenido: "a".repeat(64), instantanea: documento(id), ambiente: "simulado" });
const ref = (s: SolicitudCertificacion): OperacionRef => ({ empresaId: s.empresaId, documentoId: s.documentoId, operacionId: s.operacionId, claveIdempotencia: s.claveIdempotencia, ambiente: "simulado" });

ejecutarSuiteContrato("digifact-simulador", () => {
  const { s, p } = crear(); const mapa: Record<EscenarioContrato, EscenarioDigifact> = { exito: "exito", rechazo: "rechazo", desconocido_certificado: "timeout_despues", desconocido_no_certificado: "timeout_antes", indeterminado: "timeout_indeterminado" };
  return { proveedor: p, preparar: (e, id) => s.fijarEscenario(id, mapa[e]), certificacionesDe: (id) => s.certificacionesDe(id) };
});

Deno.test("digifact: tabla de escenarios → resultado del cliente y verdad del servidor", async () => {
  const tabla: [EscenarioDigifact, string, number, string][] = [
    ["exito", "certificado", 1, "certificado"], ["rechazo", "rechazado_confirmado", 0, "no_existe_confirmado"], ["sin_saldo", "rechazado_confirmado", 0, "no_existe_confirmado"],
    ["timeout_antes", "desconocido", 0, "no_existe_confirmado"], ["timeout_despues", "desconocido", 1, "certificado"], ["corte_despues", "desconocido", 1, "certificado"],
    ["respuesta_ilegible", "desconocido", 1, "certificado"], ["codigo_desconocido_certificado", "desconocido", 1, "certificado"], ["codigo_desconocido_no_certificado", "desconocido", 0, "no_existe_confirmado"],
    ["timeout_indeterminado", "desconocido", 0, "indeterminado"], ["limite_tasa", "desconocido", 0, "no_existe_confirmado"], ["caida", "desconocido", 0, "no_existe_confirmado"],
  ];
  for (const [e, esperado, enServidor, conc] of tabla) {
    const { s, p } = crear(); const id = `doc-${e}`; s.fijarEscenario(id, e); const x = sol(id, 1);
    const r = await p.enviar(x, CTX); assert.equal(r.tipo, esperado, `${e}: resultado del cliente`);
    assert.equal(s.certificacionesDe(id), enServidor, `${e}: lo que de verdad existe en el servidor`);
    assert.equal((await p.conciliar(ref(x), CTX)).tipo, conc, `${e}: conciliación`);
    assert.equal(p.llamadasCertificar, 1, `${e}: un solo intento, jamás reintenta`);
  }
});

Deno.test("digifact: motivos de lo desconocido (nunca éxito ni fallo)", async () => {
  const motivo = async (e: EscenarioDigifact) => { const { s, p } = crear(); s.fijarEscenario("d", e); const r = await p.enviar(sol("d", 1), CTX); return r.tipo === "desconocido" ? r.motivo : r.tipo; };
  assert.equal(await motivo("timeout_antes"), "timeout"); assert.equal(await motivo("timeout_despues"), "timeout"); assert.equal(await motivo("corte_despues"), "corte");
  assert.equal(await motivo("respuesta_ilegible"), "respuesta_ilegible"); assert.equal(await motivo("codigo_desconocido_certificado"), "codigo_no_mapeado");
  assert.equal(await motivo("limite_tasa"), "limite_o_caida"); assert.equal(await motivo("caida"), "limite_o_caida");
});

Deno.test("digifact: idempotencia por referencia (reenviar la misma clave no certifica otra vez) y artefactos con SHA-256 calculado por NEXA", async () => {
  const { s, p } = crear(); const x = sol("d1", 1);
  const a = await p.enviar(x, CTX), b = await p.enviar(x, CTX);
  assert.equal(a.tipo, "certificado"); assert.equal(b.tipo, "certificado");
  if (a.tipo === "certificado" && b.tipo === "certificado") {
    assert.equal(a.autorizacion, b.autorizacion); assert.ok(a.autorizacion.startsWith("SIM-"), "autorización simulada con prefijo SIM-");
    assert.deepEqual(a.artefactos.map((r) => r.tipo).sort(), ["pdf", "xml"]);
    for (const r of a.artefactos) { const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", r.contenido as unknown as BufferSource)), (v) => v.toString(16).padStart(2, "0")).join(""); assert.equal(r.sha256, h); }
    assert.match(new TextDecoder().decode(a.artefactos.find((r) => r.tipo === "xml")!.contenido), /SIMULADO - SIN VALOR FISCAL/);
  }
  assert.equal(s.certificacionesDe("d1"), 1);
  assert.equal((await p.obtenerArtefactos(ref(x), CTX)).length, 2);
});

Deno.test("digifact: autenticación — credenciales erróneas y token vencido NUNCA certifican ni se reintentan", async () => {
  const { s } = crear(); const mal = new DigifactProvider(s.transporte, { usuario: "otro", clave: "mala" });
  const r = await mal.enviar(sol("d1", 1), CTX); assert.equal(r.tipo, "desconocido"); assert.equal(mal.llamadasCertificar, 0, "sin token no sale ninguna certificación"); assert.equal(s.certificacionesDe("d1"), 0);
  const b = crear(); b.s.forzarFalloDeLogin(true); assert.equal((await b.p.enviar(sol("d1", 1), CTX)).tipo, "desconocido"); assert.equal(b.s.certificados.length, 0);
  // token vencido entre dos envíos: se vuelve a autenticar ANTES de enviar (no es un reintento del envío)
  const c = crear({ tokenVidaS: 1 }); await c.p.enviar(sol("d1", 1), CTX); c.s.vencerTokens();
  const r2 = await c.p.enviar(sol("d2", 2), { ...CTX, ahora: () => new Date("2026-01-01T12:10:00Z") }); assert.equal(r2.tipo, "certificado"); assert.equal(c.s.certificados.length, 2);
  // 401 en pleno envío (token revocado): desconocido, sin reintento
  const d = crear(); await d.p.enviar(sol("d1", 1), CTX); d.s.vencerTokens(); const llam = d.p.llamadasCertificar;
  const r3 = await d.p.enviar(sol("d2", 2), CTX); assert.ok(r3.tipo === "certificado" || r3.tipo === "desconocido"); assert.ok(d.p.llamadasCertificar - llam <= 1, "a lo sumo un intento por envío");
});

Deno.test("digifact: «no existe» solo cuando el proveedor lo garantiza; en proceso es indeterminado; conciliar no cambia nada", async () => {
  const { s, p } = crear(); s.fijarEscenario("d1", "timeout_indeterminado"); const x = sol("d1", 1); await p.enviar(x, CTX);
  const antes = s.certificados.length, c1 = await p.conciliar(ref(x), CTX), c2 = await p.conciliar(ref(x), CTX);
  assert.equal(c1.tipo, "indeterminado"); assert.equal(c2.tipo, "indeterminado"); assert.equal(s.certificados.length, antes, "solo lectura");
  const y = sol("zzz", 7); assert.equal((await p.conciliar(ref(y), CTX)).tipo, "no_existe_confirmado");
  // sin conexión: indeterminado, jamás «no existe»
  const sinRed = new DigifactProvider(() => { throw new Error("sin red"); }, { usuario: "u", clave: "c" });
  assert.equal((await sinRed.conciliar(ref(y), CTX)).tipo, "indeterminado");
});

Deno.test("digifact: el adaptador se niega a operar fuera del ambiente «simulado» (no hay camino a pruebas ni producción en esta versión)", async () => {
  const { p } = crear();
  for (const ambiente of ["pruebas", "produccion"] as const) {
    const c = { ...CTX, ambiente };
    await assert.rejects(() => p.validar(documento("d1"), c), (e) => e instanceof ErrorProveedor && e.codigo === "NO_SOPORTADO");
    await assert.rejects(() => p.enviar({ ...sol("d1", 1), ambiente }, c), ErrorProveedor);
    await assert.rejects(() => p.conciliar(ref(sol("d1", 1)), c), ErrorProveedor);
    await assert.rejects(() => p.salud(c), ErrorProveedor);
  }
  assert.deepEqual(p.capacidades.ambientes, ["simulado"]);
});

Deno.test("digifact: las peticiones llevan los importes como TEXTO (nunca números) y no contienen credenciales ni token en el cuerpo de certificación", async () => {
  const peticiones: string[] = []; const s = new DigifactSimulador({ ahora: CTX.ahora });
  const p = new DigifactProvider(async (r) => { if (r.ruta === "/api/certificar") peticiones.push(r.cuerpo ?? ""); return await s.manejar(r); }, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" });
  await p.enviar(sol("d1", 1), CTX);
  const j = JSON.parse(peticiones[0]); assert.equal(typeof j.total, "string"); for (const l of j.lineas) for (const k of ["cantidad", "precio_unitario", "descuento"]) assert.equal(typeof l[k], "string");
  assert.ok(!peticiones[0].includes("SIM-CLAVE") && !peticiones[0].includes("SIMTOKEN"), "ni clave ni token en el cuerpo");
});

const solA = (x: SolicitudCertificacion, aut: string, n: number, motivo = "Anulación de prueba"): SolicitudAnulacion => ({ empresaId: x.empresaId, documentoId: x.documentoId, operacionId: `anu-${n}`, claveIdempotencia: `clave-anulacion-${String(n).padStart(6, "0")}`, referenciaCertificacion: x.claveIdempotencia, autorizacion: aut, motivo, ambiente: "simulado" });
Deno.test("digifact: anulación — éxito, rechazo confirmado, desconocido, conciliación y consumo", async () => {
  const { s, p } = crear(); const x = sol("d1", 1); const c = await p.enviar(x, CTX); assert.equal(c.tipo, "certificado"); if (c.tipo !== "certificado") return;
  // rechazo confirmado: el DTE sigue vigente
  s.fijarEscenarioAnulacion("d1", "rechazo"); const rch = await p.anular(solA(x, c.autorizacion, 1), CTX); assert.equal(rch.tipo, "rechazado_confirmado");
  assert.equal(s.porReferencia(x.claveIdempotencia)?.anulado, undefined);
  assert.equal((await p.conciliarAnulacion(solA(x, c.autorizacion, 1), CTX)).tipo, "no_anulado_confirmado");
  // desconocido pero aplicado: la consulta lo aclara; repetir NO duplica
  s.fijarEscenarioAnulacion("d1", "timeout_despues"); const sa = solA(x, c.autorizacion, 2); const unk = await p.anular(sa, CTX); assert.equal(unk.tipo, "desconocido");
  const conc = await p.conciliarAnulacion(sa, CTX); assert.equal(conc.tipo, "anulado");
  assert.equal(s.consumos.filter((l) => l.evento === "ANULACION").length, 1);
  s.fijarEscenarioAnulacion("d1", "exito"); assert.equal((await p.anular(sa, CTX)).tipo, "anulado"); assert.equal(s.consumos.filter((l) => l.evento === "ANULACION").length, 1, "idempotente: una sola anulación");
  // anulación indeterminada
  const y = sol("d2", 2); const cy = await p.enviar(y, CTX); if (cy.tipo !== "certificado") throw new Error("x");
  s.fijarEscenarioAnulacion("d2", "indeterminado"); const sy = solA(y, cy.autorizacion, 3); assert.equal((await p.anular(sy, CTX)).tipo, "desconocido");
  assert.equal((await p.conciliarAnulacion(sy, CTX)).tipo, "indeterminado");
  // un documento que no existe no se anula
  const z = sol("d3", 3); assert.equal((await p.anular(solA(z, "SIM-X", 4), CTX)).tipo, "rechazado_confirmado");
});

Deno.test("digifact: consumo del bolsón reportado y saldo; diferencias inyectadas", async () => {
  const { s, p } = crear({ saldoInicial: 3 });
  for (let i = 1; i <= 3; i++) assert.equal((await p.enviar(sol(`d${i}`, i), CTX)).tipo, "certificado");
  const cuarto = await p.enviar(sol("d4", 4), CTX); assert.equal(cuarto.tipo, "rechazado_confirmado", "sin saldo: rechazo garantizado, sin certificar"); if (cuarto.tipo === "rechazado_confirmado") assert.equal(cuarto.codigo, "SALDO_INSUFICIENTE");
  assert.equal(s.certificacionesDe("d4"), 0);
  const lineas = await p.obtenerConsumos("2026-01-01", "2026-01-31", CTX); assert.equal(lineas.length, 3); assert.ok(lineas.every((l) => l.evento === "CERTIFICACION" && l.unidades === "1.000000"));
  s.inyectarConsumoAjeno("AJENA-1"); assert.equal((await p.obtenerConsumos("2026-01-01", "2026-01-31", CTX)).length, 4);
  const aut = s.certificados[0].autorizacion; s.omitirConsumo(aut); assert.ok(!(await p.obtenerConsumos("2026-01-01", "2026-01-31", CTX)).some((l) => l.referencia === aut));
  assert.equal((await p.obtenerConsumos("2030-01-01", "2030-01-31", CTX)).length, 0, "filtra por fechas");
  assert.deepEqual(await p.salud(CTX), { ok: true, detalle: "Digifact (simulador) responde" });
});

Deno.test("digifact: respuestas incompletas o ambiguas del proveedor NUNCA se aceptan como certificado ni como ausencia garantizada", async () => {
  const s = new DigifactSimulador({ ahora: CTX.ahora });
  const con = (f: (ruta: string, j: Record<string, unknown>) => Record<string, unknown> | null) => new DigifactProvider(async (r) => {
    const resp = await s.manejar(r); const j = (() => { try { return JSON.parse(resp.cuerpo); } catch { return null; } })(); const m = j && f(r.ruta, j);
    return m ? { estado: resp.estado, cuerpo: JSON.stringify(m) } : resp;
  }, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" });
  // «CERTIFICADO» sin autorización (o sin serie, número o fecha): no se puede probar ⇒ desconocido
  for (const campo of ["autorizacion", "serie", "numero", "fecha_certificacion"]) {
    const p = con((ruta, j) => ruta === "/api/certificar" && j.estado === "CERTIFICADO" ? { ...j, [campo]: "" } : null);
    const r = await p.enviar(sol(`d-${campo}`, 1), CTX); assert.equal(r.tipo, "desconocido", `sin ${campo}`); if (r.tipo === "desconocido") assert.equal(r.motivo, "respuesta_ilegible");
  }
  // lo mismo al conciliar: datos incompletos ⇒ indeterminado
  const x = sol("d-conc", 2); await new DigifactProvider(s.transporte, { usuario: "SIM-USUARIO", clave: "SIM-CLAVE" }).enviar(x, CTX);
  const pc = con((ruta, j) => ruta.startsWith("/api/consultar?") && j.estado === "CERTIFICADO" ? { ...j, autorizacion: null } : null);
  assert.equal((await pc.conciliar(ref(x), CTX)).tipo, "indeterminado");
  // 404 «NO_EXISTE» SIN la garantía de procesamiento finalizado ⇒ indeterminado (jamás «no existe»)
  const pn = con((ruta, j) => ruta.startsWith("/api/consultar?") && j.codigo === "NO_EXISTE" ? { codigo: "NO_EXISTE" } : null);
  assert.equal((await pn.conciliar(ref(sol("otro", 9)), CTX)).tipo, "indeterminado");
  const pn2 = con((ruta, j) => ruta.startsWith("/api/consultar-anulacion?") && j.codigo === "NO_EXISTE" ? { codigo: "NO_EXISTE", procesamiento: "en_cola" } : null);
  assert.equal((await pn2.conciliarAnulacion(solA(sol("otro", 9), "SIM-X", 9), CTX)).tipo, "indeterminado");
  // estado desconocido de Digifact ⇒ desconocido
  const pe = con((ruta, j) => ruta === "/api/certificar" && j.estado === "CERTIFICADO" ? { estado: "OTRO" } : null);
  const re = await pe.enviar(sol("d-otro", 3), CTX); assert.equal(re.tipo, "desconocido"); if (re.tipo === "desconocido") assert.equal(re.motivo, "codigo_no_mapeado");
});
