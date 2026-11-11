// Pruebas de EXTREMO A EXTREMO del agente local: NEXA de prueba (base real + orquestador + plano de control firmado), el simulador FEL con autorización humana y Chromium.
// Todo local y simulado: sin SAT, sin certificadores, sin credenciales. La «persona» de las pruebas autoriza en NEXA (con su identidad) y pulsa Confirmar en la ventana del agente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CaidaSimulada } from "../agente/ejecutor.mjs";
import { arrancarNexa, arrancarSimulador, dormir, esperar, nuevaOrden, nuevoAgente, ordenDe, persona, pulsarConfirmar } from "./ayudas.mjs";

let nexa, sim, per;
test.before(async () => { nexa = await arrancarNexa(); sim = await arrancarSimulador(nexa); per = persona(nexa); });
test.after(async () => { await sim?.detener(); await nexa?.parar(); });

const ctl = (m, r, c) => fetch(sim.url + r, { method: m, headers: { "x-control-token": sim.tokenControl, "content-type": "application/json" }, body: c ? JSON.stringify(c) : undefined }).then(async (x) => ({ status: x.status, json: await x.json() }));
const libro = async (ref) => (await ctl("GET", `/control/emisiones?empresa=${nexa.info.empresa}&referencia=${ref}`)).json;
const eventosSim = async () => (await ctl("GET", `/control/eventos?empresa=${nexa.info.empresa}`)).json;
const conPagina = () => { let res; const pagina = new Promise((r) => { res = r; }); return { pagina, punto: async (n, c) => { if (n === "despues_de_presentar") res(c.pagina); } }; };
const conLimite = (p, ms = 40000, que = "el agente") => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error(`${que} no terminó a tiempo`)), ms))]);
const hasta = (orden, estado) => esperar(async () => (await ordenDe(nexa, orden))?.estado === estado, { que: `orden ${estado}` });
const docFiscal = async (orden) => (await ordenDe(nexa, orden)).estado_fiscal;
const agentes = [];
const crear = async (o) => { const a = await nuevoAgente(nexa, sim, o); agentes.push(a); return a; };
test.after(() => agentes.forEach((a) => a.limpiar()));

test("FLUJO COMPLETO: orden → agente reclama y llena el simulador → se detiene en la vista previa → la PERSONA autoriza en NEXA y confirma → certificado simulado", async () => {
  const { doc, orden } = await nuevaOrden(nexa); const g = conPagina();
  const ag = await crear({ ganchos: { punto: g.punto } });
  const corrida = ag.ciclo(); const pag = await conLimite(g.pagina, 60000, "la vista previa");
  assert.equal((await ordenDe(nexa, orden)).estado, "llenada"); assert.equal((await libro(orden)).length, 0, "la vista previa no emite nada");
  assert.ok((await ordenDe(nexa, orden)).vista_previa_hash, "el agente informó lo que muestra el simulador");
  assert.match(await pag.locator("#previa-total").innerText(), /21\.00|20\.00/);
  // lo que NEXA muestra a la persona antes de autorizar
  const vp = (await per.vistaPrevia(orden)).json; assert.equal(vp.autorizada, false); assert.equal(vp.vista_previa.total, "21.00"); assert.equal(Number(vp.esperado.total), 21);
  // 1) el agente (la ventana que controla) intenta confirmar SIN autorización de la persona: el simulador lo rechaza
  const intento = await pulsarConfirmar(pag); assert.match(intento.error, /autorización de la persona/i); assert.equal((await libro(orden)).length, 0);
  // 2) quien no tiene permiso no puede autorizar (emisora y lector)
  assert.equal((await per.autorizar(orden, "marta")).status, 403); assert.equal((await per.autorizar(orden, "pedro")).status, 403);
  // 3) la persona con permiso autoriza; la respuesta NO contiene la concesión
  const a = await per.autorizar(orden); assert.equal(a.status, 200); assert.deepEqual(Object.keys(a.json).sort(), ["expira_en", "ok", "orden"]);
  assert.equal((await per.autorizar(orden)).status, 409, "ya hay una autorización vigente");
  assert.equal((await per.vistaPrevia(orden)).json.autorizada, true);
  // 4) la persona pulsa Confirmar
  const ok = await pulsarConfirmar(pag); assert.equal(ok.resultado, "Emisión simulada registrada");
  const r = await conLimite(corrida); assert.equal(r.estado, "emitida");
  const l = await libro(orden); assert.equal(l.length, 1); assert.match(l[0].autorizacion, /^SIM-/);
  assert.equal((await ordenDe(nexa, orden)).estado, "completada");
  await esperar(async () => (await docFiscal(orden)) === "certificado", { que: "documento certificado por el cierre" });
  assert.equal((await ordenDe(nexa, orden)).autorizacion, l[0].autorizacion, "NEXA guardó los datos del LIBRO del simulador");
  assert.equal(ag.ejecutor && (await import("../agente/almacen.mjs")).abrirAlmacen(ag.dir).diario(), null, "el diario se limpió");
  const au = await nexa.auditoria(); const ev = au.find((x) => x.accion === "orden.confirmacion_autorizada" && x.entidad_id === orden);
  assert.ok(ev && ev.actor_user_id === "00000000-0000-0000-0000-00000000a001", "la autorización quedó auditada con la identidad de la PERSONA, no la del agente");
  assert.ok(au.some((x) => x.accion === "orden.vista_previa" && x.entidad_id === orden && x.origen === "agente"));
  assert.equal((await nexa.api("ana", "GET", `/api/documentos/${doc}`)).json.documento.estado_fiscal, "certificado");
});

