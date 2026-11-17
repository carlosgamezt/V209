// Autollenado del nombre del receptor: controlador del navegador (lógica pura, reloj y consulta simulados) y su coherencia con el servidor.
// Uso: deno test -A tests/receptor_nit_test.ts
import assert from "node:assert/strict";
import { crearAutollenado, normalizarId, esCF, digitoVerificadorValido, esNitConsultable, textoEstado, NOMBRE_CF, ETIQUETAS } from "../web/js/receptor_nit.js";
import * as srv from "../src/receptor_nit.ts";

type Info = { fase: string; simulado?: boolean; origen?: string } | null;
/** Reloj falso: las esperas se disparan a mano. */
function reloj() {
  let id = 0; const pend = new Map<number, () => void>();
  return { poner: (f: () => void) => { pend.set(++id, f); return id; }, quitar: (i: number) => { pend.delete(i); }, disparar() { const fs = [...pend.values()]; pend.clear(); fs.forEach((f) => f()); }, get pendientes() { return pend.size; } };
}
/** Consulta falsa: cada llamada queda en espera hasta que la prueba la resuelve (así se prueban respuestas fuera de orden y cancelaciones). */
function consulta() {
  const llamadas: { nit: string; signal: AbortSignal; ok: (r: unknown) => void; mal: (e: unknown) => void }[] = [];
  const fn = (nit: string, { signal }: { signal: AbortSignal }) => new Promise((ok, mal) => { llamadas.push({ nit, signal, ok, mal }); });
  return { fn, llamadas };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function montar(modelo = { tipo: "NIT", numero: "", nombre: "" }) {
  const rl = reloj(), q = consulta(), estados: Info[] = [], refrescos: string[] = [], etiquetas: (string | null)[] = [];
  const c = crearAutollenado({ modelo, consultar: q.fn as never, refrescar: () => refrescos.push(`${modelo.tipo}|${modelo.numero}|${modelo.nombre}`), estado: (i: Info) => estados.push(i), etiqueta: (t: string | null) => etiquetas.push(t), temporizador: rl as never });
  return { c, modelo, rl, q, estados, refrescos, etiquetas, fases: () => estados.map((e) => e?.fase ?? null) };
}
const A = "10000011", B = "10000038";   // NIT ficticios con dígito verificador válido

Deno.test("NIT válido: consulta una sola vez tras 600 ms sin teclas, muestra «Consultando» y completa el nombre", async () => {
  const t = montar(); t.c.alEscribirId(A);
  assert.equal(t.q.llamadas.length, 0, "no consulta mientras se escribe"); assert.equal(t.rl.pendientes, 1);
  t.rl.disparar(); assert.equal(t.q.llamadas.length, 1); assert.equal(t.q.llamadas[0].nit, A); assert.equal(t.fases().at(-1), "consultando");
  t.q.llamadas[0].ok({ encontrado: true, nombre: "CONTRIBUYENTE DE PRUEBA UNO, S.A.", origen: "demo", simulado: true }); await tick();
  assert.equal(t.modelo.nombre, "CONTRIBUYENTE DE PRUEBA UNO, S.A."); assert.deepEqual(t.estados.at(-1), { fase: "ok", origen: "demo", simulado: true });
  assert.match(textoEstado(t.estados.at(-1)), /simulados.*no provienen de SAT/i, "la advertencia va aparte, no dentro del nombre"); assert.doesNotMatch(t.modelo.nombre, /DEMO|simulad/i);
});

Deno.test("sin una tecla por consulta: escribir dígito a dígito reinicia la espera y solo se consulta el NIT final", () => {
  const t = montar(); for (const v of ["1", "10", "100", "1000", "10000", "100000", "1000001", A]) t.c.alEscribirId(v);
  assert.equal(t.rl.pendientes, 1, "solo queda una espera"); t.rl.disparar(); assert.equal(t.q.llamadas.length, 1); assert.equal(t.q.llamadas[0].nit, A);
});

Deno.test("cambios rápidos de NIT: se cancela la consulta anterior y su respuesta tardía se descarta", async () => {
  const t = montar(); t.c.alEscribirId(A); t.rl.disparar(); const primera = t.q.llamadas[0];
  t.c.alEscribirId(B);   // la persona cambia el NIT con la primera consulta todavía en vuelo
  assert.equal(primera.signal.aborted, true, "la consulta anterior se cancela"); t.rl.disparar(); const segunda = t.q.llamadas[1]; assert.equal(segunda.nit, B);
  segunda.ok({ encontrado: true, nombre: "PERSONA DE PRUEBA TRES", origen: "demo", simulado: true }); await tick();
  primera.ok({ encontrado: true, nombre: "CONTRIBUYENTE DE PRUEBA UNO, S.A.", origen: "demo", simulado: true }); await tick();   // llega tarde y fuera de orden
  assert.equal(t.modelo.nombre, "PERSONA DE PRUEBA TRES", "la respuesta vieja no pisa la nueva");
});

Deno.test("sin coincidencia: mensaje claro y entrada manual posible", async () => {
  const t = montar(); t.c.alEscribirId(A); t.rl.disparar(); t.q.llamadas[0].ok({ encontrado: false, origen: "demo", simulado: true }); await tick();
  assert.equal(t.estados.at(-1)?.fase, "no_encontrado"); assert.match(textoEstado(t.estados.at(-1)), /No se encontró este NIT.*simulada.*manualmente/); assert.equal(t.modelo.nombre, "");
  t.c.alEscribirNombre("Nombre escrito a mano"); assert.equal(t.modelo.nombre, "Nombre escrito a mano");
});

Deno.test("error del proveedor: mensaje claro, sin excepciones y se puede escribir el nombre", async () => {
  const t = montar(); t.c.alEscribirId(A); t.rl.disparar(); t.q.llamadas[0].mal(new Error("boom con datos internos")); await tick();
  assert.equal(t.estados.at(-1)?.fase, "error"); assert.match(textoEstado(t.estados.at(-1)), /No se pudo consultar.*manualmente/); assert.doesNotMatch(textoEstado(t.estados.at(-1)), /boom/, "no se muestran detalles internos"); assert.equal(t.modelo.nombre, "");
});

Deno.test("nunca se sobrescribe un nombre escrito a mano; un nombre autollenado sí se limpia al cambiar el NIT", async () => {
  const t = montar(); t.c.alEscribirNombre("Cliente de la casa"); t.c.alEscribirId(A); t.rl.disparar();
  t.q.llamadas[0].ok({ encontrado: true, nombre: "CONTRIBUYENTE DE PRUEBA UNO, S.A.", origen: "demo", simulado: true }); await tick();
  assert.equal(t.modelo.nombre, "Cliente de la casa"); assert.equal(t.estados.at(-1)?.fase, "conservado");
  // nombre autollenado: al cambiar el NIT no queda el del receptor anterior
  const u = montar(); u.c.alEscribirId(A); u.rl.disparar(); u.q.llamadas[0].ok({ encontrado: true, nombre: "UNO", origen: "demo", simulado: true }); await tick(); assert.equal(u.modelo.nombre, "UNO");
  u.c.alEscribirId(B); assert.equal(u.modelo.nombre, "", "el nombre autollenado se limpia en cuanto cambia el NIT");
  u.c.alEscribirNombre("Escrito"); u.c.alEscribirId(A); assert.equal(u.modelo.nombre, "Escrito", "lo escrito a mano no se limpia");
});

Deno.test("CF: «CF», «cf», «Cf», « C F » se normalizan a CF con «CONSUMIDOR FINAL» y NUNCA se consulta", () => {
  for (const v of ["CF", "cf", "Cf", "cF", "C F", " cf ", "c  f", "C-F"]) {
    const t = montar(); t.c.alEscribirId(v);
    assert.deepEqual([t.modelo.tipo, t.modelo.numero, t.modelo.nombre], ["CF", "CF", NOMBRE_CF], `«${v}»`); t.rl.disparar(); t.c.alSalirIdentificacion();
    assert.equal(t.q.llamadas.length, 0, `«${v}» no consulta`); assert.equal(t.estados.at(-1)?.fase, "cf");
  }
});

Deno.test("CF ↔ NIT: cambiar de uno a otro actualiza los campos sin conservar datos del receptor anterior", async () => {
  const t = montar(); t.c.alEscribirId("cf"); assert.equal(t.modelo.nombre, NOMBRE_CF);
  t.c.alEscribirId(A);   // de CF a un NIT: se limpia el nombre y se vuelve a tipo NIT
  assert.deepEqual([t.modelo.tipo, t.modelo.nombre], ["NIT", ""]); t.rl.disparar(); assert.equal(t.q.llamadas.length, 1, "ahora sí consulta el NIT"); t.q.llamadas[0].ok({ encontrado: true, nombre: "UNO", origen: "demo", simulado: true }); await tick(); assert.equal(t.modelo.nombre, "UNO");
  t.c.alEscribirId("CF"); assert.deepEqual([t.modelo.tipo, t.modelo.numero, t.modelo.nombre], ["CF", "CF", NOMBRE_CF], "al volver a CF se restaura el nombre");
  t.c.alElegirTipo("NIT"); assert.deepEqual([t.modelo.tipo, t.modelo.numero, t.modelo.nombre], ["NIT", "", ""], "de CF a NIT por el selector: campos vacíos, sin «CF»");
  t.c.alElegirTipo("CF"); assert.deepEqual([t.modelo.tipo, t.modelo.numero, t.modelo.nombre], ["CF", "CF", NOMBRE_CF], "elegir CF en el selector también lo completa");
});

Deno.test("solo se consulta con tipo NIT; al salir del campo se consulta ya y un NIT con dígito verificador dudoso no se consulta solo", async () => {
  const cui = montar({ tipo: "CUI", numero: "", nombre: "" }); cui.c.alEscribirId("2500123450101"); cui.rl.disparar(); assert.equal(cui.q.llamadas.length, 0, "un CUI no se consulta");
  const t = montar(); t.c.alEscribirId("10000012");   // formato válido, dígito verificador que no cuadra
  assert.equal(t.rl.pendientes, 0, "no se programa una consulta automática"); t.c.alSalirIdentificacion(); assert.equal(t.q.llamadas.length, 1, "al salir del campo sí se consulta"); assert.equal(t.q.llamadas[0].nit, "10000012");
  t.q.llamadas[0].ok({ encontrado: false, origen: "demo", simulado: true }); await tick(); t.c.alSalirIdentificacion(); assert.equal(t.q.llamadas.length, 1, "no repite la misma consulta");
  const u = montar(); u.c.alEscribirId(A); u.c.alSalirIdentificacion(); assert.equal(u.q.llamadas.length, 1, "salir del campo adelanta la espera"); u.rl.disparar(); assert.equal(u.q.llamadas.length, 1, "y no se consulta dos veces");
});

Deno.test("coherencia con el servidor: misma normalización, CF y dígito verificador", () => {
  for (const v of ["CF", "cf", " C F ", "1234567-8", "10000011", "1000002k", "", "abc", "5888492", "44653948", "99900017"]) {
    assert.equal(normalizarId(v), srv.normalizarId(v), `normalizar «${v}»`); assert.equal(esCF(v), srv.esCF(v), `esCF «${v}»`); assert.equal(digitoVerificadorValido(v), srv.digitoVerificadorValido(v), `dígito «${v}»`);
  }
  assert.equal(NOMBRE_CF, srv.NOMBRE_CF); assert.equal(digitoVerificadorValido("5888492"), true); assert.equal(digitoVerificadorValido("44653948"), true); assert.equal(digitoVerificadorValido("5888493"), false);
  for (const n of Object.keys(srv.DEMO_NIT).concat(srv.DEMO_NIT_ERROR)) assert.equal(esNitConsultable(n), true, `el NIT ficticio ${n} tiene dígito verificador válido`);
});

Deno.test("con el temporizador real (el que usa el navegador) también se espera y se consulta una sola vez", async () => {
  const modelo = { tipo: "NIT", numero: "", nombre: "" }; let n = 0;
  const c = crearAutollenado({ modelo, esperaMs: 15, consultar: async () => { n++; return { encontrado: true, nombre: "UNO", origen: "demo", simulado: true }; } });
  c.alEscribirId("1000001"); c.alEscribirId(A); assert.equal(n, 0, "aún en espera"); await new Promise((r) => setTimeout(r, 80));
  assert.equal(n, 1); assert.equal(modelo.nombre, "UNO");
});

Deno.test("etiquetas de origen: «Consultado mediante Digifact TEST», «Datos simulados», «Ingreso manual» y «Consumidor final»; una consulta TEST no se presenta como certificación de SAT", async () => {
  assert.deepEqual(ETIQUETAS, { digifact: "Consultado mediante Digifact TEST", simulado: "Datos simulados", manual: "Ingreso manual", cf: "Consumidor final" });
  // nombre real de Digifact TEST
  const d = montar(); d.c.alEscribirId(A); d.rl.disparar(); d.q.llamadas[0].ok({ encontrado: true, nombre: "RAZON SOCIAL DE PRUEBA", origen: "digifact_test", simulado: false }); await tick();
  assert.equal(d.etiquetas.at(-1), "digifact"); assert.deepEqual(d.estados.at(-1), { fase: "ok", origen: "digifact_test", simulado: false });
  assert.match(textoEstado(d.estados.at(-1)), /Digifact TEST.*no es una certificación fiscal de SAT/); assert.doesNotMatch(textoEstado(d.estados.at(-1)), /simulad/i);
  // al cambiar el NIT el nombre autollenado se limpia y la etiqueta desaparece
  d.c.alEscribirId(B); assert.equal(d.etiquetas.at(-1), null);
  // datos simulados
  const s = montar(); s.c.alEscribirId(A); s.rl.disparar(); s.q.llamadas[0].ok({ encontrado: true, nombre: "UNO", origen: "demo", simulado: true }); await tick(); assert.equal(s.etiquetas.at(-1), "simulado");
  // ingreso manual: escribir el nombre; y se conserva aunque llegue un nombre de la consulta
  const m = montar(); m.c.alEscribirNombre("Cliente de la casa"); assert.equal(m.etiquetas.at(-1), "manual"); m.c.alEscribirId(A); m.rl.disparar();
  m.q.llamadas[0].ok({ encontrado: true, nombre: "OTRO", origen: "digifact_test", simulado: false }); await tick(); assert.equal(m.modelo.nombre, "Cliente de la casa"); assert.equal(m.etiquetas.at(-1), "manual", "no se rotula como Digifact un nombre escrito a mano");
  m.c.alEscribirNombre(""); assert.equal(m.etiquetas.at(-1), null);
  // consumidor final, y al salir de CF la etiqueta se retira
  const c = montar(); c.c.alEscribirId("cf"); assert.equal(c.etiquetas.at(-1), "cf"); c.c.alEscribirId(A); assert.equal(c.etiquetas.at(-1), null);
  // error y «sin coincidencia» en Digifact TEST: mensajes claros, sin etiqueta de origen y con entrada manual
  const e = montar(); e.c.alEscribirId(A); e.rl.disparar(); e.q.llamadas[0].mal(new Error("x")); await tick(); assert.equal(e.etiquetas.at(-1), null); assert.match(textoEstado(e.estados.at(-1)), /No se pudo consultar.*manualmente/);
  const n = montar(); n.c.alEscribirId(A); n.rl.disparar(); n.q.llamadas[0].ok({ encontrado: false, origen: "digifact_test", simulado: false }); await tick(); assert.match(textoEstado(n.estados.at(-1)), /No se encontró este NIT en Digifact TEST.*manualmente/);
});
