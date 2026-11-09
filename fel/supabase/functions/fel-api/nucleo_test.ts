import { assertEquals } from "jsr:@std/assert@1";
import { manejar, type Acciones, type Deps } from "./nucleo.ts";
import { acciones as reales } from "./acciones.ts";
import { fabricarToken } from "./lib/jwt_test.ts";
import * as v from "./lib/validacion.ts";

const EMPRESA = "10000000-0000-0000-0000-00000000000a";

interface Opc { admin?: unknown; config?: Deps["config"]; getUser?: Deps["getUser"]; maestro?: boolean; conPermisos?: string[] }
function deps(o: Opc = {}): Deps {
  return {
    admin: (o.admin as Deps["admin"]) ?? { rpc: () => { throw new Error("no debía llamarse a la base de datos"); } },
    config: o.config ?? { origenesPermitidos: ["https://app.test"], emisionRealPermitida: false, appUrl: "https://app.test" },
    getUser: o.getUser ?? ((t) => Promise.resolve(t ? { id: "u1", email: "u1@test.com" } : null)),
    esPlataforma: () => Promise.resolve(o.maestro ?? false),
    permisos: () => Promise.resolve(o.conPermisos ?? []),
  };
}

let llamadas = 0;
const falsas: Acciones = {
  libre: { requisito: {}, validar: (b) => { v.soloCampos(b, ["x"]); return { x: b.x }; }, ejecutar: () => { llamadas++; return Promise.resolve({ ok: 1 }); } },
  soloMaestro: { requisito: { plataforma: true }, validar: () => ({}), ejecutar: () => { llamadas++; return Promise.resolve({}); } },
  conPermiso: {
    requisito: { permiso: "clientes.escribir" }, validar: (b) => ({ empresa_id: b.empresa_id }),
    empresaDe: (p: { empresa_id?: string }) => p.empresa_id ?? "", ejecutar: () => { llamadas++; return Promise.resolve({}); },
  },
  conMfa: { requisito: { aal2: true }, validar: () => ({}), ejecutar: () => { llamadas++; return Promise.resolve({}); } },
  explota: { requisito: {}, validar: () => ({}), ejecutar: () => { throw new Error("SECRETO: select * from tabla_interna"); } },
};

const pedir = (cuerpo: unknown, d: Deps, acc: Acciones = falsas, opts: { token?: string | null; metodo?: string; origen?: string; crudo?: string } = {}) => {
  const h: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token === undefined ? "token-valido" : opts.token;
  if (token) h["authorization"] = `Bearer ${token}`;
  if (opts.origen) h["origin"] = opts.origen;
  return manejar(new Request("https://fel.test/fel-api", { method: opts.metodo ?? "POST", headers: h, body: opts.metodo === "GET" ? undefined : (opts.crudo ?? JSON.stringify(cuerpo)) }), d, acc);
};
const leer = async (r: Response) => ({ status: r.status, ...(await r.json().catch(() => ({}))) });

Deno.test("sin token: 401; token inválido: 401; método GET: 405", async () => {
  assertEquals((await leer(await pedir({ accion: "libre" }, deps(), falsas, { token: null }))).status, 401);
  assertEquals((await leer(await pedir({ accion: "libre" }, deps({ getUser: () => Promise.resolve(null) })))).status, 401);
  assertEquals((await leer(await pedir({}, deps(), falsas, { metodo: "GET" }))).status, 405);
});

Deno.test("acción desconocida, nombres peligrosos, JSON inválido y cuerpo enorme", async () => {
  assertEquals((await leer(await pedir({ accion: "no_existe" }, deps()))).status, 404);
  for (const nombre of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assertEquals((await leer(await pedir({ accion: nombre }, deps()))).status, 404, nombre);
  }
  assertEquals((await leer(await pedir(null, deps(), falsas, { crudo: "{no es json" }))).status, 400);
  assertEquals((await leer(await pedir(null, deps(), falsas, { crudo: "[1,2]" }))).status, 400);
  assertEquals((await leer(await pedir(null, deps(), falsas, { crudo: JSON.stringify({ accion: "libre", x: "a".repeat(70_000) }) }))).status, 413);
});

Deno.test("campos no permitidos se rechazan antes de ejecutar nada", async () => {
  llamadas = 0;
  const r = await leer(await pedir({ accion: "libre", x: 1, estado: "certificada", serie: "A" }, deps()));
  assertEquals(r.status, 400);
  assertEquals(llamadas, 0);
});

Deno.test("solo el administrador maestro ejecuta acciones de plataforma", async () => {
  llamadas = 0;
  assertEquals((await leer(await pedir({ accion: "soloMaestro" }, deps({ maestro: false })))).status, 403);
  assertEquals(llamadas, 0);
  assertEquals((await leer(await pedir({ accion: "soloMaestro" }, deps({ maestro: true })))).status, 200);
  assertEquals(llamadas, 1);
});