test("CONFIRMACIÓN EXCLUSIVAMENTE HUMANA: el agente no tiene ruta ni credencial para autorizar ni para confirmar", async () => {
  const { orden } = await nuevaOrden(nexa); const g = conPagina();
  const ag = await crear({ ganchos: { punto: g.punto } }); const corrida = ag.ciclo(); const pag = await conLimite(g.pagina, 60000);
  // a) una petición del agente (sin identidad de persona) a la ruta de autorización de las personas
  const r1 = await fetch(`${nexa.base}/api/ordenes/${orden}/autorizar`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(r1.status, 403);
  // b) el plano de control del agente no tiene operación «autorizar» (ni «confirmar»)
  for (const op of ["autorizar", "confirmar", "autorizacion"]) { const r = await fetch(`${nexa.base}/api/agente/v1/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(r.status, 404, op); }
  // c) con el token de CONTROL del simulador (el que tiene el agente) no se puede confirmar, ni con el token de la vista previa leído de la ventana
  const csrf = await pag.evaluate(() => document.getElementById("btn-confirmar") ? "visible" : "no"); assert.equal(csrf, "visible");
  const sesionId = new URL(pag.url()).pathname.split("/")[2];
  const r3 = await fetch(`${sim.url}/f/${sesionId}/confirmar`, { method: "POST", headers: { "content-type": "application/json", "x-control-token": sim.tokenControl }, body: JSON.stringify({ csrf: "0".repeat(32) }) }); assert.equal(r3.status, 403);
  assert.equal((await ctl("POST", `/control/sesiones/${sesionId}/confirmar?empresa=${nexa.info.empresa}`, {})).status, 404);
  // d) el agente intenta entregar su PROPIA concesión (firmada con una clave que no es la de NEXA)
  const { parNexaDePrueba } = await import("./ayudas.mjs"); const falsa = parNexaDePrueba();
  const hash = (await ctl("GET", `/control/sesiones/${sesionId}?empresa=${nexa.info.empresa}`)).json.hash;
  const r4 = await fetch(`${sim.url}/nexa/autorizaciones`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: falsa.concesion({ empresa: nexa.info.empresa, orden, resumen_hash: hash }) }) }); assert.equal(r4.status, 401);
  assert.equal((await pulsarConfirmar(pag)).resultado, null); assert.equal((await libro(orden)).length, 0);
  // la persona sí puede: se completa
  assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(pag)).resultado, "Emisión simulada registrada");
  assert.equal((await conLimite(corrida)).estado, "emitida"); assert.equal((await libro(orden)).length, 1);
});

test("el código del agente no contiene ninguna acción de confirmación, ni tiene la clave de NEXA, ni apunta a hosts reales (revisión estática)", () => {
  const dir = fileURLToPath(new URL("../agente/", import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const t = readFileSync(dir + f, "utf8").replace(/\/\/.*$/gm, "");   // sin comentarios
    assert.ok(!/btn-confirmar|\/confirmar|confirmar\s*\(/.test(t), `${f}: no debe haber acción de confirmación`);
    assert.ok(!/nexa-confirmacion|DOMINIO_CONCESION|firmarConcesion|\/nexa\/autorizaciones/.test(t), `${f}: el agente no firma ni entrega concesiones`);
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z]/i.test(t), `${f}: sin URLs absolutas a hosts externos`);
  }
});

test("DESCONEXIÓN ANTES DE PRESENTAR: el proceso cae con la orden reclamada ⇒ al vencer vuelve a la cola, el equipo la retoma con token nuevo y NO se emite nada duplicado", async () => {
  const { orden } = await nuevaOrden(nexa);
  const ag = await crear({ ganchos: { punto: async (n) => { if (n === "antes_de_presentar") throw new CaidaSimulada(n); } } });
  await assert.rejects(conLimite(ag.ciclo(), 60000), CaidaSimulada);
  let o = await ordenDe(nexa, orden); assert.equal(o.estado, "reclamada"); assert.equal(o.token, 1);
  const almacen = (await import("../agente/almacen.mjs")).abrirAlmacen(ag.dir); const d = almacen.diario(); assert.equal(d.fase, "llenando"); assert.ok(d.sesion, "quedó el diario con la sesión abierta");
  assert.equal((await ctl("GET", `/control/sesiones/${d.sesion}?empresa=${nexa.info.empresa}`)).json.estado, "previsualizada", "la sesión vieja quedó abandonada en el simulador");
  await nexa.prueba("POST", "/prueba/vencer", { orden });                              // el arrendamiento vence (el equipo no volvió)
  await hasta(orden, "pendiente");                                                      // el supervisor la devuelve solo a la cola
  // el mismo equipo arranca de nuevo (sin ganchos de caída): cierra la sesión vieja, reclama con token 2 y completa
  const g = conPagina(); const nuevo = (await import("../agente/agente.mjs")).crearAgente({ estado: ag.dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos: { punto: g.punto }, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500 } });
  const corrida = nuevo.ciclo(); const pag = await conLimite(g.pagina, 60000);
  assert.equal((await ctl("GET", `/control/sesiones/${d.sesion}?empresa=${nexa.info.empresa}`)).json.estado, "interrumpida", "la sesión vieja se cerró al recuperar");
  o = await ordenDe(nexa, orden); assert.equal(o.token, 2); assert.equal(o.estado, "llenada");
  assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(pag)).resultado, "Emisión simulada registrada");
  assert.equal((await conLimite(corrida)).estado, "emitida"); assert.equal((await libro(orden)).length, 1, "una sola emisión");
});

test("DESCONEXIÓN DESPUÉS DE PRESENTAR (sin que la persona haya confirmado): al volver, el agente NO repite; cierra la sesión, consulta el libro (vacío) y descarta con prueba de que nada salió", async () => {
  const { orden, doc } = await nuevaOrden(nexa);
  const ag = await crear({ ganchos: { punto: async (n) => { if (n === "despues_de_presentar") throw new CaidaSimulada(n); } } });
  await assert.rejects(conLimite(ag.ciclo(), 60000), CaidaSimulada);
  assert.equal((await ordenDe(nexa, orden)).estado, "llenada");
  const sesiones = (await eventosSim()).filter((e) => e.evento === "sesion_creada").length;
  const nuevo = (await import("../agente/agente.mjs")).crearAgente({ estado: ag.dir, simulador: sim.url, tokenSimulador: sim.tokenControl, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500 } });
  const r = await conLimite(nuevo.ciclo()); assert.equal(r.estado, "descartada");
  assert.equal((await eventosSim()).filter((e) => e.evento === "sesion_creada").length, sesiones, "no se creó otra sesión: no hay reintento");
  assert.equal((await libro(orden)).length, 0); assert.equal((await ordenDe(nexa, orden)).estado, "descartada");
  await esperar(async () => (await docFiscal(orden)) !== "pendiente_certificacion" || true, { ms: 1000 }).catch(() => {});
  await esperar(async () => (await nexa.api("ana", "GET", `/api/documentos/${doc}`)).json.documento.estado_fiscal !== "pendiente_certificacion", { que: "la operación se cierra como rechazo confirmado" });
  assert.notEqual(await docFiscal(orden), "certificado", "no se certificó nada");
});

test("RECUPERACIÓN DE RESULTADO INCIERTO: la persona confirmó y el agente cayó antes de informar ⇒ al volver consulta el libro y informa SOLO lo que el libro prueba (sin repetir)", async () => {
  const { orden } = await nuevaOrden(nexa); const g = conPagina();
  const ag = await crear({ ganchos: { punto: async (n, c) => {
    if (n !== "despues_de_presentar") return; g.punto(n, c);
    assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(c.pagina)).resultado, "Emisión simulada registrada");   // la persona completó la emisión
    throw new CaidaSimulada(n);                                                          // …y el agente murió antes de informarlo
  } } });
  await assert.rejects(conLimite(ag.ciclo(), 60000), CaidaSimulada);
  assert.equal((await libro(orden)).length, 1); assert.equal((await ordenDe(nexa, orden)).estado, "llenada", "NEXA aún no sabe el resultado");
  const nuevo = (await import("../agente/agente.mjs")).crearAgente({ estado: ag.dir, simulador: sim.url, tokenSimulador: sim.tokenControl, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500 } });
  const r = await conLimite(nuevo.ciclo()); assert.equal(r.estado, "emitida");
  assert.equal((await libro(orden)).length, 1, "no se emitió otra vez");
  assert.equal((await ordenDe(nexa, orden)).estado, "completada"); await esperar(async () => (await docFiscal(orden)) === "certificado", { que: "certificado" });
});

test("RESULTADO INCIERTO SIN PODER INFORMAR: si el arrendamiento venció, NEXA deja la operación «por verificar» (conciliación manual) y el agente no inventa ni repite nada", async () => {
  const { orden } = await nuevaOrden(nexa);
  const ag = await crear({ ganchos: { punto: async (n) => { if (n === "despues_de_presentar") throw new CaidaSimulada(n); } } });
  await assert.rejects(conLimite(ag.ciclo(), 60000), CaidaSimulada);
  await nexa.prueba("POST", "/prueba/vencer", { orden }); await hasta(orden, "incierta");
  assert.equal(await docFiscal(orden), "por_verificar");
  const nuevo = (await import("../agente/agente.mjs")).crearAgente({ estado: ag.dir, simulador: sim.url, tokenSimulador: sim.tokenControl, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500 } });
  const r = await conLimite(nuevo.ciclo()); assert.ok(["perdida", "revocado"].includes(r.estado), `estado: ${r.estado}`);
  assert.equal((await ordenDe(nexa, orden)).estado, "incierta"); assert.equal(await docFiscal(orden), "por_verificar"); assert.equal((await libro(orden)).length, 0);
  const rec = await nexa.api("ana", "POST", `/api/documentos/${(await ordenDe(nexa, orden)).documento_id}/certificar`, { clave: "otra-clave-" + "x".repeat(20), escenario: "exito" });
  assert.equal(rec.status, 409, "por_verificar bloquea cualquier otra certificación");
});

test("OPERACIÓN DUPLICADA: si el libro del simulador ya tiene una emisión de esa orden, el agente NO crea otra: la orden queda incierta/«por verificar»", async () => {
  const { orden } = await nuevaOrden(nexa);
  // se inyecta una emisión previa en el libro (con una concesión firmada por NEXA de prueba)
  const s = (await ctl("POST", "/control/sesiones", { empresa: nexa.info.empresa, referencia: orden })).json;
  const pv = await (await fetch(`${sim.url}/f/${s.id}/vista-previa`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formulario: { tipo_documento: "FACT-SIM", fecha: "2026-11-11", moneda: "GTQ", establecimiento: { codigo: "1" }, receptor: { tipo_id: "CF", id: "CF" }, lineas: [{ tipo: "Bien", descripcion: "x", cantidad: "1", precio_unitario: "1", descuento: "" }] } }) })).json();
  const hash = (await ctl("GET", `/control/sesiones/${s.id}?empresa=${nexa.info.empresa}`)).json.hash;
  const { token } = await nexa.prueba("POST", "/prueba/concesion", { empresa: nexa.info.empresa, orden, resumen_hash: hash });
  const g = await fetch(`${sim.url}/nexa/autorizaciones`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); assert.equal(g.status, 200, await g.text());
  const c = await fetch(`${sim.url}/f/${s.id}/confirmar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf: pv.csrf }) }); assert.equal(c.status, 200, await c.text());
  assert.equal((await libro(orden)).length, 1);
  const antes = (await eventosSim()).filter((e) => e.evento === "sesion_creada").length;
  const ag = await crear(); const r = await conLimite(ag.ciclo()); assert.equal(r.estado, "incierta"); assert.equal(r.motivo, "duplicado_en_libro");
  assert.equal((await eventosSim()).filter((e) => e.evento === "sesion_creada").length, antes, "no se abrió otra sesión");
  assert.equal((await libro(orden)).length, 1, "sigue habiendo UNA sola emisión");
  assert.equal((await ordenDe(nexa, orden)).estado, "incierta"); assert.equal(await docFiscal(orden), "por_verificar");
});

