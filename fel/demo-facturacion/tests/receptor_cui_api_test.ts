// Consulta de CUI/DPI por Digifact TEST (SHARED_GETINFOCUI): habilitación INDEPENDIENTE de la consulta de NIT y de la certificación, una sola empresa, límites propios y protección de datos personales.
// Ninguna prueba toca la red ni usa credenciales reales: el cliente de Digifact es el REAL con un `fetch` SIMULADO que lo registra todo. TODOS los CUI y nombres son INVENTADOS.
// Uso: deno test -A tests/receptor_cui_api_test.ts
import assert from "node:assert/strict";
import { crearConsultorCuiDesdeEntorno, type ConsultorCui } from "../src/digifact_cui_entorno.ts";
import { crearConsultorNitDesdeEntorno } from "../src/digifact_nit_entorno.ts";
import { crearDigifactDesdeEntorno } from "../src/digifact_entorno.ts";
import { consultarReceptorCui, DEMO_CUI, DEMO_CUI_ERROR, TOPE_CUI_POR_EMPRESA, normalizarCui } from "../src/receptor_cui.ts";
import { crearLimitador } from "../src/receptor_nit.ts";
import { EMPRESA } from "../src/mundo_demo.ts";
import { montar, nit, type J } from "./ayudas_receptor.ts";

