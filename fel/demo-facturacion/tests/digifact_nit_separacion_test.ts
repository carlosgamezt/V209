// Consulta de NIT por Digifact TEST: habilitación INDEPENDIENTE de la certificación (FEL_DIGIFACT_NIT frente a FEL_DIGIFACT_TEST).
// Ninguna prueba toca la red ni usa credenciales reales: el cliente de Digifact es el REAL con un `fetch` SIMULADO que lo registra todo.
// Uso: deno test -A tests/digifact_nit_separacion_test.ts
import assert from "node:assert/strict";
import { crearConsultorNitDesdeEntorno, type ConsultorNit } from "../src/digifact_nit_entorno.ts";
import { crearDigifactDesdeEntorno } from "../src/digifact_entorno.ts";
import { consultarReceptorNit, crearLimitador, DEMO_NIT, TOPE_REAL_POR_EMPRESA } from "../src/receptor_nit.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { montar, nit, type J } from "./ayudas_receptor.ts";

const USUARIO = "USUARIO_TEST_INVENTADO", CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", NIT_CUENTA = "5888492", EMPRESA_OTRA = "00000000-0000-4000-8000-00000000beef";
const NIT_CONSULTADO = "44653948", NOMBRE_REAL = "RAZON SOCIAL INVENTADA PARA PRUEBAS, S.A.", TEXTO_PROVEEDOR = "DETALLE-INTERNO-DEL-PROVEEDOR";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const envBase = (extra: Record<string, string> = {}) => { const m: Record<string, string> = { FEL_DIGIFACT_NIT: "habilitado", FEL_DIGIFACT_NIT_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA, ...extra }; return (k: string) => m[k]; };

type Modo = "ok" | "sin_coincidencia" | "http500" | "login401" | "ilegible" | "limite429" | "tiempo";
/** `fetch` simulado de Digifact TEST: registra cada llamada (URL, método, cuerpo) y responde según el modo. */
function digifactFalso(modo: Modo = "ok") {
  const llamadas: { url: string; metodo: string; cuerpo?: string }[] = [];
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); llamadas.push({ url: u, metodo: init?.method ?? "GET", cuerpo: typeof init?.body === "string" ? init.body : undefined });
    if (modo === "tiempo") return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    if (u.endsWith("/login/get_token")) return modo === "login401" ? json({ mensaje: TEXTO_PROVEEDOR }, 401) : json({ Token: TOKEN });
    if (u.includes("/Shared?")) {
      if (modo === "http500") return json({ mensaje: TEXTO_PROVEEDOR }, 500);
      if (modo === "limite429") return json({ mensaje: TEXTO_PROVEEDOR }, 429);
      if (modo === "ilegible") return new Response(`<html>${TEXTO_PROVEEDOR}</html>`, { status: 200 });
      return json({ RESPONSE: modo === "sin_coincidencia" ? [] : [{ NIT: NIT_CONSULTADO, NOMBRE: NOMBRE_REAL }] });
    }
    return json({ mensaje: "no esperado" }, 404);
  }) as typeof fetch;
  return { fetchImpl, llamadas, consultas: () => llamadas.filter((l) => l.url.includes("/Shared?")).length };
}
const consultorDe = (modo: Modo = "ok", extra: Record<string, string> = {}, tiempoMaximoMs?: number) => { const f = digifactFalso(modo); const r = crearConsultorNitDesdeEntorno(envBase(extra), { fetchImpl: f.fetchImpl, tiempoMaximoMs }); assert.ok(r.consultor, r.motivo); return { ...f, consultor: r.consultor as ConsultorNit }; };

Deno.test("FEL_DIGIFACT_NIT falla cerrado: sin interruptor, sin empresa, sin credenciales o con una empresa inválida no existe consultor y el motivo no muestra valores", () => {
  const casos: [string, (k: string) => string | undefined][] = [
    ["sin nada", () => undefined],
    ["interruptor distinto de «habilitado»", envBase({ FEL_DIGIFACT_NIT: "si" })],
    ["sin empresa", envBase({ FEL_DIGIFACT_NIT_EMPRESA: "" })],
    ["empresa que no es UUID", envBase({ FEL_DIGIFACT_NIT_EMPRESA: "no-es-uuid" })],
    ["sin usuario", envBase({ DIGIFACT_TEST_USERNAME: "" })], ["sin contraseña", envBase({ DIGIFACT_TEST_PASSWORD: "" })], ["sin NIT de la cuenta", envBase({ DIGIFACT_TEST_NIT: "" })],
  ];
  for (const [que, env] of casos) { const r = crearConsultorNitDesdeEntorno(env); assert.equal(r.consultor, undefined, que); for (const secreto of [USUARIO, CLAVE, NIT_CUENTA, EMPRESA]) assert.ok(!r.motivo.includes(secreto), `${que}: el motivo no muestra valores`); }
  const r = crearConsultorNitDesdeEntorno(envBase({ DIGIFACT_TEST_NIT: "NIT-NO-VALIDO" })); assert.equal(r.consultor, undefined, "un NIT de cuenta inválido no habilita nada"); assert.ok(!r.motivo.includes("NIT-NO-VALIDO"));
});