test("REVOCACIÓN antes de reclamar: un equipo revocado no recibe ni toca ninguna orden", async () => {
  const { orden } = await nuevaOrden(nexa); const ag = await crear();
  assert.equal((await nexa.api("ana", "POST", "/api/agentes/revocar", { agente: ag.id })).status, 200);
  const r = await ag.ciclo(); assert.equal(r.estado, "revocado");
  assert.equal((await ordenDe(nexa, orden)).estado, "pendiente"); assert.equal((await libro(orden)).length, 0);
  const otro = await crear(); const g = conPagina(); otro.ejecutor; // otro equipo sano sí puede atender la orden pendiente
  await nexa.prueba("POST", "/prueba/vencer", { orden: "00000000-0000-0000-0000-000000000000" }).catch(() => {});
  const corr = (await import("../agente/agente.mjs")).crearAgente({ estado: otro.dir, simulador: sim.url, tokenSimulador: sim.tokenControl, ganchos: { punto: g.punto }, config: { sondeoMs: 30, renovarMs: 150, esperaMaxMs: 30000, ciclosMs: 40, demoraCierreMs: 1500 } }).ciclo();
  const pag = await conLimite(g.pagina, 60000); assert.equal((await per.autorizar(orden)).status, 200); await pulsarConfirmar(pag); assert.equal((await conLimite(corr)).estado, "emitida");
});