const USUARIO = "USUARIO_TEST_INVENTADO", CLAVE = "CLAVE-INVENTADA-PARA-PRUEBAS-9", NIT_CUENTA = "5888492", EMPRESA_OTRA = "00000000-0000-4000-8000-00000000beef";
const CUI = "1234567891234", NOMBRE_REAL = "PERSONA INVENTADA PARA PRUEBAS", TEXTO_PROVEEDOR = "DETALLE-INTERNO-DEL-PROVEEDOR";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-del-token-xxxx`;
const envBase = (extra: Record<string, string> = {}) => { const m: Record<string, string> = { FEL_DIGIFACT_CUI: "habilitado", FEL_DIGIFACT_CUI_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA, ...extra }; return (k: string) => m[k]; };
const cui = (c: { llamar: (m: string, r: string, b?: unknown, h?: Record<string, string>) => Promise<{ status: number; json: J; texto: string }> }, v: unknown, cab?: Record<string, string>) => c.llamar("POST", "/api/receptores/cui", { cui: v }, cab);

type Modo = "ok" | "sin_coincidencia" | "http500" | "login401" | "ilegible" | "limite429" | "tiempo";
function digifactFalso(modo: Modo = "ok") {
  const llamadas: { url: string; metodo: string }[] = [];
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); llamadas.push({ url: u, metodo: init?.method ?? "GET" });
    if (modo === "tiempo") return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    if (u.endsWith("/login/get_token")) return modo === "login401" ? json({ mensaje: TEXTO_PROVEEDOR }, 401) : json({ Token: TOKEN });
    if (u.includes("/Shared?")) {
      const q = new URL(u).searchParams;
      if (modo === "http500") return json({ mensaje: TEXTO_PROVEEDOR }, 500); if (modo === "limite429") return json({ mensaje: TEXTO_PROVEEDOR }, 429);
      if (modo === "ilegible") return new Response(`<html>${TEXTO_PROVEEDOR}</html>`, { status: 200 });
      if (q.get("DATA1") !== "SHARED_GETINFOCUI") return json({ RESPONSE: [] });   // otra operación (NIT): este simulador de CUI no la sirve
      const pedido = (q.get("DATA2") ?? "").replace("CUI|", "");
      return json({ RESPONSE: modo === "sin_coincidencia" ? [] : [{ CUI: pedido, NOMBRE: NOMBRE_REAL }] });
    }
    return json({ mensaje: "no esperado" }, 404);
  }) as typeof fetch;
  return { fetchImpl, llamadas, consultas: () => llamadas.filter((l) => l.url.includes("/Shared?")).length };
}
const consultorDe = (modo: Modo = "ok", extra: Record<string, string> = {}, tiempoMaximoMs?: number) => { const f = digifactFalso(modo); const r = crearConsultorCuiDesdeEntorno(envBase(extra), { fetchImpl: f.fetchImpl, tiempoMaximoMs }); assert.ok(r.consultor, r.motivo); return { ...f, consultor: r.consultor as ConsultorCui }; };

Deno.test("FEL_DIGIFACT_CUI falla cerrado y no muestra valores; el consultor solo sabe consultar", () => {
  for (const [que, env] of [["sin nada", () => undefined], ["interruptor distinto", envBase({ FEL_DIGIFACT_CUI: "si" })], ["sin empresa", envBase({ FEL_DIGIFACT_CUI_EMPRESA: "" })], ["empresa no UUID", envBase({ FEL_DIGIFACT_CUI_EMPRESA: "x" })],
    ["sin usuario", envBase({ DIGIFACT_TEST_USERNAME: "" })], ["sin contraseña", envBase({ DIGIFACT_TEST_PASSWORD: "" })], ["sin NIT de la cuenta", envBase({ DIGIFACT_TEST_NIT: "" })]] as const) {
    const r = crearConsultorCuiDesdeEntorno(env as (k: string) => string | undefined); assert.equal(r.consultor, undefined, que); for (const x of [USUARIO, CLAVE, NIT_CUENTA, EMPRESA]) assert.ok(!r.motivo.includes(x), `${que}: el motivo no muestra valores`);
  }
  const { consultor } = consultorDe(); assert.deepEqual(Object.keys(consultor).sort(), ["consultar", "empresaId"]); assert.equal(Object.isFrozen(consultor), true);
  for (const op of ["certificar", "anular", "notaCredito", "descargar", "consultarNit", "consultarCui", "consultarDte"]) assert.equal((consultor as unknown as J)[op], undefined, `el consultor no expone «${op}»`);
});

Deno.test("independencia de los TRES interruptores: CUI, NIT y certificación no se habilitan entre sí", async () => {
  const soloCui = envBase();
  assert.equal(crearConsultorNitDesdeEntorno(soloCui).consultor, undefined, "FEL_DIGIFACT_CUI no habilita la consulta de NIT");
  assert.equal((await crearDigifactDesdeEntorno(soloCui)).servicio, undefined, "FEL_DIGIFACT_CUI no habilita la certificación");
  const soloNit = (k: string) => ({ FEL_DIGIFACT_NIT: "habilitado", FEL_DIGIFACT_NIT_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA } as Record<string, string>)[k];
  assert.equal(crearConsultorCuiDesdeEntorno(soloNit).consultor, undefined, "FEL_DIGIFACT_NIT no habilita la consulta de CUI");
  const soloTest = (k: string) => ({ FEL_DIGIFACT_TEST: "habilitado", FEL_DIGIFACT_TEST_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA } as Record<string, string>)[k];
  assert.equal(crearConsultorCuiDesdeEntorno(soloTest).consultor, undefined, "FEL_DIGIFACT_TEST no habilita la consulta de CUI");
});

Deno.test("API sin la certificación: con solo la consulta de CUI ninguna ruta de certificación, anulación ni emisión responde; a Digifact solo llegan inicio de sesión y GET /Shared de SHARED_GETINFOCUI", async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactCui: f.consultor }); const ana = await new Cli("ana").entrar(), doc = "11111111-1111-4111-8111-111111111111";
  const est = (await ana.llamar("GET", "/api/digifact/estado")).json; assert.equal(est.certificacion, false); assert.equal(est.consultaCui, true); assert.equal(est.consultaNit, false, "la consulta de NIT sigue apagada");
  for (const [m, ruta] of [["POST", "/api/digifact/nit"], ["POST", `/api/documentos/${doc}/digifact/certificar`], ["POST", `/api/documentos/${doc}/digifact/preparar`], ["GET", `/api/documentos/${doc}/digifact/xml`]] as const) {
    const r = await ana.llamar(m, ruta, m === "POST" ? { nit: "44653948", confirmar: "CERTIFICAR-TEST" } : undefined); assert.equal(r.status, 503, `${m} ${ruta}`); assert.equal(r.json.codigo, "digifact_no_habilitado");
  }
  const r = await cui(ana, CUI); assert.equal(r.status, 200); assert.deepEqual(r.json, { origen: "digifact_test", simulado: false, encontrado: true, nombre: NOMBRE_REAL }); assert.ok(!r.texto.includes(CUI), "la respuesta NO devuelve el CUI");
  assert.equal(f.llamadas.length, 2); const q = new URL(f.llamadas[1].url); assert.equal(q.searchParams.get("DATA1"), "SHARED_GETINFOCUI"); assert.equal(q.searchParams.get("DATA2"), `CUI|${CUI}`);
  for (const l of f.llamadas) assert.ok(l.url.startsWith("https://testnucgt.digifact.com/api/")); assert.ok(!f.llamadas.some((l) => /transform|CancelFelGT|ncredtotal|GetDocument/.test(l.url)));
});

Deno.test("la consulta de NIT no se afecta: con solo CUI, el NIT usa el simulador y viceversa; ninguna petición del otro tipo llega a Digifact", async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactCui: f.consultor }); const ana = await new Cli("ana").entrar();
  const n = await nit(ana, "10000011"); assert.equal(n.json.origen, "demo", "NIT con solo CUI habilitado → simulador"); assert.equal(f.llamadas.length, 0, "ninguna llamada a Digifact por un NIT");
  const nitReal = crearConsultorNitDesdeEntorno((k) => ({ FEL_DIGIFACT_NIT: "habilitado", FEL_DIGIFACT_NIT_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA } as Record<string, string>)[k]);
  const g = await montar({ digifactNit: nitReal.consultor }); const ana2 = await new g.Cli("ana").entrar(); const r = await cui(ana2, Object.keys(DEMO_CUI)[0]); assert.equal(r.json.origen, "demo", "CUI con solo NIT habilitado → simulador"); assert.equal(r.json.simulado, true);
  const [k1, v1] = Object.entries(DEMO_CUI)[0]; assert.deepEqual(r.json, { origen: "demo", simulado: true, encontrado: true, nombre: v1 }); void k1;
  // con las dos consultas encendidas conviven, cada una con su operación
  const dos = digifactFalso(); const cn = crearConsultorNitDesdeEntorno((k) => ({ FEL_DIGIFACT_NIT: "habilitado", FEL_DIGIFACT_NIT_EMPRESA: EMPRESA, DIGIFACT_TEST_USERNAME: USUARIO, DIGIFACT_TEST_PASSWORD: CLAVE, DIGIFACT_TEST_NIT: NIT_CUENTA } as Record<string, string>)[k], { fetchImpl: dos.fetchImpl }).consultor!;
  const cc = crearConsultorCuiDesdeEntorno(envBase(), { fetchImpl: dos.fetchImpl }).consultor!; const h = await montar({ digifactNit: cn, digifactCui: cc }); const ana3 = await new h.Cli("ana").entrar();
  assert.equal((await cui(ana3, CUI)).json.origen, "digifact_test"); await nit(ana3, "44653948"); const ops = dos.llamadas.filter((l) => l.url.includes("/Shared?")).map((l) => new URL(l.url).searchParams.get("DATA1")); assert.deepEqual(ops, ["SHARED_GETINFOCUI", "SHARED_GETINFONITcom"]);
});

Deno.test("una sola empresa: las demás usan el simulador rotulado y nunca las credenciales; una configuración global no concede acceso", async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactCui: f.consultor }); const ana = await new Cli("ana").entrar(), sofia = await new Cli("sofia").entrar();
  assert.equal((await cui(ana, CUI)).json.origen, "digifact_test"); const antes = f.llamadas.length; const [n1, v1] = Object.entries(DEMO_CUI)[0];
  assert.deepEqual((await cui(sofia, n1)).json, { origen: "demo", simulado: true, encontrado: true, nombre: v1 }, "otra empresa: simulador"); assert.equal((await cui(sofia, CUI)).json.encontrado, false, "un CUI real no se resuelve con el simulador");
  assert.equal(f.llamadas.length, antes, "ninguna petición de otra empresa llega a Digifact");
  const g = consultorDe("ok", { FEL_DIGIFACT_CUI_EMPRESA: EMPRESA_OTRA }); const m2 = await montar({ digifactCui: g.consultor }), ana3 = await new m2.Cli("ana").entrar();
  assert.equal((await cui(ana3, CUI)).json.origen, "demo"); assert.equal(g.llamadas.length, 0, "la empresa no configurada no genera tráfico");
  const sin = await montar(), ana4 = await new sin.Cli("ana").entrar(); assert.equal((await cui(ana4, CUI)).json.origen, "demo", "sin consultor: todas usan el simulador");
});

Deno.test("validación del CUI en el servidor: 13 dígitos, se normaliza, CF y NIT no valen y NINGUNA entrada inválida llega a Digifact; sesión y cabecera obligatorias", async () => {
  const f = consultorDe(); const { Cli } = await montar({ digifactCui: f.consultor }); const ana = await new Cli("ana").entrar(), anon = new Cli("ana");
  assert.equal((await cui(anon, CUI)).status, 401, "sesión obligatoria"); assert.equal((await cui(ana, CUI, {})).status, 403, "cabecera de la demostración obligatoria");
  for (const malo of ["", "123", "123456789123", "12345678912345", "123456789123A", "CF", "cf", "5888492", null, 1234567891234 * 10]) { const r = await cui(ana, malo); assert.equal(r.status, 400, `«${malo}»`); assert.equal(r.json.codigo, "entrada_invalida"); assert.match(r.json.mensaje, /13 dígitos/); assert.ok(!r.texto.includes(String(malo)) || String(malo).length < 4, "el mensaje no repite lo escrito"); }
  assert.equal(f.llamadas.length, 0, "ninguna entrada inválida llega a Digifact");
  assert.equal(normalizarCui("1234 56789-1234"), CUI); assert.equal((await cui(ana, "1234 56789-1234")).status, 200); assert.equal(new URL(f.llamadas[1].url).searchParams.get("DATA2"), `CUI|${CUI}`);
});

Deno.test("límites propios: 5 por minuto para la empresa autorizada, tope global y simulador de 20; permisos obligatorios", async () => {
  assert.equal(TOPE_CUI_POR_EMPRESA, 5);
  const f = consultorDe(); const { Cli } = await montar({ digifactCui: f.consultor }); const ana = await new Cli("ana").entrar();
  for (let i = 0; i < 5; i++) assert.equal((await cui(ana, CUI)).status, 200, `consulta ${i + 1}`);
  const sexta = await cui(ana, CUI); assert.equal(sexta.status, 429); assert.equal(sexta.json.codigo, "limite"); assert.equal(f.consultas(), 5, "la sexta no llegó a Digifact");
  const g = consultorDe(); const global = crearLimitador(2); const ctx = { empresaId: EMPRESA, actorId: "a", permisos: ["clientes.ver"] };
  const deps = { consultor: g.consultor, limitador: () => true, limitadorReal: () => true, limitadorGlobal: () => global("*"), auditar: () => {} };
  for (let i = 0; i < 2; i++) assert.equal((await consultarReceptorCui(ctx, CUI, deps)).encontrado, true);
  await assert.rejects(() => consultarReceptorCui(ctx, CUI, deps), (e: Error & { status: number; codigo: string }) => e.status === 429 && e.codigo === "limite"); assert.equal(g.consultas(), 2, "el tope global corta antes de Digifact");
  const h = consultorDe(); await assert.rejects(() => consultarReceptorCui({ ...ctx, permisos: [] }, CUI, { ...deps, consultor: h.consultor }), (e: Error & { status: number }) => e.status === 403); assert.equal(h.llamadas.length, 0, "sin permiso no sale nada");
  const lim = crearLimitador(20); const s = { limitador: lim, auditar: () => {} }; const simCtx = { empresaId: "otra", actorId: "a", permisos: ["clientes.ver"] };
  for (let i = 0; i < 20; i++) assert.equal((await consultarReceptorCui(simCtx, Object.keys(DEMO_CUI)[0], s)).simulado, true); await assert.rejects(() => consultarReceptorCui(simCtx, Object.keys(DEMO_CUI)[0], s), (e: Error & { status: number }) => e.status === 429);
});

Deno.test({ name: "errores del proveedor (500, sesión rechazada, ilegible, 429, tiempo agotado): mensaje fijo, sin detalles, sin simulador y con ingreso manual posible; sin coincidencia sin inventar nombre", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  for (const [modo, status, codigo] of [["http500", 502, "proveedor"], ["login401", 502, "proveedor"], ["ilegible", 502, "proveedor"], ["limite429", 429, "limite"], ["tiempo", 502, "proveedor"]] as const) {
    const f = consultorDe(modo, {}, modo === "tiempo" ? 60 : undefined); const { Cli, bd } = await montar({ digifactCui: f.consultor }), ana = await new Cli("ana").entrar();
    const inicio = Date.now(); const r = await cui(ana, CUI); assert.equal(r.status, status, modo); assert.equal(r.json.codigo, codigo, modo); assert.equal(r.json.origen, undefined, `${modo}: no se responde con el simulador`); assert.equal(r.json.nombre, undefined);
    for (const x of [TEXTO_PROVEEDOR, CLAVE, USUARIO, "firma-secreta", CUI, NOMBRE_REAL]) assert.ok(!r.texto.includes(x), `${modo}: la respuesta no muestra «${x}»`);
    if (modo === "tiempo") assert.ok(Date.now() - inicio < 3000, "el tiempo máximo corta la espera");
    const aud = await bd.filas<J>("select datos::text as d from public.auditoria where accion = 'receptor.cui_consultado'"); assert.equal(aud.length, 1, `${modo}: el intento se audita`); assert.doesNotMatch(aud[0].d, new RegExp(`${CUI}|${TEXTO_PROVEEDOR}|${CLAVE}`), `${modo}: la auditoría no guarda CUI ni detalles`);
    { const mal = await bd.filas<J>("select accion, jsonb_typeof(datos) as t from public.auditoria where jsonb_typeof(datos) is distinct from 'object'"); assert.deepEqual(mal, [], "AUDITORÍA: todo evento se guarda como objeto JSON (no como cadena), también en PostgreSQL real"); }
  }
  const f = consultorDe("sin_coincidencia"); const { Cli } = await montar({ digifactCui: f.consultor }), ana = await new Cli("ana").entrar();
  assert.deepEqual((await cui(ana, CUI)).json, { origen: "digifact_test", simulado: false, encontrado: false }, "sin coincidencia: no se inventa un nombre");
}});

Deno.test("simulador del CUI: datos ficticios rotulados, error simulado y CUI desconocido sin coincidencia", async () => {
  const { Cli } = await montar(); const ana = await new Cli("ana").entrar();
  for (const [c, nombre] of Object.entries(DEMO_CUI)) assert.deepEqual((await cui(ana, c)).json, { origen: "demo", simulado: true, encontrado: true, nombre }); assert.doesNotMatch(Object.values(DEMO_CUI).join(" "), /DEMO\b|simulad/i, "la advertencia no va dentro del nombre");
  assert.deepEqual((await cui(ana, "9990000010101")).json, { origen: "demo", simulado: true, encontrado: false }); const e = await cui(ana, DEMO_CUI_ERROR); assert.equal(e.status, 502); assert.equal(e.json.codigo, "proveedor");
});

Deno.test({ name: "protección de datos personales: ni el CUI, ni el nombre, ni las credenciales ni el token llegan a la auditoría ni a los registros de diagnóstico", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const vistos: string[] = []; const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { vistos.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  try {
    const f = consultorDe(); const { Cli, bd } = await montar({ digifactCui: f.consultor }), ana = await new Cli("ana").entrar(); const respuestas: string[] = [];
    respuestas.push((await cui(ana, CUI)).texto, (await ana.llamar("GET", "/api/digifact/estado")).texto, (await cui(ana, "123")).texto);
    const f2 = consultorDe("http500"); const m2 = await montar({ digifactCui: f2.consultor }), ana2 = await new m2.Cli("ana").entrar(); respuestas.push((await cui(ana2, CUI)).texto);
    const auditoria = (await bd.filas<J>("select datos::text as d from public.auditoria")).map((x) => x.d).join("\n");
    for (const [donde, texto] of [["respuestas", respuestas.join("\n").replace(NOMBRE_REAL, "")], ["auditoría", auditoria], ["registros", vistos.join("\n")]] as const) for (const secreto of [CLAVE, USUARIO, "firma-secreta", TOKEN, NIT_CUENTA, CUI]) assert.ok(!texto.includes(secreto), `${donde}: no debe contener «${secreto}»`);
    for (const [donde, texto] of [["auditoría", auditoria], ["registros", vistos.join("\n")]] as const) assert.ok(!texto.includes(NOMBRE_REAL), `${donde}: no debe contener el nombre obtenido`);
  } finally { Object.assign(console, orig); }
}});

Deno.test({ name: "CUI en clientes y receptor nuevo: se normaliza, exige 13 dígitos (sin bloquear por algoritmos no confirmados) y el tipo CUI se conserva para el documento fiscal", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const { Cli, bd } = await montar(); const ana = await new Cli("ana").entrar(); const est = (await ana.llamar("GET", "/api/estado")).json, es = est.establecimientos[0];
  const crear = (num: string, extra: J = {}) => ana.llamar("POST", "/api/clientes", { tipo_identificacion: "CUI", numero_identificacion: num, nombre: "Persona Inventada", ...extra });
  for (const malo of ["123", "250012345010", "25001234501011", "250012345010A", "0000-0000-0000"]) { const r = await crear(malo); assert.equal(r.status, 400, `«${malo}»`); assert.match(r.json.mensaje, /13 dígitos/); }
  const ok = await crear("2500 12345-0101"); assert.equal(ok.status, 200, ok.texto); assert.equal(ok.json.numero_identificacion, "2500123450101", "se guarda normalizado"); assert.equal(ok.json.tipo_identificacion, "CUI");
  assert.equal((await crear("2500123450101")).status, 422, "el mismo CUI normalizado es un duplicado (misma identificación)");
  assert.equal((await crear("1000000010101", { nombre: "Otra Persona" })).status, 200, "no se bloquea por un dígito verificador no confirmado");
  const d = await ana.llamar("POST", "/api/documentos", { cliente_nuevo: { tipo_identificacion: "CUI", numero_identificacion: "1000 00000 0101", nombre: "Receptor Inventado" }, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "100" }] }); assert.equal(d.status, 200, d.texto);
  const [c] = await bd.filas<J>("select tipo_identificacion as t, numero_identificacion as n from public.clientes where id = (select cliente_id from public.documentos where id = $1)", [d.json.documento.id]); assert.deepEqual([c.t, c.n], ["CUI", "1000000000101"]);
  const malo = await ana.llamar("POST", "/api/documentos", { cliente_nuevo: { tipo_identificacion: "CUI", numero_identificacion: "123", nombre: "X" }, establecimiento_id: es.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date()), lineas: [{ descripcion: "Servicio", cantidad: "1", precio_unitario: "100" }] }); assert.equal(malo.status, 400, "un receptor nuevo con CUI inválido ya no crea el borrador");
}});