Deno.test("independencia: FEL_DIGIFACT_NIT no habilita la certificación y FEL_DIGIFACT_TEST no habilita la consulta de NIT", async () => {
  // solo la consulta de NIT: el servicio de certificación NO existe
  const soloNit = await crearDigifactDesdeEntorno(envBase());
  assert.equal(soloNit.servicio, undefined, "con solo FEL_DIGIFACT_NIT no se arma ningún servicio de certificación"); assert.match(soloNit.motivo, /no está habilitado/);
  // solo la certificación (con todo lo suyo): no hay consultor de NIT
  const soloTest = crearConsultorNitDesdeEntorno((k) => ({ FEL_DIGIFACT_TEST: "habilitado", FEL_DIGIFACT_TEST_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA } as Record<string, string>)[k]);
  assert.equal(soloTest.consultor, undefined, "FEL_DIGIFACT_TEST por sí solo no habilita la consulta real de NIT");
  // el consultor SOLO sabe consultar: ni certificar, ni anular, ni notas de crédito, ni descargar, y no se puede ampliar
  const { consultor } = consultorDe();
  assert.deepEqual(Object.keys(consultor).sort(), ["consultar", "empresaId"]); assert.equal(Object.isFrozen(consultor), true);
  for (const op of ["certificar", "anular", "notaCredito", "descargar", "obtenerDocumento", "conciliarPorReferencia", "consultarDte"]) assert.equal((consultor as unknown as J)[op], undefined, `el consultor no tiene «${op}»`);
  assert.throws(() => { (consultor as unknown as J).certificar = () => 1; }, TypeError, "no se pueden agregar operaciones");
});

Deno.test({ name: "solo con la consulta de NIT habilitada NINGUNA ruta de certificación, anulación ni emisión responde y a Digifact solo llegan el inicio de sesión y GET /Shared", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactNit: f.consultor });   // sin `digifact`: el servicio de certificación no existe
  const ana = await new Cli("ana").entrar(), doc = "11111111-1111-4111-8111-111111111111";
  const est = (await ana.llamar("GET", "/api/digifact/estado")).json; assert.equal(est.certificacion, false); assert.equal(est.habilitado, false); assert.equal(est.consultaNit, true, "la empresa configurada ve la consulta habilitada");
  for (const [m, ruta] of [["POST", "/api/digifact/nit"], ["POST", `/api/documentos/${doc}/digifact`], ["POST", `/api/documentos/${doc}/digifact/validar`], ["POST", `/api/documentos/${doc}/digifact/preparar`], ["POST", `/api/documentos/${doc}/digifact/certificar`],
    ["POST", `/api/documentos/${doc}/digifact/conciliar`], ["GET", `/api/documentos/${doc}/digifact`], ["GET", `/api/documentos/${doc}/digifact/xml`], ["GET", `/api/documentos/${doc}/digifact/pdf`]]) {
    const r = await ana.llamar(m, ruta, m === "POST" ? { nit: NIT_CONSULTADO, confirmar: "CERTIFICAR-TEST" } : undefined); assert.equal(r.status, 503, `${m} ${ruta}`); assert.equal(r.json.codigo, "digifact_no_habilitado", `${m} ${ruta}`);
  }
  assert.equal((await nit(ana, NIT_CONSULTADO)).status, 200, "la consulta de receptores sí funciona");
  assert.equal(f.llamadas.length, 2, "una sola consulta: inicio de sesión + GET /Shared"); for (const l of f.llamadas) assert.ok(l.url.startsWith("https://testnucgt.digifact.com/api/"), "solo el ambiente TEST");
  assert.ok(f.llamadas.every((l) => l.url.endsWith("/login/get_token") || (l.metodo === "GET" && l.url.includes("/Shared?"))), "solo inicio de sesión y consultas GET /Shared");
  assert.ok(!f.llamadas.some((l) => /transform|CancelFelGT|ncredtotal|GetDocument/.test(l.url)), "ninguna llamada de certificación, anulación, nota de crédito ni descarga");
}});