test("REVOCACIÓN después de presentar: el agente se detiene y cierra la sesión; NEXA ya no concede la autorización; el clic de la persona no emite", async () => {
  const { orden } = await nuevaOrden(nexa); const g = conPagina(); const ag = await crear({ ganchos: { punto: g.punto } });
  const corrida = ag.ciclo(); const pag = await conLimite(g.pagina, 60000);
  assert.equal((await nexa.api("ana", "POST", "/api/agentes/revocar", { agente: ag.id })).status, 200);
  assert.equal((await per.autorizar(orden)).status, 409, "NEXA no autoriza una orden de un agente revocado");
  const sesionId = new URL(pag.url()).pathname.split("/")[2];
  await esperar(async () => (await ctl("GET", `/control/sesiones/${sesionId}?empresa=${nexa.info.empresa}`)).json.estado === "interrumpida", { que: "el agente cierra la sesión al saberse revocado" });
  const intento = await pulsarConfirmar(pag);   // la ventana sigue abierta unos segundos: el clic de la persona ya no puede emitir
  const r = await conLimite(corrida); assert.equal(r.estado, "revocado"); assert.equal(intento.resultado, null); assert.equal((await libro(orden)).length, 0);
  assert.equal((await ordenDe(nexa, orden)).estado === "llenada" || (await ordenDe(nexa, orden)).estado === "incierta", true);
  await nexa.prueba("POST", "/prueba/vencer", { orden }); await hasta(orden, "incierta"); assert.equal(await docFiscal(orden), "por_verificar");
});