Deno.test("permiso por empresa: sin el permiso no se ejecuta; sin empresa es 400", async () => {
  llamadas = 0;
  const cuerpo = { accion: "conPermiso", empresa_id: EMPRESA };
  assertEquals((await leer(await pedir(cuerpo, deps({ conPermisos: [] })))).status, 403);
  assertEquals((await leer(await pedir(cuerpo, deps({ conPermisos: ["clientes.ver"] })))).status, 403);
  assertEquals(llamadas, 0);
  assertEquals((await leer(await pedir({ accion: "conPermiso" }, deps({ conPermisos: ["clientes.escribir"] })))).status, 400);
  assertEquals((await leer(await pedir(cuerpo, deps({ conPermisos: ["clientes.escribir"] })))).status, 200);
  assertEquals(llamadas, 1);
});

Deno.test("MFA: aal1 es rechazado con código mfa_requerido; aal2 pasa", async () => {
  llamadas = 0;
  const r = await leer(await pedir({ accion: "conMfa" }, deps(), falsas, { token: fabricarToken({ aal: "aal1" }) }));
  assertEquals([r.status, r.codigo], [403, "mfa_requerido"]);
  assertEquals(llamadas, 0);
  assertEquals((await leer(await pedir({ accion: "conMfa" }, deps(), falsas, { token: fabricarToken({ aal: "aal2" }) }))).status, 200);
});

Deno.test("errores internos no filtran texto de la base de datos", async () => {
  const r = await leer(await pedir({ accion: "explota" }, deps()));
  assertEquals(r.status, 500);
  assertEquals(JSON.stringify(r).includes("SECRETO"), false);
});

Deno.test("CORS: solo los orígenes permitidos reciben cabeceras", async () => {
  const ok = await pedir({ accion: "libre" }, deps(), falsas, { origen: "https://app.test" });
  assertEquals(ok.headers.get("access-control-allow-origin"), "https://app.test");
  const mal = await pedir({ accion: "libre" }, deps(), falsas, { origen: "https://malo.test" });
  assertEquals(mal.headers.get("access-control-allow-origin"), null);
  assertEquals(mal.headers.get("cache-control"), "no-store");
});

// ---------------------------------------------------------------- registro real de acciones
Deno.test("integridad del registro: toda acción (salvo yo y aceptar_invitacion) exige algo, y las administrativas exigen MFA", () => {
  for (const [nombre, a] of Object.entries(reales)) {
    if (nombre === "yo" || nombre === "aceptar_invitacion") { assertEquals(a.requisito, {}, nombre); continue; }
    assertEquals(Object.keys(a.requisito).length > 0, true, `${nombre} no exige nada`);
    if (/^(empresa_|regimen_|emision_)/.test(nombre)) {
      assertEquals([a.requisito.plataforma, a.requisito.aal2], [true, true], `${nombre} debe ser de plataforma con MFA`);
    }
    if (/^(miembro_|invitacion_)/.test(nombre)) {
      assertEquals([a.requisito.permiso, a.requisito.aal2], ["usuarios.gestionar", true], `${nombre}`);
    }
    if (/^cliente_/.test(nombre)) assertEquals(a.requisito.permiso, "clientes.escribir", nombre);
    if (/^concepto_/.test(nombre)) assertEquals(a.requisito.permiso, "conceptos.escribir", nombre);
    if (a.requisito.permiso) assertEquals(typeof a.empresaDe, "function", `${nombre} necesita empresaDe`);
  }
});

Deno.test("la emisión real está bloqueada por configuración y no toca la base de datos", async () => {
  const d = deps({ maestro: true });
  const r = await leer(await pedir({ accion: "emision_real_habilitar", empresa_id: EMPRESA, motivo: "Autorizada por prueba" }, d, reales, { token: fabricarToken({ aal: "aal2" }) }));
  assertEquals([r.status, r.codigo], [403, "no_disponible"]);
});

Deno.test("entradas de acciones reales: campos prohibidos, NIT, montos y versión", async () => {
  const tok = fabricarToken({ aal: "aal2" });
  const d = deps({ conPermisos: ["clientes.escribir", "conceptos.escribir"] });
  const base = { accion: "cliente_guardar", empresa_id: EMPRESA, nit: "1234567-8", nombre: "Cliente" };
  assertEquals((await leer(await pedir({ ...base, serie: "A" }, d, reales, { token: tok }))).status, 400);
  assertEquals((await leer(await pedir({ ...base, estado: "certificada" }, d, reales, { token: tok }))).status, 400);
  assertEquals((await leer(await pedir({ ...base, nit: "ABC" }, d, reales, { token: tok }))).status, 400);
  assertEquals((await leer(await pedir({ ...base, id: "10000000-0000-0000-0000-000000000099" }, d, reales, { token: tok }))).status, 400); // editar sin versión
  const c = { accion: "concepto_guardar", empresa_id: EMPRESA, codigo: "C1", descripcion: "x", tipo: "bien" };
  assertEquals((await leer(await pedir({ ...c, precio_unitario: "-5" }, d, reales, { token: tok }))).status, 400);
  assertEquals((await leer(await pedir({ ...c, precio_unitario: "1e3" }, d, reales, { token: tok }))).status, 400);
  assertEquals((await leer(await pedir({ ...c, precio_unitario: "10", tipo: "otro" }, d, reales, { token: tok }))).status, 400);
});