Deno.test({ name: "empresa autorizada: nombre real de Digifact TEST rotulado como tal; las demás empresas siguen con el simulador y NUNCA usan las credenciales", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactNit: f.consultor });
  const ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar();
  const r = await nit(ana, NIT_CONSULTADO); assert.equal(r.status, 200); assert.deepEqual(r.json, { origen: "digifact_test", simulado: false, encontrado: true, nit: NIT_CONSULTADO, nombre: NOMBRE_REAL });
  const antes = f.llamadas.length; const [n1, v1] = Object.entries(DEMO_NIT)[0];
  const s = await nit(sofia, n1); assert.equal(s.status, 200); assert.deepEqual(s.json, { origen: "demo", simulado: true, encontrado: true, nit: n1, nombre: v1 }, "otra empresa: simulador");
  assert.equal((await nit(sofia, NIT_CONSULTADO)).json.encontrado, false, "otra empresa: un NIT real NO se resuelve (el simulador no lo conoce)");
  assert.equal(f.llamadas.length, antes, "ninguna petición de otra empresa llega a Digifact");
  // una configuración global NO concede acceso: si la empresa configurada es OTRA, ana tampoco usa las credenciales
  const g = consultorDe("ok", { FEL_DIGIFACT_NIT_EMPRESA: EMPRESA_OTRA }); const m2 = await montar({ digifactNit: g.consultor }), ana3 = await new m2.Cli("ana").entrar();
  assert.equal((await nit(ana3, NIT_CONSULTADO)).json.origen, "demo"); assert.equal(g.llamadas.length, 0, "la empresa no configurada no genera tráfico hacia Digifact");
  // sin consultor: todas usan el simulador
  const sin = await montar(); const ana4 = await new sin.Cli("ana").entrar(); assert.equal((await nit(ana4, NIT_CONSULTADO)).json.origen, "demo");
}});

Deno.test({ name: "CF nunca consulta a Digifact aunque la consulta real esté habilitada", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactNit: f.consultor }), ana = await new Cli("ana").entrar();
  for (const v of ["CF", "cf", "Cf", "C F", " c-f "]) assert.deepEqual((await nit(ana, v)).json, { origen: "local", simulado: false, encontrado: true, cf: true, nit: "CF", nombre: "CONSUMIDOR FINAL" }, `«${v}»`);
  assert.equal(f.llamadas.length, 0, "ni siquiera inicia sesión en Digifact");
}});

Deno.test({ name: "tope de la consulta real: 10 por minuto y por empresa; el tope global también corta; CF no cuenta; sin permiso no se consulta", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  assert.equal(TOPE_REAL_POR_EMPRESA, 10);
  const f = consultorDe(); const { Cli } = await montar({ digifactNit: f.consultor }), ana = await new Cli("ana").entrar();
  for (let i = 0; i < 10; i++) assert.equal((await nit(ana, NIT_CONSULTADO)).status, 200, `consulta ${i + 1}`);
  const once = await nit(ana, NIT_CONSULTADO); assert.equal(once.status, 429); assert.equal(once.json.codigo, "limite"); assert.equal(f.consultas(), 10, "la consulta 11 no llegó a Digifact");
  assert.equal((await nit(ana, "CF")).status, 200, "CF no consume el tope");
  // tope global (lo comparten todas las empresas del proceso) y permisos, directamente sobre la lógica
  const g = consultorDe(); const global = crearLimitador(3); const ctx = { empresaId: EMPRESA, actorId: "a", permisos: ["clientes.ver"] };
  const deps = { consultor: g.consultor, limitador: () => true, limitadorReal: () => true, limitadorGlobal: () => global("*"), auditar: () => {} };
  for (let i = 0; i < 3; i++) assert.equal((await consultarReceptorNit(ctx, NIT_CONSULTADO, deps)).encontrado, true);
  await assert.rejects(() => consultarReceptorNit(ctx, NIT_CONSULTADO, deps), (e: Error & { status: number; codigo: string }) => e.status === 429 && e.codigo === "limite"); assert.equal(g.consultas(), 3, "el tope global corta antes de llegar a Digifact");
  const h = consultorDe(); await assert.rejects(() => consultarReceptorNit({ ...ctx, permisos: [] }, NIT_CONSULTADO, { ...deps, consultor: h.consultor }), (e: Error & { status: number }) => e.status === 403); assert.equal(h.llamadas.length, 0, "sin permiso no sale nada");
}});