test("ÓRDENES VENCIDAS: con el arrendamiento vencido NEXA rechaza al agente (fencing), la persona no puede autorizar y el agente se detiene sin emitir", async () => {
  const { orden } = await nuevaOrden(nexa); const g = conPagina(); const ag = await crear({ config: { renovarMs: 100000 }, ganchos: { punto: g.punto } });
  const corrida = ag.ciclo(); const pag = await conLimite(g.pagina, 60000);
  await nexa.prueba("POST", "/prueba/vencer", { orden });
  assert.equal((await per.autorizar(orden)).status, 409, "no se autoriza una orden vencida");
  // aun si el supervisor la pasa a incierta, nada puede emitirse
  await hasta(orden, "incierta"); assert.equal((await per.autorizar(orden)).status, 409);
  const i = await pulsarConfirmar(pag); assert.equal(i.resultado, null); assert.equal((await libro(orden)).length, 0);
  ag.detener(); await ag.ejecutor; await dormir(10); corrida.catch(() => {});
});

test("CONCURRENCIA Y FENCING: dos equipos y una orden ⇒ solo uno la atiende; el que perdió el arrendamiento (token viejo) no puede informar ni emitir", async () => {
  const { orden } = await nuevaOrden(nexa);
  // equipo A: se detiene (bloqueado) justo antes de presentar; su arrendamiento vence; B la reclama con token 2 y la completa; A despierta con token 1 y es rechazado
  let soltar; const bloqueo = new Promise((r) => { soltar = r; }); let aPuntoAlcanzado; const alcanzado = new Promise((r) => { aPuntoAlcanzado = r; });
  const A = await crear({ ganchos: { punto: async (n) => { if (n === "antes_de_presentar") { aPuntoAlcanzado(); await bloqueo; } } } });
  const corridaA = A.ciclo(); await conLimite(alcanzado, 60000, "A"); assert.equal((await ordenDe(nexa, orden)).token, 1);
  await nexa.prueba("POST", "/prueba/vencer", { orden }); await hasta(orden, "pendiente");
  const g = conPagina(); const B = await crear({ ganchos: { punto: g.punto } });
  const corridaB = B.ciclo(); const pagB = await conLimite(g.pagina, 60000); assert.equal((await ordenDe(nexa, orden)).token, 2);
  soltar();                                                                             // A despierta con el token 1
  const rA = await conLimite(corridaA); assert.equal(rA.estado, "perdida", "A fue rechazado por el fencing y no cambió nada");
  assert.equal((await ordenDe(nexa, orden)).token, 2); assert.equal((await ordenDe(nexa, orden)).estado, "llenada");
  assert.equal((await per.autorizar(orden)).status, 200); assert.equal((await pulsarConfirmar(pagB)).resultado, "Emisión simulada registrada");
  assert.equal((await conLimite(corridaB)).estado, "emitida"); assert.equal((await libro(orden)).length, 1, "una sola emisión");
});

