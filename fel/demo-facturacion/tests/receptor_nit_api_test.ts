// Autollenado del receptor por la API REAL de la demostración (mismo proceso, PostgreSQL real en memoria con las migraciones del proyecto).
// El cliente de Digifact es el REAL con un transporte SIMULADO: ninguna prueba toca la red ni usa credenciales reales.
// Uso: deno test -A tests/receptor_nit_api_test.ts
import assert from "node:assert/strict";
import { montar, nit, type J } from "./ayudas_receptor.ts";
import { consultarReceptorNit, crearLimitador, DEMO_NIT, DEMO_NIT_ERROR, NOMBRE_CF } from "../src/receptor_nit.ts";


Deno.test({ name: "Receptor por NIT con Digifact APAGADO: simulador con datos ficticios, CF local, errores claros, auditoría sin el NIT y aislamiento", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli } = await montar(), ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar(), anon = new Cli("ana");
  assert.equal((await nit(anon, "10000011")).status, 401, "sesión obligatoria"); assert.equal((await nit(ana, "10000011", {})).status, 403, "sin la cabecera de la demostración no se acepta");
  // ---- datos ficticios, rotulados como simulados y sin tocar el nombre
  const [n1, v1] = Object.entries(DEMO_NIT)[0]; const r = await nit(ana, n1); assert.equal(r.status, 200);
  assert.deepEqual(r.json, { origen: "demo", simulado: true, encontrado: true, nit: n1, nombre: v1 }); assert.doesNotMatch(r.json.nombre, /DEMO|simulad/i, "la advertencia no va dentro del nombre");
  assert.deepEqual((await nit(ana, "1000-002k")).json.nombre, DEMO_NIT["1000002K"], "se normaliza (guiones, minúsculas)");
  assert.deepEqual((await nit(ana, "99900025")).json, { origen: "demo", simulado: true, encontrado: false, nit: "99900025" }, "sin coincidencia");
  const e = await nit(ana, DEMO_NIT_ERROR); assert.equal(e.status, 502); assert.equal(e.json.codigo, "proveedor"); assert.match(e.json.mensaje, /no respondió/);
  for (const malo of ["", "abc", "12-3A", "1".repeat(14), null]) assert.equal((await nit(ana, malo)).status, 400, `«${malo}» no es válido`);
  // ---- CF: local, sin proveedor
  for (const v of ["CF", "cf", "Cf", "C F", " c f "]) assert.deepEqual((await nit(ana, v)).json, { origen: "local", simulado: false, encontrado: true, cf: true, nit: "CF", nombre: NOMBRE_CF }, `«${v}»`);
  // ---- auditoría: solo origen y si hubo coincidencia; nunca el NIT consultado
  const aud = await bd.filas<J>("select datos::text as d from public.auditoria where accion = 'receptor.nit_consultado'"); assert.ok(aud.length >= 4, "se audita cada consulta"); for (const f of aud) assert.doesNotMatch(f.d, /1000|9990/, "el NIT no se guarda en la auditoría");
  // ---- aislamiento: la empresa 2 también recibe el simulador, y nada cruza entre empresas
  assert.equal((await nit(sofia, n1)).json.simulado, true);
}});

Deno.test("Receptor por NIT: permiso «clientes.ver» obligatorio y tope de 20 consultas por minuto por empresa (CF no cuenta)", async () => {
  const lim = crearLimitador(20); const deps = { limitador: lim, auditar: () => {} };
  await assert.rejects(() => consultarReceptorNit({ empresaId: "e", actorId: "a", permisos: [] }, "10000011", deps), (e: Error & { status: number }) => e.status === 403);
  const ctx = { empresaId: "e", actorId: "a", permisos: ["clientes.ver"] };
  for (let i = 0; i < 20; i++) assert.equal((await consultarReceptorNit(ctx, "10000011", deps)).encontrado, true);
  await assert.rejects(() => consultarReceptorNit(ctx, "10000011", deps), (e: Error & { status: number; codigo: string }) => e.status === 429 && e.codigo === "limite");
  assert.equal((await consultarReceptorNit(ctx, "cf", deps)).cf, true, "CF no consume el tope");
  assert.equal((await consultarReceptorNit({ ...ctx, empresaId: "otra" }, "10000011", deps)).encontrado, true, "el tope es por empresa");
});

Deno.test({ name: "Consumidor final al guardar: se normaliza a CF/«CONSUMIDOR FINAL» y solo se admite por debajo de Q2,500.00", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { bd, Cli } = await montar(), ana = await new Cli("ana").entrar();
  const est = (await ana.llamar("GET", "/api/estado")).json, es = est.establecimientos[0], cfExistente = est.clientes.find((c: J) => c.tipo_identificacion === "CF"), nitCli = est.clientes.find((c: J) => c.tipo_identificacion === "NIT");
  const doc = (receptor: J, precio: string) => ana.llamar("POST", "/api/documentos", { ...receptor, establecimiento_id: es.id, fecha: new Date().toISOString().slice(0, 10), lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: precio }] });
  // receptor nuevo: «c f» escrito en la identificación, aunque el tipo diga NIT
  const g = await doc({ cliente_nuevo: { tipo_identificacion: "NIT", numero_identificacion: " c f ", nombre: "lo que sea" } }, "2499.99"); assert.equal(g.status, 200, g.texto);
  const [c] = await bd.filas<J>("select tipo_identificacion as t, numero_identificacion as n, nombre from public.clientes where id = (select cliente_id from public.documentos where id = $1)", [g.json.documento.id]); assert.deepEqual([c.t, c.n, c.nombre], ["CF", "CF", NOMBRE_CF]);
  // el tope: Q2,500.00 o más NO se admite con CF (nuevo o existente); con NIT sí
  for (const receptor of [{ cliente_nuevo: { tipo_identificacion: "CF", numero_identificacion: "CF", nombre: "x" } }, { cliente_id: cfExistente.id }]) {
    const x = await doc(receptor, "2500"); assert.equal(x.status, 422, x.texto); assert.equal(x.json.codigo, "regla"); assert.match(x.json.mensaje, /Q2,500\.00.*NIT.*CUI/s);
    assert.equal((await doc(receptor, "2499.99")).status, 200, "por debajo del tope sí");
  }
  assert.equal((await doc({ cliente_id: nitCli.id }, "9999")).status, 200, "con NIT no hay tope de consumidor final");
  const antes = (await bd.filas<J>("select count(*)::int as n from public.clientes"))[0].n; assert.equal((await doc({ cliente_nuevo: { tipo_identificacion: "CF", numero_identificacion: "CF", nombre: "x" } }, "5000")).status, 422);
  assert.equal((await bd.filas<J>("select count(*)::int as n from public.clientes"))[0].n, antes, "un rechazo por el tope no deja un receptor creado a medias");
}});