Deno.test({ name: "errores del proveedor (500, inicio de sesión rechazado, respuesta ilegible, 429 y tiempo agotado): mensaje claro y fijo, sin detalles del proveedor, sin simulador y con entrada manual posible", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const [modo, status, codigo] of [["http500", 502, "proveedor"], ["login401", 502, "proveedor"], ["ilegible", 502, "proveedor"], ["limite429", 429, "limite"], ["tiempo", 502, "proveedor"]] as const) {
    const f = consultorDe(modo, {}, modo === "tiempo" ? 60 : undefined); const { Cli, bd } = await montar({ digifactNit: f.consultor }), ana = await new Cli("ana").entrar();
    const inicio = Date.now(); const r = await nit(ana, NIT_CONSULTADO); assert.equal(r.status, status, modo); assert.equal(r.json.codigo, codigo, modo);
    assert.equal(r.json.origen, undefined, `${modo}: no se responde con el simulador ni con un origen`); assert.equal(r.json.nombre, undefined);
    for (const x of [TEXTO_PROVEEDOR, CLAVE, USUARIO, "firma-secreta", NIT_CONSULTADO]) assert.ok(!r.texto.includes(x), `${modo}: la respuesta no muestra «${x}»`);
    if (modo === "tiempo") assert.ok(Date.now() - inicio < 3000, "el tiempo máximo corta la espera");
    const aud = await bd.filas<J>("select datos::text as d from public.auditoria where accion = 'receptor.nit_consultado'"); assert.equal(aud.length, 1, `${modo}: el intento se audita`);
    assert.doesNotMatch(aud[0].d, new RegExp(`${NIT_CONSULTADO}|${TEXTO_PROVEEDOR}|${CLAVE}`), `${modo}: la auditoría no guarda NIT ni detalles`);
  }
  // el proveedor responde y el NIT no existe: «sin coincidencia», sin inventar nombre
  const f = consultorDe("sin_coincidencia"); const { Cli } = await montar({ digifactNit: f.consultor }), ana = await new Cli("ana").entrar();
  assert.deepEqual((await nit(ana, "10000011")).json, { origen: "digifact_test", simulado: false, encontrado: false, nit: "10000011" }, "sin coincidencia en Digifact TEST");
}});

Deno.test({ name: "protección de credenciales y de datos: ni la contraseña, el usuario, el token, el NIT consultado ni el nombre obtenido llegan al navegador, a la auditoría ni a los registros de diagnóstico", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const vistos: string[] = []; const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { vistos.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  try {
    const f = consultorDe(); const { Cli, bd } = await montar({ digifactNit: f.consultor }), ana = await new Cli("ana").entrar(); const respuestas: string[] = [];
    respuestas.push((await nit(ana, NIT_CONSULTADO)).texto); respuestas.push((await ana.llamar("GET", "/api/digifact/estado")).texto); respuestas.push((await ana.llamar("GET", "/api/estado")).texto);
    const f2 = consultorDe("http500"); const m2 = await montar({ digifactNit: f2.consultor }), ana2 = await new m2.Cli("ana").entrar(); respuestas.push((await nit(ana2, NIT_CONSULTADO)).texto);
    const aud = await bd.filas<J>("select datos::text as d, accion from public.auditoria"); const auditoria = aud.map((x) => x.d).join("\n");
    for (const [donde, texto] of [["respuestas al navegador", respuestas.join("\n").replace(NOMBRE_REAL, "").replace(new RegExp(`"nit":"${NIT_CONSULTADO}"`), "")], ["auditoría", auditoria], ["registros de diagnóstico", vistos.join("\n")]] as const)
      for (const secreto of [CLAVE, USUARIO, "firma-secreta", TOKEN, NIT_CUENTA]) assert.ok(!texto.includes(secreto), `${donde}: no debe contener «${secreto}»`);
    for (const [donde, texto] of [["auditoría", auditoria], ["registros de diagnóstico", vistos.join("\n")]] as const) for (const dato of [NIT_CONSULTADO, NOMBRE_REAL]) assert.ok(!texto.includes(dato), `${donde}: no debe contener el NIT consultado ni el nombre obtenido`);
  } finally { Object.assign(console, orig); }
}});