test("CONCURRENCIA: tres equipos reclaman a la vez con una sola orden ⇒ exactamente uno la recibe", async () => {
  const { orden } = await nuevaOrden(nexa); const gs = [conPagina(), conPagina(), conPagina()];
  const ags = []; for (let i = 0; i < 3; i++) ags.push(await crear({ ganchos: { punto: gs[i].punto } }));
  const corridas = ags.map((a) => a.ciclo());
  const ganador = await Promise.race(gs.map((g, i) => conLimite(g.pagina, 60000).then((p) => ({ i, p }))));
  const resto = await Promise.all(corridas.filter((_, i) => i !== ganador.i).map((c) => conLimite(c)));
  assert.deepEqual(resto.map((r) => r.estado), ["sin_orden", "sin_orden"]);
  assert.equal((await ordenDe(nexa, orden)).intentos, 1);
  assert.equal((await per.autorizar(orden)).status, 200); await pulsarConfirmar(ganador.p); assert.equal((await conLimite(corridas[ganador.i])).estado, "emitida"); assert.equal((await libro(orden)).length, 1);
});

test("AISLAMIENTO: el agente solo opera con su empresa; el simulador no muestra lo de otra empresa y las órdenes ajenas no existen para las personas", async () => {
  const ag = await crear(); const ajena = "11111111-1111-4111-8111-111111111111";
  assert.equal((await per.autorizar(ajena)).status, 404, "una orden que no es de la empresa no existe para la persona");
  assert.equal((await per.vistaPrevia(ajena)).status, 404);
  // sesión del simulador de OTRA empresa: el cliente del agente (empresa propia) no la ve
  const otra = (await ctl("POST", "/control/sesiones", { empresa: "empresa-ajena", referencia: "ref-ajena-00000001" })).json;
  const { crearClienteSimulador } = await import("../agente/cliente_simulador.mjs");
  const cs = crearClienteSimulador({ base: sim.url, token: sim.tokenControl, empresa: ag.identidad.empresa_id });
  await assert.rejects(cs.sesion(otra.id), (e) => e.status === 404); await assert.rejects(cs.interrumpir(otra.id), (e) => e.status === 404);
  assert.deepEqual(await cs.libro("ref-ajena-00000001"), []);
  assert.equal((await ctl("GET", `/control/sesiones/${otra.id}?empresa=empresa-ajena`)).json.estado, "creada", "no se tocó");
});

