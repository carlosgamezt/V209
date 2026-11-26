import assert from "node:assert/strict";
import { DigifactGt } from "../src/digifact_gt.ts";
import type { PeticionHttp, RespuestaHttp } from "../src/digifact.ts";
import { AlmacenGtMemoria, CONFIRMACION_TEST, ErrorFelGt, type ContextoFel, type DocumentoFel } from "../src/felgt_servicio.ts";
import { cifrarCredencial, llavesDeEntorno } from "../src/credenciales_empresa.ts";
import { ResolvedorDigifact, crearServicioMultiempresa, datosDeFila, type FilaCredencial, type FilaEmisor, type LecturaEmpresa } from "../src/digifact_multiempresa.ts";
import { huellaEmisor } from "../src/datos_emisor.ts";

// Todo con transporte SIMULADO sobre el cliente REAL de Digifact: ninguna prueba toca la red ni usa credenciales reales.
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (sub: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.firma-secreta-${sub}-xxxx`;
const ok = (o: unknown): RespuestaHttp => ({ estado: 200, cuerpo: JSON.stringify(o) });
const E = { A: "10000000-0000-0000-0000-00000000000a", B: "10000000-0000-0000-0000-00000000000b", C: "10000000-0000-0000-0000-00000000000c" } as const;
type K = keyof typeof E;
const SECRETOS: Record<K, { usuario: string; clave: string; nit: string }> = { A: { usuario: "usuario-A-ZX1", clave: "clave-A-secreta-#1", nit: "5888492" }, B: { usuario: "usuario-B-ZX2", clave: "clave-B-secreta-#2", nit: "5888493" }, C: { usuario: "usuario-C-ZX3", clave: "clave-C-secreta-#3", nit: "5888494" } };
const entornoLlaves = { FEL_CREDENCIALES_LLAVE_ACTUAL: "1", FEL_CREDENCIALES_LLAVE_V1: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };
const ctx = (k: K): ContextoFel => ({ empresaId: E[k], actorId: "u-" + k, permisos: ["borradores.ver", "clientes.ver", "fiscal.ver", "fiscal.certificar"] });
const doc = (k: K, id: string, codigo = 10): DocumentoFel => ({ id, empresaId: E[k], establecimientoCodigo: codigo, establecimientoId: `est-${k}-${codigo}`, estadoPreparacion: "revisado", estadoFiscal: "ninguno", receptor: { tipoId: "CF", id: "CF", nombre: "CONSUMIDOR FINAL" },
  lineas: [{ tipo: "Servicio", descripcion: "Servicio de prueba NEXA FEL", cantidad: "1", precioUnitario: "100", descuento: "0", unidad: "SER" }] });
const filaEmisor = async (k: K, codigo = 10): Promise<FilaEmisor> => {
  const f: Omit<FilaEmisor, "huella"> = { establecimiento_id: `est-${k}-${codigo}`, version: 1, nit: SECRETOS[k].nit, nombre_fiscal: `Empresa ${k}, S.A.`, nombre_comercial: `Sucursal ${codigo}`, afiliacion_iva: "GEN", frases: [{ tipo: 1, escenario: 2 }], correo: null, codigo_establecimiento: codigo, direccion: `Calle ${codigo}`, codigo_postal: "01001", municipio: "Guatemala", departamento: "Guatemala" };
  return { ...f, huella: await huellaEmisor(datosDeFila({ ...f, huella: "" })) };
};

async function mundo() {
  const llaves = await llavesDeEntorno((k) => (entornoLlaves as Record<string, string>)[k]);
  const tienda = new Map<string, LecturaEmpresa>(); let lecturas = 0; const registro: string[] = [];
  const trafico: { k: K; ruta: string; usuario?: string; auth?: string; taxid?: string; sucursal?: string; direccion?: string }[] = []; const envios: Record<K, number> = { A: 0, B: 0, C: 0 }; let seq = 0;
  const conectar = async (k: K, o: { certificar?: boolean; consultaNit?: boolean; version?: number; codigos?: number[] } = {}) => {
    const c = await cifrarCredencial(llaves, E[k], { usuario: SECRETOS[k].usuario, clave: SECRETOS[k].clave });
    const cred: FilaCredencial = { digifact_nit: SECRETOS[k].nit, credencial_cifrada: c.bytes, llave_version: c.version, consulta_nit: o.consultaNit ?? false, consulta_cui: false, certificar: o.certificar ?? true, correo_digifact: false, version: o.version ?? 1 };
    tienda.set(E[k], { credencial: cred, emisores: await Promise.all((o.codigos ?? [10]).map((c2) => filaEmisor(k, c2))) });
  };
  const reloj = { t: 1_000_000 };
  const res = new ResolvedorDigifact({
    leer: async (id) => { lecturas++; return tienda.get(id) ?? { credencial: null, emisores: [] }; }, llaves, ahora: () => reloj.t, ttlMs: 60_000, ttlNegativoMs: 30_000, ttlErrorMs: 5_000,
    registrar: (ev, id, cod) => { registro.push(`${ev}|${id}|${cod}`); },
    crearCliente: ({ nit, usuario, clave }) => {
      const k = (Object.keys(SECRETOS) as K[]).find((x) => SECRETOS[x].nit === nit)!;
      const transporte = async (p: PeticionHttp): Promise<RespuestaHttp> => {
        const q = new URL("https://x" + p.ruta).searchParams;
        const nuc = p.ruta.startsWith("/v2/transform/nuc_json") && p.cuerpo ? JSON.parse(p.cuerpo) : null;
        trafico.push({ k, ruta: p.ruta.split("?")[0], sucursal: nuc?.Seller?.BranchInfo?.Code, direccion: nuc?.Seller?.BranchInfo?.AddressInfo?.Address, usuario: p.ruta === "/login/get_token" ? (JSON.parse(p.cuerpo!).Username as string) : undefined, auth: p.cabeceras["authorization"] ?? p.cabeceras["Authorization"], taxid: q.get("TAXID") ?? undefined });
        if (p.ruta === "/login/get_token") { assert.equal(JSON.parse(p.cuerpo!).Password, clave, "el inicio de sesión usa la clave de ESA empresa"); return ok({ token: jwt(k) }); }
        if (p.ruta.startsWith("/v2/transform/nuc_json")) { envios[k]++; await new Promise((r) => setTimeout(r, 5)); const n = ++seq; return ok({ code: "1", message: "Procesado Correctamente", authNumber: `AAAAAAAA-0000-4000-8000-${String(n).padStart(12, "0")}`, batch: "A001", serial: String(n), enrolledTimeStamp: "2026-11-16T10:00:05", responseData1: "PD94bWw=", responseData3: "JVBERi0x" }); }
        if (p.ruta.startsWith("/Shared")) { const t = new URL("https://x" + p.ruta).searchParams.get("DATA1"); if (t === "SHARED_GETINFONITcom") return ok({ RESPONSE: [{ NIT: "44653948", NOMBRE: "EMPRESA DE PRUEBA, S.A." }] }); return ok({ REQUEST_DATA: [{ Respuesta: "0" }], RESPONSE: [] }); }
        return ok({}); };
      return new DigifactGt({ nit, usuario, obtenerClave: () => clave, transporte });
    },
  });
  const multi = crearServicioMultiempresa(res, { almacen: AlmacenGtMemoria.persistenteSimulado(), ahora: () => new Date("2026-11-16T16:00:00Z") });
  const certificar = async (k: K, id: string, codigo = 10) => { const p = await multi.preparar(ctx(k), doc(k, id, codigo)); return await multi.certificar(ctx(k), doc(k, id, codigo), { operacionId: p.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p.referencia, huellaEmisor: p.huellaEmisor }); };
  return { res, multi, conectar, tienda, lecturas: () => lecturas, registro, trafico, envios, reloj, certificar, llaves };
}
const rechaza = async (p: Promise<unknown>, codigo: string) => { await assert.rejects(p, (e: unknown) => e instanceof ErrorFelGt && e.codigo === codigo, `se esperaba ${codigo}`); };
const sinSecretos = (texto: string) => { for (const k of Object.keys(SECRETOS) as K[]) for (const s of [SECRETOS[k].usuario, SECRETOS[k].clave, entornoLlaves.FEL_CREDENCIALES_LLAVE_V1]) assert.ok(!texto.includes(s), "no debe aparecer ningún secreto"); };

Deno.test("aislamiento: cada empresa usa SOLO su usuario, su clave, su NIT y su token; certifican a la vez sin mezclarse", async () => {
  const m = await mundo(); await m.conectar("A"); await m.conectar("B");
  const [a, b] = await Promise.all([m.certificar("A", "dA"), m.certificar("B", "dB")]);
  assert.equal(a.operacion.estado, "certificada"); assert.equal(b.operacion.estado, "certificada");
  for (const k of ["A", "B"] as K[]) {
    for (const t of m.trafico.filter((x) => x.k === k)) {
      if (t.usuario) assert.ok(t.usuario.endsWith(SECRETOS[k].usuario) && !t.usuario.includes(SECRETOS[k === "A" ? "B" : "A"].usuario), `login de ${k}`);
      if (t.auth) assert.equal(t.auth, jwt(k), `el token de ${k} es el suyo`);
      if (t.taxid) assert.ok(t.taxid.endsWith(SECRETOS[k].nit), `el NIT de ${k} es el suyo`);
    }
  }
  assert.equal(m.envios.A, 1); assert.equal(m.envios.B, 1);
  assert.notEqual(a.operacion.referencia, b.operacion.referencia, "referencias distintas");
});

Deno.test("concurrencia: varias certificaciones de dos empresas a la vez; el mismo documento dos veces se envía UNA sola vez", async () => {
  const m = await mundo(); await m.conectar("A"); await m.conectar("B");
  const docs: [K, string][] = [["A", "a1"], ["A", "a2"], ["A", "a3"], ["B", "b1"], ["B", "b2"], ["B", "b3"]];
  const rs = await Promise.all(docs.map(([k, id]) => m.certificar(k, id))); assert.ok(rs.every((r) => r.operacion.estado === "certificada"));
  assert.equal(m.envios.A, 3); assert.equal(m.envios.B, 3);
  // el MISMO documento con la MISMA preparación certificado dos veces a la vez: un solo envío
  const p = await m.multi.preparar(ctx("A"), doc("A", "dup")); const c = { operacionId: p.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p.referencia, huellaEmisor: p.huellaEmisor };
  const antes = m.envios.A; const r = await Promise.allSettled([m.multi.certificar(ctx("A"), doc("A", "dup"), c), m.multi.certificar(ctx("A"), doc("A", "dup"), c)]);
  assert.equal(m.envios.A - antes, 1, "un solo envío aunque lleguen dos solicitudes iguales"); assert.ok(r.some((x) => x.status === "fulfilled"));
});

Deno.test("caché: una sola carga a la vez, sin consultas con la caché vigente, el cliente (y su token) se conserva al renovar y el número de empresas está acotado", async () => {
  const m = await mundo(); await m.conectar("A");
  await Promise.all(Array.from({ length: 20 }, () => m.res.asegurar(E.A))); assert.equal(m.lecturas(), 1, "20 peticiones simultáneas = una carga");
  for (let i = 0; i < 100; i++) await m.multi.validar(ctx("A"), doc("A", "v" + i)); assert.equal(m.lecturas(), 1, "ruta caliente: cero consultas a la base");
  await m.certificar("A", "x1"); const logins = () => m.trafico.filter((t) => t.ruta === "/login/get_token").length; assert.equal(logins(), 1);
  m.reloj.t += 61_000; await m.res.asegurar(E.A); assert.equal(m.lecturas(), 2, "al vencer se vuelve a leer UNA vez");
  await m.certificar("A", "x2"); assert.equal(logins(), 1, "misma configuración: se conserva el cliente y su token (sin nuevo inicio de sesión)");
  // acotado
  const pequeno = new ResolvedorDigifact({ leer: async () => ({ credencial: null, emisores: [] }), llaves: m.llaves, crearCliente: () => { throw new Error("no"); }, maxEmpresas: 3 });
  for (let i = 0; i < 10; i++) await pequeno.asegurar(`10000000-0000-0000-0000-0000000000${(10 + i)}`); assert.ok(pequeno.tamano() <= 3);
  assert.equal(await m.res.asegurar("no-es-uuid"), null);
});

Deno.test("empresa nueva sin reiniciar ni redesplegar; suspendida o con credenciales reemplazadas se respeta al vencer la caché; invalidar es inmediato", async () => {
  const m = await mundo(); await m.conectar("A");
  await rechaza(m.certificar("C", "c0"), "SIN_CANAL");   // C aún no está conectada
  await m.conectar("C"); m.reloj.t += 5_000;
  await rechaza(m.certificar("C", "c1"), "SIN_CANAL");   // la caché negativa (30 s) todavía vale
  m.reloj.t += 30_000; assert.equal((await m.certificar("C", "c2")).operacion.estado, "certificada", "C se conecta sin tocar el código");
  m.res.invalidar(E.C); m.tienda.delete(E.C); await rechaza(m.certificar("C", "c3"), "SIN_CANAL");   // desconectada: inmediato al invalidar
  await m.certificar("A", "a8"); assert.equal(m.trafico.filter((t) => t.k === "A" && t.ruta === "/login/get_token").length, 1);
  await m.conectar("A", { version: 2 }); m.reloj.t += 61_000;
  await m.certificar("A", "a9"); assert.equal(m.trafico.filter((t) => t.k === "A" && t.ruta === "/login/get_token").length, 2, "credenciales nuevas: cliente nuevo, nuevo inicio de sesión");
  m.tienda.set(E.A, { credencial: null, emisores: [] }); m.reloj.t += 61_000; await rechaza(m.certificar("A", "a10"), "SIN_CANAL");   // suspendida
});

Deno.test("interruptores por empresa: sin «certificar» no se envía nada; la consulta de NIT solo si la empresa la tiene", async () => {
  const m = await mundo(); await m.conectar("A", { certificar: false, consultaNit: false }); await m.conectar("B", { certificar: true, consultaNit: true });
  await rechaza(m.certificar("A", "a1"), "PRUEBA_NO_AUTORIZADA"); assert.equal(m.envios.A, 0, "no se envió nada");
  await rechaza(m.multi.consultarNit(ctx("A"), "44653948"), "SIN_CANAL");
  assert.equal((await m.multi.consultarNit(ctx("B"), "44653948")).encontrado, true);
  assert.equal((await m.certificar("B", "b1")).operacion.estado, "certificada");
});

Deno.test("fallos cerrados y sin secretos: cifrado alterado, copiado de otra empresa, huella que no coincide o error de la base dejan a la empresa SIN canal", async () => {
  const m = await mundo(); await m.conectar("A"); await m.conectar("B");
  const a = m.tienda.get(E.A)!; const alterado = a.credencial!.credencial_cifrada.slice(); alterado[alterado.length - 1] ^= 1;
  m.tienda.set(E.A, { ...a, credencial: { ...a.credencial!, credencial_cifrada: alterado } });
  const b = m.tienda.get(E.B)!; m.tienda.set(E.B, { ...b, credencial: { ...b.credencial!, credencial_cifrada: a.credencial!.credencial_cifrada } });   // el cifrado de A copiado a B
  await rechaza(m.certificar("A", "a1"), "SIN_CANAL"); await rechaza(m.certificar("B", "b1"), "SIN_CANAL");
  assert.equal(m.envios.A + m.envios.B, 0, "no se envió nada");
  assert.ok(m.registro.some((r) => r.startsWith(`resolucion_fallida|${E.A}|AUTENTICACION`)) && m.registro.some((r) => r.startsWith(`resolucion_fallida|${E.B}|AUTENTICACION`)));
  await m.conectar("C"); const c = m.tienda.get(E.C)!; m.tienda.set(E.C, { ...c, emisores: [{ ...c.emisores[0], nombre_fiscal: "Otro nombre" }] });   // datos que ya no coinciden con la huella aprobada
  await rechaza(m.certificar("C", "c1"), "SIN_CANAL"); assert.ok(m.registro.some((r) => r.includes("huella_no_coincide")));
  const roto = new ResolvedorDigifact({ leer: async () => { throw new Error(`fallo con ${SECRETOS.A.clave}`); }, llaves: m.llaves, crearCliente: () => { throw new Error("no"); }, registrar: (e, i, c2) => m.registro.push(`${e}|${i}|${c2}`) });
  assert.equal(await roto.asegurar(E.A), null);
  sinSecretos(m.registro.join("\n") + JSON.stringify(m.trafico));
});

Deno.test("una empresa no puede certificar el documento de otra", async () => {
  const m = await mundo(); await m.conectar("A"); await m.conectar("B");
  const p = await m.multi.preparar(ctx("A"), doc("A", "dA"));
  await assert.rejects(m.multi.certificar(ctx("B"), doc("A", "dA"), { operacionId: p.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p.referencia, huellaEmisor: p.huellaEmisor }));
  assert.equal(m.envios.A + m.envios.B, 0);
});

Deno.test("dos establecimientos de la misma empresa: cada documento sale con SU emisor (código y dirección), mismas credenciales y mismo token; concurrencia sin mezclarse", async () => {
  const m = await mundo(); await m.conectar("A", { codigos: [10, 20] });
  const [a, b, a2, b2] = await Promise.all([m.certificar("A", "d10", 10), m.certificar("A", "d20", 20), m.certificar("A", "d10b", 10), m.certificar("A", "d20b", 20)]);
  for (const r of [a, b, a2, b2]) assert.equal(r.operacion.estado, "certificada");
  const envios = m.trafico.filter((t) => t.ruta.startsWith("/v2/transform/nuc_json"));
  assert.equal(envios.length, 4); assert.deepEqual(envios.map((t) => `${t.sucursal}|${t.direccion}`).sort(), ["10|Calle 10", "10|Calle 10", "20|Calle 20", "20|Calle 20"], "el NUC lleva el establecimiento y la dirección de ese establecimiento");
  assert.equal(m.trafico.filter((t) => t.ruta === "/login/get_token").length, 1, "mismas credenciales: UN solo inicio de sesión y un solo token para ambos establecimientos");
  assert.equal(new Set([a, b, a2, b2].map((r) => r.operacion.referencia)).size, 4, "referencias distintas");
});

Deno.test("establecimiento sin emisor aprobado, o documento sin establecimiento: sin canal y no se envía nada; el emisor de un establecimiento no sirve a otro ni a otra empresa", async () => {
  const m = await mundo(); await m.conectar("A", { codigos: [10, 20] }); await m.conectar("B");
  await rechaza(m.certificar("A", "x30", 30), "SIN_CANAL");   // A no tiene emisor para el 30
  await rechaza(m.certificar("B", "b20", 20), "SIN_CANAL");   // el 20 es de A: B no lo usa
  const sin = { ...doc("A", "sin"), establecimientoCodigo: undefined, establecimientoId: undefined } as DocumentoFel;
  await rechaza(m.multi.preparar(ctx("A"), sin), "SIN_CANAL");
  assert.equal(m.envios.A + m.envios.B, 0, "no se envió nada");
  // solo el establecimiento con huella alterada queda sin canal
  const a = m.tienda.get(E.A)!; m.tienda.set(E.A, { ...a, emisores: [a.emisores[0], { ...a.emisores[1], nombre_comercial: "Alterada" }] }); m.res.invalidar(E.A);
  assert.equal((await m.certificar("A", "ok10", 10)).operacion.estado, "certificada"); await rechaza(m.certificar("A", "mal20", 20), "SIN_CANAL");
  assert.ok(m.registro.some((r) => r.startsWith(`huella_no_coincide|${E.A}`)));
});

Deno.test("idempotencia por establecimiento: el mismo documento dos veces a la vez = un envío; el mismo contenido en otro establecimiento es otra referencia", async () => {
  const m = await mundo(); await m.conectar("A", { codigos: [10, 20] });
  const p10 = await m.multi.preparar(ctx("A"), doc("A", "igual", 10)), p20 = await m.multi.preparar(ctx("A"), doc("A", "igual", 20));
  assert.notEqual(p10.referencia, p20.referencia, "otro establecimiento = otra referencia (y otra huella de emisor)"); assert.notEqual(p10.huellaEmisor, p20.huellaEmisor);
  const c = { operacionId: p10.operacionId, confirmacion: CONFIRMACION_TEST, referencia: p10.referencia, huellaEmisor: p10.huellaEmisor };
  const r = await Promise.allSettled([m.multi.certificar(ctx("A"), doc("A", "igual", 10), c), m.multi.certificar(ctx("A"), doc("A", "igual", 10), c)]);
  assert.equal(m.envios.A, 1, "un solo envío"); assert.ok(r.some((x) => x.status === "fulfilled"));
  // la preparación del 10 no se puede certificar presentándola como del 20 (la huella aprobada y el contenido no coinciden)
  assert.equal(m.envios.A, 1);
  const pn = await m.multi.preparar(ctx("A"), doc("A", "otro", 10));
  await assert.rejects(m.multi.certificar(ctx("A"), doc("A", "otro", 20), { operacionId: pn.operacionId, confirmacion: CONFIRMACION_TEST, referencia: pn.referencia, huellaEmisor: pn.huellaEmisor }), (e: unknown) => e instanceof ErrorFelGt, "presentar la preparación del 10 con un documento del 20 se rechaza");
  assert.equal(m.envios.A, 1, "y no se envió nada");
});