test("separación simulador ↔ real: el agente rechaza NEXA o simulador que no sean locales y el navegador solo abre el simulador", async () => {
  const { exigirBaseLocal, peticionPermitida } = await import("../agente/seguridad_red.mjs");
  for (const u of ["https://portal.sat.gob.gt", "http://sat.gob.gt", "https://api.digifact.com", "http://www.infile.com.gt", "https://example.com", "http://192.168.0.5:80", "http://127.0.0.1.evil.com", "http://user:pw@127.0.0.1:80", "http://127.0.0.1:80/ruta", "ftp://127.0.0.1"]) assert.throws(() => exigirBaseLocal(u, "x"), /bloqueado|solo se admite|no debe llevar|URL/i, u);
  assert.equal(exigirBaseLocal("http://127.0.0.1:8123", "x"), "http://127.0.0.1:8123");
  assert.equal(peticionPermitida("http://127.0.0.1:8123/f/abc", "http://127.0.0.1:8123"), true);
  for (const u of ["http://127.0.0.1:9999/f/abc", "https://portal.sat.gob.gt/", "http://localhost:8123/f/abc", "data:text/html,hola", "file:///etc/passwd"]) assert.equal(peticionPermitida(u, "http://127.0.0.1:8123"), false, u);
  const { crearAgente, vincular } = await import("../agente/agente.mjs");
  await assert.rejects(vincular({ nexa: "https://nexa.example.com", codigo: "AAAA-AAAA-AAAA", estado: (await crear()).dir + "-x" }), /solo se admite/);
  const a = await crear(); assert.throws(() => crearAgente({ estado: a.dir, simulador: "https://portal.sat.gob.gt", tokenSimulador: "x" }), /bloqueado/);
});

test("el navegador del agente usa un perfil independiente y bloquea cualquier petición fuera del simulador; el proceso usa el Chromium esperado", async () => {
  const { orden } = await nuevaOrden(nexa); const g = conPagina(); const ag = await crear({ ganchos: { punto: g.punto } });
  const corrida = ag.ciclo(); const pag = await conLimite(g.pagina, 60000);
  const ua = await pag.evaluate(() => navigator.userAgent); const major = Number(process.env.FEL_AGENTE_CHROMIUM_MAJOR ?? 131);
  if (major) assert.match(ua, new RegExp(`Chrome/${major}\\.`));
  const bloqueada = await pag.evaluate(async () => { try { await fetch("https://portal.sat.gob.gt/"); return "salió"; } catch { return "bloqueada"; } }); assert.equal(bloqueada, "bloqueada");
  const otra = await pag.evaluate(async () => { try { await fetch("http://127.0.0.1:9/"); return "salió"; } catch { return "bloqueada"; } }); assert.equal(otra, "bloqueada");
  assert.ok((await import("node:fs")).existsSync(`${ag.dir}/perfil-chromium`), "perfil propio del agente");
  assert.equal((await per.autorizar(orden)).status, 200); await pulsarConfirmar(pag); assert.equal((await conLimite(corrida)).estado, "emitida");
});
